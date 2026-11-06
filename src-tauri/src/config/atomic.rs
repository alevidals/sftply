use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;

/// Write JSON atomically: write a sibling temp file, fsync it, then rename it
/// over the destination. A crash leaves either the old or the new file intact.
pub fn write_json<T: Serialize>(path: &Path, value: &T) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no parent"))?;
    std::fs::create_dir_all(parent)?;

    let payload = serde_json::to_vec_pretty(value)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;

    let tmp_path = temp_path(path);
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp_path)?;
        file.write_all(&payload)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        drop(file);

        rename_replace(&tmp_path, path)?;
        sync_parent(parent);
        Ok(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&tmp_path);
    }

    result
}

pub fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> io::Result<T> {
    let payload = std::fs::read(path)?;
    serde_json::from_slice(&payload)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

fn temp_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "settings".into());
    path.with_file_name(format!(
        ".{file_name}.tmp-{}",
        uuid::Uuid::new_v4().simple()
    ))
}

fn rename_replace(from: &Path, to: &Path) -> io::Result<()> {
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

fn sync_parent(parent: &Path) {
    // Best effort: not all platforms allow fsync on directories.
    if let Ok(dir) = File::open(parent) {
        let _ = dir.sync_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};

    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    struct Example {
        value: String,
        count: u32,
    }

    #[test]
    fn writes_and_reads_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let value = Example {
            value: "hello".into(),
            count: 3,
        };

        write_json(&path, &value).unwrap();
        let loaded: Example = read_json(&path).unwrap();
        assert_eq!(loaded, value);
    }

    #[test]
    fn replaces_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        write_json(
            &path,
            &Example {
                value: "one".into(),
                count: 1,
            },
        )
        .unwrap();
        write_json(
            &path,
            &Example {
                value: "two".into(),
                count: 2,
            },
        )
        .unwrap();

        let loaded: Example = read_json(&path).unwrap();
        assert_eq!(loaded.value, "two");
    }

    #[test]
    fn leaves_no_temp_file_after_success() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        write_json(
            &path,
            &Example {
                value: "hello".into(),
                count: 1,
            },
        )
        .unwrap();

        let names: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["settings.json"]);
    }
}
