pub mod activity;
pub mod connection;
pub mod credentials;
pub mod fs;
pub mod host_key;
pub mod remote_path;
pub mod session;
pub mod settings;
pub mod transfer;

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub platform: String,
    pub arch: String,
    pub config_dir: String,
    pub log_dir: String,
}

/// One-shot diagnostics produced while the app starts. Fetched by the frontend
/// after the webview is ready so warnings are not lost as early events.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StartupReport {
    pub warnings: Vec<String>,
}
