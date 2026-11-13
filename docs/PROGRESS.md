# sftply — Progress Log & Continuation Notes

**Purpose:** This is the single source of truth for what is built, what is verified, and what to do next. Update it at the end of every work session so work can resume on another day without re-discovery.

**Last updated:** 2026-11-11  
**Current phase:** Phase 4 in progress — Phase 4a (single-file) and Phase 4b (recursive jobs, queue control, retry, in-app drag-and-drop, bandwidth limiter) are implemented, and the transfer panel is virtualized for large queues. Phase 4c hardening (large files, broken connections, server matrix) and external OS file drops remain.
**Overall status:** Phase 1 shell, Phase 2 local browser, the Phase 3 connection/remote-browsing slice and Phase 4a/4b transfers are implemented with automated gates green. Protocol integration is verified against real FTP, explicit FTPS, implicit FTPS and SFTP servers, including custom CA, certificate pinning, CRUD, binary streaming round trips and nested-folder creation. Rendered tests cover the connection row, remote tabs, host-key dialog, Quick Connect, the lost-session pane, the file table (including drag/drop), dialogs and the transfer list; real-window visual QA remains pending. A minimal Docker FTP server for manual connection testing lives in `docker/dev-ftp/` and is documented below.

---

## How to resume

1. Read **Current status** and **Next actions** below.
2. Run the verification commands in **Verification**.
3. Continue the first unchecked item in the current phase.
4. At the end of the session, update this file:
   - Current status / phase
   - Completed checklist items
   - New session-log entry at the bottom (date, done, verified, next)
   - Any new decisions, known issues, or blockers in the appropriate section.

Do not mark a feature complete unless its verification command passes and its acceptance criteria are met.

---

## Provisional decisions (pending final confirmation)

These were recommended in the architecture package. Implementation proceeds with these defaults unless the user changes them; changes must be recorded here and in an ADR.

| Topic             | Default in use                              | Notes                                                  |
| ----------------- | ------------------------------------------- | ------------------------------------------------------ |
| Protocol stack    | suppaftp 12 + russh 0.65 / russh-sftp 3.0.1 | Phase 0 runtime spikes still pending (no test servers) |
| FTPS TLS          | rustls + platform verifier                  | Fallback: native-tls if integration proves impractical |
| Product name      | `sftply`                                    | Rename before branding/icons if requested              |
| Platform priority | macOS-first, Windows/Linux kept buildable   | CI parity added as platform work progresses            |
| Lint/format       | Biome for TS; rustfmt + clippy              | ESLint/Prettier swap is contained if requested         |
| Advanced features | After a reliable 1.0 core                   | Permissions/bookmarks/editor/compare/sync in Phase 6   |
| Git               | Initialized locally, checkpoint commits     | Never commit secrets or build artifacts                |
| Typed IPC         | tauri-specta v2 RC + specta v2 RC           | v1 is Tauri v1 only; version corrected in Phase 1      |

---

## Current status

### Completed

- [x] Repository analysis and architecture package (`docs/`)
- [x] ADRs 0001–0005 (proposed)
- [x] Progress log created
- [x] Phase 0: git initialization, Rust toolchain pin, Bun scripts, frontend foundations, shadcn/Tailwind v4, tauri-specta spike
- [x] Phase 1: design tokens, shell, resizable persisted layout, themes, command palette skeleton, settings, Rust foundation, typed IPC, strict CSP, tests
- [x] Phase 2: local filesystem service, path validation, virtualized table, navigation, selection/keyboard model, mutations, dialogs, empty/error states, 10k performance check

### In progress

- [ ] Phase 1 + 2 visual runtime QA in the real Tauri window (layout, traffic lights, CSP, theme toggle, palette, settings persistence, startup activity, local browser interactions)
- [x] Rendered component tests for keyboard table navigation and rename/delete dialog flows
- [ ] First CI run on a remote (workflow definition exists)

### Known issues / blockers

- A CI workflow now covers the frontend and non-Docker Rust gates, but it has not run yet because the repository has no remote configured.
- Runtime FTPS/SFTP/keyring spikes still need local test servers (Docker or local daemons). Compile-time validation proceeds without them; protocol crates and their features are not yet added to `Cargo.toml`.
- The `suppaftp`/implicit-FTPS and `russh` + `russh-sftp` version pairings remain unproven at runtime; if they fail, the dependency ADRs must be updated before Phase 3.
- `tauri-specta` v2 RC is pre-release. Bindings regenerate deterministically today, but upgrades must be reviewed deliberately and must not be assumed semver-safe.
- The production JS bundle is a single chunk above Vite's 500 kB warning threshold (≈860 kB raw / 257 kB gzip). Code splitting belongs in the Phase 5 performance pass unless it starts blocking work.
- Biome's `useSemanticElements` / `useFocusableInteractive` are disabled for the virtualized file table and column header only. They are an ARIA grid with a single roving tab stop, not semantic `<table>` markup; keyboard access is handled on the grid container.

---

## Phase 0 — Validation and project hygiene

- [x] Initialize git repository and checkpoint commit (`b0efcfd`)
- [x] Pin Rust toolchain (`rust-toolchain.toml`, 1.99.1 with rustfmt + clippy)
- [x] Confirm Bun usage and add scripts (`dev`, `build`, `typecheck`, `lint`, `format`, `test`, `check`, `bindings`, Rust gates)
- [x] Install and configure frontend foundations (React 19, TS 6 strict, Tailwind v4, Biome 2, Vitest + Testing Library, Zustand, TanStack Query/Virtual, RHF + Zod, cmdk, sonner, dnd-kit, tinykeys)
- [x] Initialize shadcn/ui + Tailwind v4 (Radix base, `nova` preset, 28 primitives)
- [x] Add CI skeleton (frontend + Rust; dependency audit still to add)
- [ ] Spike: suppaftp + FTPS API compiles; custom rustls connector shape validated (crates not added yet)
- [ ] Spike: russh 0.65 + russh-sftp 3.0.1 compile together (crates not added yet)
- [x] Spike: tauri-specta command/event generation (v2 RC, command + event + types verified)
- [ ] Spike: keyring 4 store/read/delete
- [x] Record spike results in `docs/DEPENDENCIES.md` (tauri-specta correction recorded; protocol/keyring runtime results pending)

### Phase 0 exit criteria

- CI green for template/foundation.
- Protocol crates compile in our module structure.
- Typed IPC generation works.
- Known limitations documented; no security fallback chosen silently.

**Status:** Typed IPC works and a CI workflow definition exists. The first remote CI run, the dependency audit, and the protocol/keyring runtime spikes remain outstanding.

---

## Phase 1 — Foundation: shell, design system, typed boundary

- [x] Design tokens (dark default + light), typography, density, scrollbars, focus rings
- [x] shadcn primitives installed and reviewed
- [x] App shell: title bar, sidebar, workspace split, bottom panel, status bar
- [x] Resizable layout with persisted sizes
- [x] Theme switcher (system/dark/light), no flash
- [x] Sidebar sections and honest disconnected/empty states
- [x] Command palette skeleton (Cmd/Ctrl+K)
- [x] Rust foundation: AppState, AppError, logging + redaction, config paths, atomic JSON store
- [x] Settings get/update commands + persistence
- [x] tauri-specta typed bindings + invoke wrapper + event bridge
- [x] Window defaults (1440×900, min 1024×640), state persistence
- [x] Strict CSP and minimal capabilities
- [x] Tests: config atomic write, error normalization, theme/settings store, command registry
- [ ] Visual runtime QA in the actual Tauri window

### Phase 1 exit criteria

- Polished shell launches, themes switch, layout persists.
- Settings survive restart; corrupt config has a recovery path.
- Typed IPC regenerates deterministically.
- No fake features; panes clearly show "not connected".

