use std::collections::{BTreeMap, HashSet};

use tauri::{AppHandle, State};

use crate::app_state::AppState;
use crate::commands::transfer::{
    join_scope_path, normalize_scope_path, scope_hash, scope_list, scope_stat,
};
use crate::domain::fs::{EntryKind, FsEntry, FsScope};
use crate::domain::sync::{SyncAction, SyncEntry, SyncEntryStatus, SyncPlan};
use crate::error::AppError;

/// Keep a comparison bounded so a large tree cannot exhaust memory or leave
/// the UI waiting forever. The user can compare a smaller folder.
const MAX_SYNC_ENTRIES: usize = 50_000;
const MAX_SYNC_DEPTH: usize = 64;
/// Content verification is limited to small files. Larger date-only
/// differences stay in manual review instead of being read over the network.
const MAX_HASH_FILE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_HASH_TOTAL_BYTES: u64 = 32 * 1024 * 1024;
const MAX_HASH_FILES: usize = 200;

/// Compare a local folder with a remote folder. This is the dry-run for the
/// one-way local -> remote sync; it never writes to either side.
#[tauri::command]
#[specta::specta]
pub async fn sync_compare(
    app: AppHandle,
    state: State<'_, AppState>,
    local_path: String,
    remote: FsScope,
    remote_path: String,
) -> Result<SyncPlan, AppError> {
    let local_scope = FsScope::Local;
    let remote_scope = match &remote {
        FsScope::Remote { .. } => remote.clone(),
        FsScope::Local => {
            return Err(AppError::invalid_input(
                "Choose a remote session to compare with.",
            ));
        }
    };

    let local_root = normalize_scope_path(&local_scope, &local_path)?;
    let remote_root = normalize_scope_path(&remote_scope, &remote_path)?;
    require_directory(&app, &state, &local_scope, &local_root, "local").await?;
    require_directory(&app, &state, &remote_scope, &remote_root, "remote").await?;

    let mut plan = SyncPlan::new(local_root.clone(), remote_root.clone());
    let walker = CompareWalker {
        app: &app,
        state: &state,
        local: &local_scope,
        remote: &remote_scope,
    };
    Box::pin(walker.walk(
        &local_root,
        Some(&remote_root),
        &remote_root,
        "",
        0,
        &mut plan,
    ))
    .await?;
    verify_contents(&app, &state, &local_scope, &remote_scope, &mut plan).await;
    plan.recount();
    Ok(plan)
}

/// Compare bytes for small files whose size matches but whose timestamps do
/// not. This is what keeps servers without MFMT/SITE UTIME from re-uploading
/// identical files forever, and it also catches same-size edits.
async fn verify_contents(
    app: &AppHandle,
    state: &AppState,
    local: &FsScope,
    remote: &FsScope,
    plan: &mut SyncPlan,
) {
    let mut checked = 0usize;
    let mut checked_bytes = 0u64;
    let mut skipped = 0usize;
    let mut warnings = Vec::new();

    for entry in &mut plan.entries {
        if entry.status != SyncEntryStatus::DateDiffers {
            continue;
        }
        let (Some(local_path), Some(remote_path)) =
            (entry.local_path.as_deref(), entry.remote_path.as_deref())
        else {
            continue;
        };
        let size = entry.local_size.unwrap_or(0.0);
        if !size.is_finite()
            || size < 0.0
            || size as u64 > MAX_HASH_FILE_BYTES
            || checked >= MAX_HASH_FILES
            || checked_bytes.saturating_add(size as u64) > MAX_HASH_TOTAL_BYTES
        {
            skipped += 1;
            continue;
        }

        let (local_hash, remote_hash) = tokio::join!(
            scope_hash(app, state, local, local_path, MAX_HASH_FILE_BYTES),
            scope_hash(app, state, remote, remote_path, MAX_HASH_FILE_BYTES),
        );
        match (local_hash, remote_hash) {
            (Ok(left), Ok(right)) if left == right => {
                entry.status = SyncEntryStatus::EqualContent;
                entry.action = SyncAction::Skip;
            }
            (Ok(_), Ok(_)) => {
                entry.status = SyncEntryStatus::ContentDiffers;
                entry.action = SyncAction::Upload;
            }
            (Err(error), _) | (_, Err(error)) => {
                warnings.push(format!(
                    "Could not verify {} by content: {}",
                    entry.relative_path, error.message
                ));
            }
        }
        checked += 1;
        checked_bytes = checked_bytes.saturating_add(size as u64);
    }

    if skipped > 0 {
        warnings.push(format!(
            "Content check skipped for {skipped} date-only difference(s) above the {MAX_HASH_FILE_BYTES} byte per-file or {MAX_HASH_TOTAL_BYTES} byte total limit."
        ));
    }
    plan.warnings.extend(warnings);
}

