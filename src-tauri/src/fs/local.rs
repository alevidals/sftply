use std::io::ErrorKind;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use futures_util::stream::{self, StreamExt};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt, SeekFrom};

use crate::domain::fs::{EntryKind, FsCapabilities, FsEntry, Listing};
use crate::error::{AppError, ErrorCode};
use crate::fs::path::{join_child, normalize_absolute, validate_mode};
use crate::fs::{FileReader, FileWriter};

const METADATA_CONCURRENCY: usize = 64;

/// List a local directory. Entries are sorted with folders first, then by
/// case-insensitive name. Per-entry metadata failures are reported as warnings
/// instead of failing the whole listing.
pub async fn list(input: &str, show_hidden: bool) -> Result<Listing, AppError> {
    let path = normalize_absolute(input)?;
    let path_str = path_to_string(&path)?;

    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|error| io_error(error, "read", &path))?;
    if !metadata.is_dir() {
        return Err(AppError::invalid_input("That path is not a folder."));
    }

    let mut reader = tokio::fs::read_dir(&path)
        .await
        .map_err(|error| io_error(error, "open", &path))?;

    let mut candidates = Vec::new();
    while let Some(entry) = reader
        .next_entry()
        .await
        .map_err(|error| io_error(error, "read", &path))?
    {
        candidates.push(entry);
    }

    let total_candidates = candidates.len();
    let outcomes = stream::iter(candidates)
        .map(|entry| async move { entry_to_fs_entry(entry).await })
        .buffer_unordered(METADATA_CONCURRENCY)
        .collect::<Vec<_>>()
        .await;

    let mut entries = Vec::with_capacity(outcomes.len());
    let mut skipped = 0usize;
    for outcome in outcomes {
        match outcome {
            Some(entry) => {
                if show_hidden || !entry.hidden {
                    entries.push(entry);
                }
            }
            None => skipped += 1,
        }
    }

    entries.sort_by_cached_key(|entry| {
        let directory_rank = u8::from(entry.kind != EntryKind::Directory);
        (
            directory_rank,
            entry.name.to_lowercase(),
            entry.name.clone(),
        )
    });

    let mut warnings = Vec::new();
    if skipped > 0 {
        warnings.push(format!(
            "{skipped} of {total_candidates} items could not be displayed because their name or metadata is not readable as UTF-8."
        ));
    }

    Ok(Listing {
        path: path_str,
        parent: parent_string(&path),
        entries,
        capabilities: FsCapabilities::local(),
        read_at: now_ms(),
        warnings,
    })
}

pub async fn stat(input: &str) -> Result<FsEntry, AppError> {
    let path = normalize_absolute(input)?;
    let metadata = tokio::fs::symlink_metadata(&path)
        .await
        .map_err(|error| io_error(error, "inspect", &path))?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .or_else(|| path.to_str().map(str::to_string))
        .ok_or_else(|| AppError::invalid_input("The path is not valid UTF-8."))?;
    let path_str = path_to_string(&path)?;

    let kind = entry_kind(&metadata);
    let mut metadata_complete = true;
    let link_target = if kind == EntryKind::Symlink {
        match tokio::fs::read_link(&path).await {
            Ok(target) => target.to_str().map(str::to_string).or_else(|| {
                metadata_complete = false;
                None
            }),
            Err(_) => {
                metadata_complete = false;
                None
            }
        }
    } else {
        None
    };

    Ok(FsEntry {
        name,
        path: path_str,
        kind,
        size: size_of(&metadata, kind),
        modified_at: modified_ms(&metadata),
        permissions: permissions_of(&metadata),
        owner: None,
        group: None,
        link_target,
        hidden: is_hidden(&path, &metadata),
        metadata_complete,
    })
}

pub async fn mkdir(parent: &str, name: &str) -> Result<FsEntry, AppError> {
    let parent = normalize_absolute(parent)?;
    let target = join_child(&parent, name)?;
    tokio::fs::create_dir(&target)
        .await
        .map_err(|error| io_error(error, "create", &target))?;
    stat_path(&target).await
}

