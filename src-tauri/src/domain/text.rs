use serde::{Deserialize, Serialize};
use specta::Type;

/// The largest file the text editor will load. Binary and oversized files are
/// rejected by the backend instead of being truncated silently.
pub const MAX_TEXT_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// A UTF-8 text file loaded for editing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    pub path: String,
    pub content: String,
    #[specta(type = specta_typescript::Number)]
    pub size: f64,
    #[specta(type = Option<specta_typescript::Number>)]
    pub modified_at: Option<f64>,
    /// Opaque token used to detect an external edit between load and save.
    pub version: String,
}

/// Build the conflict token from the metadata observed when the file was read.
/// Size and modification time are both used because FTP servers sometimes only
/// report minute-resolution timestamps.
pub fn text_version(size: f64, modified_at: Option<f64>) -> String {
    format!("{size:.0}:{:.0}", modified_at.unwrap_or(0.0))
}
