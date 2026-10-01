/**
 * The e2e suite's **engine tap** — a wire between `ouroboros-rest` and `ouroboros-engine` that
 * remembers what the estimator was sent, so the knowledge leg can read it.
 *
 * [#422](https://github.com/NobuData/ouroboros/issues/422), BG.6. Two listeners:
 *
 * ```
 * :8000   everything `rest` sends the engine, forwarded to engine:8000 unchanged, and the
 *         answer returned unchanged. Compose-internal: no host port.
 * :8081   GET  /healthz           the compose healthcheck's route
 *         GET  /__tap/estimates   the estimate requests seen so far, oldest first
 *         POST /__tap/reset       forget them
 *         Published on the host's loopback. Forwards nothing.
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Why a tap exists at all.**
 *
 * The knowledge page's facts card says *"Confirmed facts are injected into every run's
 * context"*, and the issue's own gate is the hop that makes that sentence true: a fact
 * confirmed in the UI must be **present in the estimator's request payload**. `rest` builds
 * that payload and posts it to the engine at `POST /v0/estimate`; the engine's `heuristic-v0`
 * reads none of it, the answer does not echo it, and nothing stores it. So the one request the
 * gate is about was, until this fixture, unobservable from outside the two processes.
 *
 * What *is* stored is the injection record `rest` writes beside the request — and a leg that
 * asserted that instead would pass with the payload builder deleted, because the record is
 * written from the manifest and not from what was sent. The leg has to see the wire.
 *
 * So the same shape `provider-stub` and `tracker-stub` took: a real service at a real address,
 * reached over the real network. `docker-compose.e2e.yml` points `rest`'s `OURO_ENGINE_URL`
 * here, and here points at the engine.
 *
 * **It is a wire, not a mock.** Nothing here is told what the suite expects, and nothing here
 * answers for the engine: every request reaches it and every answer is its own. If the engine
 * is down, this answers `502` and `rest` reports `engine_unavailable`, exactly as it does for
 * an engine it cannot reach — which is what keeps the suite's `engine` failure-mode pairs
 * (`scripts/verify-failure-modes.sh`) meaning what they meant before there was a tap.
 *
 * **The engine stays unreachable from the host.** `docs/ARCHITECTURE.md` § 10 gives the engine
 * no host port and `specs/health.spec.ts` asserts it has none. The listener that forwards is
 * therefore not published; the one that is published forwards nothing. A tap that proxied on
 * its published port would be a host port for the engine under another name.
 *
 * **No headers are kept.** A request to the engine carries `X-Ouro-Internal-Key`, the shared
 * secret; only the path, the instant and the JSON body of an estimate are remembered, and the
 * body is the issue's text and the workspace's vocabulary — nothing a seeded stack holds in
 * confidence.
 *
 * **No dependencies, on purpose**, and `node:http` only, for `provider-stub`'s reason: a
 * fixture with a lockfile is a fixture that can fail to install on the morning of a release.
 */

import { createServer, request as send } from "node:http";

/** The forwarding listener's port — the engine's own, so `rest`'s URL changes by a host name only. */
const PROXY_PORT = 8000;

/** The control listener's port — the one compose publishes on the host's loopback. */
const CONTROL_PORT = 8081;

/**
 * Where the engine is. Fixed rather than read from the environment, for `provider-stub`'s
 * reason: this is composed at one address by one file, and a variable would be a second place
 * to disagree.
 */
const ENGINE = { host: "engine", port: 8000 };

/** The engine's estimate route — `ouroboros-rest`'s `ENGINE_ESTIMATE_ROUTE`. */
const ESTIMATE_PATH = "/v0/estimate";

/**
 * How many estimate requests are remembered. The suite sends a few dozen in a run; a bound is
 * what keeps a `--keep` stack somebody estimates against all afternoon from growing.
 */
const MAX_REMEMBERED = 500;

/** The largest body remembered. An estimate request is a few kilobytes. */
const MAX_BODY_BYTES = 1024 * 1024;

