use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::app_state::AppState;
use crate::domain::{AppInfo, StartupReport};
use crate::error::AppError;

#[tauri::command]
#[specta::specta]
pub fn app_info(state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        config_dir: state.paths.config_dir.to_string_lossy().into_owned(),
        log_dir: state.paths.log_dir.to_string_lossy().into_owned(),
    }
}

#[tauri::command]
#[specta::specta]
pub fn startup_report(state: State<'_, AppState>) -> StartupReport {
    StartupReport {
        warnings: state.take_startup_warnings(),
    }
}

/// Opens the platform log directory in the system file manager.
#[tauri::command]
#[specta::specta]
pub fn open_logs(app: AppHandle, state: State<'_, AppState>) -> Result<(), AppError> {
    app.opener()
        .open_path(
            state.paths.log_dir.to_string_lossy().to_string(),
            None::<&str>,
        )
        .map_err(|error| {
            AppError::internal(
                "Could not open the log folder.",
                format!("{}: {error}", state.paths.log_dir.display()),
            )
        })?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn app_check_update() -> Result<crate::update::UpdateStatus, crate::error::AppError> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    tokio::task::spawn_blocking(move || crate::update::check(&current))
        .await
        .map_err(|error| {
            crate::error::AppError::internal("The update check could not run.", error.to_string())
        })?
}
