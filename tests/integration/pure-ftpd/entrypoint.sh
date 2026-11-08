#!/bin/sh
# Minimal Pure-FTPd launcher for the sftply integration suite.
#
# Environment:
#   FTP_USER        system user name            (default: sftply)
#   FTP_PASSWORD    system user password        (default: sftply-test)
#   FTP_HOME        home / chroot directory     (default: /home/ftpuser)
#   FTP_PASSIVE     passive port range          (default: 30000:30009)
#   FTP_TLS         0 = plain, 1 = explicit, 2 = implicit (default: 0)
#   FTP_PORT        control port; 990 for implicit TLS (default: 21)
#   FTP_CERT        PEM certificate+key path    (default: /etc/ssl/private/pure-ftpd.pem)
set -eu

FTP_USER="${FTP_USER:-sftply}"
FTP_PASSWORD="${FTP_PASSWORD:-sftply-test}"
FTP_HOME="${FTP_HOME:-/home/ftpuser}"
FTP_PASSIVE="${FTP_PASSIVE:-30000:30009}"
FTP_TLS="${FTP_TLS:-0}"
FTP_PORT="${FTP_PORT:-21}"
FTP_CERT="${FTP_CERT:-/etc/ssl/private/pure-ftpd.pem}"

if ! id "$FTP_USER" >/dev/null 2>&1; then
    adduser -D -h "$FTP_HOME" -s /bin/sh "$FTP_USER"
fi

echo "$FTP_USER:$FTP_PASSWORD" | chpasswd

mkdir -p "$FTP_HOME"
chown -R "$FTP_USER":"$FTP_USER" "$FTP_HOME"
chmod 755 "$FTP_HOME"

set -- \
    -l unix \
    -E \
    -A \
    -j \
    -4 \
    -c 50 \
    -C 50 \
    -S 0.0.0.0,"$FTP_PORT" \
    -p "$FTP_PASSIVE"

# Force the advertised passive address to loopback: the suite runs the
# containers locally and the port numbers are mapped 1:1.
set -- "$@" -P 127.0.0.1

case "$FTP_TLS" in
    0) ;;
    1)
        set -- "$@" -Y 1 -2 "$FTP_CERT"
        ;;
    2)
        set -- "$@" -Y 2 -2 "$FTP_CERT"
        ;;
    *)
        echo "Unsupported FTP_TLS=$FTP_TLS" >&2
        exit 1
        ;;
esac

echo "Starting pure-ftpd (tls=$FTP_TLS, passive=$FTP_PASSIVE, home=$FTP_HOME)"
exec /usr/sbin/pure-ftpd "$@"
