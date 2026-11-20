# sftply: Architecture

**Status:** Implemented. This document describes the current architecture.
**Date:** 2026-11-05  
**Scope:** Architecture, module boundaries, contracts, security model, and design system for a production FTP/FTPS/SFTP desktop client.

## 1. Starting point

This section originally recorded the repository on 2026-11-05: an unmodified Tauri 2
starter template with a single `greet` command, no tests and no CI. That baseline is
gone. `docs/PROGRESS.md` is a historical log through 1.0.0, and `docs/ROADMAP.md`
tracks what comes next. The decisions below remain the reference for the
architecture.

## 2. Product principles and non-goals

### Principles

1. **Reliability before feature count.** A transfer that reports success has completed and been finalized. A capability that is not supported is disabled and explained, never simulated.
2. **Desktop-native speed.** The UI never blocks on network or disk. Directory lists remain responsive at 10,000+ entries.
3. **Keyboard-first, pointer-friendly.** Every action is reachable by keyboard; the command palette is the canonical command surface.
4. **Calm, dense interface.** One accent color, hairline separators, no decorative gradients, no oversized empty states.
5. **Security by construction.** Secrets live only in the OS keychain and in Rust memory for the shortest possible time. Unknown SSH hosts are never trusted implicitly.
6. **Unified filesystem contract.** Local, FTP, FTPS and SFTP are interchangeable through one typed API, with explicit per-protocol capabilities.

### Non-goals for the first release

- Cloud storage backends (S3, WebDAV, SMB).
- Terminal/SSH shell, port forwarding, or a general SSH client.
- A general-purpose text editor or media player.
- Automatic background sync daemons.
- Telemetry or cloud accounts.
- Mobile targets.

These are not architectural blockers; the protocol and filesystem boundaries allow them later.

## 3. System context

```text
┌──────────────────────────────────────────────────────────────────┐
│ Tauri window (WebView)                                           │
│  React 19 + TypeScript + Tailwind + shadcn/ui                    │
│  ┌────────────┐ ┌───────────────┐ ┌───────────────────────────┐  │
│  │ App shell  │ │ File browser  │ │ Transfers / Activity      │  │
│  └────────────┘ └───────────────┘ └───────────────────────────┘  │
│         │ typed IPC via tauri-specta (commands + events)        │
├─────────┼────────────────────────────────────────────────────────┤
│ Rust    ▼                                                        │
│  commands (thin adapters, validation)                            │
│      │                                                           │
│  application services (connection, browser, transfer, settings)  │
│      │                    │                    │                 │
│  protocol layer      local filesystem     credentials/config     │
│  ├─ FTP/FTPS         ├─ tokio::fs         ├─ OS keychain         │
│  └─ SFTP             └─ path safety       └─ atomic JSON         │
│      │                                                           │
│  session actors + transfer worker pool + event bus               │
└──────┼───────────────────────────────────────────────────────────┘
       ▼
  Remote servers (FTP 21, FTPS 21/990, SFTP 22)
```

### Process and threading model

- One Tauri process. The Rust side runs on Tokio's multi-thread runtime.
- Each remote session owns a dedicated actor task. Protocol clients (especially FTP control streams) are **not** shared behind a `Mutex`; commands are messages to the actor.
- Transfers run on independent tasks, bounded by a configurable semaphore. FTP transfers open their own control + data connections; SFTP transfers open additional channels on the SSH session.
- All blocking work (recursive local scans, key parsing, filesystem metadata walks) is dispatched with `spawn_blocking` or uses async I/O. Nothing blocking runs on the UI thread.
- Progress events are coalesced by the backend (target: 4–10 updates/second per transfer, batched across transfers) to avoid WebView IPC saturation.

## 4. Layering and module boundaries

### Rust backend

```text
src-tauri/src/
  main.rs                     # binary entry point only
  lib.rs                      # composition root: state, plugins, handlers
  app_state.rs                # AppState wiring (no business logic)
  error.rs                    # AppError, error codes, redaction-safe Display

  commands/                   # Tauri adapters only
    mod.rs
    app.rs                    # app_info, open_logs
    settings.rs
    connections.rs
    credentials.rs
    connection.rs             # test/open/close, host-key trust
    fs.rs                     # list/stat/mkdir/rename/delete/chmod
    transfers.rs
    security.rs

  services/                   # application use-cases
    connection_service.rs
    browser_service.rs
    transfer_service.rs
    credential_service.rs
    settings_service.rs
    connection_repository.rs

  domain/                     # pure types and rules, no Tauri, no I/O
    entry.rs                  # FsEntry, EntryKind, Listing
    capabilities.rs           # FsCapabilities
    connection.rs             # ConnectionProfile, auth descriptors (no secrets)
    transfer.rs               # TransferJob/Item, states, conflict policy
    session.rs                # SessionState, SessionInfo
    error.rs                  # domain errors

  protocol/                   # unified remote filesystem implementations
    mod.rs                    # RemoteFs trait, RemoteFactory, capability matrix
    ftp/
      mod.rs                  # FtpRemote
      client.rs               # suppaftp adapter (control connection)
      listing.rs              # MLSD + LIST fallback parser
      tls.rs                  # explicit/implicit FTPS, certificate policy
    sftp/
      mod.rs                  # SftpRemote
      client.rs               # russh + russh-sftp adapter
      auth.rs                 # password/publickey, passphrase, key formats
      known_hosts.rs          # app-managed known_hosts (strict TOFU)

  fs/
    mod.rs                    # FileSystem trait, stream handle traits
    local.rs                  # tokio::fs implementation
    remote_path.rs            # validated POSIX remote path
    local_path.rs             # canonicalization + traversal checks
    sanitize.rs               # cross-platform filename rules
    capabilities.rs

  session/
    registry.rs               # sessionId → SessionHandle, lifecycle
    actor.rs                  # command mailbox + oneshot replies
    state.rs                  # authoritative session state machine

  transfer/
    manager.rs                # queue, concurrency, pause/cancel/retry
    queue.rs                  # scheduling policy and limits
    worker.rs                 # copy loop, finalization, conflict handling
    handles.rs                # counting reader/writer + finalize semantics
    limiter.rs                # global token-bucket bandwidth limit
    history.rs                # bounded JSONL persistence

  credentials/
    mod.rs                    # CredentialService (never returns secrets to UI)
    keyring_store.rs          # keyring 4, service naming, error mapping

  config/
    paths.rs                  # app data/config/log directories
    store.rs                  # versioned JSON repositories
    atomic.rs                 # temp file + fsync + rename
    migrations.rs

  events/
    bus.rs                    # typed domain events
    tauri_sink.rs             # Tauri emitter adapter (testable boundary)

  logging/
    mod.rs                    # tracing subscriber, rolling file appender
    redact.rs                 # secret-safe field filtering and Debug impls
```

