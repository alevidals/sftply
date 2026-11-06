use std::path::{Path, PathBuf};
use std::sync::RwLock;

use crate::domain::settings::AppSettings;
use crate::error::AppError;

pub struct SettingsStore {
    path: PathBuf,
    current: RwLock<AppSettings>,
}

impl SettingsStore {
    /// Load settings, recovering from a corrupt file by moving it aside and
    /// starting from defaults. The returned warning is safe to surface in the
    /// Activity panel.
    pub fn load(path: PathBuf) -> (Self, Option<String>) {
        match load_from_disk(&path) {
            Ok(settings) => (
                Self {
                    path,
                    current: RwLock::new(settings),
                },
                None,
            ),
            Err(LoadError::Missing) => {
                let settings = AppSettings::default();
                let _ = crate::config::atomic::write_json(&path, &settings);
                (
                    Self {
                        path,
                        current: RwLock::new(settings),
                    },
                    None,
                )
            }
            Err(LoadError::Corrupt(detail)) => {
                let warning = format!(
                    "Settings could not be read and were reset. A backup was kept. ({detail})"
                );
                tracing::error!(%detail, "settings file corrupt; starting from defaults");
                let backup = backup_path(&path);
                if let Err(error) = std::fs::rename(&path, &backup) {
                    tracing::warn!(%error, "could not back up corrupt settings file");
                }
                let settings = AppSettings::default();
                let _ = crate::config::atomic::write_json(&path, &settings);
                (
                    Self {
                        path,
                        current: RwLock::new(settings),
                    },
                    Some(warning),
                )
            }
        }
    }

    pub fn get(&self) -> AppSettings {
        self.current.read().expect("settings lock poisoned").clone()
    }

    pub async fn update(&self, next: AppSettings) -> Result<AppSettings, AppError> {
        let next = next.normalized().map_err(AppError::invalid_input)?;

        let path = self.path.clone();
        let payload = next.clone();
        tokio::task::spawn_blocking(move || crate::config::atomic::write_json(&path, &payload))
            .await
            .map_err(|error| {
                AppError::config_write(format!("settings write task failed: {error}"))
            })?
            .map_err(|error| AppError::config_write(error.to_string()))?;

        {
            let mut guard = self
                .current
                .write()
                .map_err(|_| AppError::internal("Settings lock poisoned.", ""))?;
            *guard = next.clone();
        }

        Ok(next)
    }
}

enum LoadError {
    Missing,
    Corrupt(String),
}

fn load_from_disk(path: &Path) -> Result<AppSettings, LoadError> {
    if !path.exists() {
        return Err(LoadError::Missing);
    }

    let settings: AppSettings = crate::config::atomic::read_json(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            LoadError::Missing
        } else {
            LoadError::Corrupt(error.to_string())
        }
    })?;

    match settings.normalized() {
        Ok(settings) => Ok(settings),
        Err(message) => Err(LoadError::Corrupt(message)),
    }
}

fn backup_path(path: &Path) -> PathBuf {
    let millis = crate::domain::activity::unix_millis();
    path.with_file_name(format!("settings.corrupt-{millis:.0}.json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_defaults_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let (store, warning) = SettingsStore::load(path.clone());
        assert!(warning.is_none());
        assert_eq!(store.get(), AppSettings::default());
        assert!(path.exists());
    }

    #[test]
    fn recovers_from_corrupt_file_with_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "{not json").unwrap();

        let (store, warning) = SettingsStore::load(path.clone());
        assert!(warning.is_some());
        assert_eq!(store.get(), AppSettings::default());

        let backups: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("settings.corrupt-")
            })
            .collect();
        assert_eq!(backups.len(), 1);
    }

    #[test]
    fn rejects_invalid_values_on_load() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let settings = AppSettings {
            sidebar_width: 1,
            ..AppSettings::default()
        };
        crate::config::atomic::write_json(&path, &settings).unwrap();

        let (_store, warning) = SettingsStore::load(path);
        assert!(warning.is_some());
    }
}
