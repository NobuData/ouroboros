# The compose stack's farm gateway (#262, AI.7) — the TLS front a runner machine reaches the
# deployment through. See nginx.conf for what it forwards and 10-farm-certs.sh for the
# certificates it makes.
#
# It exists because of two facts that are both deliberate. `ouroboros-rest` in this stack speaks
# plain HTTP on the compose network, and the Go agent speaks `https://` and `wss://` and nothing
# else — there is no insecure flag anywhere in `ouroboros-runner`, by design. Every real
# deployment closes that gap with a TLS-terminating proxy that forwards the runner's client
# certificate (`docs/SECURITY_MODEL.md` § 7.6); this is that proxy, as small as it can be.
#
# `nginx:1.27-alpine` plus one package. `openssl` is the only thing added, and it is added
# because the certificates are **made when the container first starts** rather than committed:
# a private key in a repository is a private key in every clone, and a CA nobody controls is
# the first thing an accident would ship.
FROM nginx:1.27-alpine

RUN apk add --no-cache openssl

COPY nginx.conf /etc/nginx/nginx.conf

# The official image runs every executable in this directory before it starts nginx, in name
# order — which is the hook that makes "the certificates exist" a precondition of "nginx is
# up" without replacing the image's entrypoint.
COPY 10-farm-certs.sh /docker-entrypoint.d/10-farm-certs.sh
RUN chmod 0755 /docker-entrypoint.d/10-farm-certs.sh

EXPOSE 443

# nginx answers this itself, over the certificate it was started with, so *healthy* means the
# keys were made and the listener is up. It says nothing about `rest`, deliberately: compose
# already orders this service after `rest` is healthy, and a gateway that turned unhealthy when
# `rest` did would make `verify-failure-modes.sh`'s pairs wait on two services instead of one.
HEALTHCHECK --interval=5s --timeout=3s --retries=10 --start-period=5s --start-interval=1s \
  CMD wget -qO- --no-check-certificate https://127.0.0.1/healthz >/dev/null 2>&1 || exit 1
