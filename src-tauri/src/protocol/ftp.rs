use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use async_trait::async_trait;
use rustls_platform_verifier::BuilderVerifierExt;
use suppaftp::FtpError;
use suppaftp::list::{File as FtpFile, ListParser, PosixPexQuery};
use suppaftp::tokio::{
    AsyncFtpStream, AsyncRustlsConnector, AsyncRustlsFtpStream, AsyncRustlsStream,
    ImplAsyncFtpStream,
};
use suppaftp::types::FileType as FtpFileType;

use crate::domain::connection::{ConnectionProfile, ConnectionProtocol};
use crate::domain::fs::{EntryKind, FsCapabilities, FsEntry, Listing};
use crate::domain::remote_path::{
    join_remote, normalize_remote, remote_leaf, remote_parent, validate_remote_name,
};
use crate::error::{AppError, ErrorCode};
use crate::protocol::{RemoteFs, listing, protocol_error, sanitize_detail};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);

/// One FTP control connection, either plaintext or TLS-wrapped. Implicit and
/// explicit FTPS both end up in the secure variant.
enum FtpClient {
    Plain(AsyncFtpStream),
    Secure(AsyncRustlsFtpStream),
}

macro_rules! on_client {
    ($client:expr, $method:ident($($arg:expr),*)) => {
        match $client {
            FtpClient::Plain(stream) => stream.$method($($arg),*).await,
            FtpClient::Secure(stream) => stream.$method($($arg),*).await,
        }
    };
}

pub struct FtpRemote {
    client: FtpClient,
    capabilities: FsCapabilities,
    /// Whether the server advertises MLSD. We fall back to LIST otherwise.
    mlsd: bool,
}

impl FtpRemote {
    pub async fn connect(profile: &ConnectionProfile, password: &str) -> Result<Self, AppError> {
        Self::connect_with(profile, password, None).await
    }

    /// Shared connect path. `connector` lets the integration suite inject a
    /// connector that trusts its throwaway CA; production always passes `None`.
    async fn connect_with(
        profile: &ConnectionProfile,
        password: &str,
        connector: Option<AsyncRustlsConnector>,
    ) -> Result<Self, AppError> {
        if matches!(profile.protocol, ConnectionProtocol::Sftp) {
            return Err(AppError::invalid_input(
                "That profile is not an FTP connection.",
            ));
        }
        let host = profile.host.clone();
        let port = profile.port;
        let username = profile.username.clone();
        let password = password.to_string();
        let protocol = profile.protocol;
        let connector = match protocol {
            ConnectionProtocol::FtpsExplicit | ConnectionProtocol::FtpsImplicit => Some(
                connector
                    .map(Ok)
                    .unwrap_or_else(tls_connector)
                    .map_err(map_ftp_error)?,
            ),
            _ => None,
        };

        let (client, features) = tokio::time::timeout(CONNECT_TIMEOUT, async move {
            let mut client = match protocol {
                ConnectionProtocol::Ftp => FtpClient::Plain(
                    AsyncFtpStream::connect((host.as_str(), port))
                        .await
                        .map_err(map_ftp_error)?,
                ),
                ConnectionProtocol::FtpsExplicit => {
                    let plain =
                        ImplAsyncFtpStream::<AsyncRustlsStream>::connect((host.as_str(), port))
                            .await
                            .map_err(map_ftp_error)?;
                    let connector = connector.expect("explicit FTPS needs a TLS connector");
                    FtpClient::Secure(
                        plain
                            .into_secure(connector, &host)
                            .await
                            .map_err(map_ftp_error)?,
                    )
                }
                ConnectionProtocol::FtpsImplicit => {
                    let connector = connector.expect("implicit FTPS needs a TLS connector");
                    FtpClient::Secure(
                        AsyncRustlsFtpStream::connect_secure_implicit(
                            (host.as_str(), port),
                            connector,
                            &host,
                        )
                        .await
                        .map_err(map_ftp_error)?,
                    )
                }
                ConnectionProtocol::Sftp => unreachable!("SFTP profiles are rejected above"),
            };

            on_client!(&mut client, login(username.as_str(), password.as_str()))
                .map_err(map_ftp_error)?;
            on_client!(&mut client, transfer_type(FtpFileType::Binary)).map_err(map_ftp_error)?;

            let features = match on_client!(&mut client, feat()) {
                Ok(features) => features,
                Err(error) => {
                    // FEAT is optional. LIST still works, so this is not fatal.
                    tracing::debug!(error = %error, "FTP server did not return FEAT");
                    HashMap::new()
                }
            };

            Ok::<_, AppError>((client, features))
        })
        .await
        .map_err(|_| {
            AppError::new(ErrorCode::Timeout, "The server did not answer in time.").retryable()
        })??;

        let mlsd = feature_present(&features, "MLSD");
        let chmod = feature_present(&features, "SITE CHMOD");
        let capabilities = FsCapabilities {
            list: true,
            mkdir: true,
            remove: true,
            rename: true,
            chmod,
            chown: false,
            symlinks: false,
            unix_permissions: mlsd,
            detailed_listing: mlsd,
            resume_download: crate::domain::fs::ResumeSupport::Supported,
            resume_upload: crate::domain::fs::ResumeSupport::Supported,
            server_side_move: false,
            server_side_copy: false,
            text_read: false,
            text_write: false,
        };

        Ok(Self {
            client,
            capabilities,
            mlsd,
        })
    }

