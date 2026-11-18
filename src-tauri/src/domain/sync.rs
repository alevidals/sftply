use serde::{Deserialize, Serialize};
use specta::Type;

use crate::domain::fs::{EntryKind, FsEntry};

/// Result of comparing one local entry with its remote counterpart.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SyncEntryStatus {
    /// Present locally, missing remotely. Directories are created; files are uploaded.
    LocalOnly,
    /// Present remotely, missing locally. Kept as-is: 1.1 does not delete.
    RemoteOnly,
    /// Both sides exist and the metadata differs.
    Different,
    /// Both sides exist with the same size and modification time.
    Equal,
    /// Both sides exist, but one side could not provide reliable metadata.
    Unknown,
    /// One side is a file and the other is a directory.
    TypeMismatch,
    /// Symlinks and special files are not synchronized.
    Unsupported,
}

/// What the plan proposes for an entry. `Review` and `Skip` are never applied
/// without an explicit user decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SyncAction {
    Upload,
    CreateDirectory,
    Skip,
    Review,
}

/// One entry in a comparison plan. Paths are absolute on each side; the
/// relative path is what the UI shows and what the planner uses to match.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SyncEntry {
    /// Path relative to the compared roots, using `/` on every platform.
    pub relative_path: String,
    pub name: String,
    pub local_path: Option<String>,
    pub remote_path: Option<String>,
    /// Where this entry would be written on the remote side. Present even for
    /// local-only entries, so the UI does not have to join remote paths.
    pub remote_target_path: Option<String>,
    pub local_kind: Option<EntryKind>,
    pub remote_kind: Option<EntryKind>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub local_size: Option<f64>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub remote_size: Option<f64>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub local_modified_at: Option<f64>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub remote_modified_at: Option<f64>,
    pub status: SyncEntryStatus,
    pub action: SyncAction,
}

impl SyncEntry {
    pub fn new(relative_path: String, local: Option<&FsEntry>, remote: Option<&FsEntry>) -> Self {
        let (status, action) = classify(local, remote);
        let name = local
            .or(remote)
            .map(|entry| entry.name.clone())
            .unwrap_or_default();
        Self {
            relative_path,
            name,
            local_path: local.map(|entry| entry.path.clone()),
            remote_path: remote.map(|entry| entry.path.clone()),
            remote_target_path: None,
            local_kind: local.map(|entry| entry.kind),
            remote_kind: remote.map(|entry| entry.kind),
            local_size: local.map(|entry| entry.size),
            remote_size: remote.map(|entry| entry.size),
            local_modified_at: local.and_then(|entry| entry.modified_at),
            remote_modified_at: remote.and_then(|entry| entry.modified_at),
            status,
            action,
        }
    }

    pub fn with_remote_target(mut self, path: String) -> Self {
        self.remote_target_path = Some(path);
        self
    }
}

/// The complete dry-run. Applying it is a separate, explicit step.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SyncPlan {
    pub local_root: String,
    pub remote_root: String,
    pub entries: Vec<SyncEntry>,
    pub upload_files: u32,
    #[specta(type = specta_typescript::Number)]
    pub upload_bytes: f64,
    pub create_directories: u32,
    pub equal: u32,
    pub remote_only: u32,
    pub unknown: u32,
    pub conflicts: u32,
    pub skipped: u32,
    /// True when the walk hit the entry limit before finishing.
    pub truncated: bool,
    pub warnings: Vec<String>,
}

impl SyncPlan {
    pub fn new(local_root: String, remote_root: String) -> Self {
        Self {
            local_root,
            remote_root,
            entries: Vec::new(),
            upload_files: 0,
            upload_bytes: 0.0,
            create_directories: 0,
            equal: 0,
            remote_only: 0,
            unknown: 0,
            conflicts: 0,
            skipped: 0,
            truncated: false,
            warnings: Vec::new(),
        }
    }

