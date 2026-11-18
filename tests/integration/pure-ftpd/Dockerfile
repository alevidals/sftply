FROM debian:bookworm-slim

# Debian's pure-ftpd includes FEAT, MLSD and MFMT, which the sync integration
# tests exercise. Alpine's minimal package omits them.
RUN apt-get update \
    && apt-get install -y --no-install-recommends pure-ftpd passwd \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /etc/ssl/private /var/ftp

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 21 990
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