    async fn entries(&mut self, path: &str) -> Result<(Vec<FsEntry>, Vec<String>), AppError> {
        let path = normalize_remote(path)?;
        let parent = remote_parent(&path)?.unwrap_or_else(|| "/".to_string());
        let mut warnings = Vec::new();
        let mut entries = Vec::new();

        if self.mlsd {
            let lines =
                on_client!(&mut self.client, mlsd(Some(path.as_str()))).map_err(map_ftp_error)?;
            for line in lines {
                match ListParser::parse_mlsd(&line) {
                    Ok(file) => match map_file(&file, &parent) {
                        Ok(Some(entry)) => entries.push(entry),
                        Ok(None) => {}
                        Err(message) => warnings.push(message),
                    },
                    Err(error) => {
                        warnings.push(format!("A server entry could not be read: {error}"))
                    }
                }
            }
        } else {
            let lines =
                on_client!(&mut self.client, list(Some(path.as_str()))).map_err(map_ftp_error)?;
            for line in lines {
                let parsed =
                    ListParser::parse_posix(&line).or_else(|_| ListParser::parse_dos(&line));
                match parsed {
                    Ok(file) => match map_file(&file, &parent) {
                        Ok(Some(entry)) => entries.push(entry),
                        Ok(None) => {}
                        Err(message) => warnings.push(message),
                    },
                    Err(error) => {
                        warnings.push(format!("A server entry could not be read: {error}"))
                    }
                }
            }
        }

        Ok((entries, warnings))
    }

    async fn delete_inner(&mut self, path: &str) -> Result<(), AppError> {
        let entry = self.stat(path).await?;
        if entry.kind == EntryKind::Directory {
            let listing = self.list(path).await?;
            for child in listing.entries {
                Box::pin(self.delete_inner(&child.path)).await?;
            }
            on_client!(&mut self.client, rmdir(path)).map_err(map_ftp_error)?;
        } else {
            on_client!(&mut self.client, rm(path)).map_err(map_ftp_error)?;
        }
        Ok(())
    }
}

#[async_trait]
impl RemoteFs for FtpRemote {
    async fn list(&mut self, path: &str) -> Result<Listing, AppError> {
        let path = normalize_remote(path)?;
        let parent = remote_parent(&path)?;
        let (entries, warnings) = self.entries(&path).await?;
        Ok(listing(
            path,
            parent,
            entries,
            self.capabilities.clone(),
            warnings,
        ))
    }

    async fn stat(&mut self, path: &str) -> Result<FsEntry, AppError> {
        let path = normalize_remote(path)?;
        if path == "/" {
            return Ok(root_entry());
        }
        let parent = remote_parent(&path)?.unwrap_or_else(|| "/".to_string());
        let leaf = remote_leaf(&path)?;
        let (entries, _) = self.entries(&parent).await?;
        entries
            .into_iter()
            .find(|entry| entry.name == leaf)
            .ok_or_else(|| AppError::not_found("That remote item does not exist."))
    }

    async fn mkdir(&mut self, parent: &str, name: &str) -> Result<FsEntry, AppError> {
        validate_remote_name(name)?;
        let target = join_remote(parent, name)?;
        on_client!(&mut self.client, mkdir(target.as_str())).map_err(map_ftp_error)?;
        self.stat(&target).await
    }

