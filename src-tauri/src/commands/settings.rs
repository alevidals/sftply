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
    let updated = state.settings.update(settings).await?;
    // Apply transfer settings immediately instead of waiting for a restart.
    state
        .transfers
        .set_concurrency(updated.transfer_concurrency as usize);
    state
        .transfers
        .set_bandwidth_limit_kbps(updated.bandwidth_limit_kbps);
    Ok(updated)
}
