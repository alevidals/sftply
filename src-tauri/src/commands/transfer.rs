use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};
use tokio_util::sync::CancellationToken;

use crate::app_state::AppState;
use crate::domain::fs::{EntryKind, FsEntry, FsScope};
use crate::domain::remote_path::{join_remote, normalize_remote, remote_leaf};
use crate::domain::transfer::{
    ConflictPolicy, TransferConflict, TransferDirection, TransferItem, TransferPlan,
    TransferPlanEntry,
};
use crate::error::{AppError, ErrorCode};
use crate::fs::local;
use crate::session::{Session, report_operation_failure, run_operation};
use crate::transfer::history::TransferHistoryEntry;
use crate::transfer::{RemoteAccess, TransferJob, ensure_remote_dir, spawn_transfer};

/// Guard against accidentally walking an enormous tree. The user can still
/// transfer large folders, but the plan is bounded so the UI cannot freeze.
const MAX_PLAN_ENTRIES: usize = 50_000;
const MAX_PLAN_DEPTH: usize = 64;

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

pub(crate) fn normalize_scope_path(scope: &FsScope, path: &str) -> Result<String, AppError> {
    match scope {
        FsScope::Local => local_path(path),
        FsScope::Remote { .. } => normalize_remote(path),
    }
}

fn scope_leaf(scope: &FsScope, path: &str) -> Result<String, AppError> {
    match scope {
        FsScope::Local => local_leaf(path),
        FsScope::Remote { .. } => remote_leaf(path),
    }
}

pub(crate) fn join_scope_path(
    scope: &FsScope,
    parent: &str,
    name: &str,
) -> Result<String, AppError> {
    match scope {
        FsScope::Local => {
            let parent = crate::fs::path::normalize_absolute(parent)?;
            let joined = crate::fs::path::join_child(&parent, name)?;
            joined
                .to_str()
                .map(str::to_string)
                .ok_or_else(|| AppError::invalid_input("The path is not valid UTF-8."))
        }
        FsScope::Remote { .. } => join_remote(parent, name),
    }
}

fn transfer_direction(source: &FsScope, target: &FsScope) -> Result<TransferDirection, AppError> {
    match (source, target) {
        (FsScope::Local, FsScope::Remote { .. }) => Ok(TransferDirection::Upload),
        (FsScope::Remote { .. }, FsScope::Local) => Ok(TransferDirection::Download),
        _ => Err(AppError::new(
            ErrorCode::Unsupported,
            "Transfers must be between the local filesystem and one remote session.",
        )),
    }
}

pub(crate) async fn scope_stat(
    app: &AppHandle,
    state: &AppState,
    scope: &FsScope,
    path: &str,
) -> Result<FsEntry, AppError> {
    match scope {
        FsScope::Local => local::stat(path).await,
        FsScope::Remote { session_id } => {
            let session = remote_session(state, session_id)?;
            let path = normalize_remote(path)?;
            let result = run_operation(&session, operation_timeout(state), |client| {
                Box::pin(async move { client.stat(&path).await })
            })
            .await;
            if let Err(error) = &result {
                report_operation_failure(app, &session, error);
            }
            result
        }
    }
}

pub(crate) async fn scope_list(
    app: &AppHandle,
    state: &AppState,
    scope: &FsScope,
    path: &str,
) -> Result<crate::domain::fs::Listing, AppError> {
    match scope {
        FsScope::Local => local::list(path, true).await,
        FsScope::Remote { session_id } => {
            let session = remote_session(state, session_id)?;
            let path = normalize_remote(path)?;
            let result = run_operation(&session, operation_timeout(state), |client| {
                Box::pin(async move { client.list(&path).await })
            })
            .await;
            if let Err(error) = &result {
                report_operation_failure(app, &session, error);
            }
            result
        }
    }
}

/// Hash a file through the same scope abstraction as listings. The comparison
/// only calls this for small files, so reading the whole local file is bounded.
pub(crate) async fn scope_hash(
    app: &AppHandle,
    state: &AppState,
    scope: &FsScope,
    path: &str,
    max_bytes: u64,
    token: &CancellationToken,
) -> Result<Vec<u8>, AppError> {
    if token.is_cancelled() {
        return Err(cancelled());
    }
    match scope {
        FsScope::Local => hash_local(path, max_bytes).await,
        FsScope::Remote { session_id } => {
            let session = remote_session(state, session_id)?;
            let path = normalize_remote(path)?;
            let cancellation = token.clone();
            let result = run_operation(&session, operation_timeout(state), |client| {
                Box::pin(async move {
                    let mut reader = client.open_read(&path, 0).await?;
                    let mut hasher = Sha256::new();
                    let mut buffer = vec![0u8; 64 * 1024];
                    let mut total = 0u64;
                    loop {
                        let read = tokio::select! {
                            _ = cancellation.cancelled() => return Err(cancelled()),
                            result = reader.read(&mut buffer) => result?,
                        };
                        if read == 0 {
                            break;
                        }
                        total += read as u64;
                        if total > max_bytes {
                            return Err(AppError::new(
                                ErrorCode::Unsupported,
                                "The file is too large to verify by content.",
                            ));
                        }
                        hasher.update(&buffer[..read]);
                    }
                    reader.finish().await?;
                    Ok(hasher.finalize().to_vec())
                })
            })
            .await;
            if let Err(error) = &result
                && error.code != ErrorCode::Unsupported
                && error.code != ErrorCode::NotFound
                && error.code != ErrorCode::Cancelled
            {
                report_operation_failure(app, &session, error);
            }
            result
        }
    }
}

