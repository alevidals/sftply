use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};
use specta::Type;

pub const SETTINGS_SCHEMA_VERSION: u32 = 1;

/// Bounds for persisted remote navigation data. These keep a corrupted or
/// tampered settings file from growing without limit.
pub const MAX_NAV_CONNECTIONS: usize = 200;
pub const MAX_BOOKMARKS_PER_CONNECTION: usize = 100;
pub const MAX_RECENT_PATHS_PER_CONNECTION: usize = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, Default)]
#[serde(rename_all = "camelCase")]
pub enum ThemeMode {
    System,
    #[default]
    Dark,
    Light,
    OneDark,
    GruvboxDark,
    GruvboxLight,
    Nord,
    Dracula,
    SolarizedLight,
    TokyoNight,
    CatppuccinMocha,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, Default)]
#[serde(rename_all = "lowercase")]
pub enum Density {
    #[default]
    Compact,
    Comfortable,
}

/// Base used when formatting byte counts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, Default)]
#[serde(rename_all = "lowercase")]
pub enum SizeFormat {
    #[default]
    Binary,
    Decimal,
}

/// How file modification timestamps are displayed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, Default)]
#[serde(rename_all = "lowercase")]
pub enum DateFormat {
    #[default]
    Friendly,
    Iso,
}

/// Persisted user settings. Secrets must never be added to this struct.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub schema_version: u32,
    pub theme: ThemeMode,
    pub density: Density,
    pub size_format: SizeFormat,
    pub date_format: DateFormat,
    pub show_hidden_files: bool,
    pub confirm_delete: bool,
    pub transfer_concurrency: u8,
    pub bandwidth_limit_kbps: Option<u32>,
    /// Maximum time to establish a connection, in seconds.
    pub connect_timeout_seconds: u16,
    /// Maximum time a single remote filesystem operation may run, in seconds.
    pub operation_timeout_seconds: u16,
    pub sidebar_width: u16,
    pub bottom_panel_height: u16,
    pub bottom_panel_open: bool,
    pub pane_split: u16,
    pub last_local_path: Option<String>,
    /// Bookmarked remote folders, keyed by connection id.
    pub remote_bookmarks: BTreeMap<String, Vec<String>>,
    /// Most recent remote folders, newest first, keyed by connection id.
    pub recent_paths: BTreeMap<String, Vec<String>>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            theme: ThemeMode::Dark,
            density: Density::Compact,
            size_format: SizeFormat::Binary,
            date_format: DateFormat::Friendly,
            show_hidden_files: false,
            confirm_delete: true,
            transfer_concurrency: 3,
            bandwidth_limit_kbps: None,
            connect_timeout_seconds: 30,
            operation_timeout_seconds: 45,
            sidebar_width: 248,
            bottom_panel_height: 200,
            bottom_panel_open: true,
            pane_split: 50,
            last_local_path: None,
            remote_bookmarks: BTreeMap::new(),
            recent_paths: BTreeMap::new(),
        }
    }
}

impl AppSettings {
    /// Clamp values that are safe to clamp and reject values that indicate a
    /// bug or a corrupted/tampered payload.
    pub fn normalized(mut self) -> Result<Self, String> {
        if self.schema_version > SETTINGS_SCHEMA_VERSION {
            return Err(format!(
                "Settings were written by a newer version of sftply (schema {}).",
                self.schema_version
            ));
        }
        self.schema_version = SETTINGS_SCHEMA_VERSION;

        if !(1..=8).contains(&self.transfer_concurrency) {
            return Err("Transfer concurrency must be between 1 and 8.".into());
        }
        if !(5..=300).contains(&self.connect_timeout_seconds) {
            return Err("The connection timeout must be between 5 and 300 seconds.".into());
        }
        if !(5..=600).contains(&self.operation_timeout_seconds) {
            return Err("The operation timeout must be between 5 and 600 seconds.".into());
        }
        if !(200..=420).contains(&self.sidebar_width) {
            return Err("Sidebar width is out of range.".into());
        }
        if !(120..=480).contains(&self.bottom_panel_height) {
            return Err("Bottom panel height is out of range.".into());
        }
        if !(20..=80).contains(&self.pane_split) {
            return Err("Pane split is out of range.".into());
        }
        if let Some(limit) = self.bandwidth_limit_kbps
            && !(16..=10_000_000).contains(&limit)
        {
            return Err("Bandwidth limit is out of range.".into());
        }
        if let Some(path) = &self.last_local_path
            && (path.len() > 4096 || path.contains('\0'))
        {
            return Err("Last local path is invalid.".into());
        }

        self.remote_bookmarks =
            normalize_path_map(self.remote_bookmarks, MAX_BOOKMARKS_PER_CONNECTION);
        self.recent_paths = normalize_path_map(self.recent_paths, MAX_RECENT_PATHS_PER_CONNECTION);

        Ok(self)
    }
}

