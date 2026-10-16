/**
 * The e2e suite's **recorded provider** — an Anthropic Messages-format host that replays one
 * recorded, tool-using exchange, so the live slice runs to a pull request without a model.
 *
 * [#1314](https://github.com/NobuData/ouroboros/issues/1314), DI.5 — infrastructure option
 * 6-A of `docs/ROADMAP_OOE_LIVE_LOOP.md`: *a recorded provider fixture at the HTTP boundary*.
 * It stands where a provider stands, **below** `ouroboros-rest`'s Messages facade
 * (`/internal/harness/anthropic`, DH.2): the seeded connection
 * `Anthropic · recorded fixture` (`R__dev_seed_live_slice.sql`) names this container as its
 * `base_url`, the facade opens that connection and relays the harness's request here, and
 * everything above this socket — executor, facade, run-scoped credential, metering, working
 * tree, runner, push, pull request — is the real thing.
 *
 * ```
 * GET  /healthz                        compose's probe
 * GET  …/v1/models                     the key check the add/rotate flow sends; the recording's models
 * POST …/v1/messages                   the session, streamed or not — see replay.mjs
 * POST …/v1/messages/count_tokens      a rough count, so the harness's estimate has an answer
 * GET  /__fixture/recording            the recording's provenance and session shapes, without the turns
 * GET  /__fixture/requests             every request this process answered, oldest first
 * POST /__fixture/reset                forget them
 * ```
 *
 * The provider routes match by **suffix**, because two callers put different things in front
 * of them: the facade relays `/internal/harness/anthropic/v1/messages`, and the engine's
 * recording test points the harness's `ANTHROPIC_BASE_URL` straight at this socket.
 *
 * Three environment variables, all optional: `PROVIDER_FIXTURE_RECORDING` (the recording file,
 * relative to this one; default `./recordings/live-slice.json`), `PROVIDER_FIXTURE_PORT`
 * (default `8080`) and `PROVIDER_FIXTURE_KEY_PREFIX` (what an accepted key begins with;
 * default `ouro-e2e-`, the engine's test sets `ouro_hrn_`).
 *
 * ---------------------------------------------------------------------------
 * **It is a provider, not a mock.** Nothing here is told what a leg expects. It applies the
 * rules a provider applies — a key it accepts or refuses, a request it can answer or cannot —
 * and the one thing it knows that a provider does not is *which harness made the recording*.
 * A request from a different harness, or one that reaches a turn with other tool results than
 * the recording expects there, is refused with a `400` whose message names the recorded SDK
 * and CLI versions and what differed (`replay.mjs` § *Loud, never obscure*): the acceptance
 * criterion is that a recording made with a different harness version is **reported as such**
 * rather than failing somewhere deep in a session.
 *
 * **The recording is a file beside this one**, `recordings/live-slice.json` by default, or
 * whatever `PROVIDER_FIXTURE_RECORDING` names. The model's turns in it are scripted; the
 * harness's side — the beta set, the tools it offers, the shape of its history — was captured
 * from the pinned Claude Agent SDK by `ouroboros-engine/tests/test_live_slice_recording.py`,
 * which also holds the file to that SDK: when DH.3 moves the pin, that test goes red until the
 * recording is made again (`OURO_RECORD_LIVE_SLICE=1`). The file's `source`, `recorded_at` and
 * `harness` fields are the provenance the issue asks to be stored beside it.
 *
 * **No dependencies, on purpose**: `node:http`, `node:fs` and nothing else, for
 * `provider-stub`'s reason — a fixture with a lockfile is a fixture that can fail to install on
 * the morning of a release.
 */

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  anthropicError,
  authorized,
  checkRecording,
  decide,
  messageDocument,
  modelsListing,
  providerRoute,
  recordingSummary,
  sseFrames,
  usageOf,
} from "./replay.mjs";

/**
 * The port. Fixed in compose; `PROVIDER_FIXTURE_PORT` exists for a run on a developer's host
 * where 8080 is taken, and for the engine's recording test, which starts this file on a free
 * loopback port.
 */
const PORT = Number.parseInt(process.env.PROVIDER_FIXTURE_PORT ?? "8080", 10);

/**
 * What an accepted key begins with. `ouro-e2e-` is the rule behind the facade, where the key
 * is the one the leg stores on the seeded connection; the engine's recording test drives the
 * harness at this socket with no facade between, so the run-scoped credential (`ouro_hrn_…`)
 * arrives unswapped and the test sets `PROVIDER_FIXTURE_KEY_PREFIX=ouro_hrn_`.
 */
const KEY_PREFIX = process.env.PROVIDER_FIXTURE_KEY_PREFIX ?? "ouro-e2e-";

/** Where the recording is — beside this file unless the environment says otherwise. */
const RECORDING_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  process.env.PROVIDER_FIXTURE_RECORDING ?? "./recordings/live-slice.json",
);

/**
 * The recording, read once at start. A missing or malformed file stops the process with the
 * path and the reason: a fixture that started without its recording would answer `400` to
 * every session and look like a harness problem.
 */
function loadRecording() {
  let text;

  try {
    text = readFileSync(RECORDING_PATH, "utf8");
  } catch (error) {
    process.stderr.write(
      `provider-fixture: cannot read the recording at ${RECORDING_PATH}: ${String(error)}\n` +
        "provider-fixture: record one with ouroboros-engine/tests/test_live_slice_recording.py " +
        "(OURO_RECORD_LIVE_SLICE=1), or point PROVIDER_FIXTURE_RECORDING at one.\n",
    );
    process.exit(1);
  }

  try {
    return checkRecording(JSON.parse(text));
  } catch (error) {
    process.stderr.write(`provider-fixture: ${RECORDING_PATH} is ${String(error)}\n`);
    process.exit(1);
  }
}

