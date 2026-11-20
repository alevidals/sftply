use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::domain::theme::{
    BUILTIN_THEME_NAMES, CustomTheme, THEME_FILE_MAX_BYTES, ThemeList, normalized_theme_name,
    parse_theme,
};

const THEME_EXTENSIONS: &[&str] = &["toml"];

/// Load every valid custom theme in `dir`. Invalid files are skipped with a
/// warning instead of preventing the rest of the gallery from loading.
pub fn list(dir: &Path) -> ThemeList {
    let mut themes = Vec::new();
    let mut warnings = Vec::new();
    let mut seen = HashSet::new();
    let mut seen_names = HashSet::new();

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
            warnings.push(format!(
                "{file_name}: another theme uses the same file name."
            ));
            continue;
        }
        let normalized_name = normalized_theme_name(&theme.name);
        if BUILTIN_THEME_NAMES.contains(&normalized_name.as_str()) {
            warnings.push(format!(
                "{file_name}: \"{}\" is reserved by a built-in theme.",
                theme.name
            ));
        } else if !seen_names.insert(normalized_name) {
            warnings.push(format!(
                "{file_name}: another theme already uses the name \"{}\".",
                theme.name
            ));
        }
        themes.push(theme);
    }

    themes.sort_by_key(|theme| theme.name.to_lowercase());
    ThemeList { themes, warnings }
}

fn check_name_available(dir: &Path, id: &str, name: &str) -> Result<(), String> {
    let normalized = normalized_theme_name(name);
    if normalized.is_empty() {
        return Err("The theme name is empty.".into());
    }
    if BUILTIN_THEME_NAMES.contains(&normalized.as_str()) {
        return Err("A built-in theme already uses that name.".into());
    }
    let existing = list(dir).themes;
    if existing
        .iter()
        .any(|theme| theme.id != id && normalized_theme_name(&theme.name) == normalized)
    {
        return Err("A theme with this name already exists.".into());
    }
    Ok(())
}

/// Parse a theme file without copying it.
pub fn inspect(source: &Path) -> Result<CustomTheme, String> {
    read_theme(source)
}

/// Destination for a custom theme id. The id includes the `custom:` prefix.
pub fn destination(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{}.toml", id.strip_prefix("custom:").unwrap_or(id)))
}

/// Copy a valid theme file into the themes directory. The file name determines
/// the theme id; an existing file with the same id is replaced.
pub fn import(dir: &Path, source: &Path) -> Result<CustomTheme, String> {
    let theme = inspect(source)?;
    check_name_available(dir, &theme.id, &theme.name)?;
    let contents = std::fs::read_to_string(source)
        .map_err(|error| format!("The theme file could not be read: {error}"))?;
    std::fs::create_dir_all(dir)
        .map_err(|error| format!("Could not create the themes folder: {error}"))?;
    std::fs::write(destination(dir, &theme.id), contents)
        .map_err(|error| format!("The theme file could not be saved: {error}"))?;
    Ok(theme)
}

/// Create or update a custom theme from the editor. A new theme gets a unique
/// id derived from its name; editing an existing theme keeps its file.
pub fn save(
    dir: &Path,
    id: Option<&str>,
    name: &str,
    dark: bool,
    colors: &std::collections::BTreeMap<String, String>,
) -> Result<CustomTheme, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 || name.chars().any(char::is_control) {
        return Err("The theme name is invalid.".into());
    }
    if colors.len() != crate::domain::theme::THEME_TOKEN_KEYS.len() {
        return Err("Every theme color must be defined.".into());
    }
    for key in colors.keys() {
        if !crate::domain::theme::THEME_TOKEN_KEYS.contains(&key.as_str()) {
            return Err(format!("Unknown theme color: {key}."));
        }
    }
    let mut normalized = std::collections::BTreeMap::new();
    for key in crate::domain::theme::THEME_TOKEN_KEYS {
        let value = colors
            .get(*key)
            .ok_or_else(|| format!("Missing theme color: {key}."))?;
        let value = crate::domain::theme::normalize_color(value)
            .ok_or_else(|| format!("Invalid color for {key}."))?;
        normalized.insert((*key).to_string(), value);
    }

    let requested_id = id.unwrap_or("custom:new");
    check_name_available(dir, requested_id, name)?;
    let id = match id {
        Some(id) if id.starts_with("custom:") => id.to_string(),
        _ => unique_id(dir, name),
    };
    let stem = id.strip_prefix("custom:").unwrap_or("theme");
    let contents = to_toml(name, dark, &normalized);
    let theme = crate::domain::theme::parse_theme(&format!("{stem}.toml"), &contents)?;
    std::fs::create_dir_all(dir)
        .map_err(|error| format!("Could not create the themes folder: {error}"))?;
    std::fs::write(destination(dir, &theme.id), contents)
        .map_err(|error| format!("The theme file could not be saved: {error}"))?;
    Ok(theme)
}

fn unique_id(dir: &Path, name: &str) -> String {
    let base = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else if character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    let base = if base.is_empty() {
        "theme".to_string()
    } else {
        base
    };
    let mut id = format!("custom:{base}");
    let mut index = 2;
    while destination(dir, &id).exists() {
        id = format!("custom:{base}-{index}");
        index += 1;
    }
    id
}

