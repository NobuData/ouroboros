/**
 * `ouroboros-engine`, as a listening server that holds itself to the engine's own contract —
 * L.5 ([#109](https://github.com/NobuData/ouroboros/issues/109)).
 *
 * The #37 harness starts everything below this service and nothing above it; the engine is the
 * one dependency the pipeline reaches *outward* for, and every acceptance criterion L.3, L.4
 * and L.5 have is a claim about what happens on the way back. So the pipeline suites need an
 * engine, and the question this file answers is what kind.
 *
 * **Not a stubbed `EngineClient`.** The client takes its `fetch` as a constructor parameter, so
 * `engine.fixture.ts` can drive it over a function — and that is the right shape for the
 * client's *own* suite, which is about retries and headers. A suite about *persistence* wants
 * the whole leg: `OURO_ENGINE_URL` points here, the shared secret is checked here, and the body
 * that reaches V026 is one that went over a socket and back through the real zod parse. What
 * that catches is a `snake_case` key nobody translated — precisely the failure between L.3 and
 * L.1.
 *
 * **And not a server that answers whatever a test typed.** That was the ad-hoc stub inside
 * `estimation.integration-spec.ts` before this ticket, and it had a hole with a name: *the
 * fake was free to be wrong in the same direction as the code*. A body with a field the
 * contract does not publish, or missing one it requires, would sail through a suite that only
 * ever compared it against itself — and the first real engine build would fail in production
 * against a green pipeline. So:
 *
 *   * **Every response this stub serves is validated against the committed L.1 schema** —
 *     `ouroboros-engine/openapi.yaml`, the same document `engine.contract.spec.ts` reads, and
 *     the document the engine itself serves verbatim rather than generates. `Estimate` for a
 *     `200`, `Error` for anything else. A test that means to answer off-contract says so
 *     ({@link EngineAnswer.offContract}); a test that did not mean to gets a `500` and a line
 *     in {@link EngineStub.violations}.
 *   * **Every request it receives is validated too**, against `EstimateRequest`. That half is
 *     about the *caller*: `estimateRequestBody` translating one key wrongly is a `422` here
 *     with the field named, rather than an estimate that happens to come back anyway because
 *     the fake never looked.
 *   * **The shared secret is checked**, the way `ouroboros-engine/src/ouroboros_engine/core/
 *     security.py` checks it, and an unpublished route is a `404`. Both are recorded as
 *     violations: a gateway calling the wrong path with no key is a failure whether or not the
 *     answer it got happened to satisfy the test.
 *
 * The consequence, and the ticket's fourth acceptance criterion: **a change to the engine's
 * contract breaks the stub.** Add a required field to `Estimate` and {@link startEngineStub}
 * refuses to start, because the default body it is about to serve no longer validates. That is
 * the failure a contract change should produce — a red suite in the service that has to be
 * taught the new field, rather than a green one that finds out in production.
 *
 * ```ts
 * const engine = await startEngineStub();
 * const api = await ApiHarness.start({ OURO_ENGINE_URL: engine.url });
 * // …
 * engine.respond(engineUnavailable());
 * // …
 * expect(engine.violations).toEqual([]);
 * await engine.stop();
 * ```
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { parse } from "yaml";

import { DEVELOPMENT_ENVIRONMENT } from "../modules/config/configuration.fixture";
import { ENGINE_ESTIMATE_ROUTE, INTERNAL_KEY_HEADER } from "../modules/engine/engine.contract";
import { ENGINE_ESTIMATE_BODY, ENGINE_STATUS_BODY } from "../modules/engine/engine.fixture";

/**
 * The secret the stub expects on every internal call.
 *
 * The development default, which is what {@link testConfiguration} gives every harnessed
 * application — so the two agree by construction rather than by a literal copied twice. A
 * suite that overrides `OURO_ENGINE_SHARED_SECRET` passes the same value to
 * {@link startEngineStub}.
 */
export const ENGINE_STUB_SECRET = DEVELOPMENT_ENVIRONMENT.OURO_ENGINE_SHARED_SECRET;

/** Where sizing is asked for, with the leading slash a URL carries. */
export const ESTIMATE_PATH = `/${ENGINE_ESTIMATE_ROUTE}`;

/** The engine's open liveness route — #51, and the only one that takes no key. */
export const LIVENESS_PATH = "/healthz";

/** The engine's build-identity route. */
export const STATUS_PATH = "/v0/status";

/** One answer the stub is to give. */
export interface EngineAnswer {
  /** The status code to serve. */
  readonly status: number;
  /** The body to serve, as an object — serialised here. */
  readonly body: unknown;
  /**
   * Serve this body **without** holding it to the contract.
   *
   * For the one kind of test that needs an engine the contract forbids: *what does this
   * service do when the engine answers something outside `/v0`?* Saying so is the point — an
   * unmarked answer that does not validate is the stub's failure to report, and a marked one
   * is the suite's deliberate act.
   */
  readonly offContract?: boolean;
}

