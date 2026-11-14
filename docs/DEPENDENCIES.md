# sftply: Dependency evaluation

**Status:** Approved and implemented. Versions verified 2026-11-05/06 against crates.io and npm. Compile spike for the protocol stack passed 2026-11-07.  
**Policy:** Pin exact versions in `Cargo.toml` / `package.json`, commit both lockfiles, and review upgrades deliberately. Every dependency must earn its place: it is maintained, permissively licensed, cross-platform, and does not require a system binary at runtime.

---

## 1. Evaluation criteria

| Criterion      | What we check                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| Maintenance    | Recent release/commit activity, responsive issue tracker, release cadence                                    |
| Security       | Memory-safe where possible; known-vulnerability posture; TLS and key-handling maturity                       |
| Capability fit | Full protocol behavior we need: FTPS modes, SFTP auth/host keys, async, cancellation, offsets                |
| Async fit      | Works with Tokio without blocking the runtime; supports cancellation and timeouts                            |
| Portability    | macOS, Windows, Linux; no mandatory system binaries; C dependencies acceptable only with clear justification |
| License        | MIT / Apache-2.0 / BSD / ISC; compatible with a closed or open-source desktop app                            |
| Cost           | Binary size, compile time, transitive surface, runtime overhead                                              |

---

## 2. Networking and protocol libraries

### 2.1 FTP / FTPS: chosen: `suppaftp 12.2.1`

| Attribute         | Finding                                                                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| License           | MIT OR Apache-2.0                                                                                                                                                                                         |
| Activity          | 12.2.1 released 2026-10-15; actively maintained by veeso                                                                                                                                                  |
| Downloads         | ~5.2M total, ~1.8M recent                                                                                                                                                                                 |
| Async             | First-class Tokio implementation (`tokio` feature), plus smol                                                                                                                                             |
| FTPS              | Explicit (`into_secure`) and implicit (`connect_secure_implicit`), `PBSZ 0` + `PROT P` handled                                                                                                            |
| TLS               | Pluggable `AsyncTlsConnector`; rustls and native-tls backends; custom connector supported                                                                                                                 |
| Listing           | `MLSD` and `LIST` + `NLST`; structured parser                                                                                                                                                             |
| Transfer control  | `retr_as_stream`, `put_with_stream`, `append_with_stream`, `abort`, `resume_transfer(offset)`, `active_mode`, `passive_mode`                                                                              |
| Security relevant | `ActivePeerCheck::ControlPeer` by default; prevents the classic FTP bounce/data-redirection problem; configurable for NAT                                                                                 |
| Timeouts          | Connect/read/write and data timeouts configurable                                                                                                                                                         |
| Risks             | Implicit FTPS is behind the `deprecated` Cargo feature (the protocol is deprecated, not the API); LIST output variance across servers; FTPS data-channel TLS session reuse behavior depends on the server |

**Decision:** Use suppaftp's Tokio + rustls stack. Enable the `deprecated` feature deliberately only for implicit FTPS support, with an explanatory comment. Build a custom rustls connector using the platform verifier (or native root store) so certificate/hostname verification is under our policy. Phase 0 spike must prove: explicit FTPS, implicit FTPS, custom CA, hostname mismatch rejection, MLSD, LIST fallback, resume, and abort against real servers.

**Alternatives considered**

| Crate                          | Why not                                                 |
| ------------------------------ | ------------------------------------------------------- |
| `ftp`                          | Older, sync-first, weaker FTPS/async story              |
| `async-ftp`                    | Thin, sync core, less complete FTPS/listing support     |
| Custom protocol implementation | Large security-sensitive surface for no product benefit |

### 2.2 SFTP: chosen: `russh 0.65.1` + `russh-sftp 3.0.1`

