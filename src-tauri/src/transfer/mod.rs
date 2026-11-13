use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tauri_specta::Event;
use tokio::sync::watch;
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
/// Most servers and filesystems cap a single name at 255 bytes. Partial and
/// backup names are kept below that limit even when the target name is at it.
const PARTIAL_NAME_MAX_BYTES: usize = 255;

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
    /// Current concurrency limit. Updated in place so tasks already waiting for
    /// a slot see the new value instead of holding a stale semaphore.
    concurrency: AtomicUsize,
    active: AtomicUsize,
    active_changed: watch::Sender<usize>,
    /// True while the queue is paused. Running transfers are allowed to finish;
    /// no new transfer starts until the queue is resumed.
    paused: watch::Sender<bool>,
    bandwidth: BandwidthLimiter,
    history: Arc<TransferHistoryStore>,
}

/// Global pacing for every transfer. The limit is shared, so concurrency does
/// not multiply the configured bandwidth. A zero rate means unlimited.
struct BandwidthLimiter {
    bytes_per_sec: AtomicU64,
    next_slot: Mutex<Instant>,
}

impl BandwidthLimiter {
    fn new(limit_kbps: Option<u32>) -> Self {
        Self {
            bytes_per_sec: AtomicU64::new(kbps_to_bytes_per_sec(limit_kbps)),
            next_slot: Mutex::new(Instant::now()),
        }
    }

    fn set_limit_kbps(&self, limit_kbps: Option<u32>) {
        self.bytes_per_sec
            .store(kbps_to_bytes_per_sec(limit_kbps), Ordering::Relaxed);
        // Forget any reservation made under the previous rate, so a faster
        // limit takes effect immediately instead of after a stale long wait.
        *self.next_slot.lock().expect("bandwidth lock poisoned") = Instant::now();
    }

    /// Reserve capacity for `bytes` and return how long the caller must wait
    /// before the next chunk. Reserving before sleeping keeps concurrent
    /// transfers from each consuming the full limit.
    fn reserve(&self, bytes: usize) -> Duration {
        let rate = self.bytes_per_sec.load(Ordering::Relaxed);
        if rate == 0 || bytes == 0 {
            return Duration::ZERO;
        }

        let duration = Duration::from_secs_f64(bytes as f64 / rate as f64);
        let mut next = self.next_slot.lock().expect("bandwidth lock poisoned");
        let now = Instant::now();
        let start = (*next).max(now);
        *next = start + duration;
        start.saturating_duration_since(now)
    }

    async fn wait(&self, wait: Duration, token: &CancellationToken) -> Result<(), AppError> {
        if wait.is_zero() {
            return Ok(());
        }
        tokio::select! {
            _ = token.cancelled() => Err(cancelled()),
            _ = tokio::time::sleep(wait) => Ok(()),
        }
    }
}

fn kbps_to_bytes_per_sec(limit_kbps: Option<u32>) -> u64 {
    limit_kbps.map_or(0, |kbps| u64::from(kbps) * 125)
}

/// Releases the concurrency slot when the transfer task ends, however it ends.
struct SlotGuard<'a> {
    manager: &'a TransferManager,
}

impl Drop for SlotGuard<'_> {
    fn drop(&mut self) {
        self.manager.release_slot();
    }
}

impl TransferManager {
    pub fn new(
        concurrency: usize,
        bandwidth_limit_kbps: Option<u32>,
        history: Arc<TransferHistoryStore>,
    ) -> Self {
        let (paused, _) = watch::channel(false);
        let (active_changed, _) = watch::channel(0usize);
        Self {
            items: RwLock::new(HashMap::new()),
            tasks: Mutex::new(HashMap::new()),
            jobs: Mutex::new(HashMap::new()),
            concurrency: AtomicUsize::new(concurrency.clamp(1, 8)),
            active: AtomicUsize::new(0),
            active_changed,
            paused,
            bandwidth: BandwidthLimiter::new(bandwidth_limit_kbps),
            history,
        }
    }

    /// Change the limit in place. Running transfers are not interrupted, and
    /// tasks already waiting for a slot re-check the new value.
    pub fn set_concurrency(&self, concurrency: usize) {
        self.concurrency
            .store(concurrency.clamp(1, 8), Ordering::Relaxed);
        self.active_changed
            .send_replace(self.active.load(Ordering::Relaxed));
    }

