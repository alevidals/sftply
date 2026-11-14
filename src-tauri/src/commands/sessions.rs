use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::app_state::AppState;
use crate::credentials;
use crate::domain::connection::{ConnectionAuth, ConnectionInput, ConnectionProfile};
use crate::domain::credentials::SecretKind;
use crate::domain::fs::{EntryKind, FsCapabilities};
use crate::domain::session::{SessionInfo, SessionState};
use crate::error::{AppError, ErrorCode};
use crate::protocol::RemoteFs;
use crate::session::{Session, SessionCredentials, connect_client, emit_state, timeout_error};

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
/// stays in Rust memory for the lifetime of the session so reconnect works.
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
            ConnectionAuth::Password => !secret.is_empty(),
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
        ConnectionAuth::Password => SessionCredentials::Password(secret),
        ConnectionAuth::Key { .. } => SessionCredentials::Key {
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

/// Reconnect an existing session in place. The session id and profile are
/// preserved so open browser state, tabs and query keys stay valid.
#[tauri::command]
#[specta::specta]
pub async fn session_reconnect(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<SessionInfo, AppError> {
    let existing = state
        .sessions
        .get(&session_id)
        .ok_or_else(|| AppError::not_found("That session is no longer open."))?;

    let started = Instant::now();
    emit_state(
        &app,
        &session_id,
        &existing.info.connection_id,
        SessionState::Connecting,
        None,
    );

    // Stop any in-flight operation and close the old stream before opening a
    // new one. A wedged server must not block reconnect forever. Marking the
    // session unusable also rejects operations that were already queued.
    existing.mark_unusable();
    existing.retire().await;

    let timeout = Duration::from_secs(state.settings.get().connect_timeout_seconds.into());
    let result = tokio::time::timeout(
        timeout,
        establish(&state, &existing.profile, &existing.credentials),
    )
    .await;

    match result {
        Ok(Ok((client, capabilities))) => {
            let info = SessionInfo {
                id: session_id.clone(),
                connection_id: existing.profile.id.clone(),
                name: existing.profile.name.clone(),
                protocol: existing.profile.protocol,
                host: existing.profile.host.clone(),
                port: existing.profile.port,
                username: existing.profile.username.clone(),
                initial_path: existing.profile.initial_path.clone(),
                capabilities,
                connected_at: crate::domain::activity::unix_millis(),
                latency_ms: started.elapsed().as_millis() as f64,
                usable: true,
            };
            state.sessions.insert(Arc::new(Session::new(
                info.clone(),
                existing.profile.clone(),
                existing.credentials.clone(),
                client,
            )));
            emit_state(
                &app,
                &session_id,
                &info.connection_id,
                SessionState::Connected,
                None,
            );
            Ok(info)
        }
        Ok(Err(error)) => {
            existing.mark_unusable();
            emit_state(
                &app,
                &session_id,
                &existing.info.connection_id,
                SessionState::Failed,
                Some(error.message.clone()),
            );
            Err(error)
        }
        Err(_) => {
            existing.mark_unusable();
            let error = timeout_error();
            emit_state(
                &app,
                &session_id,
                &existing.info.connection_id,
                SessionState::Failed,
                Some(error.message.clone()),
            );
            Err(error)
        }
    }
}

async fn open_session(
    app: &AppHandle,
    state: &AppState,
    profile: &ConnectionProfile,
    session_id: String,
    transient: Option<SessionCredentials>,
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

    let credentials = match transient {
        Some(credentials) => credentials,
        None => match resolve_credentials(profile).await {
            Ok(credentials) => credentials,
            Err(error) => {
                emit_state(
                    app,
                    &session_id,
                    &profile.id,
                    SessionState::Failed,
                    Some(error.message.clone()),
                );
                return Err(error);
            }
        },
    };

    let timeout = Duration::from_secs(state.settings.get().connect_timeout_seconds.into());
    let result = tokio::time::timeout(timeout, establish(state, profile, &credentials)).await;

    match result {
        Ok(Ok((client, capabilities))) => {
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
                usable: true,
            };
            state.sessions.insert(Arc::new(Session::new(
                info.clone(),
                profile.clone(),
                credentials,
                client,
            )));
            if mark_used && let Err(error) = state.connections.mark_used(&profile.id).await {
                tracing::warn!(%error, "could not update connection last-used time");
            }
            tracing::info!(
                session = %session_id,
                protocol = ?profile.protocol,
                host = %profile.host,
                port = profile.port,
                latency_ms = info.latency_ms,
                "session connected"
            );
            emit_state(app, &session_id, &profile.id, SessionState::Connected, None);
            Ok(info)
        }
        Ok(Err(error)) => {
            tracing::warn!(
                session = %session_id,
                protocol = ?profile.protocol,
                host = %profile.host,
                port = profile.port,
                code = ?error.code,
                message = %error.message,
                detail = ?error.detail,
                "session connection failed"
            );
            emit_state(
                app,
                &session_id,
                &profile.id,
                SessionState::Failed,
                Some(error.message.clone()),
            );
            Err(error)
        }
        Err(_) => {
            let error = timeout_error();
            tracing::warn!(
                session = %session_id,
                protocol = ?profile.protocol,
                host = %profile.host,
                port = profile.port,
                "session connection timed out"
            );
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

/// Read the credentials for a saved connection from the OS keychain.
pub(crate) async fn resolve_credentials(
    profile: &ConnectionProfile,
) -> Result<SessionCredentials, AppError> {
    match &profile.auth {
        ConnectionAuth::Password => {
            let password = credentials::get_secret(&profile.id, SecretKind::Password).await?;
            match password {
                Some(password) => Ok(SessionCredentials::Password(password)),
                // Anonymous FTP has no secret. The profile stores the
                // conventional "anonymous" username, so reconnect works
                // without a keychain entry.
                // Anonymous FTP has no secret, and some FTP servers accept any
                // user with an empty password. Let the server decide instead of
                // blocking the connect; SFTP still needs a real credential.
                None if profile.username.eq_ignore_ascii_case("anonymous")
                    || profile.protocol != crate::domain::connection::ConnectionProtocol::Sftp =>
                {
                    Ok(SessionCredentials::Password(String::new()))
                }
                None => Err(AppError::new(
                    ErrorCode::AuthFailed,
                    "No password is saved for this connection. Edit it to add one.",
                )),
            }
        }
        ConnectionAuth::Key {
            passphrase_protected,
            ..
        } => {
            let passphrase = credentials::get_secret(&profile.id, SecretKind::Passphrase).await?;
            if *passphrase_protected && passphrase.is_none() {
                return Err(AppError::new(
                    ErrorCode::AuthFailed,
                    "No key passphrase is saved for this connection. Edit it to add one.",
                ));
            }
            Ok(SessionCredentials::Key { passphrase })
        }
    }
}

async fn establish(
    state: &AppState,
    profile: &ConnectionProfile,
    credentials: &SessionCredentials,
) -> Result<(Box<dyn RemoteFs>, FsCapabilities), AppError> {
    let mut client = connect_client(profile, credentials, state.known_hosts.list()).await?;

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

    // Reject operations that were queued before the session was removed.
    session.mark_unusable();

    // The session is already removed, so a wedged stream must not keep the UI
    // waiting. The socket is closed when the session is dropped either way.
    let result = tokio::time::timeout(Duration::from_secs(5), session.disconnect()).await;
    emit_state(
        &app,
        &session_id,
        &session.info.connection_id,
        SessionState::Disconnected,
        None,
    );
    match result {
        Ok(result) => result,
        Err(_) => Ok(()),
    }
}

/// Cancel the remote operation currently running on a session, if any.
#[tauri::command]
#[specta::specta]
pub fn session_cancel(state: State<'_, AppState>, session_id: String) -> Result<bool, AppError> {
    let session = state
        .sessions
        .get(&session_id)
        .ok_or_else(|| AppError::not_found("That session is no longer open."))?;
    Ok(session.cancel_current())
}

#[tauri::command]
#[specta::specta]
pub fn sessions_list(state: State<'_, AppState>) -> Vec<SessionInfo> {
    state.sessions.list()
}
