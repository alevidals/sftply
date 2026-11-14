use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, State};
use tauri_plugin_opener::{open_path, reveal_item_in_dir};

use crate::app_state::AppState;
use crate::domain::fs::{FsEntry, FsScope, Listing};
use crate::domain::text::{MAX_TEXT_FILE_BYTES, TextFile, text_version};
use crate::domain::transfer::ConflictPolicy;
use crate::error::{AppError, ErrorCode};
use crate::fs::local;
use crate::fs::path::normalize_absolute;
use crate::fs::text;
use crate::protocol::RemoteFs;
use crate::session::{Session, report_operation_failure, run_operation};
use crate::transfer::{replace_remote_file, temp_remote_path};

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

fn operation_timeout(state: &AppState) -> Duration {
    Duration::from_secs(state.settings.get().operation_timeout_seconds.into())
}

#[tauri::command]
#[specta::specta]
pub async fn fs_list(
    app: AppHandle,
    state: State<'_, AppState>,
    scope: FsScope,
    path: String,
    show_hidden: bool,
) -> Result<Listing, AppError> {
    match &scope {
        FsScope::Local => local::list(&path, show_hidden).await,
        FsScope::Remote { .. } => {
            let session = remote_session(&state, &scope)?;
            let result = run_operation(&session, operation_timeout(&state), |client| {
                Box::pin(async move { client.list(&path).await })
            })
            .await;
            match result {
                Ok(mut listing) => {
                    if !show_hidden {
                        listing.entries.retain(|entry| !entry.hidden);
                    }
                    Ok(listing)
                }
                Err(error) => {
                    report_operation_failure(&app, &session, &error);
                    Err(error)
                }
            }
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn fs_stat(
    app: AppHandle,
    state: State<'_, AppState>,
    scope: FsScope,
    path: String,
) -> Result<FsEntry, AppError> {
    match &scope {
        FsScope::Local => local::stat(&path).await,
        FsScope::Remote { .. } => {
            let session = remote_session(&state, &scope)?;
            let result = run_operation(&session, operation_timeout(&state), |client| {
                Box::pin(async move { client.stat(&path).await })
            })
            .await;
            if let Err(error) = &result {
                report_operation_failure(&app, &session, error);
            }
            result
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn fs_mkdir(
    app: AppHandle,
    state: State<'_, AppState>,
    scope: FsScope,
    parent: String,
    name: String,
) -> Result<FsEntry, AppError> {
    match &scope {
        FsScope::Local => local::mkdir(&parent, &name).await,
        FsScope::Remote { .. } => {
            let session = remote_session(&state, &scope)?;
            let result = run_operation(&session, operation_timeout(&state), |client| {
                Box::pin(async move { client.mkdir(&parent, &name).await })
            })
            .await;
            if let Err(error) = &result {
                report_operation_failure(&app, &session, error);
            }
            result
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn fs_rename(
    app: AppHandle,
    state: State<'_, AppState>,
    scope: FsScope,
    path: String,
    new_name: String,
) -> Result<FsEntry, AppError> {
    match &scope {
        FsScope::Local => local::rename(&path, &new_name).await,
        FsScope::Remote { .. } => {
            let session = remote_session(&state, &scope)?;
            let result = run_operation(&session, operation_timeout(&state), |client| {
                Box::pin(async move { client.rename(&path, &new_name).await })
            })
            .await;
            if let Err(error) = &result {
                report_operation_failure(&app, &session, error);
            }
            result
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn fs_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    scope: FsScope,
    path: String,
    recursive: bool,
) -> Result<(), AppError> {
    match &scope {
        FsScope::Local => local::delete(&path, recursive).await,
        FsScope::Remote { .. } => {
            let session = remote_session(&state, &scope)?;
            let result = run_operation(&session, operation_timeout(&state), |client| {
                Box::pin(async move { client.delete(&path, recursive).await })
            })
            .await;
            if let Err(error) = &result {
                report_operation_failure(&app, &session, error);
            }
            result
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn fs_chmod(
    app: AppHandle,
    state: State<'_, AppState>,
    scope: FsScope,
    path: String,
    mode: u32,
) -> Result<(), AppError> {
    match &scope {
        FsScope::Local => local::chmod(&path, mode),
        FsScope::Remote { .. } => {
            let session = remote_session(&state, &scope)?;
            let result = run_operation(&session, operation_timeout(&state), |client| {
                Box::pin(async move { client.chmod(&path, mode).await })
            })
            .await;
            if let Err(error) = &result {
                report_operation_failure(&app, &session, error);
            }
            result
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn fs_read_text(
    app: AppHandle,
    state: State<'_, AppState>,
    scope: FsScope,
    path: String,
) -> Result<TextFile, AppError> {
    match &scope {
        FsScope::Local => local::read_text(&path).await,
        FsScope::Remote { .. } => {
            let session = remote_session(&state, &scope)?;
            let result = run_operation(&session, operation_timeout(&state), |client| {
                Box::pin(async move { read_remote_text(client, &path).await })
            })
            .await;
            if let Err(error) = &result {
                report_operation_failure(&app, &session, error);
            }
            result
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn fs_write_text(
    app: AppHandle,
    state: State<'_, AppState>,
    scope: FsScope,
    path: String,
    content: String,
    expected_version: Option<String>,
    force: bool,
) -> Result<TextFile, AppError> {
    match &scope {
        FsScope::Local => local::write_text(&path, &content, expected_version, force).await,
        FsScope::Remote { .. } => {
            let session = remote_session(&state, &scope)?;
            let result = run_operation(&session, operation_timeout(&state), |client| {
                Box::pin(async move {
                    write_remote_text(client, &path, &content, expected_version, force).await
                })
            })
            .await;
            if let Err(error) = &result {
                report_operation_failure(&app, &session, error);
            }
            result
        }
    }
}

async fn read_remote_text(
    client: &mut Box<dyn RemoteFs>,
    path: &str,
) -> Result<TextFile, AppError> {
    let entry = client.stat(path).await?;
    text::check_editable(&entry)?;

    let mut reader = client.open_read(path, 0).await?;
    let mut bytes = Vec::with_capacity((entry.size as u64).min(MAX_TEXT_FILE_BYTES) as usize);
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..read]);
        if bytes.len() as u64 > MAX_TEXT_FILE_BYTES {
            let _ = reader.finish().await;
            return Err(AppError::new(
                ErrorCode::InvalidInput,
                "This file is too large to edit as text.",
            ));
        }
    }
    reader.finish().await?;
    text::decode(bytes, &entry)
}

async fn write_remote_text(
    client: &mut Box<dyn RemoteFs>,
    path: &str,
    content: &str,
    expected_version: Option<String>,
    force: bool,
) -> Result<TextFile, AppError> {
    text::check_content_size(content)?;

    if !force && let Some(expected) = expected_version {
        match client.stat(path).await {
            Ok(current) => {
                if text_version(current.size, current.modified_at) != expected {
                    return Err(text::conflict_error());
                }
            }
            Err(error) if error.code == ErrorCode::NotFound => {
                return Err(text::conflict_error());
            }
            Err(error) => return Err(error),
        }
    }

    // Write a hidden sibling and rename it into place, matching the atomic
    // upload path: a failed save must never truncate the existing file.
    let id = uuid::Uuid::new_v4().simple().to_string();
    let temp = temp_remote_path(path, &id, "part")?;
    let mut writer = match client.open_write(&temp, 0).await {
        Ok(writer) => writer,
        Err(error) => {
            cleanup_remote_text(client, &temp).await;
            return Err(error);
        }
    };

    let bytes = content.as_bytes();
    let mut written = 0;
    while written < bytes.len() {
        match writer.write(&bytes[written..]).await {
            Ok(0) => {
                let _ = writer.abort().await;
                cleanup_remote_text(client, &temp).await;
                return Err(AppError::internal(
                    "Could not save the file.",
                    "the writer made no progress",
                ));
            }
            Ok(count) => written += count,
            Err(error) => {
                let _ = writer.abort().await;
                cleanup_remote_text(client, &temp).await;
                return Err(error);
            }
        }
    }

    if let Err(error) = writer.finish().await {
        cleanup_remote_text(client, &temp).await;
        return Err(error);
    }

    if let Err(error) =
        replace_remote_file(client, &temp, path, &id, ConflictPolicy::Overwrite).await
    {
        cleanup_remote_text(client, &temp).await;
        return Err(error);
    }

    let entry = client.stat(path).await?;
    Ok(TextFile {
        path: entry.path,
        content: content.to_string(),
        size: entry.size,
        modified_at: entry.modified_at,
        version: text_version(entry.size, entry.modified_at),
    })
}

async fn cleanup_remote_text(client: &mut Box<dyn RemoteFs>, path: &str) {
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        client.delete(path, false),
    )
    .await;
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