**Status:** Implementation and automated verification complete. A real-window visual pass is the only remaining acceptance check.

---

## Phase 2 — Local filesystem and file browser

- [x] Local filesystem Rust service (list/stat/mkdir/rename/delete/chmod/open/reveal)
- [x] Path validation + sanitization + tests (absolute paths, NUL, traversal names, separators, reserved names, mode bits)
- [x] Virtualized file table (name, size, modified, permissions, kind)
- [x] Breadcrumbs + history + keyboard path entry (`⌘L`)
- [x] Selection model (click, mod-click, shift-range, select all, type-ahead)
- [x] New folder, inline rename, delete confirmation, permissions dialog
- [x] Context menu + keyboard access (`↩`, `F2`, `Delete`, `⌘⌫`, arrows, Home/End, `Esc`)
- [x] Hidden files toggle, filter, sort, column config
- [x] Loading/empty/error/permission-denied states
- [x] 10k-entry performance check (Rust listing + frontend sort/filter smoke test)
- [x] Tests: selection/sort/path/name models and backend list/stat/mutations/traversal/symlink/chmod/error mapping
- [x] Rendered component tests for the keyboard table and rename/delete dialogs
- [ ] Visual runtime QA of the local browser in the Tauri window

### Phase 2 exit criteria

- Fully usable local file manager by keyboard — implemented; manual runtime pass pending.
- 10k entries meet performance budget — listing took **71.9 ms** locally (5 s test ceiling).
- No mock listings in production paths — local commands call the real filesystem; remote scopes return `UNSUPPORTED`.

**Status:** Backend and frontend implementation complete, automated gates green, including rendered keyboard and dialog tests. Runtime visual QA remains.

---

## Phase 3 — Connections and remote browsing

- [ ] Connection repository (folders, favorites, recent, duplicate, reorder, search)
- [ ] Connection form with RHF + Zod + test connection
- [ ] Keychain password/passphrase storage + status/delete
- [ ] FTP adapter
- [ ] FTPS adapter (explicit + implicit, cert policy)
- [ ] SFTP adapter (password/key/passphrase)
- [ ] Known-hosts store + host-key trust dialog + changed-key block
- [ ] Session actors, state events, reconnect/disconnect
- [ ] Remote browser using the same table
- [ ] Tabs for simultaneous sessions
- [ ] Sidebar connection status indicators
- [ ] Security tests: no secrets in config/logs/export; traversal rejected
- [ ] Docker integration suite (FTP/FTPS/SFTP)
- [x] Rendered component tests for the connection row, remote tabs, host-key dialog, Quick Connect and the lost-session pane

### Phase 3 exit criteria

- Browse and mutate files over FTP, FTPS and SFTP.
- Unknown SSH host requires explicit trust; changed key blocks.
- Credentials only in OS keychain and Rust memory.

---

## Phase 4 — Transfers

- [x] 4a: single-file pipeline, progress, cancellation, conflicts, temp download
- [x] 4b: recursive jobs, queue control, retry, in-app drag-and-drop (pause is queue-level only)
- [x] 4b: shared bandwidth limiter and live concurrency changes
- [x] 4c: atomic uploads (hidden temp + rename, backup/restore on overwrite) and download temp cleanup
- [x] 4c: stalled sockets time out after 60 s idle and cancellation interrupts stalled reads/writes
- [ ] 4c: remaining hardening (>4 GiB transfers, disk-full/auth expiry/permission-change matrix, event-rate profiling)
- [x] 4c: 1,000-item queue stays responsive (virtualized transfer panel)
- [x] Transfer panel UI + status bar aggregation
- [x] Integration tests across protocols (single-file binary streaming + CRUD)
- [x] Honest capability gating verified (per-transfer pause/resume stays hidden; queue pause only)
- [x] Transfer history persistence across restarts
- [ ] OS file drag-and-drop (Finder → pane) and drag-out

### Phase 4 exit criteria

- Reliable upload/download of files and folders.
- Cancel/retry/conflict/disconnect paths tested.
- No fake pause/resume; no success before finalization.

---

## Phase 5 — Polish and productivity

- [x] Shortcuts reference in Settings
- [ ] Full command palette + `?` shortcut sheet
- [ ] Complete keyboard map and scopes
- [ ] Context menus everywhere + disabled reasons
- [ ] Tabs polish (overflow, reorder, close behavior)
- [ ] All empty/loading/error/first-run states
- [ ] Density/column/date/size preferences
- [ ] Accessibility audit (keyboard, labels, contrast, reduced motion)
- [ ] Startup/scroll/memory performance pass
- [x] App icon and in-app branding
- [ ] Product metadata, packaging (macOS signing/notarization; Windows/Linux)
- [ ] Cross-platform visual QA

---

## Phase 6 — Advanced features

- [ ] Permissions editor (octal + symbolic, recursive confirmation)
- [ ] Remote bookmarks + recent paths
- [ ] Remote text editor (size/binary/encoding limits, conflict detection)
- [ ] Remote previews (safe rendering)
- [ ] Import/export without credentials
- [ ] File comparison
- [ ] Synchronization (planner + dry-run)
- [ ] Queue priorities / extras

---

## Phase 7 — Release hardening

- [ ] Threat-model review + dependency audits
- [ ] Fuzz listing parsers
- [ ] Soak/fault-injection tests
- [ ] Multi-server test matrix
- [ ] User docs + troubleshooting
- [ ] Signed installers, changelog, release notes

---

## Verification