**Dependency direction:** `commands → services → domain / protocol / fs / session / transfer / credentials / config`. `domain` depends on nothing infrastructure-specific. Only `commands` and `events/tauri_sink.rs` import `tauri`. This keeps the core testable without a running WebView.

### Frontend

```text
src/
  main.tsx
  app/
    App.tsx                   # layout composition only
    providers.tsx             # QueryClient, theme, error boundary, event bridge
    error-boundary.tsx

  components/
    ui/                       # shadcn-generated primitives (owned, not a black box)
    layout/
      title-bar.tsx
      sidebar/
      workspace/
      bottom-panel/
      status-bar/
      resize-handle.tsx
      pane-split.tsx

  features/
    connections/
      api.ts                  # typed IPC calls
      schemas.ts              # Zod schemas (form + import validation)
      components/             # form, list, folders, menus
      hooks/
    browser/
      api.ts
      components/             # pane, breadcrumbs, toolbar, file-table, rows
      model/                  # selection reducer, sort, columns, path utils
      hooks/
    transfers/
      api.ts
      store.ts                # event-driven projection
      components/
    command-palette/
      registry.ts             # commands, scopes, shortcuts
      components/
    security/
      components/             # host-key dialog, certificate details
    settings/
      components/
    editor/                   # Phase 6
    sync/                     # Phase 6

  lib/
    ipc/
      bindings.ts             # GENERATED by tauri-specta; do not edit
      client.ts               # invoke wrapper, error normalization
      events.ts               # typed event subscription lifecycle
    format/                   # bytes, dates, permissions, paths
    hotkeys/                  # scope-aware keybinding manager
    platform.ts
    utils.ts

  stores/
    ui-store.ts               # layout, active pane, theme, density
    tabs-store.ts             # tabs, per-tab paths, active tab
    settings-store.ts         # persisted user settings mirror
    dialog-store.ts           # one active modal discriminated union

  styles/
    globals.css               # tokens, base, scrollbars, focus rings
```

**Rules**

- Components never call `invoke` directly; they call feature `api.ts` modules.
- Business rules (conflict policy, resumability, capability checks) live in Rust. The UI only renders capabilities and asks for actions.
- TanStack Query owns server state (directory listings, connection test results). Zustand owns client state (layout, selection, tabs, transfer event projection). No duplication of listing data into Zustand.
- React Hook Form + Zod validate all user input at the edge; Rust re-validates everything. Never trust the frontend.

## 5. Unified filesystem contract

Both local and remote panes use one conceptual model. The frontend does not know whether a path is SFTP or FTP; it reads `capabilities` and `kind`.

### Core DTOs (generated into TypeScript)

```rust
#[derive(Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub path: String,                 // absolute local path or POSIX remote path
    pub kind: EntryKind,              // File | Directory | Symlink | Other
    pub size: u64,                    // 0 for directories unless known
    pub modified_at: Option<i64>,     // Unix milliseconds, UTC
    pub permissions: Option<u32>,     // Unix mode bits, e.g. 0o644
    pub owner: Option<String>,
    pub group: Option<String>,
    pub link_target: Option<String>,
    pub hidden: bool,
    pub metadata_complete: bool,      // false when the protocol could not supply it
}

#[derive(Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub path: String,
    pub entries: Vec<FsEntry>,
    pub capabilities: FsCapabilities,
    pub read_at: i64,
    pub warnings: Vec<String>,        // e.g. LIST parse fallback, unreadable children
}

#[derive(Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FsCapabilities {
    pub list: bool,
    pub mkdir: bool,
    pub remove: bool,
    pub rename: bool,
    pub chmod: bool,
    pub chown: bool,
    pub symlinks: bool,
    pub unix_permissions: bool,
    pub detailed_listing: bool,       // MLSD or SFTP attributes
    pub resume_download: ResumeSupport,
    pub resume_upload: ResumeSupport,
    pub server_side_move: bool,
    pub server_side_copy: bool,
    pub text_read: bool,
    pub text_write: bool,
}

#[derive(Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ResumeSupport {
    Supported,
    Conditional,   // depends on server feature negotiated at connect time
    Unsupported,
}
```

### FileSystem trait

```rust
#[async_trait::async_trait]
pub trait FileSystem: Send + Sync {
    fn kind(&self) -> FsKind;
    fn capabilities(&self) -> FsCapabilities;

    async fn list(&self, path: &RemotePath) -> Result<Listing, FsError>;
    async fn stat(&self, path: &RemotePath) -> Result<FsEntry, FsError>;
    async fn mkdir(&self, path: &RemotePath) -> Result<(), FsError>;
    async fn remove(&self, path: &RemotePath, kind: EntryKind) -> Result<(), FsError>;
    async fn rename(&self, from: &RemotePath, to: &RemotePath) -> Result<(), FsError>;
    async fn chmod(&self, path: &RemotePath, mode: u32) -> Result<(), FsError>;

    async fn open_read(&self, path: &RemotePath, offset: u64)
        -> Result<Box<dyn FileReader>, FsError>;
    async fn open_write(&self, path: &RemotePath, offset: u64, mode: WriteMode)
        -> Result<Box<dyn FileWriter>, FsError>;
}
```

`FileReader` and `FileWriter` exist instead of raw `AsyncRead`/`AsyncWrite` because FTP data transfers require an explicit finalization step (`finish()` or `abort()`), and SFTP handles must be closed deterministically:

