use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::error::{AppError, ErrorCode};

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub config_dir: PathBuf,
    /// Reserved for Phase 4 (transfer state).
    #[allow(dead_code)]
    pub data_dir: PathBuf,
    pub log_dir: PathBuf,
    pub settings_file: PathBuf,
    pub connections_file: PathBuf,
    pub known_hosts_file: PathBuf,
}

impl AppPaths {
    pub fn resolve(app: &AppHandle) -> Result<Self, AppError> {
        let config_dir = app
            .path()
            .app_config_dir()
            .map_err(|e| Self::path_error("config", e.to_string()))?;
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| Self::path_error("data", e.to_string()))?;
        let log_dir = app
            .path()
            .app_log_dir()
            .map_err(|e| Self::path_error("log", e.to_string()))?;

        for dir in [&config_dir, &data_dir, &log_dir] {
            ensure_dir(dir)?;
        }

        Ok(Self {
            settings_file: config_dir.join("settings.json"),
            connections_file: config_dir.join("connections.json"),
            known_hosts_file: config_dir.join("known_hosts.json"),
            config_dir,
            data_dir,
            log_dir,
        })
    }

    fn path_error(kind: &str, detail: String) -> AppError {
        AppError::new(
            ErrorCode::Internal,
            format!("Could not resolve the application {kind} directory."),
        )
        .with_detail(detail)
    }
}

fn ensure_dir(path: &Path) -> Result<(), AppError> {
    std::fs::create_dir_all(path).map_err(|error| {
        AppError::new(
            ErrorCode::Internal,
            "Could not create an application directory.",
        )
        .with_detail(format!("{}: {error}", path.display()))
    })
}