pub async fn rename(input: &str, new_name: &str) -> Result<FsEntry, AppError> {
    let source = normalize_absolute(input)?;
    let parent = source
        .parent()
        .ok_or_else(|| AppError::invalid_input("The root folder cannot be renamed."))?;
    let target = join_child(parent, new_name)?;

    if source != target {
        tokio::fs::rename(&source, &target)
            .await
            .map_err(|error| io_error(error, "rename", &source))?;
    }

    stat_path(&target).await
}

pub async fn delete(input: &str, recursive: bool) -> Result<(), AppError> {
    let path = normalize_absolute(input)?;
    if path.parent().is_none() {
        return Err(AppError::invalid_input(
            "The root folder cannot be deleted.",
        ));
    }

    let metadata = tokio::fs::symlink_metadata(&path)
        .await
        .map_err(|error| io_error(error, "inspect", &path))?;
    let file_type = metadata.file_type();

    let result = if file_type.is_dir() {
        if recursive {
            tokio::fs::remove_dir_all(&path).await
        } else {
            tokio::fs::remove_dir(&path).await
        }
    } else {
        tokio::fs::remove_file(&path).await
    };

    result.map_err(|error| io_error(error, "delete", &path))
}

pub fn chmod(input: &str, mode: u32) -> Result<(), AppError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let path = normalize_absolute(input)?;
        validate_mode(mode)?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode))
            .map_err(|error| io_error(error, "change permissions on", &path))
    }
    #[cfg(not(unix))]
    {
        let _ = (input, mode);
        Err(AppError::new(
            ErrorCode::Unsupported,
            "Changing permissions is not supported on this platform.",
        ))
    }
}

async fn stat_path(path: &Path) -> Result<FsEntry, AppError> {
    let path = path_to_string(path)?;
    stat(&path).await
}

async fn entry_to_fs_entry(entry: tokio::fs::DirEntry) -> Option<FsEntry> {
    let name = entry.file_name().to_str().map(str::to_string)?;
    let path = entry.path();
    let path_str = path.to_str().map(str::to_string)?;
    let metadata = entry.metadata().await.ok()?;
    let kind = entry_kind(&metadata);

    let mut metadata_complete = true;
    let link_target = if kind == EntryKind::Symlink {
        match tokio::fs::read_link(&path).await {
            Ok(target) => target.to_str().map(str::to_string).or_else(|| {
                metadata_complete = false;
                None
            }),
            Err(_) => {
                metadata_complete = false;
                None
            }
        }
    } else {
        None
    };

    Some(FsEntry {
        hidden: is_hidden(&path, &metadata),
        name,
        path: path_str,
        kind,
        size: size_of(&metadata, kind),
        modified_at: modified_ms(&metadata),
        permissions: permissions_of(&metadata),
        owner: None,
        group: None,
        link_target,
        metadata_complete,
    })
}

fn entry_kind(metadata: &std::fs::Metadata) -> EntryKind {
    let file_type = metadata.file_type();
    if file_type.is_symlink() {
        EntryKind::Symlink
    } else if file_type.is_dir() {
        EntryKind::Directory
    } else if file_type.is_file() {
        EntryKind::File
    } else {
        EntryKind::Other
    }
}

fn size_of(metadata: &std::fs::Metadata, kind: EntryKind) -> f64 {
    if kind == EntryKind::Directory {
        0.0
    } else {
        metadata.len() as f64
    }
}

fn modified_ms(metadata: &std::fs::Metadata) -> Option<f64> {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as f64)
}

fn permissions_of(metadata: &std::fs::Metadata) -> Option<u32> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        Some(metadata.permissions().mode() & 0o7777)
    }
    #[cfg(not(unix))]
    {
        let _ = metadata;
        None
    }
}

fn is_hidden(path: &Path, metadata: &std::fs::Metadata) -> bool {
    let dot_hidden = path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with('.'));

    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        dot_hidden || metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0
    }
    #[cfg(not(windows))]
    {
        let _ = metadata;
        dot_hidden
    }
}

fn parent_string(path: &Path) -> Option<String> {
    path.parent().and_then(Path::to_str).map(str::to_string)
}

fn path_to_string(path: &Path) -> Result<String, AppError> {
    path.to_str()
        .map(str::to_string)
        .ok_or_else(|| AppError::invalid_input("The path is not valid UTF-8."))
}

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as f64)
        .unwrap_or(0.0)
}

