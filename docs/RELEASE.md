# Release and packaging

`sftply` ships as a Tauri 2 desktop app. Bundles are produced per operating
system; Tauri does not cross-compile installers.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main`, every pull request and
on demand:

- **Frontend**: version consistency, typecheck, Biome, Vitest and production build.
- **Rust (Linux)**: rustfmt, clippy with `-D warnings`, `cargo test`, and a
  check that `src/lib/ipc/bindings.ts` matches what `bun run bindings` generates.
  It also fails if `src-tauri/src/bin/` or a `[[bin]]` target reappears: Tauri's
  universal macOS bundler copies every binary target and only `lipo`s the app.
- **Rust check matrix**: `cargo check --all-targets` on Ubuntu, macOS and
  Windows. This does not bundle anything; it catches platform-specific code and
  dependency problems early.
- **Protocol integration**: `tests/integration/run.sh` against the loopback FTP,
  explicit FTPS, implicit FTPS and SFTP stack. It runs on `main` and on demand,
  not on pull requests, because it builds four Docker images.

## Downloadable builds

`.github/workflows/release.yml` builds on every `v*` tag. A manual
`workflow_dispatch` run builds the same artifacts but does not publish a
release, which is useful for validating the pipeline.

Every job first runs `bun run version:check`, so the tag must match the version
in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.

| System          | Portable (no install)                            | Installer         |
| --------------- | ------------------------------------------------ | ----------------- |
| macOS universal | `*_macos-universal_portable.zip` (zipped `.app`) | `.dmg`            |
| Windows x64     | `*_windows-x64_portable.zip` (raw `.exe`)        | NSIS `-setup.exe` |
| Linux x64       | `.AppImage`                                      | `.deb`            |

A final job writes `SHA256SUMS` and creates a **draft** GitHub release with all
artifacts. Review it and publish manually.

Portable caveats:

- **Windows**: the raw `.exe` needs the WebView2 runtime, which ships with
  Windows 10 (1803+) and Windows 11. It does not register file associations or
  an uninstaller.
- **macOS**: the `.app` is ad-hoc signed in CI, so Apple Silicon will run it, but
  Gatekeeper still requires the user to allow an app from an unknown developer.
  Real signing and notarization need a Developer ID certificate and the steps
  below.
- **Linux**: the AppImage is a single executable, but it may need FUSE 2 (or
  `--appimage-extract-and-run`) and the WebKitGTK libraries provided by the
  distribution. It is built on Ubuntu 22.04 to keep the glibc baseline low.

## Troubleshooting first launch

### macOS: "cannot be opened because the developer cannot be verified"

The `.app` is ad-hoc signed but not notarized, so Gatekeeper quarantines the
download. Pick either path:

1. **Finder**: right-click `sftply.app` → **Open** → **Open**. macOS remembers
   the choice, so later launches are normal.
2. **Settings**: System Settings → Privacy & Security → scroll to the blocked-app
   notice → **Open Anyway**.
3. **Terminal** after copying the app to `/Applications`:

   ```sh
   xattr -dr com.apple.quarantine /Applications/sftply.app
   ```

“The app is damaged and should be moved to the Trash” is the same quarantine
flag, not a corrupt binary; the `xattr` command fixes it. If the app moved from
`/Applications` still fails, confirm the binary is executable:

```sh
ls -l /Applications/sftply.app/Contents/MacOS/sftply
```

### Windows: the portable `.exe` opens a blank window

Install the Microsoft Edge WebView2 Runtime (already present on Windows 10 1803+
and Windows 11). The NSIS setup also installs it when missing.

### Linux: AppImage does not start

Install FUSE 2 (`libfuse2` on Debian/Ubuntu, `fuse2` on Fedora) or run the image
with `--appimage-extract-and-run`. WebKitGTK 4.1 must be installed by the
distribution; a missing `libwebkit2gtk-4.1.so.0` is the usual cause.

## Landing page

`web/` holds a static Astro site that links to the newest release. It is a
separate Bun project (its own `bun.lock`), outside the workspace, so desktop
builds never install it and `tauri build` never sees it.

```sh
bun run web:dev      # local dev server
bun run web:check    # astro check
bun run web:build    # static output in web/dist
```

The newest published release is resolved at build time. Set `GITHUB_TOKEN` to
avoid the anonymous API rate limit; without it the page still builds and links to
the `/releases/latest` redirect.

`SITE_URL` and `SITE_BASE` make the same build deployable anywhere:

| Host                                    | `SITE_URL`                    | `SITE_BASE` |
| --------------------------------------- | ----------------------------- | ----------- |
| GitHub Pages project site (default)     | `https://alevidals.github.io` | `/sftply`   |
| Custom domain, Vercel, Cloudflare Pages | `https://sftply.app`          | `/`         |