```rust
#[async_trait::async_trait]
pub trait FileReader: Send {
    async fn read(&mut self, buf: &mut [u8]) -> Result<usize, FsError>;
    async fn finish(self: Box<Self>) -> Result<(), FsError>;
}

#[async_trait::async_trait]
pub trait FileWriter: Send {
    async fn write(&mut self, buf: &[u8]) -> Result<usize, FsError>;
    async fn finish(self: Box<Self>) -> Result<(), FsError>;
    async fn abort(self: Box<Self>) -> Result<(), FsError>;
}
```

The local implementation wraps `tokio::fs::File`. The FTP implementation wraps suppaftp `TransferStream` and calls `finish()` so that the server's final reply is checked. The SFTP implementation wraps a russh-sftp file handle. A transfer row is never marked complete before `finish()` succeeds.

### Path rules

- `RemotePath` is a validated absolute POSIX path; duplicate slashes normalized, `.` removed, `..` resolved lexically but never above `/`.
- Joining a server-provided entry name rejects names containing `/`, `\0`, `.` or `..`. A malformed server listing cannot escape the current directory.
- Local operations canonicalize the parent and enforce the resulting path stays within the user-selected destination. Recursive download sanitizes each name for the host OS (reserved Windows names, trailing dots/spaces, path separators, length limits, Unicode normalization).
- Recursion does not follow directory symlinks by default. Cycles are additionally guarded by visited canonical paths.
- All chmod values are validated as `0o000..=0o7777`.

## 6. Session model

Each open remote connection behaves as a **session actor**:

```text
commands ──► SessionHandle (mpsc Sender)
                  │
                  ▼
            Session actor task ── owns protocol client
                  │
                  ├─ control operations (list/stat/mkdir/rename/delete/chmod)
                  ├─ connection state machine
                  └─ transfer connector factory
```

> **Implementation note:** the current code stores an `Arc<Session>` with a
> `tokio::sync::Mutex<Box<dyn RemoteFs>>`, a `CancellationToken` for the
> running operation, and the retained profile/credentials needed for
> reconnect. It provides the same serialization and lifecycle contract as the
> actor design above without a dedicated task per session.

### State machine

```text
Idle → Connecting → Authenticating → VerifyingHostKey ─┐
                          │                 │           │
                          │                 └─ AwaitingTrust ──► Ready
                          │                                    │
                          └──────────────► Failed ◄────────────┘
Ready → Busy (serialized control op) → Ready
Ready → Disconnecting → Disconnected
Ready → Reconnecting → … → Ready | Failed
```

- `session://state` events are authoritative. The UI never invents a connected state.
- Commands against a non-`Ready` session fail with `SESSION_NOT_READY` and the UI shows the actual state.
- Multiple tabs can hold independent sessions. One tab owns one session in the first release; shared-session tabs are a later optimization.
- Closing the last tab for a session disconnects it after pending operations finish or are cancelled explicitly.

### Host-key verification (SFTP)

1. Connect and perform key exchange.
2. Compare `(host, port, algorithm, key)` against the app-managed known_hosts file.
3. **Unknown host:** transition to `AwaitingTrust`, emit `session://host-key` with SHA-256 fingerprint and key type, and wait. The dialog offers **Trust and connect** or **Cancel**. Never auto-trust.
4. **Changed key:** hard fail. Emit a distinct `HostKeyMismatch` event with old/new fingerprints. The user must resolve it in Security settings (explicit removal/replacement), not by clicking through the normal connect flow.
5. Known and matching: continue to authentication and `Ready`.

Known hosts are stored under the app config directory in an OpenSSH-compatible `known_hosts` file. Hosts with non-default ports use `[host]:port`. The store is managed by our own module (strict matching, hashed-host support optional) because it is a small, security-critical component that must be auditable and testable.

### Connection lifecycle and secrets

- Saved connection profiles contain **no secrets**. Secrets are keyed as `connection/<uuid>/password`, `connection/<uuid>/key_passphrase`.
- `CredentialService` resolves secrets only inside the Rust process when opening a session or transfer connection. It never exposes a `get_secret` command.
- Quick Connect passes a transient auth input once; it is held in a zeroizing buffer (`zeroize`) and cleared on drop. It is not persisted unless the user checks "Save in Keychain".
- Session actors hold resolved credentials only while needed for reconnects/transfer connections; transfer workers get a scoped credential handle, not a global copy.
- If the OS keychain is unavailable (e.g. headless Linux), saving a password fails loudly with actionable guidance. There is no plaintext fallback.

## 7. IPC contract

Types are generated with `tauri-specta` from Rust, including commands and events. `src/lib/ipc/bindings.ts` is generated and checked in; CI fails if regeneration produces a diff.

- All DTOs use `camelCase` on the wire.
- All commands are `async` and return `Result<T, AppError>`.
- Error payloads have a stable code, user-safe message, optional technical detail, and a `retryable` flag. Secrets are never included.
- Commands validate session existence, state, path shape, and permissions; no generic "execute" command exists.

### Commands (initial surface)

| Area        | Command                                                             | Purpose                                                  |
| ----------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| App         | `app_info`                                                          | Version, platform, data/log paths                        |
| Settings    | `settings_get`, `settings_update`                                   | Versioned user settings                                  |
| Connections | `connections_list`, `connections_save`, `connections_delete`        | CRUD, no secrets                                         |
| Connections | `connections_duplicate`, `connections_reorder`                      | Organization                                             |
| Connections | `connections_import`, `connections_export`                          | Credential-free JSON                                     |
| Credentials | `credentials_set`, `credentials_delete`, `credentials_status`       | Keychain write/delete/status; never read                 |
| Connection  | `connection_test`                                                   | TCP + handshake + auth + initial path, transient secrets |
| Connection  | `connection_open`, `connection_close`                               | Spawn/stop session actor                                 |
| Connection  | `security_trust_host_key`                                           | Explicitly persist an unknown host key                   |
| Session     | `session_list`                                                      | Authoritative session snapshots                          |
| FS          | `fs_list`, `fs_stat`                                                | Unified local/remote listing                             |
| FS          | `fs_mkdir`, `fs_rename`, `fs_delete`                                | Mutations, capability-checked                            |
| FS          | `fs_chmod`                                                          | SFTP/Unix only; unavailable otherwise                    |
| FS          | `fs_read_text`, `fs_write_text`                                     | Phase 6 editor; size/encoding limits                     |
| Local       | `local_open`, `local_reveal`                                        | Open with OS handler / reveal in file manager            |
| Transfers   | `transfer_enqueue_upload`, `transfer_enqueue_download`              | File/folder jobs                                         |
| Transfers   | `transfer_pause`, `transfer_resume`, `transfer_cancel`              | Honest capability-checked control                        |
| Transfers   | `transfer_retry`, `transfer_cancel_all`, `transfer_clear_completed` | Queue control                                            |
| Transfers   | `transfer_list`, `transfer_history`                                 | Rehydration/history                                      |
| Security    | `known_hosts_list`, `known_hosts_remove`                            | Security settings                                        |