    pub fn set_bandwidth_limit_kbps(&self, limit_kbps: Option<u32>) {
        self.bandwidth.set_limit_kbps(limit_kbps);
    }

    fn try_acquire_slot(&self) -> bool {
        let limit = self.concurrency.load(Ordering::Relaxed);
        let mut active = self.active.load(Ordering::Relaxed);
        loop {
            if active >= limit {
                return false;
            }
            match self.active.compare_exchange_weak(
                active,
                active + 1,
                Ordering::AcqRel,
                Ordering::Relaxed,
            ) {
                Ok(_) => {
                    self.active_changed.send_replace(active + 1);
                    return true;
                }
                Err(current) => active = current,
            }
        }
    }

    fn release_slot(&self) {
        let previous = self.active.fetch_sub(1, Ordering::AcqRel);
        debug_assert!(previous > 0, "released a transfer slot that was not held");
        self.active_changed.send_replace(previous.saturating_sub(1));
    }

    /// Wait for a concurrency slot, honouring queue pauses and cancellation.
    async fn acquire_slot(
        &self,
        token: &CancellationToken,
        paused: &mut watch::Receiver<bool>,
    ) -> Result<SlotGuard<'_>, AppError> {
        let mut active_changed = self.active_changed.subscribe();
        loop {
            while *paused.borrow() {
                tokio::select! {
                    biased;
                    _ = token.cancelled() => return Err(cancelled()),
                    changed = paused.changed() => {
                        if changed.is_err() {
                            break;
                        }
                    }
                }
            }

            if self.try_acquire_slot() {
                // A pause can arrive while this task was waiting for a slot.
                // Give it back instead of starting work after the pause.
                if !self.is_paused() {
                    return Ok(SlotGuard { manager: self });
                }
                self.release_slot();
                continue;
            }

            tokio::select! {
                biased;
                _ = token.cancelled() => return Err(cancelled()),
                _ = active_changed.changed() => {}
                _ = paused.changed() => {}
            }
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

/// Start a transfer task. The task waits for a concurrency slot, opens its own
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

    tokio::spawn(async move {
        let mut paused = manager.paused.subscribe();
        let slot = match manager.acquire_slot(&token, &mut paused).await {
            Ok(slot) => slot,
            Err(_) => {
                finish_cancelled(&app, &manager, &mut job.item);
                manager.finish_task(&job.item.id);
                return;
            }
        };

        let mut item = job.item.clone();
        item.status = TransferStatus::Running;
        manager.publish(&app, &item);

        let outcome = run_job(&app, &manager, &mut item, &job, &token).await;
        drop(slot);

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

    if let Err(error) = copy_stream(app, manager, item, &mut *reader, &mut *writer, token).await {
        let _ = writer.abort().await;
        remove_local_temp(&temp).await;
        return Err(error);
    }
    if let Err(error) = reader.finish().await {
        let _ = writer.abort().await;
        remove_local_temp(&temp).await;
        return Err(error);
    }
    if let Err(error) = writer.finish().await {
        remove_local_temp(&temp).await;
        return Err(error);
    }

    // If finalization fails, keep the completed partial file: it is the only
    // copy of the downloaded bytes and the destination may already be gone on
    // platforms that cannot rename over an existing file.
    if let Err(error) = replace_local_file(&temp, &target).await {
        tracing::warn!("kept a completed download after finalization failed");
        return Err(error);
    }
    Ok(())
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

    let parent = remote_parent(&target)?.unwrap_or_else(|| "/".to_string());
    ensure_remote_dir(client, &parent).await?;

    // Upload to a hidden sibling and rename it into place on success, so a
    // failed or cancelled upload never truncates an existing file. Servers
    // without rename fall back to writing the target directly.
    let atomic = client.capabilities().rename;
    let upload_path = if atomic {
        temp_remote_path(&target, &item.id, "part")?
    } else {
        target.clone()
    };

    let mut reader: Box<dyn FileReader> = Box::new(LocalReader::open(&item.source_path, 0).await?);
    let mut writer = client.open_write(&upload_path, 0).await?;

    if let Err(error) = copy_stream(app, manager, item, &mut *reader, &mut *writer, token).await {
        let _ = writer.abort().await;
        cleanup_remote_upload(client, &upload_path).await;
        return Err(error);
    }
    if let Err(error) = reader.finish().await {
        let _ = writer.abort().await;
        cleanup_remote_upload(client, &upload_path).await;
        return Err(error);
    }
    if let Err(error) = writer.finish().await {
        cleanup_remote_upload(client, &upload_path).await;
        return Err(error);
    }

    if atomic
        && let Err(error) =
            replace_remote_file(client, &upload_path, &target, &item.id, policy).await
    {
        cleanup_remote_upload(client, &upload_path).await;
        return Err(error);
    }
    Ok(())
}

/// Best-effort removal of a partial or backup upload. A failure here must not
/// replace the original transfer error.
async fn cleanup_remote_upload(client: &mut Box<dyn RemoteFs>, path: &str) {
    let _ = tokio::time::timeout(Duration::from_secs(5), client.delete(path, false)).await;
}

/// Put a finished upload in place. Servers that refuse to rename over an
/// existing file get a backup-and-restore sequence, so a failed finalization
/// cannot destroy the previous version.
pub(crate) async fn replace_remote_file(
    client: &mut Box<dyn RemoteFs>,
    temp: &str,
    target: &str,
    id: &str,
    policy: ConflictPolicy,
) -> Result<(), AppError> {
    let final_name = remote_leaf(target)?;
    let rename_error = match client.rename(temp, &final_name).await {
        Ok(_) => return Ok(()),
        Err(error) => error,
    };
    if policy != ConflictPolicy::Overwrite {
        return Err(rename_error);
    }

    match client.stat(target).await {
        Ok(entry) if entry.kind == EntryKind::File => {}
        Ok(_) => return Err(rename_error),
        Err(error) if error.code == ErrorCode::NotFound => return Err(rename_error),
        Err(error) => return Err(error),
    }

    let backup = temp_remote_path(target, id, "backup")?;
    let backup_name = remote_leaf(&backup)?;
    client.rename(target, &backup_name).await?;
    match client.rename(temp, &final_name).await {
        Ok(_) => {
            let _ =
                tokio::time::timeout(Duration::from_secs(5), client.delete(&backup, false)).await;
            Ok(())
        }
        Err(error) => {
            // Restore the previous version. The caller discards the finished
            // upload; the local source is still intact, so retry is the
            // recovery path instead of leaving a hidden orphan behind.
            let _ = client.rename(&backup, &final_name).await;
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
        // Reserve bandwidth before sleeping, and publish progress first so a
        // slow limit does not leave the row frozen for the whole wait.
        let wait = manager.bandwidth.reserve(written);
        if wait >= PROGRESS_INTERVAL || last_emit.elapsed() >= PROGRESS_INTERVAL {
            update_progress(item, started);
            manager.publish(app, item);
            last_emit = Instant::now();
        }
        manager.bandwidth.wait(wait, token).await?;
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
        .join(hidden_partial_name(name, "part", id))
        .to_string_lossy()
        .into_owned()
}

/// Hidden sibling used for an atomic upload or its rollback backup.
fn temp_remote_path(target: &str, id: &str, kind: &str) -> Result<String, AppError> {
    let parent = remote_parent(target)?.unwrap_or_else(|| "/".to_string());
    let name = remote_leaf(target)?;
    join_remote(&parent, &hidden_partial_name(&name, kind, id))
}

/// Build a hidden partial name without exceeding the common 255-byte limit.
/// The readable prefix is truncated on a character boundary, never mid-UTF-8.
fn hidden_partial_name(name: &str, kind: &str, id: &str) -> String {
    let suffix = format!(".sftply-{kind}-{id}");
    let budget = PARTIAL_NAME_MAX_BYTES.saturating_sub(1 + suffix.len());
    let name = if name.is_empty() { "file" } else { name };
    format!(".{}{suffix}", truncate_utf8(name, budget))
}

fn truncate_utf8(value: &str, max_bytes: usize) -> &str {
    if value.len() <= max_bytes {
        return value;
    }
    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

async fn remove_local_temp(path: &str) {
    if let Err(error) = tokio::fs::remove_file(path).await
        && error.kind() != std::io::ErrorKind::NotFound
    {
        tracing::warn!(%error, "could not remove a partial download");
    }
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

    #[test]
    fn bounds_partial_names_without_splitting_utf8() {
        assert_eq!(
            hidden_partial_name("report.pdf", "part", "abc"),
            ".report.pdf.sftply-part-abc"
        );

        // 200 two-byte characters exceed the 255-byte name budget.
        let long = "é".repeat(200);
        let name = hidden_partial_name(&long, "part", "abc");
        assert!(name.len() <= PARTIAL_NAME_MAX_BYTES, "{}", name.len());
        assert!(name.starts_with('.'));
        assert!(name.ends_with(".sftply-part-abc"));
    }

    #[test]
    fn builds_remote_partial_and_backup_paths_in_the_target_folder() {
        assert_eq!(
            temp_remote_path("/docs/report.pdf", "abc", "part").unwrap(),
            "/docs/.report.pdf.sftply-part-abc"
        );
        assert_eq!(
            temp_remote_path("/report.pdf", "abc", "backup").unwrap(),
            "/.report.pdf.sftply-backup-abc"
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

    #[test]
    fn converts_kilobits_to_bytes() {
        assert_eq!(kbps_to_bytes_per_sec(None), 0);
        assert_eq!(kbps_to_bytes_per_sec(Some(16)), 2_000);
        assert_eq!(kbps_to_bytes_per_sec(Some(8_000)), 1_000_000);
    }

    #[test]
    fn bandwidth_limiter_spaces_chunks_and_resets() {
        let limiter = BandwidthLimiter::new(Some(16));
        assert!(limiter.reserve(0).is_zero());
        assert!(limiter.reserve(2_000).is_zero());

        // The second 2,000-byte chunk has to wait for the next one-second slot.
        let wait = limiter.reserve(2_000);
        assert!(
            wait >= Duration::from_millis(900),
            "unexpected wait {wait:?}"
        );

        limiter.set_limit_kbps(None);
        assert!(limiter.reserve(2_000).is_zero());
    }

    fn manager_with_concurrency(limit: usize) -> TransferManager {
        let dir = tempfile::tempdir().unwrap();
        let (history, warning) = TransferHistoryStore::load(dir.path().join("history.jsonl"));
        assert!(warning.is_none());
        TransferManager::new(limit, None, Arc::new(history))
    }

    #[test]
    fn concurrency_limit_can_grow_while_tasks_wait() {
        let manager = manager_with_concurrency(1);
        assert!(manager.try_acquire_slot());
        assert!(!manager.try_acquire_slot());

        manager.set_concurrency(2);
        assert!(manager.try_acquire_slot());
        assert!(!manager.try_acquire_slot());

        manager.release_slot();
        manager.release_slot();
        assert_eq!(manager.active.load(Ordering::Relaxed), 0);
    }

    use crate::domain::fs::FsEntry;
    use async_trait::async_trait;

    #[derive(Default)]
    struct RenameState {
        files: HashMap<String, Vec<u8>>,
        calls: Vec<String>,
        fail_final_rename: bool,
        target_renames: usize,
    }

    struct RenameMock {
        state: Arc<Mutex<RenameState>>,
    }

    fn mock_entry(path: &str, size: usize) -> FsEntry {
        FsEntry {
            name: remote_leaf(path).unwrap_or_else(|_| path.to_string()),
            path: path.to_string(),
            kind: EntryKind::File,
            size: size as f64,
            modified_at: None,
            permissions: None,
            owner: None,
            group: None,
            link_target: None,
            hidden: false,
            metadata_complete: true,
        }
    }

    fn mock_client(
        files: &[(&str, &[u8])],
        fail_final_rename: bool,
    ) -> (RenameMock, Arc<Mutex<RenameState>>) {
        let mut state = RenameState {
            fail_final_rename,
            ..Default::default()
        };
        for (path, data) in files {
            state.files.insert((*path).to_string(), data.to_vec());
        }
        let state = Arc::new(Mutex::new(state));
        (
            RenameMock {
                state: state.clone(),
            },
            state,
        )
    }

    #[async_trait]
    impl RemoteFs for RenameMock {
        async fn list(&mut self, _path: &str) -> Result<crate::domain::fs::Listing, AppError> {
            unimplemented!("not used by these tests")
        }

        async fn stat(&mut self, path: &str) -> Result<FsEntry, AppError> {
            let state = self.state.lock().expect("mock lock poisoned");
            state
                .files
                .get(path)
                .map(|data| mock_entry(path, data.len()))
                .ok_or_else(|| AppError::new(ErrorCode::NotFound, "That item does not exist."))
        }

        async fn mkdir(&mut self, _parent: &str, _name: &str) -> Result<FsEntry, AppError> {
            unimplemented!("not used by these tests")
        }

        async fn rename(&mut self, path: &str, new_name: &str) -> Result<FsEntry, AppError> {
            let parent = remote_parent(path)?.unwrap_or_else(|| "/".to_string());
            let target = join_remote(&parent, new_name)?;
            let mut state = self.state.lock().expect("mock lock poisoned");
            state.calls.push(format!("rename {path} -> {target}"));
            if target == path {
                return state
                    .files
                    .get(path)
                    .map(|data| mock_entry(path, data.len()))
                    .ok_or_else(|| {
                        AppError::new(ErrorCode::NotFound, "That item does not exist.")
                    });
            }
            if target == "/dir/target.txt" {
                state.target_renames += 1;
                if state.fail_final_rename && state.target_renames == 2 {
                    return Err(AppError::new(
                        ErrorCode::Protocol,
                        "The final rename failed.",
                    ));
                }
            }
            let Some(data) = state.files.remove(path) else {
                return Err(AppError::new(
                    ErrorCode::NotFound,
                    "That item does not exist.",
                ));
            };
            if state.files.contains_key(&target) {
                state.files.insert(path.to_string(), data);
                return Err(AppError::new(ErrorCode::Protocol, "The target exists."));
            }
            let size = data.len();
            state.files.insert(target.clone(), data);
            Ok(mock_entry(&target, size))
        }

        async fn delete(&mut self, path: &str, _recursive: bool) -> Result<(), AppError> {
            let mut state = self.state.lock().expect("mock lock poisoned");
            state.calls.push(format!("delete {path}"));
            state
                .files
                .remove(path)
                .map(|_| ())
                .ok_or_else(|| AppError::new(ErrorCode::NotFound, "That item does not exist."))
        }

        async fn chmod(&mut self, _path: &str, _mode: u32) -> Result<(), AppError> {
            unimplemented!("not used by these tests")
        }

        async fn open_read(
            &mut self,
            _path: &str,
            _offset: u64,
        ) -> Result<Box<dyn FileReader>, AppError> {
            unimplemented!("not used by these tests")
        }

        async fn open_write(
            &mut self,
            _path: &str,
            _offset: u64,
        ) -> Result<Box<dyn FileWriter>, AppError> {
            unimplemented!("not used by these tests")
        }

        async fn disconnect(&mut self) -> Result<(), AppError> {
            Ok(())
        }

        fn capabilities(&self) -> crate::domain::fs::FsCapabilities {
            crate::domain::fs::FsCapabilities::local()
        }
    }

    #[tokio::test]
    async fn atomic_upload_replaces_the_previous_file() {
        let temp = "/dir/.target.txt.sftply-part-abc";
        let (mock, state) = mock_client(&[("/dir/target.txt", b"old"), (temp, b"new")], false);
        let mut client: Box<dyn RemoteFs> = Box::new(mock);

        replace_remote_file(
            &mut client,
            temp,
            "/dir/target.txt",
            "abc",
            ConflictPolicy::Overwrite,
        )
        .await
        .expect("replace the existing file");

        let state = state.lock().expect("mock lock poisoned");
        assert_eq!(
            state.files.get("/dir/target.txt").map(Vec::as_slice),
            Some(&b"new"[..])
        );
        assert!(!state.files.contains_key(temp));
        assert!(
            !state
                .files
                .contains_key("/dir/.target.txt.sftply-backup-abc")
        );
        assert!(
            state
                .calls
                .iter()
                .any(|call| call.starts_with("delete /dir/.target.txt.sftply-backup-abc"))
        );
    }

    #[tokio::test]
    async fn atomic_upload_restores_the_previous_file_when_the_final_rename_fails() {
        let temp = "/dir/.target.txt.sftply-part-abc";
        let (mock, state) = mock_client(&[("/dir/target.txt", b"old"), (temp, b"new")], true);
        let mut client: Box<dyn RemoteFs> = Box::new(mock);

        let error = replace_remote_file(
            &mut client,
            temp,
            "/dir/target.txt",
            "abc",
            ConflictPolicy::Overwrite,
        )
        .await
        .expect_err("the final rename must fail");

        assert_eq!(error.code, ErrorCode::Protocol);
        let state = state.lock().expect("mock lock poisoned");
        assert_eq!(
            state.files.get("/dir/target.txt").map(Vec::as_slice),
            Some(&b"old"[..])
        );
        assert_eq!(state.files.get(temp).map(Vec::as_slice), Some(&b"new"[..]));
        assert!(
            !state
                .files
                .contains_key("/dir/.target.txt.sftply-backup-abc")
        );
    }
}
