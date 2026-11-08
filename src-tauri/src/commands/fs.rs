use std::sync::Arc;

use tauri::State;
use tauri_plugin_opener::{open_path, reveal_item_in_dir};

use crate::app_state::AppState;
use crate::domain::fs::{FsEntry, FsScope, Listing};
use crate::error::{AppError, ErrorCode};
use crate::fs::local;
use crate::fs::path::normalize_absolute;
use crate::session::Session;

fn remote_session(state: &AppState, scope: &FsScope) -> Result<Arc<Session>, AppError> {
    match scope {
        FsScope::Local => Err(AppError::internal(
            "A local scope was passed to the remote resolver.",
            "scope routing error",
        )),
        FsScope::Remote { session_id } => state.sessions.get(session_id).ok_or_else(|| {
            AppError::new(
                ErrorCode::SessionNotReady,
                "That remote session is not connected. Reconnect and try again.",
            )
        }),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn fs_list(
    state: State<'_, AppState>,
    scope: FsScope,
    path: String,
    show_hidden: bool,
) -> Result<Listing, AppError> {
    match &scope {
        FsScope::Local => local::list(&path, show_hidden).await,
        FsScope::Remote { .. } => {
            let session = remote_session(&state, &scope)?;
            let mut listing = session.client.lock().await.list(&path).await?;
            if !show_hidden {
                listing.entries.retain(|entry| !entry.hidden);
            }
            Ok(listing)
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn fs_stat(
    state: State<'_, AppState>,
    scope: FsScope,
    path: String,
) -> Result<FsEntry, AppError> {
    match &scope {
        FsScope::Local => local::stat(&path).await,
        FsScope::Remote { .. } => {
            let session = remote_session(&state, &scope)?;
            session.client.lock().await.stat(&path).await
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn fs_mkdir(
    state: State<'_, AppState>,
    scope: FsScope,
    parent: String,
    name: String,
) -> Result<FsEntry, AppError> {
    match &scope {
        FsScope::Local => local::mkdir(&parent, &name).await,
        FsScope::Remote { .. } => {
            let session = remote_session(&state, &scope)?;
            session.client.lock().await.mkdir(&parent, &name).await
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn fs_rename(
    state: State<'_, AppState>,
    scope: FsScope,
    path: String,
    new_name: String,
) -> Result<FsEntry, AppError> {
    match &scope {
        FsScope::Local => local::rename(&path, &new_name).await,
        FsScope::Remote { .. } => {
            let session = remote_session(&state, &scope)?;
            session.client.lock().await.rename(&path, &new_name).await
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn fs_delete(
    state: State<'_, AppState>,
    scope: FsScope,
    path: String,
    recursive: bool,
) -> Result<(), AppError> {
    match &scope {
        FsScope::Local => local::delete(&path, recursive).await,
        FsScope::Remote { .. } => {
            let session = remote_session(&state, &scope)?;
            session.client.lock().await.delete(&path, recursive).await
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn fs_chmod(
    state: State<'_, AppState>,
    scope: FsScope,
    path: String,
    mode: u32,
) -> Result<(), AppError> {
    match &scope {
        FsScope::Local => local::chmod(&path, mode),
        FsScope::Remote { .. } => {
            let session = remote_session(&state, &scope)?;
            session.client.lock().await.chmod(&path, mode).await
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn local_open(path: String) -> Result<(), AppError> {
    let path = normalize_absolute(&path)?;
    tauri::async_runtime::spawn_blocking(move || open_path(&path, None::<&str>))
        .await
        .map_err(|error| {
            AppError::internal("Could not open the item.", format!("task failed: {error}"))
        })?
        .map_err(|error| {
            AppError::new(ErrorCode::Internal, "Could not open the item.")
                .with_detail(error.to_string())
        })
}

#[tauri::command]
#[specta::specta]
pub async fn local_reveal(path: String) -> Result<(), AppError> {
    let path = normalize_absolute(&path)?;
    tauri::async_runtime::spawn_blocking(move || reveal_item_in_dir(&path))
        .await
        .map_err(|error| {
            AppError::internal(
                "Could not reveal the item.",
                format!("task failed: {error}"),
            )
        })?
        .map_err(|error| {
            AppError::new(ErrorCode::Internal, "Could not reveal the item.")
                .with_detail(error.to_string())
        })
}
