use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use specta::Type;

/// A theme loaded from a `.theme` file. `colors` contains the CSS custom
/// properties without the leading `--`. Every token is required.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CustomTheme {
    pub id: String,
    pub name: String,
    pub dark: bool,
    pub colors: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ThemeList {
    pub themes: Vec<CustomTheme>,
    pub warnings: Vec<String>,
}

pub const THEME_FILE_MAX_BYTES: u64 = 128 * 1024;

/// Every color token used by the UI. A custom theme must define all of them;
/// this keeps files explicit instead of inheriting values from another theme.
pub const THEME_TOKEN_KEYS: &[&str] = &[
    "background",
    "foreground",
    "card",
    "card-foreground",
    "popover",
    "popover-foreground",
    "primary",
    "primary-foreground",
    "secondary",
    "secondary-foreground",
    "muted",
    "muted-foreground",
    "accent",
    "accent-foreground",
    "destructive",
    "border",
    "input",
    "ring",
    "chart-4",
    "chart-5",
    "sidebar",
    "sidebar-foreground",
    "sidebar-accent",
    "sidebar-accent-foreground",
    "sidebar-border",
    "sidebar-ring",
    "chrome",
    "chrome-foreground",
    "panel-header",
    "row-hover",
    "row-selected",
    "success",
    "warning",
    "info",
];

/// Normalize a CSS color. Accepts the common 3/4/6/8 digit hex forms without a
/// leading `#`, plus the color functions used by the built-in palettes.
pub fn normalize_color(value: &str) -> Option<String> {
    let value = value.trim().trim_matches('"').trim_matches('\'').trim();
    if value.is_empty() || value.len() > 160 {
        return None;
    }
    if value.contains([';', '{', '}', '\0'])
        || value.chars().any(|character| character.is_control())
    {
        return None;
    }

    let hex = value.trim_start_matches('#');
    if matches!(hex.len(), 3 | 4 | 6 | 8)
        && hex.chars().all(|character| character.is_ascii_hexdigit())
    {
        return Some(format!("#{hex}"));
    }

    let lower = value.to_ascii_lowercase();
    if [
        "oklch(",
        "oklab(",
        "rgb(",
        "rgba(",
        "hsl(",
        "hsla(",
        "color(",
        "color-mix(",
    ]
    .iter()
    .any(|prefix| lower.starts_with(prefix))
        || lower == "transparent"
    {
        return Some(value.to_string());
    }

    None
}

pub fn parse_theme(file_name: &str, contents: &str) -> Result<CustomTheme, String> {
    if contents.len() as u64 > THEME_FILE_MAX_BYTES {
        return Err("The theme file is too large.".into());
    }

    let stem = std::path::Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let id = format!("custom:{}", sanitize_id(stem));
    if id == "custom:" {
        return Err("The theme file name is not usable.".into());
    }

    let mut name = stem.to_string();
    let mut dark = true;
    let mut colors = BTreeMap::new();

    for (line_number, raw_line) in contents.lines().enumerate() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        let Some((raw_key, raw_value)) = line.split_once('=') else {
            return Err(format!(
                "Line {} is not a key = value pair.",
                line_number + 1
            ));
        };
        let key = raw_key.trim();
        let value = raw_value.trim();
        if key.is_empty() {
            return Err(format!("Line {} has an empty key.", line_number + 1));
        }
        if key.eq_ignore_ascii_case("name") {
            let next = value.trim_matches('"').trim_matches('\'').trim();
            if next.is_empty() || next.len() > 100 {
                return Err("The theme name is invalid.".into());
            }
            name = next.to_string();
            continue;
        }
        if key.eq_ignore_ascii_case("variant") {
            dark = match value.to_ascii_lowercase().as_str() {
                "dark" => true,
                "light" => false,
                _ => return Err("The theme variant must be dark or light.".into()),
            };
            continue;
        }
        if key.eq_ignore_ascii_case("dark") {
            dark = match value.to_ascii_lowercase().as_str() {
                "true" | "yes" | "1" => true,
                "false" | "no" | "0" => false,
                _ => return Err("The dark flag must be true or false.".into()),
            };
            continue;
        }

        if !THEME_TOKEN_KEYS.contains(&key) {
            return Err(format!(
                "Line {} has an unknown theme key: {key}.",
                line_number + 1
            ));
        }
        let Some(color) = normalize_color(value) else {
            return Err(format!("Line {} has an invalid color.", line_number + 1));
        };
        colors.insert(key.to_string(), color);
    }

    let missing: Vec<&str> = THEME_TOKEN_KEYS
        .iter()
        .copied()
        .filter(|key| !colors.contains_key(*key))
        .collect();
    if !missing.is_empty() {
        return Err(format!("Missing theme colors: {}.", missing.join(", ")));
    }

    Ok(CustomTheme {
        id,
        name,
        dark,
        colors,
    })
}

fn sanitize_id(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn full_theme() -> String {
        let mut lines = vec!["name = Mine".to_string(), "variant = dark".to_string()];
        for key in THEME_TOKEN_KEYS {
            lines.push(format!("{key} = #123456"));
        }
        lines.push("background = 101010".into());
        lines.push("foreground = f0f0f0".into());
        lines.join("\n")
    }

    #[test]
    fn parses_a_complete_theme() {
        let theme = parse_theme("my-theme.theme", &full_theme()).unwrap();
        assert_eq!(theme.id, "custom:my-theme");
        assert_eq!(theme.name, "Mine");
        assert!(theme.dark);
        assert_eq!(theme.colors.get("background").unwrap(), "#101010");
        assert_eq!(theme.colors.get("foreground").unwrap(), "#f0f0f0");
        assert!(theme.colors.contains_key("sidebar-ring"));
    }

    #[test]
    fn rejects_missing_colors() {
        let contents = full_theme().replace("sidebar-ring = #123456\n", "");
        let error = parse_theme("bad.theme", &contents).unwrap_err();
        assert!(error.contains("sidebar-ring"));
    }

    #[test]
    fn rejects_unknown_keys() {
        let contents = format!("{}\nnot-a-token = #ffffff\n", full_theme());
        assert!(parse_theme("bad.theme", &contents).is_err());
    }

    #[test]
    fn rejects_css_injection() {
        let contents = full_theme().replace("primary = #123456", "primary = #fff;}");
        assert!(parse_theme("bad.theme", &contents).is_err());
    }

    #[test]
    fn sanitizes_file_names() {
        assert_eq!(sanitize_id("My Theme!"), "my-theme");
    }
}
