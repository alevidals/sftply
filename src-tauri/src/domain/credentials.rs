use serde::{Deserialize, Serialize};
use specta::Type;

/// Which secret a connection stores. Secrets never cross the IPC boundary in
/// read direction: the frontend can set, delete and query presence only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SecretKind {
    Password,
    Passphrase,
}

impl SecretKind {
    pub fn key(self) -> &'static str {
        match self {
            Self::Password => "password",
            Self::Passphrase => "passphrase",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    pub password: bool,
    pub passphrase: bool,
}
