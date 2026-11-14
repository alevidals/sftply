use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex, RwLock};
use std::time::Duration;

use futures_util::future::BoxFuture;
use tauri::AppHandle;
use tauri_specta::Event;
use tokio_util::sync::CancellationToken;
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::domain::activity::unix_millis;
use crate::domain::connection::{ConnectionProfile, ConnectionProtocol};
use crate::domain::host_key::KnownHost;
use crate::domain::session::{SessionInfo, SessionState, SessionStateEvent};
use crate::error::{AppError, ErrorCode};
use crate::protocol::RemoteFs;
use crate::protocol::ftp::FtpRemote;
use crate::protocol::sftp::{SftpCredentials, SftpRemote};

/// Secret material retained for the lifetime of a live session so the session
/// can reconnect without prompting the keychain again. It is never serialized,
/// logged, or exposed to the frontend, and it is zeroed when dropped.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub enum SessionCredentials {
    Password(String),
    Key { passphrase: Option<String> },
}

/// A live remote connection. Commands are serialized per session because FTP
/// has one control channel; SFTP channels are handled inside russh-sftp.
pub struct Session {
    pub info: SessionInfo,
    /// The profile used to open the session, kept so reconnect does not depend
    /// on the profile still existing in the saved connections store.
    pub profile: ConnectionProfile,
    /// Credentials retained only for reconnect; never leaves the Rust process.
    pub credentials: SessionCredentials,
    client: tokio::sync::Mutex<Box<dyn RemoteFs>>,
    /// Cancellation token for the operation currently holding the client.
    cancel: StdMutex<Option<CancellationToken>>,
    /// Cleared when the protocol stream can no longer be trusted.
    usable: AtomicBool,
}

impl Session {
    pub fn new(
        info: SessionInfo,
        profile: ConnectionProfile,
        credentials: SessionCredentials,
        client: Box<dyn RemoteFs>,
    ) -> Self {
        Self {
            info,
            profile,
            credentials,
            client: tokio::sync::Mutex::new(client),
            cancel: StdMutex::new(None),
            usable: AtomicBool::new(true),
        }
    }

    pub fn is_usable(&self) -> bool {
        self.usable.load(Ordering::SeqCst)
    }

    pub fn mark_unusable(&self) {
        self.usable.store(false, Ordering::SeqCst);
    }

    /// Cancel the operation that currently holds the protocol stream. Returns
    /// whether there was an operation to cancel.
    pub fn cancel_current(&self) -> bool {
        let Ok(slot) = self.cancel.lock() else {
            return false;
        };
        match slot.as_ref() {
            Some(token) => {
                token.cancel();
                true
            }
            None => false,
        }
    }

    /// Close the protocol stream. Any in-flight operation is cancelled first.
    pub async fn disconnect(&self) -> Result<(), AppError> {
        self.cancel_current();
        let mut client = self.client.lock().await;
        client.disconnect().await
    }

    /// Wait briefly for the current operation to release the stream, then close
    /// it. Used before reconnecting so the old connection does not linger.
    pub async fn retire(&self) {
        self.cancel_current();
        let Ok(mut client) = tokio::time::timeout(Duration::from_secs(3), self.client.lock()).await
        else {
            return;
        };
        let _ = tokio::time::timeout(Duration::from_secs(3), client.disconnect()).await;
    }
}

/// Open a protocol client from retained session data. Transfers use this to
/// open their own connection instead of holding the browsing session's stream
/// for the duration of a file.
pub async fn connect_client(
    profile: &ConnectionProfile,
    credentials: &SessionCredentials,
    trusted: Vec<KnownHost>,
) -> Result<Box<dyn RemoteFs>, AppError> {
    match profile.protocol {
        ConnectionProtocol::Sftp => {
            let (password, passphrase) = match credentials {
                SessionCredentials::Password(password) => (Some(password.clone()), None),
                SessionCredentials::Key { passphrase } => (None, passphrase.clone()),
            };
            Ok(Box::new(
                SftpRemote::connect(
                    profile,
                    SftpCredentials {
                        password,
                        passphrase,
                    },
                    trusted,
                )
                .await?,
            ))
        }
        _ => {
            let password = match credentials {
                SessionCredentials::Password(password) => password,
                SessionCredentials::Key { .. } => {
                    return Err(AppError::new(
                        ErrorCode::AuthFailed,
                        "No password is saved for this connection.",
                    ));
                }
            };
            Ok(Box::new(FtpRemote::connect(profile, password).await?))
        }
    }
}