/** The estimate requests seen, oldest first. */
const estimates = [];

/**
 * Answer with a JSON document.
 *
 * @param {import("node:http").ServerResponse} response The response.
 * @param {number} status The status code.
 * @param {unknown} body What to send.
 * @returns {void}
 */
function json(response, status, body) {
  const payload = JSON.stringify(body);

  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload).toString(),
  });
  response.end(payload);
}

/**
 * Remember one estimate request, if its body is the JSON document an estimate is.
 *
 * @param {string} path The request's path.
 * @param {Buffer[]} chunks The body, as it arrived.
 * @returns {void}
 */
function remember(path, chunks) {
  let body;

  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    // Not JSON: the engine will refuse it, and there is nothing here to read back.
    return;
  }

  estimates.push({ at: new Date().toISOString(), path, body });

  if (estimates.length > MAX_REMEMBERED) estimates.shift();
}

/**
 * Forward one request to the engine and return its answer, unchanged in both directions.
 *
 * The body is piped, not buffered: the copy kept for an estimate is taken beside the stream,
 * so nothing the engine receives waits on this process reading it.
 *
 * @param {import("node:http").IncomingMessage} request The request `rest` sent.
 * @param {import("node:http").ServerResponse} response The response `rest` is waiting for.
 * @returns {void}
 */
function forward(request, response) {
  const path = request.url ?? "/";
  const watched = request.method === "POST" && path.split("?")[0] === ESTIMATE_PATH;
  const chunks = [];
  let held = 0;

  const upstream = send(
    {
      host: ENGINE.host,
      port: ENGINE.port,
      method: request.method,
      path,
      headers: { ...request.headers, host: `${ENGINE.host}:${ENGINE.port.toString()}` },
    },
    (answer) => {
      response.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(response);
    },
  );

  upstream.on("error", (error) => {
    // The engine is not answering. `rest` treats every non-2xx from its engine address as
    // `engine_unavailable`, which is what it would have said had it been refused directly.
    if (response.headersSent) {
      response.destroy();
      return;
    }

    json(response, 502, { detail: `engine-tap could not reach the engine: ${String(error)}` });
  });

  if (watched) {
    request.on("data", (chunk) => {
      held += chunk.length;

      if (held <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    request.on("end", () => {
      if (held <= MAX_BODY_BYTES) remember(path, chunks);
    });
  }

  request.pipe(upstream);
}

/**
 * Answer one control request.
 *
 * @param {import("node:http").IncomingMessage} request The request.
 * @param {import("node:http").ServerResponse} response The response.
 * @returns {void}
 */
function control(request, response) {
  const path = (request.url ?? "/").split("?")[0];
  const method = request.method ?? "GET";

  // Draining is not optional even when the body is ignored — see tracker-stub's `readBody`.
  request.resume();

  if (path === "/healthz" && method === "GET") {
    json(response, 200, { ok: true, remembered: estimates.length });
    return;
  }

  if (path === "/__tap/estimates" && method === "GET") {
    json(response, 200, { items: estimates });
    return;
  }

  if (path === "/__tap/reset" && method === "POST") {
    estimates.length = 0;
    json(response, 200, { ok: true });
    return;
  }

  json(response, 404, { message: "no such tap control" });
}

const proxy = createServer(forward);
const controls = createServer(control);

proxy.listen(PROXY_PORT, "0.0.0.0", () => {
  process.stdout.write(`engine-tap forwarding on ${PROXY_PORT.toString()}\n`);
});

controls.listen(CONTROL_PORT, "0.0.0.0", () => {
  process.stdout.write(`engine-tap controls on ${CONTROL_PORT.toString()}\n`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    // Both listeners, then out: a stop that waited on one of them would be Docker's ten-second
    // kill timer, on every `down`.
    proxy.close();
    controls.close();
    proxy.closeAllConnections();
    controls.closeAllConnections();
    process.exit(0);
  });
}