| Attribute   | Finding                                                                                                                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| License     | Apache-2.0                                                                                                                                                                             |
| Activity    | russh 0.65.1 released 2026-11-03; russh-sftp 3.0.1 released 2026-09-28; both actively maintained                                                                                       |
| Runtime     | Pure Rust, Tokio-native, no OpenSSL/libssh2 C dependency                                                                                                                               |
| Auth        | Password and public-key; keys parsed by `russh::keys` (`ssh-key`), including passphrase-protected OpenSSH/PEM/PKCS#8 keys                                                              |
| Host keys   | Handler callback receives the server public key; we implement strict known_hosts and explicit trust                                                                                    |
| SFTP        | v3 client/server, streaming handles, readdir, stat/setstat, rename, remove, mkdir, extensions (`limits`, `fsync`, `hardlink`, `statvfs`, `expand-path`)                                |
| Performance | Documented ~200–257 MiB/s against OpenSSH in Docker, on par with Node/Go clients                                                                                                       |
| Crypto      | rustls/aws-lc-rs by default, ring available; modern KEX/ciphers                                                                                                                        |
| Risks       | API churn between minor versions (0.x); russh-sftp 3.0.1's dev dependency is russh 0.63.2, so 0.65 compatibility must be verified in the Phase 0 spike; server-specific SFTP v3 quirks |

**Decision:** Use russh + russh-sftp. Pin exact versions, isolate them behind `protocol/sftp/`, and keep a protocol integration suite against OpenSSH. **Compile spike 2026-11-07:** `russh 0.65.1` + `russh-sftp 3.0.1` build together with `ring`/`rsa`/`flate2`; `russh-sftp` consumes any `AsyncRead + AsyncWrite` stream, so no version coupling exists. Runtime integration against OpenSSH is still pending a local server.

**Alternatives considered**

