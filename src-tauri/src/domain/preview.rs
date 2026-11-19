use serde::{Deserialize, Serialize};
use specta::Type;

/// Images above this size are not sent through IPC as a data URL.
pub const MAX_IMAGE_PREVIEW_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum PreviewKind {
    Text,
    Image,
}

/// A file preview. Text is rendered as preformatted text; images are rendered
/// as `<img>`. HTML and SVG are treated as text, never executed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PreviewPayload {
    pub kind: PreviewKind,
    pub path: String,
    pub content: Option<String>,
    pub mime_type: Option<String>,
    pub data_url: Option<String>,
    #[specta(type = specta_typescript::Number)]
    pub size: f64,
    #[specta(type = Option<specta_typescript::Number>)]
    pub modified_at: Option<f64>,
}

/// Only formats that browsers decode as raster images. SVG stays text, so it
/// can never execute script inside a preview.
pub fn image_mime(path: &str) -> Option<&'static str> {
    let extension = path.rsplit('.').next()?.to_ascii_lowercase();
    match extension.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "avif" => Some("image/avif"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_raster_image_extensions_case_insensitively() {
        assert_eq!(image_mime("/photos/a.PNG"), Some("image/png"));
        assert_eq!(image_mime("/photos/a.jpeg"), Some("image/jpeg"));
        assert_eq!(image_mime("/photos/a.webp"), Some("image/webp"));
    }

    #[test]
    fn svg_and_html_are_not_images() {
        assert_eq!(image_mime("/site/logo.svg"), None);
        assert_eq!(image_mime("/site/index.html"), None);
    }
}