`fs_*` commands accept a scope discriminator:

```ts
type FsScope = { kind: "local" } | { kind: "remote"; sessionId: string }
```

The backend resolves the scope, validates the session, and never accepts a caller-supplied protocol or credential.

### Events

| Event                | Payload                                              | Frequency                 |
| -------------------- | ---------------------------------------------------- | ------------------------- |
| `session://state`    | `SessionSnapshot`                                    | On transition             |
| `session://host-key` | `HostKeyPrompt`                                      | On unknown/changed key    |
| `session://closed`   | `{ sessionId, reason? }`                             | On disconnect             |
| `transfer://delta`   | `{ upserts: TransferSnapshot[], removed: string[] }` | Batched, 4–10/s           |
| `transfer://queue`   | `{ concurrency, paused, totals }`                    | On structural change      |
| `fs://invalidate`    | `{ scopes: string[], paths: string[] }`              | After transfers/mutations |
| `activity://entry`   | Sanitized activity record                            | On notable operation      |

The frontend event bridge is mounted once in `providers.tsx`, unsubscribes on unmount, and updates the relevant Zustand store or Query cache. Components do not subscribe to raw Tauri events individually.

### Typed invocation wrapper

```ts
// lib/ipc/client.ts
export async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (raw) {
    throw normalizeAppError(raw)
  }
}
```

All feature APIs use this wrapper. Raw Tauri errors never reach components.

## 8. Transfer engine

### Data model

```text
TransferJob (folder or multi-selection group)
  ├─ TransferItem (file)
  ├─ TransferItem (file)
  └─ TransferItem (file)

TransferItem: id, jobId, direction, sourceScope, sourcePath, targetScope,
              targetPath, size, transferred, status, bytesPerSec,
              etaMs, attempt, error?, resumeOffset, canPause, canResume
```

Statuses: `queued`, `connecting`, `transferring`, `paused`, `completed`, `failed`, `cancelled`.

### Scheduling

- A global semaphore enforces configurable concurrency (default 3, range 1–8).
- Jobs are FIFO; folder jobs expand to file items as they are scheduled, preserving directory creation order.
- Per-connection fairness is a later refinement; the initial queue is global with one session's transfers naturally bounded.
- Queue pause stops scheduling new items but does not stop in-flight items unless the user chooses "Pause all". Individual pause is capability-gated.
- Bandwidth limiting uses a global token bucket checked before each 64 KiB chunk. Per-transfer limits can be added without changing the pipeline.

### Transfer pipeline

```text
open_read(source, offset)
   │
   ├─ counting reader ──► 64 KiB chunks ──► bandwidth limiter
   │                                         │
   └──────────────────────────────► open_write(target, offset, mode)
                                             │
                                   counting writer, flush
                                             │
                                         finish()
                                             │
                                    mark completed + invalidate panes
```

- Downloads write to a sibling temporary file (`.sftply-part-<id>`) and rename into place only after `finish()`. Cancellation/failure removes the partial file unless it is being kept for a supported resume.
- Uploads write directly to the target with the chosen overwrite policy. Atomic upload (temp + rename) is a later option where the protocol supports it reliably.
- Progress is computed from actual written bytes, not requested bytes. Speed uses an EWMA over ~2 seconds; ETA is `remaining / speed`, hidden when speed is zero.
- Completion is emitted only after protocol finalization. No optimistic "completed" state.
- On failure, a bounded technical detail (redacted) is attached; retry is explicit, with exponential backoff delay only for automatic reconnection of the session, not silent file retries.

### Resume and pause honesty

| Capability       | Local                       | FTP/FTPS                                                                        | SFTP                                                                     |
| ---------------- | --------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Resume download  | n/a                         | Only if `REST` is supported and verified; otherwise start over                  | Yes via seek on read handle when server supports it (v3 handle seek)     |
| Resume upload    | n/a                         | Conditional: only when the server reliably supports `REST`/`APPE`; never assume | Yes via seek/write offset when server allows                             |
| Pause            | n/a                         | Cancel-and-keep-partial when resumable; otherwise button disabled               | Pause between chunks while keeping the handle open, or cancel-and-resume |
| Server-side move | Local rename                | `RNFR`/`RNTO`                                                                   | `rename`                                                                 |
| Server-side copy | No (unless filesystem copy) | No standard; disabled                                                           | No standard SFTP v3 copy; disabled                                       |
| chmod            | Unix only                   | Disabled (SITE CHMOD not assumed)                                               | Yes                                                                      |
| Owner/group      | Unix metadata               | Only if MLSD provides it (display only)                                         | Yes (numeric IDs displayed)                                              |

The UI reads `FsCapabilities` and renders disabled controls with an explanation. It never shows a pause button that silently restarts a file.

### Conflicts

Before enqueuing a file whose target exists, the backend returns a conflict descriptor. The UI applies a policy: **Overwrite**, **Skip**, **Rename**, with **Apply to all**. Folder merges are explicit. No silent overwrite, ever. The policy is carried on the transfer item so retries remain deterministic.

### History