/// Keep only well-formed connection keys and paths, remove duplicates, and
/// bound each list. Navigation data is conveniences, so a malformed entry is
/// dropped instead of resetting every other setting.
fn normalize_path_map(
    map: BTreeMap<String, Vec<String>>,
    max_paths: usize,
) -> BTreeMap<String, Vec<String>> {
    map.into_iter()
        .filter(|(connection_id, _)| {
            !connection_id.is_empty() && connection_id.len() <= 128 && !connection_id.contains('\0')
        })
        .take(MAX_NAV_CONNECTIONS)
        .map(|(connection_id, paths)| {
            let mut seen = HashSet::new();
            let mut paths: Vec<String> = paths
                .into_iter()
                .filter(|path| {
                    !path.is_empty()
                        && path.len() <= 4096
                        && !path.contains('\0')
                        && seen.insert(path.clone())
                })
                .collect();
            paths.truncate(max_paths);
            (connection_id, paths)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_valid() {
        assert_eq!(
            AppSettings::default().normalized(),
            Ok(AppSettings::default())
        );
    }

    #[test]
    fn rejects_newer_schema() {
        let settings = AppSettings {
            schema_version: SETTINGS_SCHEMA_VERSION + 1,
            ..AppSettings::default()
        };
        assert!(settings.normalized().is_err());
    }

    #[test]
    fn rejects_bad_concurrency() {
        let settings = AppSettings {
            transfer_concurrency: 0,
            ..AppSettings::default()
        };
        assert!(settings.normalized().is_err());
    }

    #[test]
    fn rejects_out_of_range_timeouts() {
        let too_short = AppSettings {
            connect_timeout_seconds: 4,
            ..AppSettings::default()
        };
        assert!(too_short.normalized().is_err());

        let too_long = AppSettings {
            operation_timeout_seconds: 601,
            ..AppSettings::default()
        };
        assert!(too_long.normalized().is_err());
    }

    #[test]
    fn theme_ids_round_trip() {
        for (id, theme) in [
            ("system", ThemeMode::System),
            ("dark", ThemeMode::Dark),
            ("light", ThemeMode::Light),
            ("oneDark", ThemeMode::OneDark),
            ("gruvboxDark", ThemeMode::GruvboxDark),
            ("gruvboxLight", ThemeMode::GruvboxLight),
            ("nord", ThemeMode::Nord),
            ("dracula", ThemeMode::Dracula),
            ("solarizedLight", ThemeMode::SolarizedLight),
            ("tokyoNight", ThemeMode::TokyoNight),
            ("catppuccinMocha", ThemeMode::CatppuccinMocha),
        ] {
            let json = format!("\"{id}\"");
            assert_eq!(serde_json::from_str::<ThemeMode>(&json).unwrap(), theme);
            assert_eq!(serde_json::to_string(&theme).unwrap(), json);
        }
    }

    #[test]
    fn missing_format_fields_use_defaults() {
        let json = r#"{"schemaVersion":1,"theme":"dark","density":"compact"}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.size_format, SizeFormat::Binary);
        assert_eq!(settings.date_format, DateFormat::Friendly);
        assert!(settings.remote_bookmarks.is_empty());
        assert!(settings.recent_paths.is_empty());
    }

    #[test]
    fn normalizes_navigation_maps() {
        let mut bookmarks = BTreeMap::new();
        bookmarks.insert(
            "connection".to_string(),
            vec![
                "/a".to_string(),
                "/a".to_string(),
                String::new(),
                "/b".to_string(),
                "/bad\0path".to_string(),
            ],
        );
        bookmarks.insert(String::new(), vec!["/ignored".to_string()]);
        bookmarks.insert("x".repeat(129), vec!["/ignored".to_string()]);

        let settings = AppSettings {
            remote_bookmarks: bookmarks,
            ..AppSettings::default()
        }
        .normalized()
        .unwrap();

        assert_eq!(
            settings.remote_bookmarks.get("connection"),
            Some(&vec!["/a".to_string(), "/b".to_string()])
        );
        assert_eq!(settings.remote_bookmarks.len(), 1);
    }

    #[test]
    fn bounds_navigation_lists() {
        let many_bookmarks = (0..150).map(|index| format!("/b{index}")).collect();
        let many_recent = (0..30).map(|index| format!("/r{index}")).collect();
        let settings = AppSettings {
            remote_bookmarks: BTreeMap::from([("connection".to_string(), many_bookmarks)]),
            recent_paths: BTreeMap::from([("connection".to_string(), many_recent)]),
            ..AppSettings::default()
        }
        .normalized()
        .unwrap();

        assert_eq!(
            settings.remote_bookmarks["connection"].len(),
            MAX_BOOKMARKS_PER_CONNECTION
        );
        assert_eq!(
            settings.recent_paths["connection"].len(),
            MAX_RECENT_PATHS_PER_CONNECTION
        );
    }

    #[test]
    fn rejects_nul_in_last_path() {
        let settings = AppSettings {
            last_local_path: Some("/tmp/\0bad".into()),
            ..AppSettings::default()
        };
        assert!(settings.normalized().is_err());
    }
}
