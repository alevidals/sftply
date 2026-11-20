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
| Linux ARM64                   | `.AppImage`: `chmod +x` and run                                               | `.deb`              |

Every release ships `SHA256SUMS`.

> **Not Developer ID signed or notarized.** macOS builds carry an ad-hoc
> signature, which keeps Apple Silicon from reporting them as damaged, but
> Gatekeeper still asks for confirmation on first launch. Windows builds are
> unsigned and show a SmartScreen warning. The
> [user guide](docs/USER_GUIDE.md#install) has the exact steps, and
> [SECURITY.md](SECURITY.md) explains the trade-off.

## Highlights

|                                   |                                                                                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Three protocols, one client**   | FTP, explicit and implicit FTPS, and SFTP over native Rust networking. No shelling out to `lftp` or `ssh`.                             |
| **Dual pane, keyboard first**     | Two folders side by side, multi-select, drag between panes, command palette, path autocomplete and shortcut hints per platform.        |
| **Compare and sync**              | Dry-run diff of the current local and remote folders in both directions, with content checks and include/exclude globs.                |
| **Explicit deletes and previews** | Target-only items are removed only after a separate confirmation. Text and images preview without downloading; HTML and SVG never run. |
| **A queue that tells the truth**  | Pause and resume appear only when the server supports them. A cancelled transfer is never reported as complete.                        |
| **Secrets stay in the keychain**  | Passwords and passphrases live in the OS keychain. Config files, exports and logs never contain them.                                  |
| **Remote text editing**           | Open a UTF-8 file up to 2 MiB, edit it in place and save atomically, with stale-write detection.                                       |
| **SSH agent auth**                | SFTP can sign in with the identities already loaded in your system agent, without storing the key or passphrase.                       |
| **Themes and migrations**         | Dark by default, light first-class, built-in palettes and custom theme files with import/export. Connections use credential-free JSON. |

## Status

1.2 is out. The stable line is 1.x, and fixes ship as patch releases.

Comparison now works in both directions. Target-only items are deleted only
through an explicit, confirmed flow, and normal Sync never deletes. Remote text
and raster images can be previewed without downloading them first; HTML and SVG
are shown as text and never executed.

## Documentation

- [User guide](docs/USER_GUIDE.md): install, connections, transfers and troubleshooting
- [Contributing](CONTRIBUTING.md): setup, branches and checks
- [Architecture](docs/ARCHITECTURE.md): layers, IPC contract and security model
- [Release and packaging](docs/RELEASE.md): CI, artifacts and branch policy
- [Changelog](CHANGELOG.md): what changed in each release

[Full documentation index](docs/README.md)

## Development

Prerequisites: Bun 1.4+, Rust 1.99+, platform Tauri dependencies.

```bash
bun install
bun run tauri dev      # desktop app with hot reload
bun run check          # typecheck, Biome, Vitest and production build
```

The Rust gates, the `web/` project and the integration stack are in
[CONTRIBUTING.md](CONTRIBUTING.md).

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the
development setup, branch workflow and checks. By participating, you agree to
follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security reports go through
[SECURITY.md](SECURITY.md), not public issues.

## Stack

Tauri 2 · React 19 · TypeScript · Vite · Tailwind CSS v4 · shadcn/ui · Zustand ·
TanStack Query · React Hook Form + Zod · Rust · suppaftp · russh/russh-sftp · keyring

## License

MIT. See [LICENSE](LICENSE). Security reports: [SECURITY.md](SECURITY.md).
