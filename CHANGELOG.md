# Changelog

All notable changes to sftply. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Preserve permissions on upload** in Settings → Transfers. When enabled and
  the server supports `chmod`, an uploaded file copies the local Unix mode
  instead of keeping the server default. Off by default to avoid widening access.

### Fixed

- Windows and Linux kept an 84 px gap at the start of the title bar, reserved for
  macOS traffic lights. The padding now applies only on macOS.
- The connection and quick-connect dialogs showed a horizontal scrollbar on
  Windows: the footer used negative margins inside the scrolling form. The
  footer now sits outside the scroll area, so only the body scrolls.
- Save buttons flashed a spinner for a few milliseconds, because a settings or
  connection save finishes faster than the frame that shows it. The spinner now
  waits 200 ms before appearing; quick saves keep the label.
- Renaming from the menu still lost focus to the row. The inline input retries
  focus for a short window and ignores the transient blur caused by the menu
  restoring focus, so the rename stays open and selected.
- The transfer queue re-sorted every row on each progress event. With hundreds
  of files and eight concurrent transfers the window froze and cancelling became
  impossible. Rows now reorder only when they appear or disappear, and the
  bridge merges progress deltas into one update every 100 ms.
- Release builds aborted the entire app when a transfer task panicked, because
  the release profile set `panic = "abort"`. Panics are now logged to the app log
  and turn into a failed row that can be retried.
- Cancelling a transfer now responds while its connection is still opening.
- Choosing **Rename** from the row context menu or the pane actions menu left
  focus on the row. The menus no longer restore focus to their trigger, so the
  inline input keeps it.

## [0.3.0] - 2026-11-14

### Added

- Skip link, main landmark and hidden heading for keyboard and screen-reader
  users.
- Property-based tests for the FTP listing parsers and remote path normalization,
  plus a guard that fails when a log call mentions a credential.
- README with the app icon, release, CI, license and platform badges.

### Changed

- Performance pass on the React tree: folder filtering is deferred so typing
  stays responsive, pane state resets during render instead of in an effect, the
  file grid template is computed once per render, the shell sections are
  memoized, the per-row session lookup uses a map, and two cache invalidations
  run in parallel.
- Documentation and interface copy follow the writing guidelines: sentence-case
  headings, no em dashes, ellipses instead of three dots, units with a space,
  and error messages that say what to try next.
- `theme-color` matches the app surface, overlays contain overscroll, headings
  balance, and interactive elements use `touch-action: manipulation`.
- The landing page no longer claims that packages are signed; it says they ship
  with a checksum.
- CI documents the extra Pages environment rule that lets a release tag deploy
  the site.

### Fixed

- Debounced settings writes were dropped when the component unmounted within the
  debounce window; they now flush.
- The Docker integration suite created identical folder names in parallel tests
  and failed intermittently.

## [0.2.0] - 2026-11-14

### Added

- Import and export saved connections as credential-free JSON. Imports merge
  into the existing list, skip duplicates by protocol/host/port/username, and
  report every skipped entry. Ids, timestamps, passwords, passphrases and key
  material never leave the machine.
- A manual **Check for updates** button in Settings → About. It makes one
  request to the public GitHub releases API, compares versions and offers the
  release page. Nothing is downloaded or installed automatically.
- **Test connection** in the new-connection and quick-connect dialogs. It opens a
  throwaway connection, lists the initial folder and reports latency and entry
  count; nothing is saved and no session is created.
- Folder autocomplete while editing the path, with arrow-key selection. It
  suggests real folders listed from the parent being typed.
- A home button in the local pane's path bar.
- Stronger active-pane indicator: an accent line on top and a tinted header, in
  addition to the pane ring.
- Weekly dependency audits (`cargo audit`, `bun audit --production`) on CI.

### Changed

- The project is MIT licensed.
- `shadcn` moved to `devDependencies`; it is only needed to build the CSS.
- The production bundle is split into long-lived vendor chunks instead of a
  single 888 kB file.
- Deleting a connection no longer reports failure when the keychain cleanup
  fails after the profile is already gone; it logs the problem instead.

### Fixed

- `⌘L`/`Ctrl+L` edited the remote path regardless of which pane was active. Both
  panes mounted the same global shortcut.
- Opening a folder that does not exist showed an empty listing when the server
  answered `LIST` with an empty stream. The listing now verifies the path and
  reports the server error.
- Right-clicking outside a text field showed the webview menu ("Reload", "Back").
  The desktop context menu is suppressed everywhere except editable fields.
- The connect icon in a connection row sat inside the space reserved for the
  hover-only actions button; the actions button now comes first so the connect
  icon stays at the right edge.

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

[unreleased]: https://github.com/alevidals/sftply/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/alevidals/sftply/releases/tag/v0.3.0
[0.2.0]: https://github.com/alevidals/sftply/releases/tag/v0.2.0
[0.1.0]: https://github.com/alevidals/sftply/releases/tag/v0.1.0
