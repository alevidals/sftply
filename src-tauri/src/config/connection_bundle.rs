//! Credential-free import and export of saved connections.
//!
//! The bundle contains exactly the non-secret part of a profile: no ids, no
//! timestamps, no passwords or passphrases. Secrets live in the OS keychain and
//! are keyed by connection id, so they cannot travel with an export by design.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::config::atomic;
use crate::domain::activity::unix_millis;
use crate::domain::connection::{ConnectionInput, ConnectionProfile};
use crate::error::{AppError, ErrorCode};

/// Marker that identifies a sftply bundle. Guards against importing an
/// unrelated JSON file that happens to have a `connections` array.
pub const BUNDLE_FORMAT: &str = "sftply.connections";
pub const BUNDLE_VERSION: u32 = 1;
/// Refuse anything larger than this before parsing it.
pub const MAX_BUNDLE_BYTES: u64 = 4 * 1024 * 1024;
/// Refuse bundles with more entries than this.
pub const MAX_BUNDLE_ENTRIES: usize = 1_000;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    pub format: String,
    pub schema_version: u32,
    pub exported_at: f64,
    pub app: BundleApp,
    pub connections: Vec<ConnectionInput>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleApp {
    pub name: String,
    pub version: String,
}

/// Result of parsing a bundle: the entries that can be imported and a
/// human-readable note for each one that cannot.
#[derive(Debug)]
pub struct ParsedBundle {
    pub connections: Vec<ConnectionInput>,
    pub problems: Vec<String>,
}

pub fn build_bundle(connections: &[ConnectionProfile]) -> Bundle {
    Bundle {
        format: BUNDLE_FORMAT.to_string(),
        schema_version: BUNDLE_VERSION,
        exported_at: unix_millis(),
        app: BundleApp {
            name: "sftply".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        },
        connections: connections
            .iter()
            .map(ConnectionInput::from_profile)
            .collect(),
    }
}

pub fn export_to(path: &Path, connections: &[ConnectionProfile]) -> Result<u32, AppError> {
    validate_target(path)?;
    let bundle = build_bundle(connections);
    let count = bundle.connections.len() as u32;
    atomic::write_json(path, &bundle).map_err(|error| {
        AppError::new(ErrorCode::ConfigWriteFailed, "Could not write that file.")
            .with_detail(error.to_string())
    })?;
    Ok(count)
}

pub fn parse(path: &Path) -> Result<ParsedBundle, AppError> {
    validate_source(path)?;
    let metadata = std::fs::metadata(path).map_err(|error| {
        AppError::new(ErrorCode::NotFound, "That file could not be read.")
            .with_detail(error.to_string())
    })?;
    if !metadata.is_file() {
        return Err(AppError::invalid_input("That path is not a file."));
    }
    if metadata.len() > MAX_BUNDLE_BYTES {
        return Err(AppError::invalid_input(
            "That file is larger than the 4 MiB import limit.",
        ));
    }
    let bytes = std::fs::read(path).map_err(|error| {
        AppError::new(ErrorCode::NotFound, "That file could not be read.")
            .with_detail(error.to_string())
    })?;
    parse_bytes(&bytes)
}