/// Streaming local reader used by downloads/uploads. The file handle is kept
/// open for the lifetime of the transfer and closed when the value is dropped.
pub struct LocalReader {
    file: tokio::fs::File,
}

impl LocalReader {
    pub async fn open(path: &str, offset: u64) -> Result<Self, AppError> {
        let path = normalize_absolute(path)?;
        let mut file = tokio::fs::File::open(&path)
            .await
            .map_err(|error| io_error(error, "open", &path))?;
        if offset > 0 {
            file.seek(SeekFrom::Start(offset))
                .await
                .map_err(|error| io_error(error, "seek", &path))?;
        }
        Ok(Self { file })
    }
}

#[async_trait]
impl FileReader for LocalReader {
    async fn read(&mut self, buf: &mut [u8]) -> Result<usize, AppError> {
        self.file.read(buf).await.map_err(AppError::from)
    }

    async fn finish(self: Box<Self>) -> Result<(), AppError> {
        Ok(())
    }
}

/// Streaming local writer. Offset zero truncates the file; a non-zero offset
/// resumes without truncating.
pub struct LocalWriter {
    file: tokio::fs::File,
}

impl LocalWriter {
    pub async fn open(path: &str, offset: u64) -> Result<Self, AppError> {
        let path = normalize_absolute(path)?;
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(offset == 0)
            .open(&path)
            .await
            .map_err(|error| io_error(error, "open", &path))?;
        if offset > 0 {
            file.seek(SeekFrom::Start(offset))
                .await
                .map_err(|error| io_error(error, "seek", &path))?;
        }
        Ok(Self { file })
    }
}

#[async_trait]
impl FileWriter for LocalWriter {
    async fn write(&mut self, buf: &[u8]) -> Result<usize, AppError> {
        self.file.write(buf).await.map_err(AppError::from)
    }

    async fn finish(mut self: Box<Self>) -> Result<(), AppError> {
        self.file.flush().await.map_err(AppError::from)
    }

    async fn abort(self: Box<Self>) -> Result<(), AppError> {
        Ok(())
    }
}

