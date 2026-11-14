# sftply — Implementation Roadmap

**Status:** Proposed — no implementation starts until approved.  
**Method:** Incremental phases with explicit exit criteria. Each phase ends with a runnable build and a review gate. Later phases are not started while an earlier phase has unresolved reliability or security defects.

Sizes are relative (`S` ≈ small, `M` ≈ medium, `L` ≈ large), not calendar commitments. The critical-path risk is protocol/FTPS/SFTP correctness, so Phase 0 exists specifically to retire it before UI work expands.

---

## Phase 0 — Validation spikes and project hygiene

**Goal:** Retire protocol and toolchain uncertainty. Produce evidence, not assumptions.

| Deliverable        | Details                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| Git repository     | Initialize, commit template, add `.gitattributes`, confirm secrets/build artifacts ignored              |
| Toolchain baseline | `rust-toolchain.toml`, Bun version pin, scripts for dev/build/typecheck/lint/test/check                 |
| CI skeleton        | Frontend typecheck + build + tests; Rust fmt + clippy + tests; `cargo-deny`; `cargo-audit`; `bun audit` |
| FTPS spike         | Explicit + implicit FTPS, custom CA, pin, hostname rejection, MLSD/LIST, resume, abort                  |
| SFTP spike         | russh 0.65 + russh-sftp 3.0.1, password/key/passphrase, host-key callback, chmod, concurrency, >4 GiB   |
| Typed IPC spike    | `tauri-specta` command + event generation, TypeScript compile, CI diff check                            |
| Keychain spike     | macOS Keychain store/read/delete; failure behavior                                                      |
| Shell spike        | Strict CSP, custom title bar, native drag-drop, window-state restore                                    |

**Exit criteria**

- Each spike has a reproducible test or a documented failure with a chosen alternative.
- ADR-0002 (protocol stack) and ADR-0003 (credentials) are updated with measured findings.
- CI is green on the template.
- No product UI beyond a temporary harness is merged.

**Explicitly not in this phase:** application shell, design system, real file browsing, persistence.

---

## Phase 1 — Foundation: shell, design system, typed boundary

**Goal:** A polished, empty application that already behaves like a serious desktop tool.

| Area                     | Deliverable                                                                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design system            | Tailwind v4 tokens, dark/light themes, typography, focus rings, scrollbars, density modes                                                                                               |
| UI primitives            | shadcn base components installed and reviewed: button, input, dialog, dropdown, context menu, tooltip, tabs, checkbox, switch, select, command, toast, progress, separator, scroll area |
| App shell                | Custom title bar (macOS overlay traffic lights; Windows/Linux controls), sidebar, dual panes, bottom panel, status bar, resizable splits, collapse behavior                             |
| Theming                  | System/dark/light persistence; no flash of wrong theme                                                                                                                                  |
| Navigation skeleton      | Sidebar sections (Quick Connect, Saved, Favorites, Recent), tabs, empty workspace state                                                                                                 |
| Command palette skeleton | Registry, Cmd/Ctrl+K, grouped commands, disabled-command reasons                                                                                                                        |
| Backend foundation       | `AppState`, error model, logging + redaction, config paths + atomic store, event bus, settings commands                                                                                 |
| Typed IPC                | Generated `bindings.ts`, typed invoke wrapper, event bridge, error normalization                                                                                                        |
| Window                   | 1440×900 default, min 960×600, state persistence, macOS overlay styling                                                                                                                 |
| Tests                    | Token/theme smoke, command registry, IPC wrapper, settings store; Rust config atomic-write tests                                                                                        |
| Security config          | Strict CSP, minimal capabilities, no fs/shell plugins, devtools disabled in release                                                                                                     |

**Exit criteria**

- `bun run tauri dev` opens a polished shell with working dark/light themes.
- Layout is keyboard navigable; focus states are visible; reduced motion respected.
- Settings persist atomically and survive restart; invalid/corrupt config produces a clear recovery path.
- IPC types regenerate deterministically in CI.
- No mocked feature is presented as functional; panes show honest "not connected" states.

---

## Phase 2 — Local filesystem and file browser

**Goal:** A genuinely usable local file manager before any network is involved.