fn to_toml(name: &str, dark: bool, colors: &std::collections::BTreeMap<String, String>) -> String {
    let quote = |value: &str| format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""));
    let mut lines = vec![
        format!("name = {}", quote(name)),
        format!("variant = {}", quote(if dark { "dark" } else { "light" })),
    ];
    for (key, value) in colors {
        lines.push(format!("{key} = {}", quote(value)));
    }
    format!("{}\n", lines.join("\n"))
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

pub fn path_for(dir: &Path, id: &str) -> Option<PathBuf> {
    find_theme_file(dir, id)
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
    use crate::domain::theme::THEME_TOKEN_KEYS;

    fn theme_file(name: &str, background: &str, foreground: &str) -> String {
        let mut lines = vec![format!("name = {name}"), "variant = dark".to_string()];
        for key in THEME_TOKEN_KEYS {
            lines.push(format!("{key} = \"#123456\""));
        }
        lines.push(format!("background = \"{background}\""));
        lines.push(format!("foreground = \"{foreground}\""));
        lines.join("\n")
    }

    #[test]
    fn lists_valid_files_and_reports_invalid_ones() {
        let dir = tempfile::tempdir().expect("temp dir");
        std::fs::write(
            dir.path().join("good.toml"),
            theme_file("Good", "#111111", "#eeeeee"),
        )
        .unwrap();
        std::fs::write(dir.path().join("bad.toml"), "name = Bad\n").unwrap();

        let list = list(dir.path());
        assert_eq!(list.themes.len(), 1);
        assert_eq!(list.themes[0].id, "custom:good");
        assert_eq!(list.warnings.len(), 1);
        assert!(list.warnings[0].contains("bad.toml"));
    }

    #[test]
    fn imports_and_deletes_a_theme() {
        let dir = tempfile::tempdir().expect("temp dir");
        let source_dir = tempfile::tempdir().expect("source dir");
        let source = source_dir.path().join("My Theme.toml");
        std::fs::write(&source, theme_file("My Theme", "101010", "f0f0f0")).unwrap();

        let imported = import(dir.path(), &source).expect("import");
        assert_eq!(imported.id, "custom:my-theme");
        assert_eq!(list(dir.path()).themes.len(), 1);

        delete(dir.path(), &imported.id).expect("delete");
        assert!(list(dir.path()).themes.is_empty());
    }

    #[test]
    fn rejects_importing_a_duplicate_name() {
        let dir = tempfile::tempdir().expect("temp dir");
        let source_dir = tempfile::tempdir().expect("source dir");
        let first = source_dir.path().join("first.toml");
        let second = source_dir.path().join("second.toml");
        std::fs::write(&first, theme_file("Same", "#111111", "#eeeeee")).unwrap();
        std::fs::write(&second, theme_file("same", "#222222", "#dddddd")).unwrap();
        import(dir.path(), &first).expect("first import");
        let error = import(dir.path(), &second).unwrap_err();
        assert!(error.contains("already exists"));
    }

    #[test]
    fn rejects_unknown_theme_deletion() {
        let dir = tempfile::tempdir().expect("temp dir");
        assert!(delete(dir.path(), "dark").is_err());
        assert!(delete(dir.path(), "custom:missing").is_err());
    }
}

#[cfg(test)]
mod save_tests {
    use super::*;
    use crate::domain::theme::THEME_TOKEN_KEYS;

    fn colors() -> std::collections::BTreeMap<String, String> {
        THEME_TOKEN_KEYS
            .iter()
            .map(|key| ((*key).to_string(), "#123456".to_string()))
            .collect()
    }

    #[test]
    fn saves_and_updates_a_theme() {
        let dir = tempfile::tempdir().expect("temp dir");
        let saved = save(dir.path(), None, "Mine", true, &colors()).expect("save");
        assert_eq!(saved.id, "custom:mine");
        assert_eq!(list(dir.path()).themes.len(), 1);

        let updated =
            save(dir.path(), Some(&saved.id), "Mine 2", false, &colors()).expect("update");
        assert_eq!(updated.id, "custom:mine");
        assert_eq!(updated.name, "Mine 2");
        assert!(!updated.dark);
        assert_eq!(list(dir.path()).themes.len(), 1);
    }

    #[test]
    fn rejects_duplicate_names_and_allows_editing_the_same_theme() {
        let dir = tempfile::tempdir().expect("temp dir");
        let first = save(dir.path(), None, "Mine", true, &colors()).expect("first");
        let error = save(dir.path(), None, "  mine  ", true, &colors()).unwrap_err();
        assert!(error.contains("already exists"));

        let renamed = save(dir.path(), Some(&first.id), "Mine", false, &colors()).expect("edit");
        assert_eq!(renamed.id, first.id);
        assert!(!renamed.dark);
    }

    #[test]
    fn rejects_builtin_names() {
        let dir = tempfile::tempdir().expect("temp dir");
        let error = save(dir.path(), None, "One Dark", true, &colors()).unwrap_err();
        assert!(error.contains("built-in"));
    }
}