    async fn rename(&mut self, path: &str, new_name: &str) -> Result<FsEntry, AppError> {
        let path = normalize_remote(path)?;
        if path == "/" {
            return Err(AppError::invalid_input(
                "The root folder cannot be renamed.",
            ));
        }
        validate_remote_name(new_name)?;
        let parent = remote_parent(&path)?.unwrap_or_else(|| "/".to_string());
        let target = join_remote(&parent, new_name)?;
        if target == path {
            return self.stat(&path).await;
        }
        on_client!(&mut self.client, rename(path.as_str(), target.as_str()))
            .map_err(map_ftp_error)?;
        self.stat(&target).await
    }

    async fn delete(&mut self, path: &str, recursive: bool) -> Result<(), AppError> {
        let path = normalize_remote(path)?;
        if path == "/" {
            return Err(AppError::invalid_input(
                "The root folder cannot be deleted.",
            ));
        }
        let entry = self.stat(&path).await?;
        if entry.kind == EntryKind::Directory {
            let listing = self.list(&path).await?;
            if !recursive && !listing.entries.is_empty() {
                return Err(AppError::new(
                    ErrorCode::Conflict,
                    "That folder is not empty.",
                ));
            }
        }
        self.delete_inner(&path).await
    }

    async fn chmod(&mut self, path: &str, mode: u32) -> Result<(), AppError> {
        crate::fs::path::validate_mode(mode)?;
        if !self.capabilities.chmod {
            return Err(AppError::new(
                ErrorCode::Unsupported,
                "This server does not support changing permissions.",
            ));
        }
        let path = normalize_remote(path)?;
        let response = on_client!(&mut self.client, site(format!("CHMOD {mode:o} {path}")))
            .map_err(map_ftp_error)?;
        if response.status.code() / 100 != 2 {
            return Err(protocol_error(
                ErrorCode::Unsupported,
                "The server rejected the permission change.",
                sanitize_detail(&String::from_utf8_lossy(&response.body)),
            ));
        }
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), AppError> {
        let _ = on_client!(&mut self.client, quit());
        Ok(())
    }

    fn capabilities(&self) -> FsCapabilities {
        self.capabilities.clone()
    }
}

fn tls_connector() -> Result<AsyncRustlsConnector, FtpError> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|error| FtpError::SecureError(error.to_string()))?
        .with_platform_verifier()
        .map_err(|error| FtpError::SecureError(error.to_string()))?
        .with_no_client_auth();
    Ok(AsyncRustlsConnector::from(
        tokio_rustls::TlsConnector::from(Arc::new(config)),
    ))
}

fn feature_present(features: &HashMap<String, Option<String>>, name: &str) -> bool {
    features.keys().any(|key| key.eq_ignore_ascii_case(name))
}

fn map_file(file: &FtpFile, parent: &str) -> Result<Option<FsEntry>, String> {
    let name = file.name();
    if name == "." || name == ".." {
        return Ok(None);
    }
    let path = match join_remote(parent, name) {
        Ok(path) => path,
        Err(_) => return Ok(None),
    };
    let kind = if file.is_directory() {
        EntryKind::Directory
    } else if file.is_symlink() {
        EntryKind::Symlink
    } else if file.is_file() {
        EntryKind::File
    } else {
        EntryKind::Other
    };
    let modified_at = file
        .modified()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as f64);

    Ok(Some(FsEntry {
        name: name.to_string(),
        path,
        kind,
        size: file.size() as f64,
        modified_at,
        permissions: Some(mode_of(file)),
        owner: file.uid().map(|uid| uid.to_string()),
        group: file.gid().map(|gid| gid.to_string()),
        link_target: file
            .symlink()
            .map(|target| target.to_string_lossy().into_owned()),
        hidden: name.starts_with('.'),
        metadata_complete: true,
    }))
}

fn mode_of(file: &FtpFile) -> u32 {
    let mut mode = 0;
    for (query, shift) in [
        (PosixPexQuery::Owner, 6),
        (PosixPexQuery::Group, 3),
        (PosixPexQuery::Others, 0),
    ] {
        if file.can_read(query) {
            mode |= 0o4 << shift;
        }
        if file.can_write(query) {
            mode |= 0o2 << shift;
        }
        if file.can_execute(query) {
            mode |= 0o1 << shift;
        }
    }
    mode
}

fn root_entry() -> FsEntry {
    FsEntry {
        name: "/".to_string(),
        path: "/".to_string(),
        kind: EntryKind::Directory,
        size: 0.0,
        modified_at: None,
        permissions: None,
        owner: None,
        group: None,
        link_target: None,
        hidden: false,
        metadata_complete: true,
    }
}