- In-session queue retains completed/failed/cancelled items until cleared.
- Persisted history is a bounded JSONL file (last 1,000 entries), containing no secrets and no full error dumps.
- "Clear completed" clears the in-session queue; history is cleared separately and explicitly.

## 9. Frontend architecture

### Shell layout

```text
┌──────────────────────────────────────────────────────────────────────┐
│ title bar: logo · tabs · command palette hint · window controls      │ 40px
├──────────────┬───────────────────────────────────────────────────────┤
│ sidebar      │ pane toolbar: breadcrumb · actions · filter · view    │ 40px
│ 248px        ├──────────────────────────┬────────────────────────────┤
│              │ LOCAL                    │ REMOTE · prod.example.com  │
│ quick        │ breadcrumb               │ breadcrumb                 │
│ connect      │ file table               │ file table                 │
│ saved        │                          │                            │
│ folders      │                          │                            │
│ favorites    │                          │                            │
│ recent       ├──────────────────────────┴────────────────────────────┤
│              │ bottom panel: Transfers · Activity                    │ 200px
├──────────────┴───────────────────────────────────────────────────────┤
│ status bar: connection · cipher · latency · queue · speed            │ 24px
└──────────────────────────────────────────────────────────────────────┘
```

- Sidebar and bottom panel are resizable; sizes persist.
- The pane split is resizable, with a minimum pane width of 360px.
- Window minimum 960×600; default 1440×900; last size/position restored.

### Visual language

- **Dark default, first-class light theme.** Tokens are defined in OKLCH CSS variables and mapped through Tailwind v4's `@theme`. Theme switch is instant and persisted; it follows the OS only when set to "System".
- **Surfaces:** near-black neutral base, 3 elevation levels separated by luminance, not shadows. Popovers/dialogs are the only elements with a shadow.
- **Accent:** a single iris/indigo accent. Local pane is neutral; remote pane gets a subtle accent-tinted header chip and a distinct protocol badge. Status colors are reserved for status, never decoration.
- **Typography:** self-hosted Inter Variable for UI; JetBrains Mono Variable for sizes, permissions, paths, and ETA. Base 13px, metadata 11.5–12px, row height 28px (compact) / 32px (comfortable).
- **Borders:** 1px `white/8%` hairlines; no boxes around every group; section separation by spacing and subtle surface shifts.
- **Radius:** 6px controls, 8px popovers, 10px dialogs. Never pill-shaped except status chips.
- **Motion:** 120–160ms ease-out for overlays, no layout animation on file lists, `prefers-reduced-motion` respected.
- **Icons:** Lucide at 14–16px, 1.5 stroke.

### Tokens (indicative)

```css
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

:root {
  --bg: oklch(0.985 0.002 260);
  --surface-1: oklch(1 0 0);
  --surface-2: oklch(0.965 0.003 260);
  --surface-3: oklch(0.94 0.004 260);
  --border: oklch(0.9 0.004 260);
  --text: oklch(0.23 0.01 260);
  --text-muted: oklch(0.52 0.012 260);
  --accent: oklch(0.55 0.19 275);
  --accent-fg: oklch(0.99 0.002 260);
  --success: oklch(0.62 0.15 155);
  --warning: oklch(0.72 0.15 75);
  --danger: oklch(0.6 0.2 25);
}

.dark {
  --bg: oklch(0.155 0.004 260);
  --surface-1: oklch(0.185 0.005 260);
  --surface-2: oklch(0.215 0.006 260);
  --surface-3: oklch(0.25 0.007 260);
  --border: oklch(0.3 0.006 260 / 0.7);
  --text: oklch(0.94 0.003 260);
  --text-muted: oklch(0.66 0.008 260);
  --accent: oklch(0.68 0.16 275);
  --accent-fg: oklch(0.99 0 0);
  --success: oklch(0.72 0.15 155);
  --warning: oklch(0.8 0.14 80);
  --danger: oklch(0.7 0.19 25);
}
```

### File table

- Columns: name, size, modified, permissions, owner (optional), kind (optional). Column visibility/density is persisted.
- Sorting is stable and locale-aware for names; directories first by default (toggleable). Sizes and dates sort numerically.
- Virtualized rows (`@tanstack/react-virtual`); only visible rows render.
- Multi-select: click, Cmd/Ctrl-click, Shift-click range, Cmd/Ctrl+A, Escape clears. Anchor/cursor state is explicit.
- Keyboard: arrows move cursor, Enter opens, Backspace navigates up, F2 rename, Delete/Backspace-with-modifier deletes (platform-aware), Space selects, type-ahead jumps.
- Filtering is a client-side case-insensitive substring/hide-hidden filter for the current listing, with a clear "filtered" indicator. Recursive search is a later backend feature.
- Loading: skeleton rows only on first load; subsequent navigation keeps previous data with a subtle stale indicator (`keepPreviousData`).
- Empty states distinguish: empty directory, filtered to nothing, not connected, permission denied, error with retry.

### Drag and drop

- Internal drag uses HTML5 DnD with a private MIME type carrying selected entries and source scope. Drop targets highlight only valid actions.
- Local → remote = upload; remote → local = download; same-scope = move; remote → remote = server-side move if capabilities allow, otherwise disabled with explanation.
- External OS drops are received through Tauri's drag-drop event and routed to the hovered pane. Dropping onto a directory row targets that directory.
- Modifier semantics: default move within a scope, copy with Option/Alt; across scopes the direction determines transfer. The drop overlay states the action in words.

### State ownership

| State                        | Owner                        | Reason                                   |
| ---------------------------- | ---------------------------- | ---------------------------------------- |
| Directory listings, stats    | TanStack Query               | Server-derived, cacheable, invalidatable |
| Session snapshots            | Zustand (event projection)   | Real-time, not request/response          |
| Transfers                    | Zustand (event projection)   | High-frequency batched updates           |
| Tabs, active tab, pane paths | Zustand + persisted settings | Client navigation state                  |
| Selection, cursor, filter    | Zustand per pane             | Keyboard behavior, not server state      |
| Forms                        | React Hook Form              | Local validation lifecycle               |
| Command palette query        | Component state              | Ephemeral                                |

