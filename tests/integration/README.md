# Protocol integration suite

Real FTP, explicit FTPS, implicit FTPS and SFTP servers used by the ignored
Rust tests in `src-tauri/src/protocol/`.

## Requirements

- Docker (Compose v2) running locally.
- `openssl`, `nc`, `cargo`.

Everything runs on loopback. The images are built for the host architecture;
no Rosetta/amd64 emulation is required.

## Services

| Service         | Port(s) | Image                            | Notes                               |
| --------------- | ------- | -------------------------------- | ----------------------------------- |
| `ftp`           | `2121`  | `sftply/pure-ftpd-test`          | Plain FTP, passive `30000-30009`    |
| `ftps-explicit` | `2122`  | `sftply/pure-ftpd-test`          | `AUTH TLS`, passive `30010-30019`   |
| `ftps-implicit` | `2990`  | `sftply/pure-ftpd-implicit-test` | TLS from byte zero, `30020-30029`   |
| `sftp`          | `2222`  | `atmoz/sftp:alpine`              | OpenSSH, chrooted to `/home/sftply` |

Credentials for every service: `sftply` / `sftply-test`.

The implicit image compiles Pure-FTPd from source with `--with-implicittls`
because Alpine's package enables explicit TLS only. Implicit FTPS is a
compile-time switch in Pure-FTPd and is mutually exclusive with explicit TLS.

## Running

```sh
tests/integration/run.sh
```

The script generates a throwaway CA and server certificate in `certs/`
(gitignored), starts the stack, waits for each service, runs
`cargo test --lib -- --ignored`, and tears everything down.

Use `tests/integration/run.sh --keep` to leave the containers running, for
example while iterating on a single test:

```sh
cd src-tauri
cargo test --lib protocol::ftp::integration -- --ignored
```

## Certificates

`generate-certs.sh` creates:

- `certs/ca.crt` — test CA trusted by the FTP integration tests.
- `certs/pure-ftpd.pem` — server certificate and key for Pure-FTPd.

The CA includes the Authority Key Identifier extension because OpenSSL 3
refuses to verify leaf certificates without it.
