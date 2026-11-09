use serde::{Deserialize, Serialize};
use specta::Type;

use crate::domain::connection::ConnectionProtocol;
use crate::domain::fs::FsCapabilities;

/// Public description of a live remote session. It never contains credentials.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub connection_id: String,
    pub name: String,
    pub protocol: ConnectionProtocol,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub initial_path: String,
    pub capabilities: FsCapabilities,
    /// Unix epoch milliseconds, UTC.
    #[specta(type = specta_typescript::Number)]
    pub connected_at: f64,
    /// Time spent establishing the connection, in milliseconds.
    #[specta(type = specta_typescript::Number)]
    pub latency_ms: f64,
    /// False when the stream is no longer trustworthy and reconnect is needed.
    pub usable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum SessionState {
    Connecting,
    Connected,
    Disconnected,
    Failed,
}

/// Lifecycle event emitted whenever a session changes state.
#[derive(Debug, Clone, Serialize, Deserialize, Type, tauri_specta::Event)]
#[tauri_specta(event_name = "session://state")]
pub struct SessionStateEvent {
    pub session_id: String,
    pub connection_id: String,
    pub state: SessionState,
    /// Optional user-safe detail, for example the failure message.
    pub message: Option<String>,
    /// Unix epoch milliseconds, UTC.
    #[specta(type = specta_typescript::Number)]
    pub timestamp: f64,
}