### GitHub Pages

`.github/workflows/web.yml` builds on changes under `web/` and deploys with
`actions/deploy-pages`. One-time setup: **Settings → Pages → Build and
deployment → Source: GitHub Actions**. For a custom domain, add it there (or a
`web/public/CNAME` file) and create a repository variable `SITE_BASE=/` plus
`SITE_URL=https://your-domain`.

The `github-pages` environment must also allow **tag** deployments, not only
`main`: publishing a release triggers a rebuild so the download links move to the
new version. Add it in **Settings → Environments → github-pages → Deployment
branches and tags → Add a tag rule → `v*`**, or with the API:

```sh
gh api -X POST repos/your_owner/your_repo/environments/github-pages/deployment-branch-policies \
  -f name='v*' -f type=tag
```

Without that rule the build succeeds and the deploy fails with
`Tag "vX.Y.Z" is not allowed to deploy to github-pages`.

### Vercel or Cloudflare Pages

Point the project at the `web/` root directory and use `bun run build` with
`web/dist` as the output. Set `SITE_BASE=/` and `SITE_URL` to the final domain.

## Licensing

sftply is MIT licensed (`LICENSE`). Anyone may use, modify, redistribute and sell
it, provided the copyright notice and permission notice are kept. That matches
the intent: free to use, contributions welcome, no licensing paperwork.

Third-party dependencies keep their own licenses. `cargo deny`/`cargo license`
would be the next step if the app is ever distributed commercially.

## Unsigned distribution

There is no Apple Developer ID certificate and no Windows code-signing
certificate, so **no release is OS-signed**. This is a permanent constraint of the
project, not a pending task, and the documentation says so everywhere a user
might look:

- `README.md` and the landing page explain the first-launch prompts.
- `SECURITY.md` states the trade-off and points at `SHA256SUMS`.
- Release notes repeat it.

What users see:

| Platform | Effect                                                                         | Workaround                                          |
| -------- | ------------------------------------------------------------------------------ | --------------------------------------------------- |
| macOS    | Gatekeeper blocks the first launch; ad-hoc signature keeps Apple Silicon happy | Right-click → Open, or clear `com.apple.quarantine` |
| Windows  | SmartScreen warns until the download gains reputation                          | "More info" → "Run anyway"                          |

Integrity still comes from `SHA256SUMS`, which is generated per release. Do not
add signing instructions to the docs until there is a certificate; the workflow
already accepts `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` and
`APPLE_TEAM_ID` the day that changes.

## Version bump

Update the version in all three places, move the `[Unreleased]` section of
`CHANGELOG.md` under the new version, then regenerate the bindings so the About
panel and diagnostics agree:

1. `package.json`
2. `src-tauri/Cargo.toml`
3. `src-tauri/tauri.conf.json`
4. `CHANGELOG.md`

```sh
bun run version:check
bun run bindings
```

`bun run bindings` runs `cargo run --example export-bindings`. The exporter lives
in `src-tauri/examples/`, not `src-tauri/src/bin/`, so release builds stay
bundleable.

## Local unsigned build

```sh
bun run check                 # typecheck, Biome, tests, frontend build
bun run tauri build --bundles app   # macOS .app only, fastest smoke test
bun run tauri build                 # every bundle target for this OS
```

Artifacts land in `src-tauri/target/release/bundle/`:

- macOS: `macos/sftply.app`, `dmg/sftply_<version>_<arch>.dmg`
- Linux: `deb/`, `rpm/`, `appimage/`
- Windows: `msi/`, `nsis/`

An unsigned macOS build runs locally but Gatekeeper blocks it on other
machines. Treat it as a smoke test, not a release.

