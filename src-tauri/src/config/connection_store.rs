use std::path::{Path, PathBuf};
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

use crate::domain::activity::unix_millis;
use crate::domain::connection::{ConnectionInput, ConnectionProfile};
use crate::error::{AppError, ErrorCode};

pub const CONNECTIONS_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ConnectionsFile {
    schema_version: u32,
    connections: Vec<ConnectionProfile>,
}

impl Default for ConnectionsFile {
    fn default() -> Self {
        Self {
            schema_version: CONNECTIONS_SCHEMA_VERSION,
            connections: Vec::new(),
        }
    }
}

/// Connection metadata store. Secrets are never written here; they live in the
/// OS keychain and are keyed by connection id.
pub struct ConnectionStore {
    path: PathBuf,
    current: RwLock<Vec<ConnectionProfile>>,
    write_lock: tokio::sync::Mutex<()>,
}

impl ConnectionStore {
    pub fn load(path: PathBuf) -> (Self, Option<String>) {
        match load_from_disk(&path) {
            Ok((connections, warning)) => (
                Self {
                    path,
                    current: RwLock::new(connections),
                    write_lock: tokio::sync::Mutex::new(()),
                },
                warning,
            ),
            Err(LoadError::Missing) => (
                Self {
                    path,
                    current: RwLock::new(Vec::new()),
                    write_lock: tokio::sync::Mutex::new(()),
                },
                None,
            ),
            Err(LoadError::Corrupt(detail)) => {
                tracing::error!(%detail, "connections file corrupt; starting empty");
                let backup = backup_path(&path);
                if let Err(error) = std::fs::rename(&path, &backup) {
                    tracing::warn!(%error, "could not back up corrupt connections file");
                }
                let warning =
                    "Connections could not be read and were reset. A backup was kept.".to_string();
                (
                    Self {
                        path,
                        current: RwLock::new(Vec::new()),
                        write_lock: tokio::sync::Mutex::new(()),
                    },
                    Some(warning),
                )
            }
        }
    }

    pub fn list(&self) -> Vec<ConnectionProfile> {
        self.current
            .read()
            .expect("connections lock poisoned")
            .clone()
    }

    pub fn get(&self, id: &str) -> Option<ConnectionProfile> {
        self.current
            .read()
            .expect("connections lock poisoned")
            .iter()
            .find(|connection| connection.id == id)
            .cloned()
    }

    pub async fn create(&self, input: ConnectionInput) -> Result<ConnectionProfile, AppError> {
        let input = input.normalized().map_err(AppError::invalid_input)?;
        let _guard = self.write_lock.lock().await;

        let profile =
            ConnectionProfile::from_input(uuid::Uuid::new_v4().to_string(), input, unix_millis());
        let mut next = self.snapshot();
        next.push(profile.clone());
        self.persist(next).await?;
        Ok(profile)
    }

    pub async fn update(
        &self,
        id: &str,
        input: ConnectionInput,
    ) -> Result<ConnectionProfile, AppError> {
        let input = input.normalized().map_err(AppError::invalid_input)?;
        let _guard = self.write_lock.lock().await;

        let mut next = self.snapshot();
        let profile = next
            .iter_mut()
            .find(|connection| connection.id == id)
            .ok_or_else(|| AppError::not_found("That connection no longer exists."))?;

        profile.name = input.name;
        profile.protocol = input.protocol;
        profile.host = input.host;
        profile.port = input.port;
        profile.username = input.username;
        profile.auth = input.auth;
        profile.initial_path = input.initial_path;
        profile.favorite = input.favorite;
        profile.group = input.group;
        let updated = profile.clone();

        self.persist(next).await?;
        Ok(updated)
    }

    pub async fn delete(&self, id: &str) -> Result<(), AppError> {
        let _guard = self.write_lock.lock().await;
        let mut next = self.snapshot();
        let before = next.len();
        next.retain(|connection| connection.id != id);
        if next.len() == before {
            return Err(AppError::not_found("That connection no longer exists."));
        }
        self.persist(next).await
    }

