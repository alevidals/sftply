# sftply — Progress Log & Continuation Notes

**Purpose:** This is the single source of truth for what is built, what is verified, and what to do next. Update it at the end of every work session so work can resume on another day without re-discovery.

**Last updated:** 2026-11-08  
**Current phase:** Phase 3 in progress — FTP/FTPS/SFTP adapters, session lifecycle, remote browsing, host-key trust and connection status are implemented. Remaining: quick connect, TLS verification options, reconnect/cancellation, Docker protocol integration, and visual QA.  
**Overall status:** Phase 1 shell, Phase 2 local browser and the Phase 3 connection/remote-browsing slice are implemented with automated gates green. Runtime protocol integration against real servers, rendered component tests and real-window visual QA remain pending.

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
- [ ] Rendered component tests for keyboard table navigation and rename/delete dialog flows
- [ ] Phase 0 CI skeleton (frontend + Rust + audit)

### Known issues / blockers

- No CI workflow exists yet; all gates are currently run locally.
- Runtime FTPS/SFTP/keyring spikes still need local test servers (Docker or local daemons). Compile-time validation proceeds without them; protocol crates and their features are not yet added to `Cargo.toml`.
- The `suppaftp`/implicit-FTPS and `russh` + `russh-sftp` version pairings remain unproven at runtime; if they fail, the dependency ADRs must be updated before Phase 3.
- `tauri-specta` v2 RC is pre-release. Bindings regenerate deterministically today, but upgrades must be reviewed deliberately and must not be assumed semver-safe.
- The production JS bundle is a single chunk slightly above Vite's 500 kB warning threshold (≈781 kB raw / 238 kB gzip). Code splitting belongs in the Phase 5 performance pass unless it starts blocking work.
- Biome's `useSemanticElements` / `useFocusableInteractive` are disabled for the virtualized file table and column header only. They are an ARIA grid with a single roving tab stop, not semantic `<table>` markup; keyboard access is handled on the grid container.

---

## Phase 0 — Validation and project hygiene

- [x] Initialize git repository and checkpoint commit (`b0efcfd`)
- [x] Pin Rust toolchain (`rust-toolchain.toml`, 1.99.1 with rustfmt + clippy)
- [x] Confirm Bun usage and add scripts (`dev`, `build`, `typecheck`, `lint`, `format`, `test`, `check`, `bindings`, Rust gates)
- [x] Install and configure frontend foundations (React 19, TS 6 strict, Tailwind v4, Biome 2, Vitest + Testing Library, Zustand, TanStack Query/Virtual, RHF + Zod, cmdk, sonner, dnd-kit, tinykeys)
- [x] Initialize shadcn/ui + Tailwind v4 (Radix base, `nova` preset, 28 primitives)
- [ ] Add CI skeleton (frontend + Rust + audit)
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

**Status:** Typed IPC works. CI, protocol crates and keyring spikes remain outstanding.

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
- [ ] Rendered component tests for the keyboard table and rename/delete dialogs
- [ ] Visual runtime QA of the local browser in the Tauri window

### Phase 2 exit criteria

- Fully usable local file manager by keyboard — implemented; manual runtime pass pending.
- 10k entries meet performance budget — listing took **71.9 ms** locally (5 s test ceiling).
- No mock listings in production paths — local commands call the real filesystem; remote scopes return `UNSUPPORTED`.

**Status:** Backend and frontend implementation complete, automated gates green. Runtime visual QA and rendered interaction tests remain.

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

### Phase 3 exit criteria

- Browse and mutate files over FTP, FTPS and SFTP.
- Unknown SSH host requires explicit trust; changed key blocks.
- Credentials only in OS keychain and Rust memory.

---

## Phase 4 — Transfers

- [ ] 4a: single-file pipeline, progress, cancellation, conflicts, temp download
- [ ] 4b: recursive jobs, queue control, pause/resume where supported, retry, history, drag-and-drop
- [ ] 4c: hardening (large files, broken connections, 1000-item queue, server matrix)
- [ ] Transfer panel UI + status bar aggregation
- [ ] Integration tests across protocols
- [ ] Honest capability gating verified

### Phase 4 exit criteria

- Reliable upload/download of files and folders.
- Cancel/retry/conflict/disconnect paths tested.
- No fake pause/resume; no success before finalization.

---

## Phase 5 — Polish and productivity

- [ ] Full command palette + shortcut sheet
- [ ] Complete keyboard map and scopes
- [ ] Context menus everywhere + disabled reasons
- [ ] Tabs polish (overflow, reorder, close behavior)
- [ ] All empty/loading/error/first-run states
- [ ] Density/column/date/size preferences
- [ ] Accessibility audit (keyboard, labels, contrast, reduced motion)
- [ ] Startup/scroll/memory performance pass
- [ ] App icon, metadata, packaging (macOS signing/notarization; Windows/Linux)
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

**Last verification run:** 2026-11-06 — all gates green.

| Gate                 | Result                                                         |
| -------------------- | -------------------------------------------------------------- |
| `bun run typecheck`  | pass                                                           |
| `bunx biome check .` | pass                                                           |
| `bun run test`       | 49 tests pass in 8 files (includes 10k sort/filter smoke test) |
| `bun run build`      | pass (single JS chunk warning, see known issues)               |
| `cargo fmt --check`  | pass                                                           |
| `cargo clippy`       | pass with `-D warnings`                                        |
| `cargo test`         | 29 tests pass (includes 10k listing budget test)               |
| `bun run bindings`   | regenerates `src/lib/ipc/bindings.ts` deterministically        |

**Performance:** listing 10,000 local entries took **71.9 ms**; the automated test fails above 5 s to tolerate slow CI hardware.

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
