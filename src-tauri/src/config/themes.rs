use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::domain::theme::{CustomTheme, THEME_FILE_MAX_BYTES, ThemeList, parse_theme};

const THEME_EXTENSIONS: &[&str] = &["theme", "toml", "conf"];

/// Load every valid custom theme in `dir`. Invalid files are skipped with a
/// warning instead of preventing the rest of the gallery from loading.
pub fn list(dir: &Path) -> ThemeList {
    let mut themes = Vec::new();
    let mut warnings = Vec::new();
    let mut seen = HashSet::new();

    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) => {
            warnings.push(format!("Could not read the themes folder: {error}"));
            return ThemeList { themes, warnings };
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || !has_theme_extension(&path) {
            continue;
        }
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("theme");
        let theme = match read_theme(&path) {
            Ok(theme) => theme,
            Err(error) => {
                warnings.push(format!("{file_name}: {error}"));
                continue;
            }
        };
        if !seen.insert(theme.id.clone()) {
            warnings.push(format!("{file_name}: another theme uses the same name."));
            continue;
        }
        themes.push(theme);
    }

    themes.sort_by_key(|theme| theme.name.to_lowercase());
    ThemeList { themes, warnings }
}

/// Copy a valid theme file into the themes directory. The file name determines
/// the theme id; an existing id is replaced.
pub fn import(dir: &Path, source: &Path) -> Result<CustomTheme, String> {
    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "The theme file name is not valid.".to_string())?;
    let contents = std::fs::read_to_string(source)
        .map_err(|error| format!("The theme file could not be read: {error}"))?;
    if contents.len() as u64 > THEME_FILE_MAX_BYTES {
        return Err("The theme file is too large.".into());
    }

    let theme = parse_theme(file_name, &contents)?;
    let stem = theme.id.strip_prefix("custom:").unwrap_or("theme");
    std::fs::create_dir_all(dir)
        .map_err(|error| format!("Could not create the themes folder: {error}"))?;
    std::fs::write(dir.join(format!("{stem}.theme")), contents)
        .map_err(|error| format!("The theme file could not be saved: {error}"))?;
    Ok(theme)
}

/// Remove the file backing a custom theme. Built-in ids are rejected.
pub fn delete(dir: &Path, id: &str) -> Result<(), String> {
    if !id.starts_with("custom:") {
        return Err("Only custom themes can be deleted.".into());
    }
    let path =
        find_theme_file(dir, id).ok_or_else(|| "That theme file no longer exists.".to_string())?;
    std::fs::remove_file(path)
        .map_err(|error| format!("The theme file could not be removed: {error}"))
}

pub fn write_export(path: &Path, contents: &str) -> Result<(), String> {
    if contents.len() as u64 > THEME_FILE_MAX_BYTES {
        return Err("The theme export is too large.".into());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create the export folder: {error}"))?;
    }
    std::fs::write(path, contents)
        .map_err(|error| format!("The theme file could not be written: {error}"))
}

fn read_theme(path: &Path) -> Result<CustomTheme, String> {
    let metadata = std::fs::metadata(path)
        .map_err(|error| format!("The theme file could not be read: {error}"))?;
    if metadata.len() > THEME_FILE_MAX_BYTES {
        return Err("The theme file is too large.".into());
    }
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "The theme file name is not valid.".to_string())?;
    let contents = std::fs::read_to_string(path)
        .map_err(|error| format!("The theme file could not be read: {error}"))?;
    parse_theme(file_name, &contents)
}

fn has_theme_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            THEME_EXTENSIONS
                .iter()
                .any(|candidate| extension.eq_ignore_ascii_case(candidate))
        })
}

fn find_theme_file(dir: &Path, id: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || !has_theme_extension(&path) {
            continue;
        }
        let file_name = path.file_name().and_then(|value| value.to_str())?;
        if parse_theme(file_name, &std::fs::read_to_string(&path).ok()?)
            .ok()?
            .id
            == id
        {
            return Some(path);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_valid_files_and_reports_invalid_ones() {
        let dir = tempfile::tempdir().expect("temp dir");
        std::fs::write(
            dir.path().join("good.theme"),
            "name = Good\nbackground = #111111\nforeground = #eeeeee\n",
        )
        .unwrap();
        std::fs::write(dir.path().join("bad.theme"), "name = Bad\n").unwrap();

        let list = list(dir.path());
        assert_eq!(list.themes.len(), 1);
        assert_eq!(list.themes[0].id, "custom:good");
        assert_eq!(list.warnings.len(), 1);
        assert!(list.warnings[0].contains("bad.theme"));
    }

    #[test]
    fn imports_and_deletes_a_theme() {
        let dir = tempfile::tempdir().expect("temp dir");
        let source_dir = tempfile::tempdir().expect("source dir");
        let source = source_dir.path().join("My Theme.theme");
        std::fs::write(
            &source,
            "name = My Theme\nbackground = 101010\nforeground = f0f0f0\n",
        )
        .unwrap();

        let imported = import(dir.path(), &source).expect("import");
        assert_eq!(imported.id, "custom:my-theme");
        assert_eq!(list(dir.path()).themes.len(), 1);

        delete(dir.path(), &imported.id).expect("delete");
        assert!(list(dir.path()).themes.is_empty());
    }

    #[test]
    fn rejects_unknown_theme_deletion() {
        let dir = tempfile::tempdir().expect("temp dir");
        assert!(delete(dir.path(), "dark").is_err());
        assert!(delete(dir.path(), "custom:missing").is_err());
    }
}