/**
 * What to answer, given how many estimate calls have already been made.
 *
 * The attempt number is 1-based and counts the calls that *reached the operation* — so a
 * responder can answer the first attempt one way and the retry another, which is how the
 * orchestrator's `MAX_ENGINE_ATTEMPTS` becomes observable.
 */
export type EngineResponder = (attempt: number) => EngineAnswer;

/** An engine a test scripts, listening on a real port. */
export interface EngineStub {
  /** Where it is, as `OURO_ENGINE_URL` wants it. */
  readonly url: string;
  /**
   * Every estimate request body it accepted, in order and in the engine's own names.
   *
   * Only the ones that passed the contract check: a body the engine would have refused is a
   * violation rather than a request, and counting it here would let a suite assert *the engine
   * was called* about a call the engine rejected.
   */
  readonly requests: Record<string, unknown>[];
  /**
   * Everything this stub was asked to do that the contract does not allow, in order.
   *
   * Asserted empty by the suites that use it. Each line names the route, the direction and the
   * schema violation, so a red suite says which field.
   */
  readonly violations: string[];
  /** Answer the next calls with whatever this says. */
  respond(responder: EngineResponder): void;
  /** Forget the requests and the violations, and go back to answering the mockup's estimate. */
  reset(): void;
  /** Stop listening. */
  stop(): Promise<void>;
}

/** An answer that is a well-formed estimate — the mockup's, with whatever a test changes. */
export function estimateAnswer(overrides: Record<string, unknown> = {}): EngineAnswer {
  return { status: 200, body: { ...ENGINE_ESTIMATE_BODY, ...overrides } };
}

/**
 * An engine that is up but cannot answer — the contract's own error envelope.
 *
 * @param status - The status to answer with. `503` is *the engine is having a moment*, which
 *   is the failure the orchestrator's retry is written for.
 * @param code - The engine's error code, as its envelope carries it.
 * @returns The answer, contract-valid so the stub serves it unremarked.
 */
export function engineFailure(status = 503, code = "unavailable"): EngineAnswer {
  return {
    status,
    body: {
      code,
      message: "The engine could not answer this request.",
      details: {},
    },
  };
}

/**
 * A body outside `/v0` altogether — what a proxy's error page or an older build looks like.
 *
 * Marked off-contract, because being outside the contract is the whole of what it tests.
 *
 * @param body - The body to serve. Defaults to an estimate carrying an effort the enum has
 *   never had, which is the drift most worth a test: it is a `200`, it is JSON, and only the
 *   parse stands between it and a column.
 * @returns The answer.
 */
export function offContractAnswer(
  body: unknown = { ...ENGINE_ESTIMATE_BODY, effort: "enormous" },
): EngineAnswer {
  return { status: 200, body, offContract: true };
}

/** The parts of the engine's specification this file reads. */
interface EngineSpecification {
  components?: { schemas?: Record<string, unknown> };
}

/** One compiled schema, and the name the engine's document knows it by. */
interface CompiledSchema {
  /** The engine's own name for it — what a violation message has to say. */
  readonly name: string;
  /** The compiled check. */
  readonly validate: ValidateFunction;
}

/**
 * The schemas the stub holds itself to, compiled — keyed by what each is *for* here rather
 * than by the engine's name for it, because two of them ({@link Contract.failure} and
 * {@link Contract.status}) would otherwise collide with words this file already uses.
 */
interface Contract {
  /** `EstimateRequest` — what a caller may send. */
  readonly request: CompiledSchema;
  /** `Estimate` — what a `200` may carry. */
  readonly estimate: CompiledSchema;
  /** `Error` — what anything else may carry. */
  readonly failure: CompiledSchema;
  /** `Liveness` — what `GET /healthz` may carry. */
  readonly liveness: CompiledSchema;
  /** `ServiceStatus` — what `GET /v0/status` may carry. */
  readonly status: CompiledSchema;
}

/** Compiled once per process; the document does not change under a run. */
let compiled: Contract | undefined;

/**
 * The engine's committed schemas, rewritten as a JSON Schema root.
 *
 * The document is OpenAPI 3.1, whose schemas *are* JSON Schema 2020-12 — so the only
 * translation needed is where the internal references point. `#/components/schemas/Breakdown`
 * is a pointer into the OpenAPI document; Ajv is given a root that is only the schemas, so the
 * pointers are rewritten to `#/$defs/Breakdown` in one pass over the serialised form.
 *
 * @returns The `$defs` map, keyed by the engine's own schema names.
 * @throws {Error} When the document no longer publishes a `components.schemas` block — which
 *   is a contract change large enough that failing here is the honest outcome.
 */