## macOS signing and notarization

Prerequisites: an Apple Developer ID Application certificate in the login
keychain and an app-specific password for the Apple ID.

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"

bun run tauri build
```

Tauri signs with the hardened runtime (already enabled in
`src-tauri/tauri.conf.json`) and submits the DMG for notarization. The keychain
access used for saved credentials needs no extra entitlement because the app is
not sandboxed; if sandboxing is added later, add
`keychain-access-groups` to an entitlements file and reference it from
`bundle.macOS.entitlements`.

Verify a finished artifact:

```sh
codesign --verify --deep --strict --verbose=2 "src-tauri/target/release/bundle/macos/sftply.app"
spctl --assess --type execute --verbose=2 "src-tauri/target/release/bundle/macos/sftply.app"
xcrun stapler validate "src-tauri/target/release/bundle/dmg/sftply_<version>_<arch>.dmg"
```

## Windows signing

Set a certificate thumbprint in `bundle.windows.certificateThumbprint`, or use a
custom `bundle.windows.signCommand`. The default WebView2 install mode is
`downloadBootstrapper`, so the installer fetches the runtime when it is missing.
Build on Windows; the MSI and NSIS installers are produced from the same
command.

## Linux packages

Build on the target distribution. The Debian package is filed under the `devel`
section; Tauri derives runtime dependencies automatically. AppImage and RPM
targets need their usual host tooling (`linuxdeploy`, `rpmbuild`) available.

## Manual visual QA (per OS)

Automated tests cannot see the native window. Run this pass on macOS, Windows
and Linux before publishing a build, using the same checklist for each.

**Window and chrome**

- [ ] Title bar drags, double-click maximizes/zooms, and the traffic lights
  (macOS) or caption buttons (Windows/Linux) do not overlap the app title.
- [ ] Sidebar stays between 240 and 420 px; no connection card clips at either
  extreme or at 125 %, 150 % and 200 % display scaling.
- [ ] Minimum window size keeps the path bar, both panes and the status bar
  usable; panels resize without overlap.
- [ ] Scrollbars look native in file lists, the transfer list and dialogs.

**Themes and typography**

- [ ] Light, dark and system modes apply without a flash of the wrong theme.
- [ ] Every named theme renders readable text in the sidebar, file table,
  transfers, dialogs and status bar.
- [ ] Focus rings are visible on every theme, including keyboard-only use.
- [ ] Fonts fall back cleanly when Inter or JetBrains Mono is unavailable.
- [ ] Long file names, deep paths and non-ASCII names truncate or wrap without
  pushing controls off screen.

**Behaviour**

- [ ] Shortcut hints show `⌘` on macOS and `Ctrl` on Windows/Linux.
- [ ] Copy/paste works in path, filter and credential fields, and text is not
  accidentally selectable elsewhere.
- [ ] Drag a file between panes: a count badge follows the cursor, only the
  opposite pane highlights as a drop target, the transfer starts and both
  listings refresh when it finishes. Dragging inside the same pane shows no
  drop affordance.
- [ ] **Edit text…** opens a local or remote UTF-8 file, `⌘S`/`Ctrl+S` saves it,
  the listing refreshes, and editing the same file outside the app produces the
  conflict banner with working **Reload** and **Overwrite** actions.
- [ ] Reduced motion disables spinners and transition-heavy effects.
- [ ] Native file dialogs, keychain prompts and the "reveal in file manager"
  action open the expected OS UI.
- [ ] VoiceOver, NVDA or Orca announces the pane, tab, table and dialog names.

**Packaging**

- [ ] The installed app shows the icon in the dock/taskbar, launcher, window and
  About panel.
- [ ] Windows installs WebView2 when missing; Linux pulls the declared runtime
  dependencies; macOS launches from a copied `.app`, not only the build tree.

## Checklist

- [ ] Version bumped in the three files and bindings regenerated.
- [ ] `bun run check` and `bun run rust:lint && bun run rust:test` pass.
- [ ] Installer built on each target OS.
- [ ] macOS artifact signed, notarized and stapled.
- [ ] App launches, opens a loopback test server, and reads/writes a file.
- [ ] Saved credentials survive a restart through the OS keychain.
- [ ] Release notes and changelog updated.
