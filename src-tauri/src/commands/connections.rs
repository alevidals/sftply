use tauri::State;

use crate::app_state::AppState;
use crate::credentials;
use crate::domain::connection::{ConnectionInput, ConnectionProfile};
use crate::domain::credentials::{SecretKind, SecretStatus};
use crate::domain::host_key::KnownHost;
use crate::error::AppError;

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
    state.connections.update(&id, input).await
}

#[tauri::command]
#[specta::specta]
pub async fn connection_delete(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    state.connections.delete(&id).await?;
    // Remove credentials only after the metadata deletion succeeded, so a
    // failed save cannot orphan a live connection row.
    credentials::delete_all(&id).await
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
