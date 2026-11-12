use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tauri_specta::Event;
use tokio::sync::{Semaphore, watch};
use tokio_util::sync::CancellationToken;

use crate::domain::connection::ConnectionProfile;
use crate::domain::fs::EntryKind;
use crate::domain::host_key::KnownHost;
use crate::domain::remote_path::{join_remote, normalize_remote, remote_leaf, remote_parent};
use crate::domain::transfer::{
    ConflictPolicy, TransferDeltaEvent, TransferDirection, TransferItem, TransferStatus,
};
use crate::error::{AppError, ErrorCode};
use crate::fs::local::{LocalReader, LocalWriter};
use crate::fs::{FileReader, FileWriter};
use crate::protocol::RemoteFs;
use crate::session::{SessionCredentials, connect_client};

pub mod history;

use history::TransferHistoryStore;

const CHUNK_SIZE: usize = 64 * 1024;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

/// Everything needed to open an independent protocol connection for a
/// transfer. A transfer never holds the browsing session's stream, so the file
/// browser stays usable while a large file moves.
#[derive(Clone)]
pub struct RemoteAccess {
    pub profile: ConnectionProfile,
    pub credentials: SessionCredentials,
    pub trusted: Vec<KnownHost>,
}

#[derive(Clone)]
pub struct TransferJob {
    pub item: TransferItem,
    pub source_remote: Option<RemoteAccess>,
    pub target_remote: Option<RemoteAccess>,
    pub policy: ConflictPolicy,
}

/// In-memory transfer queue. Completed rows stay until the user clears them,
/// and their jobs are kept so a failed or cancelled transfer can be retried
/// without asking the frontend to rebuild it.
pub struct TransferManager {
    items: RwLock<HashMap<String, TransferItem>>,
    tasks: Mutex<HashMap<String, CancellationToken>>,
    jobs: Mutex<HashMap<String, TransferJob>>,
    semaphore: Arc<Semaphore>,
    /// True while the queue is paused. Running transfers are allowed to finish;
    /// no new transfer starts until the queue is resumed.
    paused: watch::Sender<bool>,
    history: Arc<TransferHistoryStore>,
}

impl TransferManager {
    pub fn new(concurrency: usize, history: Arc<TransferHistoryStore>) -> Self {
        let (paused, _) = watch::channel(false);
        Self {
            items: RwLock::new(HashMap::new()),
            tasks: Mutex::new(HashMap::new()),
            jobs: Mutex::new(HashMap::new()),
            semaphore: Arc::new(Semaphore::new(concurrency.clamp(1, 8))),
            paused,
            history,
        }
    }

    pub fn history(&self) -> Arc<TransferHistoryStore> {
        self.history.clone()
    }

    pub fn remember_job(&self, job: TransferJob) {
        self.jobs
            .lock()
            .expect("transfer job lock poisoned")
            .insert(job.item.id.clone(), job);
    }

    pub fn is_paused(&self) -> bool {
        *self.paused.borrow()
    }

    pub fn pause_queue(&self) -> bool {
        self.paused.send_replace(true);
        true
    }

    pub fn resume_queue(&self) -> bool {
        self.paused.send_replace(false);
        false
    }