fn map_ftp_error(error: FtpError) -> AppError {
    match error {
        FtpError::ConnectionError(error) => {
            if error.kind() == std::io::ErrorKind::TimedOut {
                AppError::new(ErrorCode::Timeout, "The server did not answer in time.").retryable()
            } else {
                AppError::new(ErrorCode::Network, "Could not reach the FTP server.")
                    .with_detail(error.to_string())
                    .retryable()
            }
        }
        FtpError::UnexpectedResponse(response) => map_status(response.status, &response.body),
        FtpError::SecureError(detail) => AppError::new(
            ErrorCode::TlsCertificate,
            "The secure connection could not be verified.",
        )
        .with_detail(detail),
        FtpError::BadResponse => {
            AppError::new(ErrorCode::Protocol, "The server sent an unexpected reply.")
        }
        FtpError::InvalidAddress(detail) => {
            AppError::invalid_input("The server address is not valid.")
                .with_detail(detail.to_string())
        }
        FtpError::DataConnectionAlreadyOpen => {
            AppError::new(ErrorCode::Protocol, "A data connection is already open.")
        }
    }
}

fn map_status(status: suppaftp::Status, body: &[u8]) -> AppError {
    use suppaftp::Status;

    let detail = sanitize_detail(&String::from_utf8_lossy(body));
    let (code, message) = match status {
        Status::NotLoggedIn => (ErrorCode::AuthFailed, "The server rejected the sign-in."),
        Status::FileUnavailable => {
            if detail.to_ascii_lowercase().contains("permission") {
                (
                    ErrorCode::PermissionDenied,
                    "You do not have permission for that item.",
                )
            } else {
                (ErrorCode::NotFound, "That remote item does not exist.")
            }
        }
        Status::BadFilename => (ErrorCode::InvalidInput, "The server rejected that name."),
        Status::BadCommand | Status::NotImplemented | Status::NotImplementedParameter => (
            ErrorCode::Unsupported,
            "The server does not support that operation.",
        ),
        Status::NotAvailable | Status::CannotOpenDataConnection => {
            (ErrorCode::Network, "The server closed the connection.")
        }
        Status::TransferAborted => (ErrorCode::Network, "The server aborted the operation."),
        _ => (ErrorCode::Protocol, "The server rejected the request."),
    };
    AppError::new(code, message).with_detail(detail)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_features_case_insensitively() {
        let mut features = HashMap::new();
        features.insert("mlsd".to_string(), None);
        features.insert("SITE CHMOD".to_string(), None);

        assert!(feature_present(&features, "MLSD"));
        assert!(feature_present(&features, "site chmod"));
        assert!(!feature_present(&features, "UTF8"));
    }

    #[test]
    fn maps_status_codes_to_stable_errors() {
        let auth = map_status(suppaftp::Status::NotLoggedIn, b"530 login incorrect");
        assert_eq!(auth.code, ErrorCode::AuthFailed);
        assert_eq!(auth.detail.as_deref(), Some("530 login incorrect"));

        let missing = map_status(suppaftp::Status::FileUnavailable, b"550 not found");
        assert_eq!(missing.code, ErrorCode::NotFound);

        let denied = map_status(suppaftp::Status::FileUnavailable, b"550 permission denied");
        assert_eq!(denied.code, ErrorCode::PermissionDenied);

        let unsupported = map_status(suppaftp::Status::NotImplemented, b"502");
        assert_eq!(unsupported.code, ErrorCode::Unsupported);

        let aborted = map_status(suppaftp::Status::TransferAborted, b"426");
        assert_eq!(aborted.code, ErrorCode::Network);
    }

    #[test]
    fn maps_connection_errors_without_leaking_them() {
        let error = map_ftp_error(FtpError::ConnectionError(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "timed out",
        )));
        assert_eq!(error.code, ErrorCode::Timeout);
        assert!(error.retryable);

        let error = map_ftp_error(FtpError::ConnectionError(std::io::Error::new(
            std::io::ErrorKind::ConnectionRefused,
            "refused",
        )));
        assert_eq!(error.code, ErrorCode::Network);
        assert!(error.retryable);
    }
}

