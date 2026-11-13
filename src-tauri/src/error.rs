use serde::{Deserialize, Serialize};
use specta::Type;

use crate::domain::host_key::HostKeyChallenge;

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
    /// Present when the user can resolve the failure by trusting a host key.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_key: Option<Box<HostKeyChallenge>>,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            detail: None,
            retryable: false,
            host_key: None,
        }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    pub fn with_host_key(mut self, challenge: HostKeyChallenge) -> Self {
        self.host_key = Some(Box::new(challenge));
        self
    }

    pub fn retryable(mut self) -> Self {
        self.retryable = true;
        self
    }

    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidInput, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::NotFound, message)
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
        let message = match error.kind() {
            std::io::ErrorKind::StorageFull => "The disk is full.",
            _ => "A filesystem operation failed.",
        };
        Self::internal(message, error.to_string()).retryable()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_a_full_disk_to_an_honest_message() {
        let error = AppError::from(std::io::Error::from(std::io::ErrorKind::StorageFull));
        assert_eq!(error.code, ErrorCode::Internal);
        assert_eq!(error.message, "The disk is full.");
        assert!(error.retryable);
    }
}