function engineSchemas(): Record<string, unknown> {
  const path = join(__dirname, "..", "..", "..", "ouroboros-engine", "openapi.yaml");
  const document = parse(readFileSync(path, "utf8")) as EngineSpecification;
  const schemas = document.components?.schemas;

  if (schemas === undefined) {
    throw new Error(
      `${path} publishes no components.schemas; the engine stub cannot hold itself to a ` +
        "contract it cannot read.",
    );
  }

  return JSON.parse(
    JSON.stringify(schemas).replaceAll("#/components/schemas/", "#/$defs/"),
  ) as Record<string, unknown>;
}

/**
 * The compiled contract, built on first use.
 *
 * `strict: false` for the reason `openapi.spec.ts` sets it: an OpenAPI schema carries
 * annotations — `examples`, `title` on a subschema — that strict mode reports as unknown
 * keywords. `allErrors` so a violation names every field rather than the first.
 *
 * @returns The validators.
 * @throws {Error} When a schema this stub is written against is gone from the document.
 */
function contract(): Contract {
  if (compiled !== undefined) {
    return compiled;
  }

  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);

  const $defs = engineSchemas();
  const bind = (name: string): CompiledSchema => {
    if (!(name in $defs)) {
      throw new Error(
        `ouroboros-engine/openapi.yaml no longer publishes a ${name} schema. The engine stub ` +
          "is written against it; teach the stub the new shape rather than removing the check.",
      );
    }

    return { name, validate: ajv.compile({ $defs, $ref: `#/$defs/${name}` }) };
  };

  compiled = {
    request: bind("EstimateRequest"),
    estimate: bind("Estimate"),
    failure: bind("Error"),
    liveness: bind("Liveness"),
    status: bind("ServiceStatus"),
  };

  return compiled;
}

/**
 * Hold one document to one of the engine's schemas.
 *
 * Exported because it is useful on its own: a fixture body that has drifted from the contract
 * is worth catching in the unit suite, where there is no container to start.
 *
 * @param schema - Which schema, by the engine's own name for it.
 * @param document - The body to check.
 * @returns The reason it is not valid, or `undefined` when it is.
 */
export function contractViolation(schema: keyof Contract, document: unknown): string | undefined {
  const { name, validate } = contract()[schema];

  if (validate(document)) {
    return undefined;
  }

  const reasons = (validate.errors ?? [])
    .map((error) => `${error.instancePath === "" ? "(root)" : error.instancePath} ${error.message}`)
    .join("; ");

  return `does not satisfy the engine's ${name} schema: ${reasons}`;
}

/** One request, reduced to what the stub decides with. */
interface Incoming {
  readonly method: string;
  readonly path: string;
  readonly key: string | undefined;
  readonly raw: string;
}

/**
 * Start an engine that answers what a test says, within what the contract allows.
 *
 * @param options - What to be different about it. `sharedSecret` matches whatever the
 *   application under test was configured with; `answer` is what it serves before a test says
 *   otherwise.
 * @returns The stub, already listening on a loopback port.
 * @throws {Error} When the default answer does not satisfy the committed `Estimate` schema —
 *   the contract changed, and this is where the service finds out.
 */
