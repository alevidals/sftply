#!/bin/sh
# Minimal plain-FTP server for manually testing sftply.
#
# Environment:
#   FTP_USER      system user name        (default: sftply)
#   FTP_PASSWORD  system user password    (default: sftply-dev)
#   FTP_HOME      home / chroot directory (default: /home/ftpuser)
#   FTP_PASSIVE   passive port range      (default: 30000:30009)
set -eu

FTP_USER="${FTP_USER:-sftply}"
FTP_PASSWORD="${FTP_PASSWORD:-sftply-dev}"
FTP_HOME="${FTP_HOME:-/home/ftpuser}"
FTP_PASSIVE="${FTP_PASSIVE:-30000:30009}"

if ! id "$FTP_USER" >/dev/null 2>&1; then
    adduser -D -h "$FTP_HOME" -s /bin/sh "$FTP_USER"
fi

echo "$FTP_USER:$FTP_PASSWORD" | chpasswd

mkdir -p "$FTP_HOME" "$FTP_HOME/upload"
chown -R "$FTP_USER":"$FTP_USER" "$FTP_HOME"
chmod 755 "$FTP_HOME"

if [ ! -f "$FTP_HOME/welcome.txt" ]; then
    printf 'sftply dev FTP server\n\nUser: %s\n' "$FTP_USER" > "$FTP_HOME/welcome.txt"
    chown "$FTP_USER":"$FTP_USER" "$FTP_HOME/welcome.txt"
fi

echo "Starting pure-ftpd (plain FTP, passive=$FTP_PASSIVE, home=$FTP_HOME)"

# -A chroot every user to their home, -j create home on first login, -4 IPv4,
# -P advertises the loopback address because the container runs locally.
exec /usr/sbin/pure-ftpd \
    -l unix \
    -E \
    -A \
    -j \
    -4 \
    -c 20 \
    -C 10 \
    -S 0.0.0.0,21 \
    -p "$FTP_PASSIVE" \
    -P 127.0.0.1