    /// Requeue a failed or cancelled transfer with a fresh id. The original job
    /// snapshot is reused, so credentials never round-trip through the UI.
    pub fn retry(self: &Arc<Self>, app: &AppHandle, id: &str) -> Result<TransferItem, AppError> {
        let (status, mut job) = {
            let items = self.items.read().expect("transfer lock poisoned");
            let item = items.get(id).ok_or_else(|| {
                AppError::new(
                    ErrorCode::NotFound,
                    "That transfer is no longer in the queue.",
                )
            })?;
            let status = item.status;
            let job = self
                .jobs
                .lock()
                .expect("transfer job lock poisoned")
                .get(id)
                .cloned()
                .ok_or_else(|| {
                    AppError::new(
                        ErrorCode::NotFound,
                        "That transfer can no longer be retried. Queue it again.",
                    )
                })?;
            (status, job)
        };

        if !matches!(status, TransferStatus::Failed | TransferStatus::Cancelled) {
            return Err(AppError::new(
                ErrorCode::Conflict,
                "Only failed or cancelled transfers can be retried.",
            ));
        }

        let mut item = job.item.clone();
        item.id = uuid::Uuid::new_v4().to_string();
        item.status = TransferStatus::Queued;
        item.transferred = 0.0;
        item.bytes_per_sec = 0.0;
        item.eta_ms = None;
        item.error = None;
        item.finished_at = None;
        item.started_at = crate::domain::activity::unix_millis();
        job.item = item.clone();

        self.insert(item.clone());
        self.remember_job(job.clone());
        emit_delta(app, vec![item.clone()], Vec::new());
        spawn_transfer(app.clone(), self.clone(), job);
        Ok(item)
    }

    pub fn insert(&self, item: TransferItem) {
        self.items
            .write()
            .expect("transfer lock poisoned")
            .insert(item.id.clone(), item);
    }

    pub fn list(&self) -> Vec<TransferItem> {
        let mut items: Vec<_> = self
            .items
            .read()
            .expect("transfer lock poisoned")
            .values()
            .cloned()
            .collect();
        items.sort_by(|left, right| right.started_at.total_cmp(&left.started_at));
        items
    }

    pub fn publish(&self, app: &AppHandle, item: &TransferItem) {
        self.items
            .write()
            .expect("transfer lock poisoned")
            .insert(item.id.clone(), item.clone());
        // `record` ignores queued and running rows, so only the terminal state
        // reaches the persisted history.
        self.history.record(item);
        emit_delta(app, vec![item.clone()], Vec::new());
    }

    pub fn cancel(&self, id: &str) -> bool {
        let tasks = self.tasks.lock().expect("transfer task lock poisoned");
        match tasks.get(id) {
            Some(token) => {
                token.cancel();
                true
            }
            None => false,
        }
    }

    pub fn clear_finished(&self, app: &AppHandle) -> Vec<String> {
        let removed: Vec<String> = {
            let mut items = self.items.write().expect("transfer lock poisoned");
            let finished: Vec<String> = items
                .iter()
                .filter(|(_, item)| {
                    matches!(
                        item.status,
                        TransferStatus::Completed
                            | TransferStatus::Failed
                            | TransferStatus::Cancelled
                    )
                })
                .map(|(id, _)| id.clone())
                .collect();
            for id in &finished {
                items.remove(id);
            }
            finished
        };
        if !removed.is_empty() {
            let mut jobs = self.jobs.lock().expect("transfer job lock poisoned");
            for id in &removed {
                jobs.remove(id);
            }
            emit_delta(app, Vec::new(), removed.clone());
        }
        removed
    }

    fn register_task(&self, id: &str, token: CancellationToken) {
        self.tasks
            .lock()
            .expect("transfer task lock poisoned")
            .insert(id.to_string(), token);
    }

    fn finish_task(&self, id: &str) {
        self.tasks
            .lock()
            .expect("transfer task lock poisoned")
            .remove(id);
    }
}

pub fn emit_delta(app: &AppHandle, upserts: Vec<TransferItem>, removed: Vec<String>) {
    if let Err(error) = (TransferDeltaEvent { upserts, removed }).emit(app) {
        tracing::warn!(%error, "could not emit transfer delta");
    }
}