async fn require_directory(
    app: &AppHandle,
    state: &AppState,
    scope: &FsScope,
    path: &str,
    label: &str,
) -> Result<(), AppError> {
    let entry = scope_stat(app, state, scope, path).await?;
    if entry.kind != EntryKind::Directory {
        return Err(AppError::invalid_input(format!(
            "The {label} path is not a folder."
        )));
    }
    Ok(())
}

struct CompareWalker<'a> {
    app: &'a AppHandle,
    state: &'a AppState,
    local: &'a FsScope,
    remote: &'a FsScope,
}

impl CompareWalker<'_> {
    /// Walk a pair of directories. `remote_path` is `None` for a local-only
    /// folder, so its children are planned as new files and folders.
    async fn walk(
        &self,
        local_path: &str,
        remote_path: Option<&str>,
        remote_target_dir: &str,
        relative_path: &str,
        depth: usize,
        plan: &mut SyncPlan,
    ) -> Result<(), AppError> {
        if plan.entries.len() >= MAX_SYNC_ENTRIES {
            plan.truncated = true;
            return Ok(());
        }
        if depth > MAX_SYNC_DEPTH {
            plan.truncated = true;
            plan.warnings.push(format!(
                "Skipped {relative_path}: the folder is nested too deeply."
            ));
            return Ok(());
        }

        let local_listing = match scope_list(self.app, self.state, self.local, local_path).await {
            Ok(listing) => listing,
            Err(error) => {
                if depth == 0 {
                    return Err(error);
                }
                plan.warnings
                    .push(format!("Could not read {relative_path}: {}", error.message));
                return Ok(());
            }
        };

        let mut remote_entries: Vec<FsEntry> = Vec::new();
        if let Some(remote_path) = remote_path {
            match scope_list(self.app, self.state, self.remote, remote_path).await {
                Ok(listing) => remote_entries = listing.entries,
                Err(error) => {
                    if depth == 0 {
                        return Err(error);
                    }
                    plan.warnings
                        .push(format!("Could not read {relative_path}: {}", error.message));
                    return Ok(());
                }
            }
        }

        let remote_by_name: BTreeMap<&str, &FsEntry> = remote_entries
            .iter()
            .map(|entry| (entry.name.as_str(), entry))
            .collect();
        let mut matched_remote = HashSet::new();

        for local_entry in &local_listing.entries {
            if is_internal_name(&local_entry.name) {
                plan.skipped += 1;
                continue;
            }

            let child_relative = child_path(relative_path, &local_entry.name);
            let remote_entry = remote_by_name.get(local_entry.name.as_str()).copied();
            if let Some(remote_entry) = remote_entry {
                matched_remote.insert(remote_entry.name.as_str());
            }

            let remote_target = match remote_entry {
                Some(entry) => entry.path.clone(),
                None => match join_scope_path(self.remote, remote_target_dir, &local_entry.name) {
                    Ok(path) => path,
                    Err(error) => {
                        plan.skipped += 1;
                        plan.warnings
                            .push(format!("Skipped {child_relative}: {}", error.message));
                        continue;
                    }
                },
            };

            let both_directories = local_entry.kind == EntryKind::Directory
                && remote_entry.map(|entry| entry.kind) == Some(EntryKind::Directory);

            if both_directories {
                let remote_child = remote_entry.map(|entry| entry.path.as_str());
                Box::pin(self.walk(
                    &local_entry.path,
                    remote_child,
                    &remote_target,
                    &child_relative,
                    depth + 1,
                    plan,
                ))
                .await?;
            } else if local_entry.kind == EntryKind::Directory && remote_entry.is_none() {
                plan.record(
                    SyncEntry::new(child_relative.clone(), Some(local_entry), None)
                        .with_remote_target(remote_target.clone()),
                );
                Box::pin(self.walk(
                    &local_entry.path,
                    None,
                    &remote_target,
                    &child_relative,
                    depth + 1,
                    plan,
                ))
                .await?;
            } else {
                plan.record(
                    SyncEntry::new(child_relative, Some(local_entry), remote_entry)
                        .with_remote_target(remote_target),
                );
            }

            if plan.entries.len() >= MAX_SYNC_ENTRIES {
                plan.truncated = true;
                return Ok(());
            }
        }

        for remote_entry in &remote_entries {
            if is_internal_name(&remote_entry.name)
                || matched_remote.contains(remote_entry.name.as_str())
            {
                continue;
            }
            let child_relative = child_path(relative_path, &remote_entry.name);
            plan.record(
                SyncEntry::new(child_relative, None, Some(remote_entry))
                    .with_remote_target(remote_entry.path.clone()),
            );
            if plan.entries.len() >= MAX_SYNC_ENTRIES {
                plan.truncated = true;
                return Ok(());
            }
        }

        Ok(())
    }
}

fn child_path(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

/// Partial transfers use hidden names next to the target. They are internal
/// files, not user content, so a comparison ignores them.
fn is_internal_name(name: &str) -> bool {
    name.contains(".sftply-part-") || name.contains(".sftply-backup-")
}
