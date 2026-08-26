/**
 * The e2e suite's provider — a model host that answers, so the providers leg can connect one.
 *
 * [#233](https://github.com/NobuData/ouroboros/issues/233), AE.7. It speaks two wire formats
 * on one port: the OpenAI-compatible listing route `ouroboros-rest`'s
 * `openai-compatible.adapter.ts` validates and discovers against, and the three Ollama routes
 * `ollama.adapter.ts` uses — `/api/version`, `/api/tags` and the NDJSON `/api/pull`.
 *
 * ---------------------------------------------------------------------------
 * **Why this exists, when `docker-compose.e2e.yml` argued against inventing one.**
 *
 * That file's argument is about the **seed**, and it still stands: `R__dev_seed_providers.sql`
 * is mockup 07 as rows, its five connections point at `ken-station.local:11434` and
 * `10.0.4.20:8000`, and pointing them at a stub so the health strip could go green would make
 * the strip a report of what a fixture said rather than of what a provider did. Nothing here
 * touches those rows: the seeded cards keep their unreachable addresses, the sweep stays at
 * its slowest cadence, and the parity screenshots stay the seed's.
 *
 * What this is for is the half of AE.7 the seed **cannot** supply. A card only appears if the
 * adapter reached something and it answered — that is the add flow's whole promise — so a
 * suite with no reachable provider can assert the negative case and nothing else. Every leg
 * below the add flow is the same: a rotation is a *verify*-then-retire, a reveal needs an
 * envelope this deployment's vault actually sealed, and a pull needs a stream. So the leg
 * connects **its own** cards, to this, and deletes them again.
 *
 * AE.4's roadmap note handed AE.7 "the Playwright leg that stops the real container and pulls
 * a real model". This is the stoppable container; the model is not real, and the sentence in
 * the leg's header says why a gigabyte-and-a-half image and a network transfer cannot live
 * inside a stated budget of two and a half minutes.
 *
 * ---------------------------------------------------------------------------
 * **It is a provider, not a mock.** Nothing here is told what the suite expects. It applies
 * one rule — {@link ACCEPTED_KEY_PREFIX} — and answers `200` or `401` accordingly, exactly as
 * a vendor would, and the adapter classifies what comes back with no knowledge that the other
 * end is this file. The suite's negative cases are keys this rule refuses, not switches.
 *
 * **No dependencies, on purpose.** `node:http` and nothing else, so the image is the runtime
 * plus one file and a cold `--build` pays milliseconds for it. A fixture with a lockfile is a
 * fixture that can fail to install on the morning of a release.
 *
 * ---------------------------------------------------------------------------
 * **The pull is slow on purpose**, and {@link PULL_STEP_MS} × {@link PULL_STEPS} is the whole
 * of that decision. The leg reloads the page in the middle of a transfer and requires the bar
 * to still be moving, which is what makes *the progress is the service's* an assertion rather
 * than a hope — so the transfer has to outlive a navigation, and the UI polls every 1.5s
 * (`PULL_POLL_MS`). Eight seconds is comfortably more than that and small against the budget.
 */

import { createServer } from "node:http";

/**
 * The port. Fixed rather than read from the environment: this is composed at one address by
 * one file, and a variable would be a second place for the two to disagree.
 */
const PORT = 8080;

/**
 * The prefix a bearer token must carry to be accepted.
 *
 * The whole authorisation policy, and it is deliberately a *rule* rather than a list: the leg
 * rotates from one accepted key to another and needs two that work, and asserts a refusal with
 * one that does not. A list of literals here would have to be kept in step with the spec by
 * hand, and the first edit to get it wrong would look like a product failure.
 *
 * A request with **no** `Authorization` header at all is accepted, which is not laxity — it is
 * the case mockup 07's vLLM card is drawn for. `openai-compatible.adapter.ts` sends no header
 * when the connection stores no key, and a stub that refused that would make *"API key —
 * optional, no auth configured"* untestable.
 */
const ACCEPTED_KEY_PREFIX = "ouro-e2e-";

/** How long one pull step takes, in milliseconds. */
const PULL_STEP_MS = 500;

/** How many steps a pull takes before it reports success. Sixteen × 500ms is eight seconds. */
const PULL_STEPS = 16;

/** The transfer's declared size, so the bar is determinate from its first line. */
const PULL_TOTAL_BYTES = 4_000_000_000;

/**
 * The models this host serves, under both wire formats.
 *
 * Deliberately **not** the seed's spellings. `R__dev_seed_providers.sql` writes
 * `llama-4-maverick` and `qwen3-coder:32b`, and a fixture reusing them would let a leg pass
 * while reading a seeded card it thought was its own — the failure mode that is hardest to
 * see, because everything on the page looks right. Everything here is `e2e-…`, so a chip or a
 * pull row in the wrong card is legible at a glance.
 */