| Area                      | Deliverable                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Local FS backend          | `FileSystem` implementation over `tokio::fs`; list, stat, mkdir, rename, delete, chmod (Unix), open/reveal             |
| Path safety               | `LocalPath` canonicalization, traversal checks, filename sanitization, symlink policy, tests/property tests            |
| File table                | Virtualized, sortable columns (name, size, modified, permissions, kind), column config, directory-first toggle         |
| Navigation                | Breadcrumb with overflow, back/forward/up, keyboard path entry, per-pane history                                       |
| Selection                 | Click, Cmd/Ctrl-click, Shift-range, select all, cursor/anchor, type-ahead, ARIA grid semantics                         |
| Actions                   | New folder, rename inline, delete with confirmation, copy path, refresh, open/reveal, permissions dialog (Unix)        |
| Filtering                 | Hidden files toggle, substring filter, filtered-state indicator, empty/loading/error states                            |
| Interactions              | Context menu (Shift+F10), inline rename, drag-and-drop within local, multi-select drag                                 |
| Performance               | 10k-entry directory budget; measured render/scroll; no sync I/O on the UI thread                                       |
| Tests                     | Path invariants, sort/selection reducer, keyboard table behavior, rename/delete flows, component tests with mocked IPC |
| Light/remote placeholders | Right pane demonstrates disconnected/empty states and capability gating without fake data                              |

**Exit criteria**

- A user can browse, sort, filter, select, create, rename, delete, chmod (Unix), and navigate local files entirely by keyboard.
- 10,000 entries render and scroll within budget.
- Corrupt names, symlinks, permission errors, and disappearing files are handled with clear errors.
- No hardcoded mock listings in production paths.

---

## Phase 3 — Connections: profiles, credentials, FTP/FTPS/SFTP browsing

**Goal:** Real remote browsing over all three protocol families with strict security.

| Area                  | Deliverable                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Connection repository | Versioned `connections.json`, folders, favorites, recent list, duplicate, delete, reorder, search                         |
| Connection form       | RHF + Zod; General / Authentication / Advanced / TLS tabs; test-before-save; inline validation                            |
| Credentials           | keyring-backed password/passphrase; "stored" status; delete on profile delete; no read command; no plaintext              |
| Quick Connect         | Transient credentials, optional save, recent update                                                                       |
| Protocol: FTP         | suppaftp adapter, FEAT, MLSD + LIST fallback, passive/active policy, UTF-8, timeouts, error mapping                       |
| Protocol: FTPS        | Explicit and implicit, custom rustls verifier, CA file, pin, verify toggle with warning                                   |
| Protocol: SFTP        | russh/russh-sftp adapter, password/key/passphrase auth, keepalive, realpath, v3 ops, extensions                           |
| Host keys             | App-managed known_hosts, trust dialog with SHA-256 fingerprint, changed-key hard block, security settings                 |
| Session lifecycle     | Actor state machine, events, connect/disconnect/reconnect, cancellation, timeouts                                         |
| Remote browser        | Same file table against remote scope; capability-driven actions; remote path validation                                   |
| Tabs                  | Multiple simultaneous connections, per-tab local/remote paths, close confirmation, tab switching                          |
| Connection UX         | Sidebar status indicators, latency, protocol/cipher badges, reconnect, error details                                      |
| Security review       | Threat-model checklist, redaction tests, no secrets in logs/export, path traversal tests                                  |
| Tests                 | Parser fixtures, known_hosts, path validation, form tests, host-key dialog, session state tests; Docker integration suite |

**Exit criteria**

- Connect to OpenSSH SFTP, vsftpd/Pure-FTPd FTP, explicit FTPS and implicit FTPS test servers.
- Browse, navigate, create/rename/delete remote files with capability-accurate controls.
- Unknown SSH hosts require explicit trust; a changed key blocks the connection.
- Passwords/passphrases exist only in Keychain and Rust memory; verified by inspecting config, logs, and exported data.
- Two remote sessions can be open simultaneously in different tabs without UI blocking.

**Deliberate limitation:** no transfers yet; actions that require them are disabled or absent.

---

## Phase 4 — Transfers

**Goal:** Trustworthy upload/download, including large trees, failures, cancellation, and honest progress.

Split into three reviewable increments.

### 4a — Single-file pipeline

