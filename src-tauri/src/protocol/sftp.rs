use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use russh::Disconnect;
use russh::client::{self, Handle};
use russh::keys::{HashAlg, PrivateKeyWithHashAlg, load_secret_key};
use russh_sftp::client::SftpSession;
use russh_sftp::client::error::Error as SftpError;
use russh_sftp::client::fs::File as SftpFile;
use russh_sftp::protocol::{FileAttributes, FileType, OpenFlags, StatusCode};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt, SeekFrom};

use crate::config::known_hosts::verify_against;
use crate::domain::connection::{ConnectionAuth, ConnectionProfile};
use crate::domain::fs::{EntryKind, FsCapabilities, FsEntry, Listing, ResumeSupport};
use crate::domain::host_key::{HostKeyChallenge, HostKeyVerdict, KnownHost};
use crate::domain::remote_path::{
    join_remote, normalize_remote, remote_leaf, remote_parent, validate_remote_name,
};
use crate::error::{AppError, ErrorCode};
use crate::fs::{FileReader, FileWriter};
use crate::protocol::{RemoteFs, listing, ms_from_secs, protocol_error, sanitize_detail};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const REQUEST_TIMEOUT_SECS: u64 = 30;

pub struct SftpCredentials {
    pub password: Option<String>,
    pub passphrase: Option<String>,
}

struct SftpReader {
    file: Option<SftpFile>,
}

#[async_trait]
impl FileReader for SftpReader {
    async fn read(&mut self, buf: &mut [u8]) -> Result<usize, AppError> {
        self.file
            .as_mut()
            .ok_or_else(|| AppError::internal("The SFTP handle is closed.", "missing handle"))?
            .read(buf)
            .await
            .map_err(map_transfer_io)
    }

    async fn finish(mut self: Box<Self>) -> Result<(), AppError> {
        match self.file.take() {
            Some(file) => file.close().await.map_err(map_transfer_io),
            None => Ok(()),
        }
    }
}

struct SftpWriter {
    file: Option<SftpFile>,
}

#[async_trait]
impl FileWriter for SftpWriter {
    async fn write(&mut self, buf: &[u8]) -> Result<usize, AppError> {
        self.file
            .as_mut()
            .ok_or_else(|| AppError::internal("The SFTP handle is closed.", "missing handle"))?
            .write(buf)
            .await
            .map_err(map_transfer_io)
    }

    async fn finish(mut self: Box<Self>) -> Result<(), AppError> {
        match self.file.take() {
            Some(mut file) => {
                file.flush().await.map_err(map_transfer_io)?;
                file.close().await.map_err(map_transfer_io)
            }
            None => Ok(()),
        }
    }

    async fn abort(mut self: Box<Self>) -> Result<(), AppError> {
        self.file.take();
        Ok(())
    }
}

pub struct SftpRemote {
    sftp: SftpSession,
    handle: Handle<HostKeyHandler>,
    capabilities: FsCapabilities,
}

/// SSH client handler that enforces our known-hosts policy during the
/// handshake. A snapshot of trusted keys is used, so the trust store is never
/// held across an await point.
pub struct HostKeyHandler {
    host: String,
    port: u16,
    trusted: Vec<KnownHost>,
}

#[derive(Debug, thiserror::Error)]
pub enum SshConnectError {
    #[error(transparent)]
    Client(#[from] russh::Error),
    #[error("host key is not trusted")]
    HostKey {
        key_type: String,
        fingerprint: String,
        previous_fingerprint: Option<String>,
    },
}

impl client::Handler for HostKeyHandler {
    type Error = SshConnectError;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let key = server_public_key.public_key();
        let key_type = key.algorithm().to_string();
        let fingerprint = key.fingerprint(HashAlg::Sha256).to_string();

        match verify_against(
            &self.trusted,
            &self.host,
            self.port,
            &key_type,
            &fingerprint,
        ) {
            HostKeyVerdict::Trusted => Ok(true),
            HostKeyVerdict::Unknown => Err(SshConnectError::HostKey {
                key_type,
                fingerprint,
                previous_fingerprint: None,
            }),
            HostKeyVerdict::Changed {
                previous_fingerprint,
            } => Err(SshConnectError::HostKey {
                key_type,
                fingerprint,
                previous_fingerprint: Some(previous_fingerprint),
            }),
        }
    }
}