Query key: `["fs", scopeKey, path]` where `scopeKey` is `"local"` or `"remote:<sessionId>"`. Window-focus refetch is disabled; mutations invalidate current and parent directory; transfer completion events invalidate affected directories (debounced 250ms). Optimistic updates are limited to rename (safe, reversible) and selection-independent UI; delete/create wait for backend success.

### Command palette

`cmdk`, opened with Cmd/Ctrl+K. Sections: Navigate, Connections, File actions, Transfers, View, Settings. Commands declare `when` predicates (e.g. requires connected session, requires selection, requires writable capability). Shortcut hints are rendered from a single registry so the palette, menus, and shortcut sheet never disagree.

### Keyboard map

The Settings → Shortcuts tab renders this same list, with Command labels on macOS and Ctrl labels elsewhere.

| Shortcut               | Action                                   |
| ---------------------- | ---------------------------------------- |
| Cmd/Ctrl+K             | Command palette                          |
| Cmd/Ctrl+,             | Open settings                            |
| ?                      | Open the keyboard shortcuts              |
| Cmd/Ctrl+J             | Toggle transfers and activity panel      |
| Cmd/Ctrl+1 / 2         | Focus local / remote pane                |
| Cmd/Ctrl+R             | Refresh the active pane                  |
| Cmd/Ctrl+F             | Filter the active folder                 |
| Cmd/Ctrl+L             | Edit the path                            |
| Cmd/Ctrl+[ / ]         | Go back / forward                        |
| Cmd/Ctrl+↑             | Go to the enclosing folder               |
| Cmd/Ctrl+Shift+N       | New folder                               |
| ↑ / ↓                  | Move the cursor                          |
| Shift+↑ / ↓            | Extend the selection                     |
| Home / End             | First / last item                        |
| Space                  | Select or deselect the active item       |
| Cmd/Ctrl+A             | Select all                               |
| Enter                  | Open folder or file                      |
| F2                     | Rename                                   |
| Cmd+Backspace / Delete | Delete the selection (macOS / elsewhere) |
| Backspace              | Go to the enclosing folder               |
| Escape                 | Close dialog/menu, clear the selection   |
| A–Z                    | Type-ahead                               |

A scope stack prevents shortcuts from firing inside text inputs or when a modal owns focus. Platform-aware labels use `⌘` vs `Ctrl`.

### Accessibility

- WCAG 2.2 AA contrast for text and controls in both themes.
- File table is a grid with `aria-rowcount`, `aria-colcount`, `aria-sort`, `aria-selected`, and roving tabindex.
- All icon buttons have accessible labels and tooltips; tooltips are not the only label.
- Dialogs use Radix focus trapping and return focus to the trigger.
- Status is conveyed by text + icon, not color alone.
- Reduced motion disables non-essential transitions.
- Context menus open with Shift+F10 / Menu key.

## 10. Persistence and configuration

App directories (Tauri path APIs):

```text
~/Library/Application Support/com.alevidals.sftply/     (macOS example)
  connections.json      # profiles, folders, favorites; no secrets
  settings.json         # UI + transfer preferences
  known_hosts           # SSH host keys (app-managed)
  transfer-history.jsonl
  window-state.json     # via tauri-plugin-window-state
  logs/sftply.log.*
```

- Every JSON write goes through `atomic.rs`: write sibling temp file, `sync_all`, rename, best-effort directory fsync. Windows rename-over-existing is handled explicitly.
- Each file has a `schemaVersion`; migrations run on load, write back only after success, and keep a `.bak` of the previous version.
- Unknown future versions are rejected with a clear error rather than silently discarding data.
- Import validates with serde + explicit bounds, generates new IDs, never imports secrets or private keys, and reports partial failures per connection.
- Export omits passwords, passphrases, key material, and local absolute paths that are not needed for the connection.

### Connection profile (no secrets)

```json
{
  "id": "uuid",
  "name": "Production web",
  "protocol": "sftp",
  "host": "prod.example.com",
  "port": 22,
  "username": "deploy",
  "auth": { "method": "key", "keyPath": "~/.ssh/id_ed25519", "hasPassphrase": true },
  "initialPath": "/var/www",
  "timeoutSecs": 15,
  "folderId": null,
  "favorite": false,
  "notes": "",
  "tls": null,
  "createdAt": 0,
  "updatedAt": 0
}
```

FTPS profiles carry `tls: { mode: "explicit" | "implicit", verify: true, caFile?: string, pinnedSha256?: string }`. `verify: false` is allowed only with an explicit user confirmation and is surfaced as a persistent warning in the tab.

## 11. Security model

### Threats and controls

| Threat                                   | Control                                                                                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Credential theft at rest                 | OS keychain only; config contains no secrets; no plaintext fallback                                                                |
| Secrets in logs/crash output             | `secrecy::SecretString`, manual `Debug` redaction, tracing filter, no protocol payload logging by default, FTP `PASS` never logged |
| Unknown/malicious SSH host               | Strict known_hosts; explicit trust dialog; changed key blocks connection                                                           |
| FTPS interception                        | Certificate + hostname verification on by default; custom CA or explicit pin; insecure mode clearly flagged                        |
| Path traversal / filename injection      | `RemotePath`/`LocalPath` validation, name sanitization, no shell execution                                                         |
| Malicious directory listings             | Listing parser bounds, control-character rejection, no execution, no URL opening from entries                                      |
| FTP bounce / data connection redirection | Passive mode default; in active mode, data connections restricted to the control peer unless explicitly overridden                 |
| Arbitrary local file access via frontend | No Tauri fs/shell plugin; all local I/O goes through validated commands                                                            |
| Oversized responses / memory abuse       | Listing and text preview size caps; streamed file transfer; bounded history; timeouts                                              |
| Tauri capability escalation              | Minimal capability set, strict CSP, no remote content, no shell/fs plugins, no devtools in release                                 |
| Clipboard leakage                        | Only paths are copied; secrets are never placed on the clipboard                                                                   |
| Dependency compromise                    | Lockfiles, `cargo-deny`, `cargo-audit`, `bun audit`, pinned versions, review of new dependencies                                   |

