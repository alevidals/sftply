<p align="center">
  <img src="public/mark.svg" width="96" height="96" alt="sftply" />
</p>

<h1 align="center">sftply</h1>

<p align="center">
  A modern, keyboard-first desktop client for FTP, FTPS and SFTP.<br />
  Native Rust networking, keychain credentials, and a transfer queue that only
  promises what the protocol can deliver.
</p>

<p align="center">
  <a href="https://github.com/alevidals/sftply/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/alevidals/sftply?style=flat-square&color=8b5cf6" /></a>
  <a href="https://github.com/alevidals/sftply/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/alevidals/sftply/ci.yml?branch=main&style=flat-square&label=ci" /></a>
  <a href="https://alevidals.github.io/sftply/"><img alt="Website" src="https://img.shields.io/badge/website-sftply-4f8cff?style=flat-square" /></a>
  <img alt="License" src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square" />
  <img alt="Platforms" src="https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-64748b?style=flat-square" />
</p>

<p align="center">
  <a href="https://alevidals.github.io/sftply/">Website</a> ·
  <a href="https://github.com/alevidals/sftply/releases/latest">Download</a> ·
  <a href="docs/USER_GUIDE.md">User guide</a> ·
  <a href="docs/ARCHITECTURE.md">Architecture</a>
</p>

## Download

| Platform                      | Portable (no install)                                                         | Installer           |
| ----------------------------- | ----------------------------------------------------------------------------- | ------------------- |
| macOS (Intel + Apple Silicon) | `*_macos-universal_portable.zip`: unzip and drag `sftply.app` to Applications | `.dmg`              |
| Windows 10/11 x64             | `*_windows-x64_portable.zip`: unzip and run `sftply.exe`                      | `-setup.exe` (NSIS) |
| Linux x64                     | `.AppImage`: `chmod +x` and run                                               | `.deb`              |

Every release ships `SHA256SUMS`.

> **Unsigned builds.** macOS asks for confirmation on first launch (ad-hoc
> signed, not notarized) and Windows shows a SmartScreen warning. The
> [user guide](docs/USER_GUIDE.md#install) has the exact steps, and
> [SECURITY.md](SECURITY.md) explains the trade-off.

## Highlights

|                                  |                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Three protocols, one client**  | FTP, explicit and implicit FTPS, and SFTP over native Rust networking. No shelling out to `lftp` or `ssh`.                      |
| **Dual pane, keyboard first**    | Two folders side by side, multi-select, drag between panes, command palette, path autocomplete and shortcut hints per platform. |
| **A queue that tells the truth** | Pause and resume appear only when the server supports them. A cancelled transfer is never reported as complete.                 |
| **Secrets stay in the keychain** | Passwords and passphrases live in the OS keychain. Config files, exports and logs never contain them.                           |
| **Remote text editing**          | Open a UTF-8 file up to 2 MiB, edit it in place and save atomically, with stale-write detection.                                |
| **Themes and migrations**        | Dark by default, light first-class, named palettes contrast-tested. Connections import and export as credential-free JSON.      |

## Status

Pre-1.0. The app is usable and tested, but behaviour can still change before
1.0. The roadmap is explicit about what comes next:

- **1.0**: hardening: real-server matrix, soak tests, parser fuzzing, audits.
- **1.1**: directory diff and one-way sync with a mandatory dry-run.
- **1.2**: bidirectional sync and remote previews.

## Documentation

- [User guide](docs/USER_GUIDE.md): connections, host keys, transfers, troubleshooting
- [Release and packaging](docs/RELEASE.md): CI, artifacts, unsigned builds
- [Changelog](CHANGELOG.md): what changed in each release
- [Architecture](docs/ARCHITECTURE.md): layers, IPC contract, security model
- [Roadmap](docs/ROADMAP.md): milestones and exit criteria
- [Dependency evaluation](docs/DEPENDENCIES.md): protocol libraries and rejected alternatives
- [Progress log](docs/PROGRESS.md): what is built, verified and next
- [ADRs](docs/adr/README.md): architectural decision records

## Development

Prerequisites: Bun 1.4+, Rust 1.99+, platform Tauri dependencies.

```bash
bun install
bun run tauri dev      # desktop app with hot reload
bun run check          # typecheck, Biome, Vitest and production build
```

Rust gates run from `src-tauri`:

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

The landing page lives in `web/` and is its own Bun project:

```bash
bun run web:dev        # Astro dev server
bun run web:build      # static output in web/dist
```

## Stack

Tauri 2 · React 19 · TypeScript · Vite · Tailwind CSS v4 · shadcn/ui · Zustand ·
TanStack Query · React Hook Form + Zod · Rust · suppaftp · russh/russh-sftp · keyring

## License

MIT. See [LICENSE](LICENSE). Security reports: [SECURITY.md](SECURITY.md).