```bash
# Full frontend gate
bun run check          # typecheck + biome + vitest + production build

# Individual gates
bun run typecheck
bun run lint
bun run test
bun run build

# Bindings (must produce no diff)
bun run bindings

# Rust
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

**Last verification run:** 2026-11-13 — all gates green.

| Gate                 | Result                                                              |
| -------------------- | ------------------------------------------------------------------- |
| `bun run typecheck`  | pass                                                                |
| `bunx biome check .` | pass                                                                |
| `bun run test`       | 117 tests pass in 19 files                                          |
| `bun run build`      | pass (single JS chunk warning, see known issues)                    |
| `cargo fmt --check`  | pass                                                                |
| `cargo clippy`       | pass with `-D warnings`                                             |
| `cargo test`         | 68 tests pass, 14 ignored (Docker integration tests)                |
| `bun run bindings`   | regenerates `src/lib/ipc/bindings.ts` deterministically             |
| `tests/integration`  | 14 tests pass (FTP, explicit FTPS, implicit FTPS, SFTP + streaming) |

**Performance:** listing 10,000 local entries took **71.9 ms**; the automated test fails above 5 s to tolerate slow CI hardware.

### Manual dev FTP server

`docker/dev-ftp/` runs a minimal plain-FTP server (Alpine + Pure-FTPd) for trying
the app by hand. It is separate from the automated integration matrix and keeps
its data in the named volume `sftply-dev-ftp_ftp-data`.

```bash
bun run dev:ftp        # docker compose up -d --build
bun run dev:ftp:logs   # follow the container log
bun run dev:ftp:down   # stop (add -v to remove the data volume)
```

| Field    | Value        |
| -------- | ------------ |
| Protocol | FTP          |
| Host     | `127.0.0.1`  |
| Port     | `2121`       |
| User     | `sftply`     |
| Password | `sftply-dev` |
| Start    | `/`          |

The home folder contains `welcome.txt` and a writable `upload/` folder. Passive
data connections use ports `30000-30009`; the server advertises `127.0.0.1`,
which is only correct for local client connections. See
`docker/dev-ftp/README.md` for details.

---

## Session log

### 2026-11-05 — Session 1: design approval and Phase 0 start

**Done**

- Analyzed the repository and verified toolchain versions.
- Produced architecture, dependency evaluation, roadmap and ADRs.
- Created this progress log.
- Implemented earlier planning docs only; no product code yet.

**Next**

- Initialize git and toolchain pins.
- Install frontend foundations and shadcn.
- Build Phase 1 shell.

**Notes**

- User approved starting implementation and requested phase-by-phase progress records.

### 2026-11-06 — Session 2: Phase 0 foundation and Phase 1 shell

**Done**

- Initialized git and committed the template plus architecture package (`b0efcfd`).
- Pinned Rust 1.99.1 and added npm scripts for frontend/Rust/binding gates.
- Installed and configured Tailwind v4, shadcn (Radix base + `nova`, 28 primitives), Zustand, TanStack Query/Virtual, RHF + Zod, cmdk, sonner, dnd-kit, tinykeys, Vitest and Biome.
- Replaced the template UI with a dark-default/light design system (Inter + JetBrains Mono, OKLCH tokens, density, scrollbars, reduced motion).
- Built the app shell: custom draggable title bar with traffic-light inset, sidebar, dual resizable panes, resizable Transfers/Activity panel, status bar, command palette, settings dialog and theme dropdown.
- Implemented keyboard shortcuts: `⌘K` palette, `⌘,` settings, `⌘J` bottom panel, `⌘1`/`⌘2` pane focus.
- Built the Rust foundation: typed `AppError`/`ErrorCode`, validated settings with defaults, atomic JSON writes, corrupt-config backup/recovery, tracing with redaction helper, `AppState`, `app_info`, `settings_get`/`settings_update`.
- Corrected the typed-IPC decision: `tauri-specta` 1.0.2 targets Tauri v1, so the project uses `tauri-specta`/`specta` 2.0.0-rc.26 with `specta-typescript` 0.0.13.
- Generated typed bindings and added a normalized IPC facade plus an activity event bridge.
- Added settings load/update queue with optimistic updates, rollback, theme/density application and a no-flash localStorage mirror (never secrets).
- Replaced startup-time event emission with a `startup_report` command drained by the frontend, so config-recovery warnings cannot be lost before the listener exists.
- Added 19 frontend tests and 11 Rust tests covering formatting, theme, error normalization, activity store, settings validation, atomic writes and corrupt-config recovery.
- Tightened CSP (`csp` + `devCsp`) and minimized capabilities to `core:default`, `dialog:default`, `opener:default`, `window-state:default`.

**Verified**

- `bun run typecheck`, `bunx biome check .`, `bun run test` (19), `bun run build`.
- `cargo fmt`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (11).
- `bun run bindings` regenerates the same typed command/event surface.
- Git working tree reviewed; `dist/` and `src-tauri/target/` remain ignored.

**Next**

- Run `bun run tauri dev` and complete the Phase 1 visual QA checklist.
- Add the CI skeleton and commit the Phase 1 checkpoint.
- Start Phase 2: local filesystem service, path validation, virtualized table, selection/keyboard model, mutations, tests and the 10k-entry performance check.

### 2026-11-06 — Session 3: Phase 2 local filesystem and browser

**Done**

- Added the Rust local filesystem service: `fs_list`, `fs_stat`, `fs_mkdir`, `fs_rename`, `fs_delete`, `fs_chmod`, `local_open` and `local_reveal`.
- Added `FsScope` (`local` / `remote`) so remote requests return an honest `UNSUPPORTED` error instead of a mock listing.
- Added lexical absolute-path normalization and name validation (NUL, separators, `.`/`..`, 255-byte limit, Windows reserved names) plus chmod mode validation.
- Listing uses `buffer_unordered(64)` for metadata, reports unreadable entries as warnings instead of failing, detects symlinks with targets, and reports Unix permissions and hidden state.
- Built the Phase 2 frontend: typed local API, TanStack Query listing hook, per-pane navigation history, path bar with breadcrumbs and `⌘L` editing, virtualized ARIA file grid, column sorting, filter, hidden-file toggle and column config.
- Added the selection model (replace/toggle/shift-range/select-all/type-ahead/prune) and keyboard handling: arrows, Home/End, Space, Enter, Backspace, Delete, `⌘⌫`, `F2`, `Esc`.
- Added new-folder, inline rename, delete confirmation and permissions dialogs wired to real commands, with optimistic-free refetching and activity entries.
- Added loading skeleton, empty, filtered-empty, error, permission-denied and listing-warning states; status bar now reports the local path, item count and selection.
- Replaced the Phase 1 local placeholder pane with `LocalBrowser`; the remote pane still states that remote sessions are unavailable.
- Added 10k-entry performance checks: Rust listing (measured 71.9 ms) and a frontend sort/filter smoke test.
- Added targeted Biome overrides and explanatory suppressions for the virtualized grid and intentional navigation-reset effects; all lint diagnostics resolved.
- Regenerated typed bindings with `size`/`readAt`/`modifiedAt` as `number`/`number | null` via Specta `Number` annotations.

**Verified**

- `bun run typecheck`, `bunx biome check .`, `bun run test` (49 tests in 8 files), `bun run build`.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (29 tests).
- `bun run bindings` produces an identical `src/lib/ipc/bindings.ts`.
- Git tree reviewed; `dist/` and `src-tauri/target/` remain ignored.

**Next**

- Run the Phase 1 + 2 visual QA checklist in `bun run tauri dev`.
- Add rendered component tests for keyboard table navigation and rename/delete dialogs.
- Start Phase 3: connection repository, connection form, keychain storage, protocol adapters, known-hosts flow, session actors and the remote browser.

### 2026-11-07 — Session 4: Phase 3 connection foundation

**Done**

- Added the connection domain model: `ConnectionProfile`, `ConnectionInput`, protocol enum (`ftp`, `ftpsExplicit`, `ftpsImplicit`, `sftp`), password/key auth with absolute key paths, and trim/validate rules (`name ≤ 100`, `host ≤ 253` without whitespace or separators, port `1–65535`, `username ≤ 128`, SFTP-only keys, normalized absolute initial path, optional group).
- Added `ConnectionStore` (`config_dir/connections.json`, schema version 1) with atomic writes, corrupt-file backup/recovery, duplicate, delete, favorite toggle and reorder.
- Added keychain credential storage (`keyring` v1 API, service `dev.sftply.credentials`, item `{connection-id}:{password|passphrase}`) with set/read/delete/status. No command returns secret material; status reads and discards values.
- Added the SSH known-hosts store (`config_dir/known_hosts.json`) with `Trusted` / `Unknown` / `Changed { previous_fingerprint }` verdicts; changed keys must block.
- Wired `AppState` with connections, known hosts and chained startup warnings; registered 12 connection/keychain/known-host commands and regenerated typed bindings.
- Added the frontend connection layer: typed API facade, Zod schema mirroring backend validation and defaults, TanStack Query hooks, RHF create/edit dialog with protocol/port defaults, native key-file picker and keychain secret hint/removal.
- Replaced the sidebar placeholder with a connections panel: favorites-first ordering, secure/insecure protocol badges, duplicate, favorite toggle, delete confirmation and empty/loading/error states.
- Added connection schema tests (validation, conversion, defaults) and a normalized IPC facade for all connection and known-host commands.

**Verified**

- `bun run typecheck`, `bunx biome check src`, `bun run test` (58 tests in 9 files), `bun run build`.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (46 tests).
- `bun run bindings` regenerates the same typed surface.
- Protocol crates (`suppaftp 12.2.1`, `russh 0.65.1`, `russh-sftp 3.0.1`) compile together in one workspace; `russh-sftp` only uses russh as a dev-dependency, so the reported 0.63/0.65 conflict does not apply.

**Next**

- Implement `protocol/` FTP/FTPS and SFTP adapters with capability reporting.
- Add session actors, connection state events, host-key unknown/changed flow and connect/disconnect tests.
- Build the remote browser from the shared `FileTable`; wire tabs and sidebar status indicators.
- Add the Docker FTP/FTPS/SFTP integration suite and security redaction/traversal tests.

### 2026-11-08 — Session 5: protocol adapters, sessions and remote browsing

**Done**

- Added `protocol/` with a capability-reporting `RemoteFs` trait and two adapters:
  - `FtpRemote`: plain FTP, explicit FTPS via `into_secure`, implicit FTPS via `connect_secure_implicit`, rustls platform verification, FEAT detection (`MLSD` enables structured listing and Unix permissions, `SITE CHMOD` enables chmod), MLSD with LIST/POSIX/DOS fallback, binary mode, recursive delete, safe path joins, and stable error mapping.
  - `SftpRemote`: russh handshake with password, private-key and passphrase auth, keepalive/inactivity timeouts, strict known-hosts checking against a snapshot, SFTP v3 listing/stat/mkdir/rename/delete/chmod, symlink targets, and stable status/error mapping.
- Added the session layer: `Session`, `SessionManager`, `session_connect`, `session_disconnect`, `sessions_list`, `session://state` events, keychain-to-protocol credential flow, start-folder validation, and last-used updates.
- Routed all `fs_*` commands through local or remote scope; missing sessions return `SESSION_NOT_READY`.
- Hardened logging: suppaftp/russh/russh_sftp are clamped to `info` because suppaftp logs raw `PASS` at trace level.
- Refactored the local file browser into a generic `DirectoryBrowser` with pane identity, scope, capability gating, optional open/reveal actions, path persistence, header extras, and status labels; added `LocalBrowser` and `RemotePane` wrappers.
- Added a session store, session event bridge, connect/disconnect actions, sidebar connect/disconnect controls with latency and connected state, multi-session tabs, remote status-bar summary, and a host-key trust dialog for unknown and changed keys.
- Added Rust tests for known-host verdicts (host/port/key-type changes), FTP feature detection and error mapping, SFTP metadata mapping and status errors, and protocol detail sanitization.