fn cancelled() -> AppError {
    AppError::new(ErrorCode::Cancelled, "The comparison was cancelled.")
}

async fn hash_local(path: &str, max_bytes: u64) -> Result<Vec<u8>, AppError> {
    let path = local_path(path)?;
    let metadata = tokio::fs::metadata(&path).await.map_err(AppError::from)?;
    if metadata.len() > max_bytes {
        return Err(AppError::new(
            ErrorCode::Unsupported,
            "The file is too large to verify by content.",
        ));
    }
    let bytes = tokio::fs::read(&path).await.map_err(AppError::from)?;
    if bytes.len() as u64 > max_bytes {
        return Err(AppError::new(
            ErrorCode::Unsupported,
            "The file is too large to verify by content.",
        ));
    }
    Ok(Sha256::digest(&bytes).to_vec())
}

async fn probe_conflict(
    app: &AppHandle,
    state: &AppState,
    target: &FsScope,
    target_path: &str,
) -> Result<Option<TransferConflict>, AppError> {
    match scope_stat(app, state, target, target_path).await {
        Ok(entry) => Ok(Some(conflict(entry))),
        Err(error) if error.code == ErrorCode::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

struct PlanWalker<'a> {
    app: &'a AppHandle,
    state: &'a AppState,
    source: &'a FsScope,
    target: &'a FsScope,
}

impl PlanWalker<'_> {
    /// Walk one selected item and append every file and folder to the plan. The
    /// target keeps the source root's leaf name, matching the usual "copy this
    /// folder into that folder" behaviour.
    async fn walk(
        &self,
        source_path: &str,
        target_path: &str,
        relative_path: &str,
        depth: usize,
        plan: &mut TransferPlan,
    ) -> Result<(), AppError> {
        if depth > MAX_PLAN_DEPTH {
            return Err(AppError::new(
                ErrorCode::Unsupported,
                "That folder is nested too deeply to transfer.",
            ));
        }
        if plan.entries.len() >= MAX_PLAN_ENTRIES {
            return Err(AppError::new(
                ErrorCode::Unsupported,
                "That selection contains too many items. Transfer a smaller folder.",
            ));
        }

        let entry = scope_stat(self.app, self.state, self.source, source_path).await?;
        match entry.kind {
            EntryKind::File => {
                let conflict =
                    probe_conflict(self.app, self.state, self.target, target_path).await?;
                plan.total_bytes += entry.size;
                plan.entries.push(TransferPlanEntry {
                    source_path: entry.path,
                    target_path: target_path.to_string(),
                    relative_path: relative_path.to_string(),
                    kind: EntryKind::File,
                    size: entry.size,
                    conflict,
                });
            }
            EntryKind::Directory => {
                plan.entries.push(TransferPlanEntry {
                    source_path: entry.path.clone(),
                    target_path: target_path.to_string(),
                    relative_path: relative_path.to_string(),
                    kind: EntryKind::Directory,
                    size: 0.0,
                    conflict: None,
                });

                let listing = scope_list(self.app, self.state, self.source, &entry.path).await?;
                for child in listing.entries {
                    if plan.entries.len() >= MAX_PLAN_ENTRIES {
                        return Err(AppError::new(
                            ErrorCode::Unsupported,
                            "That selection contains too many items. Transfer a smaller folder.",
                        ));
                    }
                    let child_target = join_scope_path(self.target, target_path, &child.name)?;
                    let child_relative = if relative_path.is_empty() {
                        child.name.clone()
                    } else {
                        format!("{relative_path}/{}", child.name)
                    };
                    Box::pin(self.walk(
                        &child.path,
                        &child_target,
                        &child_relative,
                        depth + 1,
                        plan,
                    ))
                    .await?;
                }
            }
            EntryKind::Symlink | EntryKind::Other => {
                plan.skipped += 1;
            }
        }
        Ok(())
    }
}

