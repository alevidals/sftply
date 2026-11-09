use serde::{Deserialize, Serialize};
use specta::Type;

pub const SETTINGS_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, Default)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    System,
    #[default]
    Dark,
    Light,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, Default)]
#[serde(rename_all = "lowercase")]
pub enum Density {
    #[default]
    Compact,
    Comfortable,
}

/// Persisted user settings. Secrets must never be added to this struct.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub schema_version: u32,
    pub theme: ThemeMode,
    pub density: Density,
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
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            theme: ThemeMode::Dark,
            density: Density::Compact,
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

        Ok(self)
    }
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
    fn rejects_nul_in_last_path() {
        let settings = AppSettings {
            last_local_path: Some("/tmp/\0bad".into()),
            ..AppSettings::default()
        };
        assert!(settings.normalized().is_err());
    }
}
