# The compose stack's build machine (#262, AI.7) — the computer the enroll command is run on.
#
# **There is no agent in this image**, and that is the point. The Build Farm page's promise is
# that one pasted line turns a bare machine into a runner, so what this image holds is a bare
# machine: Debian, `curl`, a trust store. The agent arrives the way it arrives anywhere — the
# copied `curl -fsSL https://…/install.sh | sh -s -- --tenant … --pool … --token …`, run verbatim
# — which is what makes a row appearing on the page evidence about the token, the installer,
# the release, the farm CA and the mTLS handshake at once, rather than about a Dockerfile.
#
# Two things stand in for what a container does not have, and each is as small as it can be:
#
#   * **`systemctl`** — `install.sh` always installs a systemd unit and starts it; it has no
#     foreground mode and is right not to grow one for a test. A container has no systemd, so
#     `systemctl` here is a forty-line shim that starts and stops the unit's own `ExecStart`.
#     Everything else `install.sh` does — the download, the SHA-256 check, the version check,
#     the enrolment, the unit file — is the real script doing the real thing.
#   * **the gateway's CA**, put in the trust store by the entrypoint. A build machine on a
#     private deployment is handed that deployment's CA by whoever administers it; this is the
#     same act, and it is what lets the copied command run with no `--server-ca` added to it.
#
# `debian:12-slim` because it is what a build machine most plausibly is, and because its
# `/bin/sh` is dash — the strictest shell `install.sh` promises to run under.
FROM debian:12-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl procps \
  && rm -rf /var/lib/apt/lists/*

# Ahead of /usr/bin on root's PATH, and Debian's slim image ships no systemctl to shadow.
COPY systemctl /usr/local/sbin/systemctl
COPY entrypoint.sh /usr/local/sbin/machine-entrypoint
RUN chmod 0755 /usr/local/sbin/systemctl /usr/local/sbin/machine-entrypoint

# Healthy means *ready to be pasted into*: the gateway's CA is trusted. It says nothing about
# an agent, because a healthy bare machine has none.
HEALTHCHECK --interval=5s --timeout=3s --retries=20 --start-period=5s --start-interval=1s \
  CMD test -f /usr/local/share/ca-certificates/farm-gateway.crt || exit 1

ENTRYPOINT ["/usr/local/sbin/machine-entrypoint"]