impl SftpRemote {
    pub async fn connect(
        profile: &ConnectionProfile,
        credentials: SftpCredentials,
        trusted: Vec<KnownHost>,
    ) -> Result<Self, AppError> {
        let key = match &profile.auth {
            ConnectionAuth::Password => None,
            ConnectionAuth::Key { key_path, .. } => {
                let path = key_path.clone();
                let passphrase = credentials.passphrase.clone();
                Some(
                    tokio::task::spawn_blocking(move || {
                        load_secret_key(Path::new(&path), passphrase.as_deref())
                    })
                    .await
                    .map_err(|error| {
                        AppError::internal(
                            "Could not read the private key.",
                            format!("key loading task failed: {error}"),
                        )
                    })?
                    .map_err(|error| {
                        AppError::new(
                            ErrorCode::AuthFailed,
                            "The private key could not be read. Check the file and passphrase.",
                        )
                        .with_detail(error.to_string())
                    })?,
                )
            }
        };

        let config = Arc::new(client::Config {
            keepalive_interval: Some(Duration::from_secs(30)),
            keepalive_max: 3,
            inactivity_timeout: Some(Duration::from_secs(180)),
            nodelay: true,
            ..Default::default()
        });
        let handler = HostKeyHandler {
            host: profile.host.clone(),
            port: profile.port,
            trusted,
        };

        let mut session = tokio::time::timeout(
            CONNECT_TIMEOUT,
            client::connect(config, (profile.host.as_str(), profile.port), handler),
        )
        .await
        .map_err(|_| {
            AppError::new(ErrorCode::Timeout, "The server did not answer in time.").retryable()
        })?
        .map_err(|error| map_connect_error(error, profile))?;

        if let Some(key) = key {
            let hash = session
                .best_supported_rsa_hash()
                .await
                .ok()
                .flatten()
                .flatten();
            let result = session
                .authenticate_publickey(
                    profile.username.as_str(),
                    PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                )
                .await
                .map_err(map_russh_error)?;
            if !result.success() {
                return Err(AppError::new(
                    ErrorCode::AuthFailed,
                    "The server rejected the SSH key.",
                ));
            }
        } else {
            let password = credentials.password.ok_or_else(|| {
                AppError::new(
                    ErrorCode::AuthFailed,
                    "No password is saved for this connection.",
                )
            })?;
            let result = session
                .authenticate_password(profile.username.as_str(), password)
                .await
                .map_err(map_russh_error)?;
            if !result.success() {
                return Err(AppError::new(
                    ErrorCode::AuthFailed,
                    "The server rejected the username or password.",
                ));
            }
        }

        let channel = session
            .channel_open_session()
            .await
            .map_err(map_russh_error)?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(map_russh_error)?;
        let sftp = tokio::time::timeout(CONNECT_TIMEOUT, SftpSession::new(channel.into_stream()))
            .await
            .map_err(|_| {
                AppError::new(
                    ErrorCode::Timeout,
                    "The SFTP subsystem did not start in time.",
                )
                .retryable()
            })?
            .map_err(map_sftp_error)?;
        sftp.set_timeout(REQUEST_TIMEOUT_SECS);

        Ok(Self {
            sftp,
            handle: session,
            capabilities: FsCapabilities {
                list: true,
                mkdir: true,
                remove: true,
                rename: true,
                chmod: true,
                chown: false,
                symlinks: true,
                unix_permissions: true,
                detailed_listing: true,
                resume_download: ResumeSupport::Supported,
                resume_upload: ResumeSupport::Supported,
                server_side_move: true,
                server_side_copy: false,
                text_read: false,
                text_write: false,
            },
        })
    }

    async fn delete_inner(&mut self, path: &str) -> Result<(), AppError> {
        let entry = self.stat(path).await?;
        if entry.kind == EntryKind::Directory {
            let listing = self.list(path).await?;
            for child in listing.entries {
                Box::pin(self.delete_inner(&child.path)).await?;
            }
            self.sftp.remove_dir(path).await.map_err(map_sftp_error)?;
        } else {
            self.sftp.remove_file(path).await.map_err(map_sftp_error)?;
        }
        Ok(())
    }
}

