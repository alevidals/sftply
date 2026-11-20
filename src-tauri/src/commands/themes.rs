use std::collections::BTreeMap;

use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::app_state::AppState;
use crate::config::themes;
use crate::domain::theme::{CustomTheme, ThemeList};
use crate::error::{AppError, ErrorCode};

#[tauri::command]
#[specta::specta]
pub fn themes_list(state: State<'_, AppState>) -> ThemeList {
    themes::list(&state.paths.themes_dir)
}

#[tauri::command]
#[specta::specta]
pub fn theme_import(
    state: State<'_, AppState>,
    path: String,
    overwrite: bool,
) -> Result<CustomTheme, AppError> {
    let source = std::path::Path::new(&path);
    let theme = themes::inspect(source).map_err(AppError::invalid_input)?;
    if !overwrite && themes::destination(&state.paths.themes_dir, &theme.id).exists() {
        return Err(AppError::new(
            ErrorCode::Conflict,
            "A theme with this file name already exists.",
        ));
    }
    themes::import(&state.paths.themes_dir, source).map_err(AppError::invalid_input)
}

#[tauri::command]
#[specta::specta]
pub fn theme_save(
    state: State<'_, AppState>,
    id: Option<String>,
    name: String,
    dark: bool,
    colors: BTreeMap<String, String>,
) -> Result<CustomTheme, AppError> {
    themes::save(&state.paths.themes_dir, id.as_deref(), &name, dark, &colors)
        .map_err(AppError::invalid_input)
}

#[tauri::command]
#[specta::specta]
pub fn theme_delete(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    themes::delete(&state.paths.themes_dir, &id).map_err(AppError::invalid_input)
}

#[tauri::command]
#[specta::specta]
pub fn theme_open_file(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), AppError> {
    let path = themes::path_for(&state.paths.themes_dir, &id)
        .ok_or_else(|| AppError::not_found("That theme file no longer exists."))?;
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| {
            AppError::internal(
                "Could not open the theme file.",
                format!("{}: {error}", path.display()),
            )
        })?;
    Ok(())
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
