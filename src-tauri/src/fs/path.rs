use std::path::{Component, Path, PathBuf};

use crate::error::AppError;

/// Validate and lexically normalize an absolute local path.
///
/// Normalization removes `.` and resolves `..` without touching the
/// filesystem. `..` never climbs above the root. Symlinks are intentionally not
/// resolved here; callers that need canonical paths do so explicitly.
pub fn normalize_absolute(input: &str) -> Result<PathBuf, AppError> {
    if input.is_empty() {
        return Err(AppError::invalid_input("A path is required."));
    }
    if input.contains('\0') {
        return Err(AppError::invalid_input(
            "The path contains an invalid character.",
        ));
    }

    let path = Path::new(input);
    if !path.is_absolute() {
        return Err(AppError::invalid_input("Local paths must be absolute."));
    }

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(std::path::MAIN_SEPARATOR_STR),
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(part) => normalized.push(part),
        }
    }

    if normalized.as_os_str().is_empty() {
        normalized.push(std::path::MAIN_SEPARATOR_STR);
    }

    Ok(normalized)
}

/// Validate a single file or folder name before joining it to a directory.
/// This blocks separators, traversal names, NUL, and platform-reserved names so
/// a bad listing or user input cannot escape the selected folder.
pub fn validate_name(name: &str) -> Result<(), AppError> {
    if name.is_empty() {
        return Err(AppError::invalid_input("A name is required."));
    }
    if name == "." || name == ".." {
        return Err(AppError::invalid_input("That name is reserved."));
    }
    if name.contains('\0') || name.chars().any(std::path::is_separator) {
        return Err(AppError::invalid_input(
            "Names cannot contain path separators.",
        ));
    }
    if name.len() > 255 {
        return Err(AppError::invalid_input(
            "The name is too long for this filesystem.",
        ));
    }

    #[cfg(windows)]
    {
        const RESERVED: &[&str] = &[
            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
            "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
        ];
        const INVALID: &[char] = &['<', '>', ':', '"', '|', '?', '*'];

        if name.chars().any(|c| INVALID.contains(&c)) || name.ends_with(' ') || name.ends_with('.')
        {
            return Err(AppError::invalid_input(
                "The name contains characters that Windows does not allow.",
            ));
        }
        let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
        if RESERVED.contains(&stem.as_str()) {
            return Err(AppError::invalid_input("That name is reserved by Windows."));
        }
    }

    Ok(())
}

/// Join a validated child name to a parent path.
pub fn join_child(parent: &Path, name: &str) -> Result<PathBuf, AppError> {
    validate_name(name)?;
    Ok(parent.join(name))
}

/// Validate Unix mode bits accepted by chmod.
pub fn validate_mode(mode: u32) -> Result<(), AppError> {
    if mode > 0o7777 {
        return Err(AppError::invalid_input(
            "Permissions must be between 0000 and 7777.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_dot_segments_without_touching_the_filesystem() {
        assert_eq!(
            normalize_absolute("/a/./b/../c").unwrap(),
            PathBuf::from("/a/c")
        );
    }

    #[test]
    fn parent_never_climbs_above_root() {
        assert_eq!(
            normalize_absolute("/../../etc").unwrap(),
            PathBuf::from("/etc")
        );
    }

    #[test]
    fn rejects_relative_paths() {
        assert!(normalize_absolute("relative/path").is_err());
    }

    #[test]
    fn rejects_empty_and_nul_paths() {
        assert!(normalize_absolute("").is_err());
        assert!(normalize_absolute("/tmp/\0bad").is_err());
    }

    #[test]
    fn validates_names() {
        assert!(validate_name("report.pdf").is_ok());
        assert!(validate_name(".hidden").is_ok());
        assert!(validate_name("...").is_ok());
        assert!(validate_name("").is_err());
        assert!(validate_name(".").is_err());
        assert!(validate_name("..").is_err());
        assert!(validate_name("a/b").is_err());
        assert!(validate_name("a\0b").is_err());
        assert!(validate_name(&"x".repeat(256)).is_err());
    }

    #[test]
    fn validates_mode_bits() {
        assert!(validate_mode(0o000).is_ok());
        assert!(validate_mode(0o644).is_ok());
        assert!(validate_mode(0o7777).is_ok());
        assert!(validate_mode(0o10000).is_err());
    }
}
