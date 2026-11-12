use std::collections::HashSet;
use std::fs::{File, OpenOptions};
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, RwLock};

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::domain::transfer::{TransferDirection, TransferItem, TransferStatus};

/// Keep the file and the in-memory list bounded. Oldest entries are dropped.
pub const HISTORY_LIMIT: usize = 1_000;

/// One finished transfer, safe to persist and show in the UI. Paths are reduced
/// to the pane labels; credentials never reach this store.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TransferHistoryEntry {
    pub id: String,
    pub name: String,
    pub direction: TransferDirection,
    pub status: TransferStatus,
    pub source_label: String,
    pub target_label: String,
    #[specta(type = specta_typescript::Number)]
    pub size: f64,
    #[specta(type = specta_typescript::Number)]
    pub transferred: f64,
    pub error: Option<String>,
    #[specta(type = specta_typescript::Number)]
    pub started_at: f64,
    #[specta(type = Option<specta_typescript::Number>)]
    pub finished_at: Option<f64>,
}

impl TransferHistoryEntry {
    fn from_item(item: &TransferItem) -> Self {
        Self {
            id: item.id.clone(),
            name: item.name.clone(),
            direction: item.direction,
            status: item.status,
            source_label: item.source_label.clone(),
            target_label: item.target_label.clone(),
            size: item.size,
            transferred: item.transferred,
            error: item.error.clone(),
            started_at: item.started_at,
            finished_at: item.finished_at,
        }
    }
}

/// Bounded JSONL history of finished transfers. Writes are serialized and
/// replace the file atomically so a crash cannot leave a half-written line.
pub struct TransferHistoryStore {
    path: PathBuf,
    entries: RwLock<Vec<TransferHistoryEntry>>,
    write_lock: Mutex<()>,
}

impl TransferHistoryStore {
    pub fn load(path: PathBuf) -> (Self, Option<String>) {
        match read_entries(&path) {
            Ok(entries) => (
                Self {
                    path,
                    entries: RwLock::new(entries),
                    write_lock: Mutex::new(()),
                },
                None,
            ),
            Err(error) => {
                tracing::warn!(%error, "could not read transfer history");
                (
                    Self {
                        path,
                        entries: RwLock::new(Vec::new()),
                        write_lock: Mutex::new(()),
                    },
                    Some("Transfer history could not be read and was reset.".into()),
                )
            }
        }
    }

    /// Newest first, for the history panel.
    pub fn list(&self) -> Vec<TransferHistoryEntry> {
        let mut entries = self
            .entries
            .read()
            .expect("transfer history lock poisoned")
            .clone();
        entries.reverse();
        entries
    }

    /// Record a terminal transfer. Running and queued items are ignored, and an
    /// existing entry with the same id is replaced instead of duplicated.
    pub fn record(&self, item: &TransferItem) {
        if !matches!(
            item.status,
            TransferStatus::Completed | TransferStatus::Failed | TransferStatus::Cancelled
        ) {
            return;
        }

        let _guard = self
            .write_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        {
            let mut entries = self
                .entries
                .write()
                .expect("transfer history lock poisoned");
            let entry = TransferHistoryEntry::from_item(item);
            match entries.iter_mut().find(|existing| existing.id == entry.id) {
                Some(existing) => *existing = entry,
                None => entries.push(entry),
            }
            if entries.len() > HISTORY_LIMIT {
                let excess = entries.len() - HISTORY_LIMIT;
                entries.drain(0..excess);
            }
        }
        self.persist();
    }

    /// Delete every entry and the backing file. Returns how many were removed.
    pub fn clear(&self) -> u32 {
        let _guard = self
            .write_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let removed = {
            let mut entries = self
                .entries
                .write()
                .expect("transfer history lock poisoned");
            let removed = entries.len() as u32;
            entries.clear();
            removed
        };
        if let Err(error) = std::fs::remove_file(&self.path)
            && error.kind() != io::ErrorKind::NotFound
        {
            tracing::warn!(%error, "could not delete transfer history file");
        }
        removed
    }

    fn persist(&self) {
        let entries = self
            .entries
            .read()
            .expect("transfer history lock poisoned")
            .clone();
        if let Err(error) = write_entries(&self.path, &entries) {
            tracing::warn!(%error, "could not persist transfer history");
        }
    }
}