const recording = loadRecording();

/** Every request answered since the last reset — what `/__fixture/requests` reports. */
let requests = [];

/** Message ids, counted up: `msg_fixture_1`, `msg_fixture_2`, … */
let answered = 0;

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
 * Read a request body to the end.
 *
 * @param {import("node:http").IncomingMessage} request The request.
 * @returns {Promise<Buffer>} The bytes.
 */
function readBody(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolveBody(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

/**
 * Remember one request, for `/__fixture/requests`.
 *
 * @param {Record<string, unknown>} entry What happened.
 * @returns {void}
 */
function log(entry) {
  requests.push({ at: new Date().toISOString(), ...entry });
}

/**
 * Answer `POST /v1/messages`.
 *
 * @param {import("node:http").IncomingMessage} request The request.
 * @param {import("node:http").ServerResponse} response The response.
 * @param {Buffer} raw The body's bytes.
 * @returns {void}
 */
function messages(request, response, raw) {
  let body;

  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    log({ path: "/v1/messages", main: false, session: null, turn: null, model: null, status: 400 });
    json(response, 400, anthropicError("invalid_request_error", "the request body is not JSON"));
    return;
  }

  if (typeof body !== "object" || body === null) {
    log({ path: "/v1/messages", main: false, session: null, turn: null, model: null, status: 400 });
    json(
      response,
      400,
      anthropicError("invalid_request_error", "the request body is not an object"),
    );
    return;
  }

  const verdict = decide(recording, body, request.headers);
  const model = typeof body.model === "string" ? body.model : null;

  if (verdict.status !== 200) {
    log({
      path: "/v1/messages",
      main: verdict.main,
      session: verdict.session,
      turn: verdict.turn,
      model,
      status: 400,
      mismatch: verdict.mismatch,
    });
    process.stderr.write(`provider-fixture: ${verdict.message}\n`);
    json(response, 400, anthropicError("invalid_request_error", verdict.message));
    return;
  }

  log({
    path: "/v1/messages",
    main: verdict.main,
    session: verdict.session,
    turn: verdict.turn,
    model,
    status: 200,
  });

  answered += 1;
  const id = `msg_fixture_${answered.toString()}`;
  const usage = usageOf(raw.length, verdict.content);

  if (body.stream === true) {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    for (const frame of sseFrames(id, model ?? "", verdict.content, usage)) {
      response.write(frame);
    }
    response.end();
    return;
  }

  json(response, 200, messageDocument(id, model ?? "", verdict.content, usage));
}

const server = createServer((request, response) => {
  const { pathname } = new URL(request.url ?? "/", `http://localhost:${PORT.toString()}`);
  const method = request.method ?? "GET";

  // The compose healthcheck's route, and the only one that is not a provider's.
  if (pathname === "/healthz" && method === "GET") {
    json(response, 200, { ok: true, recording: recording.recording, harness: recording.harness });
    return;
  }

  // ------------------------------------------------------------------ the fixture's own controls
  if (pathname.startsWith("/__fixture/")) {
    void readBody(request).then(() => {
      if (pathname === "/__fixture/recording" && method === "GET") {
        json(response, 200, recordingSummary(recording));
      } else if (pathname === "/__fixture/requests" && method === "GET") {
        json(response, 200, requests);
      } else if (pathname === "/__fixture/reset" && method === "POST") {
        requests = [];
        answered = 0;
        json(response, 200, { ok: true });
      } else {
        json(response, 404, anthropicError("not_found_error", "no such fixture control"));
      }
    });
    return;
  }

  // ------------------------------------------------------------------ the provider
  //
  // Routes are matched by suffix: the facade relays `<its prefix>/v1/messages`, and a harness
  // pointed straight at this socket posts `<base>/v1/messages` — the same route either way.
  const route = providerRoute(pathname);

  if (route === null) {
    void readBody(request).then(() => {
      json(
        response,
        404,
        anthropicError(
          "not_found_error",
          `no such route on the provider fixture: ${method} ${pathname}`,
        ),
      );
    });
    return;
  }

  if (!authorized(request.headers, KEY_PREFIX)) {
    void readBody(request).then(() => {
      log({ path: pathname, main: false, session: null, turn: null, model: null, status: 401 });
      json(response, 401, anthropicError("authentication_error", "invalid x-api-key"));
    });
    return;
  }

  if (route === "models" && method === "GET") {
    json(response, 200, modelsListing(recording));
    return;
  }

  if (route === "messages" && method === "POST") {
    void readBody(request).then((raw) => messages(request, response, raw));
    return;
  }

  if (route === "count_tokens" && method === "POST") {
    void readBody(request).then((raw) => {
      log({ path: pathname, main: false, session: null, turn: null, model: null, status: 200 });
      json(response, 200, { input_tokens: Math.max(1, Math.floor(raw.length / 4)) });
    });
    return;
  }

  void readBody(request).then(() => {
    json(
      response,
      404,
      anthropicError(
        "not_found_error",
        `no such route on the provider fixture: ${method} ${pathname}`,
      ),
    );
  });
});

server.listen(PORT, "0.0.0.0", () => {
  process.stdout.write(
    `provider-fixture listening on ${PORT.toString()} — recording ${recording.recording} ` +
      `(Claude Agent SDK ${recording.harness.sdk}, CLI ${recording.harness.cli})\n`,
  );
});

// Compose may stop this container on purpose (the failure-mode script's lever). Handling the
// signal is what makes the stop take a moment rather than Docker's ten-second kill timer.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
