FROM alpine:3.20

RUN apk add --no-cache pure-ftpd \
    && mkdir -p /home/ftpuser

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 21 30000-30009
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
