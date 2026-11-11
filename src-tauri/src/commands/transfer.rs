use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, State};

use crate::app_state::AppState;
use crate::domain::fs::{EntryKind, FsEntry, FsScope};
use crate::domain::remote_path::{normalize_remote, remote_leaf};
use crate::domain::transfer::{ConflictPolicy, TransferConflict, TransferDirection, TransferItem};
use crate::error::{AppError, ErrorCode};
use crate::fs::local;
use crate::session::{Session, report_operation_failure, run_operation};
use crate::transfer::{RemoteAccess, TransferJob, spawn_transfer};

fn operation_timeout(state: &AppState) -> Duration {
    Duration::from_secs(state.settings.get().operation_timeout_seconds.into())
}

fn remote_session(state: &AppState, session_id: &str) -> Result<Arc<Session>, AppError> {
    state.sessions.get(session_id).ok_or_else(|| {
        AppError::new(
            ErrorCode::SessionNotReady,
            "That remote session is not connected. Reconnect and try again.",
        )
    })
}

fn remote_access(state: &AppState, session: &Session) -> RemoteAccess {
    RemoteAccess {
        profile: session.profile.clone(),
        credentials: session.credentials.clone(),
        trusted: state.known_hosts.list(),
    }
}

fn conflict(entry: FsEntry) -> TransferConflict {
    TransferConflict {
        target_path: entry.path,
        kind: entry.kind,
        size: entry.size,
        modified_at: entry.modified_at,
    }
}

fn local_path(path: &str) -> Result<String, AppError> {
    let path = crate::fs::path::normalize_absolute(path)?;
    path.to_str()
        .map(str::to_string)
        .ok_or_else(|| AppError::invalid_input("The path is not valid UTF-8."))
}

fn local_leaf(path: &str) -> Result<String, AppError> {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .ok_or_else(|| AppError::invalid_input("The file name is not valid UTF-8."))
}

#[tauri::command]
#[specta::specta]
pub async fn transfer_preflight(
    app: AppHandle,
    state: State<'_, AppState>,
    target: FsScope,
    target_path: String,
) -> Result<Option<TransferConflict>, AppError> {
    match target {
        FsScope::Local => match local::stat(&target_path).await {
            Ok(entry) => Ok(Some(conflict(entry))),
            Err(error) if error.code == ErrorCode::NotFound => Ok(None),
            Err(error) => Err(error),
        },
        FsScope::Remote { session_id } => {
            let session = remote_session(&state, &session_id)?;
            let path = normalize_remote(&target_path)?;
            let result = run_operation(&session, operation_timeout(&state), |client| {
                Box::pin(async move { client.stat(&path).await })
            })
            .await;
            match result {
                Ok(entry) => Ok(Some(conflict(entry))),
                Err(error) if error.code == ErrorCode::NotFound => Ok(None),
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
pub async fn transfer_enqueue(
    app: AppHandle,
    state: State<'_, AppState>,
    source: FsScope,
    source_path: String,
    target: FsScope,
    target_path: String,
    policy: ConflictPolicy,
) -> Result<TransferItem, AppError> {
    let (
        direction,
        source_remote,
        target_remote,
        source_label,
        target_label,
        name,
        size,
        source_path,
        target_path,
    ) = match (&source, &target) {
        (FsScope::Local, FsScope::Remote { session_id }) => {
            let source_path = local_path(&source_path)?;
            let target_path = normalize_remote(&target_path)?;
            let name = local_leaf(&source_path)?;
            let entry = local::stat(&source_path).await?;
            validate_source(&entry)?;
            let session = remote_session(&state, session_id)?;
            (
                TransferDirection::Upload,
                None,
                Some(remote_access(&state, &session)),
                "Local".to_string(),
                session.info.name.clone(),
                name,
                entry.size,
                source_path,
                target_path,
            )
        }
        (FsScope::Remote { session_id }, FsScope::Local) => {
            let source_path = normalize_remote(&source_path)?;
            let target_path = local_path(&target_path)?;
            let name = remote_leaf(&source_path)?;
            let session = remote_session(&state, session_id)?;
            let stat_path = source_path.clone();
            let result = run_operation(&session, operation_timeout(&state), |client| {
                Box::pin(async move { client.stat(&stat_path).await })
            })
            .await;
            let entry = match result {
                Ok(entry) => entry,
                Err(error) => {
                    report_operation_failure(&app, &session, &error);
                    return Err(error);
                }
            };
            validate_source(&entry)?;
            (
                TransferDirection::Download,
                Some(remote_access(&state, &session)),
                None,
                session.info.name.clone(),
                "Local".to_string(),
                name,
                entry.size,
                source_path,
                target_path,
            )
        }
        _ => {
            return Err(AppError::new(
                ErrorCode::Unsupported,
                "Transfers must be between the local filesystem and one remote session.",
            ));
        }
    };

    let item = TransferItem::new(
        direction,
        source_path,
        target_path,
        source_label,
        target_label,
        name,
        size,
    );
    let job = TransferJob {
        item: item.clone(),
        source_remote,
        target_remote,
        policy,
    };

    state.transfers.insert(item.clone());
    crate::transfer::emit_delta(&app, vec![item.clone()], Vec::new());
    spawn_transfer(app, state.transfers.clone(), job);
    Ok(item)
}

fn validate_source(entry: &FsEntry) -> Result<(), AppError> {
    match entry.kind {
        EntryKind::File => Ok(()),
        EntryKind::Directory => Err(AppError::new(
            ErrorCode::Unsupported,
            "Folder transfers are not available yet. Select individual files.",
        )),
        EntryKind::Symlink | EntryKind::Other => Err(AppError::new(
            ErrorCode::Unsupported,
            "Symlink and special-file transfers are not available yet.",
        )),
    }
}

#[tauri::command]
#[specta::specta]
pub fn transfers_list(state: State<'_, AppState>) -> Vec<TransferItem> {
    state.transfers.list()
}

#[tauri::command]
#[specta::specta]
pub fn transfer_cancel(state: State<'_, AppState>, id: String) -> bool {
    state.transfers.cancel(&id)
}

#[tauri::command]
#[specta::specta]
pub fn transfer_clear_finished(app: AppHandle, state: State<'_, AppState>) -> u32 {
    state.transfers.clear_finished(&app).len() as u32
}
