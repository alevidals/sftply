use std::sync::Arc;
use std::time::Instant;

use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::app_state::AppState;
use crate::credentials;
use crate::domain::connection::{ConnectionAuth, ConnectionInput, ConnectionProfile};
use crate::domain::credentials::SecretKind;
use crate::domain::fs::EntryKind;
use crate::domain::session::{SessionInfo, SessionState};
use crate::error::{AppError, ErrorCode};
use crate::protocol::RemoteFs;
use crate::protocol::ftp::FtpRemote;
use crate::protocol::sftp::{SftpCredentials, SftpRemote};
use crate::session::{Session, emit_state};

/// Open a real protocol session for a saved connection.
///
/// Secrets are read from the OS keychain inside the Rust process and never
/// returned to the frontend. A missing secret fails before any network I/O.
#[tauri::command]
#[specta::specta]
pub async fn session_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<SessionInfo, AppError> {
    let profile = state
        .connections
        .get(&connection_id)
        .ok_or_else(|| AppError::not_found("That connection no longer exists."))?;
    open_session(
        &app,
        &state,
        &profile,
        Uuid::new_v4().to_string(),
        None,
        true,
    )
    .await
}

/// Connect with credentials supplied for this one request.
///
/// `save` persists the profile and secret first; otherwise the profile is
/// transient and never touches the config file or the keychain. The secret
/// stays in Rust memory and is dropped when the session closes.
#[tauri::command]
#[specta::specta]
pub async fn session_connect_quick(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ConnectionInput,
    secret: String,
    save: bool,
) -> Result<SessionInfo, AppError> {
    let input = input.normalized().map_err(AppError::invalid_input)?;
    let secret_kind = match input.auth {
        ConnectionAuth::Password => SecretKind::Password,
        ConnectionAuth::Key { .. } => SecretKind::Passphrase,
    };

    let (profile, stores_secret) = if save {
        let saved = state.connections.create(input).await?;
        // Only key connections whose key is passphrase-protected need a stored
        // secret; an unprotected key saves no keychain entry at all.
        let stores_secret = match saved.auth {
            ConnectionAuth::Password => true,
            ConnectionAuth::Key {
                passphrase_protected,
                ..
            } => passphrase_protected,
        };
        if stores_secret
            && let Err(error) = credentials::set_secret(&saved.id, secret_kind, &secret).await
        {
            // Do not leave a saved row whose credentials failed to persist.
            let _ = state.connections.delete(&saved.id).await;
            return Err(error);
        }
        (saved, stores_secret)
    } else {
        (
            ConnectionProfile::from_input(
                Uuid::new_v4().to_string(),
                input,
                crate::domain::activity::unix_millis(),
            ),
            false,
        )
    };

    let transient = match &profile.auth {
        ConnectionAuth::Password => TransientSecret {
            password: Some(secret),
            passphrase: None,
        },
        ConnectionAuth::Key { .. } => TransientSecret {
            password: None,
            passphrase: (!secret.is_empty()).then_some(secret),
        },
    };

    let result = open_session(
        &app,
        &state,
        &profile,
        Uuid::new_v4().to_string(),
        Some(transient),
        save,
    )
    .await;

    // A failed save must not leave a half-configured profile behind. This also
    // keeps the host-key retry from duplicating the saved connection.
    if save && result.is_err() {
        if stores_secret {
            let _ = credentials::delete_secret(&profile.id, secret_kind).await;
        }
        let _ = state.connections.delete(&profile.id).await;
    }

    result
}

struct TransientSecret {
    password: Option<String>,
    passphrase: Option<String>,
}