- Transfer job/item model, queue, global semaphore (1–8, default 3).
- Streaming reader/writer handles with explicit `finish()`/`abort()`.
- Chunked transfer with cancellation, timeouts, counting, progress batching.
- Temp-file download + atomic rename.
- Conflict preflight and policy (overwrite/skip/rename/apply-to-all).
- Events, store projection, transfer panel rows, status bar.
- Unit tests for counting/finalization/conflicts; integration across FTP, FTPS, SFTP.

### 4b — Recursive jobs and queue control

- Recursive upload/download with directory creation, empty directories, symlink policy, cycle guards.
- Folder jobs with child items and aggregate progress.
- Pause/resume only where capabilities allow; cancel individual/all; retry failed; clear completed.
- Concurrency and queue pause; bandwidth limiter.
- Transfer history persistence, bounded and redacted.
- Drag-and-drop between panes; external OS drop onto panes.
- Conflict handling for folder merges; skip/rename semantics.

### 4c — Hardening

- Server matrix tests: resume, aborts, broken connections, DNS failure, auth expiry, disk-full, permission changes.
- Large files (>4 GiB), non-ASCII names, long paths, many small files.
- Ensure UI remains responsive with 1,000 queued items and 8 concurrent transfers.
- Memory/CPU profiling; event rate verification.
- Retry semantics proven not to duplicate data; failed transfers never marked complete.

**Exit criteria**

- Upload/download single files and folders on FTP, FTPS and SFTP with correct progress and finalization.
- Cancel leaves no misleading success and cleans up partial downloads.
- Pause is shown only when truly supported; resume verifies size/offset.
- Conflict dialog prevents silent overwrites.
- No UI freeze; event rate within budget; history survives restart without secrets.
- Integration tests cover success, cancel, retry, conflict, and disconnect paths.

---

## Phase 5 — Desktop polish and productivity

**Goal:** Make the product feel like Linear/VS Code rather than a utility window.

| Area            | Deliverable                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------- |
| Command palette | Full registry, context-aware commands, fuzzy search, shortcut hints, recent commands               |
| Keyboard        | Complete shortcut map, shortcut sheet, scope stack, platform labels, discoverability               |
| Context menus   | Pane, row, tab, sidebar, transfer; capability-aware disabled reasons                               |
| Tabs            | Tab overflow, drag reorder, close behavior, session restore prompts                                |
| States          | First-run onboarding, disconnected, empty, loading, error, filtered-empty, permission-denied       |
| Density         | Compact/comfortable rows, column visibility, date/size formats, persisted per user                 |
| Feedback        | Toasts with actions, inline errors, progress in title bar (optional), status bar aggregation       |
| Performance     | Virtualization tuning, memoization, bundle analysis, startup profiling, memory pass                |
| Accessibility   | Keyboard-only walkthrough, screen-reader labels, contrast audit, focus restoration, reduced motion |
| Visual QA       | Both themes, 100%/125%/150% scaling, macOS/Windows/Linux window chrome                             |
| Reliability     | Reconnect UX, session drop notifications, operation guards, unsaved-state confirmations            |
| Packaging       | App icon, product metadata, macOS signing/notarization, Windows installer, Linux packages          |

**Exit criteria**

- Entire app operable with keyboard; command palette covers all major actions.
- Visual QA passes both themes and all supported platforms.
- Startup, list scrolling, and selection meet budgets.
- No placeholder strings, dead controls, or unimplemented menu items.
- Installers produced for the target platforms and smoke-tested.

---

## Phase 6 — Advanced features

**Order is deliberate; each item ships only after the previous is stable.**

1. **Permissions management (SFTP/Unix):** octal + symbolic editor, recursive apply confirmation, capability-gated, error reporting per entry.
2. **Bookmarks and navigation:** remote directory bookmarks per connection, recent paths, "go to path", favorites in sidebar.
3. **Remote text editor:** size cap (e.g. 2 MiB), binary detection, encoding detection, read-only fallback, explicit save, conflict detection if remote mtime changed, no auto-save.
4. **Remote previews:** text/image/PDF preview where practical, streamed with size caps, sandboxed rendering; no HTML execution.
5. **Import/export:** credential-free JSON, schema validation, conflict handling, per-item errors, never keys/passwords.
6. **File comparison:** metadata-first directory diff (name, size, mtime), optional content hash; virtualized diff view; clear actions.
7. **Synchronization:** planner with direction rules, include/exclude globs, dry-run, conflict policy, then enqueue through the existing transfer manager. No background daemon.
8. **Queue management extras:** priorities, per-connection limits, transfer scheduling, clearer history filtering.