fn io_error(error: std::io::Error, action: &str, path: &Path) -> AppError {
    let (code, message) = match error.kind() {
        ErrorKind::NotFound => (ErrorCode::NotFound, "That item no longer exists."),
        ErrorKind::PermissionDenied => (
            ErrorCode::PermissionDenied,
            "You do not have permission to do that.",
        ),
        ErrorKind::AlreadyExists => (
            ErrorCode::AlreadyExists,
            "An item with that name already exists.",
        ),
        ErrorKind::InvalidInput => (ErrorCode::InvalidInput, "That path is not valid."),
        ErrorKind::StorageFull => (ErrorCode::Internal, "The disk is full."),
        _ => (ErrorCode::Internal, "A filesystem operation failed."),
    };

    AppError::new(code, message).with_detail(format!("{action} {}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(path: &Path, contents: &str) {
        fs::write(path, contents).unwrap();
    }

    #[tokio::test]
    async fn lists_folders_first_and_filters_hidden_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir(root.join("folder")).unwrap();
        write(&root.join("b.txt"), "hello");
        write(&root.join("A.txt"), "hello");
        write(&root.join(".secret"), "hidden");

        let listing = list(root.to_str().unwrap(), false).await.unwrap();
        let names: Vec<_> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["folder", "A.txt", "b.txt"]);
        assert_eq!(listing.entries[0].kind, EntryKind::Directory);
        assert_eq!(listing.entries[1].size, 5.0);
        assert_eq!(listing.entries[1].kind, EntryKind::File);
        assert!(listing.warnings.is_empty());

        let with_hidden = list(root.to_str().unwrap(), true).await.unwrap();
        assert!(
            with_hidden
                .entries
                .iter()
                .any(|entry| entry.name == ".secret" && entry.hidden)
        );
    }

    #[tokio::test]
    async fn creates_renames_and_deletes_items() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        let created = mkdir(root.to_str().unwrap(), "drafts").await.unwrap();
        assert_eq!(created.kind, EntryKind::Directory);
        assert!(root.join("drafts").is_dir());

        write(&root.join("drafts").join("note.txt"), "note");
        let renamed = rename(root.join("drafts").to_str().unwrap(), "archive")
            .await
            .unwrap();
        assert_eq!(renamed.name, "archive");
        assert!(!root.join("drafts").exists());
        assert!(root.join("archive/note.txt").exists());

        delete(root.join("archive").to_str().unwrap(), true)
            .await
            .unwrap();
        assert!(!root.join("archive").exists());
    }

    #[tokio::test]
    async fn refuses_to_delete_non_empty_folder_without_recursion() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir(root.join("full")).unwrap();
        write(&root.join("full/file.txt"), "x");

        let error = delete(root.join("full").to_str().unwrap(), false)
            .await
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::Internal);
        assert!(root.join("full").exists());
    }

    #[tokio::test]
    async fn reports_missing_items() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing");
        let error = stat(missing.to_str().unwrap()).await.unwrap_err();
        assert_eq!(error.code, ErrorCode::NotFound);
    }

    #[tokio::test]
    async fn rejects_relative_paths_and_traversal_names() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        assert!(list("relative", false).await.is_err());
        assert!(mkdir(root.to_str().unwrap(), "../escape").await.is_err());
        assert!(mkdir(root.to_str().unwrap(), "a/b").await.is_err());
        assert!(mkdir(root.to_str().unwrap(), "..").await.is_err());
    }

    #[tokio::test]
    async fn lists_symlinks_with_targets() {
        #[cfg(unix)]
        {
            let dir = tempfile::tempdir().unwrap();
            let root = dir.path();
            write(&root.join("target.txt"), "x");
            std::os::unix::fs::symlink("target.txt", root.join("link.txt")).unwrap();

            let listing = list(root.to_str().unwrap(), false).await.unwrap();
            let link = listing
                .entries
                .iter()
                .find(|entry| entry.name == "link.txt")
                .unwrap();
            assert_eq!(link.kind, EntryKind::Symlink);
            assert_eq!(link.link_target.as_deref(), Some("target.txt"));
        }
    }

    #[tokio::test]
    async fn chmod_updates_unix_permissions() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            let dir = tempfile::tempdir().unwrap();
            let file = dir.path().join("script.sh");
            write(&file, "#!/bin/sh\n");
            chmod(file.to_str().unwrap(), 0o640).unwrap();
            let mode = fs::metadata(&file).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o640);
            assert!(chmod(file.to_str().unwrap(), 0o10000).is_err());
        }
    }

    #[test]
    fn maps_io_error_kinds_to_stable_codes() {
        let path = Path::new("/tmp/x");
        let missing = io_error(std::io::Error::from(ErrorKind::NotFound), "read", path);
        assert_eq!(missing.code, ErrorCode::NotFound);
        let denied = io_error(
            std::io::Error::from(ErrorKind::PermissionDenied),
            "read",
            path,
        );
        assert_eq!(denied.code, ErrorCode::PermissionDenied);
        let full = io_error(std::io::Error::from(ErrorKind::StorageFull), "write", path);
        assert_eq!(full.code, ErrorCode::Internal);
        assert_eq!(full.message, "The disk is full.");
    }

    #[tokio::test]
    async fn listing_timestamps_are_milliseconds() {
        let dir = tempfile::tempdir().unwrap();
        write(&dir.path().join("a.txt"), "a");
        let listing = list(dir.path().to_str().unwrap(), false).await.unwrap();
        let modified = listing.entries[0].modified_at.unwrap();
        assert!(modified > 1_600_000_000_000.0);
    }

    /// Performance budget for a very large folder. Listing is budgeted at
    /// under two seconds on a typical development machine; the assertion uses
    /// five seconds so slow CI hardware does not produce false failures.
    #[tokio::test]
    async fn lists_ten_thousand_entries_within_budget() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        for index in 0..10_000 {
            fs::write(root.join(format!("entry-{index:05}.txt")), b"x").unwrap();
        }

        let started = std::time::Instant::now();
        let listing = list(root.to_str().unwrap(), false).await.unwrap();
        let elapsed = started.elapsed();

        assert_eq!(listing.entries.len(), 10_000);
        println!("listed 10k entries in {elapsed:?}");
        assert!(
            elapsed < std::time::Duration::from_secs(5),
            "listing 10k entries took {elapsed:?}, over the 5s test budget"
        );
    }
}
