use std::collections::HashMap;
use std::time::{Duration, UNIX_EPOCH};

use async_trait::async_trait;
use suppaftp::FtpError;
use suppaftp::Mode as FtpMode;
use suppaftp::list::{File as FtpFile, ListParser, PosixPexQuery};
use suppaftp::tokio::{
    AsyncFtpStream, AsyncNoTlsStream, AsyncRustlsConnector, AsyncRustlsFtpStream,
    AsyncRustlsStream, ImplAsyncFtpStream, TransferStream,
};
use suppaftp::types::FileType as FtpFileType;

use crate::domain::connection::{ConnectionProfile, ConnectionProtocol, FtpDataMode};
use crate::domain::fs::{EntryKind, FsCapabilities, FsEntry, Listing};
use crate::domain::remote_path::{
    join_remote, normalize_remote, remote_leaf, remote_parent, validate_remote_name,
};
use crate::error::{AppError, ErrorCode};
use crate::fs::{FileReader, FileWriter};
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

/// Data connection for a plain or TLS-wrapped FTP transfer. Both variants
/// finalize through suppaftp's `TransferStream`, which checks the server's
/// completion reply.
enum FtpTransferStream {
    Plain(TransferStream<AsyncNoTlsStream>),
    Secure(TransferStream<AsyncRustlsStream>),
}

impl FtpTransferStream {
    async fn read(&mut self, buf: &mut [u8]) -> Result<usize, AppError> {
        use tokio::io::AsyncReadExt;
        match self {
            Self::Plain(stream) => stream.read(buf).await.map_err(map_transfer_io),
            Self::Secure(stream) => stream.read(buf).await.map_err(map_transfer_io),
        }
    }

    async fn write(&mut self, buf: &[u8]) -> Result<usize, AppError> {
        use tokio::io::AsyncWriteExt;
        match self {
            Self::Plain(stream) => stream.write(buf).await.map_err(map_transfer_io),
            Self::Secure(stream) => stream.write(buf).await.map_err(map_transfer_io),
        }
    }

    async fn finish(self) -> Result<(), AppError> {
        match self {
            Self::Plain(stream) => stream.finish().await.map_err(map_ftp_error),
            Self::Secure(stream) => stream.finish().await.map_err(map_ftp_error),
        }
    }
}

struct FtpReader {
    stream: Option<FtpTransferStream>,
}

#[async_trait]
impl FileReader for FtpReader {
    async fn read(&mut self, buf: &mut [u8]) -> Result<usize, AppError> {
        self.stream
            .as_mut()
            .ok_or_else(|| AppError::internal("The transfer stream is closed.", "missing stream"))?
            .read(buf)
            .await
    }

    async fn finish(mut self: Box<Self>) -> Result<(), AppError> {
        match self.stream.take() {
            Some(stream) => stream.finish().await,
            None => Ok(()),
        }
    }
}

struct FtpWriter {
    stream: Option<FtpTransferStream>,
}

#[async_trait]
impl FileWriter for FtpWriter {
    async fn write(&mut self, buf: &[u8]) -> Result<usize, AppError> {
        self.stream
            .as_mut()
            .ok_or_else(|| AppError::internal("The transfer stream is closed.", "missing stream"))?
            .write(buf)
            .await
    }

    async fn finish(mut self: Box<Self>) -> Result<(), AppError> {
        match self.stream.take() {
            Some(stream) => stream.finish().await,
            None => Ok(()),
        }
    }

    async fn abort(mut self: Box<Self>) -> Result<(), AppError> {
        // Dropping the stream closes the data socket. suppaftp defers the
        // server's completion reply to the next control command, so a
        // best-effort cleanup command can drain it.
        self.stream.take();
        Ok(())
    }
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
        let data_mode = profile.ftp_data_mode;
        let connector = match protocol {
            ConnectionProtocol::FtpsExplicit | ConnectionProtocol::FtpsImplicit => {
                Some(match connector {
                    Some(connector) => connector,
                    None => crate::protocol::tls::build_connector(&profile.tls)?,
                })
            }
            _ => None,
        };