/// End-to-end tests against the Docker services in `tests/integration`.
/// Run with `cargo test -- --ignored` after starting the compose stack.
#[cfg(test)]
mod integration {
    use super::*;
    use crate::domain::connection::{ConnectionAuth, ConnectionInput};

    const PASSWORD: &str = "sftply-test";

    fn profile(protocol: ConnectionProtocol, port: u16) -> ConnectionProfile {
        ConnectionProfile::from_input(
            "integration".into(),
            ConnectionInput {
                name: "Integration".into(),
                protocol,
                host: "127.0.0.1".into(),
                port,
                username: "sftply".into(),
                auth: ConnectionAuth::Password,
                initial_path: "/".into(),
                favorite: false,
                group: None,
            },
            0.0,
        )
    }

    /// Connector that trusts the throwaway CA generated by
    /// `tests/integration/generate-certs.sh`.
    fn test_connector() -> AsyncRustlsConnector {
        let ca_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/integration/certs/ca.crt");
        let pem = std::fs::read(&ca_path)
            .unwrap_or_else(|error| panic!("read {}: {error}", ca_path.display()));
        let mut roots = rustls::RootCertStore::empty();
        for certificate in rustls_pemfile::certs(&mut pem.as_slice()) {
            roots
                .add(certificate.expect("valid CA certificate"))
                .expect("add CA certificate");
        }
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let config = rustls::ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .expect("safe protocol versions")
            .with_root_certificates(roots)
            .with_no_client_auth();
        AsyncRustlsConnector::from(tokio_rustls::TlsConnector::from(Arc::new(config)))
    }

    async fn exercise_crud(protocol: ConnectionProtocol, port: u16, secure: bool) {
        let profile = profile(protocol, port);
        let connector = secure.then(test_connector);
        let mut remote = FtpRemote::connect_with(&profile, PASSWORD, connector)
            .await
            .unwrap_or_else(|error| panic!("connect to {protocol:?} on {port}: {error}"));

        let capabilities = remote.capabilities();
        assert!(capabilities.list);
        assert!(capabilities.mkdir);
        assert!(capabilities.remove);
        assert!(capabilities.rename);

        let root = remote.list("/").await.expect("list root");
        assert_eq!(root.path, "/");
        assert!(root.entries.iter().all(|entry| entry.name != "."));

        let stamp = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_millis();
        let folder = format!("it-{stamp}");
        let path = format!("/{folder}");

        let created = remote.mkdir("/", &folder).await.expect("mkdir");
        assert_eq!(created.kind, EntryKind::Directory);
        assert_eq!(created.path, path);

        let listing = remote.list("/").await.expect("list after mkdir");
        assert!(listing.entries.iter().any(|entry| entry.name == folder));

        let renamed_name = format!("{folder}-renamed");
        let renamed_path = format!("/{renamed_name}");
        let renamed = remote.rename(&path, &renamed_name).await.expect("rename");
        assert_eq!(renamed.name, renamed_name);

        let stat = remote.stat(&renamed_path).await.expect("stat renamed");
        assert_eq!(stat.kind, EntryKind::Directory);

        remote.delete(&renamed_path, true).await.expect("delete");
        let missing = remote.stat(&renamed_path).await;
        assert_eq!(
            missing.expect_err("deleted folder is gone").code,
            ErrorCode::NotFound
        );

        remote.disconnect().await.expect("disconnect");
    }

    #[tokio::test]
    #[ignore = "requires tests/integration/docker-compose.yml"]
    async fn plain_ftp_crud() {
        exercise_crud(ConnectionProtocol::Ftp, 2121, false).await;
    }

    #[tokio::test]
    #[ignore = "requires tests/integration/docker-compose.yml"]
    async fn explicit_ftps_crud() {
        exercise_crud(ConnectionProtocol::FtpsExplicit, 2122, true).await;
    }

    #[tokio::test]
    #[ignore = "requires tests/integration/docker-compose.yml"]
    async fn implicit_ftps_crud() {
        exercise_crud(ConnectionProtocol::FtpsImplicit, 2990, true).await;
    }

    #[tokio::test]
    #[ignore = "requires tests/integration/docker-compose.yml"]
    async fn rejects_wrong_password() {
        let profile = profile(ConnectionProtocol::Ftp, 2121);
        let result = FtpRemote::connect_with(&profile, "wrong-password", None).await;
        match result {
            Ok(_) => panic!("wrong password must fail"),
            Err(error) => assert_eq!(error.code, ErrorCode::AuthFailed),
        }
    }
}
