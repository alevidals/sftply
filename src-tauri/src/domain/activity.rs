use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum ActivityLevel {
    Info,
    Success,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, tauri_specta::Event)]
#[tauri_specta(event_name = "activity://entry")]
pub struct ActivityEntry {
    pub id: String,
    pub level: ActivityLevel,
    pub message: String,
    /// Unix epoch milliseconds. `f64` keeps the value exactly representable in
    /// JavaScript, which Specta requires for 64-bit numeric types.
    pub timestamp: f64,
}

impl ActivityEntry {
    /// Construct an entry for a backend-emitted activity event.
    #[allow(dead_code)] // Used when session/transfer events start emitting in Phase 3.
    pub fn new(level: ActivityLevel, message: impl Into<String>) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            level,
            message: message.into(),
            timestamp: unix_millis(),
        }
    }
}

pub fn unix_millis() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}
