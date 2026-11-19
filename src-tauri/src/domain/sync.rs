use serde::{Deserialize, Serialize};
use specta::Type;

use crate::domain::fs::{EntryKind, FsEntry};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SyncDirection {
    Upload,
    Download,
}

/// Result of comparing one local entry with its remote counterpart.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SyncEntryStatus {
    /// Present locally, missing remotely.
    LocalOnly,
    /// Present remotely, missing locally.
    RemoteOnly,
    /// Both sides exist as files and the sizes differ.
    SizeDiffers,
    /// Both sides have the same size but different modification times. Content
    /// verification can turn this into `EqualContent` or `ContentDiffers`.
    DateDiffers,
    /// Content verification found different bytes.
    ContentDiffers,
    /// Both sides exist with the same size and modification time.
    Equal,
    /// Content verification found the same bytes despite different timestamps.
    EqualContent,
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
    Download,
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
    /// Where a remote source would be written on the local side. Present even
    /// for remote-only entries, so the UI does not have to join paths.
    pub local_target_path: Option<String>,
    /// Where a local source would be written on the remote side. Present even
    /// for local-only entries.
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
    pub fn new(
        direction: SyncDirection,
        relative_path: String,
        local: Option<&FsEntry>,
        remote: Option<&FsEntry>,
    ) -> Self {
        let (status, action) = classify(direction, local, remote);
        let name = local
            .or(remote)
            .map(|entry| entry.name.clone())
            .unwrap_or_default();
        Self {
            relative_path,
            name,
            local_path: local.map(|entry| entry.path.clone()),
            remote_path: remote.map(|entry| entry.path.clone()),
            local_target_path: None,
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

    pub fn with_target(mut self, direction: SyncDirection, path: String) -> Self {
        match direction {
            SyncDirection::Upload => self.remote_target_path = Some(path),
            SyncDirection::Download => self.local_target_path = Some(path),
        }
        self
    }
}

/// A target that no longer matches the dry-run.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SyncValidationIssue {
    pub relative_path: String,
    pub target_path: String,
    pub reason: String,
}

/// The complete dry-run. Applying it is a separate, explicit step.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SyncPlan {
    pub direction: SyncDirection,
    pub local_root: String,
    pub remote_root: String,
    pub entries: Vec<SyncEntry>,
    pub transfer_files: u32,
    #[specta(type = specta_typescript::Number)]
    pub transfer_bytes: f64,
    pub create_directories: u32,
    /// Size or content differences that would replace a target file.
    pub changed: u32,
    /// Same size, different date, content not verified (or verification skipped).
    pub date_differs: u32,
    pub equal: u32,
    /// Equal after a bounded content check.
    pub equal_content: u32,
    pub local_only: u32,
    pub remote_only: u32,
    pub unknown: u32,
    pub conflicts: u32,
    pub skipped: u32,
    /// True when the walk hit the entry limit before finishing.
    pub truncated: bool,
    pub warnings: Vec<String>,
}

impl SyncPlan {
    pub fn new(direction: SyncDirection, local_root: String, remote_root: String) -> Self {
        Self {
            direction,
            local_root,
            remote_root,
            entries: Vec::new(),
            transfer_files: 0,
            transfer_bytes: 0.0,
            create_directories: 0,
            changed: 0,
            date_differs: 0,
            equal: 0,
            equal_content: 0,
            local_only: 0,
            remote_only: 0,
            unknown: 0,
            conflicts: 0,
            skipped: 0,
            truncated: false,
            warnings: Vec::new(),
        }
    }

    pub fn record(&mut self, entry: SyncEntry) {
        self.count(
            entry.action,
            entry.status,
            entry.local_size,
            entry.remote_size,
        );
        self.entries.push(entry);
    }

    /// Recalculate the summary after content verification changed statuses.
    pub fn recount(&mut self) {
        self.transfer_files = 0;
        self.transfer_bytes = 0.0;
        self.create_directories = 0;
        self.changed = 0;
        self.date_differs = 0;
        self.equal = 0;
        self.equal_content = 0;
        self.local_only = 0;
        self.remote_only = 0;
        self.unknown = 0;
        self.conflicts = 0;
        self.skipped = 0;
        for index in 0..self.entries.len() {
            let entry = &self.entries[index];
            self.count(
                entry.action,
                entry.status,
                entry.local_size,
                entry.remote_size,
            );
        }
    }

