use std::time::Duration;

use tauri::{AppHandle, State};

use crate::app_state::AppState;
use crate::config::connection_bundle;
use crate::credentials;
use crate::domain::connection::{ConnectionAuth, ConnectionInput, ConnectionProfile};
use crate::domain::credentials::{SecretKind, SecretStatus};
use crate::domain::host_key::KnownHost;
use crate::domain::session::SessionState;
use crate::error::{AppError, ErrorCode};

use serde::Serialize;
use specta::Type;

#[tauri::command]
#[specta::specta]
pub fn connections_list(state: State<'_, AppState>) -> Vec<ConnectionProfile> {
    state.connections.list()
}

#[tauri::command]
#[specta::specta]
pub async fn connection_create(
    state: State<'_, AppState>,
    input: ConnectionInput,
) -> Result<ConnectionProfile, AppError> {
    state.connections.create(input).await
}

#[tauri::command]
#[specta::specta]
pub async fn connection_update(
    state: State<'_, AppState>,
    id: String,
    input: ConnectionInput,
) -> Result<ConnectionProfile, AppError> {
    let updated = state.connections.update(&id, input).await?;

    // Switching to the agent means the saved password or key passphrase is no
    // longer used. Drop it instead of leaving a stale secret in the keychain.
    if matches!(updated.auth, ConnectionAuth::Agent)
        && let Err(error) = credentials::delete_all(&id).await
    {
        tracing::warn!(%error, "could not remove keychain entries after switching to the SSH agent");
    }

    Ok(updated)
}