    /// Add connections imported from a bundle in one write.
    ///
    /// Entries that point at a host already saved with the same protocol, host,
    /// port and username are skipped instead of duplicated. The returned notes
    /// explain every skip so the UI can report it.
    pub async fn insert_many(
        &self,
        inputs: Vec<ConnectionInput>,
    ) -> Result<(Vec<ConnectionProfile>, Vec<String>), AppError> {
        let _guard = self.write_lock.lock().await;
        let mut next = self.snapshot();
        let now = unix_millis();
        let mut imported = Vec::new();
        let mut skipped = Vec::new();

        for input in inputs {
            let name = input.name.clone();
            let input = match input.normalized() {
                Ok(input) => input,
                Err(reason) => {
                    skipped.push(format!("“{name}” was skipped: {reason}"));
                    continue;
                }
            };

            if let Some(existing) = next.iter().find(|profile| {
                profile.protocol == input.protocol
                    && profile.port == input.port
                    && profile.host.eq_ignore_ascii_case(&input.host)
                    && profile.username.eq_ignore_ascii_case(&input.username)
            }) {
                skipped.push(format!(
                    "“{}” was skipped: it already exists as “{}”.",
                    input.name, existing.name
                ));
                continue;
            }

            let profile =
                ConnectionProfile::from_input(uuid::Uuid::new_v4().to_string(), input, now);
            next.push(profile.clone());
            imported.push(profile);
        }

        if !imported.is_empty() {
            self.persist(next).await?;
        }
        Ok((imported, skipped))
    }

    pub async fn duplicate(&self, id: &str) -> Result<ConnectionProfile, AppError> {
        let _guard = self.write_lock.lock().await;
        let mut next = self.snapshot();
        let source = next
            .iter()
            .find(|connection| connection.id == id)
            .cloned()
            .ok_or_else(|| AppError::not_found("That connection no longer exists."))?;

        let mut name = format!("Copy of {}", source.name);
        if name.chars().count() > 100 {
            name = name.chars().take(100).collect();
        }

        let duplicate = ConnectionProfile {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            favorite: false,
            created_at: unix_millis(),
            last_used_at: None,
            ..source
        };
        next.push(duplicate.clone());
        self.persist(next).await?;
        Ok(duplicate)
    }

    pub async fn set_favorite(
        &self,
        id: &str,
        favorite: bool,
    ) -> Result<ConnectionProfile, AppError> {
        let _guard = self.write_lock.lock().await;
        let mut next = self.snapshot();
        let profile = next
            .iter_mut()
            .find(|connection| connection.id == id)
            .ok_or_else(|| AppError::not_found("That connection no longer exists."))?;
        profile.favorite = favorite;
        let updated = profile.clone();
        self.persist(next).await?;
        Ok(updated)
    }

    pub async fn reorder(&self, ids: Vec<String>) -> Result<Vec<ConnectionProfile>, AppError> {
        let _guard = self.write_lock.lock().await;
        let current = self.snapshot();

        if ids.len() != current.len() {
            return Err(AppError::invalid_input(
                "The connection order does not match the saved connections.",
            ));
        }
        let mut reordered = Vec::with_capacity(current.len());
        for id in &ids {
            let profile = current
                .iter()
                .find(|connection| &connection.id == id)
                .ok_or_else(|| {
                    AppError::invalid_input("The connection order contains an unknown connection.")
                })?;
            reordered.push(profile.clone());
        }

        self.persist(reordered.clone()).await?;
        Ok(reordered)
    }

    #[allow(dead_code)] // Used by the session layer when a connection opens.
    pub async fn mark_used(&self, id: &str) -> Result<(), AppError> {
        let _guard = self.write_lock.lock().await;
        let mut next = self.snapshot();
        let profile = next
            .iter_mut()
            .find(|connection| connection.id == id)
            .ok_or_else(|| AppError::not_found("That connection no longer exists."))?;
        profile.last_used_at = Some(unix_millis());
        self.persist(next).await
    }

    fn snapshot(&self) -> Vec<ConnectionProfile> {
        self.current
            .read()
            .expect("connections lock poisoned")
            .clone()
    }

    async fn persist(&self, next: Vec<ConnectionProfile>) -> Result<(), AppError> {
        let payload = ConnectionsFile {
            schema_version: CONNECTIONS_SCHEMA_VERSION,
            connections: next.clone(),
        };
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || crate::config::atomic::write_json(&path, &payload))
            .await
            .map_err(|error| write_error(format!("connections write task failed: {error}")))?
            .map_err(|error| write_error(error.to_string()))?;

        *self.current.write().expect("connections lock poisoned") = next;
        Ok(())
    }
}

fn write_error(detail: impl Into<String>) -> AppError {
    AppError::new(
        ErrorCode::ConfigWriteFailed,
        "Could not save your connections.",
    )
    .with_detail(detail)
    .retryable()
}

enum LoadError {
    Missing,
    Corrupt(String),
}