pub fn parse_bytes(bytes: &[u8]) -> Result<ParsedBundle, AppError> {
    let bundle: Bundle = serde_json::from_slice(bytes).map_err(|error| {
        AppError::invalid_input("That file is not a sftply connections export.").with_detail(
            format!(
                "invalid JSON at line {} column {}",
                error.line(),
                error.column()
            ),
        )
    })?;

    if bundle.format != BUNDLE_FORMAT {
        return Err(AppError::invalid_input(
            "That file was not exported by sftply.",
        ));
    }
    if bundle.schema_version > BUNDLE_VERSION {
        return Err(AppError::new(
            ErrorCode::Unsupported,
            "That file was exported by a newer version of sftply.",
        )
        .with_detail(format!(
            "bundle schema {} is newer than {}",
            bundle.schema_version, BUNDLE_VERSION
        )));
    }

    let mut problems = Vec::new();
    let mut connections = Vec::new();
    let total = bundle.connections.len();
    for (index, input) in bundle.connections.into_iter().enumerate() {
        if index >= MAX_BUNDLE_ENTRIES {
            problems.push(format!(
                "Skipped {} extra connections: the limit is {MAX_BUNDLE_ENTRIES}.",
                total - MAX_BUNDLE_ENTRIES
            ));
            break;
        }
        match input.normalized() {
            Ok(input) => connections.push(input),
            Err(reason) => problems.push(format!("Entry {} was skipped: {reason}", index + 1)),
        }
    }

    Ok(ParsedBundle {
        connections,
        problems,
    })
}

fn validate_source(path: &Path) -> Result<(), AppError> {
    validate_common(path)
}

fn validate_target(path: &Path) -> Result<(), AppError> {
    validate_common(path)
}

fn validate_common(path: &Path) -> Result<(), AppError> {
    let value = path.to_string_lossy();
    if value.contains('\0') || !path.is_absolute() {
        return Err(AppError::invalid_input("Choose an absolute file path."));
    }
    if path.file_name().is_none() {
        return Err(AppError::invalid_input("Choose a file, not a folder."));
    }
    Ok(())
}

