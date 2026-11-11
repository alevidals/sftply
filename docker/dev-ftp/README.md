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
server advertises `127.0.0.1` as the passive address, which is correct for a
local desktop client. Connecting from another machine would need a different
`-P` value and matching firewall rules.

## Stop

```sh
docker compose -f docker/dev-ftp/docker-compose.yml down
# or
bun run dev:ftp:down
```

Add `-v` to remove the data volume as well.