#[async_trait]
impl RemoteFs for SftpRemote {
    async fn list(&mut self, path: &str) -> Result<Listing, AppError> {
        let path = normalize_remote(path)?;
        let parent = remote_parent(&path)?;
        let mut reader = self.sftp.read_dir(&path).await.map_err(map_sftp_error)?;
        let mut entries = Vec::new();
        let mut warnings = Vec::new();

        for entry in reader.by_ref() {
            let name = entry.file_name();
            let entry_path = match join_remote(&path, &name) {
                Ok(path) => path,
                Err(_) => {
                    warnings.push("A server entry had a name that could not be displayed.".into());
                    continue;
                }
            };
            let metadata = entry.metadata();
            match map_metadata(&name, &entry_path, &metadata) {
                Ok(mut entry) => {
                    entry.link_target = if entry.kind == EntryKind::Symlink {
                        self.sftp.read_link(&entry_path).await.ok()
                    } else {
                        None
                    };
                    entries.push(entry);
                }
                Err(_) => warnings.push(format!("“{name}” could not be read completely.",)),
            }
        }

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
        let metadata = self
            .sftp
            .symlink_metadata(&path)
            .await
            .map_err(map_sftp_error)?;
        let name = remote_leaf(&path)?;
        let mut entry = map_metadata(&name, &path, &metadata)?;
        if entry.kind == EntryKind::Symlink {
            entry.link_target = self.sftp.read_link(&path).await.ok();
        }
        Ok(entry)
    }

    async fn mkdir(&mut self, parent: &str, name: &str) -> Result<FsEntry, AppError> {
        validate_remote_name(name)?;
        let target = join_remote(parent, name)?;
        self.sftp
            .create_dir(&target)
            .await
            .map_err(map_sftp_error)?;
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
        self.sftp
            .rename(&path, &target)
            .await
            .map_err(map_sftp_error)?;
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
        let path = normalize_remote(path)?;
        let attributes = FileAttributes {
            permissions: Some(mode),
            ..Default::default()
        };
        self.sftp
            .set_metadata(&path, attributes)
            .await
            .map_err(map_sftp_error)
    }

    async fn open_read(
        &mut self,
        path: &str,
        offset: u64,
    ) -> Result<Box<dyn FileReader>, AppError> {
        let path = normalize_remote(path)?;
        let mut file = self.sftp.open(&path).await.map_err(map_sftp_error)?;
        if offset > 0 {
            file.seek(SeekFrom::Start(offset))
                .await
                .map_err(map_transfer_io)?;
        }
        Ok(Box::new(SftpReader { file: Some(file) }))
    }

    async fn open_write(
        &mut self,
        path: &str,
        offset: u64,
    ) -> Result<Box<dyn FileWriter>, AppError> {
        let path = normalize_remote(path)?;
        let mut flags = OpenFlags::WRITE | OpenFlags::CREATE;
        if offset == 0 {
            flags |= OpenFlags::TRUNCATE;
        }
        let mut file = self
            .sftp
            .open_with_flags(&path, flags)
            .await
            .map_err(map_sftp_error)?;
        if offset > 0 {
            file.seek(SeekFrom::Start(offset))
                .await
                .map_err(map_transfer_io)?;
        }
        Ok(Box::new(SftpWriter { file: Some(file) }))
    }

    async fn disconnect(&mut self) -> Result<(), AppError> {
        let _ = self.sftp.close().await;
        let _ = self
            .handle
            .disconnect(Disconnect::ByApplication, "Disconnected", "en")
            .await;
        Ok(())
    }

    fn capabilities(&self) -> FsCapabilities {
        self.capabilities.clone()
    }
}