### Tauri hardening

- `tauri.conf.json`:
  - `withGlobalTauri: false`
  - production CSP:
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src ipc: http://ipc.localhost; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`
  - a separate dev CSP only where Vite HMR requires it.
  - no `assetProtocol` unless a concrete preview need appears.
- Capabilities: `core:default`, window controls needed by the custom title bar, `dialog:allow-open`, `dialog:allow-save`, `opener:allow-reveal-item-in-dir` (scoped to local paths), and nothing else. No `shell`, `fs`, `http`, or `process` plugins.
- One window labeled `main`; commands validate they are invoked from the expected window if multiple windows are added later.
- Release builds: no devtools, no remote URLs, no updater until signing is in place.
- The webview loads only bundled assets. No user-supplied HTML is rendered as HTML; text previews render as plain text.

### Private keys and SSH agents

- The app reads a key file at connect time; the passphrase is fetched from the keychain only when needed.
- Key contents are never persisted by the app. Only the path and a `hasPassphrase` hint are stored.
- Supported formats are determined by russh's `decode_secret_key` (OpenSSH, PEM/PKCS#8); unsupported formats produce a clear error, not a fallback to a system binary.
- Agent authentication uses `SSH_AUTH_SOCK` (with a macOS `launchctl` fallback) or the Windows OpenSSH/Pageant agent. sftply lists the loaded identities, asks the agent to sign, and never reads or stores key material for this mode. Switching to the agent removes any saved password or passphrase for that connection.
- Memory zeroization is best-effort (`Zeroizing<Vec<u8>>` for key material, `SecretString` for passphrases). Rust cannot guarantee zeroization of all copies; this is documented rather than overstated.

## 12. Protocol notes

### FTP / FTPS (suppaftp)

- Control connection on 21 (FTP/FTPS explicit) or 990 (implicit FTPS).
- Prefer `FEAT`: use `MLSD` for structured entries when advertised; otherwise parse `LIST` (POSIX/DOS) with a tested fallback parser. Preserve `warnings` when metadata is inferred.
- `OPTS UTF8 ON` when supported; otherwise decode using the server's declared encoding and surface mojibake risk in diagnostics.
- Passive EPSV/PASV by default. Active mode is opt-in and restricted as described above.
- Explicit FTPS: `AUTH TLS`, then `PBSZ 0`, `PROT P`. Implicit FTPS: TLS from the first byte.
- TLS: verify certificate and hostname. Custom CA bundle and per-connection SHA-256 pin are supported. `verify: false` is an explicit, warned choice.
- `REST`/`APPE` support is negotiated and tracked in capabilities; resume is enabled only when verified against the server.
- Timeouts: connect timeout, per-command timeout, and data idle timeout. FTP has no standard keepalive; avoid long idle control connections or re-open on demand.

### SFTP (russh + russh-sftp)

- Pure-Rust SSH; password, public-key and SSH agent auth; passphrase-protected keys.
- Host-key verification via the app's known_hosts (no automatic trust).
- SFTP v3 with extension detection: `limits@openssh.com`, `fsync@openssh.com`, `hardlink@openssh.com`, `statvfs@openssh.com`, `expand-path@openssh.com`.
- `realpath`/`expand-path` resolves the initial directory at connect; displayed path is server-resolved.
- `chmod` uses setstat; owner/group are displayed from numeric IDs (name lookup is not assumed).
- Keepalive is configured (e.g. 30s interval, 3 missed replies) and surfaces disconnects as `Disconnected` with an explicit reconnect action.
- Transfers use additional SFTP channels; per-session channel concurrency is bounded to avoid server-side connection limits.

### Why not a single "remote filesystem" library?

There is no maintained Rust crate that implements FTP, FTPS and SFTP behind one production-grade async trait with accurate capabilities. Unifying at our own trait boundary keeps protocol quirks (finalization, resume, permission models) explicit and testable, instead of leaking them into the UI or hiding unsupported behavior.

## 13. Error model and UX states

```rust
#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,        // user-safe, actionable, no secrets
    pub detail: Option<String>, // redacted technical detail
    pub retryable: bool,
}
```

Codes include: `NETWORK`, `TIMEOUT`, `AUTH_FAILED`, `HOST_KEY_UNKNOWN`, `HOST_KEY_MISMATCH`, `TLS_CERTIFICATE`, `PERMISSION_DENIED`, `NOT_FOUND`, `ALREADY_EXISTS`, `CONFLICT`, `UNSUPPORTED`, `SESSION_NOT_READY`, `PROTOCOL`, `CANCELLED`, `KEYCHAIN_UNAVAILABLE`, `INVALID_INPUT`, `INTERNAL`.

UX mapping:

- **Field errors:** inline in forms (Zod + backend validation).
- **Transient failures:** toast with action ("Retry", "Details").
- **Pane-level failures:** inline state with cause and retry, never a blank pane.
- **Connection loss:** persistent banner + status bar change + reconnect action; transfer failures remain individually retryable.
- **Destructive errors:** dialog stays open with the concrete reason.
- **No false success:** no optimistic completed transfers; no clearing an error before the retry actually succeeds.

## 14. Testing strategy

### Rust

- Unit tests: path normalization/joining, filename sanitization (including Windows reserved names and Unicode), `LIST`/`MLSD` parsers with real-world fixtures, known_hosts matching and hashing, capability negotiation, conflict policy, queue scheduling, speed/ETA math, bandwidth limiter, config migrations, redaction.
- Property tests (`proptest`) for path/name invariants and parser robustness (no panics, bounded output).
- Fuzz targets (later) for FTP listing parsers.
- Integration tests: protocol adapters against Dockerized servers:
  - OpenSSH SFTP (password + key + passphrase key + SSH agent; host-key flows).
  - vsftpd or ProFTPD (plain FTP, explicit FTPS, implicit FTPS; MLSD and LIST-only modes; resume).
  - Test fixtures live in `tests/fixtures/`; servers in `docker-compose.test.yml`; run in CI on Linux, opt-in locally.
