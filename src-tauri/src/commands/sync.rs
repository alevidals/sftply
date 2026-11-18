use std::collections::{BTreeMap, HashSet};

use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use tauri::{AppHandle, State};
use tokio_util::sync::CancellationToken;

use crate::app_state::AppState;
use crate::commands::transfer::{
    join_scope_path, normalize_scope_path, scope_hash, scope_list, scope_stat,
};
use crate::domain::fs::{EntryKind, FsEntry, FsScope};
use crate::domain::sync::{SyncAction, SyncEntry, SyncEntryStatus, SyncPlan, SyncValidationIssue};
use crate::error::{AppError, ErrorCode};

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
    include: Vec<String>,
    exclude: Vec<String>,
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
    let filters = SyncFilters::new(&include, &exclude)?;

    let token = state.sync.begin();
    let result = async {
        let mut plan = SyncPlan::new(local_root.clone(), remote_root.clone());
        let walker = CompareWalker {
            app: &app,
            state: &state,
            local: &local_scope,
            remote: &remote_scope,
            filters: &filters,
            token: &token,
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
        prune_filtered_directories(&mut plan, &filters);
        verify_contents(&app, &state, &local_scope, &remote_scope, &mut plan, &token).await?;
        plan.recount();
        Ok(plan)
    }
    .await;
    state.sync.finish();
    result
}

#[tauri::command]
#[specta::specta]
pub fn sync_cancel(state: State<'_, AppState>) -> bool {
    state.sync.cancel()
}

const VALIDATION_MTIME_TOLERANCE_MS: f64 = 2_000.0;

/// Re-check the remote targets immediately before enqueueing a plan. A file
/// that changed after the dry-run is reported instead of being overwritten.
#[tauri::command]
#[specta::specta]
pub async fn sync_validate(
    app: AppHandle,
    state: State<'_, AppState>,
    remote: FsScope,
    entries: Vec<SyncEntry>,
) -> Result<Vec<SyncValidationIssue>, AppError> {
    let remote = match remote {
        FsScope::Remote { .. } => remote,
        FsScope::Local => {
            return Err(AppError::invalid_input(
                "Choose a remote session to validate against.",
            ));
        }
    };

    let mut issues = Vec::new();
    for entry in entries {
        let selected =
            entry.action == SyncAction::Upload || entry.status == SyncEntryStatus::DateDiffers;
        if !selected {
            continue;
        }
        let Some(target) = entry.remote_target_path.as_deref() else {
            continue;
        };

        match scope_stat(&app, &state, &remote, target).await {
            Ok(current) => {
                if entry.action == SyncAction::CreateDirectory {
                    if current.kind != EntryKind::Directory {
                        issues.push(validation_issue(
                            &entry,
                            target,
                            "The target is no longer a folder.",
                        ));
                    }
                    continue;
                }
                if current.kind != EntryKind::File {
                    issues.push(validation_issue(
                        &entry,
                        target,
                        "The target is no longer a file.",
                    ));
                    continue;
                }
                if entry.remote_path.is_none() {
                    issues.push(validation_issue(
                        &entry,
                        target,
                        "A file now exists at the target.",
                    ));
                    continue;
                }
                let expected_size = entry.remote_size.unwrap_or(-1.0);
                if current.size != expected_size {
                    issues.push(validation_issue(
                        &entry,
                        target,
                        "The remote size changed after the comparison.",
                    ));
                    continue;
                }
                if let (Some(expected), Some(actual)) =
                    (entry.remote_modified_at, current.modified_at)
                    && (expected - actual).abs() > VALIDATION_MTIME_TOLERANCE_MS
                {
                    issues.push(validation_issue(
                        &entry,
                        target,
                        "The remote timestamp changed after the comparison.",
                    ));
                }
            }
            Err(error) if error.code == ErrorCode::NotFound => {
                if entry.remote_path.is_some() {
                    issues.push(validation_issue(
                        &entry,
                        target,
                        "The remote file was removed after the comparison.",
                    ));
                }
            }
            Err(error) => return Err(error),
        }
    }

    Ok(issues)
}

fn validation_issue(entry: &SyncEntry, target: &str, reason: &str) -> SyncValidationIssue {
    SyncValidationIssue {
        relative_path: entry.relative_path.clone(),
        target_path: target.to_string(),
        reason: reason.to_string(),
    }
}

fn cancelled() -> AppError {
    AppError::new(ErrorCode::Cancelled, "The comparison was cancelled.")
}

struct SyncFilters {
    include: Option<GlobSet>,
    exclude: Option<GlobSet>,
}

impl SyncFilters {
    fn new(include: &[String], exclude: &[String]) -> Result<Self, AppError> {
        Ok(Self {
            include: build_globset(include)?,
            exclude: build_globset(exclude)?,
        })
    }

    fn allows_file(&self, relative_path: &str) -> bool {
        if self
            .exclude
            .as_ref()
            .is_some_and(|set| set.is_match(relative_path))
        {
            return false;
        }
        self.include
            .as_ref()
            .is_none_or(|set| set.is_match(relative_path))
    }

    /// Exclude patterns stop the walk. Include patterns do not, because a
    /// directory may contain a matching child.
    fn allows_dir(&self, relative_path: &str) -> bool {
        !self
            .exclude
            .as_ref()
            .is_some_and(|set| set.is_match(relative_path))
    }

    fn includes_dir(&self, relative_path: &str) -> bool {
        self.include
            .as_ref()
            .is_none_or(|set| set.is_match(relative_path))
    }

    fn has_include(&self) -> bool {
        self.include.is_some()
    }
}

