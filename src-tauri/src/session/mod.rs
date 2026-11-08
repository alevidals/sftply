use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use tauri::AppHandle;
use tauri_specta::Event;

use crate::domain::activity::unix_millis;
use crate::domain::session::{SessionInfo, SessionState, SessionStateEvent};
use crate::protocol::RemoteFs;

/// A live remote connection. Commands are serialized per session because FTP
/// has one control channel; SFTP channels are handled inside russh-sftp.
pub struct Session {
    pub info: SessionInfo,
    pub client: tokio::sync::Mutex<Box<dyn RemoteFs>>,
}

/// Registry of live sessions. Metadata is cheap to read; the protocol client
/// is only locked for the duration of an operation.
#[derive(Default)]
pub struct SessionManager {
    sessions: RwLock<HashMap<String, Arc<Session>>>,
}

impl SessionManager {
    pub fn insert(&self, session: Arc<Session>) {
        self.sessions
            .write()
            .expect("session lock poisoned")
            .insert(session.info.id.clone(), session);
    }

    pub fn get(&self, session_id: &str) -> Option<Arc<Session>> {
        self.sessions
            .read()
            .expect("session lock poisoned")
            .get(session_id)
            .cloned()
    }

    pub fn remove(&self, session_id: &str) -> Option<Arc<Session>> {
        self.sessions
            .write()
            .expect("session lock poisoned")
            .remove(session_id)
    }

    pub fn list(&self) -> Vec<SessionInfo> {
        let mut sessions: Vec<SessionInfo> = self
            .sessions
            .read()
            .expect("session lock poisoned")
            .values()
            .map(|session| session.info.clone())
            .collect();
        sessions.sort_by(|left, right| left.connected_at.total_cmp(&right.connected_at));
        sessions
    }
}

pub fn emit_state(
    app: &AppHandle,
    session_id: &str,
    connection_id: &str,
    state: SessionState,
    message: Option<String>,
) {
    let event = SessionStateEvent {
        session_id: session_id.to_string(),
        connection_id: connection_id.to_string(),
        state,
        message,
        timestamp: unix_millis(),
    };
    if let Err(error) = event.emit(app) {
        tracing::warn!(%error, "could not emit session state event");
    }
}