- No real network access in default `cargo test`. Integration tests use a feature flag or `#[ignore]` plus a dedicated CI job.
- `cargo nextest`, `cargo clippy -- -D warnings`, `cargo fmt --check`.

### Frontend

- Vitest + Testing Library + jsdom.
- Mock Tauri IPC with `@tauri-apps/api/mocks` (`mockIPC`, `mockWindows`), not by mocking our own API modules, so the serialization boundary is exercised.
- Pure logic tests: sorting, selection reducer, keyboard navigation, path formatting, transfer event projection, Zod schemas.
- Component tests: file table keyboard/multi-select, connection form validation and secret handling, host-key dialog (trust/cancel), conflict dialog, command palette filtering, transfer row states.
- Accessibility assertions with `vitest-axe` on key views (later).
- E2E: Playwright against the Vite preview with mocked IPC for UI flows. Tauri WebDriver smoke tests on Linux CI once packaging is stable.
- `bun run typecheck`, Biome lint/format, no `any` in application code (generated bindings excepted).

### Manual protocol matrix

A documented checklist per release: OpenSSH, vsftpd, ProFTPD, FileZilla Server (Windows), Synology (if available), plus a server that only supports LIST, a server requiring TLS session reuse, IPv6, non-ASCII filenames, and files >4 GiB.

## 15. Performance budgets

| Metric                                              | Budget                                                |
| --------------------------------------------------- | ----------------------------------------------------- |
| Cold start to interactive (warm OS cache, M-series) | < 1.2s                                                |
| Window visible                                      | < 500ms                                               |
| Directory with 10k entries: first render            | < 150ms after data arrives                            |
| Scrolling file list                                 | 60fps with virtualization                             |
| Selection/keyboard response                         | < 16ms                                                |
| IPC listing payload                                 | ≤ 2MB for 10k entries; warning above 25k              |
| Progress event rate                                 | ≤ 10/s per transfer, batched                          |
| Idle memory (2 sessions, 1k transfers)              | < 250MB                                               |
| Initial JS bundle                                   | < 400KB gzip                                          |
| Rust release binary                                 | Track per platform; no fixed limit, but review growth |

Techniques: virtualized lists, no per-row global subscriptions for hidden rows, deferred filter input, batched events, streaming transfers with fixed 64 KiB buffers, `spawn_blocking` for directory walks, no base64 in IPC, no unnecessary re-renders from the transfer store (selector-based).

## 16. Observability and diagnostics

- `tracing` with a rolling file appender in the app log directory; default level `info`, per-module overrides for protocol diagnostics.
- Redaction layer drops fields named `password`, `passphrase`, `secret`, `privateKey`, `token`, rewrites URLs to remove userinfo, and never logs FTP `PASS` or raw key material.
- In-app **Activity** panel records user-visible operations (connected, listing failed, transfer started/completed, host key trusted) with timestamps, no secrets.
- "Copy diagnostics" produces an app version, OS, protocol, server capability summary, and redacted error detail, never credentials.
- No telemetry. Crash reports are local only unless the user explicitly exports diagnostics.

## 17. Packaging and CI

- macOS: universal or arm64+x64 builds, code signing + notarization before distribution.
- Windows: NSIS/MSI, code signing.
- Linux: AppImage and .deb (WebKitGTK dependency documented).
- CI matrix: `cargo fmt/clippy/test`, frontend typecheck/lint/test/build, `cargo-deny`, `cargo-audit`, `bun audit`, protocol integration job (Linux, Docker), Tauri build smoke on all three OSes.
- Versioning: semantic version, app version injected into `app_info`; config/known-hosts/history formats versioned independently.
- Auto-update is deferred until signing and a release channel exist.

## 18. Architectural risks

| Risk                                                   | Impact                          | Mitigation                                                                                                                                                     |
| ------------------------------------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| suppaftp FTPS custom verification / implicit mode gaps | FTPS security or compatibility  | Phase 0 spike; if the adapter cannot expose the needed TLS policy, wrap the stream or switch TLS backend; document limitations rather than weaken verification |
| russh API churn (0.65) / russh-sftp compatibility      | Rework in the SSH layer         | Pin versions, isolate behind `SftpRemote`, integration tests against OpenSSH, upgrade deliberately                                                             |
| FTP LIST parsing variance                              | Wrong names/sizes/dates         | Prefer MLSD; fixture-driven parser; surface warnings; never crash                                                                                              |
| Resume semantics differ by server                      | Data corruption or dishonest UI | Capability negotiation, size verification, tests; disable rather than guess                                                                                    |
| Tauri IPC throughput with huge directories             | UI jank                         | Virtualization, payload budget, pagination/incremental listing if measurement requires it                                                                      |
| WebView drag/drop differences                          | Broken upload UX                | Internal HTML5 DnD + Tauri OS drop; test on all platforms; file picker fallback                                                                                |
| Keychain unavailable on Linux                          | Cannot save credentials         | Clear error, setup guidance; no insecure fallback                                                                                                              |
| Large file u64/i64 offsets                             | Overflow/truncation             | Use u64 for sizes/offsets, checked conversions at protocol boundaries, >4GiB tests                                                                             |
| Key material in memory                                 | Residual secrets                | `SecretString`/`Zeroizing`, minimize copies, avoid logs; document limits                                                                                       |
| Scope creep in advanced features                       | Delays reliability work         | Phase gates; advanced features only after transfer core is trustworthy                                                                                         |

## 19. Decisions requiring approval

1. **SFTP stack:** `russh 0.65 + russh-sftp 3.0.1` (recommended) vs `ssh2/libssh2`.
2. **FTPS TLS backend:** `rustls` with platform verifier (recommended, pending suppaftp spike) vs `native-tls`.
3. **Product name/branding:** keep `sftply` or rename before icon/UI polish.
4. **Platform priority:** macOS-first with Windows/Linux parity in CI, or equal priority from day one.
5. **Lint/format tooling:** Biome (single fast tool) vs ESLint + Prettier.
6. **Advanced scope:** confirm Phase 6 order and whether file comparison/sync are part of the first public release.

See `docs/DEPENDENCIES.md` for the evaluation and `docs/ROADMAP.md` for sequencing.
