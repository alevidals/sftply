#!/usr/bin/env bash
# Generate a throwaway CA and server certificate for the integration suite.
# Everything lands in ./certs (gitignored) and expires quickly.
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p certs

# Reuse the certificate only while it stays valid for the next hour. The
# suite is run sporadically, so a stale two-day certificate would otherwise
# fail every TLS test until the files were deleted by hand.
if [[ -f certs/pure-ftpd.pem ]] &&
  openssl x509 -checkend 3600 -noout -in certs/pure-ftpd.pem >/dev/null 2>&1; then
  exit 0
fi

rm -f certs/ca.key certs/ca.crt certs/ca.srl \
  certs/server.key certs/server.csr certs/server.crt certs/server.ext \
  certs/pure-ftpd.pem

openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
  -keyout certs/ca.key -out certs/ca.crt \
  -subj "/CN=sftply integration test CA" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -addext "subjectKeyIdentifier=hash" >/dev/null 2>&1

openssl req -newkey rsa:2048 -nodes \
  -keyout certs/server.key -out certs/server.csr \
  -subj "/CN=localhost" >/dev/null 2>&1

cat > certs/server.ext <<'EOF'
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
subjectAltName = DNS:localhost, IP:127.0.0.1
EOF

openssl x509 -req -in certs/server.csr -CA certs/ca.crt -CAkey certs/ca.key \
  -CAcreateserial -days 2 -extfile certs/server.ext -out certs/server.crt >/dev/null 2>&1

cat certs/server.crt certs/server.key > certs/pure-ftpd.pem
