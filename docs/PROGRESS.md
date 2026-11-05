# sftply — Progress Log & Continuation Notes

**Purpose:** This is the single source of truth for what is built, what is verified, and what to do next. Update it at the end of every work session so work can resume on another day without re-discovery.

**Last updated:** 2026-11-05  
**Current phase:** Phase 0 — validation and project setup (in progress)  
**Overall status:** Design approved by user; implementation starting.

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

| Topic | Default in use | Notes |
| --- | --- | --- |
| Protocol stack | suppaftp 12 + russh 0.65 / russh-sftp 3.0.1 | Phase 0 spikes must validate |
| FTPS TLS | rustls + platform verifier | Fallback: native-tls if integration proves impractical |
| Product name | `sftply` | Rename before branding/icons if requested |
| Platform priority | macOS-first, Windows/Linux kept buildable | CI parity added as platform work progresses |
| Lint/format | Biome for TS; rustfmt + clippy | ESLint/Prettier swap is contained if requested |
| Advanced features | After a reliable 1.0 core | Permissions/bookmarks/editor/compare/sync in Phase 6 |
| Git | Initialized locally, checkpoint commits | Never commit secrets or build artifacts |

---

## Current status

### Completed

- [x] Repository analysis and architecture package (`docs/`)
- [x] ADRs 0001–0005 (proposed)
- [x] Progress log created

### In progress

- [ ] Phase 0: git initialization, toolchain, CI skeleton, spike validation
- [ ] Phase 1: foundation, design system, app shell, settings, typed IPC

### Known issues / blockers

- None yet.
- FTPS/SFTP integration spikes require local test servers (Docker or local daemons). If unavailable, compile-time validation is done now and runtime integration is deferred with an explicit marker.

---

## Phase 0 — Validation and project hygiene

- [ ] Initialize git repository and checkpoint commit
- [ ] Pin Rust toolchain (`rust-toolchain.toml`)
- [ ] Confirm Bun usage and add scripts (`dev`, `build`, `typecheck`, `lint`, `format`, `test`, `check`)
- [ ] Install and configure frontend foundations
- [ ] Initialize shadcn/ui + Tailwind v4
- [ ] Add CI skeleton (frontend + Rust + audit)
- [ ] Spike: suppaftp + FTPS API compiles; custom rustls connector shape validated
- [ ] Spike: russh 0.65 + russh-sftp 3.0.1 compile together
- [ ] Spike: tauri-specta command/event generation
- [ ] Spike: keyring 4 store/read/delete
- [ ] Record spike results in `docs/DEPENDENCIES.md` or a new ADR

### Phase 0 exit criteria

- CI green for template/foundation.
- Protocol crates compile in our module structure.
- Typed IPC generation works.
- Known limitations documented; no security fallback chosen silently.

---

## Phase 1 — Foundation: shell, design system, typed boundary

- [ ] Design tokens (dark default + light), typography, density, scrollbars, focus rings
- [ ] shadcn primitives installed and reviewed
- [ ] App shell: title bar, sidebar, workspace split, bottom panel, status bar
- [ ] Resizable layout with persisted sizes
- [ ] Theme switcher (system/dark/light), no flash
- [ ] Sidebar sections and honest disconnected/empty states
- [ ] Command palette skeleton (Cmd/Ctrl+K)
- [ ] Rust foundation: AppState, AppError, logging + redaction, config paths, atomic JSON store
- [ ] Settings get/update commands + persistence
- [ ] tauri-specta typed bindings + invoke wrapper + event bridge
- [ ] Window defaults (1440×900, min 960×600), state persistence
- [ ] Strict CSP and minimal capabilities
- [ ] Tests: config atomic write, error normalization, theme/settings store, command registry

### Phase 1 exit criteria

- Polished shell launches, themes switch, layout persists.
- Settings survive restart; corrupt config has a recovery path.
- Typed IPC regenerates deterministically.
- No fake features; panes clearly show "not connected".

---

## Phase 2 — Local filesystem and file browser

- [ ] Local filesystem Rust service (list/stat/mkdir/rename/delete/chmod/open/reveal)
- [ ] Path validation + sanitization + property tests
- [ ] Virtualized file table (name, size, modified, permissions, kind)
- [ ] Breadcrumbs + history + keyboard path entry
- [ ] Selection model (click, mod-click, shift-range, select all, type-ahead)
- [ ] New folder, inline rename, delete confirmation, permissions dialog
- [ ] Context menu + keyboard access
- [ ] Hidden files toggle, filter, sort, column config
- [ ] Loading/empty/error/permission-denied states
- [ ] 10k-entry performance check
- [ ] Tests: selection/sort reducers, path invariants, keyboard table, rename/delete flows

### Phase 2 exit criteria

- Fully usable local file manager by keyboard.
- 10k entries meet performance budget.
- No mock listings in production paths.

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

Commands will be enabled as phases progress. Current intended commands:

```bash
# Frontend
bun run typecheck
bun run lint
bun run test
bun run build

# Rust
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test

# Full gate (to be added)
bun run check
```

**Last verification run:** not yet (Phase 0 setup in progress).

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