**Exit criteria**

- Every advanced feature declares its protocol capability and degrades honestly.
- Editor/sync operations are never destructive without explicit confirmation and a dry-run where applicable.
- Tests cover permission edge cases, encoding/binary detection, diff classification, and sync planning.

---

## Phase 7 — Release hardening

| Area             | Deliverable                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Security         | Final threat-model review, dependency audit, fuzz listing parsers, secret-leak audit, CSP/capability review                      |
| Reliability      | Soak tests (long transfers, reconnects, thousands of files), fault injection, crash recovery                                     |
| Test matrix      | OpenSSH, vsftpd, ProFTPD, FileZilla Server, Synology; IPv6, non-ASCII, >4 GiB, LIST-only                                         |
| Docs             | User guide, connection setup, key/host-key explanations, troubleshooting, architecture links                                     |
| Release          | Versioning, changelog, checksums, release notes, unsigned-build documentation, in-app "check for updates" link (no auto-install) |
| Post-1.0 backlog | Auto-update, SSH agent auth, shared sessions, bandwidth schedules, custom themes                                                 |

---

## Release scope

The 1.0 milestone is **hardening, not features**. Sync, diff and previews are
deliberately excluded: they are additive, and shipping them before the test
matrix runs would mix new failures with baseline ones.

### 1.0 — the contract is stable

- The full Phase 7 checklist: real-server matrix, soak tests, parser fuzzing,
  dependency audits, secret-leak checks, unsigned-build documentation.
- No new product surface. Fixes and error-message polish only.
- Portable builds and installers for macOS, Windows and Linux.

### 1.1 — comparison and one-way sync

Ship only when every point below is true:

1. Directory diff (name, size, mtime) with a virtualized view and explicit
   "unknown" when the server gives no reliable mtime.
2. Synchronization **local → remote only**, with a mandatory dry-run: applying is
   disabled until the plan is visible.
3. **No delete propagation** in the first release. A mirror that removes remote
   files is a 1.2 decision, with its own confirmation flow.
4. Include/exclude globs, conflict policy and a preview of every enqueued
   transfer through the existing queue.
5. Comparison is metadata-first. Content hashing is opt-in and bounded, never
   the default on large trees.
6. Tests cover classification (new/changed/equal/unknown), planner output and
   cancellation; integration tests run against the loopback FTP/FTPS/SFTP stack.

### 1.2 — bidirectional sync and previews

- Reverse direction and delete propagation, each behind a separate confirmation.
- Remote previews for text and images with size caps and no HTML execution.
- Only after 1.1 has run on real servers without data-loss reports.

---

## Cross-cutting definition of done

A feature is done only when:

1. It is implemented in Rust or React with no mock path in production.
2. Protocol capabilities are respected; unsupported actions are disabled with a reason.
3. Errors have a user-safe message, a code, and a recovery action.
4. It is keyboard accessible and has accessible labels.
5. It works in both themes and at supported window sizes.
6. Unit tests cover core logic; important UI behavior has component tests; protocol behavior has integration coverage where feasible.
7. Logs contain no secrets; exported data contains no credentials.
8. Docs/ADR are updated if behavior or architecture changed.
9. It does not regress startup, list, or transfer performance budgets.

---

## Sequencing and review gates

```
Phase 0  spikes ──► gate: protocol feasibility + security policy proven
Phase 1  shell ───► gate: design system + typed IPC + config foundation
Phase 2  local ───► gate: local manager usable, fast, tested
Phase 3  remote ──► gate: browsing + credentials + host keys secure
Phase 4  transfer ► gate: reliability under cancel/retry/conflict/disconnect
Phase 5  polish ──► gate: UX/a11y/performance review
Phase 6  advanced ► gate: each feature capability-gated and tested
Phase 7  release ─► gate: security + platform packaging sign-off
```

**No phase skipping.** In particular, transfers are not built on an unproven protocol layer, and advanced features are not built before transfer reliability is demonstrated.

---

## First implementation slice after approval

If approved, the first concrete work is Phase 0, followed immediately by the Phase 1 shell. The first visible milestone will be a polished, themeable application shell with a real local file browser — no fake remote data, no transfer placeholders presented as working features.