async fn open_session(
    app: &AppHandle,
    state: &AppState,
    profile: &ConnectionProfile,
    session_id: String,
    transient: Option<TransientSecret>,
    mark_used: bool,
) -> Result<SessionInfo, AppError> {
    let started = Instant::now();
    emit_state(
        app,
        &session_id,
        &profile.id,
        SessionState::Connecting,
        None,
    );

    match connect_session(state, profile, transient).await {
        Ok((client, capabilities)) => {
            let info = SessionInfo {
                id: session_id.clone(),
                connection_id: profile.id.clone(),
                name: profile.name.clone(),
                protocol: profile.protocol,
                host: profile.host.clone(),
                port: profile.port,
                username: profile.username.clone(),
                initial_path: profile.initial_path.clone(),
                capabilities,
                connected_at: crate::domain::activity::unix_millis(),
                latency_ms: started.elapsed().as_millis() as f64,
            };
            state.sessions.insert(Arc::new(Session {
                info: info.clone(),
                client: tokio::sync::Mutex::new(client),
            }));
            if mark_used && let Err(error) = state.connections.mark_used(&profile.id).await {
                tracing::warn!(%error, "could not update connection last-used time");
            }
            emit_state(app, &session_id, &profile.id, SessionState::Connected, None);
            Ok(info)
        }
        Err(error) => {
            emit_state(
                app,
                &session_id,
                &profile.id,
                SessionState::Failed,
                Some(error.message.clone()),
            );
            Err(error)
        }
    }
}

async fn connect_session(
    state: &AppState,
    profile: &ConnectionProfile,
    transient: Option<TransientSecret>,
) -> Result<(Box<dyn RemoteFs>, crate::domain::fs::FsCapabilities), AppError> {
    let connection_id = &profile.id;

    let (password, passphrase) = match transient {
        Some(transient) => (transient.password, transient.passphrase),
        None => match &profile.auth {
            ConnectionAuth::Password => {
                let password = credentials::get_secret(connection_id, SecretKind::Password)
                    .await?
                    .ok_or_else(|| {
                        AppError::new(
                            ErrorCode::AuthFailed,
                            "No password is saved for this connection. Edit it to add one.",
                        )
                    })?;
                (Some(password), None)
            }
            ConnectionAuth::Key {
                passphrase_protected,
                ..
            } => {
                let passphrase =
                    credentials::get_secret(connection_id, SecretKind::Passphrase).await?;
                if *passphrase_protected && passphrase.is_none() {
                    return Err(AppError::new(
                        ErrorCode::AuthFailed,
                        "No key passphrase is saved for this connection. Edit it to add one.",
                    ));
                }
                (None, passphrase)
            }
        },
    };

    let mut client: Box<dyn RemoteFs> = match profile.protocol {
        crate::domain::connection::ConnectionProtocol::Sftp => Box::new(
            SftpRemote::connect(
                profile,
                SftpCredentials {
                    password,
                    passphrase,
                },
                state.known_hosts.list(),
            )
            .await?,
        ),
        _ => {
            let password = password.ok_or_else(|| {
                AppError::new(
                    ErrorCode::AuthFailed,
                    "No password is saved for this connection.",
                )
            })?;
            Box::new(FtpRemote::connect(profile, &password).await?)
        }
    };

    // Fail fast when the saved start folder no longer exists or is not a
    // folder, instead of opening a session that cannot browse anything.
    let start = client.stat(&profile.initial_path).await.map_err(|error| {
        if error.code == ErrorCode::NotFound {
            AppError::not_found(
                "The start folder does not exist on the server. Edit the connection to change it.",
            )
        } else {
            error
        }
    })?;
    if start.kind != EntryKind::Directory {
        return Err(AppError::invalid_input(
            "The start path is not a folder. Edit the connection to change it.",
        ));
    }

    let capabilities = client.capabilities();
    Ok((client, capabilities))
}

#[tauri::command]
#[specta::specta]
pub async fn session_disconnect(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), AppError> {
    let session = state
        .sessions
        .remove(&session_id)
        .ok_or_else(|| AppError::not_found("That session is no longer open."))?;

    let result = session.client.lock().await.disconnect().await;
    emit_state(
        &app,
        &session_id,
        &session.info.connection_id,
        SessionState::Disconnected,
        None,
    );
    result
}

#[tauri::command]
#[specta::specta]
pub fn sessions_list(state: State<'_, AppState>) -> Vec<SessionInfo> {
    state.sessions.list()
}
