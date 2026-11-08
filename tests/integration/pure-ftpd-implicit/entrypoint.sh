#!/bin/sh
# Pure-FTPd built with --with-implicittls. TLS is negotiated immediately on
# the control port, so no -Y flag is passed (explicit TLS is compiled out).
set -eu

FTP_USER="${FTP_USER:-sftply}"
FTP_PASSWORD="${FTP_PASSWORD:-sftply-test}"
FTP_HOME="${FTP_HOME:-/home/ftpuser}"
FTP_PASSIVE="${FTP_PASSIVE:-30020:30029}"
FTP_PORT="${FTP_PORT:-990}"
FTP_CERT="${FTP_CERT:-/etc/ssl/private/pure-ftpd.pem}"

if ! id "$FTP_USER" >/dev/null 2>&1; then
    adduser -D -h "$FTP_HOME" -s /bin/sh "$FTP_USER"
fi

echo "$FTP_USER:$FTP_PASSWORD" | chpasswd
mkdir -p "$FTP_HOME"
chown -R "$FTP_USER":"$FTP_USER" "$FTP_HOME"
chmod 755 "$FTP_HOME"

echo "Starting pure-ftpd implicit FTPS (port=$FTP_PORT, passive=$FTP_PASSIVE, home=$FTP_HOME)"
exec /usr/sbin/pure-ftpd \
    -l unix \
    -E \
    -A \
    -j \
    -4 \
    -c 50 \
    -C 50 \
    -S 0.0.0.0,"$FTP_PORT" \
    -p "$FTP_PASSIVE" \
    -P 127.0.0.1 \
    -Y 2 \
    -2 "$FTP_CERT"