fn build_globset(patterns: &[String]) -> Result<Option<GlobSet>, AppError> {
    let patterns: Vec<&str> = patterns
        .iter()
        .map(String::as_str)
        .map(str::trim)
        .filter(|pattern| !pattern.is_empty())
        .collect();
    if patterns.is_empty() {
        return Ok(None);
    }

    let mut builder = GlobSetBuilder::new();
    for pattern in patterns {
        let glob = GlobBuilder::new(pattern)
            .literal_separator(true)
            .build()
            .map_err(|error| {
                AppError::invalid_input(format!("Invalid glob pattern “{pattern}”: {error}"))
            })?;
        builder.add(glob);
    }
    builder
        .build()
        .map(Some)
        .map_err(|error| AppError::invalid_input(format!("Invalid glob patterns: {error}")))
}

/// With an include filter, local-only folders are created only when a selected
/// descendant needs them or the folder itself matches the filter.
fn prune_filtered_directories(plan: &mut SyncPlan, filters: &SyncFilters) {
    if !filters.has_include() {
        return;
    }

    let mut required = HashSet::new();
    for entry in &plan.entries {
        if entry.action != SyncAction::Upload && entry.status != SyncEntryStatus::DateDiffers {
            continue;
        }
        let mut path = entry.relative_path.as_str();
        while let Some((parent, _)) = path.rsplit_once('/') {
            required.insert(parent.to_string());
            path = parent;
        }
    }

    plan.entries.retain(|entry| {
        let is_new_folder = entry.action == SyncAction::CreateDirectory;
        let is_remote_folder = entry.status == SyncEntryStatus::RemoteOnly
            && entry.remote_kind == Some(EntryKind::Directory);
        if !is_new_folder && !is_remote_folder {
            return true;
        }
        required.contains(&entry.relative_path) || filters.includes_dir(&entry.relative_path)
    });
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
    token: &CancellationToken,
) -> Result<(), AppError> {
    let mut checked = 0usize;
    let mut checked_bytes = 0u64;
    let mut skipped = 0usize;
    let mut warnings = Vec::new();

    for entry in &mut plan.entries {
        if token.is_cancelled() {
            return Err(cancelled());
        }
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
            scope_hash(app, state, local, local_path, MAX_HASH_FILE_BYTES, token),
            scope_hash(app, state, remote, remote_path, MAX_HASH_FILE_BYTES, token),
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
            (Err(error), _) | (_, Err(error)) if error.code == ErrorCode::Cancelled => {
                return Err(error);
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
    Ok(())
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
    filters: &'a SyncFilters,
    token: &'a CancellationToken,
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
        if self.token.is_cancelled() {
            return Err(cancelled());
        }
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
            if self.token.is_cancelled() {
                return Err(cancelled());
            }
            if is_internal_name(&local_entry.name) {
                plan.skipped += 1;
                continue;
            }

            let child_relative = child_path(relative_path, &local_entry.name);
            if local_entry.kind == EntryKind::Directory {
                if !self.filters.allows_dir(&child_relative) {
                    continue;
                }
            } else if !self.filters.allows_file(&child_relative) {
                continue;
            }
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
            if self.token.is_cancelled() {
                return Err(cancelled());
            }
            if is_internal_name(&remote_entry.name)
                || matched_remote.contains(remote_entry.name.as_str())
            {
                continue;
            }
            let child_relative = child_path(relative_path, &remote_entry.name);
            if !self.filters.allows_file(&child_relative) {
                continue;
            }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(
        relative_path: &str,
        kind: EntryKind,
        status: SyncEntryStatus,
        action: SyncAction,
    ) -> SyncEntry {
        SyncEntry {
            relative_path: relative_path.to_string(),
            name: relative_path
                .rsplit('/')
                .next()
                .unwrap_or(relative_path)
                .to_string(),
            local_path: Some(format!("/local/{relative_path}")),
            remote_path: None,
            remote_target_path: Some(format!("/remote/{relative_path}")),
            local_kind: Some(kind),
            remote_kind: None,
            local_size: Some(if kind == EntryKind::Directory {
                0.0
            } else {
                1.0
            }),
            remote_size: None,
            local_modified_at: Some(1_000.0),
            remote_modified_at: None,
            status,
            action,
        }
    }

    #[test]
    fn include_and_exclude_globs() {
        let filters = SyncFilters::new(&["**/*.txt".to_string()], &["vendor/**".to_string()])
            .expect("filters");

        assert!(filters.allows_file("src/report.txt"));
        assert!(!filters.allows_file("src/report.md"));
        assert!(!filters.allows_file("vendor/report.txt"));

        let excluded_dir = SyncFilters::new(&[], &["vendor".to_string()]).expect("filters");
        assert!(!excluded_dir.allows_dir("vendor"));
    }

    #[test]
    fn rejects_invalid_globs() {
        assert!(SyncFilters::new(&["[".to_string()], &[]).is_err());
    }

    #[test]
    fn include_filters_remove_unneeded_empty_folders() {
        let filters = SyncFilters::new(&["**/*.txt".to_string()], &[]).expect("filters");
        let mut plan = SyncPlan::new("/local".to_string(), "/remote".to_string());
        plan.record(entry(
            "src",
            EntryKind::Directory,
            SyncEntryStatus::LocalOnly,
            SyncAction::CreateDirectory,
        ));
        plan.record(entry(
            "src/report.txt",
            EntryKind::File,
            SyncEntryStatus::LocalOnly,
            SyncAction::Upload,
        ));
        plan.record(entry(
            "empty",
            EntryKind::Directory,
            SyncEntryStatus::LocalOnly,
            SyncAction::CreateDirectory,
        ));

        prune_filtered_directories(&mut plan, &filters);

        let paths: Vec<&str> = plan
            .entries
            .iter()
            .map(|entry| entry.relative_path.as_str())
            .collect();
        assert_eq!(paths, ["src", "src/report.txt"]);
    }
}