pub fn session_lost() -> AppError {
    AppError::new(
        ErrorCode::SessionNotReady,
        "The connection was lost. Reconnect to continue.",
    )
}

pub fn timeout_error() -> AppError {
    AppError::new(ErrorCode::Timeout, "The server took too long to respond. Try again, or raise the operation timeout in Settings.").retryable()
}

fn cancelled_error() -> AppError {
    AppError::new(ErrorCode::Cancelled, "The operation was cancelled.")
}

/// Run one operation against the session's protocol stream.
///
/// Operations are serialized, bounded by `timeout`, and can be cancelled with
/// [`Session::cancel_current`]. A cancelled or timed-out operation may leave the
/// protocol stream mid-reply, so the session is marked unusable and the user is
/// asked to reconnect instead of risking a desynchronized control channel.
pub async fn run_operation<T, F>(
    session: &Session,
    timeout: Duration,
    operation: F,
) -> Result<T, AppError>
where
    F: for<'a> FnOnce(&'a mut Box<dyn RemoteFs>) -> BoxFuture<'a, Result<T, AppError>>,
{
    if !session.is_usable() {
        return Err(session_lost());
    }

    let mut client = session.client.lock().await;
    // A failure or disconnect may have happened while this operation waited.
    if !session.is_usable() {
        return Err(session_lost());
    }

    let token = CancellationToken::new();
    match session.cancel.lock() {
        Ok(mut slot) => *slot = Some(token.clone()),
        Err(_) => {
            return Err(AppError::internal(
                "The session lock is poisoned.",
                "cancellation lock poisoned",
            ));
        }
    }

    let outcome = tokio::select! {
        biased;
        _ = token.cancelled() => Err(cancelled_error()),
        result = tokio::time::timeout(timeout, operation(&mut client)) => match result {
            Ok(result) => result,
            Err(_) => Err(timeout_error()),
        },
    };

    if let Ok(mut slot) = session.cancel.lock() {
        *slot = None;
    }

    if let Err(error) = &outcome
        && matches!(
            error.code,
            ErrorCode::Cancelled | ErrorCode::Timeout | ErrorCode::Network
        )
    {
        session.mark_unusable();
    }

    outcome
}

