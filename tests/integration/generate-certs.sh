#!/usr/bin/env bash
# Generate a throwaway CA and server certificate for the integration suite.
# Everything lands in ./certs (gitignored) and expires quickly.
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p certs

if [[ -f certs/pure-ftpd.pem ]]; then
  exit 0
fi

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
