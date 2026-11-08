FROM alpine:3.20

RUN apk add --no-cache pure-ftpd \
    && mkdir -p /etc/ssl/private /var/ftp

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 21 990
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