    pub fn record(&mut self, entry: SyncEntry) {
        match entry.action {
            SyncAction::Upload => {
                self.upload_files += 1;
                self.upload_bytes += entry.local_size.unwrap_or(0.0);
            }
            SyncAction::CreateDirectory => self.create_directories += 1,
            SyncAction::Skip => match entry.status {
                SyncEntryStatus::Equal => self.equal += 1,
                SyncEntryStatus::RemoteOnly => self.remote_only += 1,
                SyncEntryStatus::Unsupported => self.skipped += 1,
                _ => {}
            },
            SyncAction::Review => match entry.status {
                SyncEntryStatus::Unknown => self.unknown += 1,
                SyncEntryStatus::TypeMismatch => self.conflicts += 1,
                _ => {}
            },
        }
        self.entries.push(entry);
    }
}

/// Compare two entries with the 1.1 policy: metadata first, no deletes, and
/// anything uncertain goes to manual review instead of being overwritten.
pub fn classify(
    local: Option<&FsEntry>,
    remote: Option<&FsEntry>,
) -> (SyncEntryStatus, SyncAction) {
    match (local, remote) {
        (Some(local), Some(remote)) => {
            if local.kind != remote.kind {
                return (SyncEntryStatus::TypeMismatch, SyncAction::Review);
            }
            match local.kind {
                EntryKind::Directory => (SyncEntryStatus::Equal, SyncAction::Skip),
                EntryKind::File => compare_files(local, remote),
                EntryKind::Symlink | EntryKind::Other => {
                    (SyncEntryStatus::Unsupported, SyncAction::Skip)
                }
            }
        }
        (Some(local), None) => match local.kind {
            EntryKind::File => (SyncEntryStatus::LocalOnly, SyncAction::Upload),
            EntryKind::Directory => (SyncEntryStatus::LocalOnly, SyncAction::CreateDirectory),
            EntryKind::Symlink | EntryKind::Other => {
                (SyncEntryStatus::Unsupported, SyncAction::Skip)
            }
        },
        (None, Some(_)) => (SyncEntryStatus::RemoteOnly, SyncAction::Skip),
        (None, None) => (SyncEntryStatus::Unsupported, SyncAction::Skip),
    }
}

/// FTP and SFTP often report timestamps with second or even minute precision.
/// Comparing raw milliseconds would re-upload unchanged files, so allow a
/// small clock and precision window.
const MTIME_TOLERANCE_MS: f64 = 2_000.0;