/// Start a transfer task. The task waits for a global permit, opens its own
/// protocol connection when needed, streams 64 KiB chunks and finalizes the
/// writer before reporting completion.
pub fn spawn_transfer(
    app: AppHandle,
    manager: Arc<TransferManager>,
    mut job: TransferJob,
) -> TransferItem {
    let token = CancellationToken::new();
    manager.register_task(&job.item.id, token.clone());
    let item = job.item.clone();
    let semaphore = manager.semaphore.clone();

    tokio::spawn(async move {
        let mut paused = manager.paused.subscribe();
        let permit = loop {
            while *paused.borrow() {
                tokio::select! {
                    biased;
                    _ = token.cancelled() => {
                        finish_cancelled(&app, &manager, &mut job.item);
                        manager.finish_task(&job.item.id);
                        return;
                    }
                    changed = paused.changed() => {
                        if changed.is_err() {
                            break;
                        }
                    }
                }
            }

            let permit = tokio::select! {
                biased;
                _ = token.cancelled() => {
                    finish_cancelled(&app, &manager, &mut job.item);
                    manager.finish_task(&job.item.id);
                    return;
                }
                permit = semaphore.clone().acquire_owned() => permit.ok(),
            };
            let Some(permit) = permit else {
                fail(
                    &app,
                    &manager,
                    &mut job.item,
                    AppError::internal("The transfer queue is closed.", "semaphore closed"),
                );
                manager.finish_task(&job.item.id);
                return;
            };
            // A pause can arrive while this task was waiting for a permit. Give
            // the slot back and wait instead of starting work after the pause.
            if !manager.is_paused() {
                break permit;
            }
            drop(permit);
        };

        let mut item = job.item.clone();
        item.status = TransferStatus::Running;
        manager.publish(&app, &item);

        let outcome = run_job(&app, &manager, &mut item, &job, &token).await;
        drop(permit);

        match outcome {
            Ok(()) => {
                item.status = TransferStatus::Completed;
                item.error = None;
                item.eta_ms = None;
                item.finished_at = Some(crate::domain::activity::unix_millis());
                manager.publish(&app, &item);
            }
            Err(error) if error.code == ErrorCode::Cancelled => {
                finish_cancelled(&app, &manager, &mut item);
            }
            Err(error) => fail(&app, &manager, &mut item, error),
        }
        manager.finish_task(&item.id);
    });

    item
}

fn finish_cancelled(app: &AppHandle, manager: &TransferManager, item: &mut TransferItem) {
    item.status = TransferStatus::Cancelled;
    item.error = Some("The transfer was cancelled.".into());
    item.eta_ms = None;
    item.finished_at = Some(crate::domain::activity::unix_millis());
    manager.publish(app, item);
}

fn fail(app: &AppHandle, manager: &TransferManager, item: &mut TransferItem, error: AppError) {
    tracing::warn!(transfer = %item.id, code = ?error.code, detail = ?error.detail, "transfer failed");
    item.status = TransferStatus::Failed;
    item.error = Some(error.message);
    item.eta_ms = None;
    item.finished_at = Some(crate::domain::activity::unix_millis());
    manager.publish(app, item);
}

async fn run_job(
    app: &AppHandle,
    manager: &TransferManager,
    item: &mut TransferItem,
    job: &TransferJob,
    token: &CancellationToken,
) -> Result<(), AppError> {
    if token.is_cancelled() {
        return Err(cancelled());
    }

    match item.direction {
        TransferDirection::Download => {
            let access = job.source_remote.as_ref().ok_or_else(|| {
                AppError::internal(
                    "The download source is not remote.",
                    "missing remote source",
                )
            })?;
            let mut client = connect_remote(access).await?;
            let result = download(app, manager, item, &mut client, job.policy, token).await;
            let _ = client.disconnect().await;
            result
        }
        TransferDirection::Upload => {
            let access = job.target_remote.as_ref().ok_or_else(|| {
                AppError::internal("The upload target is not remote.", "missing remote target")
            })?;
            let mut client = connect_remote(access).await?;
            let result = upload(app, manager, item, &mut client, job.policy, token).await;
            let _ = client.disconnect().await;
            result
        }
    }
}