/// Tell the frontend that a session became unusable after a failed operation.
pub fn report_operation_failure(app: &AppHandle, session: &Session, error: &AppError) {
    if session.is_usable() {
        return;
    }
    emit_state(
        app,
        &session.info.id,
        &session.info.connection_id,
        SessionState::Failed,
        Some(error.message.clone()),
    );
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

    /// Every open session that belongs to a saved connection.
    pub fn for_connection(&self, connection_id: &str) -> Vec<Arc<Session>> {
        self.sessions
            .read()
            .expect("session lock poisoned")
            .values()
            .filter(|session| session.info.connection_id == connection_id)
            .cloned()
            .collect()
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
            .map(|session| {
                let mut info = session.info.clone();
                info.usable = session.is_usable();
                info
            })
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

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use async_trait::async_trait;
    use tokio::sync::Notify;

    use super::*;
    use crate::domain::connection::{
        ConnectionAuth, ConnectionInput, ConnectionProtocol, FtpDataMode, TlsOptions,
    };
    use crate::domain::fs::{FsCapabilities, FsEntry, Listing};

    struct FakeRemote {
        delay: Duration,
        started: Arc<Notify>,
    }

    #[async_trait]
    impl RemoteFs for FakeRemote {
        async fn list(&mut self, path: &str) -> Result<Listing, AppError> {
            self.started.notify_waiters();
            tokio::time::sleep(self.delay).await;
            Ok(Listing {
                path: path.to_string(),
                parent: None,
                entries: Vec::new(),
                capabilities: FsCapabilities::local(),
                read_at: 0.0,
                warnings: Vec::new(),
            })
        }

        async fn stat(&mut self, _path: &str) -> Result<FsEntry, AppError> {
            unimplemented!("not used by these tests")
        }

        async fn mkdir(&mut self, _parent: &str, _name: &str) -> Result<FsEntry, AppError> {
            unimplemented!("not used by these tests")
        }

        async fn rename(&mut self, _path: &str, _new_name: &str) -> Result<FsEntry, AppError> {
            unimplemented!("not used by these tests")
        }

        async fn delete(&mut self, _path: &str, _recursive: bool) -> Result<(), AppError> {
            unimplemented!("not used by these tests")
        }

        async fn chmod(&mut self, _path: &str, _mode: u32) -> Result<(), AppError> {
            unimplemented!("not used by these tests")
        }

        async fn open_read(
            &mut self,
            _path: &str,
            _offset: u64,
        ) -> Result<Box<dyn crate::fs::FileReader>, AppError> {
            unimplemented!("not used by these tests")
        }

        async fn open_write(
            &mut self,
            _path: &str,
            _offset: u64,
        ) -> Result<Box<dyn crate::fs::FileWriter>, AppError> {
            unimplemented!("not used by these tests")
        }

        async fn disconnect(&mut self) -> Result<(), AppError> {
            Ok(())
        }

        fn capabilities(&self) -> FsCapabilities {
            FsCapabilities::local()
        }
    }

    fn session(delay: Duration) -> (Session, Arc<Notify>) {
        let started = Arc::new(Notify::new());
        let profile = ConnectionProfile::from_input(
            "test".into(),
            ConnectionInput {
                name: "Test".into(),
                protocol: ConnectionProtocol::Sftp,
                host: "example.com".into(),
                port: 22,
                username: "ada".into(),
                auth: ConnectionAuth::Password,
                initial_path: "/".into(),
                favorite: false,
                group: None,
                tls: TlsOptions::default(),
                ftp_data_mode: FtpDataMode::Passive,
            },
            0.0,
        );
        let info = SessionInfo {
            id: "session".into(),
            connection_id: profile.id.clone(),
            name: profile.name.clone(),
            protocol: profile.protocol,
            host: profile.host.clone(),
            port: profile.port,
            username: profile.username.clone(),
            initial_path: profile.initial_path.clone(),
            capabilities: FsCapabilities::local(),
            connected_at: 0.0,
            latency_ms: 0.0,
            usable: true,
        };
        let remote = FakeRemote {
            delay,
            started: started.clone(),
        };
        (
            Session::new(
                info,
                profile,
                SessionCredentials::Password("secret".into()),
                Box::new(remote),
            ),
            started,
        )
    }

    #[tokio::test]
    async fn completes_an_operation_within_the_timeout() {
        let (session, _) = session(Duration::ZERO);
        let listing = run_operation(&session, Duration::from_secs(1), |client| {
            Box::pin(async move { client.list("/").await })
        })
        .await
        .expect("listing");
        assert_eq!(listing.path, "/");
        assert!(session.is_usable());
    }

    #[tokio::test]
    async fn times_out_and_marks_the_session_unusable() {
        let (session, _) = session(Duration::from_millis(500));
        let error = run_operation(&session, Duration::from_millis(20), |client| {
            Box::pin(async move { client.list("/").await })
        })
        .await
        .expect_err("timeout");
        assert_eq!(error.code, ErrorCode::Timeout);
        assert!(!session.is_usable());
    }

    #[tokio::test]
    async fn cancels_the_running_operation() {
        let (session, started) = session(Duration::from_secs(5));
        let session = Arc::new(session);
        let task = {
            let session = session.clone();
            tokio::spawn(async move {
                run_operation(&session, Duration::from_secs(30), |client| {
                    Box::pin(async move { client.list("/").await })
                })
                .await
            })
        };

        started.notified().await;
        assert!(session.cancel_current());
        let error = task.await.expect("task").expect_err("cancelled");
        assert_eq!(error.code, ErrorCode::Cancelled);
        assert!(!session.is_usable());
    }

    #[tokio::test]
    async fn refuses_operations_on_a_lost_session() {
        let (session, _) = session(Duration::ZERO);
        session.mark_unusable();
        let error = run_operation(&session, Duration::from_secs(1), |client| {
            Box::pin(async move { client.list("/").await })
        })
        .await
        .expect_err("lost session");
        assert_eq!(error.code, ErrorCode::SessionNotReady);
    }
}
