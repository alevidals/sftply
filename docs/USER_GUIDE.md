# sftply user guide

Everything the app can do today, and what to do when a server says no.

## Install

Download the build for your system from
[Releases](https://github.com/alevidals/sftply/releases/latest). Builds are not
Developer ID signed or notarized, so the first launch asks for confirmation:

- **macOS**: the app is ad-hoc signed, not Developer ID signed and not
  notarized. Right-click `sftply.app` → **Open** → **Open**, or run
  `xattr -dr com.apple.quarantine /Applications/sftply.app`.
- **Windows**: builds are unsigned, so SmartScreen shows a warning. Choose
  **More info** → **Run anyway**. The portable `.exe` needs the WebView2 runtime
  that ships with Windows 10 (1803+) and 11.
- **Linux**: make the AppImage executable (`chmod +x`). It needs FUSE 2, or run
  it with `--appimage-extract-and-run`. WebKitGTK 4.1 comes from your
  distribution.

Verify `SHA256SUMS` before running a file from a mirror you do not control.

## First connection

**New connection** asks for:

| Field          | Notes                                                 |
| -------------- | ----------------------------------------------------- |
| Protocol       | FTP, FTPS (explicit), FTPS (implicit) or SFTP         |
| Host and port  | Defaults per protocol: 21, 21, 990, 22                |
| Username       | Required for SFTP; use `anonymous` for public FTP     |
| Authentication | Password, a private key file, or the SSH agent (SFTP) |
| Initial path   | Opened after connecting; defaults to `/`              |

For password and key-file connections, the password or passphrase is written to
the operating system keychain, never to `connections.json`. Deleting a
connection deletes its keychain entries. SSH agent connections store no secret.

**Test connection** probes the values you have typed: it opens a throwaway
connection, lists the initial folder and reports the latency and how many items
the folder contains. Nothing is saved and no session is opened. For SFTP, an
unknown host key still fails the probe, because the key must be reviewed first.

**Quick connect** (`⌘K`/`Ctrl+K` from the sidebar, or the bolt button) opens a
temporary session without saving anything, and has the same **Test connection**
button.

### Key authentication (SFTP)

Point at an OpenSSH or PEM private key. If it has a passphrase, sftply asks for
it once and stores it in the keychain. Keys are never copied into the app
configuration.

### SSH agent authentication (SFTP)

Choose **SSH agent** to let your existing agent sign the login. sftply never
reads the private key or stores a passphrase; it asks the agent for its loaded
identities and tries them until the server accepts one.

- macOS and Linux use `SSH_AUTH_SOCK`. On macOS, sftply also checks the login
  session through `launchctl` when the environment variable is missing.
- Windows uses the OpenSSH Authentication Agent, with Pageant as a fallback.
- If the agent is locked, unlock it in its own app (1Password, Secretive,
  KeePassXC, the Windows service, and so on) and reconnect.

Switching a saved connection to the agent removes any password or passphrase
that was stored for it.

## Host keys and certificates

The first time you connect to an SFTP host, sftply shows the host key
fingerprint. Compare it with what the server administrator published, then
trust it. Every later connection must present the same key; a change is a hard
failure with an explicit warning, because it can mean the server was replaced or
intercepted.

Known hosts are listed in Settings → Security, where you can remove an entry
after a legitimate key rotation or a server rebuild. Removing an entry makes the
next connection present the host key for review again.

For FTPS, TLS is verified against the system trust store. Two escape hatches
exist for private infrastructure:

- **CA file**: an absolute path to a PEM bundle.
- **Certificate pin**: the SHA-256 fingerprint of the server certificate.

Only disable certificate validation for a host you control and understand.

## Browsing

- `⌘1` / `⌘2` (`Ctrl+1` / `Ctrl+2`) focus the local and remote panes. The active
  pane has an accent line and a tinted header.
- `⌘L` edits the path of the active pane only.
- While editing a path, matching folders from the parent directory appear as you
  type; `↑`/`↓` choose, `Enter` opens, `Esc` cancels.
- The house icon in the local path bar jumps to your home folder.
- `⌘F` filters the current folder, `⌘R` refreshes.
- Arrow keys move, `Shift` extends, `Space` toggles, `Enter` opens, `F2` renames.
- `⌘A` selects everything, `Esc` clears the selection.
- Drag a selection between panes to transfer; the destination refreshes when the
  transfer completes.

The transfers and activity panel toggles with `⌘J` (`Ctrl+J`).

Remote bookmarks and recent paths live in the sidebar. They are stored per
connection and pruned when the connection is deleted.

## Transfers

The queue shows one row per file with size, progress, speed and errors. What you
can do with a row depends on the server:

- **Pause/resume** appears only when the protocol and server can actually resume.
  Otherwise the row offers retry, and sftply says the transfer restarts.
- **Cancel** stops the transfer and removes partial downloads; a cancelled
  transfer is never reported as complete.
- **Retry** re-queues failed items. A completed item is final.

Conflicts are preflighted before a transfer starts: overwrite, skip, rename or
apply the same choice to everything. History keeps metadata only, never
credentials, and is bounded.

**Permissions on upload.** A new remote file takes the mode the server assigns,
usually `0644`. Enable **Settings → Transfers → Preserve permissions on upload**
to copy the local Unix mode after the upload, when the server supports `chmod`.
The option is off by default: a permissive local mode can widen access on a
server that would otherwise create stricter files.

## Compare and sync

The compare action compares the current local folder with the current remote
folder. Choose **Local → remote** or **Remote → local** before reviewing the
plan. It does not write anything: it gives you a plan first.

| Status                      | Meaning                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------- |
| **Only local**              | Exists locally, missing remotely. Uploaded in Local → remote; kept in Remote → local.   |
| **Only remote**             | Exists remotely, missing locally. Downloaded in Remote → local; kept in Local → remote. |
| **Size differs**            | Same name, different size. Transferred in the selected direction when selected.         |
| **Date differs**            | Same size, different date. Not selected by default.                                     |
| **Content differs**         | Content verification found different bytes. Transferred when selected.                  |
| **Equal / Equal (content)** | Same metadata, or verified identical content. Skipped.                                  |
| **Unknown**                 | Missing or unreliable metadata. Review it before applying.                              |
| **Type mismatch**           | One side is a file and the other is a folder. Never applied automatically.              |

For files up to 4 MiB, a different date is resolved by hashing both sides. The
plan verifies at most 32 MiB and 200 files per comparison; larger date-only
differences stay in review. This matters on FTP servers that cannot preserve
modification times.

Use **Include** and **Exclude** globs to limit the plan, for example
`src/**, **/*.md` and `node_modules/**, .git/**`. Patterns are relative to the
source folder.

**Sync** transfers the selected files and creates the folders they need. Before
queueing, the app checks the target again; if it changed after the plan was
built, the plan refreshes instead of overwriting it.

### Deleting target-only items

Items that exist only in the target folder are kept by default. To remove them,
use the trash icon on a row or **Delete all**. A separate confirmation lists
the paths, warns that folders are deleted with their contents, and requires an
explicit acknowledgement. Normal Sync never deletes anything. Deletion cannot
be undone.

### Previews

Remote files can be previewed without downloading them first. Text is shown as
plain preformatted text, up to 2 MiB. Raster images up to 8 MiB are shown
inline. SVG and HTML files are shown as text and are never executed.

## Editing remote text files

Open a remote text file with **Edit text…** or by double-clicking it. Limits and
rules:

- UTF-8 only, up to 2 MiB.
- Binary files and anything that is not a regular file are refused.
- Saving writes a hidden temporary file and renames it over the original.
- If the file changed since you opened it, the save stops and asks before
  overwriting.

There is no autosave and no background sync.

## Permissions

The permissions dialog applies an octal or symbolic mode to the selected
entries. **Folder contents keep their current modes**: recursive changes are not
implemented yet, and the dialog says so instead of pretending otherwise.

## Import and export

Connections can be exported to a JSON file and imported on another machine.
The bundle contains names, protocols, hosts, ports, users, initial paths, TLS
settings, key _paths_ and favourites. It never contains passwords, passphrases
or key material.

Import merges: entries that already exist with the same protocol, host, port and
username are skipped, and the app reports how many were imported and why the
rest were not. Imported connections ask for their password again on first use.

## Updates

Settings → About shows the version and a **Check for updates** button. It makes
a single request to the public GitHub releases page, compares versions and
offers a link. sftply never downloads or installs updates by itself, and it does
not check in the background.

## Themes

Settings → Appearance offers the built-in palettes and any custom themes you add.
Custom themes live in the `themes` folder inside the app configuration directory:

```text
macOS:   ~/Library/Application Support/com.alevidals.sftply/themes/
Windows: %APPDATA%\com.alevidals.sftply\themes\
Linux:   ~/.config/com.alevidals.sftply/themes/
```

Use **Import** to copy a valid theme file into that folder, **Export** to save the
current theme, **Reload** after adding files manually, and **Folder** to open the
directory. Deleting a custom theme removes its file.

A theme is a text file with `key = value` lines. It must define every color
token the app uses; there are no defaults, derived colors or ANSI palette
shortcuts:

```text
name = Mine
variant = dark
background = #1e1e2e
foreground = #cdd6f4
card = #252536
card-foreground = #cdd6f4
popover = #292a3a
popover-foreground = #cdd6f4
primary = #89b4fa
primary-foreground = #1e1e2e
secondary = #303143
secondary-foreground = #cdd6f4
muted = #2a2b3c
muted-foreground = #a6adc8
accent = #353749
accent-foreground = #cdd6f4
destructive = #f38ba8
border = #3b3c50
input = #414258
ring = #89b4fa
chart-4 = #f9e2af
chart-5 = #f38ba8
sidebar = #181825
sidebar-foreground = #cdd6f4
sidebar-accent = #313244
sidebar-accent-foreground = #cdd6f4
sidebar-border = #3b3c50
sidebar-ring = #89b4fa
chrome = #181825
chrome-foreground = #a6adc8
panel-header = #1e1e2e
row-hover = #ffffff0a
row-selected = #89b4fa29
success = #a6e3a1
warning = #f9e2af
info = #89dceb
```

The fastest way to get a valid template is to select a built-in theme and use
**Export**. Every color is explicit; a missing token, an unknown key or an invalid
color makes sftply reject the file with a warning instead of loading a partial
theme.

Theme files never contain credentials.

## Data on disk

Settings → About lists the configuration and log directories. **Open logs**
opens the log folder in the system file manager.

- `connections.json` holds connection metadata, never secrets.
- `known_hosts.json` holds trusted SSH host keys for sftply only. It is separate from your system `~/.ssh/known_hosts`.
- `settings.json` holds appearance and behaviour preferences.
- `themes/*.theme` holds optional custom theme files.
- Logs are redacted. If you plan to share a log, skim it first.
- Logs rotate daily. The seven most recent daily files are kept; older ones are
  deleted automatically.

## Troubleshooting

**Authentication fails on FTP but the password is right.** Some servers require
the username in `user@domain` form, or reject the login until the data channel
connects. Try the other data mode (passive, extended passive, active).

**The listing is empty but the folder has files.** That usually means the server
only supports `LIST` with an unusual format, or the passive data port is blocked
by a firewall. sftply falls back to `LIST` when `MLSD` is unavailable.

**TLS errors on FTPS.** Check the certificate chain first. For private CAs, set
the CA bundle in the connection; for self-signed certificates, pin the SHA-256
fingerprint instead of disabling validation.

**“No SSH agent was found” or no identities.** Start your agent, add a key with
`ssh-add`, and reconnect. On macOS, an app opened from Finder may not see an
agent started only in a terminal; configure the agent for the login session or
choose a private key file instead.

**“Permission denied” when writing.** SFTP returns the server's error for the
remote path; check the parent directory mode with the permissions dialog. FTP
servers often report a generic 550 for both missing folders and denied writes.

**Timeouts during transfers.** Files larger than a few GB over slow links can exceed
the server's idle timeout. Retry resumes on servers that support it; otherwise the
transfer restarts.