fn load_from_disk(path: &Path) -> Result<(Vec<ConnectionProfile>, Option<String>), LoadError> {
    if !path.exists() {
        return Err(LoadError::Missing);
    }

    let file: ConnectionsFile = crate::config::atomic::read_json(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            LoadError::Missing
        } else {
            LoadError::Corrupt(error.to_string())
        }
    })?;

    if file.schema_version > CONNECTIONS_SCHEMA_VERSION {
        return Err(LoadError::Corrupt(format!(
            "unsupported connections schema version {}",
            file.schema_version
        )));
    }

    let total = file.connections.len();
    let mut seen = std::collections::HashSet::new();
    let mut connections = Vec::with_capacity(total);
    for connection in file.connections {
        match connection.normalized() {
            Ok(connection) if seen.insert(connection.id.clone()) => connections.push(connection),
            Ok(_) => tracing::warn!("ignoring duplicate connection id in connections file"),
            Err(message) => {
                tracing::warn!(%message, "ignoring invalid connection entry")
            }
        }
    }

    let warning = (connections.len() != total).then(|| {
        format!(
            "{} of {total} saved connections could not be read and were skipped.",
            total - connections.len()
        )
    });

    Ok((connections, warning))
}

fn backup_path(path: &Path) -> PathBuf {
    let millis = unix_millis();
    path.with_file_name(format!("connections.corrupt-{millis:.0}.json"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::connection::{ConnectionAuth, ConnectionProtocol, FtpDataMode, TlsOptions};

    fn input(name: &str) -> ConnectionInput {
        ConnectionInput {
            name: name.into(),
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
        }
    }

    #[tokio::test]
    async fn creates_updates_duplicates_and_deletes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.json");
        let (store, warning) = ConnectionStore::load(path.clone());
        assert!(warning.is_none());

        let created = store.create(input("Production")).await.unwrap();
        assert_eq!(created.name, "Production");
        assert!(path.exists());
        assert_eq!(store.list().len(), 1);

        let mut update = input("Staging");
        update.favorite = true;
        let updated = store.update(&created.id, update).await.unwrap();
        assert_eq!(updated.name, "Staging");
        assert!(updated.favorite);
        assert_eq!(updated.created_at, created.created_at);

        let duplicate = store.duplicate(&created.id).await.unwrap();
        assert_eq!(duplicate.name, "Copy of Staging");
        assert_eq!(store.list().len(), 2);

        store.delete(&created.id).await.unwrap();
        assert_eq!(store.list().len(), 1);
        assert!(store.delete(&created.id).await.is_err());
    }

    #[tokio::test]
    async fn reorders_and_rejects_unknown_ids() {
        let dir = tempfile::tempdir().unwrap();
        let (store, _) = ConnectionStore::load(dir.path().join("connections.json"));
        let first = store.create(input("First")).await.unwrap();
        let second = store.create(input("Second")).await.unwrap();

        let reordered = store
            .reorder(vec![second.id.clone(), first.id.clone()])
            .await
            .unwrap();
        assert_eq!(reordered[0].id, second.id);

        assert!(store.reorder(vec![first.id.clone()]).await.is_err());
    }

    #[tokio::test]
    async fn rejects_invalid_input() {
        let dir = tempfile::tempdir().unwrap();
        let (store, _) = ConnectionStore::load(dir.path().join("connections.json"));
        let mut bad = input("Bad");
        bad.host = "has space".into();
        assert!(store.create(bad).await.is_err());
        assert!(store.list().is_empty());
    }

    #[test]
    fn recovers_from_corrupt_file_with_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.json");
        std::fs::write(&path, "{not json").unwrap();

        let (store, warning) = ConnectionStore::load(path);
        assert!(warning.is_some());
        assert!(store.list().is_empty());
        assert!(
            std::fs::read_dir(dir.path())
                .unwrap()
                .filter_map(Result::ok)
                .any(|entry| entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("connections.corrupt-"))
        );
    }

    #[test]
    fn skips_invalid_entries_with_a_warning() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.json");
        let file = ConnectionsFile {
            schema_version: CONNECTIONS_SCHEMA_VERSION,
            connections: vec![ConnectionProfile {
                id: "broken".into(),
                name: "Broken".into(),
                protocol: ConnectionProtocol::Ftp,
                host: "bad host".into(),
                port: 21,
                username: "ada".into(),
                auth: ConnectionAuth::Password,
                initial_path: "/".into(),
                favorite: false,
                group: None,
                tls: TlsOptions::default(),
                ftp_data_mode: FtpDataMode::Passive,
                created_at: 0.0,
                last_used_at: None,
            }],
        };
        crate::config::atomic::write_json(&path, &file).unwrap();

        let (store, warning) = ConnectionStore::load(path);
        assert!(store.list().is_empty());
        assert!(warning.is_some());
    }
}
