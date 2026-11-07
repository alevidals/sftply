use std::path::Path;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::domain::remote_path::normalize_remote;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionProtocol {
    Ftp,
    FtpsExplicit,
    FtpsImplicit,
    Sftp,
}

impl ConnectionProtocol {
    #[allow(dead_code)] // Mirrored by the connection form defaults.
    pub fn default_port(self) -> u16 {
        match self {
            Self::Ftp | Self::FtpsExplicit => 21,
            Self::FtpsImplicit => 990,
            Self::Sftp => 22,
        }
    }
}

/// How a connection authenticates. Secrets are never part of this model; they
/// live in the OS keychain and are referenced by connection id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ConnectionAuth {
    Password,
    Key {
        /// Absolute local path to an OpenSSH or PEM private key.
        key_path: String,
        /// Whether the key is expected to need a passphrase in the keychain.
        passphrase_protected: bool,
    },
}

/// Non-secret connection metadata persisted in `connections.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub protocol: ConnectionProtocol,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: ConnectionAuth,
    pub initial_path: String,
    pub favorite: bool,
    pub group: Option<String>,
    /// Unix epoch milliseconds, UTC.
    #[specta(type = specta_typescript::Number)]
    pub created_at: f64,
    #[specta(type = Option<specta_typescript::Number>)]
    pub last_used_at: Option<f64>,
}

/// Fields the frontend may submit when creating or updating a connection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInput {
    pub name: String,
    pub protocol: ConnectionProtocol,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: ConnectionAuth,
    pub initial_path: String,
    pub favorite: bool,
    pub group: Option<String>,
}

impl ConnectionProfile {
    pub fn from_input(id: String, input: ConnectionInput, now: f64) -> Self {
        Self {
            id,
            name: input.name,
            protocol: input.protocol,
            host: input.host,
            port: input.port,
            username: input.username,
            auth: input.auth,
            initial_path: input.initial_path,
            favorite: input.favorite,
            group: input.group,
            created_at: now,
            last_used_at: None,
        }
    }

    /// Re-run validation for a profile loaded from disk.
    pub fn normalized(self) -> Result<Self, String> {
        let input = ConnectionInput {
            name: self.name,
            protocol: self.protocol,
            host: self.host,
            port: self.port,
            username: self.username,
            auth: self.auth,
            initial_path: self.initial_path,
            favorite: self.favorite,
            group: self.group,
        }
        .normalized()?;

        Ok(Self {
            name: input.name,
            protocol: input.protocol,
            host: input.host,
            port: input.port,
            username: input.username,
            auth: input.auth,
            initial_path: input.initial_path,
            favorite: input.favorite,
            group: input.group,
            ..self
        })
    }
}

impl ConnectionInput {
    /// Trim and validate every user-provided field. Returns a message safe to
    /// show in a form.
    pub fn normalized(self) -> Result<Self, String> {
        let name = self.name.trim().to_string();
        if name.is_empty() {
            return Err("A connection name is required.".into());
        }
        if name.chars().count() > 100 {
            return Err("The connection name is too long.".into());
        }
        if has_control(&name) {
            return Err("The connection name contains invalid characters.".into());
        }

        let host = self.host.trim().to_string();
        if host.is_empty() {
            return Err("A host is required.".into());
        }
        if host.len() > 253 {
            return Err("The host name is too long.".into());
        }
        if host
            .chars()
            .any(|c| c.is_whitespace() || c == '/' || c == '\\' || c == '\0' || c.is_control())
        {
            return Err("The host name contains invalid characters.".into());
        }

        if self.port == 0 {
            return Err("The port must be between 1 and 65535.".into());
        }

        let username = self.username.trim().to_string();
        if username.is_empty() {
            return Err("A username is required.".into());
        }
        if username.chars().count() > 128 || has_control(&username) {
            return Err("The username contains invalid characters.".into());
        }

        let auth = match self.auth {
            ConnectionAuth::Password => ConnectionAuth::Password,
            ConnectionAuth::Key {
                key_path,
                passphrase_protected,
            } => {
                let key_path = key_path.trim().to_string();
                if key_path.is_empty() {
                    return Err("Choose a private key file.".into());
                }
                if key_path.contains('\0') || !Path::new(&key_path).is_absolute() {
                    return Err("The private key path must be absolute.".into());
                }
                ConnectionAuth::Key {
                    key_path,
                    passphrase_protected,
                }
            }
        };

        if !matches!(self.protocol, ConnectionProtocol::Sftp)
            && matches!(auth, ConnectionAuth::Key { .. })
        {
            return Err("SSH keys can only be used with SFTP connections.".into());
        }

        let initial_path = if self.initial_path.trim().is_empty() {
            "/".to_string()
        } else {
            normalize_remote(self.initial_path.trim()).map_err(|error| error.message)?
        };

        let group = self.group.and_then(|group| {
            let group = group.trim().to_string();
            (!group.is_empty()).then_some(group)
        });
        if let Some(group) = &group
            && (group.chars().count() > 64 || has_control(group))
        {
            return Err("The group name contains invalid characters.".into());
        }

        Ok(Self {
            name,
            protocol: self.protocol,
            host,
            port: self.port,
            username,
            auth,
            initial_path,
            favorite: self.favorite,
            group,
        })
    }
}

fn has_control(value: &str) -> bool {
    value.chars().any(|c| c.is_control())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> ConnectionInput {
        ConnectionInput {
            name: "  Production  ".into(),
            protocol: ConnectionProtocol::Sftp,
            host: "example.com".into(),
            port: 22,
            username: "ada".into(),
            auth: ConnectionAuth::Password,
            initial_path: "".into(),
            favorite: false,
            group: Some("  Work  ".into()),
        }
    }

    #[test]
    fn trims_and_defaults_paths_and_groups() {
        let normalized = input().normalized().unwrap();
        assert_eq!(normalized.name, "Production");
        assert_eq!(normalized.group.as_deref(), Some("Work"));
        assert_eq!(normalized.initial_path, "/");
    }

    #[test]
    fn rejects_bad_hosts_ports_and_names() {
        let mut bad = input();
        bad.host = " ".into();
        assert!(bad.normalized().is_err());

        let mut bad = input();
        bad.host = "host with space".into();
        assert!(bad.normalized().is_err());

        let mut bad = input();
        bad.port = 0;
        assert!(bad.normalized().is_err());

        let mut bad = input();
        bad.username = "".into();
        assert!(bad.normalized().is_err());

        let mut bad = input();
        bad.initial_path = "relative".into();
        assert!(bad.normalized().is_err());
    }

    #[test]
    fn keys_are_sftp_only_and_absolute() {
        let mut with_key = input();
        with_key.auth = ConnectionAuth::Key {
            key_path: "relative/key".into(),
            passphrase_protected: false,
        };
        assert!(with_key.clone().normalized().is_err());

        with_key.auth = ConnectionAuth::Key {
            key_path: "/home/ada/.ssh/id_ed25519".into(),
            passphrase_protected: true,
        };
        assert!(with_key.clone().normalized().is_ok());

        with_key.protocol = ConnectionProtocol::Ftp;
        assert!(with_key.normalized().is_err());
    }

    #[test]
    fn default_ports_match_the_protocol() {
        assert_eq!(ConnectionProtocol::Ftp.default_port(), 21);
        assert_eq!(ConnectionProtocol::FtpsExplicit.default_port(), 21);
        assert_eq!(ConnectionProtocol::FtpsImplicit.default_port(), 990);
        assert_eq!(ConnectionProtocol::Sftp.default_port(), 22);
    }
}