fn map_metadata(name: &str, path: &str, metadata: &FileAttributes) -> Result<FsEntry, AppError> {
    let kind = match metadata.file_type() {
        FileType::Dir => EntryKind::Directory,
        FileType::File => EntryKind::File,
        FileType::Symlink => EntryKind::Symlink,
        FileType::Other => EntryKind::Other,
    };
    let modified_at = metadata.mtime.map(|seconds| ms_from_secs(seconds as u64));
    let permissions = metadata.permissions.map(|mode| mode & 0o7777);
    let owner = metadata
        .user
        .clone()
        .or_else(|| metadata.uid.map(|uid| uid.to_string()));
    let group = metadata
        .group
        .clone()
        .or_else(|| metadata.gid.map(|gid| gid.to_string()));

    Ok(FsEntry {
        name: name.to_string(),
        path: path.to_string(),
        kind,
        size: metadata.size.unwrap_or(0) as f64,
        modified_at,
        permissions,
        owner,
        group,
        link_target: None,
        hidden: name.starts_with('.'),
        metadata_complete: metadata.size.is_some()
            && metadata.permissions.is_some()
            && metadata.mtime.is_some(),
    })
}

fn map_connect_error(error: SshConnectError, profile: &ConnectionProfile) -> AppError {
    match error {
        SshConnectError::HostKey {
            key_type,
            fingerprint,
            previous_fingerprint,
        } => {
            let changed = previous_fingerprint.is_some();
            AppError::new(
                if changed {
                    ErrorCode::HostKeyMismatch
                } else {
                    ErrorCode::HostKeyUnknown
                },
                if changed {
                    "The server's host key changed. The connection was blocked."
                } else {
                    "This server's host key is not trusted yet."
                },
            )
            .with_host_key(HostKeyChallenge {
                host: profile.host.clone(),
                port: profile.port,
                key_type,
                fingerprint,
                previous_fingerprint,
            })
        }
        SshConnectError::Client(error) => map_russh_error(error),
    }
}

