#!/bin/sh
#
# 10-farm-certs.sh — make the gateway's certificates, once, before nginx starts (#262).
#
# Two things are made, and they go to two places on purpose:
#
#   /etc/farm-gateway/          the CA's key, the server's key and the server's certificate.
#                               This container's own filesystem; nothing else mounts it.
#   /farm-ca/ca.pem             the CA's **certificate** and nothing else, on the volume the
#                               runner machine mounts read-only, so the machine can trust this
#                               gateway the way a real build machine trusts a private
#                               deployment: by being handed its CA.
#
# This CA has nothing to do with a workspace's **farm CA** (`farm_authorities`, AH.2). That one
# is made by `ouroboros-rest`, sealed in the vault, and signs *runner* certificates; this one
# signs the one *server* certificate a machine checks before it sends anything. They are
# separate in every real deployment too.
#
# Made only when absent. `compose stop` / `compose start` keeps this container's filesystem and
# runs this script again, and a second CA would strand a runner machine that already trusts the
# first — `verify-failure-modes.sh` stops and starts exactly this service. A recreated
# container starts from nothing and makes a new pair; `support/farm-runner.ts` recreates the
# machine at the start of the leg, so the machine always trusts the CA that is current.
#
# P-256 throughout, as the farm's own certificates are. The server certificate names the
# compose service, `farm-gateway`, because that is the host the enroll command carries
# (`OURO_FARM_PUBLIC_URL`) and the agent takes its SNI from the URL.

set -eu

DIR=/etc/farm-gateway
SHARED=/farm-ca
HOST=farm-gateway
DAYS=30

if [ -f "$DIR/server.pem" ] && [ -f "$DIR/server.key" ] && [ -f "$DIR/ca.pem" ]; then
  # The volume may be newer than this container (`down` without `-v` keeps it), so the
  # certificate is published again even when nothing had to be made.
  cp "$DIR/ca.pem" "$SHARED/ca.pem"
  exit 0
fi

mkdir -p "$DIR" "$SHARED"
umask 077

openssl ecparam -name prime256v1 -genkey -noout -out "$DIR/ca.key"
openssl req -x509 -new -key "$DIR/ca.key" -sha256 -days "$DAYS" \
  -subj "/CN=Ouroboros compose farm gateway CA" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -out "$DIR/ca.pem"

openssl ecparam -name prime256v1 -genkey -noout -out "$DIR/server.key"
openssl req -new -key "$DIR/server.key" -subj "/CN=$HOST" -out "$DIR/server.csr"

printf 'subjectAltName=DNS:%s\nbasicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\n' \
  "$HOST" >"$DIR/server.ext"

openssl x509 -req -in "$DIR/server.csr" -CA "$DIR/ca.pem" -CAkey "$DIR/ca.key" -CAcreateserial \
  -sha256 -days "$DAYS" -extfile "$DIR/server.ext" -out "$DIR/server.pem"

# The keys stay 0600 and root's: nginx's master process loads them before its workers drop to
# the image's `nginx` user, so nothing unprivileged ever needs to read one.
rm -f "$DIR/server.csr" "$DIR/server.ext"

umask 022
cp "$DIR/ca.pem" "$SHARED/ca.pem"
chmod 0644 "$SHARED/ca.pem"
