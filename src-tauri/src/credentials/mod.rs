use crate::domain::credentials::{SecretKind, SecretStatus};
use crate::error::{AppError, ErrorCode};

/// Keychain service name. Every item is stored under
/// `{connection-id}:{secret-kind}` in the platform credential store.
const SERVICE: &str = "dev.sftply.credentials";
const MAX_SECRET_LEN: usize = 8192;

fn entry(connection_id: &str, kind: SecretKind) -> Result<keyring::Entry, AppError> {
    keyring::Entry::new(SERVICE, &format!("{connection_id}:{}", kind.key())).map_err(keychain_error)
}

pub async fn set_secret(
    connection_id: &str,
    kind: SecretKind,
    secret: &str,
) -> Result<(), AppError> {
    validate_secret(secret)?;
    let connection_id = connection_id.to_string();
    let secret = secret.to_string();
    run_blocking(move || {
        entry(&connection_id, kind)?
            .set_password(&secret)
            .map_err(keychain_error)
    })
    .await
}

/// Read a secret for backend use only. The value must never be returned across
/// the IPC boundary or logged.
pub async fn get_secret(connection_id: &str, kind: SecretKind) -> Result<Option<String>, AppError> {
    let connection_id = connection_id.to_string();
    run_blocking(move || match entry(&connection_id, kind)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(keychain_error(error)),
    })
    .await
}

pub async fn delete_secret(connection_id: &str, kind: SecretKind) -> Result<(), AppError> {
    let connection_id = connection_id.to_string();
    run_blocking(
        move || match entry(&connection_id, kind)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(keychain_error(error)),
        },
    )
    .await
}

pub async fn delete_all(connection_id: &str) -> Result<(), AppError> {
    delete_secret(connection_id, SecretKind::Password).await?;
    delete_secret(connection_id, SecretKind::Passphrase).await
}

/// Report which secrets exist without exposing them to the frontend.
pub async fn status(connection_id: &str) -> Result<SecretStatus, AppError> {
    let password = get_secret(connection_id, SecretKind::Password)
        .await?
        .is_some();
    let passphrase = get_secret(connection_id, SecretKind::Passphrase)
        .await?
        .is_some();
    Ok(SecretStatus {
        password,
        passphrase,
    })
}

fn validate_secret(secret: &str) -> Result<(), AppError> {
    if secret.is_empty() {
        return Err(AppError::invalid_input("A secret cannot be empty."));
    }
    if secret.len() > MAX_SECRET_LEN {
        return Err(AppError::invalid_input("The secret is too long."));
    }
    Ok(())
}

async fn run_blocking<T, F>(task: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
{
    tokio::task::spawn_blocking(task).await.map_err(|error| {
        AppError::new(
            ErrorCode::KeychainUnavailable,
            "The system keychain is not available.",
        )
        .with_detail(format!("keychain task failed: {error}"))
    })?
}

fn keychain_error(error: keyring::Error) -> AppError {
    // Keyring errors describe the store, never the secret itself.
    AppError::new(
        ErrorCode::KeychainUnavailable,
        "The system keychain could not be accessed. Unlock the keychain and try again.",
    )
    .with_detail(error.to_string())
    .retryable()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_secret_bounds_without_logging_values() {
        assert!(validate_secret("hunter2").is_ok());
        assert!(validate_secret("").is_err());
        assert!(validate_secret(&"x".repeat(MAX_SECRET_LEN + 1)).is_err());
    }
}