#[tauri::command]
#[specta::specta]
pub async fn connection_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), AppError> {
    state.connections.delete(&id).await?;

    // A deleted connection cannot be reconnected, so close anything still open
    // on it instead of leaving a tab pointing at a profile that no longer exists.
    for session in state.sessions.for_connection(&id) {
        let session_id = session.info.id.clone();
        if state.sessions.remove(&session_id).is_none() {
            continue;
        }
        session.mark_unusable();
        let _ = tokio::time::timeout(Duration::from_secs(5), session.disconnect()).await;
        crate::session::emit_state(&app, &session_id, &id, SessionState::Disconnected, None);
    }

    // Bookmarks and recents are keyed by connection id. Drop them after the
    // metadata deletion succeeds, but do not fail the delete if this cleanup
    // cannot be saved.
    let mut settings = state.settings.get();
    let pruned_bookmarks = settings.remote_bookmarks.remove(&id).is_some();
    let pruned_recent = settings.recent_paths.remove(&id).is_some();
    if (pruned_bookmarks || pruned_recent)
        && let Err(error) = state.settings.update(settings).await
    {
        tracing::warn!(%error, "could not prune navigation data for a deleted connection");
    }

    // Remove credentials only after the metadata deletion succeeded, so a
    // failed save cannot orphan a live connection row. A keychain failure here
    // leaves an unreachable entry (the id is gone) but must not report the
    // deletion as failed.
    if let Err(error) = credentials::delete_all(&id).await {
        tracing::warn!(%error, "could not remove keychain entries for a deleted connection");
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn connection_duplicate(
    state: State<'_, AppState>,
    id: String,
) -> Result<ConnectionProfile, AppError> {
    state.connections.duplicate(&id).await
}

#[tauri::command]
#[specta::specta]
pub async fn connection_set_favorite(
    state: State<'_, AppState>,
    id: String,
    favorite: bool,
) -> Result<ConnectionProfile, AppError> {
    state.connections.set_favorite(&id, favorite).await
}

#[tauri::command]
#[specta::specta]
pub async fn connection_reorder(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<Vec<ConnectionProfile>, AppError> {
    state.connections.reorder(ids).await
}

#[tauri::command]
#[specta::specta]
pub async fn connection_secret_set(
    state: State<'_, AppState>,
    id: String,
    kind: SecretKind,
    secret: String,
) -> Result<(), AppError> {
    // Confirm the connection exists before creating keychain items for it.
    if state.connections.get(&id).is_none() {
        return Err(AppError::not_found("That connection no longer exists."));
    }
    credentials::set_secret(&id, kind, &secret).await
}

#[tauri::command]
#[specta::specta]
pub async fn connection_secret_delete(
    _state: State<'_, AppState>,
    id: String,
    kind: SecretKind,
) -> Result<(), AppError> {
    credentials::delete_secret(&id, kind).await
}

#[tauri::command]
#[specta::specta]
pub async fn connection_secret_status(
    state: State<'_, AppState>,
    id: String,
) -> Result<SecretStatus, AppError> {
    if state.connections.get(&id).is_none() {
        return Err(AppError::not_found("That connection no longer exists."));
    }
    credentials::status(&id).await
}

#[tauri::command]
#[specta::specta]
pub fn known_hosts_list(state: State<'_, AppState>) -> Vec<KnownHost> {
    state.known_hosts.list()
}

#[tauri::command]
#[specta::specta]
pub async fn known_host_trust(
    state: State<'_, AppState>,
    host: String,
    port: u16,
    key_type: String,
    fingerprint: String,
) -> Result<KnownHost, AppError> {
    let entry = KnownHost {
        host,
        port,
        key_type,
        fingerprint,
        added_at: crate::domain::activity::unix_millis(),
    };
    state.known_hosts.trust(entry).await
}

#[tauri::command]
#[specta::specta]
pub async fn known_host_remove(
    state: State<'_, AppState>,
    host: String,
    port: u16,
) -> Result<(), AppError> {
    state.known_hosts.remove(&host, port).await
}

/// Summary returned after writing a connections bundle.
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionExportSummary {
    pub path: String,
    pub count: u32,
}

/// Summary returned after reading a connections bundle.
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionImportSummary {
    pub imported: u32,
    pub skipped: u32,
    /// One line per skipped entry, already safe to show to the user.
    pub problems: Vec<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn connections_export(
    state: State<'_, AppState>,
    path: String,
) -> Result<ConnectionExportSummary, AppError> {
    let connections = state.connections.list();
    let target = path.clone();
    let count = tokio::task::spawn_blocking(move || {
        connection_bundle::export_to(std::path::Path::new(&target), &connections)
    })
    .await
    .map_err(|error| {
        AppError::new(ErrorCode::Internal, "Could not export your connections.")
            .with_detail(error.to_string())
    })??;

    Ok(ConnectionExportSummary { path, count })
}

#[tauri::command]
#[specta::specta]
pub async fn connections_import(
    state: State<'_, AppState>,
    path: String,
) -> Result<ConnectionImportSummary, AppError> {
    let target = path.clone();
    let parsed = tokio::task::spawn_blocking(move || {
        connection_bundle::parse(std::path::Path::new(&target))
    })
    .await
    .map_err(|error| {
        AppError::new(ErrorCode::Internal, "Could not import those connections.")
            .with_detail(error.to_string())
    })??;

    let (imported, skipped) = state.connections.insert_many(parsed.connections).await?;
    let mut problems = parsed.problems;
    problems.extend(skipped);

    Ok(ConnectionImportSummary {
        imported: imported.len() as u32,
        skipped: problems.len() as u32,
        problems,
    })
}

/// Result of a connection probe. Nothing is saved and no session is created.
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestResult {
    #[specta(type = specta_typescript::Number)]
    pub latency_ms: f64,
    pub entry_count: u32,
    /// Path that was listed, already normalized by the server adapter.
    pub path: String,
}

#[tauri::command]
#[specta::specta]
pub async fn connection_test(
    state: State<'_, AppState>,
    input: ConnectionInput,
    id: Option<String>,
    secret: Option<String>,
) -> Result<ConnectionTestResult, AppError> {
    use std::time::{Duration, Instant};

    use crate::domain::connection::ConnectionAuth;
    use crate::session::SessionCredentials;

    let input = input.normalized().map_err(AppError::invalid_input)?;
    let profile = ConnectionProfile::from_input(
        "probe".to_string(),
        input,
        crate::domain::activity::unix_millis(),
    );

    let credentials = match secret.filter(|value| !value.is_empty()) {
        Some(secret) => match &profile.auth {
            ConnectionAuth::Password => SessionCredentials::Password(secret),
            ConnectionAuth::Key { .. } => SessionCredentials::Key {
                passphrase: Some(secret),
            },
            ConnectionAuth::Agent => SessionCredentials::Agent,
        },
        None => match id {
            Some(id) => {
                let stored = state
                    .connections
                    .get(&id)
                    .ok_or_else(|| AppError::not_found("That connection no longer exists."))?;
                super::sessions::resolve_credentials(&stored).await?
            }
            // Anonymous FTP works without a secret; an unprotected key needs
            // no passphrase either.
            None => match &profile.auth {
                ConnectionAuth::Password => SessionCredentials::Password(String::new()),
                ConnectionAuth::Key { .. } => SessionCredentials::Key { passphrase: None },
                ConnectionAuth::Agent => SessionCredentials::Agent,
            },
        },
    };

    let timeout = Duration::from_secs(
        state
            .settings
            .get()
            .operation_timeout_seconds
            .max(15)
            .into(),
    );
    let trusted = state.known_hosts.list();

    let started = Instant::now();
    let mut client = tokio::time::timeout(
        timeout,
        crate::session::connect_client(&profile, &credentials, trusted),
    )
    .await
    .map_err(|_| {
        AppError::new(
            ErrorCode::Timeout,
            "The server did not answer in time. Check the host and firewall, then try again.",
        )
        .retryable()
    })??;
    let latency_ms = started.elapsed().as_millis() as f64;

    let listing = client.list(&profile.initial_path).await?;
    let _ = tokio::time::timeout(Duration::from_secs(3), client.disconnect()).await;

    Ok(ConnectionTestResult {
        latency_ms,
        entry_count: listing.entries.len() as u32,
        path: listing.path,
    })
}
