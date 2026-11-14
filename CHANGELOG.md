# Changelog

All notable changes to sftply. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Import and export saved connections as credential-free JSON. Imports merge
  into the existing list, skip duplicates by protocol/host/port/username, and
  report every skipped entry. Ids, timestamps, passwords, passphrases and key
  material never leave the machine.
- A manual **Check for updates** button in Settings → About. It makes one
  request to the public GitHub releases API, compares versions and offers the
  release page. Nothing is downloaded or installed automatically.
- Weekly dependency audits (`cargo audit`, `bun audit --production`) on CI.

### Changed

- The project is MIT licensed.
- `shadcn` moved to `devDependencies`; it is only needed to build the CSS.
- The production bundle is split into long-lived vendor chunks instead of a
  single 888 kB file.

### Security

- `SECURITY.md` documents supported versions, private reporting, the unsigned
  build trade-off and the accepted RUSTSEC-2023-0071 advisory until russh
  accepts `rsa` 0.10.

## [0.1.0] - 2026-11-14

First public build.

### Added

- Dual-pane local and remote file browser with keyboard navigation, filtering,
  sorting, multi-selection and drag and drop between panes.
- FTP, explicit FTPS, implicit FTPS and SFTP over native Rust networking, with
  passive/extended-passive/active data modes.
- Saved connections with credentials in the OS keychain, groups, favorites,
  quick connect and duplicate.
- Strict SSH host-key verification with an explicit trust prompt, and FTPS
  certificate validation with optional CA bundles and SHA-256 pins.
- Capability-aware transfer queue: per-file progress, conflicts, cancel, retry,
  history without secrets, and pause/resume only when the server supports it.
- Remote text editor for UTF-8 files up to 2 MiB with stale-write detection and
  atomic saves.
- Unix permission editor for a selection (not recursive).
- Remote bookmarks and recent paths.
- Dark, light and named themes, contrast-tested, with a command palette and
  shortcut hints per platform.
- Portable builds for macOS (universal), Windows x64 and Linux x64, plus `.dmg`,
  NSIS and `.deb` installers and `SHA256SUMS`.

[unreleased]: https://github.com/alevidals/sftply/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/alevidals/sftply/releases/tag/v0.1.0
