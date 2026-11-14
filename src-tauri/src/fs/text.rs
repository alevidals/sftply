use crate::domain::fs::{EntryKind, FsEntry};
use crate::domain::text::{MAX_TEXT_FILE_BYTES, TextFile, text_version};
use crate::error::{AppError, ErrorCode};

/// Reject files that are too large before reading their contents.
pub fn check_size(size: u64) -> Result<(), AppError> {
    if size > MAX_TEXT_FILE_BYTES {
        return Err(AppError::new(
            ErrorCode::InvalidInput,
            "This file is too large to edit as text.",
        )
        .with_detail(format!(
            "{} bytes exceeds the {} byte limit",
            size, MAX_TEXT_FILE_BYTES
        )));
    }
    Ok(())
}

/// Reject binary data and invalid UTF-8. The editor only ever shows text it can
/// write back byte-for-byte.
pub fn decode(bytes: Vec<u8>, entry: &FsEntry) -> Result<TextFile, AppError> {
    if bytes.len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err(AppError::new(
            ErrorCode::InvalidInput,
            "This file is too large to edit as text.",
        ));
    }
    if bytes.contains(&0) {
        return Err(AppError::new(
            ErrorCode::Unsupported,
            "This looks like a binary file, so it cannot be edited as text.",
        ));
    }
    let content = String::from_utf8(bytes).map_err(|_| {
        AppError::new(
            ErrorCode::Unsupported,
            "This file is not valid UTF-8 text, so it cannot be edited here.",
        )
    })?;

    Ok(TextFile {
        path: entry.path.clone(),
        content,
        size: entry.size,
        modified_at: entry.modified_at,
        version: text_version(entry.size, entry.modified_at),
    })
}

/// Only regular files can be opened in the editor.
pub fn check_editable(entry: &FsEntry) -> Result<(), AppError> {
    if entry.kind != EntryKind::File {
        return Err(AppError::new(
            ErrorCode::InvalidInput,
            "Only regular files can be edited as text.",
        ));
    }
    check_size(entry.size as u64)
}

/// Refuse to save a body that grew past the editor limit.
pub fn check_content_size(content: &str) -> Result<(), AppError> {
    if content.len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err(AppError::new(
            ErrorCode::InvalidInput,
            "The edited text is too large to save.",
        ));
    }
    Ok(())
}

/// A clear conflict error that the UI can distinguish from other failures.
pub fn conflict_error() -> AppError {
    AppError::new(
        ErrorCode::Conflict,
        "The file changed on disk since it was opened.",
    )
    .with_detail("reload the file or overwrite it explicitly")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(size: f64) -> FsEntry {
        FsEntry {
            name: "notes.txt".into(),
            path: "/tmp/notes.txt".into(),
            kind: EntryKind::File,
            size,
            modified_at: Some(1_700_000_000_000.0),
            permissions: Some(0o644),
            owner: None,
            group: None,
            link_target: None,
            hidden: false,
            metadata_complete: true,
        }
    }

    #[test]
    fn decodes_utf8_text() {
        let file = decode("héllo\n".as_bytes().to_vec(), &entry(7.0)).unwrap();
        assert_eq!(file.content, "héllo\n");
        assert_eq!(file.version, "7:1700000000000");
    }

    #[test]
    fn rejects_binary_and_invalid_utf8() {
        assert_eq!(
            decode(vec![b'a', 0, b'b'], &entry(3.0)).unwrap_err().code,
            ErrorCode::Unsupported
        );
        assert_eq!(
            decode(vec![0xff, 0xfe], &entry(2.0)).unwrap_err().code,
            ErrorCode::Unsupported
        );
    }

    #[test]
    fn rejects_oversized_files_and_content() {
        assert_eq!(
            check_size(MAX_TEXT_FILE_BYTES + 1).unwrap_err().code,
            ErrorCode::InvalidInput
        );
        assert!(check_size(MAX_TEXT_FILE_BYTES).is_ok());
        let huge = "x".repeat(MAX_TEXT_FILE_BYTES as usize + 1);
        assert_eq!(
            check_content_size(&huge).unwrap_err().code,
            ErrorCode::InvalidInput
        );
    }

    #[test]
    fn only_regular_files_are_editable() {
        let mut folder = entry(0.0);
        folder.kind = EntryKind::Directory;
        assert_eq!(
            check_editable(&folder).unwrap_err().code,
            ErrorCode::InvalidInput
        );
    }

    #[test]
    fn conflict_uses_a_distinct_code() {
        assert_eq!(conflict_error().code, ErrorCode::Conflict);
    }
}