impl ConnectionInput {
    /// Non-secret projection of a saved profile.
    pub fn from_profile(profile: &ConnectionProfile) -> Self {
        Self {
            name: profile.name.clone(),
            protocol: profile.protocol,
            host: profile.host.clone(),
            port: profile.port,
            username: profile.username.clone(),
            auth: profile.auth.clone(),
            initial_path: profile.initial_path.clone(),
            favorite: profile.favorite,
            group: profile.group.clone(),
            tls: profile.tls.clone(),
            ftp_data_mode: profile.ftp_data_mode,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::connection::{ConnectionAuth, ConnectionProtocol, FtpDataMode, TlsOptions};

    fn profile(id: &str, name: &str, host: &str, username: &str) -> ConnectionProfile {
        ConnectionProfile {
            id: id.to_string(),
            name: name.to_string(),
            protocol: ConnectionProtocol::Sftp,
            host: host.to_string(),
            port: 22,
            username: username.to_string(),
            auth: ConnectionAuth::Password,
            initial_path: "/srv".to_string(),
            favorite: true,
            group: Some("Work".to_string()),
            tls: TlsOptions::default(),
            ftp_data_mode: FtpDataMode::Passive,
            created_at: 1.0,
            last_used_at: Some(2.0),
        }
    }

    #[test]
    fn round_trip_keeps_settings_and_drops_identity() {
        let source = profile("id-1", "Staging", "staging.example.com", "deploy");
        let bundle = build_bundle(std::slice::from_ref(&source));
        let bytes = serde_json::to_vec(&bundle).unwrap();

        let parsed = parse_bytes(&bytes).unwrap();
        assert_eq!(parsed.problems, Vec::<String>::new());
        assert_eq!(parsed.connections.len(), 1);

        let input = &parsed.connections[0];
        assert_eq!(input.name, source.name);
        assert_eq!(input.host, source.host);
        assert_eq!(input.username, source.username);
        assert_eq!(input.favorite, source.favorite);
        assert_eq!(input.group, source.group);
        assert_eq!(input.initial_path, source.initial_path);
        assert_eq!(input.port, source.port);
        assert_eq!(input.protocol, source.protocol);

        let json = serde_json::to_string(&bundle).unwrap();
        assert!(!json.contains("id-1"), "ids must not travel");
        assert!(!json.contains("createdAt"), "timestamps must not travel");
        assert!(!json.contains("lastUsedAt"), "timestamps must not travel");
    }

    #[test]
    fn export_has_no_secret_fields() {
        let mut profile = profile("id-2", "Keys", "keys.example.com", "root");
        profile.auth = ConnectionAuth::Key {
            key_path: "/home/me/.ssh/id_ed25519".to_string(),
            passphrase_protected: true,
        };
        let json = serde_json::to_value(build_bundle(&[profile])).unwrap();

        fn collect_keys(value: &serde_json::Value, keys: &mut Vec<String>) {
            match value {
                serde_json::Value::Object(map) => {
                    for (key, child) in map {
                        keys.push(key.to_lowercase());
                        collect_keys(child, keys);
                    }
                }
                serde_json::Value::Array(items) => {
                    for item in items {
                        collect_keys(item, keys);
                    }
                }
                _ => {}
            }
        }

        let mut keys = Vec::new();
        collect_keys(&json, &mut keys);
        for forbidden in ["password", "passphrase", "secret", "token"] {
            assert!(
                !keys.iter().any(|key| key == forbidden),
                "bundle must not contain a {forbidden} field"
            );
        }
        // The key path is metadata, not key material.
        assert!(json.to_string().contains("id_ed25519"));
    }

    #[test]
    fn rejects_foreign_files() {
        let error = parse_bytes(br#"{"connections":[]}"#).unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidInput);
        assert!(error.message.contains("not a sftply"));
    }

    #[test]
    fn rejects_newer_schemas() {
        let bundle = serde_json::json!({
            "format": BUNDLE_FORMAT,
            "schemaVersion": BUNDLE_VERSION + 1,
            "exportedAt": 0,
            "app": { "name": "sftply", "version": "9.9.9" },
            "connections": [],
        });
        let error = parse_bytes(bundle.to_string().as_bytes()).unwrap_err();
        assert_eq!(error.code, ErrorCode::Unsupported);
    }

    #[test]
    fn reports_invalid_entries_but_keeps_valid_ones() {
        let bundle = serde_json::json!({
            "format": BUNDLE_FORMAT,
            "schemaVersion": BUNDLE_VERSION,
            "exportedAt": 0,
            "app": { "name": "sftply", "version": "0.2.0" },
            "connections": [
                {
                    "name": "Good",
                    "protocol": "ftp",
                    "host": "ftp.example.com",
                    "port": 21,
                    "username": "anonymous",
                    "auth": { "kind": "password" },
                    "initialPath": "/",
                    "favorite": false,
                    "group": null
                },
                {
                    "name": "",
                    "protocol": "ftp",
                    "host": "",
                    "port": 21,
                    "username": "",
                    "auth": { "kind": "password" },
                    "initialPath": "/",
                    "favorite": false,
                    "group": null
                }
            ]
        });

        let parsed = parse_bytes(bundle.to_string().as_bytes()).unwrap();
        assert_eq!(parsed.connections.len(), 1);
        assert_eq!(parsed.connections[0].name, "Good");
        assert_eq!(parsed.problems.len(), 1);
        assert!(parsed.problems[0].contains("Entry 2"));
    }

    #[test]
    fn caps_the_number_of_entries() {
        let entry = serde_json::json!({
            "name": "Many",
            "protocol": "ftp",
            "host": "example.com",
            "port": 21,
            "username": "anonymous",
            "auth": { "kind": "password" },
            "initialPath": "/",
            "favorite": false,
            "group": null
        });
        let connections = vec![entry; MAX_BUNDLE_ENTRIES + 5];
        let bundle = serde_json::json!({
            "format": BUNDLE_FORMAT,
            "schemaVersion": BUNDLE_VERSION,
            "exportedAt": 0,
            "app": { "name": "sftply", "version": "0.2.0" },
            "connections": connections,
        });

        let parsed = parse_bytes(bundle.to_string().as_bytes()).unwrap();
        assert_eq!(parsed.connections.len(), MAX_BUNDLE_ENTRIES);
        assert_eq!(parsed.problems.len(), 1);
        assert!(parsed.problems[0].contains("limit"));
    }
}
