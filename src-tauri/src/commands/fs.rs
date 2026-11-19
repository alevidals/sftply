use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, State};
use tauri_plugin_opener::{open_path, reveal_item_in_dir};

use crate::app_state::AppState;
use crate::domain::fs::{EntryKind, FsEntry, FsScope, Listing};
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

/// List a remote folder and reject the "empty stream for a missing path" answer
/// some FTP servers give, so a bad path never looks like an empty folder.
async fn list_remote(client: &mut Box<dyn RemoteFs>, path: String) -> Result<Listing, AppError> {
    let listing = client.list(&path).await?;
    if listing.entries.is_empty() {
        let entry = client.stat(&listing.path).await?;
        if entry.kind != EntryKind::Directory {
            return Err(AppError::invalid_input("That path is not a folder."));
        }
    }
    Ok(listing)
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
                Box::pin(list_remote(client, path))
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

pub(crate) async fn delete_scope(
    app: &AppHandle,
    state: &AppState,
    scope: &FsScope,
    path: &str,
    recursive: bool,
) -> Result<(), AppError> {
    match scope {
        FsScope::Local => local::delete(path, recursive).await,
        FsScope::Remote { .. } => {
            let session = remote_session(state, scope)?;
            let path = path.to_string();
            let result = run_operation(&session, operation_timeout(state), |client| {
                Box::pin(async move { client.delete(&path, recursive).await })
            })
            .await;
            if let Err(error) = &result {
                report_operation_failure(app, &session, error);
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
    delete_scope(&app, &state, &scope, &path, recursive).await
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
pub async fn local_create_file(parent: String, name: String) -> Result<FsEntry, AppError> {
    local::create_file(&parent, &name).await
}

#[tauri::command]
#[specta::specta]
pub async fn local_open_editor(path: String) -> Result<(), AppError> {
    let path = normalize_absolute(&path)?;
    tauri::async_runtime::spawn_blocking(move || open_system_editor(&path))
        .await
        .map_err(|error| {
            AppError::internal(
                "Could not open the text editor.",
                format!("task failed: {error}"),
            )
        })?
}

fn open_system_editor(path: &std::path::Path) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .arg("-t")
            .arg(path)
            .status()
            .map_err(|error| {
                AppError::internal("Could not open the text editor.", error.to_string())
            })?;
        if !status.success() {
            return Err(AppError::internal(
                "Could not open the text editor.",
                format!("open exited with {status}"),
            ));
        }
        Ok(())
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("notepad")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|error| {
                AppError::internal("Could not open the text editor.", error.to_string())
            })
    }

    #[cfg(target_os = "linux")]
    {
        // Ask the desktop for the text/plain handler so an HTML file opens in
        // an editor rather than the browser, then fall back to xdg-open.
        let desktop = std::process::Command::new("xdg-mime")
            .args(["query", "default", "text/plain"])
            .output()
            .ok()
            .filter(|output| output.status.success())
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty());
        if let Some(desktop) = desktop {
            let launched = std::process::Command::new("gtk-launch")
                .arg(&desktop)
                .arg(path)
                .status()
                .map(|status| status.success())
                .unwrap_or(false);
            if launched {
                return Ok(());
            }
        }
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|error| {
                AppError::internal("Could not open the text editor.", error.to_string())
            })
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

#[cfg(test)]
mod tests {
    use async_trait::async_trait;

    use super::*;
    use crate::domain::fs::{FsCapabilities, FsEntry};

    struct FakeRemote {
        entries: Vec<FsEntry>,
        stat: Option<Result<FsEntry, AppError>>,
    }

    #[async_trait]
    impl RemoteFs for FakeRemote {
        async fn list(&mut self, path: &str) -> Result<Listing, AppError> {
            Ok(Listing {
                path: path.to_string(),
                parent: None,
                entries: self.entries.clone(),
                capabilities: FsCapabilities::local(),
                read_at: 0.0,
                warnings: Vec::new(),
            })
        }

        async fn stat(&mut self, _path: &str) -> Result<FsEntry, AppError> {
            self.stat
                .take()
                .expect("stat must only run for an empty listing")
        }

        async fn mkdir(&mut self, _parent: &str, _name: &str) -> Result<FsEntry, AppError> {
            unimplemented!("not used")
        }

        async fn rename(&mut self, _path: &str, _new_name: &str) -> Result<FsEntry, AppError> {
            unimplemented!("not used")
        }

        async fn delete(&mut self, _path: &str, _recursive: bool) -> Result<(), AppError> {
            unimplemented!("not used")
        }

        async fn chmod(&mut self, _path: &str, _mode: u32) -> Result<(), AppError> {
            unimplemented!("not used")
        }

        async fn open_read(
            &mut self,
            _path: &str,
            _offset: u64,
        ) -> Result<Box<dyn crate::fs::FileReader>, AppError> {
            unimplemented!("not used")
        }

        async fn open_write(
            &mut self,
            _path: &str,
            _offset: u64,
        ) -> Result<Box<dyn crate::fs::FileWriter>, AppError> {
            unimplemented!("not used")
        }

        async fn disconnect(&mut self) -> Result<(), AppError> {
            Ok(())
        }

        fn capabilities(&self) -> FsCapabilities {
            FsCapabilities::local()
        }
    }

    fn directory_entry(path: &str) -> FsEntry {
        FsEntry {
            name: "folder".to_string(),
            path: path.to_string(),
            kind: EntryKind::Directory,
            size: 0.0,
            modified_at: None,
            permissions: None,
            owner: None,
            group: None,
            link_target: None,
            hidden: false,
            metadata_complete: true,
        }
    }

    #[tokio::test]
    async fn empty_listing_of_a_missing_folder_is_an_error() {
        let mut client: Box<dyn RemoteFs> = Box::new(FakeRemote {
            entries: Vec::new(),
            stat: Some(Err(AppError::not_found("That remote item does not exist."))),
        });

        let error = list_remote(&mut client, "/missing".to_string())
            .await
            .expect_err("a missing folder must not look empty");
        assert_eq!(error.code, ErrorCode::NotFound);
    }

    #[tokio::test]
    async fn empty_listing_of_a_real_folder_is_allowed() {
        let mut client: Box<dyn RemoteFs> = Box::new(FakeRemote {
            entries: Vec::new(),
            stat: Some(Ok(directory_entry("/empty"))),
        });

        let listing = list_remote(&mut client, "/empty".to_string())
            .await
            .expect("an empty folder is still a folder");
        assert!(listing.entries.is_empty());
    }

    #[tokio::test]
    async fn non_empty_listings_skip_the_extra_stat() {
        let mut client: Box<dyn RemoteFs> = Box::new(FakeRemote {
            entries: vec![directory_entry("/full/folder")],
            stat: None,
        });

        let listing = list_remote(&mut client, "/full".to_string())
            .await
            .expect("non-empty listing");
        assert_eq!(listing.entries.len(), 1);
    }
}
