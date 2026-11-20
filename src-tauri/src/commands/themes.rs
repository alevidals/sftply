use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::app_state::AppState;
use crate::config::themes;
use crate::domain::theme::{CustomTheme, ThemeList};
use crate::error::AppError;

#[tauri::command]
#[specta::specta]
pub fn themes_list(state: State<'_, AppState>) -> ThemeList {
    themes::list(&state.paths.themes_dir)
}

#[tauri::command]
#[specta::specta]
pub fn theme_import(state: State<'_, AppState>, path: String) -> Result<CustomTheme, AppError> {
    themes::import(&state.paths.themes_dir, std::path::Path::new(&path))
        .map_err(AppError::invalid_input)
}

#[tauri::command]
#[specta::specta]
pub fn theme_delete(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    themes::delete(&state.paths.themes_dir, &id).map_err(AppError::invalid_input)
}

#[tauri::command]
#[specta::specta]
pub fn theme_export(path: String, content: String) -> Result<(), AppError> {
    themes::write_export(std::path::Path::new(&path), &content).map_err(AppError::invalid_input)
}

/// Open the folder where custom theme files live.
#[tauri::command]
#[specta::specta]
pub fn themes_open_folder(app: AppHandle, state: State<'_, AppState>) -> Result<(), AppError> {
    app.opener()
        .open_path(
            state.paths.themes_dir.to_string_lossy().to_string(),
            None::<&str>,
        )
        .map_err(|error| {
            AppError::internal(
                "Could not open the themes folder.",
                format!("{}: {error}", state.paths.themes_dir.display()),
            )
        })?;
    Ok(())
}