fn map_russh_error(error: russh::Error) -> AppError {
    use russh::Error;

    match error {
        Error::NotAuthenticated | Error::UnsupportedAuthMethod => {
            AppError::new(ErrorCode::AuthFailed, "The server rejected the sign-in.")
        }
        Error::CouldNotReadKey | Error::UnknownKey | Error::WrongServerSig => AppError::new(
            ErrorCode::HostKeyMismatch,
            "The server's host key could not be verified.",
        ),
        Error::KexInit | Error::Kex | Error::Version => {
            AppError::new(ErrorCode::Protocol, "The SSH handshake failed.")
        }
        other => AppError::new(ErrorCode::Network, "The SSH connection failed.")
            .with_detail(sanitize_detail(&other.to_string()))
            .retryable(),
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

fn map_sftp_error(error: SftpError) -> AppError {
    match error {
        SftpError::Status(status) => {
            let (code, message) = match status.status_code {
                StatusCode::NoSuchFile => (ErrorCode::NotFound, "That remote item does not exist."),
                StatusCode::PermissionDenied => (
                    ErrorCode::PermissionDenied,
                    "You do not have permission for that item.",
                ),
                StatusCode::OpUnsupported => (
                    ErrorCode::Unsupported,
                    "The server does not support that operation.",
                ),
                StatusCode::NoConnection | StatusCode::ConnectionLost => (
                    ErrorCode::SessionNotReady,
                    "The SFTP session was disconnected.",
                ),
                StatusCode::Failure => (ErrorCode::Protocol, "The server rejected the request."),
                _ => (ErrorCode::Protocol, "The server rejected the request."),
            };
            let detail = sanitize_detail(&status.error_message);
            if detail.is_empty() {
                AppError::new(code, message)
            } else {
                protocol_error(code, message, detail)
            }
        }
        SftpError::Timeout => {
            AppError::new(ErrorCode::Timeout, "The server did not answer in time.").retryable()
        }
        SftpError::IO(detail) => AppError::new(ErrorCode::Network, "The SFTP connection failed.")
            .with_detail(sanitize_detail(&detail))
            .retryable(),
        SftpError::Limited(detail) => {
            AppError::new(ErrorCode::InvalidInput, "The server limit was exceeded.")
                .with_detail(sanitize_detail(&detail))
        }
        SftpError::UnexpectedPacket | SftpError::UnexpectedBehavior(_) => AppError::new(
            ErrorCode::Protocol,
            "The server sent an unexpected response.",
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_file_attributes_and_masks_type_bits() {
        let attributes = FileAttributes {
            size: Some(1024),
            permissions: Some(0o100644),
            mtime: Some(1_700_000_000),
            user: Some("alice".into()),
            group: Some("staff".into()),
            ..Default::default()
        };

        let entry = map_metadata("file.txt", "/file.txt", &attributes).unwrap();
        assert_eq!(entry.kind, EntryKind::File);
        assert_eq!(entry.size, 1024.0);
        assert_eq!(entry.permissions, Some(0o644));
        assert_eq!(entry.modified_at, Some(1_700_000_000_000.0));
        assert_eq!(entry.owner.as_deref(), Some("alice"));
        assert_eq!(entry.group.as_deref(), Some("staff"));
        assert!(entry.metadata_complete);
    }

    #[test]
    fn maps_directory_attributes_and_reports_incomplete_metadata() {
        let attributes = FileAttributes {
            permissions: Some(0o040755),
            ..Default::default()
        };

        let entry = map_metadata("docs", "/docs", &attributes).unwrap();
        assert_eq!(entry.kind, EntryKind::Directory);
        assert_eq!(entry.permissions, Some(0o755));
        assert_eq!(entry.size, 0.0);
        assert!(!entry.metadata_complete);
    }

    #[test]
    fn maps_sftp_status_codes_to_stable_errors() {
        let error = map_sftp_error(SftpError::Status(russh_sftp::protocol::Status {
            id: 1,
            status_code: StatusCode::NoSuchFile,
            error_message: "no such file".into(),
            language_tag: String::new(),
        }));
        assert_eq!(error.code, ErrorCode::NotFound);

        let error = map_sftp_error(SftpError::Status(russh_sftp::protocol::Status {
            id: 2,
            status_code: StatusCode::PermissionDenied,
            error_message: "permission denied".into(),
            language_tag: String::new(),
        }));
        assert_eq!(error.code, ErrorCode::PermissionDenied);

        let error = map_sftp_error(SftpError::Timeout);
        assert_eq!(error.code, ErrorCode::Timeout);
        assert!(error.retryable);
    }
}

/// End-to-end tests against the Docker services in `tests/integration`.
/// Run with `cargo test -- --ignored` after starting the compose stack.
#[cfg(test)]
mod integration {
    use super::*;
    use crate::domain::connection::{ConnectionAuth, ConnectionInput};

    const USER: &str = "sftply";
    const PASSWORD: &str = "sftply-test";
    /// The atmoz/sftp image chroots the user to `/home/sftply` and only the
    /// `upload` folder is writable.
    const WRITABLE: &str = "/upload";

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

    fn profile() -> ConnectionProfile {
        ConnectionProfile::from_input(
            "integration".into(),
            ConnectionInput {
                name: "Integration".into(),
                protocol: crate::domain::connection::ConnectionProtocol::Sftp,
                host: "127.0.0.1".into(),
                port: 2222,
                username: USER.into(),
                auth: ConnectionAuth::Password,
                initial_path: WRITABLE.into(),
                favorite: false,
                group: None,
                tls: crate::domain::connection::TlsOptions::default(),
                ftp_data_mode: crate::domain::connection::FtpDataMode::Passive,
            },
            0.0,
        )
    }

    fn credentials() -> SftpCredentials {
        SftpCredentials {
            password: Some(PASSWORD.into()),
            passphrase: None,
        }
    }

    async fn trusted_host(profile: &ConnectionProfile) -> KnownHost {
        let result = SftpRemote::connect(profile, credentials(), Vec::new()).await;
        let error = match result {
            Ok(_) => panic!("an unknown host key must block the connection"),
            Err(error) => error,
        };
        assert_eq!(error.code, ErrorCode::HostKeyUnknown);
        let challenge = error
            .host_key
            .expect("unknown host key carries a challenge");
        assert_eq!(challenge.host, profile.host);
        assert_eq!(challenge.port, profile.port);
        assert!(challenge.fingerprint.starts_with("SHA256:"));
        assert!(challenge.previous_fingerprint.is_none());
        KnownHost {
            host: challenge.host,
            port: challenge.port,
            key_type: challenge.key_type,
            fingerprint: challenge.fingerprint,
            added_at: 0.0,
        }
    }

    #[tokio::test]
    #[ignore = "requires tests/integration/docker-compose.yml"]
    async fn sftp_streaming_round_trip() {
        let profile = profile();
        let known = trusted_host(&profile).await;
        let mut remote = SftpRemote::connect(&profile, credentials(), vec![known])
            .await
            .expect("connect with a trusted host key");

        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_millis();
        let folder = format!("stream-{stamp}");
        let folder_path = format!("{WRITABLE}/{folder}");
        remote.mkdir(WRITABLE, &folder).await.expect("mkdir");

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
    async fn creates_nested_remote_folders() {
        let profile = profile();
        let trusted = trusted_host(&profile).await;
        let mut remote: Box<dyn RemoteFs> = Box::new(
            SftpRemote::connect(&profile, credentials(), vec![trusted])
                .await
                .expect("connect"),
        );

        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_millis();
        let folder = format!("tree-{stamp}");
        let nested = format!("{WRITABLE}/{folder}/photos/2024");

        crate::transfer::ensure_remote_dir(&mut remote, &nested)
            .await
            .expect("create nested folders");
        let stat = remote.stat(&nested).await.expect("stat nested folder");
        assert_eq!(stat.kind, EntryKind::Directory);

        crate::transfer::ensure_remote_dir(&mut remote, &nested)
            .await
            .expect("reuse nested folders");

        remote
            .delete(&format!("{WRITABLE}/{folder}"), true)
            .await
            .expect("delete tree");
        remote.disconnect().await.expect("disconnect");
    }

    #[tokio::test]
    #[ignore = "requires tests/integration/docker-compose.yml"]
    async fn rejects_changed_host_key() {
        let profile = profile();
        let mut known = trusted_host(&profile).await;
        known.fingerprint = "SHA256:this-is-not-the-real-key".into();

        let result = SftpRemote::connect(&profile, credentials(), vec![known]).await;
        match result {
            Ok(_) => panic!("a changed host key must block the connection"),
            Err(error) => {
                assert_eq!(error.code, ErrorCode::HostKeyMismatch);
                let challenge = error.host_key.expect("changed key carries a challenge");
                assert!(challenge.previous_fingerprint.is_some());
            }
        }
    }

    #[tokio::test]
    #[ignore = "requires tests/integration/docker-compose.yml"]
    async fn sftp_crud_after_trusting_host_key() {
        let profile = profile();
        let known = trusted_host(&profile).await;
        let mut remote = SftpRemote::connect(&profile, credentials(), vec![known])
            .await
            .expect("connect with a trusted host key");

        let capabilities = remote.capabilities();
        assert!(capabilities.list);
        assert!(capabilities.mkdir);
        assert!(capabilities.remove);
        assert!(capabilities.rename);
        assert!(capabilities.chmod);

        let root = remote.list(WRITABLE).await.expect("list writable folder");
        assert_eq!(root.path, WRITABLE);

        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_millis();
        let folder = format!("it-{stamp}");
        let path = format!("{WRITABLE}/{folder}");

        let created = remote
            .mkdir(WRITABLE, &folder)
            .await
            .expect("mkdir inside the writable folder");
        assert_eq!(created.kind, EntryKind::Directory);
        assert_eq!(created.path, path);

        let listing = remote.list(WRITABLE).await.expect("list after mkdir");
        assert!(listing.entries.iter().any(|entry| entry.name == folder));

        let renamed_name = format!("{folder}-renamed");
        let renamed_path = format!("{WRITABLE}/{renamed_name}");
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
    async fn exercise_atomic_replace() {
        use crate::domain::transfer::ConflictPolicy;

        let profile = profile();
        let known = trusted_host(&profile).await;
        let remote = SftpRemote::connect(&profile, credentials(), vec![known])
            .await
            .expect("connect with a trusted host key");
        let mut client: Box<dyn RemoteFs> = Box::new(remote);

        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_millis();
        let folder = format!("atomic-{stamp}");
        let folder_path = format!("{WRITABLE}/{folder}");
        client
            .mkdir(WRITABLE, &folder)
            .await
            .expect("mkdir inside the writable folder");

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
    async fn sftp_atomic_replace_keeps_no_leftovers() {
        exercise_atomic_replace().await;
    }
}