#[tauri::command]
#[specta::specta]
pub async fn transfer_plan(
    app: AppHandle,
    state: State<'_, AppState>,
    source: FsScope,
    source_paths: Vec<String>,
    target: FsScope,
    target_path: String,
) -> Result<TransferPlan, AppError> {
    transfer_direction(&source, &target)?;
    if source_paths.is_empty() {
        return Err(AppError::invalid_input(
            "Select at least one item to transfer.",
        ));
    }

    let target_root = normalize_scope_path(&target, &target_path)?;
    let mut plan = TransferPlan {
        entries: Vec::new(),
        skipped: 0,
        total_bytes: 0.0,
    };
    let walker = PlanWalker {
        app: &app,
        state: &state,
        source: &source,
        target: &target,
    };

    for raw in source_paths {
        let source_root = normalize_scope_path(&source, &raw)?;
        let leaf = scope_leaf(&source, &source_root)?;
        let target_root_entry = join_scope_path(&target, &target_root, &leaf)?;
        Box::pin(walker.walk(&source_root, &target_root_entry, "", 0, &mut plan)).await?;
    }

    Ok(plan)
}

/// Recreate every planned folder before files start. Uploads use one dedicated
/// remote connection, so the browsing session is never blocked.
async fn create_plan_dirs(
    state: &AppState,
    target: &FsScope,
    entries: &[TransferPlanEntry],
) -> Result<(), AppError> {
    let directories: Vec<&TransferPlanEntry> = entries
        .iter()
        .filter(|entry| entry.kind == EntryKind::Directory)
        .collect();
    if directories.is_empty() {
        return Ok(());
    }

    match target {
        FsScope::Local => {
            for entry in directories {
                tokio::fs::create_dir_all(&entry.target_path)
                    .await
                    .map_err(|error| {
                        AppError::new(
                            ErrorCode::PermissionDenied,
                            "Could not create a destination folder.",
                        )
                        .with_detail(format!("create {}: {error}", entry.target_path))
                    })?;
            }
            Ok(())
        }
        FsScope::Remote { session_id } => {
            let session = remote_session(state, session_id)?;
            let access = remote_access(state, &session);
            let mut client = crate::session::connect_client(
                &access.profile,
                &access.credentials,
                access.trusted,
            )
            .await?;
            let result = async {
                for entry in directories {
                    ensure_remote_dir(&mut client, &entry.target_path).await?;
                }
                Ok(())
            }
            .await;
            let _ = client.disconnect().await;
            result
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn transfer_enqueue_tree(
    app: AppHandle,
    state: State<'_, AppState>,
    source: FsScope,
    target: FsScope,
    policy: ConflictPolicy,
    entries: Vec<TransferPlanEntry>,
    skip_targets: Vec<String>,
) -> Result<Vec<TransferItem>, AppError> {
    let direction = transfer_direction(&source, &target)?;
    if entries.is_empty() {
        return Ok(Vec::new());
    }

    let remote = match direction {
        TransferDirection::Upload => &target,
        TransferDirection::Download => &source,
    };
    let session = match remote {
        FsScope::Remote { session_id } => remote_session(&state, session_id)?,
        FsScope::Local => unreachable!("the remote side is always a session"),
    };

    let (source_label, target_label) = match direction {
        TransferDirection::Upload => ("Local".to_string(), session.info.name.clone()),
        TransferDirection::Download => (session.info.name.clone(), "Local".to_string()),
    };
    let access = remote_access(&state, &session);
    let (source_remote, target_remote) = match direction {
        TransferDirection::Upload => (None, Some(access)),
        TransferDirection::Download => (Some(access), None),
    };

    create_plan_dirs(&state, &target, &entries).await?;

    let skip: HashSet<&str> = skip_targets.iter().map(String::as_str).collect();
    let mut items = Vec::new();
    for entry in entries {
        if entry.kind != EntryKind::File || skip.contains(entry.target_path.as_str()) {
            continue;
        }
        let name = if entry.relative_path.is_empty() {
            scope_leaf(&source, &entry.source_path)?
        } else {
            entry.relative_path.clone()
        };
        let item = TransferItem::new(
            direction,
            entry.source_path,
            entry.target_path,
            source_label.clone(),
            target_label.clone(),
            name,
            entry.size,
        );
        let job = TransferJob {
            item: item.clone(),
            source_remote: source_remote.clone(),
            target_remote: target_remote.clone(),
            policy,
        };
        state.transfers.insert(item.clone());
        state.transfers.remember_job(job.clone());
        crate::transfer::emit_delta(&app, vec![item.clone()], Vec::new());
        spawn_transfer(app.clone(), state.transfers.clone(), job);
        items.push(item);
    }
    Ok(items)
}

#[tauri::command]
#[specta::specta]
pub async fn transfer_preflight(
    app: AppHandle,
    state: State<'_, AppState>,
    target: FsScope,
    target_path: String,
) -> Result<Option<TransferConflict>, AppError> {
    probe_conflict(&app, &state, &target, &target_path).await
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
    let direction = transfer_direction(&source, &target)?;
    let (
        source_remote,
        target_remote,
        source_label,
        target_label,
        name,
        size,
        source_path,
        target_path,
    ) = match direction {
        TransferDirection::Upload => {
            let source_path = local_path(&source_path)?;
            let target_path = normalize_remote(&target_path)?;
            let name = local_leaf(&source_path)?;
            let entry = local::stat(&source_path).await?;
            validate_file_source(&entry)?;
            let session = match &target {
                FsScope::Remote { session_id } => remote_session(&state, session_id)?,
                FsScope::Local => unreachable!("upload target is remote"),
            };
            (
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
        TransferDirection::Download => {
            let source_path = normalize_remote(&source_path)?;
            let target_path = local_path(&target_path)?;
            let name = remote_leaf(&source_path)?;
            let session = match &source {
                FsScope::Remote { session_id } => remote_session(&state, session_id)?,
                FsScope::Local => unreachable!("download source is remote"),
            };
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
            validate_file_source(&entry)?;
            (
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
    state.transfers.remember_job(job.clone());
    crate::transfer::emit_delta(&app, vec![item.clone()], Vec::new());
    spawn_transfer(app, state.transfers.clone(), job);
    Ok(item)
}

fn validate_file_source(entry: &FsEntry) -> Result<(), AppError> {
    match entry.kind {
        EntryKind::File => Ok(()),
        EntryKind::Directory => Err(AppError::new(
            ErrorCode::Unsupported,
            "Use the folder transfer action for folders.",
        )),
        EntryKind::Symlink | EntryKind::Other => Err(AppError::new(
            ErrorCode::Unsupported,
            "Symlink and special-file transfers are not supported.",
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
pub async fn transfer_retry(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<TransferItem, AppError> {
    // Async so Tauri runs it inside the runtime: the retry spawns the transfer
    // task, and `tokio::spawn` panics on a thread without a runtime context.
    state.transfers.retry(&app, &id)
}

#[tauri::command]
#[specta::specta]
pub fn transfer_clear_finished(app: AppHandle, state: State<'_, AppState>) -> u32 {
    state.transfers.clear_finished(&app).len() as u32
}

#[tauri::command]
#[specta::specta]
pub fn transfer_pause_queue(state: State<'_, AppState>) -> bool {
    state.transfers.pause_queue()
}

#[tauri::command]
#[specta::specta]
pub fn transfer_resume_queue(state: State<'_, AppState>) -> bool {
    state.transfers.resume_queue()
}

#[tauri::command]
#[specta::specta]
pub fn transfer_queue_paused(state: State<'_, AppState>) -> bool {
    state.transfers.is_paused()
}

#[tauri::command]
#[specta::specta]
pub fn transfer_history(state: State<'_, AppState>) -> Vec<TransferHistoryEntry> {
    state.transfers.history().list()
}

#[tauri::command]
#[specta::specta]
pub fn transfer_clear_history(state: State<'_, AppState>) -> u32 {
    state.transfers.history().clear()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_target_paths_per_scope() {
        assert_eq!(
            join_scope_path(&FsScope::Local, "/tmp", "report.pdf").unwrap(),
            "/tmp/report.pdf"
        );
        assert_eq!(
            join_scope_path(
                &FsScope::Remote {
                    session_id: "s1".into()
                },
                "/upload",
                "report.pdf"
            )
            .unwrap(),
            "/upload/report.pdf"
        );
        assert_eq!(
            join_scope_path(
                &FsScope::Remote {
                    session_id: "s1".into()
                },
                "/",
                "report.pdf"
            )
            .unwrap(),
            "/report.pdf"
        );
    }

    #[tokio::test]
    async fn hashes_local_files_for_content_comparison() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("report.txt");
        tokio::fs::write(&path, b"report")
            .await
            .expect("write local file");

        let hash = hash_local(path.to_str().expect("utf-8 path"), 1024)
            .await
            .expect("hash");
        assert_eq!(hash, Sha256::digest(b"report").to_vec());
    }

    #[test]
    fn only_cross_scope_transfers_are_allowed() {
        let local = FsScope::Local;
        let remote = FsScope::Remote {
            session_id: "s1".into(),
        };

        assert_eq!(
            transfer_direction(&local, &remote).unwrap(),
            TransferDirection::Upload
        );
        assert_eq!(
            transfer_direction(&remote, &local).unwrap(),
            TransferDirection::Download
        );
        assert_eq!(
            transfer_direction(&local, &local)
                .expect_err("local to local is rejected")
                .code,
            ErrorCode::Unsupported
        );
        assert!(transfer_direction(&remote, &remote).is_err());
    }
}
