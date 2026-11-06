use std::sync::{Mutex, RwLock};

use tracing_appender::non_blocking::WorkerGuard;

use crate::config::paths::AppPaths;
use crate::config::settings_store::SettingsStore;

pub struct AppState {
    pub paths: AppPaths,
    pub settings: SettingsStore,
    /// Warnings produced before the webview existed, drained by
    /// `startup_report` once the frontend asks for them.
    startup_warnings: RwLock<Vec<String>>,
    /// Keeps the non-blocking log writer alive for the app lifetime.
    _log_guard: Mutex<Option<WorkerGuard>>,
}

impl AppState {
    pub fn new(
        paths: AppPaths,
        settings: SettingsStore,
        log_guard: WorkerGuard,
        startup_warnings: Vec<String>,
    ) -> Self {
        Self {
            paths,
            settings,
            startup_warnings: RwLock::new(startup_warnings),
            _log_guard: Mutex::new(Some(log_guard)),
        }
    }

    /// Return and clear the startup warnings. Safe to call repeatedly.
    pub fn take_startup_warnings(&self) -> Vec<String> {
        self.startup_warnings
            .write()
            .map(|mut warnings| std::mem::take(&mut *warnings))
            .unwrap_or_default()
    }
}
