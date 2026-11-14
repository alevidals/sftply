use serde::{Deserialize, Serialize};
use specta::Type;

/// The kind of a filesystem entry as reported by the backend. Symlinks are
/// reported as links even when their target is a directory; callers decide
/// whether to follow them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Directory,
    Symlink,
    Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    /// Absolute local path or POSIX remote path.
    pub path: String,
    pub kind: EntryKind,
    /// Bytes. Directories report 0 unless the platform supplies a size.
    #[specta(type = specta_typescript::Number)]
    pub size: f64,
    /// Unix epoch milliseconds, UTC.
    #[specta(type = Option<specta_typescript::Number>)]
    pub modified_at: Option<f64>,
    /// Unix mode bits, e.g. `0o644`. `None` when unavailable.
    pub permissions: Option<u32>,
    pub owner: Option<String>,
    pub group: Option<String>,
    pub link_target: Option<String>,
    pub hidden: bool,
    /// False when some metadata could not be read or a name was lossy.
    pub metadata_complete: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ResumeSupport {
    Supported,
    Conditional,
    Unsupported,
}

/// Operations the active backend can perform honestly. The UI disables
/// actions that are not supported instead of emulating them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FsCapabilities {
    pub list: bool,
    pub mkdir: bool,
    pub remove: bool,
    pub rename: bool,
    pub chmod: bool,
    pub chown: bool,
    pub symlinks: bool,
    pub unix_permissions: bool,
    pub detailed_listing: bool,
    pub resume_download: ResumeSupport,
    pub resume_upload: ResumeSupport,
    pub server_side_move: bool,
    pub server_side_copy: bool,
    pub text_read: bool,
    pub text_write: bool,
}

impl FsCapabilities {
    pub fn local() -> Self {
        Self {
            list: true,
            mkdir: true,
            remove: true,
            rename: true,
            chmod: cfg!(unix),
            chown: false,
            symlinks: true,
            unix_permissions: cfg!(unix),
            detailed_listing: true,
            resume_download: ResumeSupport::Supported,
            resume_upload: ResumeSupport::Supported,
            server_side_move: false,
            server_side_copy: false,
            text_read: true,
            text_write: true,
        }
    }

    /// Remote scopes are not implemented yet; report no capabilities rather
    /// than pretending listings exist.
    #[allow(dead_code)] // Used when remote scopes arrive in Phase 3.
    pub fn unavailable() -> Self {
        Self {
            list: false,
            mkdir: false,
            remove: false,
            rename: false,
            chmod: false,
            chown: false,
            symlinks: false,
            unix_permissions: false,
            detailed_listing: false,
            resume_download: ResumeSupport::Unsupported,
            resume_upload: ResumeSupport::Unsupported,
            server_side_move: false,
            server_side_copy: false,
            text_read: false,
            text_write: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub path: String,
    pub parent: Option<String>,
    pub entries: Vec<FsEntry>,
    pub capabilities: FsCapabilities,
    /// Unix epoch milliseconds, UTC.
    #[specta(type = specta_typescript::Number)]
    pub read_at: f64,
    /// Non-fatal problems such as entries that could not be read.
    pub warnings: Vec<String>,
}

/// Identifies the filesystem used by a command. The backend resolves the
/// scope and never accepts caller-supplied protocol or credential data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum FsScope {
    Local,
    Remote { session_id: String },
}
