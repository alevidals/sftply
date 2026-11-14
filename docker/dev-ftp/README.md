# Minimal dev FTP server

A plain FTP server for manually testing sftply. It is intentionally small: no
TLS, one user and a persistent volume. The automated protocol matrix (plain FTP,
explicit FTPS, implicit FTPS and SFTP) lives in `tests/integration`.

## Start

```sh
docker compose -f docker/dev-ftp/docker-compose.yml up -d --build
# or
bun run dev:ftp
```

Wait for the log line `Starting pure-ftpd` and for port 2121 to accept
connections.

## Connect from sftply

| Field    | Value        |
| -------- | ------------ |
| Protocol | FTP          |
| Host     | `127.0.0.1`  |
| Port     | `2121`       |
| User     | `sftply`     |
| Password | `sftply-dev` |
| Start    | `/`          |

The home folder contains `welcome.txt` and an `upload` folder. The whole home
folder is writable, so uploads, folders, renames and deletes can be tested.

Passive data connections use ports `30000-30009`, mapped 1:1 to the host. The
server advertises `127.0.0.1` in `PASV` replies, which is correct for a client on
this machine.

## Connect from another machine

The `PASV` reply has to name the Mac, not the client's own loopback, and the
macOS firewall must allow the control port and the passive range.

```sh
# 192.168.1.209 is this Mac's LAN address; check with: ipconfig getifaddr en0
FTP_PUBLIC_IP=192.168.1.209 docker compose -f docker/dev-ftp/docker-compose.yml up -d
```

Then connect from the other machine to `<mac-lan-ip>:2121` with user `sftply` and
password `sftply-dev`. If the client is a virtual machine, use the address the VM
can reach: Parallels shared networking exposes the host at `10.211.55.2`, UTM at
`192.168.64.1`, and a bridged VM uses the same LAN address as the Mac.

`FTP_PUBLIC_IP` only affects new connections; restart the container after
changing it.

## Stop

```sh
docker compose -f docker/dev-ftp/docker-compose.yml down
# or
bun run dev:ftp:down
```

Add `-v` to remove the data volume as well.