**Verified**

- `bun run check` (Biome, 58 Vitest tests, strict TypeScript, production build).
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (52 tests).
- `bun run bindings` regenerates the session commands, `SessionInfo`, `HostKeyChallenge`, and `session://state`.

**Next**

- Add Quick Connect with transient credentials and recent-list updates.
- Add TLS options (custom CA, pinning, explicit insecure toggle with warning) and an FTP active/passive policy.
- Add reconnect, cancellation, and per-session operation timeouts surfaced in the UI.
- Add the Docker FTP/FTPS/SFTP integration suite and end-to-end host-key trust test.
- Run real-window visual QA for local and remote panes; add rendered component tests for the connection row, tabs and host-key dialog.

### 2026-11-08 — Session 6: Docker protocol integration suite

**Done**

- Added a native arm64 integration stack under `tests/integration/`:
  - `pure-ftpd/` builds Alpine Pure-FTPd for plain FTP (`2121`) and explicit FTPS (`2122`) with per-service passive ranges.
  - `pure-ftpd-implicit/` compiles Pure-FTPd from source with `--with-implicittls` for implicit FTPS (`2990`). Alpine's package enables explicit TLS only, and Pure-FTPd treats implicit TLS as a compile-time, mutually exclusive switch.
  - `sftp` uses `atmoz/sftp:alpine` on `2222` with the user chrooted to `/home/sftply`.
  - `generate-certs.sh` creates a throwaway CA and server certificate (with Authority Key Identifier, required by OpenSSL 3 verification); `certs/` is gitignored.
  - `run.sh` builds the images, waits for each service by log line and port, runs the ignored tests, and tears the stack down (`--keep` leaves it running).
  - `README.md` documents ports, credentials, and the implicit-TLS constraint.
- Added ignored Rust integration tests:
  - `protocol::ftp::integration`: plain FTP, explicit FTPS, implicit FTPS full CRUD (list, mkdir, rename, stat, recursive delete), plus wrong-password rejection.
  - `protocol::sftp::integration`: unknown host key produces `HOST_KEY_UNKNOWN` with a challenge, changed fingerprint produces `HOST_KEY_MISMATCH`, and trusting the presented key allows CRUD in `/upload`.
- Refactored `FtpRemote::connect` through a private `connect_with` that accepts an optional connector, so tests can trust the throwaway CA without weakening the production platform verifier. Added `rustls-pemfile` as a dev-dependency.
- Fixed the serialized-profile test to assert on secret-bearing field names instead of the `passphraseProtected` metadata flag.

**Verified**

- `tests/integration/run.sh` → 6 integration tests passed against real servers; stack removed afterwards.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (53 passed, 6 ignored).
- `bun run check` (Biome, 58 Vitest tests, strict TypeScript, production build) and `bun run bindings`.

**Notes**

- Pure-FTPd implicit TLS still requires `-Y 2` at runtime so `tls_init_library()` runs; without it the control connection closes before the handshake.
- vsftpd's implicit TLS segfaulted when rustls connected, so the suite uses the Pure-FTPd source build instead.
- `nc -z` alone is not a readiness check: Docker accepts the mapped port before sshd is listening. `run.sh` also waits for each service's startup log line.

**Next**

- Add Quick Connect with transient credentials and recent-list updates.
- Add TLS options (custom CA, pinning, explicit insecure toggle with warning) and an FTP active/passive policy.
- Add reconnect, cancellation, and per-session operation timeouts surfaced in the UI.
- Run real-window visual QA for local and remote panes; add rendered component tests for the connection row, tabs and host-key dialog.

### 2026-11-08 — Session 7: Quick Connect

**Done**

- Added `session_connect_quick(input, secret, save)`:
  - `save = false` builds a transient profile and passes the secret through `TransientSecret`; nothing is written to `connections.json` or the keychain.
  - `save = true` creates the profile and stores the secret in the keychain before connecting.
  - A failed saved connection rolls the profile and stored secret back, so a host-key retry cannot duplicate the saved row and a bad password does not leave a broken profile behind.
  - Unprotected SSH keys skip the keychain entirely instead of trying to store an empty passphrase.
- Refactored saved and quick connects through a shared `open_session`/`connect_session` path.
- Changed `credentials::set_secret` to take `&str` so quick-connect secrets are not cloned unnecessarily.
- Added the Quick Connect dialog with protocol/host/port/username, password or SSH-key auth, key picker, start folder, and an optional "Save this connection" switch that reveals name and group fields.
- Added Quick Connect entry points in the Connections sidebar header and the command palette.
- Extended the connection schema with `quickConnectSchema`, `emptyQuickConnectValues` and `toQuickConnectInput`; saving now requires a name and the secret the selected auth method needs.
- Host-key challenges from a quick connect keep the secret in a one-shot retry closure. Re-challenges after a retry reuse the same closure, and cancelling the host-key dialog drops the secret.
- Saved quick connects invalidate the connections query after a successful retry so the new row appears in the sidebar.

**Verified**

- `bun run check` (Biome, 62 Vitest tests, strict TypeScript, production build).
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (53 passed, 6 ignored).
- `bun run bindings`.

**Notes**

- Transient sessions have a generated `connectionId` that is intentionally absent from the sidebar; only saved profiles map to connection rows.
- The retry closure keeps the typed secret in JavaScript memory until the host key is trusted or the dialog is cancelled.

**Next**

- Add TLS options (custom CA, pinning, explicit insecure toggle with warning) and an FTP active/passive policy.
- Add reconnect, cancellation, and per-session operation timeouts surfaced in the UI.
- Run real-window visual QA for local and remote panes; add rendered component tests for the connection row, tabs, host-key dialog and quick connect.

### 2026-11-09 — Session 8: TLS options and FTP data-channel policy

**Done**

