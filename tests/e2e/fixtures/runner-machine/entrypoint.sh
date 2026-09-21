#!/bin/sh
#
# machine-entrypoint — trust the gateway's CA, then be a machine that is switched on (#262).
#
# The CA arrives on a read-only volume the gateway publishes (`/farm-ca/ca.pem`; see
# ../farm-gateway/10-farm-certs.sh). Compose starts this container after the gateway is healthy,
# so the file is there — the loop is for the one case where it is not yet, a gateway that was
# recreated at the same moment, and it gives up loudly rather than starting a machine that will
# fail every download with a certificate error nobody can place.
#
# Then it waits. The agent is installed later, by whoever pastes the enroll command into
# `docker compose exec runner sh`; `systemctl` (the shim beside this file) starts it detached, so
# it outlives that exec, and compose's `init: true` reaps it when it exits. Killing this
# container is therefore *the machine went away*: every process in it, the agent included, ends
# with no goodbye — which is the event the presence sweep exists to notice.

set -eu

CA=/farm-ca/ca.pem
TRUSTED=/usr/local/share/ca-certificates/farm-gateway.crt

tries=0
until [ -s "$CA" ]; do
  tries=$((tries + 1))
  if [ "$tries" -gt 60 ]; then
    printf 'machine-entrypoint: %s never appeared — is the farm-gateway service up?\n' "$CA" >&2
    exit 1
  fi
  sleep 1
done

cp "$CA" "$TRUSTED"
update-ca-certificates >/dev/null

printf 'machine-entrypoint: ready — paste the enroll command from the Build Farm page.\n'

# `exec`, so the wait is the process compose's init supervises and signals.
exec sleep infinity
