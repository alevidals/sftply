# Implicit FTPS needs Pure-FTPd's compile-time --with-implicittls option,
# which Alpine's package does not enable. Build it from source in a throwaway
# stage and copy only the result into the runtime image.
FROM alpine:3.20 AS build

RUN apk add --no-cache build-base openssl-dev curl

ARG PURE_FTPD_VERSION=1.0.51
WORKDIR /src
RUN curl -fsSL \
      "https://download.pureftpd.org/pub/pure-ftpd/releases/pure-ftpd-${PURE_FTPD_VERSION}.tar.gz" \
      -o pure-ftpd.tar.gz \
    && tar xzf pure-ftpd.tar.gz

WORKDIR /src/pure-ftpd-${PURE_FTPD_VERSION}
RUN ./configure \
      --prefix=/usr \
      --sysconfdir=/etc \
      --localstatedir=/var \
      --with-implicittls \
      --with-virtualchroot \
      --without-capabilities \
    && make -j"$(nproc)" \
    && make install-strip DESTDIR=/rootfs

FROM alpine:3.20

RUN apk add --no-cache openssl \
    && mkdir -p /etc/ssl/private /home/ftpuser

COPY --from=build /rootfs/ /
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 990
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
