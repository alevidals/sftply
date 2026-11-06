use tauri_plugin_opener::{open_path, reveal_item_in_dir};

use crate::domain::fs::{FsEntry, FsScope, Listing};
use crate::error::{AppError, ErrorCode};
use crate::fs::local;
use crate::fs::path::normalize_absolute;

fn local_scope(scope: &FsScope) -> Result<(), AppError> {
    match scope {
        FsScope::Local => Ok(()),
        FsScope::Remote { .. } => Err(AppError::new(
            ErrorCode::Unsupported,
            "Remote sessions are not available in this build.",
        )),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn fs_list(scope: FsScope, path: String, show_hidden: bool) -> Result<Listing, AppError> {
    local_scope(&scope)?;
    local::list(&path, show_hidden).await
}

#[tauri::command]
#[specta::specta]
pub async fn fs_stat(scope: FsScope, path: String) -> Result<FsEntry, AppError> {
    local_scope(&scope)?;
    local::stat(&path).await
}

#[tauri::command]
#[specta::specta]
pub async fn fs_mkdir(scope: FsScope, parent: String, name: String) -> Result<FsEntry, AppError> {
    local_scope(&scope)?;
    local::mkdir(&parent, &name).await
}

#[tauri::command]
#[specta::specta]
pub async fn fs_rename(
    scope: FsScope,
    path: String,
    new_name: String,
) -> Result<FsEntry, AppError> {
    local_scope(&scope)?;
    local::rename(&path, &new_name).await
}

#[tauri::command]
#[specta::specta]
pub async fn fs_delete(scope: FsScope, path: String, recursive: bool) -> Result<(), AppError> {
    local_scope(&scope)?;
    local::delete(&path, recursive).await
}

#[tauri::command]
#[specta::specta]
pub async fn fs_chmod(scope: FsScope, path: String, mode: u32) -> Result<(), AppError> {
    local_scope(&scope)?;
    local::chmod(&path, mode)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_remote_scopes_honestly() {
        let error = local_scope(&FsScope::Remote {
            session_id: "test".into(),
        })
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Unsupported);
    }

    #[test]
    fn accepts_local_scope() {
        assert!(local_scope(&FsScope::Local).is_ok());
    }
}
