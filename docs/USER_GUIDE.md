# sftply user guide

Everything the app can do today, and what to do when a server says no.

## Install

Download the build for your system from
[Releases](https://github.com/alevidals/sftply/releases/latest). Builds are not
OS-signed, so the first launch asks for confirmation:

- **macOS**: right-click `sftply.app` → **Open** → **Open**, or run
  `xattr -dr com.apple.quarantine /Applications/sftply.app`.
- **Windows**: SmartScreen → **More info** → **Run anyway**. The portable `.exe`
  needs the WebView2 runtime that ships with Windows 10 (1803+) and 11.
- **Linux**: make the AppImage executable (`chmod +x`). It needs FUSE 2, or run
  it with `--appimage-extract-and-run`. WebKitGTK 4.1 comes from your
  distribution.

Verify `SHA256SUMS` before running a file from a mirror you do not control.

## First connection

**New connection** asks for:

| Field          | Notes                                             |
| -------------- | ------------------------------------------------- |
| Protocol       | FTP, FTPS (explicit), FTPS (implicit) or SFTP     |
| Host and port  | Defaults per protocol: 21, 21, 990, 22            |
| Username       | Required for SFTP; use `anonymous` for public FTP |
| Authentication | Password or a private key file (SFTP)             |
| Initial path   | Opened after connecting; defaults to `/`          |

The password or passphrase is written to the operating system keychain, never to
`connections.json`. Deleting a connection deletes its keychain entries.

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

## Host keys and certificates

The first time you connect to an SFTP host, sftply shows the host key
fingerprint. Compare it with what the server administrator published, then
trust it. Every later connection must present the same key; a change is a hard
failure with an explicit warning, because it can mean the server was replaced or
intercepted.

Known hosts are listed in Settings → Security, where you can remove an entry
after a legitimate key rotation.

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

## Data on disk

Settings → About lists the configuration and log directories.

- `connections.json` holds connection metadata, never secrets.
- `known_hosts.json` holds trusted SSH host keys.
- `settings.json` holds appearance and behaviour preferences.
- Logs are redacted. If you plan to share a log, skim it first.

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

**“Permission denied” when writing.** SFTP returns the server's error for the
remote path; check the parent directory mode with the permissions dialog. FTP
servers often report a generic 550 for both missing folders and denied writes.

**Timeouts during transfers.** Files larger than a few GB over slow links can exceed
the server's idle timeout. Retry resumes on servers that support it; otherwise the
transfer restarts.
