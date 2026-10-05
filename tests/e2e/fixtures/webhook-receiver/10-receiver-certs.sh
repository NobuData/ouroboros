#!/bin/sh
#
# 10-receiver-certs.sh — the webhook receiver's certificate, made on first start (#496).
#
# `ouroboros-rest` delivers webhooks over https and nothing else: the URL policy refuses
# `http://` at save and at delivery, and the operator's internal allowlist never relaxes that
# (`webhook.ssrf.ts`). So a receiver the suite can read back has to speak TLS, and `rest` has to
# trust what it presents — which is exactly what a deployment with an internal collector does:
# it runs its own CA and hands Node the certificate (`NODE_EXTRA_CA_CERTS`).
#
# Two directories, on two volumes:
#
#   /etc/webhook-receiver   the CA's key, the server's key and certificate. This container's
#                           alone. A volume rather than the image's filesystem so a recreated
#                           container presents the certificate `rest` already trusts — `rest`
#                           reads its extra CA once, at start.
#   /webhook-ca             the CA certificate and nothing else, mounted read-only into `rest`.
#
# The same shape, and the same thirty days, as fixtures/farm-gateway/10-farm-certs.sh.

set -eu

DIR=/etc/webhook-receiver
SHARED=/webhook-ca
HOST=webhook-receiver
DAYS=30

publish() {
  cp "$DIR/ca.pem" "$SHARED/ca.pem"
  chmod 0644 "$SHARED/ca.pem"
  # The server runs as `node` and reads its own key; nobody else in the container needs to.
  chown -R node:node "$DIR"
}

if [ -f "$DIR/server.pem" ] && [ -f "$DIR/server.key" ] && [ -f "$DIR/ca.pem" ]; then
  # The shared volume may be newer than this one (`down` without `-v` keeps both, but either
  # can be dropped alone), so the certificate is published again even when nothing was made.
  publish
  exit 0
fi

mkdir -p "$DIR" "$SHARED"
umask 077

openssl ecparam -name prime256v1 -genkey -noout -out "$DIR/ca.key"
openssl req -x509 -new -key "$DIR/ca.key" -sha256 -days "$DAYS" \
  -subj "/CN=Ouroboros e2e webhook receiver CA" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -out "$DIR/ca.pem"

openssl ecparam -name prime256v1 -genkey -noout -out "$DIR/server.key"
openssl req -new -key "$DIR/server.key" -subj "/CN=$HOST" -out "$DIR/server.csr"

printf 'subjectAltName=DNS:%s\nbasicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\n' \
  "$HOST" >"$DIR/server.ext"

openssl x509 -req -in "$DIR/server.csr" -CA "$DIR/ca.pem" -CAkey "$DIR/ca.key" -CAcreateserial \
  -sha256 -days "$DAYS" -extfile "$DIR/server.ext" -out "$DIR/server.pem"

rm -f "$DIR/server.csr" "$DIR/server.ext"

umask 022
publish
