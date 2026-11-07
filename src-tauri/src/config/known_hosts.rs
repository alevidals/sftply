use std::path::{Path, PathBuf};
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

use crate::domain::activity::unix_millis;
use crate::domain::host_key::{HostKeyVerdict, KnownHost};
use crate::error::{AppError, ErrorCode};

pub const KNOWN_HOSTS_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct KnownHostsFile {
    schema_version: u32,
    hosts: Vec<KnownHost>,
}

impl Default for KnownHostsFile {
    fn default() -> Self {
        Self {
            schema_version: KNOWN_HOSTS_SCHEMA_VERSION,
            hosts: Vec::new(),
        }
    }
}

/// Persisted SSH host-key trust store. Unknown keys require explicit trust and
/// changed keys always block until the user replaces them.
pub struct KnownHostsStore {
    path: PathBuf,
    current: RwLock<Vec<KnownHost>>,
    write_lock: tokio::sync::Mutex<()>,
}

impl KnownHostsStore {
    pub fn load(path: PathBuf) -> (Self, Option<String>) {
        match load_from_disk(&path) {
            Ok((hosts, warning)) => (
                Self {
                    path,
                    current: RwLock::new(hosts),
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
                tracing::error!(%detail, "known hosts file corrupt; starting empty");
                let backup = backup_path(&path);
                if let Err(error) = std::fs::rename(&path, &backup) {
                    tracing::warn!(%error, "could not back up corrupt known hosts file");
                }
                (
                    Self {
                        path,
                        current: RwLock::new(Vec::new()),
                        write_lock: tokio::sync::Mutex::new(()),
                    },
                    Some(
                        "Trusted hosts could not be read and were reset. A backup was kept.".into(),
                    ),
                )
            }
        }
    }

    pub fn list(&self) -> Vec<KnownHost> {
        self.current
            .read()
            .expect("known hosts lock poisoned")
            .clone()
    }

    #[allow(dead_code)] // Used by the SFTP host-key check in the session layer.
    pub fn verify(
        &self,
        host: &str,
        port: u16,
        key_type: &str,
        fingerprint: &str,
    ) -> HostKeyVerdict {
        let hosts = self.current.read().expect("known hosts lock poisoned");
        match hosts
            .iter()
            .find(|entry| entry.host == host && entry.port == port)
        {
            None => HostKeyVerdict::Unknown,
            Some(entry) if entry.key_type == key_type && entry.fingerprint == fingerprint => {
                HostKeyVerdict::Trusted
            }
            Some(entry) => HostKeyVerdict::Changed {
                previous_fingerprint: entry.fingerprint.clone(),
            },
        }
    }

    /// Trust a host key, replacing any existing entry for the same host/port.
    pub async fn trust(&self, host: KnownHost) -> Result<KnownHost, AppError> {
        let host = host.normalized().map_err(AppError::invalid_input)?;
        let _guard = self.write_lock.lock().await;

        let mut next = self.snapshot();
        next.retain(|entry| !(entry.host == host.host && entry.port == host.port));
        next.push(host.clone());
        self.persist(next).await?;
        Ok(host)
    }

    pub async fn remove(&self, host: &str, port: u16) -> Result<(), AppError> {
        let _guard = self.write_lock.lock().await;
        let mut next = self.snapshot();
        let before = next.len();
        next.retain(|entry| !(entry.host == host && entry.port == port));
        if next.len() == before {
            return Err(AppError::not_found("That host is not trusted."));
        }
        self.persist(next).await
    }

    fn snapshot(&self) -> Vec<KnownHost> {
        self.current
            .read()
            .expect("known hosts lock poisoned")
            .clone()
    }

    async fn persist(&self, next: Vec<KnownHost>) -> Result<(), AppError> {
        let payload = KnownHostsFile {
            schema_version: KNOWN_HOSTS_SCHEMA_VERSION,
            hosts: next.clone(),
        };
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || crate::config::atomic::write_json(&path, &payload))
            .await
            .map_err(|error| {
                AppError::new(
                    ErrorCode::ConfigWriteFailed,
                    "Could not save trusted hosts.",
                )
                .with_detail(format!("known hosts write task failed: {error}"))
            })?
            .map_err(|error| {
                AppError::new(
                    ErrorCode::ConfigWriteFailed,
                    "Could not save trusted hosts.",
                )
                .with_detail(error.to_string())
            })?;

        *self.current.write().expect("known hosts lock poisoned") = next;
        Ok(())
    }
}

enum LoadError {
    Missing,
    Corrupt(String),
}

fn load_from_disk(path: &Path) -> Result<(Vec<KnownHost>, Option<String>), LoadError> {
    if !path.exists() {
        return Err(LoadError::Missing);
    }

    let file: KnownHostsFile = crate::config::atomic::read_json(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            LoadError::Missing
        } else {
            LoadError::Corrupt(error.to_string())
        }
    })?;

    if file.schema_version > KNOWN_HOSTS_SCHEMA_VERSION {
        return Err(LoadError::Corrupt(format!(
            "unsupported known hosts schema version {}",
            file.schema_version
        )));
    }

    let total = file.hosts.len();
    let mut hosts = Vec::with_capacity(total);
    for host in file.hosts {
        match host.normalized() {
            Ok(host)
                if !hosts.iter().any(|existing: &KnownHost| {
                    existing.host == host.host && existing.port == host.port
                }) =>
            {
                hosts.push(host);
            }
            Ok(_) => tracing::warn!("ignoring duplicate trusted host entry"),
            Err(message) => tracing::warn!(%message, "ignoring invalid trusted host entry"),
        }
    }

    let warning = (hosts.len() != total).then(|| {
        format!(
            "{} of {total} trusted host entries could not be read and were skipped.",
            total - hosts.len()
        )
    });
    Ok((hosts, warning))
}

fn backup_path(path: &Path) -> PathBuf {
    let millis = unix_millis();
    path.with_file_name(format!("known_hosts.corrupt-{millis:.0}.json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host() -> KnownHost {
        KnownHost {
            host: "example.com".into(),
            port: 22,
            key_type: "ssh-ed25519".into(),
            fingerprint: "SHA256:abc".into(),
            added_at: unix_millis(),
        }
    }

    #[tokio::test]
    async fn trusts_removes_and_detects_changes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("known_hosts.json");
        let (store, warning) = KnownHostsStore::load(path);
        assert!(warning.is_none());

        assert_eq!(
            store.verify("example.com", 22, "ssh-ed25519", "SHA256:abc"),
            HostKeyVerdict::Unknown
        );

        store.trust(host()).await.unwrap();
        assert_eq!(
            store.verify("example.com", 22, "ssh-ed25519", "SHA256:abc"),
            HostKeyVerdict::Trusted
        );
        assert_eq!(
            store.verify("example.com", 22, "ssh-ed25519", "SHA256:other"),
            HostKeyVerdict::Changed {
                previous_fingerprint: "SHA256:abc".into()
            }
        );

        store.remove("example.com", 22).await.unwrap();
        assert!(store.remove("example.com", 22).await.is_err());
        assert_eq!(
            store.verify("example.com", 22, "ssh-ed25519", "SHA256:abc"),
            HostKeyVerdict::Unknown
        );
    }

    #[test]
    fn recovers_from_corrupt_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("known_hosts.json");
        std::fs::write(&path, "nope").unwrap();
        let (store, warning) = KnownHostsStore::load(path);
        assert!(warning.is_some());
        assert!(store.list().is_empty());
    }
}
