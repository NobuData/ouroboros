/**
 * The e2e suite's webhook receiver — an https endpoint that keeps what it was sent, so the
 * settings leg can read a delivery back from **the receiving end**.
 *
 * [#496](https://github.com/NobuData/ouroboros/issues/496), BS.6 — the Settings MVP gate's
 * fourth leg: *webhook create → test ping → the delivery log shows the attempt at the fixture
 * receiver*. The delivery log is `ouroboros-rest`'s own account of what it sent. An assertion
 * on that alone would pass with the transport replaced by a function that writes a row; what
 * makes it a delivery is that something **else** received it, signed, at the address the
 * endpoint names.
 *
 * ---------------------------------------------------------------------------
 * **It is a receiver, not a mock.** Nothing here is told what the suite expects. It accepts a
 * `POST` to any path, keeps the method, the path, the headers and the raw body, and answers
 * `200`. It does not verify the signature — it does not hold the secret, and should not: the
 * secret is shown once, in the browser, and the leg verifies `X-Ouro-Signature` itself with the
 * value it read off that dialog. A receiver that verified would need the secret handed to it,
 * which is a second copy of the thing the product promises exists in one place.
 *
 * **Two listeners, and only one of them published** — `engine-tap`'s shape, for its reason.
 * `:8443` receives, over TLS, and has no host port: only `rest` delivers to it, across the
 * compose network, which is an internal address and is why `docker-compose.e2e.yml` names this
 * host in `OURO_WEBHOOK_INTERNAL_ALLOWLIST`. `:8081` is plain HTTP on loopback and serves the
 * controls:
 *
 * ```
 * GET  /healthz                  up, with the certificate loaded
 * GET  /__receiver/deliveries    everything received since the last reset, oldest first
 * POST /__receiver/reset         forget it all, and clear any fault
 * POST /__receiver/fault         {"status": 503} — answer every delivery with that, until reset
 * ```
 *
 * **The one fault** exists for `scripts/verify-settings.sh`: a leg that reads a ping's success
 * off the page has to be shown to go red when the receiving end refuses, and stopping the
 * container proves a different thing (that the leg names a missing fixture). It is a status
 * code and nothing else; the delivery is still recorded.
 *
 * **No dependencies, on purpose** — `provider-stub`'s argument.
 */

import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";

/** Where deliveries arrive, over TLS. Fixed, for `provider-stub`'s reason. */
const RECEIVE_PORT = 8443;

/** Where the controls answer, over plain HTTP. */
const CONTROL_PORT = 8081;

/** Where `10-receiver-certs.sh` leaves the server's certificate and key. */
const CERT_DIR = "/etc/webhook-receiver";

/** The most deliveries kept. A leg sends a handful; this is a bound, not a budget. */
const KEEP = 500;

/** The largest body kept whole, in bytes. `rest`'s own events are a few hundred. */
const BODY_LIMIT = 256 * 1024;

/** Every delivery received since the last reset, oldest first. */
let deliveries = [];

/** The status every delivery is answered with, or `null` for the receiver's own `200`. */
let fault = null;

/**
 * Read a request's body as text, bounded.
 *
 * @param request The request.
 * @returns The body — cut at {@link BODY_LIMIT}.
 */
function bodyOf(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let read = 0;

    request.on("data", (chunk) => {
      if (read < BODY_LIMIT) chunks.push(chunk.subarray(0, BODY_LIMIT - read));
      read += chunk.length;
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

/**
 * Answer with JSON.
 *
 * @param response The response.
 * @param status The status.
 * @param body What to serialise.
 */
function json(response, status, body) {
  const text = JSON.stringify(body);

  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  response.end(text);
}

/** The receiver: any `POST`, kept and answered. */
const receiver = createHttpsServer(
  {
    cert: readFileSync(`${CERT_DIR}/server.pem`),
    key: readFileSync(`${CERT_DIR}/server.key`),
  },
  (request, response) => {
    void bodyOf(request).then(
      (body) => {
        if (request.method !== "POST") {
          json(response, 405, { code: "method_not_allowed" });
          return;
        }

        deliveries.push({
          receivedAt: new Date().toISOString(),
          method: request.method,
          path: request.url ?? "/",
          // Node lower-cases header names, which is what the suite looks them up by.
          headers: request.headers,
          body,
        });
        if (deliveries.length > KEEP) deliveries = deliveries.slice(-KEEP);

        if (fault === null) json(response, 200, { received: true });
        else json(response, fault, { received: false, fault });
      },
      () => json(response, 400, { code: "unreadable_body" }),
    );
  },
);

/** The controls: what was received, and the one fault. */
const controls = createHttpServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://receiver.local");

  if (request.method === "GET" && url.pathname === "/healthz") {
    json(response, 200, { status: "ok" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/__receiver/deliveries") {
    json(response, 200, { deliveries });
    return;
  }

  if (request.method === "POST" && url.pathname === "/__receiver/reset") {
    deliveries = [];
    fault = null;
    json(response, 200, { reset: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/__receiver/fault") {
    void bodyOf(request).then((body) => {
      let status;

      try {
        status = JSON.parse(body).status;
      } catch {
        status = undefined;
      }

      if (!Number.isInteger(status) || status < 400 || status > 599) {
        json(response, 422, { code: "fault_status_invalid", message: "status must be 400–599" });
        return;
      }

      fault = status;
      json(response, 200, { fault });
    });
    return;
  }

  json(response, 404, { code: "not_found" });
});

receiver.listen(RECEIVE_PORT, "0.0.0.0", () => {
  // The controls come up second, so `/healthz` answering means the TLS listener already is.
  controls.listen(CONTROL_PORT, "0.0.0.0", () => {
    console.log(
      `webhook-receiver: deliveries on :${String(RECEIVE_PORT)} (TLS), controls on :${String(CONTROL_PORT)}`,
    );
  });
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    receiver.close();
    controls.close(() => process.exit(0));
  });
}
