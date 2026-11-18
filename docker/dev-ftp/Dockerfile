FROM debian:bookworm-slim

# Debian's pure-ftpd is built with FEAT, MLSD and MFMT. Alpine's minimal
# package omits them, which breaks timestamp-preserving uploads and forces
# LIST fallbacks.
RUN apt-get update \
    && apt-get install -y --no-install-recommends pure-ftpd passwd tar \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /home/ftpuser

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 21 30000-30009
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