- Extended the connection model with `TlsOptions` and `FtpDataMode`. Both are optional on disk via `serde(default)`, so existing `connections.json` files keep loading.
- FTPS TLS policy:
  - System trust store by default.
  - Custom CA PEM bundle replaces the trust store.
  - Optional SHA-256 certificate pin, accepted with colons or a `sha256:` prefix and stored as canonical lowercase hex.
  - Explicit "allow invalid certificates" switch. It skips chain/hostname checks but still verifies the handshake signature and any configured pin, and the UI shows a persistent warning.
- Added `protocol/tls.rs` with the production rustls connector, a pin-enforcing verifier wrapper, and an explicit no-chain-verification verifier for the insecure toggle.
- FTP data-channel policy: passive (PASV), extended passive (EPSV), or active (PORT), applied to the suppaftp client after login. The connection form and Quick Connect expose it for FTP/FTPS only.
- Connection and Quick Connect forms now include TLS fields for FTPS and the data-channel selector for FTP/FTPS. Both dialogs scroll within the viewport.
- Added frontend validation for absolute CA paths and SHA-256 pin format, plus unit tests for pin canonicalization and TLS/FTP input mapping.
- Extended the Docker integration suite with custom-CA verification and certificate-pin enforcement tests.

**Verified**

- `tests/integration/run.sh` → 8 integration tests passed, including `custom_ca_verifies_explicit_ftps` and `certificate_pin_is_enforced`.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (56 passed, 8 ignored).
- `bun run check` (Biome, 65 Vitest tests, strict TypeScript, production build) and `bun run bindings`.

**Notes**

- The insecure toggle is intentionally opt-in per connection and never a global default.
- Active FTP depends on the server being able to reach the client's listener; it is offered for compatibility but passive remains the default.
- Certificate pins are metadata, not secrets, and are stored in `connections.json`.

**Next**

- Add reconnect, cancellation, and per-session operation timeouts surfaced in the UI.
- Run real-window visual QA for local and remote panes, including the new TLS and data-channel sections.
- Add rendered component tests for the connection row, tabs, host-key dialog and Quick Connect.

### 2026-11-09 — Session 9: reconnect, cancellation and operation timeouts

**Done**

- Added per-session operation timeouts and connect timeouts as persisted settings (`connectTimeoutSeconds`, `operationTimeoutSeconds`), with validation ranges and a new **Connections** tab in the Settings dialog.
- Added `Session::run_operation`, which serializes remote operations, bounds them with the configured timeout, and cancels them through a `CancellationToken`.
- Added `session_cancel(session_id)` to abort the operation currently holding a session's protocol stream.
- Added `session_reconnect(session_id)`, which keeps the session id and profile, retires the old stream, opens a new connection with the retained credentials, and refreshes the session metadata. Transient Quick Connect sessions can reconnect because their credentials stay in Rust memory for the session lifetime.
- Retained session credentials use `zeroize` and are zeroed when the session is dropped. They are never serialized, logged, or sent to the frontend.
- Cancelled, timed-out, or network-failed operations mark the session unusable. `fs_*` commands then return `SESSION_NOT_READY` instead of guessing whether the control channel is in sync.
- Backend emits `session://state` `Failed` when an established session becomes unusable, and `SessionInfo.usable` lets the frontend restore lost-session state after a reload.
- Frontend session store tracks `lost`, `reconnecting`, and the last visited folder per session.
- Remote pane now shows a connection-lost state with Reconnect/Disconnect actions, marks lost tabs, and offers a Cancel button while a remote listing is in flight.
- Sidebar rows show a warning dot and "Connection lost" for unusable sessions, with Reconnect actions in the row menu and context menu.
- Command palette gained "Reconnect active session" and "Cancel remote operation".
- Reconnect preserves the current folder and handles host-key challenges through the existing trust dialog.
- Added unit tests for the operation runner (success, timeout, cancellation, lost session), settings timeout validation, and the new session-store state.

**Verified**

- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (61 passed, 8 ignored).
- `bun run check` (Biome, 71 Vitest tests, strict TypeScript, production build) and `bun run bindings`.
- `tests/integration/run.sh` → 8 integration tests passed.

**Notes**

- Cancelling or timing out a protocol operation is treated conservatively: the stream is not reused because FTP has a single control channel and SFTP requests may still be in flight. The UI asks for an explicit reconnect.
- A network error during a data-channel operation also marks the session unusable. This avoids showing a listing that may be out of sync with the server.
- Reconnect uses the profile stored with the session, so a transient Quick Connect session can be retried even though it has no saved profile row.

**Next**

- Run real-window visual QA for local/remote panes, the lost-session state, and the new Connections settings tab.
- Add rendered component tests for the connection row, remote tabs, host-key dialog, Quick Connect and the lost-session pane.
- Push the repository to a remote and confirm the first CI run is green.

### 2026-11-10 — Session 10: rendered component tests

**Done**

- Added rendered tests for `RemotePane`: lost-session state with Reconnect/Disconnect, tab switching with remembered folders, and cancelling the active listing.
- Added rendered tests for `HostKeyDialog`: trusting an unknown key and retrying a transient connection, falling back to reconnecting a saved profile, warning on a changed key with the previous fingerprint, and clearing the challenge on cancel.
- Added rendered tests for `QuickConnectDialog`: connecting without saving, requiring a name before saving, revealing FTPS TLS and data-channel options, and keeping the dialog open when the connection fails.
- Added jsdom stubs for `ResizeObserver`, `scrollIntoView` and pointer capture so Radix select/tooltip primitives can render in tests.
- Made `tests/integration/generate-certs.sh` regenerate the throwaway CA and server certificate when the existing certificate expires within an hour, instead of only when the PEM file is missing. The two-day test certificate had silently expired, failing every FTPS integration test.
- Added `.github/workflows/ci.yml` with two jobs: frontend (typecheck, Biome, Vitest, production build) and Rust (rustfmt, clippy, tests) on Ubuntu with the Tauri system dependencies. It runs on pushes to `main`, pull requests and manual dispatch.

**Verified**

- `bun run check` (Biome, 86 Vitest tests, strict TypeScript, production build).
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (61 passed, 8 ignored).
- `tests/integration/run.sh` → 8 integration tests passed after regenerating the expired certificate.

**Notes**

- The rendered tests mock session actions and the IPC client; they exercise dialog state, validation and callbacks, not real networking.
- The integration certificate still has a two-day lifetime by design; the script now renews it automatically before each suite run.

**Next**

- Run real-window visual QA for local/remote panes, the lost-session state, and the Connections settings tab.
- Add rendered component tests for keyboard table navigation and the rename/delete dialogs (Phase 2).
- Push the repository to a remote and confirm the first CI run is green.

### 2026-11-10 — Session 11: local table and dialog rendered tests

**Done**

- Added rendered keyboard tests for `FileTable`: arrow/Home/End movement with shift extension, `⌘A`, `⌘⌫`, `⌘↑`, Backspace-to-parent, Enter, F2, Delete, Escape, Space toggling, type-ahead, click selection and double-click open.
- Added inline rename tests: submitting a changed name, cancelling an unchanged name, Escape handling, and rejecting names with path separators.
- Added rendered tests for `NewFolderDialog`, `DeleteDialog` and `PermissionsDialog`, covering validation, backend failures, recursive folder deletion and octal mode parsing.
- Fixed `DeleteDialog`: Radix's `AlertDialogAction` closes on click by default, so a failed delete used to dismiss the dialog and hide the error. The action now prevents the default close and waits for `onConfirm` to succeed.
- Mocked TanStack Virtual in the table test so rows render without layout measurements.

**Verified**

- `bun run check` (Biome, 101 Vitest tests, strict TypeScript, production build).
- No Rust changes in this session; the previous `cargo fmt`, clippy and test run remains valid.

**Notes**

- The rendered table test mocks the virtualizer rather than measuring layout; virtualization math is already covered by the model and 10k-entry performance checks.
- The DeleteDialog regression test asserts that a backend error leaves the dialog open, which is what caught the default-close behaviour.

**Next**