| Crate                  | Why not                                                                                                                                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ssh2 0.9.6`           | Mature libssh2 bindings and a defensible choice, but blocking API requires a thread pool per operation; vendored OpenSSL/libssh2 adds C toolchain, binary size, and platform build complexity. Its SFTP API offers less async-friendly streaming. Kept as a fallback if russh fails validation. |
| `async-ssh2-tokio`     | Wraps blocking ssh2 with an async facade; inherits the C dependency and has a smaller maintenance surface                                                                                                                                                                                       |
| `openssh` crate        | Requires the system `ssh` binary and/or OpenSSH tools; explicitly disallowed and hard to support consistently                                                                                                                                                                                   |
| `libssh2-sys` directly | Raw FFI, more unsafe code and build burden for no benefit                                                                                                                                                                                                                                       |

### 2.3 Unified protocol boundary

No maintained crate unifies FTP/FTPS/SFTP behind one accurate async capability model. We own the `FileSystem` trait and expose `FsCapabilities` so unsupported operations are visibly unavailable rather than emulated incorrectly. This is a deliberate architectural boundary, not a wrapper around a single library.

---

## 3. Rust backend dependencies

| Crate                       | Version     | Purpose                        | License        | Notes                                                                                    |
| --------------------------- | ----------- | ------------------------------ | -------------- | ---------------------------------------------------------------------------------------- |
| `tauri`                     | 2.12.5      | Desktop shell                  | MIT/Apache-2.0 | Already in template; keep current minor                                                  |
| `tokio`                     | 1.54.1      | Async runtime                  | MIT            | Features: rt-multi-thread, fs, net, time, sync, io-util, macros                          |
| `serde`                     | 1.0.229     | Serialization                  | MIT/Apache-2.0 | derive                                                                                   |
| `serde_json`                | 1.0.154     | Config/IPC                     | MIT/Apache-2.0 | Bounded parsing                                                                          |
| `thiserror`                 | 2.0.21      | Internal errors                | MIT/Apache-2.0 | Converted to `AppError` at boundary                                                      |
| `tracing`                   | 0.1.44      | Structured logging             | MIT            | No payload logging by default                                                            |
| `tracing-subscriber`        | 0.3.23      | Log filtering/formatting       | MIT            | Env filter, redaction layer                                                              |
| `tracing-appender`          | 0.2.5       | Rolling log file               | MIT            | Non-blocking writer                                                                      |
| `secrecy`                   | 0.10.3      | Secret wrapper                 | MIT/Apache-2.0 | Stable API; last release 2024 but widely used and minimal                                |
| `zeroize`                   | 1.9.1       | Best-effort memory clearing    | MIT/Apache-2.0 | For key/passphrase buffers                                                               |
| `keyring`                   | 4.2.0       | OS credential storage          | MIT/Apache-2.0 | `v1` compatibility API; macOS Keychain, Windows Credential Manager, Linux Secret Service |
| `uuid`                      | 1.29.0      | IDs                            | MIT/Apache-2.0 | v4 + serde                                                                               |
| `tokio-util`                | 0.7.20      | `CancellationToken`            | MIT            | Cancellation for every long operation                                                    |
| `async-trait`               | 0.1.92      | Object-safe async traits       | MIT/Apache-2.0 | Needed for `dyn FileSystem`/stream handles                                               |
| `futures-util`              | 0.3.34      | Stream utilities               | MIT/Apache-2.0 | Minimal use                                                                              |
| `bytes`                     | 1.12.1      | Transfer buffers               | MIT            | Fixed-size chunk pipeline                                                                |
| `walkdir`                   | 2.5.0       | Recursive local scans          | MIT/Unlicense  | Run in `spawn_blocking`; symlink policy explicit                                         |
| `globset`                   | 0.4.21      | Filter/ignore patterns         | MIT/Unlicense  | Used by later sync/compare                                                               |
| `base64`                    | 0.23.1      | Key/hash encoding              | MIT/Apache-2.0 | Only where needed                                                                        |
| `rustls-platform-verifier`  | 0.7.1       | OS trust store for FTPS        | MIT/Apache-2.0 | Preferred over a baked root store; verify suppaftp connector integration                 |
| `rustls-pemfile`            | 2.2.0       | Parse custom CA bundles        | MIT/Apache-2.0 | Loads user-provided PEM roots for FTPS                                                   |
| `sha2`                      | 0.10.9      | Certificate pin fingerprints   | MIT/Apache-2.0 | SHA-256 of the server certificate; no secret material                                    |
| `tauri-plugin-dialog`       | 2.8.4       | Native file/folder pickers     | MIT/Apache-2.0 | Key file, CA file, export path only                                                      |
| `tauri-plugin-opener`       | 2.7.2       | Reveal/open local files        | MIT/Apache-2.0 | Already in template; scoped to local paths                                               |
| `tauri-plugin-window-state` | 2.5.0       | Window geometry persistence    | MIT/Apache-2.0 | Small, stable                                                                            |
| `specta`                    | 2.0.0-rc.26 | Type model generation          | MIT/Apache-2.0 | Pinned exactly with tauri-specta; v1 is Tauri v1 only                                    |
| `tauri-specta`              | 2.0.0-rc.26 | Typed commands/events bindings | MIT/Apache-2.0 | Generates `bindings.ts`; validated in Phase 1; RC upgrades require review                |
| `specta-typescript`         | 0.0.13      | TypeScript exporter            | MIT/Apache-2.0 | Paired with the specta v2 RC; generates `src/lib/ipc/bindings.ts`                        |
| `chrono`                    | 0.4.45      | FTP date parsing               | MIT/Apache-2.0 | Transitive via suppaftp; use only at protocol boundary                                   |

**Dev dependencies:** `tempfile 3.27.0`, `insta 1.49.0`, `proptest 1.12.0`, `tokio-test`, `serial_test` (only where server fixtures require isolation). Tooling: `cargo-nextest`, `cargo-deny`, `cargo-audit`, `rustfmt`, `clippy`.

### Rejected or deferred Rust dependencies

| Candidate                   | Decision | Reason                                                                                                                                                                      |
| --------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tauri-plugin-store`        | Rejected | Plain JSON without schema versioning, migrations, or atomic-write control; we need our own validated repository                                                             |
| `tauri-plugin-fs`           | Rejected | Exposes broad filesystem access to the webview; all local I/O goes through validated Rust commands                                                                          |
| `tauri-plugin-shell`        | Rejected | Shell execution is explicitly out of scope and a security risk                                                                                                              |
| `tauri-plugin-stronghold`   | Deferred | Encrypted vault requires its own master-password UX; OS keychain is the correct primary store. Consider only as an explicit Linux fallback with a user-set master password. |
| `rusqlite`                  | Deferred | Adds a C/SQLite build for limited benefit; bounded JSONL is sufficient for history. Revisit if history search becomes a real requirement.                                   |
| `openssh` / system binaries | Rejected | Requirement: native implementations only; consistent behavior and packaging                                                                                                 |
| `ssh2`                      | Fallback | Viable, but blocking and C-toolchain heavy; only if russh validation fails                                                                                                  |
| `native-tls`                | Fallback | OS trust integration is good, but certificate pinning and deterministic cross-platform behavior are easier under rustls; suppaftp supports both                             |
| `reqwest`                   | Rejected | No HTTP backend requirement                                                                                                                                                 |
| `notify`                    | Deferred | Local file watching is not needed for the first release; add for sync only if justified                                                                                     |
| `encoding_rs`               | Deferred | Needed only for non-UTF-8 text editor support; add with the editor                                                                                                          |
| `sysinfo`                   | Rejected | No system monitoring requirement; unnecessary privilege surface                                                                                                             |