async fn connect_remote(access: &RemoteAccess) -> Result<Box<dyn RemoteFs>, AppError> {
    connect_client(&access.profile, &access.credentials, access.trusted.clone()).await
}

async fn ensure_local_parent(target: &str) -> Result<(), AppError> {
    let Some(parent) = Path::new(target).parent() else {
        return Ok(());
    };
    tokio::fs::create_dir_all(parent).await.map_err(|error| {
        AppError::new(
            ErrorCode::PermissionDenied,
            "Could not create the destination folder.",
        )
        .with_detail(format!("create {}: {error}", parent.display()))
    })
}

/// Create a remote directory tree segment by segment. This is used before an
/// upload starts, so a recursive transfer recreates empty folders as well.
pub(crate) async fn ensure_remote_dir(
    client: &mut Box<dyn RemoteFs>,
    dir: &str,
) -> Result<(), AppError> {
    let dir = normalize_remote(dir)?;
    if dir == "/" {
        return Ok(());
    }

    let mut current = "/".to_string();
    for segment in dir.trim_start_matches('/').split('/') {
        let next = join_remote(&current, segment)?;
        match client.stat(&next).await {
            Ok(entry) if entry.kind == EntryKind::Directory => {}
            Ok(_) => {
                return Err(AppError::new(
                    ErrorCode::Conflict,
                    "A file is in the way of a folder that must be created.",
                )
                .with_detail(next));
            }
            Err(error) if error.code == ErrorCode::NotFound => {
                client.mkdir(&current, segment).await?;
            }
            Err(error) => return Err(error),
        }
        current = next;
    }
    Ok(())
}

async fn download(
    app: &AppHandle,
    manager: &TransferManager,
    item: &mut TransferItem,
    client: &mut Box<dyn RemoteFs>,
    policy: ConflictPolicy,
    token: &CancellationToken,
) -> Result<(), AppError> {
    let requested = normalize_local_target(&item.target_path)?;
    let target = match policy {
        ConflictPolicy::Overwrite => requested,
        ConflictPolicy::Rename => unique_local_target(&requested).await?,
    };
    if target != item.target_path {
        item.target_path = target.clone();
        manager.publish(app, item);
    }
    ensure_local_parent(&target).await?;
    let temp = temp_download_path(&target, &item.id);
    let mut reader = client.open_read(&item.source_path, 0).await?;
    let mut writer: Box<dyn FileWriter> = Box::new(LocalWriter::open(&temp, 0).await?);

    let result = copy_stream(app, manager, item, &mut *reader, &mut *writer, token).await;

    match result {
        Ok(()) => {
            reader.finish().await?;
            writer.finish().await?;
            replace_local_file(&temp, &target).await?;
            Ok(())
        }
        Err(error) => {
            let _ = writer.abort().await;
            let _ = tokio::fs::remove_file(&temp).await;
            Err(error)
        }
    }
}

async fn upload(
    app: &AppHandle,
    manager: &TransferManager,
    item: &mut TransferItem,
    client: &mut Box<dyn RemoteFs>,
    policy: ConflictPolicy,
    token: &CancellationToken,
) -> Result<(), AppError> {
    let target = match policy {
        ConflictPolicy::Overwrite => item.target_path.clone(),
        ConflictPolicy::Rename => unique_remote_target(client, &item.target_path).await?,
    };
    if target != item.target_path {
        item.target_path = target.clone();
        manager.publish(app, item);
    }

    if let Some(parent) = remote_parent(&target)? {
        ensure_remote_dir(client, &parent).await?;
    }
    let mut reader: Box<dyn FileReader> = Box::new(LocalReader::open(&item.source_path, 0).await?);
    let mut writer = client.open_write(&target, 0).await?;

    let result = copy_stream(app, manager, item, &mut *reader, &mut *writer, token).await;

    match result {
        Ok(()) => {
            reader.finish().await?;
            writer.finish().await?;
            Ok(())
        }
        Err(error) => {
            let _ = writer.abort().await;
            // Best effort: do not leave a partial upload behind when the
            // control channel still answers. A failure here must not replace
            // the original transfer error.
            let _ =
                tokio::time::timeout(Duration::from_secs(5), client.delete(&target, false)).await;
            Err(error)
        }
    }
}

