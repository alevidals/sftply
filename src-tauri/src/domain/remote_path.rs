use crate::error::AppError;

/// Maximum accepted length for a remote path or single name segment.
const MAX_PATH_LEN: usize = 4096;
const MAX_NAME_LEN: usize = 255;

/// Normalize an absolute POSIX remote path.
///
/// Duplicate slashes and `.` segments are removed and `..` is resolved
/// lexically without ever climbing above `/`. No server is contacted and no
/// symlink is resolved, so this is safe to run on untrusted input.
pub fn normalize_remote(input: &str) -> Result<String, AppError> {
    if input.is_empty() {
        return Err(AppError::invalid_input("A remote path is required."));
    }
    if input.len() > MAX_PATH_LEN {
        return Err(AppError::invalid_input("The remote path is too long."));
    }
    if input.contains('\0') {
        return Err(AppError::invalid_input(
            "The remote path contains an invalid character.",
        ));
    }
    if !input.starts_with('/') {
        return Err(AppError::invalid_input("Remote paths must be absolute."));
    }

    let mut segments: Vec<&str> = Vec::new();
    for segment in input.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            part => {
                if part.len() > MAX_NAME_LEN {
                    return Err(AppError::invalid_input(
                        "A path segment is too long for a remote server.",
                    ));
                }
                segments.push(part);
            }
        }
    }

    if segments.is_empty() {
        Ok("/".to_string())
    } else {
        Ok(format!("/{}", segments.join("/")))
    }
}

/// Validate a name supplied by a user or a server listing before joining it to
/// a remote parent path. Separators and traversal names are rejected so a bad
/// listing cannot escape the current directory.
// Used by the remote browser and session adapters.
#[allow(dead_code)]
pub fn validate_remote_name(name: &str) -> Result<(), AppError> {
    if name.is_empty() {
        return Err(AppError::invalid_input("A name is required."));
    }
    if name == "." || name == ".." {
        return Err(AppError::invalid_input("That name is reserved."));
    }
    if name.len() > MAX_NAME_LEN {
        return Err(AppError::invalid_input(
            "The name is too long for a remote server.",
        ));
    }
    if name.contains('\0') || name.contains('/') || name.contains('\n') || name.contains('\r') {
        return Err(AppError::invalid_input(
            "Names cannot contain path separators or control characters.",
        ));
    }
    Ok(())
}

/// Join a validated child name to a remote parent path.
// Used by the remote browser and session adapters.
#[allow(dead_code)]
pub fn join_remote(parent: &str, name: &str) -> Result<String, AppError> {
    let parent = normalize_remote(parent)?;
    validate_remote_name(name)?;
    if parent == "/" {
        Ok(format!("/{name}"))
    } else {
        Ok(format!("{parent}/{name}"))
    }
}

/// Parent of a normalized remote path, or `None` at the root.
// Used by the remote browser and session adapters.
#[allow(dead_code)]
pub fn remote_parent(input: &str) -> Result<Option<String>, AppError> {
    let normalized = normalize_remote(input)?;
    if normalized == "/" {
        return Ok(None);
    }
    let index = normalized
        .rfind('/')
        .ok_or_else(|| AppError::invalid_input("That remote path is not valid."))?;
    if index == 0 {
        Ok(Some("/".to_string()))
    } else {
        Ok(Some(normalized[..index].to_string()))
    }
}

/// Last segment of a remote path, used for labels.
// Used by the remote browser and session adapters.
#[allow(dead_code)]
pub fn remote_leaf(input: &str) -> Result<String, AppError> {
    let normalized = normalize_remote(input)?;
    if normalized == "/" {
        return Ok("/".to_string());
    }
    Ok(normalized
        .rsplit('/')
        .next()
        .unwrap_or(&normalized)
        .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_duplicate_and_dot_segments() {
        assert_eq!(normalize_remote("//a/./b//c").unwrap(), "/a/b/c");
        assert_eq!(normalize_remote("/").unwrap(), "/");
        assert_eq!(normalize_remote("/a/..").unwrap(), "/");
    }

    #[test]
    fn parent_never_climbs_above_root() {
        assert_eq!(normalize_remote("/../../etc").unwrap(), "/etc");
        assert_eq!(remote_parent("/").unwrap(), None);
        assert_eq!(remote_parent("/a").unwrap(), Some("/".into()));
        assert_eq!(remote_parent("/a/b/c").unwrap(), Some("/a/b".to_string()));
    }

    #[test]
    fn rejects_relative_empty_and_nul_paths() {
        assert!(normalize_remote("relative/path").is_err());
        assert!(normalize_remote("").is_err());
        assert!(normalize_remote("/a\0b").is_err());
    }

    #[test]
    fn validates_names_and_joins_safely() {
        assert!(validate_remote_name("report.pdf").is_ok());
        assert!(validate_remote_name(".hidden").is_ok());
        assert!(validate_remote_name("").is_err());
        assert!(validate_remote_name(".").is_err());
        assert!(validate_remote_name("..").is_err());
        assert!(validate_remote_name("a/b").is_err());
        assert!(validate_remote_name("a\nb").is_err());
        assert!(validate_remote_name(&"x".repeat(256)).is_err());

        assert_eq!(join_remote("/", "a").unwrap(), "/a");
        assert_eq!(join_remote("/docs", "a").unwrap(), "/docs/a");
        assert_eq!(join_remote("/docs/", "a").unwrap(), "/docs/a");
        assert!(join_remote("/docs", "../escape").is_err());
    }

    #[test]
    fn leaf_handles_root_and_nested_paths() {
        assert_eq!(remote_leaf("/").unwrap(), "/");
        assert_eq!(remote_leaf("/a/b").unwrap(), "b");
    }
}