fn compare_files(local: &FsEntry, remote: &FsEntry) -> (SyncEntryStatus, SyncAction) {
    if !local.metadata_complete || !remote.metadata_complete {
        return (SyncEntryStatus::Unknown, SyncAction::Review);
    }
    if local.size != remote.size {
        return (SyncEntryStatus::Different, SyncAction::Upload);
    }
    match (local.modified_at, remote.modified_at) {
        (Some(left), Some(right)) if (left - right).abs() <= MTIME_TOLERANCE_MS => {
            (SyncEntryStatus::Equal, SyncAction::Skip)
        }
        (Some(_), Some(_)) => (SyncEntryStatus::Different, SyncAction::Upload),
        _ => (SyncEntryStatus::Unknown, SyncAction::Review),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(kind: EntryKind, size: f64, modified_at: Option<f64>) -> FsEntry {
        FsEntry {
            name: "file.txt".to_string(),
            path: "/file.txt".to_string(),
            kind,
            size,
            modified_at,
            permissions: None,
            owner: None,
            group: None,
            link_target: None,
            hidden: false,
            metadata_complete: true,
        }
    }

    #[test]
    fn equal_files_are_skipped() {
        let local = entry(EntryKind::File, 10.0, Some(1_000.0));
        let remote = entry(EntryKind::File, 10.0, Some(1_000.0));
        assert_eq!(
            classify(Some(&local), Some(&remote)),
            (SyncEntryStatus::Equal, SyncAction::Skip)
        );
    }

    #[test]
    fn different_size_or_mtime_is_uploaded() {
        let local = entry(EntryKind::File, 10.0, Some(1_000.0));
        let remote = entry(EntryKind::File, 11.0, Some(1_000.0));
        assert_eq!(
            classify(Some(&local), Some(&remote)),
            (SyncEntryStatus::Different, SyncAction::Upload)
        );

        let remote = entry(EntryKind::File, 10.0, Some(5_000.0));
        assert_eq!(
            classify(Some(&local), Some(&remote)),
            (SyncEntryStatus::Different, SyncAction::Upload)
        );
    }

    #[test]
    fn mtime_precision_is_tolerated() {
        let local = entry(EntryKind::File, 10.0, Some(1_000.0));
        let remote = entry(EntryKind::File, 10.0, Some(1_500.0));
        assert_eq!(
            classify(Some(&local), Some(&remote)),
            (SyncEntryStatus::Equal, SyncAction::Skip)
        );

        let remote = entry(EntryKind::File, 10.0, Some(4_000.0));
        assert_eq!(
            classify(Some(&local), Some(&remote)),
            (SyncEntryStatus::Different, SyncAction::Upload)
        );
    }

    #[test]
    fn missing_mtime_requires_review() {
        let local = entry(EntryKind::File, 10.0, None);
        let remote = entry(EntryKind::File, 10.0, Some(2_000.0));
        assert_eq!(
            classify(Some(&local), Some(&remote)),
            (SyncEntryStatus::Unknown, SyncAction::Review)
        );
    }

    #[test]
    fn incomplete_metadata_requires_review() {
        let local = entry(EntryKind::File, 10.0, Some(1_000.0));
        let mut remote = entry(EntryKind::File, 11.0, Some(2_000.0));
        remote.metadata_complete = false;
        assert_eq!(
            classify(Some(&local), Some(&remote)),
            (SyncEntryStatus::Unknown, SyncAction::Review)
        );
    }

    #[test]
    fn local_only_file_is_uploaded_and_directory_is_created() {
        let file = entry(EntryKind::File, 10.0, Some(1_000.0));
        assert_eq!(
            classify(Some(&file), None),
            (SyncEntryStatus::LocalOnly, SyncAction::Upload)
        );

        let directory = entry(EntryKind::Directory, 0.0, None);
        assert_eq!(
            classify(Some(&directory), None),
            (SyncEntryStatus::LocalOnly, SyncAction::CreateDirectory)
        );
    }

    #[test]
    fn remote_only_entries_are_kept() {
        let file = entry(EntryKind::File, 10.0, Some(1_000.0));
        assert_eq!(
            classify(None, Some(&file)),
            (SyncEntryStatus::RemoteOnly, SyncAction::Skip)
        );
    }

    #[test]
    fn type_mismatch_is_not_applied() {
        let local = entry(EntryKind::File, 10.0, Some(1_000.0));
        let remote = entry(EntryKind::Directory, 0.0, None);
        assert_eq!(
            classify(Some(&local), Some(&remote)),
            (SyncEntryStatus::TypeMismatch, SyncAction::Review)
        );
    }

    #[test]
    fn symlinks_are_not_followed() {
        let link = entry(EntryKind::Symlink, 0.0, None);
        assert_eq!(
            classify(Some(&link), None),
            (SyncEntryStatus::Unsupported, SyncAction::Skip)
        );
    }

    #[test]
    fn plan_counts_only_applicable_work() {
        let mut plan = SyncPlan::new("/local".to_string(), "/remote".to_string());
        let file = entry(EntryKind::File, 10.0, Some(1_000.0));
        plan.record(SyncEntry::new("a.txt".to_string(), Some(&file), None));
        plan.record(SyncEntry::new(
            "b.txt".to_string(),
            Some(&file),
            Some(&file),
        ));
        plan.record(SyncEntry::new("c.txt".to_string(), None, Some(&file)));

        assert_eq!(plan.upload_files, 1);
        assert_eq!(plan.upload_bytes, 10.0);
        assert_eq!(plan.equal, 1);
        assert_eq!(plan.remote_only, 1);
    }
}
