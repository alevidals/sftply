use serde::{Deserialize, Serialize};
use specta::Type;

/// A trusted SSH host key. `fingerprint` is the SHA-256 fingerprint in the
/// OpenSSH `SHA256:…` representation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct KnownHost {
    pub host: String,
    pub port: u16,
    pub key_type: String,
    pub fingerprint: String,
    /// Unix epoch milliseconds, UTC.
    #[specta(type = specta_typescript::Number)]
    pub added_at: f64,
}

impl KnownHost {
    #[allow(dead_code)] // Diagnostics/UI id for trusted host rows.
    pub fn id(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    pub fn normalized(self) -> Result<Self, String> {
        let host = self.host.trim().to_string();
        if host.is_empty() || host.chars().any(|c| c.is_control() || c.is_whitespace()) {
            return Err("The host name is not valid.".into());
        }
        if self.port == 0 {
            return Err("The port is not valid.".into());
        }
        let key_type = self.key_type.trim().to_string();
        let fingerprint = self.fingerprint.trim().to_string();
        if key_type.is_empty() || key_type.len() > 64 || key_type.chars().any(char::is_control) {
            return Err("The host key type is not valid.".into());
        }
        if fingerprint.is_empty()
            || fingerprint.len() > 128
            || fingerprint.chars().any(char::is_control)
        {
            return Err("The host key fingerprint is not valid.".into());
        }
        Ok(Self {
            host,
            port: self.port,
            key_type,
            fingerprint,
            added_at: self.added_at,
        })
    }
}

/// Result of checking an SSH server key against the trust store.
#[allow(dead_code)] // Consumed by the SFTP session handshake.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostKeyVerdict {
    /// Fingerprint and key type match a trusted entry.
    Trusted,
    /// No entry exists for this host and port.
    Unknown,
    /// An entry exists but the key type or fingerprint differs. This must block
    /// the connection until the user explicitly replaces the stored key.
    Changed { previous_fingerprint: String },
}