---

## 4. Frontend dependencies

| Package                                              | Version    | Purpose                  | Notes                                                                                                                     |
| ---------------------------------------------------- | ---------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `react`, `react-dom`                                 | 19.1.0     | UI runtime               | Already in template                                                                                                       |
| `typescript`                                         | 6.0.3      | Language                 | Keep template major; enable stricter flags incrementally. TS 7 exists but ecosystem/tooling compatibility is not assumed. |
| `vite`                                               | 8.0.16     | Build                    | Already in template                                                                                                       |
| `@vitejs/plugin-react`                               | 6.0.2      | React plugin             | Template                                                                                                                  |
| `tailwindcss`                                        | 4.3.4      | Styling                  | v4 with `@tailwindcss/vite`; CSS-first tokens                                                                             |
| `shadcn` (CLI)                                       | 4.23.0     | Component generation     | Components are copied into `src/components/ui` and owned by us                                                            |
| Radix primitives                                     | via shadcn | Accessible primitives    | Dialog, menu, tooltip, tabs, checkbox, etc.                                                                               |
| `lucide-react`                                       | 1.69.0     | Icons                    | Tree-shaken imports                                                                                                       |
| `zustand`                                            | 5.0.16     | Client state             | Selector-based subscriptions                                                                                              |
| `@tanstack/react-query`                              | 5.106.1    | Server state             | Listings, test results                                                                                                    |
| `@tanstack/react-virtual`                            | 3.14.26    | List virtualization      | 10k+ rows                                                                                                                 |
| `react-hook-form`                                    | 7.91.0     | Forms                    | Connection form, dialogs                                                                                                  |
| `zod`                                                | 4.6.7      | Validation               | Shared client schemas; backend re-validates                                                                               |
| `@hookform/resolvers`                                | 7.0.3      | RHF + Zod                |                                                                                                                           |
| `cmdk`                                               | 1.1.1      | Command palette          | shadcn command component                                                                                                  |
| `@dnd-kit/core`                                      | 6.3.1      | Drag and drop            | Sidebar reorder and file drag metadata                                                                                    |
| `@dnd-kit/sortable`                                  | 10.0.0     | Sortable lists           | Connection/folder ordering                                                                                                |
| `sonner`                                             | 2.0.8      | Toasts                   | shadcn integration                                                                                                        |
| `class-variance-authority`, `clsx`, `tailwind-merge` | current    | Variants/class utilities | shadcn standard                                                                                                           |
| `@fontsource-variable/inter`                         | current    | UI font                  | Self-hosted, offline; no runtime network                                                                                  |
| `@fontsource-variable/jetbrains-mono`                | current    | Mono font                | Metadata/paths                                                                                                            |
| `tinykeys`                                           | 4.0.1      | Keyboard bindings        | Tiny, scope-aware sequences                                                                                               |
| `@tauri-apps/api`                                    | 2.x        | IPC/events/window        | Template                                                                                                                  |
| `@tauri-apps/plugin-dialog`                          | 2.8.4      | Native pickers           |                                                                                                                           |
| `@tauri-apps/plugin-opener`                          | 2.7.2      | Reveal local files       |                                                                                                                           |
| `@tauri-apps/plugin-window-state`                    | 2.5.0      | Window geometry          |                                                                                                                           |
| `vitest`                                             | 5.1.0      | Test runner              |                                                                                                                           |
| `@testing-library/react`                             | 16.3.3     | Component tests          |                                                                                                                           |
| `@testing-library/user-event`                        | 14.6.8     | Interaction tests        |                                                                                                                           |
| `jsdom`                                              | current    | DOM environment          |                                                                                                                           |
| `@biomejs/biome`                                     | 2.6.5      | Lint + format            | Replaces ESLint + Prettier; one tool, fast                                                                                |
| `vitest-axe`                                         | 0.1.0      | A11y assertions          | Early-stage; use for smoke coverage, not as sole a11y verification                                                        |