fn read_entries(path: &Path) -> io::Result<Vec<TransferHistoryEntry>> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };

    let mut entries = Vec::new();
    for line in BufReader::new(file).lines() {
        let line = line?;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        match serde_json::from_str::<TransferHistoryEntry>(line) {
            Ok(entry) => entries.push(entry),
            Err(error) => {
                tracing::debug!(%error, "skipping malformed transfer history line");
            }
        }
    }

    // A crash during a rewrite can leave the old and the new copy of an entry.
    // Keep the last occurrence of each id, then bound the result.
    let mut seen = HashSet::new();
    let mut deduped: Vec<_> = entries
        .into_iter()
        .rev()
        .filter(|entry| seen.insert(entry.id.clone()))
        .collect();
    deduped.reverse();
    if deduped.len() > HISTORY_LIMIT {
        deduped.drain(0..deduped.len() - HISTORY_LIMIT);
    }
    Ok(deduped)
}

fn write_entries(path: &Path, entries: &[TransferHistoryEntry]) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no parent"))?;
    std::fs::create_dir_all(parent)?;

    let mut payload = String::new();
    for entry in entries {
        let line = serde_json::to_string(entry)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        payload.push_str(&line);
        payload.push('\n');
    }

    let tmp_path = parent.join(format!(
        ".transfer-history.jsonl.tmp-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp_path)?;
        file.write_all(payload.as_bytes())?;
        file.sync_all()?;
        drop(file);
        replace_file(&tmp_path, path)
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&tmp_path);
    }
    result
}

fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    match std::fs::rename(from, to) {
        Ok(()) => Ok(()),
        #[cfg(windows)]
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            std::fs::remove_file(to)?;
            std::fs::rename(from, to)
        }
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, status: TransferStatus, finished: bool) -> TransferItem {
        let mut item = TransferItem::new(
            TransferDirection::Upload,
            format!("/local/{id}"),
            format!("/remote/{id}"),
            "This Mac".into(),
            "server".into(),
            id.into(),
            1_024.0,
        );
        item.id = id.into();
        item.status = status;
        if finished {
            item.finished_at = Some(1_700_000_000_000.0);
        }
        item
    }

    #[test]
    fn records_only_terminal_transfers() {
        let dir = tempfile::tempdir().unwrap();
        let (store, warning) =
            TransferHistoryStore::load(dir.path().join("transfer-history.jsonl"));
        assert!(warning.is_none());

        store.record(&item("queued", TransferStatus::Queued, false));
        store.record(&item("running", TransferStatus::Running, false));
        store.record(&item("done", TransferStatus::Completed, true));

        let entries = store.list();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "done");
    }

    #[test]
    fn replaces_an_entry_instead_of_duplicating_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("transfer-history.jsonl");
        let (store, _) = TransferHistoryStore::load(path.clone());

        store.record(&item("one", TransferStatus::Failed, true));
        store.record(&item("one", TransferStatus::Completed, true));

        assert_eq!(store.list().len(), 1);
        let (reloaded, warning) = TransferHistoryStore::load(path);
        assert!(warning.is_none());
        assert_eq!(reloaded.list().len(), 1);
        assert_eq!(reloaded.list()[0].status, TransferStatus::Completed);
    }

    #[test]
    fn keeps_the_newest_entries_up_to_the_limit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("transfer-history.jsonl");
        let (store, _) = TransferHistoryStore::load(path.clone());

        for index in 0..(HISTORY_LIMIT + 5) {
            store.record(&item(
                &format!("file-{index}"),
                TransferStatus::Completed,
                true,
            ));
        }

        let entries = store.list();
        assert_eq!(entries.len(), HISTORY_LIMIT);
        assert_eq!(entries[0].id, format!("file-{}", HISTORY_LIMIT + 4));
        assert_eq!(entries[HISTORY_LIMIT - 1].id, "file-5");

        let (reloaded, _) = TransferHistoryStore::load(path);
        assert_eq!(reloaded.list().len(), HISTORY_LIMIT);
    }

    #[test]
    fn skips_malformed_lines_and_clears_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("transfer-history.jsonl");
        std::fs::write(
            &path,
            "{\"id\":\"kept\",\"name\":\"kept\",\"direction\":\"upload\",\"status\":\"completed\",\"sourceLabel\":\"a\",\"targetLabel\":\"b\",\"size\":1,\"transferred\":1,\"error\":null,\"startedAt\":1,\"finishedAt\":2}\nnot json\n\n",
        )
        .unwrap();

        let (store, warning) = TransferHistoryStore::load(path.clone());
        assert!(warning.is_none());
        assert_eq!(store.list().len(), 1);
        assert_eq!(store.list()[0].id, "kept");

        assert_eq!(store.clear(), 1);
        assert!(!path.exists());
        assert!(store.list().is_empty());
    }
}