        let (client, features) = tokio::time::timeout(CONNECT_TIMEOUT, async move {
            tracing::debug!("FTP connect: opening the control connection");
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

            tracing::debug!("FTP connect: control channel ready; signing in");
            on_client!(&mut client, login(username.as_str(), password.as_str()))
                .map_err(|error| ftp_phase_error("sign-in", error))?;
            tracing::debug!("FTP connect: signed in; requesting a binary transfer type");
            on_client!(&mut client, transfer_type(FtpFileType::Binary))
                .map_err(|error| ftp_phase_error("transfer type", error))?;

            let mode = match data_mode {
                FtpDataMode::Passive => FtpMode::Passive,
                FtpDataMode::ExtendedPassive => FtpMode::ExtendedPassive,
                FtpDataMode::Active => FtpMode::Active,
            };
            match &mut client {
                FtpClient::Plain(stream) => stream.set_mode(mode),
                FtpClient::Secure(stream) => stream.set_mode(mode),
            }

            let features = match on_client!(&mut client, feat()) {
                Ok(features) => features,
                Err(error) => {
                    // FEAT is optional. LIST still works, so this is not fatal.
                    // ftpd on the 3DS sends a blank line that some parsers reject.
                    tracing::debug!(error = %error, "FTP server did not return usable FEAT");
                    HashMap::new()
                }
            };

            Ok::<_, AppError>((client, features))
        })
        .await
        .map_err(|_| {
            tracing::warn!(
                host = %profile.host,
                port = profile.port,
                "FTP connect: timed out during the handshake"
            );
            AppError::new(ErrorCode::Timeout, "The server did not answer in time.").retryable()
        })??;

        let mlsd = feature_present(&features, "MLSD");
        let chmod = feature_present(&features, "SITE CHMOD");
        tracing::debug!(
            host = %profile.host,
            port = profile.port,
            mlsd,
            chmod,
            "FTP connect: handshake complete"
        );
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
            text_read: true,
            text_write: true,
        };

        Ok(Self {
            client,
            capabilities,
            mlsd,
        })
    }

    async fn entries(&mut self, path: &str) -> Result<(Vec<FsEntry>, Vec<String>), AppError> {
        let path = normalize_remote(path)?;
        let lines = if self.mlsd {
            on_client!(&mut self.client, mlsd(Some(path.as_str()))).map_err(map_ftp_error)?
        } else {
            on_client!(&mut self.client, list(Some(path.as_str()))).map_err(map_ftp_error)?
        };
        Ok(parse_listing(self.mlsd, &lines, &path))
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

    async fn open_read(
        &mut self,
        path: &str,
        offset: u64,
    ) -> Result<Box<dyn FileReader>, AppError> {
        let path = normalize_remote(path)?;
        if offset > 0 {
            on_client!(&mut self.client, resume_transfer(offset as usize))
                .map_err(map_ftp_error)?;
        }
        let stream = match &mut self.client {
            FtpClient::Plain(stream) => FtpTransferStream::Plain(
                stream
                    .retr_as_stream(path.as_str())
                    .await
                    .map_err(map_ftp_error)?,
            ),
            FtpClient::Secure(stream) => FtpTransferStream::Secure(
                stream
                    .retr_as_stream(path.as_str())
                    .await
                    .map_err(map_ftp_error)?,
            ),
        };
        Ok(Box::new(FtpReader {
            stream: Some(stream),
        }))
    }

    async fn open_write(
        &mut self,
        path: &str,
        offset: u64,
    ) -> Result<Box<dyn FileWriter>, AppError> {
        let path = normalize_remote(path)?;
        if offset > 0 {
            on_client!(&mut self.client, resume_transfer(offset as usize))
                .map_err(map_ftp_error)?;
        }
        let stream = match &mut self.client {
            FtpClient::Plain(stream) => FtpTransferStream::Plain(
                stream
                    .put_with_stream(path.as_str())
                    .await
                    .map_err(map_ftp_error)?,
            ),
            FtpClient::Secure(stream) => FtpTransferStream::Secure(
                stream
                    .put_with_stream(path.as_str())
                    .await
                    .map_err(map_ftp_error)?,
            ),
        };
        Ok(Box::new(FtpWriter {
            stream: Some(stream),
        }))
    }

    async fn disconnect(&mut self) -> Result<(), AppError> {
        let _ = on_client!(&mut self.client, quit());
        Ok(())
    }

    fn capabilities(&self) -> FsCapabilities {
        self.capabilities.clone()
    }
}