**Not included intentionally:** React Router (single-window workspace), axios (no HTTP), Redux (Zustand + Query suffice), date-fns/moment (Intl covers display), Framer Motion (CSS transitions suffice), Monaco (remote editor is a later, carefully scoped feature), an icon pack beyond Lucide.

### Why shadcn/ui is a good fit

- Components are source-owned: we can enforce density, tokens, and keyboard behavior instead of fighting a library theme.
- Built on Radix, which provides focus management and ARIA behavior we would otherwise reimplement.
- No runtime theme CSS-in-JS and no bundled component library weight; unused components are not installed.
- Tailwind v4 CSS variables align with our design tokens.

Trade-off: generated code must be reviewed like any other code. We will not blindly re-run `shadcn add` over customized components.

### Tooling choice: Biome vs ESLint + Prettier

**Recommendation: Biome.** One binary for formatting and linting, very fast in CI, and sufficient rules for React/TypeScript. If the team requires the ESLint plugin ecosystem (e.g. specific TanStack or a11y rules), switching to ESLint + Prettier is a contained change. Either way, Rust uses `rustfmt` + `clippy`.

---

## 5. Licensing and supply chain

- All chosen direct dependencies are MIT, Apache-2.0, BSD, ISC, or Unlicense. `cargo-deny` will enforce an allowlist and reject copyleft transitives that would affect distribution.
- `cargo-audit` + `cargo-deny` in CI; Dependabot/Renovate-style updates reviewed manually because protocol crates can change semantics in patch releases.
- Frontend: `bun audit` + lockfile; no postinstall scripts from untrusted packages (Bun's trusted-dependencies setting will be reviewed).
- Git is initialized in Phase 0; `.gitignore` already excludes `node_modules`, `dist`, `target`, and editor noise. Build artifacts currently in `src-tauri/target` will not be committed.
- No telemetry SDK, no analytics, no remote config.

---

## 6. Phase 0 validation spikes (must pass before implementation)

1. **suppaftp / FTPS**
   - Explicit FTPS against vsftpd/ProFTPD with a test CA: success.
   - Implicit FTPS: success with the `deprecated` feature.
   - Hostname mismatch and expired/untrusted cert: rejected.
   - Custom CA and per-connection pin: accepted.
   - MLSD and LIST-only servers: both list correctly.
   - `resume_transfer` download and append upload behavior; verify offset semantics.
   - `abort()` mid-transfer leaves a usable control connection or cleanly reconnects.
2. **russh / russh-sftp**
   - **Compile spike passed 2026-11-07:** 0.65.1 + 3.0.1 build together (russh-sftp's russh 0.63 is dev-only).
   - Still to run: SFTP operations against OpenSSH.
   - Password, unencrypted key, passphrase key; wrong passphrase yields a clear error.
   - Unknown host key triggers our trust flow; changed key blocks.
   - chmod, rename, recursive listing, large file (>4 GiB sparse file) streaming.
   - Concurrent channels (3 transfers) and cancellation/close behavior.
   - Keepalive/disconnect detection.
3. **tauri-specta**
   - **Validated 2026-11-06:** `tauri-specta`/`specta` 2.0.0-rc.26 with `specta-typescript` 0.0.13 generates typed commands, events, and models to `src/lib/ipc/bindings.ts`; `bun run bindings` is deterministic.
   - Note: stable `tauri-specta` 1.0.2 supports Tauri v1, not Tauri v2. Do not "downgrade" to it.
   - Remaining CI work: regenerate bindings in CI and fail on diff.

4. **keyring 4**
   - Store/read/delete on macOS Keychain; error mapping when unavailable; no secret appears in logs or crash output.
5. **Tauri shells**
   - Strict CSP with the custom title bar; OS drag-drop events; dialog plugin; window-state restore.

If a spike fails, the ADR is updated before proceeding. No fallback silently weakens security (e.g. disabling certificate verification) to make a test pass.