async fn copy_stream(
    app: &AppHandle,
    manager: &TransferManager,
    item: &mut TransferItem,
    reader: &mut dyn FileReader,
    writer: &mut dyn FileWriter,
    token: &CancellationToken,
) -> Result<(), AppError> {
    let mut buffer = vec![0u8; CHUNK_SIZE];
    let started = Instant::now();
    let mut last_emit = Instant::now();

    loop {
        if token.is_cancelled() {
            return Err(cancelled());
        }
        let read = reader.read(&mut buffer).await?;
        if read == 0 {
            break;
        }

        let mut written = 0usize;
        while written < read {
            if token.is_cancelled() {
                return Err(cancelled());
            }
            let count = writer.write(&buffer[written..read]).await?;
            if count == 0 {
                return Err(AppError::new(
                    ErrorCode::Network,
                    "The target stopped accepting data.",
                ));
            }
            written += count;
        }

        item.transferred += written as f64;
        if last_emit.elapsed() >= PROGRESS_INTERVAL {
            update_progress(item, started);
            manager.publish(app, item);
            last_emit = Instant::now();
        }
    }

    update_progress(item, started);
    manager.publish(app, item);
    Ok(())
}

fn update_progress(item: &mut TransferItem, started: Instant) {
    let elapsed = started.elapsed().as_secs_f64();
    let speed = if elapsed > 0.0 {
        item.transferred / elapsed
    } else {
        0.0
    };
    item.bytes_per_sec = speed;
    item.eta_ms = if speed > 0.0 && item.size > item.transferred {
        Some(((item.size - item.transferred) / speed) * 1000.0)
    } else {
        None
    };
}

fn cancelled() -> AppError {
    AppError::new(ErrorCode::Cancelled, "The transfer was cancelled.")
}

fn normalize_local_target(path: &str) -> Result<String, AppError> {
    let path = crate::fs::path::normalize_absolute(path)?;
    path.to_str()
        .map(str::to_string)
        .ok_or_else(|| AppError::invalid_input("The target path is not valid UTF-8."))
}

fn temp_download_path(target: &str, id: &str) -> String {
    let path = Path::new(target);
    let parent = path.parent().unwrap_or_else(|| Path::new("/"));
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("download");
    parent
        .join(format!(".{name}.sftply-part-{id}"))
        .to_string_lossy()
        .into_owned()
}

async fn replace_local_file(temp: &str, target: &str) -> Result<(), AppError> {
    if tokio::fs::try_exists(target).await.unwrap_or(false) {
        // Windows cannot rename over an existing file. Removing the target
        // first also matches the explicit overwrite policy.
        tokio::fs::remove_file(target).await.map_err(|error| {
            AppError::new(
                ErrorCode::PermissionDenied,
                "Could not replace the existing file.",
            )
            .with_detail(error.to_string())
        })?;
    }
    tokio::fs::rename(temp, target).await.map_err(|error| {
        AppError::new(
            ErrorCode::Internal,
            "Could not finalize the downloaded file.",
        )
        .with_detail(error.to_string())
    })
}

async fn unique_remote_target(
    client: &mut Box<dyn RemoteFs>,
    target: &str,
) -> Result<String, AppError> {
    let parent = remote_parent(target)?.unwrap_or_else(|| "/".to_string());
    let name = remote_leaf(target)?;
    for index in 1..=10_000 {
        let candidate = join_remote(&parent, &numbered_name(&name, index))?;
        if !remote_exists(client, &candidate).await? {
            return Ok(candidate);
        }
    }
    Err(AppError::new(
        ErrorCode::Conflict,
        "Could not find an available name for the target.",
    ))
}

