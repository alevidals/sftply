use std::collections::{BTreeMap, HashSet};

use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use tauri::{AppHandle, State};
use tokio_util::sync::CancellationToken;

use crate::app_state::AppState;
use crate::commands::transfer::{
    join_scope_path, normalize_scope_path, scope_hash, scope_list, scope_stat,
};
use crate::domain::fs::{EntryKind, FsEntry, FsScope};
use crate::domain::sync::{
    SyncAction, SyncDirection, SyncEntry, SyncEntryStatus, SyncPlan, SyncValidationIssue,
};
use crate::error::{AppError, ErrorCode};

const MAX_SYNC_ENTRIES: usize = 50_000;
const MAX_SYNC_DEPTH: usize = 64;
const MAX_HASH_FILE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_HASH_TOTAL_BYTES: u64 = 32 * 1024 * 1024;
const MAX_HASH_FILES: usize = 200;

/// Compare the current local and remote folders. The plan is a dry-run and
/// never writes to either side.
#[allow(clippy::too_many_arguments)] // Flat Tauri command surface.
#[tauri::command]
#[specta::specta]
pub async fn sync_compare(
    app: AppHandle,
    state: State<'_, AppState>,
    local_path: String,
    remote: FsScope,
    remote_path: String,
    direction: SyncDirection,
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

    let (source_scope, target_scope, source_root, target_root) = match direction {
        SyncDirection::Upload => (&local_scope, &remote_scope, &local_root, &remote_root),
        SyncDirection::Download => (&remote_scope, &local_scope, &remote_root, &local_root),
    };

    let token = state.sync.begin();
    let result = async {
        let mut plan = SyncPlan::new(direction, local_root.clone(), remote_root.clone());
        let walker = CompareWalker {
            app: &app,
            state: &state,
            source: source_scope,
            target: target_scope,
            direction,
            filters: &filters,
            token: &token,
        };
        Box::pin(walker.walk(
            source_root,
            Some(target_root),
            target_root,
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

/// Re-check the target immediately before enqueueing a plan.
#[tauri::command]
#[specta::specta]
pub async fn sync_validate(
    app: AppHandle,
    state: State<'_, AppState>,
    remote: FsScope,
    direction: SyncDirection,
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
    let target_scope = match direction {
        SyncDirection::Upload => remote,
        SyncDirection::Download => FsScope::Local,
    };

    let mut issues = Vec::new();
    for entry in entries {
        let selected = matches!(
            entry.action,
            SyncAction::Upload | SyncAction::Download | SyncAction::CreateDirectory
        ) || entry.status == SyncEntryStatus::DateDiffers;
        if !selected {
            continue;
        }
        let target_path = match direction {
            SyncDirection::Upload => entry.remote_target_path.as_deref(),
            SyncDirection::Download => entry.local_target_path.as_deref(),
        };
        let Some(target_path) = target_path else {
            continue;
        };
        let expected_present = match direction {
            SyncDirection::Upload => entry.remote_path.is_some(),
            SyncDirection::Download => entry.local_path.is_some(),
        };
        let expected_size = match direction {
            SyncDirection::Upload => entry.remote_size,
            SyncDirection::Download => entry.local_size,
        };
        let expected_mtime = match direction {
            SyncDirection::Upload => entry.remote_modified_at,
            SyncDirection::Download => entry.local_modified_at,
        };

        match scope_stat(&app, &state, &target_scope, target_path).await {
            Ok(current) => {
                if entry.action == SyncAction::CreateDirectory {
                    if current.kind != EntryKind::Directory {
                        issues.push(validation_issue(
                            &entry,
                            target_path,
                            "The target is no longer a folder.",
                        ));
                    }
                    continue;
                }
                if current.kind != EntryKind::File {
                    issues.push(validation_issue(
                        &entry,
                        target_path,
                        "The target is no longer a file.",
                    ));
                    continue;
                }
                if !expected_present {
                    issues.push(validation_issue(
                        &entry,
                        target_path,
                        "A file now exists at the target.",
                    ));
                    continue;
                }
                let expected_size = expected_size.unwrap_or(-1.0);
                if current.size != expected_size {
                    issues.push(validation_issue(
                        &entry,
                        target_path,
                        "The target size changed after the comparison.",
                    ));
                    continue;
                }
                if let (Some(expected), Some(actual)) = (expected_mtime, current.modified_at)
                    && (expected - actual).abs() > VALIDATION_MTIME_TOLERANCE_MS
                {
                    issues.push(validation_issue(
                        &entry,
                        target_path,
                        "The target timestamp changed after the comparison.",
                    ));
                }
            }
            Err(error) if error.code == ErrorCode::NotFound => {
                if expected_present {
                    issues.push(validation_issue(
                        &entry,
                        target_path,
                        "The target was removed after the comparison.",
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

/// With an include filter, folders are created only when a selected descendant
/// needs them or the folder itself matches the filter.
fn prune_filtered_directories(plan: &mut SyncPlan, filters: &SyncFilters) {
    if !filters.has_include() {
        return;
    }

    let mut required = HashSet::new();
    for entry in &plan.entries {
        if !matches!(entry.action, SyncAction::Upload | SyncAction::Download)
            && entry.status != SyncEntryStatus::DateDiffers
        {
            continue;
        }
        let mut path = entry.relative_path.as_str();
        while let Some((parent, _)) = path.rsplit_once('/') {
            required.insert(parent.to_string());
            path = parent;
        }
    }

    plan.entries.retain(|entry| {
        entry.action != SyncAction::CreateDirectory
            || required.contains(&entry.relative_path)
            || filters.includes_dir(&entry.relative_path)
    });
}

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
    let direction = plan.direction;

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
        let size = entry.local_size.or(entry.remote_size).unwrap_or(0.0);
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
                entry.action = match direction {
                    SyncDirection::Upload => SyncAction::Upload,
                    SyncDirection::Download => SyncAction::Download,
                };
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
    source: &'a FsScope,
    target: &'a FsScope,
    direction: SyncDirection,
    filters: &'a SyncFilters,
    token: &'a CancellationToken,
}

impl CompareWalker<'_> {
    async fn walk(
        &self,
        source_path: &str,
        target_path: Option<&str>,
        target_root: &str,
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

        let source_listing = match scope_list(self.app, self.state, self.source, source_path).await
        {
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

        let mut target_entries: Vec<FsEntry> = Vec::new();
        if let Some(target_path) = target_path {
            match scope_list(self.app, self.state, self.target, target_path).await {
                Ok(listing) => target_entries = listing.entries,
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

        let target_by_name: BTreeMap<&str, &FsEntry> = target_entries
            .iter()
            .map(|entry| (entry.name.as_str(), entry))
            .collect();
        let mut matched_target = HashSet::new();

        for source_entry in &source_listing.entries {
            if self.token.is_cancelled() {
                return Err(cancelled());
            }
            if is_internal_name(&source_entry.name) {
                plan.skipped += 1;
                continue;
            }
            let child_relative = child_path(relative_path, &source_entry.name);
            if source_entry.kind == EntryKind::Directory {
                if !self.filters.allows_dir(&child_relative) {
                    continue;
                }
            } else if !self.filters.allows_file(&child_relative) {
                continue;
            }

            let target_entry = target_by_name.get(source_entry.name.as_str()).copied();
            if let Some(target_entry) = target_entry {
                matched_target.insert(target_entry.name.as_str());
            }
            let target_target = match target_entry {
                Some(entry) => entry.path.clone(),
                None => match join_scope_path(self.target, target_root, &source_entry.name) {
                    Ok(path) => path,
                    Err(error) => {
                        plan.skipped += 1;
                        plan.warnings
                            .push(format!("Skipped {child_relative}: {}", error.message));
                        continue;
                    }
                },
            };

            let (local_entry, remote_entry) = match self.direction {
                SyncDirection::Upload => (Some(source_entry), target_entry),
                SyncDirection::Download => (target_entry, Some(source_entry)),
            };

            let both_directories = source_entry.kind == EntryKind::Directory
                && target_entry.map(|entry| entry.kind) == Some(EntryKind::Directory);

            if both_directories {
                let target_child = target_entry.map(|entry| entry.path.as_str());
                Box::pin(self.walk(
                    &source_entry.path,
                    target_child,
                    &target_target,
                    &child_relative,
                    depth + 1,
                    plan,
                ))
                .await?;
            } else if source_entry.kind == EntryKind::Directory && target_entry.is_none() {
                plan.record(
                    SyncEntry::new(
                        self.direction,
                        child_relative.clone(),
                        local_entry,
                        remote_entry,
                    )
                    .with_target(self.direction, target_target.clone()),
                );
                Box::pin(self.walk(
                    &source_entry.path,
                    None,
                    &target_target,
                    &child_relative,
                    depth + 1,
                    plan,
                ))
                .await?;
            } else {
                plan.record(
                    SyncEntry::new(self.direction, child_relative, local_entry, remote_entry)
                        .with_target(self.direction, target_target),
                );
            }

            if plan.entries.len() >= MAX_SYNC_ENTRIES {
                plan.truncated = true;
                return Ok(());
            }
        }

        for target_entry in &target_entries {
            if self.token.is_cancelled() {
                return Err(cancelled());
            }
            if is_internal_name(&target_entry.name)
                || matched_target.contains(target_entry.name.as_str())
            {
                continue;
            }
            let child_relative = child_path(relative_path, &target_entry.name);
            if !self.filters.allows_file(&child_relative) {
                continue;
            }
            let (local_entry, remote_entry) = match self.direction {
                SyncDirection::Upload => (None, Some(target_entry)),
                SyncDirection::Download => (Some(target_entry), None),
            };
            plan.record(
                SyncEntry::new(self.direction, child_relative, local_entry, remote_entry)
                    .with_target(self.direction, target_entry.path.clone()),
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
            local_target_path: None,
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
        let mut plan = SyncPlan::new(
            SyncDirection::Upload,
            "/local".to_string(),
            "/remote".to_string(),
        );
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