- Run real-window visual QA for local/remote panes, the lost-session state, and the Connections settings tab.
- Start Phase 4 transfers (single-file pipeline, progress, cancellation, conflicts).
- Push the repository to a remote and confirm the first CI run is green.

### 2026-11-11 — Session 12: Phase 4a single-file transfers

**Done**

- Added the unified streaming filesystem surface: `FileReader` / `FileWriter` traits with `finish` and `abort`, implemented for local files, FTP/FTPS data streams and SFTP handles.
- Added `RemoteFs::open_read` / `open_write` and `session::connect_client`, so a transfer worker can open its own protocol connection from the retained session profile and credentials instead of borrowing the browsing stream.
- Added the Rust transfer manager: per-transfer cancellation tokens, a global semaphore from `transferConcurrency`, 64 KiB chunks, progress throttling, `transfer://delta` / `transfer://removed` events, and honest terminal states. A `Cancelled`, `Timeout` or `Network` failure marks the session unusable.
- Downloads stream into a hidden `.name.sftply-part-<id>` file and atomically rename it on success; uploads write directly and best-effort delete partial remote files on failure.
- Added `transfer_preflight`, `transfer_enqueue`, `transfers_list`, `transfer_cancel` and `transfer_clear_finished` commands. `transfer_enqueue` rejects folders, symlinks and special files for 4a.
- Added the frontend transfer stack: Zustand transfer store, event bridge, TanStack Query API/actions, per-file preflight, one conflict prompt per batch (Skip / Keep both / Replace), transfer panel rows with progress/speed/ETA, and status-bar aggregation.
- Added transfer actions to the file table actions menu and context menu for both panes.
- Added unit tests for the local streaming helpers, transfer store/model, transfer list rendering, and integration streaming round trips for FTP, explicit FTPS, implicit FTPS and SFTP.

**Fixed**

- FTP directory listings joined entry paths against the _parent_ of the listed directory, so listing `/folder` returned `/child` instead of `/folder/child`. Navigation into non-root folders and recursive deletes were therefore wrong. `entries` now joins against the listed path; the streaming integration test asserts the uploaded file's listed path.
- The streaming integration tests ignored short writes. SFTP writes are packet-limited, so the 200 KB payload was silently truncated to roughly half. Tests now loop until each chunk is fully written, and payload assertions report the first differing byte instead of dumping 200 KB arrays.

**Verified**

- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (66 passed, 12 ignored).
- `bun run check` (Biome, 112 Vitest tests in 19 files, strict TypeScript, production build) and `bun run bindings` (no diff).
- `tests/integration/run.sh` → 12 integration tests passed: FTP/FTPS/SFTP CRUD, binary streaming round trips, custom CA, certificate pinning, wrong password and changed host key.
- Docker teardown leaves no containers, images, volumes, networks or build cache; generated `tests/integration/certs` removed.

**Notes**

- Pause/resume is intentionally absent: the backend has no protocol-level pause, so the UI must not pretend it exists. Resume plumbing (`offset`) is present for the future but not exposed.
- "Skip existing" is a frontend preflight decision; the backend only knows `Overwrite` and `Rename`.
- A transfer failure does not abort the rest of the queue.

**Next**

- Phase 4b: recursive folder jobs, queue-level controls, retry/history and drag-and-drop.
- Real-window visual QA for the transfer panel, conflict dialog and status bar.
- Push the repository to a remote and confirm the first CI run is green.

### 2026-11-11 — Session 13: Phase 4b recursive transfers and dev FTP server

**Done**

- Added recursive transfer planning in Rust: `transfer_plan` walks one or more selected items, includes directories so empty folders are recreated, probes conflicts per file, and reports total bytes plus skipped symlinks/special files. Guards: 50,000 entries and 64 levels of depth.
- Added `transfer_enqueue_tree`: it creates every planned remote/local directory first, then spawns file jobs from the plan. Folders and files both transfer; the target keeps the source root's leaf name.
- Extended `TransferManager` with retained job snapshots, `transfer_retry` (fresh id, only failed/cancelled jobs), queue-level `transfer_pause_queue` / `transfer_resume_queue` / `transfer_queue_paused` via a `watch` channel, and `ensure_local_parent` / `ensure_remote_dir`. Uploads use a dedicated remote connection per job.
- Added the frontend recursive flow: plan → one conflict prompt for the whole batch (Skip / Keep both / Replace) → enqueue from the plan. Skip is a frontend preflight decision; the backend only knows `Overwrite` and `Rename`.
- Added in-app drag-and-drop between panes and onto folder rows using an HTML5 `application/x-sftply-entries` payload. Dropping into the same scope is rejected with an explanation.
- Added queue pause/resume and per-row retry to the transfer panel, with paused state in the transfer store and event bridge. Per-transfer pause/resume stays hidden because the protocols do not support it honestly.
- Added `docker/dev-ftp/`: a minimal Alpine + Pure-FTPd plain-FTP server for manual testing, with compose file, entrypoint, README and `bun run dev:ftp` / `dev:ftp:down` / `dev:ftp:logs` scripts. It uses port `2121`, passive `30000-30009`, user `sftply` / `sftply-dev`, and a persistent named volume.
- Added tests: model drag payload and path-join helpers, `FileTable` drag/drop rendering, transfer-list retry/pause, backend path/direction unit tests, and FTP/SFTP `creates_nested_remote_folders` integration tests.

**Fixed**

- Clippy rejected the recursive walker's nine arguments; it is now a `PlanWalker` struct with a `walk` method.
- The frontend drop handler could pass a null destination path; it now refuses with "Choose a destination folder first" instead of sending an invalid IPC call.
- The pane drop overlay stayed visible after a drop; `dropInto` now clears it first.

**Verified**

- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (68 passed, 14 ignored).
- `bun run check` (Biome, 117 Vitest tests in 19 files, strict TypeScript, production build) and `bun run bindings` (no diff).
- `tests/integration/run.sh` → 14 integration tests passed, including nested-folder creation for FTP and SFTP.
- Manual dev server check via `curl`: root listing, upload, download and delete all succeed against `127.0.0.1:2121`.
- Docker teardown after integration leaves no containers, images, volumes or networks; generated `tests/integration/certs` removed. The dev FTP container is intentionally left running.

**Notes**

- Queue pause stops new jobs from starting; running transfers finish. There is no per-transfer pause.
- Transfer history is still in memory only; it does not survive an app restart.
- Drag-and-drop is in-app only. Dropping files from Finder or dragging out to the OS is not implemented yet.
- The dev FTP server is plain FTP and advertises `127.0.0.1` as its passive address, so it is for local manual testing only. The automated matrix in `tests/integration` remains the TLS/SFTP coverage.

**Next**

- Phase 4c: large-file and broken-connection hardening, a 1,000-item queue test, and a wider server matrix.
- Persist transfer history and add OS file drag-and-drop (Finder → pane, drag-out).
- Real-window visual QA for the transfer panel, conflict dialog, drag overlay and status bar.
- Push the repository to a remote and confirm the first CI run is green.

### 2026-11-11 — Session 14: drag-and-drop, auto-refresh and anonymous FTP

**Fixed**

- Cross-pane drag-and-drop never transferred anything. The drop handler used the hook's "other pane" target, so dropping local files into the remote pane resolved to local→local and was rejected. `transferFrom` now targets the pane that received the drop, and uses that pane's current folder when no folder row was targeted. Added hook tests for both directions.
- Drag payloads now also set a `text/plain` mirror, and drop targets accept either MIME. Some WebViews hide custom MIME types during dragover; reads still validate the JSON, so arbitrary text drops are ignored.
- The destination pane did not refresh after a transfer finished. The transfer bridge now invalidates the `["fs"]` query family when a transfer reaches `completed`, `failed` or `cancelled`, coalescing a whole batch into one refresh after 250 ms. Added bridge tests for terminal and running events.
- `bun run tauri -- dev` failed with "could not determine which binary to run" because the crate has both `sftply` and `export-bindings`. Added `default-run = "sftply"` to `Cargo.toml`.

