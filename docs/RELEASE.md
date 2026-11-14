# Release and packaging

`sftply` ships as a Tauri 2 desktop app. Bundles are produced per operating
system; Tauri does not cross-compile installers.

## Version bump

Update the version in all three places, then regenerate the bindings so the
About panel and diagnostics agree:

1. `package.json`
2. `src-tauri/Cargo.toml`
3. `src-tauri/tauri.conf.json`

```sh
bun run bindings
```

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

## Checklist

- [ ] Version bumped in the three files and bindings regenerated.
- [ ] `bun run check` and `bun run rust:lint && bun run rust:test` pass.
- [ ] Installer built on each target OS.
- [ ] macOS artifact signed, notarized and stapled.
- [ ] App launches, opens a loopback test server, and reads/writes a file.
- [ ] Saved credentials survive a restart through the OS keychain.
- [ ] Release notes and changelog updated.
