use std::sync::{Arc, Mutex, RwLock};

use tokio_util::sync::CancellationToken;
use tracing_appender::non_blocking::WorkerGuard;

use crate::config::connection_store::ConnectionStore;
use crate::config::known_hosts::KnownHostsStore;
use crate::config::paths::AppPaths;
use crate::config::settings_store::SettingsStore;
use crate::session::SessionManager;
use crate::transfer::TransferManager;
use crate::transfer::history::TransferHistoryStore;

/// One comparison can run at a time. Starting another one cancels the previous
/// walk, which keeps the UI responsive when the user changes filters.
#[derive(Default)]
pub struct SyncManager {
    active: Mutex<Option<CancellationToken>>,
}

impl SyncManager {
    pub fn begin(&self) -> CancellationToken {
        let token = CancellationToken::new();
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(previous) = active.replace(token.clone()) {
            previous.cancel();
        }
        token
    }

    pub fn cancel(&self) -> bool {
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(token) = active.take() {
            token.cancel();
            true
        } else {
            false
        }
    }

    pub fn finish(&self) {
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        *active = None;
    }
}

pub struct AppState {
    pub paths: AppPaths,
    pub settings: SettingsStore,
    pub connections: ConnectionStore,
    pub known_hosts: KnownHostsStore,
    pub sessions: SessionManager,
    pub transfers: Arc<TransferManager>,
    pub sync: SyncManager,
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
        connections: ConnectionStore,
        known_hosts: KnownHostsStore,
        history: Arc<TransferHistoryStore>,
        log_guard: WorkerGuard,
        startup_warnings: Vec<String>,
    ) -> Self {
        let concurrency = settings.get().transfer_concurrency as usize;
        let bandwidth_limit_kbps = settings.get().bandwidth_limit_kbps;
        Self {
            paths,
            settings,
            connections,
            known_hosts,
            sessions: SessionManager::default(),
            transfers: Arc::new(TransferManager::new(
                concurrency,
                bandwidth_limit_kbps,
                history,
            )),
            sync: SyncManager::default(),
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
