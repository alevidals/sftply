use tauri::State;

use crate::app_state::AppState;
use crate::domain::settings::AppSettings;
use crate::error::AppError;

#[tauri::command]
#[specta::specta]
pub fn settings_get(state: State<'_, AppState>) -> AppSettings {
    state.settings.get()
}

#[tauri::command]
#[specta::specta]
pub async fn settings_update(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppSettings, AppError> {
    state.settings.update(settings).await
}
