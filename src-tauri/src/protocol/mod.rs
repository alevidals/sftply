use async_trait::async_trait;

use crate::domain::fs::{FsCapabilities, FsEntry, Listing};
use crate::error::AppError;

pub mod ftp;
pub mod sftp;

/// Unified remote filesystem boundary. Implementations report their real
/// capabilities and must never emulate an operation the protocol cannot do.
#[async_trait]
pub trait RemoteFs: Send + Sync {
    async fn list(&mut self, path: &str) -> Result<Listing, AppError>;
    async fn stat(&mut self, path: &str) -> Result<FsEntry, AppError>;
    async fn mkdir(&mut self, parent: &str, name: &str) -> Result<FsEntry, AppError>;
    async fn rename(&mut self, path: &str, new_name: &str) -> Result<FsEntry, AppError>;
    async fn delete(&mut self, path: &str, recursive: bool) -> Result<(), AppError>;
    async fn chmod(&mut self, path: &str, mode: u32) -> Result<(), AppError>;
    async fn disconnect(&mut self) -> Result<(), AppError>;
    fn capabilities(&self) -> FsCapabilities;
}

/// Construct a listing with the shared shape used by both protocols. Entries
/// must already be sorted by the caller when the protocol does not guarantee an
/// order.
pub(crate) fn listing(
    path: String,
    parent: Option<String>,
    mut entries: Vec<FsEntry>,
    capabilities: FsCapabilities,
    warnings: Vec<String>,
) -> Listing {
    entries.sort_by_cached_key(|entry| {
        let directory_rank = u8::from(entry.kind != crate::domain::fs::EntryKind::Directory);
        (
            directory_rank,
            entry.name.to_lowercase(),
            entry.name.clone(),
        )
    });
    Listing {
        path,
        parent,
        entries,
        capabilities,
        read_at: crate::domain::activity::unix_millis(),
        warnings,
    }
}

/// Convert a protocol status into a stable, user-safe application error.
pub(crate) fn protocol_error(
    code: crate::error::ErrorCode,
    message: impl Into<String>,
    detail: impl Into<String>,
) -> AppError {
    AppError::new(code, message).with_detail(detail)
}

pub(crate) fn ms_from_secs(value: u64) -> f64 {
    value as f64 * 1000.0
}

/// Keep server-provided text short and free of control characters before it
/// is shown or stored in an error payload.
pub(crate) fn sanitize_detail(text: &str) -> String {
    let cleaned: String = text
        .chars()
        .filter(|character| !character.is_control() || *character == ' ')
        .take(300)
        .collect();
    cleaned.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_control_characters_and_length() {
        assert_eq!(sanitize_detail("  ok\r\nnext\tline  "), "oknextline");
        assert_eq!(sanitize_detail(&"x".repeat(400)).len(), 300);
        assert_eq!(sanitize_detail(""), "");
    }
}