export async function startEngineStub(
  options: { sharedSecret?: string; answer?: EngineAnswer } = {},
): Promise<EngineStub> {
  const secret = options.sharedSecret ?? ENGINE_STUB_SECRET;
  const fallback = options.answer ?? estimateAnswer();

  // Before a socket exists. A default body that has drifted from the contract is not a test
  // failure in one spec — it is every spec in every pipeline suite asserting against a shape
  // the engine no longer answers with, and the sentence a reader needs is this one rather than
  // twenty assertion diffs.
  const drift = answerViolation(fallback);

  if (drift !== undefined) {
    throw new Error(`The engine stub's default answer ${drift}`);
  }

  const requests: Record<string, unknown>[] = [];
  const violations: string[] = [];
  let responder: EngineResponder = () => fallback;

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const answer = answerFor(
        {
          method: request.method ?? "GET",
          path: new URL(request.url ?? "/", "http://engine.invalid").pathname,
          key: headerOf(request, INTERNAL_KEY_HEADER),
          raw: Buffer.concat(chunks).toString("utf8"),
        },
        { secret, requests, violations, responder: (attempt) => responder(attempt) },
      );

      response.writeHead(answer.status, { "content-type": "application/json" });
      response.end(JSON.stringify(answer.body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${String(port)}`,
    requests,
    violations,
    respond: (next) => {
      responder = next;
    },
    reset: () => {
      requests.length = 0;
      violations.length = 0;
      responder = () => fallback;
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** What one request is answered with, and what it adds to the record. */
interface Exchange {
  /** The secret every internal route requires. */
  readonly secret: string;
  /** Where an accepted estimate request is recorded. */
  readonly requests: Record<string, unknown>[];
  /** Where a breach of the contract is recorded. */
  readonly violations: string[];
  /** What the test scripted. */
  readonly responder: EngineResponder;
}

/**
 * Decide one request, the way the engine would.
 *
 * The order is the engine's own, and it matters: routing happens before the key is read, so an
 * unpublished path is a `404` whether or not a secret came with it, and the key is read before
 * the body is parsed, so a caller with two problems is told about the outer one. A stub that
 * answered `401` for a path the engine does not have would teach a reader the wrong thing about
 * what the boundary refuses.
 *
 * @param incoming - The request, reduced.
 * @param exchange - The stub's state.
 * @returns The answer to serve.
 */
function answerFor(incoming: Incoming, exchange: Exchange): EngineAnswer {
  const { method, path, key, raw } = incoming;

  if (method === "GET" && path === LIVENESS_PATH) {
    // Open, per #51: a probe holds no secret.
    return served({ status: 200, body: { status: "ok" } }, "liveness", exchange);
  }

  const published =
    (method === "POST" && path === ESTIMATE_PATH) || (method === "GET" && path === STATUS_PATH);

  if (!published) {
    exchange.violations.push(`${method} ${path} is not a route ouroboros-engine publishes`);

    return {
      status: 404,
      body: { code: "not_found", message: "No such route.", details: {} },
    };
  }

  if (key !== exchange.secret) {
    exchange.violations.push(
      `${method} ${path} arrived with ${key === undefined ? "no" : "the wrong"} ` +
        `${INTERNAL_KEY_HEADER}`,
    );

    return {
      status: 401,
      body: { code: "unauthenticated", message: "Unauthorized.", details: {} },
    };
  }

  if (method === "GET" && path === STATUS_PATH) {
    return served({ status: 200, body: ENGINE_STATUS_BODY }, "status", exchange);
  }

  let body: unknown;

  try {
    body = JSON.parse(raw);
  } catch {
    exchange.violations.push(`POST ${ESTIMATE_PATH} carried a body that is not JSON`);

    return unprocessable("The request body is not JSON.");
  }

  const refused = contractViolation("request", body);

  if (refused !== undefined) {
    exchange.violations.push(`The body of POST ${ESTIMATE_PATH} ${refused}`);

    return unprocessable(refused);
  }

  exchange.requests.push(body as Record<string, unknown>);

  return served(exchange.responder(exchange.requests.length), "estimate", exchange);
}

/**
 * Hold an answer to the contract on the way out, unless the test said not to.
 *
 * @param answer - What the test scripted, or what the stub answers a published route with.
 * @param schema - Which schema a `2xx` body is held to. Anything else is an `Error`.
 * @param exchange - The stub's state, for the record.
 * @returns The answer, or a `500` naming the violation.
 */
function served(
  answer: EngineAnswer,
  schema: "estimate" | "liveness" | "status",
  exchange: Exchange,
): EngineAnswer {
  if (answer.offContract === true) {
    return answer;
  }

  const breach = contractViolation(answer.status < 300 ? schema : "failure", answer.body);

  if (breach === undefined) {
    return answer;
  }

  exchange.violations.push(`The ${String(answer.status)} the stub was told to serve ${breach}`);

  return {
    status: 500,
    body: {
      code: "internal",
      message: `The engine stub refused to serve a body that ${breach}`,
      details: {},
    },
  };
}

/** The engine's `422`, carrying the reason in the field the envelope keeps details under. */
function unprocessable(reason: string): EngineAnswer {
  return {
    status: 422,
    body: {
      code: "validation_failed",
      message: "The request is not valid. See `details` for each field.",
      details: { body: [reason] },
    },
  };
}

/**
 * Whether an answer is one the contract allows, without a stub to record it against.
 *
 * @param answer - The answer.
 * @returns The reason it is not allowed, or `undefined`.
 */
function answerViolation(answer: EngineAnswer): string | undefined {
  if (answer.offContract === true) {
    return undefined;
  }

  return contractViolation(answer.status < 300 ? "estimate" : "failure", answer.body);
}

/**
 * One header, however Node cased it.
 *
 * @param request - The incoming request.
 * @param name - The header's name as the contract writes it.
 * @returns Its value, or `undefined` when it was not sent.
 */
function headerOf(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];

  return Array.isArray(value) ? value[0] : value;
}