**Added**

- Anonymous FTP/FTPS support: leaving the username blank maps to the conventional `anonymous` account, and the password may be left blank or set to an email/identifier if the server requires one. The connection form and Quick Connect explain this next to the username field.
- Saved anonymous connections reconnect without a keychain entry: the password resolver falls back to an empty password only for the `anonymous` username. Quick Connect also allows saving anonymous profiles without a secret. SFTP still requires a username.
- Schema and Rust validation tests for blank FTP usernames, anonymous saved profiles and the unchanged SFTP requirement.

**Verified**

- `bun run check` (Biome, 125 Vitest tests in 21 files, strict TypeScript, production build).
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (68 passed, 14 ignored).
- `bun run bindings` (no diff).
- `tests/integration/run.sh` → 14 integration tests passed. The dev FTP server was stopped temporarily because both stacks bind port 2121, then restarted.
- `cargo metadata` reports `default_run = "sftply"`.

**Notes**

- Anonymous login uses an empty password by default. Some public servers expect an email address as the anonymous password; entering one in the password field is supported.
- SFTP cannot be anonymous: SSH always needs an account name, even when the key is the only credential.
- The dev FTP server still uses `-E` (anonymous disabled) and stays running on `127.0.0.1:2121` with `sftply` / `sftply-dev`.

**Next**

- Re-run manual QA of drag-and-drop and post-transfer refresh in the real Tauri window.
- Phase 4c hardening and persistent transfer history.

### 2026-11-12 — Session 15: native drag interception, settings layout and 3DS diagnostics

**Fixed**

- In-app drag-and-drop did nothing in the packaged window. Tauri installs a native drag-drop handler on the webview by default, and on macOS wry reports the drag as handled before WKWebView can dispatch `dragover`/`drop`; the HTML5 handlers never ran. The main window now sets `dragDropEnabled: false`, so HTML5 drag events reach the page. OS file drops were not implemented yet, so nothing regresses.
- Drag targets also relied on `dataTransfer.types`, which WebKit can hide during `dragover`. The drag payload is now kept in memory between `dragstart` and `dragend`, and `isTransferDrag`/`readTransferDrag` fall back to it. The in-memory copy is cleared on drop and on `dragend`.
- The settings dialog rendered at 384 px because the base `sm:max-w-sm` won over `max-w-2xl` in the generated stylesheet, clipping the two-column tab layout. It now uses `sm:max-w-2xl`.
- The settings dialog was taller than the window because every `TabsContent` used `forceMount`, and Radix keeps forced panels mounted _and visible_ (`hidden` is tied to presence, not selection). All five sections stacked into one column. Removed `forceMount` so only the active panel renders, and capped the form at `min(600px, 100vh - 3rem)` with the content area scrolling.

**Added**

- `three_ds_compat` test: a mock server reproduces `ftpd` on the 3DS (FEAT with a blank line before `211 End`, no MLSD, POSIX listings, `150` only after the passive data connection is accepted). The FTP adapter connects and lists it, so the 3DS failure was environmental (console permissions), not the handshake.
- Per-phase FTP handshake logs (`FTP connect: …`, `FTP handshake failed` with the failing phase) and session connect/failure/timeout logs. Credentials are never logged.
- Actionable network errors for FTP: unreachable host, refused connection, reset connection and DNS failures each explain what to check instead of a generic "Could not reach the FTP server".
- `SettingsDialog` tests: only the active panel renders, tabs switch without closing the dialog, and Save persists the edited value and closes.
- Persistent transfer history (Phase 4b): `transfer/history.rs` keeps the last 1,000 terminal transfers in `transfer-history.jsonl`, one JSON object per line, rewritten atomically. Entries carry pane labels and counters only, never paths or credentials. `transfer_history` / `transfer_clear_history` expose it, and the bottom panel has a History tab with a clear action. The transfer bridge invalidates it when a batch finishes.
- History store tests: terminal-only recording, id replacement, the 1,000-entry bound, malformed-line skipping, reload and clear.

**Verified**

- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (76 passed, 14 ignored).
- `bun run check` (Biome, 132 Vitest tests in 23 files, strict TypeScript, production build).

**Next**

- Confirm drag-and-drop, the settings dialog and the History tab in the real Tauri window.
- Phase 4b remainder: bandwidth limiter and external OS file drops.
- Phase 4c hardening: server matrix, >4 GiB files, 1,000 queued items, retry safety.
- Push the repository to a remote and confirm the first CI run is green.

### 2026-11-12 — Session 16: named themes and a robust sidebar

**Added**

- Eight built-in palettes next to System/Dark/Light: One Dark, Gruvbox Dark, Gruvbox Light, Nord, Dracula, Solarized Light, Tokyo Night and Catppuccin Mocha. `ThemeMode` gained camelCase variants (`oneDark`, `gruvboxDark`, …) while keeping the legacy `system`/`dark`/`light` values loadable; a Rust round-trip test locks the ids.
- `src/lib/themes.ts` is the single catalogue for labels, icons, dark/light flags and preview swatches. The settings gallery, title-bar menu and command palette all read from it, so a new theme only needs a Rust variant plus a CSS block.
- `applyDocumentTheme` now writes `<html data-theme>` as well as `.dark` and `color-scheme`. `theme-init.js` resolves the same map before React paints, and `index.html` starts with `data-theme="dark"`.
- Full CSS variable blocks for every named palette, declared after `.dark` so they override the base palettes. Light named themes drop `.dark`, so Tailwind `dark:` variants stay correct.
- Settings gallery shows a colour swatch per theme in a two-column grid; the title-bar menu scrolls and separates the named palettes from the base modes.

**Fixed**

- The sidebar could be dragged narrow enough to clip a connection card's action buttons. It is now clamped to 240–420 px in the shell (legacy persisted values are clamped on read), and connection rows truncate the name, host and group instead of overflowing. The name/host spans now carry `min-w-0`, which is what actually let a nowrap string push the buttons out of view.

**Verified**

- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (77 passed, 14 ignored).
- `bun run check` (Biome, 136 Vitest tests in 23 files, strict TypeScript, production build).
- Theme tests cover named-palette resolution, `data-theme`, the catalogue/ids invariant, and saving a named palette from the settings gallery.

**Next**

- Confirm the theme gallery, sidebar limits and existing drag-and-drop/settings/History fixes in the real Tauri window.
- Phase 4b remainder: bandwidth limiter and external OS file drops.

### 2026-11-12 — Session 17: desktop text-selection policy

**Changed**

- The webview no longer behaves like a web page: `html` sets `user-select: none`, so labels, rows, chrome and dialogs cannot be dragged-selected by accident. Inputs, textareas, `contenteditable`, `pre` and `code` opt back in, and a `.selectable` utility marks the few read-only regions where copying is useful.
- `.selectable` is applied to host-key fingerprints, the Settings About paths, the file-pane path, activity messages, transfer errors, conflict paths and permission previews. A text cursor signals the opt-in.
- Images and links no longer drag out of the window (`-webkit-user-drag: none`).
- Because rows are no longer selectable, file menus gained **Copy path** (context menu and the per-pane actions menu). It copies every selected path, or the folder path when the menu is opened on empty space, and reports success or failure.

**Verified**

- `bun run check` (Biome, 137 Vitest tests in 23 files, strict TypeScript, production build). New test: the file row context menu dispatches `copy-path`.

### 2026-11-12 — Session 18: app icon and branding

**Added**