const MODELS = [
  { id: "e2e-small", sizeBytes: 1_200_000_000 },
  { id: "e2e-large", sizeBytes: 9_400_000_000 },
];

/**
 * Whether a request carries an acceptable credential.
 *
 * @param {import("node:http").IncomingMessage} request The request.
 * @returns {boolean} True when there is no `Authorization` header, or when it is a bearer
 *   token beginning {@link ACCEPTED_KEY_PREFIX}.
 */
function authorized(request) {
  const header = request.headers.authorization;

  if (header === undefined) return true;

  const [scheme, ...rest] = header.split(" ");

  return scheme.toLowerCase() === "bearer" && rest.join(" ").startsWith(ACCEPTED_KEY_PREFIX);
}

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
 * Stream a pull, in the shape `ollama.adapter.ts` reads: NDJSON progress, then `success`.
 *
 * The terminal line is the *only* statement of completion the adapter accepts — a stream that
 * merely ends is reported as `the pull ended before the host reported success` — so the
 * success line is written before the socket is closed and not instead of closing it.
 *
 * The timer is cleared when the socket goes away. A pull whose consumer disconnected is what
 * `provider.pulls.ts` does at shutdown, and a fixture that kept writing into a dead socket
 * would keep this container busy for the rest of the run.
 *
 * @param {import("node:http").ServerResponse} response The response to stream into.
 * @returns {void}
 */
function streamPull(response) {
  response.writeHead(200, { "content-type": "application/x-ndjson" });

  let step = 0;
  const timer = setInterval(() => {
    step += 1;

    if (step >= PULL_STEPS) {
      clearInterval(timer);
      response.write(`${JSON.stringify({ status: "success" })}\n`);
      response.end();
      return;
    }

    response.write(
      `${JSON.stringify({
        status: "pulling e2e0000000000000000000000000000000000000000000000000000000000000",
        completed: Math.round((PULL_TOTAL_BYTES * step) / PULL_STEPS),
        total: PULL_TOTAL_BYTES,
      })}\n`,
    );
  }, PULL_STEP_MS);

  response.on("close", () => clearInterval(timer));
}

/**
 * Read and discard a request body.
 *
 * `POST /api/pull` carries one, and a handler that answered without consuming it leaves the
 * socket in a state Node's keep-alive will not reuse — which presents as an intermittently
 * slow second pull rather than as an error.
 *
 * @param {import("node:http").IncomingMessage} request The request.
 * @returns {Promise<void>} When the body has been drained.
 */
function drain(request) {
  return new Promise((resolve) => {
    request.on("data", () => {});
    request.on("end", resolve);
  });
}

const server = createServer((request, response) => {
  const { pathname } = new URL(request.url ?? "/", `http://localhost:${PORT.toString()}`);

  // The compose healthcheck's route, and the only one that is not a provider's.
  if (pathname === "/healthz") {
    json(response, 200, { ok: true });
    return;
  }

  // ------------------------------------------------------------------ OpenAI-compatible
  //
  // One route: the listing. It is what `validate()` probes and what `discoverModels()` reads,
  // which is the whole of what this product asks an OpenAI-shaped endpoint for.
  if (pathname === "/v1/models") {
    if (!authorized(request)) {
      json(response, 401, { error: { message: "invalid api key", type: "invalid_request_error" } });
      return;
    }

    json(response, 200, {
      object: "list",
      data: MODELS.map((model) => ({ id: model.id, object: "model", owned_by: "ouroboros-e2e" })),
    });
    return;
  }

  // ------------------------------------------------------------------ Ollama
  //
  // Three routes, and no credential on any of them: a daemon on your own machine authenticates
  // nobody, which is why the adapter's schema declares a host and no key.
  if (pathname === "/api/version") {
    json(response, 200, { version: "0.12.3-ouroboros-e2e" });
    return;
  }

  if (pathname === "/api/tags") {
    json(response, 200, {
      models: MODELS.map((model) => ({
        name: model.id,
        model: model.id,
        size: model.sizeBytes,
        digest: "e2e0000000000000000000000000000000000000000000000000000000000000",
        modified_at: "2026-08-01T00:00:00Z",
      })),
    });
    return;
  }

  if (pathname === "/api/pull" && request.method === "POST") {
    void drain(request).then(() => streamPull(response));
    return;
  }

  json(response, 404, { error: "no such route on the e2e provider stub" });
});

server.listen(PORT, "0.0.0.0", () => {
  process.stdout.write(`provider-stub listening on ${PORT.toString()}\n`);
});

// Compose stops this container in the middle of the suite, on purpose — that is the
// test-connection leg's lever. Handling the signal is what makes the stop take a moment
// rather than the ten seconds Docker waits before killing an unresponsive process, and those
// ten seconds would be a twelfth of the leg's whole budget.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
