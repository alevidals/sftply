use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use specta::Type;

/// A theme loaded from a `.theme` file. `colors` contains the CSS custom
/// properties without the leading `--`; unknown values are ignored by the UI.
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

/// Color tokens the UI understands. `palette.N` keys are accepted separately.
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
    "chart-1",
    "chart-2",
    "chart-3",
    "chart-4",
    "chart-5",
    "sidebar",
    "sidebar-foreground",
    "sidebar-primary",
    "sidebar-primary-foreground",
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

/// Familiar aliases from terminal themes. They are kept in the map and mapped
/// to the app's semantic tokens by the frontend.
pub const THEME_ALIAS_KEYS: &[&str] = &[
    "cursor-color",
    "cursor-text",
    "selection-background",
    "selection-foreground",
    "split-divider-color",
];

pub fn is_theme_token(key: &str) -> bool {
    THEME_TOKEN_KEYS.contains(&key) || THEME_ALIAS_KEYS.contains(&key)
}

pub fn is_palette_key(key: &str) -> bool {
    key.strip_prefix("palette.")
        .and_then(|index| index.parse::<u8>().ok())
        .is_some_and(|index| index < 16)
}

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

        // Accept the terminal-style "palette = 0=#..." form as well as
        // "palette.0 = #...".
        let (key, value) = if key.eq_ignore_ascii_case("palette") {
            let Some((index, color)) = value.split_once('=') else {
                return Err(format!(
                    "Line {} must use palette = N=#color.",
                    line_number + 1
                ));
            };
            (format!("palette.{}", index.trim()), color.trim())
        } else {
            (key.to_string(), value)
        };

        if !is_theme_token(&key) && !is_palette_key(&key) {
            // Unknown keys are ignored so themes can carry extra metadata.
            continue;
        }
        let Some(color) = normalize_color(value) else {
            return Err(format!("Line {} has an invalid color.", line_number + 1));
        };
        colors.insert(key, color);
    }

    if !colors.contains_key("background") || !colors.contains_key("foreground") {
        return Err("A theme needs background and foreground colors.".into());
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

    #[test]
    fn parses_a_minimal_theme() {
        let theme = parse_theme(
            "my-theme.theme",
            "name = My Theme\nvariant = dark\nbackground = 1e1e2e\nforeground = cdd6f4\nprimary = #89b4fa\n",
        )
        .unwrap();
        assert_eq!(theme.id, "custom:my-theme");
        assert_eq!(theme.name, "My Theme");
        assert!(theme.dark);
        assert_eq!(theme.colors.get("background").unwrap(), "#1e1e2e");
        assert_eq!(theme.colors.get("primary").unwrap(), "#89b4fa");
    }

    #[test]
    fn accepts_terminal_palette_lines() {
        let theme = parse_theme(
            "terminal.theme",
            "background = #111111\nforeground = #eeeeee\npalette = 0=#222222\npalette.1 = #ff0000\n",
        )
        .unwrap();
        assert_eq!(theme.colors.get("palette.0").unwrap(), "#222222");
        assert_eq!(theme.colors.get("palette.1").unwrap(), "#ff0000");
    }

    #[test]
    fn rejects_missing_base_colors() {
        assert!(parse_theme("bad.theme", "name = Bad\n").is_err());
    }

    #[test]
    fn rejects_css_injection() {
        assert!(
            parse_theme(
                "bad.theme",
                "background = #111\nforeground = #eee\nprimary = #fff;}\n"
            )
            .is_err()
        );
    }

    #[test]
    fn sanitizes_file_names() {
        assert_eq!(sanitize_id("My Theme!"), "my-theme");
    }
}
