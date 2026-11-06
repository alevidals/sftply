use tauri::State;

use crate::app_state::AppState;
use crate::domain::{AppInfo, StartupReport};

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
