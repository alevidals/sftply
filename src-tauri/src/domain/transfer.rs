use serde::{Deserialize, Serialize};
use specta::Type;

use crate::domain::fs::EntryKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum TransferDirection {
    Upload,
    Download,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum TransferStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

/// What to do when the target already exists. "Skip" is handled by the UI
/// before enqueuing, because no transfer row is created for a skipped file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ConflictPolicy {
    Overwrite,
    Rename,
}

/// Public transfer row. It contains paths and counters only; credentials and
/// protocol handles never cross the IPC boundary.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TransferItem {
    pub id: String,
    pub direction: TransferDirection,
    pub status: TransferStatus,
    pub source_path: String,
    pub target_path: String,
    /// Display label for the local or remote side, for example a session name.
    pub source_label: String,
    pub target_label: String,
    pub name: String,
    #[specta(type = specta_typescript::Number)]
    pub size: f64,
    #[specta(type = specta_typescript::Number)]
    pub transferred: f64,
    #[specta(type = specta_typescript::Number)]
    pub bytes_per_sec: f64,
    #[specta(type = Option<specta_typescript::Number>)]
    pub eta_ms: Option<f64>,
    /// User-safe failure message. Technical detail stays in the logs.
    pub error: Option<String>,
    /// Unix epoch milliseconds, UTC.
    #[specta(type = specta_typescript::Number)]
    pub started_at: f64,
    #[specta(type = Option<specta_typescript::Number>)]
    pub finished_at: Option<f64>,
}

/// Existing target reported by `transfer_preflight`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TransferConflict {
    pub target_path: String,
    pub kind: EntryKind,
    #[specta(type = specta_typescript::Number)]
    pub size: f64,
    #[specta(type = Option<specta_typescript::Number>)]
    pub modified_at: Option<f64>,
}

/// One item discovered by a recursive transfer plan. Directories are included
/// so empty folders are recreated and the tree keeps its shape.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TransferPlanEntry {
    pub source_path: String,
    pub target_path: String,
    /// Path relative to the selected root, e.g. `photos/2024/a.jpg`.
    pub relative_path: String,
    pub kind: EntryKind,
    #[specta(type = specta_typescript::Number)]
    pub size: f64,
    /// Set when a file would replace an existing target.
    pub conflict: Option<TransferConflict>,
}

/// Result of walking one or more selected items before enqueuing them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TransferPlan {
    pub entries: Vec<TransferPlanEntry>,
    /// Symlinks and special files are never followed or copied silently.
    pub skipped: u32,
    #[specta(type = specta_typescript::Number)]
    pub total_bytes: f64,
}

/// Batched transfer updates. The backend coalesces progress to a few events per
/// second so a large transfer cannot saturate the WebView IPC bridge.
#[derive(Debug, Clone, Serialize, Deserialize, Type, tauri_specta::Event)]
#[tauri_specta(event_name = "transfer://delta")]
pub struct TransferDeltaEvent {
    pub upserts: Vec<TransferItem>,
    pub removed: Vec<String>,
}

impl TransferItem {
    pub fn new(
        direction: TransferDirection,
        source_path: String,
        target_path: String,
        source_label: String,
        target_label: String,
        name: String,
        size: f64,
    ) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            direction,
            status: TransferStatus::Queued,
            source_path,
            target_path,
            source_label,
            target_label,
            name,
            size,
            transferred: 0.0,
            bytes_per_sec: 0.0,
            eta_ms: None,
            error: None,
            started_at: crate::domain::activity::unix_millis(),
            finished_at: None,
        }
    }
}