    fn count(
        &mut self,
        action: SyncAction,
        status: SyncEntryStatus,
        local_size: Option<f64>,
        remote_size: Option<f64>,
    ) {
        match action {
            SyncAction::Upload | SyncAction::Download => {
                self.transfer_files += 1;
                self.transfer_bytes += match action {
                    SyncAction::Upload => local_size.unwrap_or(0.0),
                    SyncAction::Download => remote_size.unwrap_or(0.0),
                    _ => 0.0,
                };
                if matches!(
                    status,
                    SyncEntryStatus::SizeDiffers | SyncEntryStatus::ContentDiffers
                ) {
                    self.changed += 1;
                }
            }
            SyncAction::CreateDirectory => self.create_directories += 1,
            SyncAction::Skip => match status {
                SyncEntryStatus::Equal | SyncEntryStatus::EqualContent => {
                    self.equal += 1;
                    if status == SyncEntryStatus::EqualContent {
                        self.equal_content += 1;
                    }
                }
                SyncEntryStatus::LocalOnly => self.local_only += 1,
                SyncEntryStatus::RemoteOnly => self.remote_only += 1,
                SyncEntryStatus::Unsupported => self.skipped += 1,
                _ => {}
            },
            SyncAction::Review => match status {
                SyncEntryStatus::DateDiffers => self.date_differs += 1,
                SyncEntryStatus::Unknown => self.unknown += 1,
                SyncEntryStatus::TypeMismatch => self.conflicts += 1,
                _ => {}
            },
        }
    }
}

/// Compare two entries with the 1.2 policy: metadata first, one-way transfer,
/// and anything uncertain goes to manual review instead of being overwritten.
pub fn classify(
    direction: SyncDirection,
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
                EntryKind::File => compare_files(direction, local, remote),
                EntryKind::Symlink | EntryKind::Other => {
                    (SyncEntryStatus::Unsupported, SyncAction::Skip)
                }
            }
        }
        (Some(local), None) => match local.kind {
            EntryKind::File => match direction {
                SyncDirection::Upload => (SyncEntryStatus::LocalOnly, SyncAction::Upload),
                SyncDirection::Download => (SyncEntryStatus::LocalOnly, SyncAction::Skip),
            },
            EntryKind::Directory => match direction {
                SyncDirection::Upload => (SyncEntryStatus::LocalOnly, SyncAction::CreateDirectory),
                SyncDirection::Download => (SyncEntryStatus::LocalOnly, SyncAction::Skip),
            },
            EntryKind::Symlink | EntryKind::Other => {
                (SyncEntryStatus::Unsupported, SyncAction::Skip)
            }
        },
        (None, Some(remote)) => match remote.kind {
            EntryKind::File => match direction {
                SyncDirection::Upload => (SyncEntryStatus::RemoteOnly, SyncAction::Skip),
                SyncDirection::Download => (SyncEntryStatus::RemoteOnly, SyncAction::Download),
            },
            EntryKind::Directory => match direction {
                SyncDirection::Upload => (SyncEntryStatus::RemoteOnly, SyncAction::Skip),
                SyncDirection::Download => {
                    (SyncEntryStatus::RemoteOnly, SyncAction::CreateDirectory)
                }
            },
            EntryKind::Symlink | EntryKind::Other => {
                (SyncEntryStatus::Unsupported, SyncAction::Skip)
            }
        },
        (None, None) => (SyncEntryStatus::Unsupported, SyncAction::Skip),
    }
}

/// FTP and SFTP often report timestamps with second or even minute precision.
/// Comparing raw milliseconds would re-upload unchanged files, so allow a
/// small clock and precision window.
const MTIME_TOLERANCE_MS: f64 = 2_000.0;

fn compare_files(
    direction: SyncDirection,
    local: &FsEntry,
    remote: &FsEntry,
) -> (SyncEntryStatus, SyncAction) {
    if !local.metadata_complete || !remote.metadata_complete {
        return (SyncEntryStatus::Unknown, SyncAction::Review);
    }
    if local.size != remote.size {
        return (SyncEntryStatus::SizeDiffers, transfer_action(direction));
    }
    match (local.modified_at, remote.modified_at) {
        (Some(left), Some(right)) if (left - right).abs() <= MTIME_TOLERANCE_MS => {
            (SyncEntryStatus::Equal, SyncAction::Skip)
        }
        (Some(_), Some(_)) => (SyncEntryStatus::DateDiffers, SyncAction::Review),
        _ => (SyncEntryStatus::Unknown, SyncAction::Review),
    }
}