fn feature_present(features: &HashMap<String, Option<String>>, name: &str) -> bool {
    features.keys().any(|key| key.eq_ignore_ascii_case(name))
}

/// Turn raw `MLSD`/`LIST` lines into entries. Kept free of I/O so hostile
/// server output can be property-tested without a connection.
fn parse_listing(mlsd: bool, lines: &[String], directory: &str) -> (Vec<FsEntry>, Vec<String>) {
    let mut warnings = Vec::new();
    let mut entries = Vec::new();

    for line in lines {
        let parsed = if mlsd {
            ListParser::parse_mlsd(line).map_err(|error| error.to_string())
        } else {
            ListParser::parse_posix(line)
                .or_else(|_| ListParser::parse_dos(line))
                .map_err(|error| error.to_string())
        };
        match parsed {
            Ok(file) => match map_file(&file, directory) {
                Ok(Some(entry)) => entries.push(entry),
                Ok(None) => {}
                Err(message) => warnings.push(message),
            },
            Err(error) => warnings.push(format!("A server entry could not be read: {error}")),
        }
    }

    (entries, warnings)
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

fn map_transfer_io(error: std::io::Error) -> AppError {
    if error.kind() == std::io::ErrorKind::TimedOut {
        AppError::new(ErrorCode::Timeout, "The transfer timed out.").retryable()
    } else {
        AppError::new(ErrorCode::Network, "The transfer connection failed.")
            .with_detail(error.to_string())
            .retryable()
    }
}

/// Map a handshake failure and record which step failed. The log line never
/// contains credentials: only the phase and the already-redacted error.
fn ftp_phase_error(phase: &'static str, error: FtpError) -> AppError {
    let mapped = map_ftp_error(error);
    tracing::warn!(
        phase,
        code = ?mapped.code,
        message = %mapped.message,
        detail = ?mapped.detail,
        "FTP handshake failed"
    );
    mapped
}

fn map_ftp_error(error: FtpError) -> AppError {
    match error {
        FtpError::ConnectionError(error) => map_connection_error(error),
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

/// Turn a socket failure into a message that tells the user what to check.
/// The raw OS text stays in `detail`; it contains no credentials.
fn map_connection_error(error: std::io::Error) -> AppError {
    use std::io::ErrorKind;

    match error.kind() {
        ErrorKind::TimedOut => {
            AppError::new(ErrorCode::Timeout, "The server did not answer in time.").retryable()
        }
        ErrorKind::ConnectionRefused => {
            AppError::new(ErrorCode::Network, "The server refused the connection.")
                .with_detail(
                    "Nothing is listening on that host and port. Check the port number and that the server is running.",
                )
                .retryable()
        }
        ErrorKind::HostUnreachable | ErrorKind::NetworkUnreachable => {
            AppError::new(
                ErrorCode::Network,
                "The server is not reachable from this computer.",
            )
            .with_detail(
                "The network could not deliver packets to that address. Check that the device is powered on and on the same network, and that the router is not blocking it.",
            )
            .retryable()
        }
        ErrorKind::ConnectionReset | ErrorKind::ConnectionAborted | ErrorKind::BrokenPipe => {
            AppError::new(
                ErrorCode::Network,
                "The server closed the connection unexpectedly.",
            )
            .with_detail(error.to_string())
            .retryable()
        }
        _ => {
            let detail = error.to_string();
            if detail.contains("lookup address") || detail.contains("nodename") {
                AppError::new(
                    ErrorCode::Network,
                    "The server name could not be resolved.",
                )
                .with_detail(
                    "Check the host name for typos, or enter the IP address instead.",
                )
                .retryable()
            } else {
                AppError::new(ErrorCode::Network, "Could not reach the FTP server.")
                    .with_detail(detail)
                    .retryable()
            }
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
        Status::ExceededStorage => (
            ErrorCode::Protocol,
            "The server does not have enough space for that file.",
        ),
        Status::RequestedActionNotTaken => {
            let lower = detail.to_ascii_lowercase();
            if lower.contains("space") || lower.contains("storage") || lower.contains("quota") {
                (
                    ErrorCode::Protocol,
                    "The server does not have enough space for that file.",
                )
            } else {
                (ErrorCode::Protocol, "The server rejected the operation.")
            }
        }
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

        let full = map_status(suppaftp::Status::ExceededStorage, b"552 exceeded storage");
        assert_eq!(
            full.message,
            "The server does not have enough space for that file."
        );

        let transient = map_status(
            suppaftp::Status::RequestedActionNotTaken,
            b"452 Sorry, insufficient disk space",
        );
        assert_eq!(
            transient.message,
            "The server does not have enough space for that file."
        );

        let other = map_status(
            suppaftp::Status::RequestedActionNotTaken,
            b"452 Try again later",
        );
        assert_eq!(other.message, "The server rejected the operation.");
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

    #[test]
    fn explains_an_unreachable_host() {
        let error = map_connection_error(std::io::Error::new(
            std::io::ErrorKind::HostUnreachable,
            "No route to host (os error 65)",
        ));

        assert_eq!(error.code, ErrorCode::Network);
        assert!(error.retryable);
        assert!(error.message.contains("not reachable"), "{error:?}");
        assert!(
            error
                .detail
                .as_deref()
                .is_some_and(|detail| detail.contains("same network")),
            "{error:?}"
        );
    }

    #[test]
    fn explains_a_refused_connection() {
        let error = map_connection_error(std::io::Error::new(
            std::io::ErrorKind::ConnectionRefused,
            "Connection refused (os error 61)",
        ));

        assert_eq!(error.code, ErrorCode::Network);
        assert!(error.message.contains("refused"), "{error:?}");
        assert!(
            error
                .detail
                .as_deref()
                .is_some_and(|detail| detail.contains("port number")),
            "{error:?}"
        );
    }

    #[test]
    fn explains_a_dns_failure() {
        let error = map_connection_error(std::io::Error::other(
            "failed to lookup address information: nodename nor servname provided",
        ));

        assert_eq!(error.code, ErrorCode::Network);
        assert!(error.message.contains("resolved"), "{error:?}");
    }
}

/// Reproduces the quirks of the 3DS homebrew `ftpd` server (mtheall/ftpd):
/// a FEAT reply with an empty line before the terminator, no MLSD feature,
/// POSIX listings, and a `150` reply that is only sent once the passive data
/// connection has been accepted. Cyberduck and Finder connect to it, so the
/// adapter must too.
#[cfg(test)]
mod three_ds_compat {
    use super::*;
    use crate::domain::connection::{ConnectionAuth, ConnectionInput, TlsOptions};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::{TcpListener, TcpStream};

    const FEAT_REPLY: &str = "211-\r\n MDTM\r\n MLST Type*;Size*;Modify*;Perm*;UNIX.mode*;\r\n MODE Z\r\n PASV\r\n REST STREAM\r\n SIZE\r\n TVFS\r\n UTF8\r\n\r\n211 End\r\n";

    const LIST_REPLY: &str = "-rw-r--r-- 1 3DS 3DS 1225607362 Nov 11 11:49 GOPR4100.MP4\r\ndrwxr-sr-x 2 3DS 3DS 4096 Nov 11 11:38 upload\r\n-rw-r--r-- 1 3DS 3DS 36 Nov  1 2025 welcome.txt\r\n";

    async fn session(control: TcpStream) {
        let (read_half, mut out) = control.into_split();
        let mut reader = BufReader::new(read_half);
        let mut passive: Option<TcpListener> = None;

        out.write_all(b"220 Hello!\r\n").await.expect("greeting");

        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).await.expect("read command") == 0 {
                break;
            }
            let line = line.trim_end_matches(['\r', '\n']);
            let (verb, args) = match line.split_once(' ') {
                Some((verb, args)) => (verb.to_ascii_uppercase(), args),
                None => (line.to_ascii_uppercase(), ""),
            };

            match verb.as_str() {
                "USER" => out.write_all(b"331 Need password\r\n").await.expect("user"),
                "PASS" => out.write_all(b"230 OK\r\n").await.expect("pass"),
                "TYPE" => out.write_all(b"200 OK\r\n").await.expect("type"),
                "FEAT" => out.write_all(FEAT_REPLY.as_bytes()).await.expect("feat"),
                "PASV" => {
                    let listener = TcpListener::bind(("127.0.0.1", 0))
                        .await
                        .expect("bind passive listener");
                    let port = listener.local_addr().expect("passive addr").port();
                    passive = Some(listener);
                    let reply = format!(
                        "227 Entering Passive Mode (127,0,0,1,{},{})\r\n",
                        port >> 8,
                        port & 0xff
                    );
                    out.write_all(reply.as_bytes()).await.expect("pasv");
                }
                "LIST" => {
                    // ftpd accepts the already-queued data connection and only
                    // then sends the 150 reply.
                    let listener = passive.take().expect("PASV must precede LIST");
                    let (mut data, _) = listener.accept().await.expect("accept data");
                    out.write_all(b"150 Ready\r\n").await.expect("150");
                    data.write_all(LIST_REPLY.as_bytes())
                        .await
                        .expect("listing");
                    data.shutdown().await.expect("close data");
                    out.write_all(b"226 OK\r\n").await.expect("226");
                }
                "QUIT" => {
                    out.write_all(b"221 Disconnecting\r\n").await.expect("quit");
                    break;
                }
                _ => out
                    .write_all(b"502 Invalid command\r\n")
                    .await
                    .expect("502"),
            }
            let _ = args;
        }
    }

    async fn spawn_server() -> u16 {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        tokio::spawn(async move {
            if let Ok((control, _)) = listener.accept().await {
                session(control).await;
            }
        });
        port
    }

    fn profile(port: u16) -> ConnectionProfile {
        ConnectionProfile::from_input(
            "3ds".into(),
            ConnectionInput {
                name: "3DS".into(),
                protocol: ConnectionProtocol::Ftp,
                host: "127.0.0.1".into(),
                port,
                username: "anonymous".into(),
                auth: ConnectionAuth::Password,
                initial_path: "/".into(),
                favorite: false,
                group: None,
                tls: TlsOptions::default(),
                ftp_data_mode: FtpDataMode::Passive,
            },
            0.0,
        )
    }

    #[tokio::test]
    async fn connects_and_lists_through_a_3ds_style_server() {
        let port = spawn_server().await;
        let mut remote = FtpRemote::connect(&profile(port), "")
            .await
            .expect("the 3DS FEAT reply must not break the handshake");

        assert!(!remote.capabilities.detailed_listing);
        assert!(!remote.capabilities.unix_permissions);

        let listing = remote.list("/").await.expect("list the root");
        let mut names: Vec<&str> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        names.sort_unstable();
        assert_eq!(names, ["GOPR4100.MP4", "upload", "welcome.txt"]);
        assert!(listing.warnings.is_empty(), "{:?}", listing.warnings);

        let upload = listing
            .entries
            .iter()
            .find(|entry| entry.name == "upload")
            .expect("upload folder");
        assert_eq!(upload.kind, EntryKind::Directory);
        assert_eq!(upload.path, "/upload");

        let video = listing
            .entries
            .iter()
            .find(|entry| entry.name == "GOPR4100.MP4")
            .expect("video file");
        assert_eq!(video.kind, EntryKind::File);
        assert_eq!(video.size, 1_225_607_362.0);
    }
}

/// End-to-end tests against the Docker services in `tests/integration`.
/// Run with `cargo test -- --ignored` after starting the compose stack.
#[cfg(test)]
mod integration {
    use super::*;
    use crate::domain::connection::{ConnectionAuth, ConnectionInput, TlsOptions};

    const PASSWORD: &str = "sftply-test";

    fn assert_streaming_payload(received: &[u8], expected: &[u8]) {
        assert_eq!(
            received.len(),
            expected.len(),
            "streamed byte count differs"
        );
        if let Some(index) = received
            .iter()
            .zip(expected.iter())
            .position(|(left, right)| left != right)
        {
            panic!(
                "streamed payload differs at byte {index}: received {:#04x}, expected {:#04x}",
                received[index], expected[index]
            );
        }
    }

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
                tls: TlsOptions::default(),
                ftp_data_mode: FtpDataMode::Passive,
            },
            0.0,
        )
    }

    fn test_tls() -> TlsOptions {
        let ca_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/integration/certs/ca.crt");
        TlsOptions {
            ca_file: Some(ca_path.to_string_lossy().into_owned()),
            certificate_pin: None,
            allow_invalid_certificates: false,
        }
    }

    /// Connector that trusts the throwaway CA generated by
    /// `tests/integration/generate-certs.sh`.
    fn test_connector() -> AsyncRustlsConnector {
        crate::protocol::tls::build_connector(&test_tls()).expect("build test connector")
    }

    fn server_certificate_pin() -> String {
        use sha2::{Digest, Sha256};

        let pem_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/integration/certs/pure-ftpd.pem");
        let pem = std::fs::read(&pem_path)
            .unwrap_or_else(|error| panic!("read {}: {error}", pem_path.display()));
        let certificate = rustls_pemfile::certs(&mut pem.as_slice())
            .next()
            .expect("server certificate")
            .expect("valid server certificate");
        Sha256::digest(certificate.as_ref())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
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

    async fn exercise_streaming(protocol: ConnectionProtocol, port: u16, secure: bool) {
        let profile = profile(protocol, port);
        let connector = secure.then(test_connector);
        let mut remote = FtpRemote::connect_with(&profile, PASSWORD, connector)
            .await
            .unwrap_or_else(|error| panic!("connect to {protocol:?} on {port}: {error}"));

        let stamp = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_millis();
        let folder = format!("stream-{stamp}");
        let folder_path = format!("/{folder}");
        remote.mkdir("/", &folder).await.expect("mkdir");

        let payload: Vec<u8> = (0..200_000u32).map(|value| (value % 251) as u8).collect();
        let path = format!("{folder_path}/data.bin");

        let mut writer = remote.open_write(&path, 0).await.expect("open write");
        for chunk in payload.chunks(64 * 1024) {
            let mut written = 0;
            while written < chunk.len() {
                let count = writer.write(&chunk[written..]).await.expect("write chunk");
                assert!(count > 0, "writer made no progress");
                written += count;
            }
        }
        writer.finish().await.expect("finish upload");

        let listing = remote.list(&folder_path).await.expect("list upload folder");
        let uploaded = listing
            .entries
            .iter()
            .find(|entry| entry.name == "data.bin")
            .expect("uploaded file is listed");
        assert_eq!(
            uploaded.path, path,
            "listed entries must be joined against the listed folder"
        );

        let mut reader = remote.open_read(&path, 0).await.expect("open read");
        let mut received = Vec::new();
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let read = reader.read(&mut buffer).await.expect("read chunk");
            if read == 0 {
                break;
            }
            received.extend_from_slice(&buffer[..read]);
        }
        reader.finish().await.expect("finish download");
        assert_streaming_payload(&received, &payload);

        remote
            .delete(&folder_path, true)
            .await
            .unwrap_or_else(|error| panic!("delete {folder_path}: {error}"));
        remote.disconnect().await.expect("disconnect");
    }

    #[tokio::test]
    #[ignore = "requires tests/integration/docker-compose.yml"]
    async fn plain_ftp_streaming_round_trip() {
        exercise_streaming(ConnectionProtocol::Ftp, 2121, false).await;
    }

    #[tokio::test]
    #[ignore = "requires tests/integration/docker-compose.yml"]
    async fn explicit_ftps_streaming_round_trip() {
        exercise_streaming(ConnectionProtocol::FtpsExplicit, 2122, true).await;
    }

    #[tokio::test]
    #[ignore = "requires tests/integration/docker-compose.yml"]
    async fn implicit_ftps_streaming_round_trip() {
        exercise_streaming(ConnectionProtocol::FtpsImplicit, 2990, true).await;
    }

    #[tokio::test]
    #[ignore = "requires tests/integration/docker-compose.yml"]
    async fn creates_nested_remote_folders() {
        let profile = profile(ConnectionProtocol::Ftp, 2121);
        let mut remote: Box<dyn RemoteFs> = Box::new(
            FtpRemote::connect(&profile, PASSWORD)
                .await
                .expect("connect"),
        );

        let stamp = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_millis();
        let folder = format!("tree-{stamp}");
        let nested = format!("/{folder}/photos/2024");

        crate::transfer::ensure_remote_dir(&mut remote, &nested)
            .await
            .expect("create nested folders");
        let stat = remote.stat(&nested).await.expect("stat nested folder");
        assert_eq!(stat.kind, EntryKind::Directory);

        // Calling it again must be idempotent.
        crate::transfer::ensure_remote_dir(&mut remote, &nested)
            .await
            .expect("reuse nested folders");

        remote
            .delete(&format!("/{folder}"), true)
            .await
            .expect("delete tree");
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
    async fn custom_ca_verifies_explicit_ftps() {
        let mut profile = profile(ConnectionProtocol::FtpsExplicit, 2122);
        profile.tls = test_tls();
        let mut remote = FtpRemote::connect(&profile, PASSWORD)
            .await
            .expect("connect with a custom CA");
        let listing = remote.list("/").await.expect("list root");
        assert_eq!(listing.path, "/");
        remote.disconnect().await.expect("disconnect");
    }

    #[tokio::test]
    #[ignore = "requires tests/integration/docker-compose.yml"]
    async fn certificate_pin_is_enforced() {
        let pin = server_certificate_pin();

        let mut profile = profile(ConnectionProtocol::FtpsImplicit, 2990);
        profile.tls = TlsOptions {
            ca_file: None,
            certificate_pin: Some(pin),
            allow_invalid_certificates: true,
        };
        let mut remote = FtpRemote::connect(&profile, PASSWORD)
            .await
            .expect("connect with the correct pin");
        remote.list("/").await.expect("list root");
        remote.disconnect().await.expect("disconnect");

        profile.tls.certificate_pin = Some("00".repeat(32));
        match FtpRemote::connect(&profile, PASSWORD).await {
            Ok(_) => panic!("a wrong pin must fail"),
            Err(error) => assert_eq!(error.code, ErrorCode::TlsCertificate),
        }
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

    /// Stream a payload through the same writer the upload pipeline uses.
    async fn write_remote(remote: &mut Box<dyn RemoteFs>, path: &str, data: &[u8]) {
        let mut writer = remote.open_write(path, 0).await.expect("open write");
        let mut written = 0;
        while written < data.len() {
            let count = writer
                .write(&data[written..])
                .await
                .unwrap_or_else(|error| panic!("write {path}: {error}"));
            assert!(count > 0, "the server accepted no data for {path}");
            written += count;
        }
        writer
            .finish()
            .await
            .unwrap_or_else(|error| panic!("finish {path}: {error}"));
    }

    async fn read_remote(remote: &mut Box<dyn RemoteFs>, path: &str) -> Vec<u8> {
        let mut reader = remote.open_read(path, 0).await.expect("open read");
        let mut data = Vec::new();
        let mut buffer = [0u8; 16 * 1024];
        loop {
            let count = reader
                .read(&mut buffer)
                .await
                .unwrap_or_else(|error| panic!("read {path}: {error}"));
            if count == 0 {
                break;
            }
            data.extend_from_slice(&buffer[..count]);
        }
        reader
            .finish()
            .await
            .unwrap_or_else(|error| panic!("finish read {path}: {error}"));
        data
    }

    /// The transfer pipeline uploads to a hidden sibling and renames it into
    /// place. Exercise that sequence against a real server, including a
    /// non-ASCII name whose partial name lands exactly on the 255-byte limit.
    async fn exercise_atomic_replace(protocol: ConnectionProtocol, port: u16, secure: bool) {
        use crate::domain::transfer::ConflictPolicy;

        let profile = profile(protocol, port);
        let connector = secure.then(test_connector);
        let remote = FtpRemote::connect_with(&profile, PASSWORD, connector)
            .await
            .unwrap_or_else(|error| panic!("connect to {protocol:?} on {port}: {error}"));
        let mut client: Box<dyn RemoteFs> = Box::new(remote);

        let stamp = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_millis();
        let folder = format!("atomic-{stamp}");
        let folder_path = format!("/{folder}");
        client.mkdir("/", &folder).await.expect("mkdir");

        let long_name = format!("résumé-{}.bin", "ñ".repeat(120));
        for name in ["report.bin", long_name.as_str()] {
            let target = format!("{folder_path}/{name}");
            let temp = crate::transfer::temp_remote_path(&target, "test", "part")
                .expect("build the partial path");
            assert!(
                remote_leaf(&temp).expect("partial leaf").len() <= 255,
                "the partial name exceeds the server limit"
            );

            write_remote(&mut client, &target, b"previous contents").await;
            write_remote(&mut client, &temp, b"replacement contents").await;
            crate::transfer::replace_remote_file(
                &mut client,
                &temp,
                &target,
                "test",
                ConflictPolicy::Overwrite,
            )
            .await
            .unwrap_or_else(|error| panic!("replace {target}: {error}"));

            assert_eq!(
                read_remote(&mut client, &target).await,
                b"replacement contents"
            );
            assert_eq!(
                client.stat(&temp).await.expect_err("partial is gone").code,
                ErrorCode::NotFound
            );
        }

        let listing = client.list(&folder_path).await.expect("list folder");
        let mut names: Vec<String> = listing
            .entries
            .iter()
            .map(|entry| entry.name.clone())
            .collect();
        names.sort();
        let mut expected = vec!["report.bin".to_string(), long_name];
        expected.sort();
        assert_eq!(names, expected, "partial or backup files were left behind");

        client
            .delete(&folder_path, true)
            .await
            .expect("delete tree");
        client.disconnect().await.expect("disconnect");
    }

    #[tokio::test]
    #[ignore = "requires tests/integration/docker-compose.yml"]
    async fn plain_ftp_atomic_replace_keeps_no_leftovers() {
        exercise_atomic_replace(ConnectionProtocol::Ftp, 2121, false).await;
    }

    #[tokio::test]
    #[ignore = "requires tests/integration/docker-compose.yml"]
    async fn explicit_ftps_atomic_replace_keeps_no_leftovers() {
        exercise_atomic_replace(ConnectionProtocol::FtpsExplicit, 2122, true).await;
    }

    #[tokio::test]
    #[ignore = "requires tests/integration/docker-compose.yml"]
    async fn implicit_ftps_atomic_replace_keeps_no_leftovers() {
        exercise_atomic_replace(ConnectionProtocol::FtpsImplicit, 2990, true).await;
    }
}

#[cfg(test)]
mod listing_properties {
    use proptest::prelude::*;

    use super::*;

    proptest! {
        /// Hostile or garbage listings must never panic, never produce more
        /// entries than lines, and never place an entry outside the folder.
        #[test]
        fn arbitrary_listings_stay_inside_the_folder(
            lines in prop::collection::vec("\\PC{0,200}", 0..30),
        ) {
            for mlsd in [false, true] {
                let (entries, warnings) = parse_listing(mlsd, &lines, "/srv/dir");
                prop_assert!(entries.len() <= lines.len());
                prop_assert!(warnings.len() <= lines.len());
                for entry in entries {
                    prop_assert!(entry.path.starts_with("/srv/dir/"));
                    prop_assert!(!entry.path.contains("/../"));
                    prop_assert!(!entry.name.contains('/'));
                    prop_assert!(!entry.name.contains('\0'));
                    prop_assert!(entry.name.len() <= 255);
                }
            }
        }
    }

    #[test]
    fn hostile_names_are_dropped() {
        let lines = vec![
            "type=file;size=1;modify=20200101120000; ../escape".to_string(),
            "type=file;size=1;modify=20200101120000; a/b".to_string(),
            format!(
                "type=file;size=1;modify=20200101120000; {}",
                "x".repeat(300)
            ),
            "type=file;size=1;modify=20200101120000; nul\0byte".to_string(),
            "-rw-r--r-- 1 0 0 1 Jan 1 2020 ../escape".to_string(),
            "-rw-r--r-- 1 0 0 1 Jan 1 2020 name with spaces".to_string(),
            "total 42".to_string(),
            String::new(),
        ];

        for mlsd in [false, true] {
            let (entries, _) = parse_listing(mlsd, &lines, "/srv/dir");
            for entry in &entries {
                assert!(!entry.name.contains('/'), "separator leaked into a name");
                assert!(!entry.name.contains('\0'));
                assert!(entry.name.len() <= 255);
                assert!(entry.path.starts_with("/srv/dir/"));
            }
        }
    }

    #[test]
    fn a_very_long_line_is_bounded() {
        let line = format!(
            "type=file;size=1;modify=20200101120000; {}",
            "y".repeat(1_000_000)
        );
        let (entries, warnings) = parse_listing(true, &[line], "/srv/dir");
        assert!(entries.is_empty());
        assert!(warnings.len() <= 1);
    }
}
