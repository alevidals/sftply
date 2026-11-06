use serde::{Deserialize, Serialize};
use specta::Type;

/// Stable, user-safe error codes shared with the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    Network,
    Timeout,
    AuthFailed,
    HostKeyUnknown,
    HostKeyMismatch,
    TlsCertificate,
    PermissionDenied,
    NotFound,
    AlreadyExists,
    Conflict,
    Unsupported,
    SessionNotReady,
    Protocol,
    Cancelled,
    KeychainUnavailable,
    ConfigCorrupt,
    ConfigWriteFailed,
    InvalidInput,
    Internal,
}

/// Error payload returned by every command.
///
/// `message` is safe to show to the user. `detail` must already be redacted:
/// it must never contain passwords, passphrases, key material, or tokens.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    pub detail: Option<String>,
    pub retryable: bool,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            detail: None,
            retryable: false,
        }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    pub fn retryable(mut self) -> Self {
        self.retryable = true;
        self
    }

    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidInput, message)
    }

    pub fn internal(message: impl Into<String>, detail: impl Into<String>) -> Self {
        Self::new(ErrorCode::Internal, message).with_detail(detail)
    }

    pub fn config_write(detail: impl Into<String>) -> Self {
        Self::new(
            ErrorCode::ConfigWriteFailed,
            "Could not save your settings.",
        )
        .with_detail(detail)
        .retryable()
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::internal("A filesystem operation failed.", error.to_string()).retryable()
    }
}