fn transfer_action(direction: SyncDirection) -> SyncAction {
    match direction {
        SyncDirection::Upload => SyncAction::Upload,
        SyncDirection::Download => SyncAction::Download,
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
            classify(SyncDirection::Upload, Some(&local), Some(&remote)),
            (SyncEntryStatus::Equal, SyncAction::Skip)
        );
    }

    #[test]
    fn size_difference_transfers_in_the_selected_direction() {
        let local = entry(EntryKind::File, 10.0, Some(1_000.0));
        let remote = entry(EntryKind::File, 11.0, Some(1_000.0));
        assert_eq!(
            classify(SyncDirection::Upload, Some(&local), Some(&remote)),
            (SyncEntryStatus::SizeDiffers, SyncAction::Upload)
        );
        assert_eq!(
            classify(SyncDirection::Download, Some(&local), Some(&remote)),
            (SyncEntryStatus::SizeDiffers, SyncAction::Download)
        );
    }

    #[test]
    fn date_difference_needs_review() {
        let local = entry(EntryKind::File, 10.0, Some(1_000.0));
        let remote = entry(EntryKind::File, 10.0, Some(5_000.0));
        assert_eq!(
            classify(SyncDirection::Upload, Some(&local), Some(&remote)),
            (SyncEntryStatus::DateDiffers, SyncAction::Review)
        );
    }

    #[test]
    fn mtime_precision_is_tolerated() {
        let local = entry(EntryKind::File, 10.0, Some(1_000.0));
        let remote = entry(EntryKind::File, 10.0, Some(1_500.0));
        assert_eq!(
            classify(SyncDirection::Upload, Some(&local), Some(&remote)),
            (SyncEntryStatus::Equal, SyncAction::Skip)
        );
    }

    #[test]
    fn missing_mtime_requires_review() {
        let local = entry(EntryKind::File, 10.0, None);
        let remote = entry(EntryKind::File, 10.0, Some(2_000.0));
        assert_eq!(
            classify(SyncDirection::Upload, Some(&local), Some(&remote)),
            (SyncEntryStatus::Unknown, SyncAction::Review)
        );
    }

    #[test]
    fn incomplete_metadata_requires_review() {
        let local = entry(EntryKind::File, 10.0, Some(1_000.0));
        let mut remote = entry(EntryKind::File, 11.0, Some(2_000.0));
        remote.metadata_complete = false;
        assert_eq!(
            classify(SyncDirection::Upload, Some(&local), Some(&remote)),
            (SyncEntryStatus::Unknown, SyncAction::Review)
        );
    }

    #[test]
    fn one_sided_entries_use_the_direction() {
        let file = entry(EntryKind::File, 10.0, Some(1_000.0));
        let directory = entry(EntryKind::Directory, 0.0, None);

        assert_eq!(
            classify(SyncDirection::Upload, Some(&file), None),
            (SyncEntryStatus::LocalOnly, SyncAction::Upload)
        );
        assert_eq!(
            classify(SyncDirection::Download, Some(&file), None),
            (SyncEntryStatus::LocalOnly, SyncAction::Skip)
        );
        assert_eq!(
            classify(SyncDirection::Upload, None, Some(&file)),
            (SyncEntryStatus::RemoteOnly, SyncAction::Skip)
        );
        assert_eq!(
            classify(SyncDirection::Download, None, Some(&file)),
            (SyncEntryStatus::RemoteOnly, SyncAction::Download)
        );
        assert_eq!(
            classify(SyncDirection::Download, None, Some(&directory)),
            (SyncEntryStatus::RemoteOnly, SyncAction::CreateDirectory)
        );
        assert_eq!(
            classify(SyncDirection::Upload, Some(&directory), None),
            (SyncEntryStatus::LocalOnly, SyncAction::CreateDirectory)
        );
    }

    #[test]
    fn type_mismatch_is_not_applied() {
        let local = entry(EntryKind::File, 10.0, Some(1_000.0));
        let remote = entry(EntryKind::Directory, 0.0, None);
        assert_eq!(
            classify(SyncDirection::Upload, Some(&local), Some(&remote)),
            (SyncEntryStatus::TypeMismatch, SyncAction::Review)
        );
    }

    #[test]
    fn symlinks_are_not_followed() {
        let link = entry(EntryKind::Symlink, 0.0, None);
        assert_eq!(
            classify(SyncDirection::Upload, Some(&link), None),
            (SyncEntryStatus::Unsupported, SyncAction::Skip)
        );
    }

    #[test]
    fn plan_counts_only_applicable_work() {
        let mut plan = SyncPlan::new(
            SyncDirection::Download,
            "/local".to_string(),
            "/remote".to_string(),
        );
        let file = entry(EntryKind::File, 10.0, Some(1_000.0));
        plan.record(SyncEntry::new(
            SyncDirection::Download,
            "a.txt".to_string(),
            None,
            Some(&file),
        ));
        plan.record(SyncEntry::new(
            SyncDirection::Download,
            "b.txt".to_string(),
            Some(&file),
            Some(&file),
        ));
        let newer = entry(EntryKind::File, 10.0, Some(5_000.0));
        plan.record(SyncEntry::new(
            SyncDirection::Download,
            "c.txt".to_string(),
            Some(&file),
            Some(&newer),
        ));

        assert_eq!(plan.transfer_files, 1);
        assert_eq!(plan.transfer_bytes, 10.0);
        assert_eq!(plan.equal, 1);
        assert_eq!(plan.date_differs, 1);

        plan.entries[2].status = SyncEntryStatus::EqualContent;
        plan.entries[2].action = SyncAction::Skip;
        plan.recount();
        assert_eq!(plan.date_differs, 0);
        assert_eq!(plan.equal, 2);
        assert_eq!(plan.equal_content, 1);
    }
}