- `src-tauri/icons/app-icon.svg` is the 1024 px master icon: a violet→blue rounded square with a soft top sheen, a hairline highlight and two bold white transfer arrows. It replaces the stock Tauri icon in the bundle.
- Regenerated every desktop asset with `bunx tauri icon src-tauri/icons/app-icon.svg`: PNG sizes, `icon.icns`, `icon.ico` and the Microsoft Store logos. The generated `android/` and `ios/` trees were deleted because the project ships desktop targets only.
- `public/mark.svg` is the same mark cropped to the tile, used as the favicon, and `index.html` gained a `theme-color` matching the icon.
- `BrandMark` now renders the new mark, so the title bar, boot screen and Settings → About all show the real app icon instead of a placeholder.

**Verified**

- Rendered the mark at 32/64/128/1024 px and the favicon through `qlmanage` to confirm the arrows stay legible at small sizes.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (77 passed, 14 ignored).
- `bun run check` (Biome, 137 Vitest tests in 23 files, strict TypeScript, production build).

**Next**

- Restart `bun run tauri -- dev` to pick up the new bundle icon, then verify Dock icon, title bar, boot screen, About tab and favicon.
- Phase 4b remainder: bandwidth limiter and external OS file drops.

### 2026-11-12 — Session 19: shortcuts reference in Settings

**Added**

- Settings gained a **Shortcuts** tab that lists every binding by scope: Application, Browsing, Files and selection, and Dialogs and menus.
- `src/lib/shortcuts.ts` is the single catalogue. It stores platform-neutral chords (`mod+Shift+KeyN`) and formats them as `⌘⇧N` on macOS or `Ctrl+Shift+N` on Windows/Linux, including the platform-specific delete binding (`⌘⌫` vs `Delete`).
- The tab uses the existing `Kbd` component, so the reference looks like the rest of the chrome.

**Fixed**

- The path bar already advertised `⌘[`, `⌘]` and `⌘↑` in its tooltips, but no handler existed. They now go back, forward and to the enclosing folder for the active pane. `⌘↑` defers to the file table's own handler when a row has focus, so navigation never runs twice.
- The architecture keyboard map now reflects what the app actually binds instead of the initial aspirational list.

**Verified**

- `bun run check` (Biome, 143 Vitest tests in 24 files, strict TypeScript, production build). New tests cover chord formatting on both platforms, the delete override, and the Settings tab rendering `⌘K`.

**Next**

- Add a global `?` shortcut that opens Settings directly on the Shortcuts tab.

### 2026-11-12 — Session 20: bandwidth limiter and live queue settings

**Added**

- A shared bandwidth limiter in `TransferManager`. Chunks reserve a slot in a leaky-bucket schedule before sleeping, so the limit applies to the combined speed of every concurrent transfer instead of multiplying with concurrency. Cancellation interrupts the sleep immediately.
- Settings → Transfers now exposes **Bandwidth limit** in kbps, with an empty field meaning unlimited. The existing `bandwidthLimitKbps` setting was persisted and validated in Rust but had no UI and no effect until now.
- `?` opens Settings directly on the Shortcuts tab, and the command palette gained a **Keyboard shortcuts** command. The Shortcuts catalogue documents the new binding.
- The transfer panel virtualizes queues above 50 rows, so a 1,000-item queue only mounts the visible window instead of re-rendering every row on each progress tick. `ScrollArea` accepts a `viewportRef` for this.

**Fixed**

- Changing **Simultaneous transfers** used to require a restart: the semaphore was built once at startup. The queue now uses an atomic active-slot gate, so raising or lowering the limit affects transfers that are already waiting, and running transfers are left alone.
- The Settings footer no longer shifts while saving. The submit button used to insert the spinner only while saving, which widened the right-aligned button by the icon plus gap and visibly dragged **Cancel** with it for a frame. The label now stays in the layout (transparent while saving) and the spinner overlays it, so the footer geometry stays fixed without adding empty space.

**Verified**

- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (80 passed, 14 ignored). New Rust tests cover kbps→bytes conversion, slot spacing, resetting the schedule when the limit is removed, and growing concurrency while tasks wait.
- `bun run check` (Biome, 147 Vitest tests in 24 files, strict TypeScript, production build). New tests cover saving a bandwidth limit, opening Settings on the Shortcuts tab, virtualizing a 1,000-item queue, and keeping the submit button geometry stable while saving.

**Next**

- Phase 4c hardening: >4 GiB files, broken connections, retry safety and the wider server matrix.
- External OS file drops remain blocked by Tauri's `dragDropEnabled` trade-off with in-app HTML5 drag and drop.

### 2026-11-13 — Session 21: atomic uploads and download cleanup

**Changed**

- Uploads no longer truncate the destination before the bytes arrive. Each upload streams into a hidden sibling (`.<name>.sftply-part-<id>`) and is renamed into place only after both the reader and writer finish, so a cancelled or failed transfer leaves the previous remote file untouched. Servers without rename fall back to writing the target directly.
- Overwriting a file that the server refuses to rename over uses a backup-and-restore sequence: the old file moves to a hidden backup, the new file is renamed in, the backup is deleted, and the old file is restored if the final rename fails. The caller discards the finished temporary upload on failure because the local source is still intact and retry is the recovery path.
- Partial and backup names are bounded to 255 bytes and truncated on a UTF-8 boundary, so long or non-ASCII target names cannot produce invalid remote names.
- Downloads now clean up their temporary file when the reader or writer fails to finish, not only when the copy loop fails. If finalization itself fails, the completed temporary file is kept because it is the only copy of the downloaded bytes.

**Verified**

- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (84 passed, 14 ignored). New Rust tests cover bounded partial names, remote partial/backup paths, a successful atomic replacement, and restoring the previous file when the final rename fails.
- `bun run check` (Biome, 148 Vitest tests in 24 files, strict TypeScript, production build). New frontend test covers byte formatting above 4 GiB without unit fallback.
- Added real-server integration tests that run the exact upload sequence (write a hidden sibling, then `replace_remote_file`) against explicit FTPS, implicit FTPS and SFTP, including a non-ASCII name whose partial name lands on the 255-byte limit. 13 tests passed across FTPS/SFTP streaming, CRUD, custom CA, certificate pinning, changed host key and atomic replacement. Plain FTP tests were skipped because the manual dev container owns port 2121; the integration stack, volumes and images were removed afterwards.

**Next**

- Verify a failed/cancelled upload preserves the previous remote file in the real Tauri window against the dev FTP container; restart `bun run tauri -- dev` first because the change is in Rust.
- Continue Phase 4c: broken connections, retry duplicate-data proof, and the wider server matrix.

### 2026-11-13 — Session 22: stalled connections time out and cancel

**Changed**

- Transfer I/O now bounds idle time, not total duration. Every chunk read, chunk write, open and metadata call has a 60-second timeout, so a half-open socket fails with the retryable `TIMEOUT` error instead of leaving the row `Running` and a concurrency slot occupied forever. Large transfers that keep making progress are unaffected.
- Reads and writes select on the cancellation token, so **Cancel** wins immediately even while the socket is stalled; the pending future is dropped and the existing abort/cleanup path removes the partial upload or download.
- The protocol `finish()` call (which waits for the server's completion reply) and `disconnect()` are bounded too. Disconnecting a dead control channel no longer delays the final status, and upload finalization is covered by the same timeout with cleanup on expiry.
- Added `tokio`'s `test-util` feature as a dev-dependency so timeout tests can use paused time instead of sleeping.

**Verified**

- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (87 passed, 18 ignored). New tests use a never-resolving reader and writer with paused Tokio time to prove the idle timeout yields a retryable `TIMEOUT`, and that cancellation interrupts a stalled read.
- No frontend changes; the last `bun run check` remains green (148 tests).

**Next**

- Verify cancel-while-stalled and reconnect behavior in the real Tauri window.
- Continue Phase 4c: retry duplicate-data proof and the remaining server matrix (disk-full, auth expiry, permission changes).
