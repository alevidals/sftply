# sftply

A modern, keyboard-first desktop client for FTP, FTPS and SFTP. Built with Tauri 2, React, TypeScript and Rust.

Website: <https://alevidals.github.io/sftply/>

> **Status: pre-1.0.** `v0.1.0` is published as portable builds and installers for macOS, Windows and Linux. The source is usable and tested, but the product is still under active development; expect breaking behaviour changes before 1.0.

## Download

Grab the latest build from [Releases](https://github.com/alevidals/sftply/releases/latest):

| Platform                      | Portable (no install)                                                          | Installer           |
| ----------------------------- | ------------------------------------------------------------------------------ | ------------------- |
| macOS (Intel + Apple Silicon) | `*_macos-universal_portable.zip` — unzip and drag `sftply.app` to Applications | `.dmg`              |
| Windows 10/11 x64             | `*_windows-x64_portable.zip` — unzip and run `sftply.exe`                      | `-setup.exe` (NSIS) |
| Linux x64                     | `.AppImage` — `chmod +x` and run                                               | `.deb`              |

`SHA256SUMS` accompanies every release.

**First launch on macOS** is blocked by Gatekeeper because the build is ad-hoc
signed and not notarized. Right-click the app → **Open** → **Open**, or run:

```sh
xattr -dr com.apple.quarantine /Applications/sftply.app
```

See [Release and packaging](docs/RELEASE.md) for the full caveats, including the
WebView2 requirement on Windows and FUSE on Linux.

## Design documents

- [Architecture](docs/ARCHITECTURE.md) — layers, module boundaries, IPC contract, security model, design system
- [Dependency evaluation](docs/DEPENDENCIES.md) — protocol libraries, Rust/frontend dependencies, rejected alternatives
- [Release and packaging](docs/RELEASE.md) — CI, artifacts, portable caveats, signing
- [Roadmap](docs/ROADMAP.md) — phased milestones with exit criteria
- [Progress log](docs/PROGRESS.md) — what is built, verified, and what comes next
- [ADRs](docs/adr/README.md) — architectural decision records

## Product direction

- Dual-pane local/remote file browser with a dense, calm interface inspired by Linear, VS Code, Raycast and Finder.
- Native Rust networking for FTP, explicit/implicit FTPS and SFTP. No system binaries.
- OS keychain for credentials, strict SSH host-key verification, and certificate validation for FTPS.
- A reliable, capability-aware transfer queue: no fake pause/resume, no optimistic "completed" states.
- Dark theme by default, first-class light theme.
- Typed Rust↔TypeScript boundary, strict TypeScript, tests for core logic and protocols.

## Stack

Tauri 2 · React 19 · TypeScript · Vite · Tailwind CSS v4 · shadcn/ui · Zustand · TanStack Query · React Hook Form + Zod · Rust · suppaftp · russh/russh-sftp · keyring

## Development

Prerequisites: Bun 1.4+, Rust 1.99+, platform Tauri dependencies.

```bash
bun install
bun run tauri dev      # desktop app with hot reload
bun run check          # typecheck, Biome, Vitest and production build
```

The landing page lives in `web/` and is its own Bun project:

```bash
bun run web:dev        # Astro dev server
bun run web:build      # static output in web/dist
```

Rust gates run from `src-tauri`:

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

## License

MIT. See [LICENSE](LICENSE).

Releases are not OS-signed: macOS asks for confirmation on first launch and
Windows shows a SmartScreen warning. Verify `SHA256SUMS` and see
[SECURITY.md](SECURITY.md) for the reasoning.
