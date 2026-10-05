# The e2e suite's webhook receiver (#496, BS.6) — the https endpoint the settings leg creates a
# webhook for, pings, and reads the delivery back from. See server.mjs for what it answers and
# 10-receiver-certs.sh for the certificate it makes.
#
# `node:24-alpine`, as every other Node fixture here is, plus two packages. `openssl` is there
# because the certificate is **made when the container first starts** rather than committed —
# `farm-gateway`'s argument: a private key in a repository is a private key in every clone.
# `su-exec` is there so the one step that needs root (writing the CA where `rest` reads it) is
# the only step that has it.
FROM node:24-alpine

RUN apk add --no-cache openssl su-exec

WORKDIR /srv

COPY server.mjs ./
COPY 10-receiver-certs.sh /usr/local/bin/10-receiver-certs.sh
RUN chmod 0755 /usr/local/bin/10-receiver-certs.sh

# 8443 is the receiver, over TLS, and has no host port: only `rest` delivers to it, over the
# compose network. 8081 is the controls — what was received, and the one fault it can be asked
# to have — and is the port the suite reads.
EXPOSE 8443 8081

# The certificates first, as root; then the server, as `node`.
CMD ["sh", "-c", "/usr/local/bin/10-receiver-certs.sh && exec su-exec node node server.mjs"]