async fn unique_local_target(target: &str) -> Result<String, AppError> {
    let path = Path::new(target);
    let parent = path.parent().unwrap_or_else(|| Path::new("/"));
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::invalid_input("The file name is not valid UTF-8."))?;
    for index in 1..=10_000 {
        let candidate = parent.join(numbered_name(name, index));
        if !tokio::fs::try_exists(&candidate).await.unwrap_or(false) {
            return candidate
                .to_str()
                .map(str::to_string)
                .ok_or_else(|| AppError::invalid_input("The path is not valid UTF-8."));
        }
    }
    Err(AppError::new(
        ErrorCode::Conflict,
        "Could not find an available name for the target.",
    ))
}

async fn remote_exists(client: &mut Box<dyn RemoteFs>, path: &str) -> Result<bool, AppError> {
    match client.stat(path).await {
        Ok(_) => Ok(true),
        Err(error) if error.code == ErrorCode::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

fn numbered_name(name: &str, index: u32) -> String {
    match name.rfind('.') {
        Some(dot) if dot > 0 => format!("{} ({index}){}", &name[..dot], &name[dot..]),
        _ => format!("{name} ({index})"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_names_without_losing_the_extension() {
        assert_eq!(numbered_name("report.pdf", 1), "report (1).pdf");
        assert_eq!(numbered_name("archive.tar.gz", 2), "archive.tar (2).gz");
        assert_eq!(numbered_name("README", 1), "README (1)");
        assert_eq!(numbered_name(".bashrc", 1), ".bashrc (1)");
    }

    #[test]
    fn builds_hidden_partial_files_next_to_the_target() {
        assert_eq!(
            temp_download_path("/tmp/report.pdf", "abc"),
            "/tmp/.report.pdf.sftply-part-abc"
        );
    }

    #[tokio::test]
    async fn local_readers_and_writers_stream_a_round_trip() {
        use crate::fs::local::{LocalReader, LocalWriter};

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("chunk.bin");
        let path_str = path.to_str().unwrap();

        let mut writer: Box<dyn FileWriter> =
            Box::new(LocalWriter::open(path_str, 0).await.unwrap());
        writer.write(b"hello ").await.unwrap();
        writer.write(b"world").await.unwrap();
        writer.finish().await.unwrap();

        let mut reader: Box<dyn FileReader> =
            Box::new(LocalReader::open(path_str, 0).await.unwrap());
        let mut buffer = [0u8; 5];
        assert_eq!(reader.read(&mut buffer).await.unwrap(), 5);
        assert_eq!(&buffer, b"hello");
        reader.finish().await.unwrap();

        // A non-zero offset resumes without truncating.
        let mut writer: Box<dyn FileWriter> =
            Box::new(LocalWriter::open(path_str, 6).await.unwrap());
        writer.write(b"there").await.unwrap();
        writer.finish().await.unwrap();
        assert_eq!(tokio::fs::read(&path).await.unwrap(), b"hello there");
    }

    #[tokio::test]
    async fn local_targets_are_numbered_until_available() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("report.txt");
        tokio::fs::write(&target, b"one").await.unwrap();
        tokio::fs::write(dir.path().join("report (1).txt"), b"two")
            .await
            .unwrap();

        let unique = unique_local_target(target.to_str().unwrap()).await.unwrap();
        assert_eq!(unique, dir.path().join("report (2).txt").to_str().unwrap());
    }

    #[test]
    fn computes_speed_and_eta() {
        let mut item = TransferItem::new(
            TransferDirection::Download,
            "/remote/a".into(),
            "/tmp/a".into(),
            "Remote".into(),
            "Local".into(),
            "a".into(),
            2048.0,
        );
        item.transferred = 1024.0;
        update_progress(&mut item, Instant::now());
        assert!(item.bytes_per_sec > 0.0);
        assert!(item.eta_ms.is_some());
    }
}
