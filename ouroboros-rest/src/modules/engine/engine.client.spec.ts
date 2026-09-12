import { HttpStatus, Logger } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import { testConfiguration } from "../config/configuration.fixture";
import {
  ENGINE_TIMEOUT_MS,
  EngineClient,
  MAX_ATTEMPTS,
  RETRYABLE_CONNECT_CODES,
  isRetryable,
} from "./engine.client";
import { ENGINE_ERRORS, ENGINE_UNAVAILABLE_MESSAGE } from "./engine.errors";
import {
  ENGINE_ESTIMATE_BODY,
  ENGINE_STATUS_BODY,
  ESTIMATE_REQUEST,
  alwaysAnswering,
  alwaysFailing,
  connectFailure,
  engineError,
  failingThenAnswering,
  fakeFetch,
  jsonResponse,
  timedOut,
  type FakeFetch,
} from "./engine.fixture";

/**
 * The boundary, and the four things it promises.
 *
 * Every call carries the secret and a deadline; a failure that proves nothing was delivered
 * is retried once and nothing else is; every way this can fail is one `502`; and none of
 * what went wrong reaches the caller. The last is the one worth being pedantic about — the
 * engine's address, its status codes and its own error bodies are all things a browser must
 * not learn from a gateway — so several assertions below are about what is *absent* from an
 * answer rather than what is in it.
 *
 * Nothing here opens a socket. The client takes its `fetch` as a parameter, so an engine
 * that refuses, hangs, lies or holds the wrong key is a function.
 */

/** The engine base URL every assertion below is written against. */
const ENGINE_URL = "http://engine-7f4c.svc.cluster.local:8000";

/** The shared secret the client should be sending. */
const SHARED_SECRET = "a-shared-secret-nobody-should-see";

/**
 * A client wired to a configuration and a `fetch`.
 *
 * @param fetchImpl - What the client calls instead of the network.
 * @returns The client under test.
 */
function clientWith(fetchImpl: FakeFetch): EngineClient {
  const configuration = testConfiguration({
    OURO_ENGINE_URL: ENGINE_URL,
    OURO_ENGINE_SHARED_SECRET: SHARED_SECRET,
  });

  // The typed accessor over a store that answers from the frozen configuration — the same
  // object the application registers, without building a Nest container per test.
  const config = new AppConfigService({
    get: (key: string) => configuration[key as keyof typeof configuration],
    getOrThrow: (key: string) => configuration[key as keyof typeof configuration],
  } as never);

  return new EngineClient(config, fetchImpl);
}

/** The header, as `fetch` was handed it. */
function headerOf(fetchImpl: FakeFetch, name: string): string | undefined {
  return fetchImpl.calls[0]?.headers[name];
}

beforeEach(() => {
  // The client logs every failure, and a suite that exercises a dozen of them would
  // otherwise print a dozen stack traces over the results. What is logged is asserted
  // explicitly where it matters, below.
  jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
});

describe("a call the engine answers", () => {
  it("reads the status, in this service's names", async () => {
    const engine = alwaysAnswering(() => jsonResponse());

    await expect(clientWith(engine).status()).resolves.toEqual({
      service: "ouroboros-engine",
      version: ENGINE_STATUS_BODY.version,
      uptimeSeconds: ENGINE_STATUS_BODY.uptime_seconds,
    });
  });

  it("calls the engine's status route under its base URL", async () => {
    const engine = alwaysAnswering(() => jsonResponse());

    await clientWith(engine).status();

    expect(engine.calls[0].url).toBe(`${ENGINE_URL}/v0/status`);
    expect(engine.calls[0].method).toBe("GET");
  });

  it("carries the shared secret on the header the engine reads", async () => {
    const engine = alwaysAnswering(() => jsonResponse());

    await clientWith(engine).status();

    expect(headerOf(engine, "X-Ouro-Internal-Key")).toBe(SHARED_SECRET);
  });

  it("asks for JSON", async () => {
    const engine = alwaysAnswering(() => jsonResponse());

    await clientWith(engine).status();

    expect(headerOf(engine, "accept")).toBe("application/json");
  });

  it("gives every call a deadline", async () => {
    // Asserted as a signal rather than by waiting: what has to be true is that the request
    // *can* be ended, because a gateway that can hang holds a browser for as long as an
    // unhealthy engine feels like taking.
    const engine = alwaysAnswering(() => jsonResponse());

    await clientWith(engine).status();

    expect(engine.calls[0].signal).toBeInstanceOf(AbortSignal);
  });

  it("publishes a deadline shorter than a person's patience", () => {
    expect(ENGINE_TIMEOUT_MS).toBe(5_000);
  });
});

describe("echoing a task", () => {
  /** What the engine answers a well-formed echo with. */
  function echoed(): Response {
    return jsonResponse({
      accepted: true,
      echo: { task_kind: "echo", payload: { note: "hello" } },
      engine_version: "0.3.0",
    });
  }

  it("posts the task to the engine's echo route", async () => {
    const engine = alwaysAnswering(echoed);

    await clientWith(engine).echo({ taskKind: "echo", payload: { note: "hello" } });

    expect(engine.calls[0].url).toBe(`${ENGINE_URL}/v0/tasks/echo`);
    expect(engine.calls[0].method).toBe("POST");
  });

  it("sends the contract's `snake_case` body", async () => {
    const engine = alwaysAnswering(echoed);

    await clientWith(engine).echo({ taskKind: "echo", payload: { note: "hello" } });

    expect(JSON.parse(engine.calls[0].body ?? "")).toEqual({
      task_kind: "echo",
      payload: { note: "hello" },
    });
  });

  it("still carries the shared secret", async () => {
    const engine = alwaysAnswering(echoed);

    await clientWith(engine).echo({ taskKind: "echo", payload: {} });

    expect(headerOf(engine, "X-Ouro-Internal-Key")).toBe(SHARED_SECRET);
  });

  it("reads the answer back in this service's names", async () => {
    const engine = alwaysAnswering(echoed);

    await expect(
      clientWith(engine).echo({ taskKind: "echo", payload: { note: "hello" } }),
    ).resolves.toEqual({
      accepted: true,
      echo: { taskKind: "echo", payload: { note: "hello" } },
      engineVersion: "0.3.0",
    });
  });

  it("refuses the task the engine refused, as a 502", async () => {
    // A 422 from the engine means *this* service sent a body the engine's contract does not
    // describe. That is a bug here, not something a caller can act on, so it is the same
    // answer as every other failure on this leg.
    const engine = alwaysAnswering(() => engineError(422, "validation_failed"));

    await expect(clientWith(engine).echo({ taskKind: "echo", payload: {} })).rejects.toMatchObject({
      status: HttpStatus.BAD_GATEWAY,
    });
  });
});

describe("sizing an issue", () => {
  /** What the engine answers a well-formed sizing request with. */
  function estimated(): Response {
    return jsonResponse(ENGINE_ESTIMATE_BODY);
  }

  it("posts the issue to the engine's estimate route", async () => {
    const engine = alwaysAnswering(estimated);

    await clientWith(engine).estimate(ESTIMATE_REQUEST);

    expect(engine.calls[0].url).toBe(`${ENGINE_URL}/v0/estimate`);
    expect(engine.calls[0].method).toBe("POST");
  });

  it("sends the issue and the vocabularies, in the engine's `snake_case`", async () => {
    const engine = alwaysAnswering(estimated);

    await clientWith(engine).estimate(ESTIMATE_REQUEST);

    expect(JSON.parse(engine.calls[0].body ?? "")).toEqual({
      issue: {
        number: 485,
        title: "I2C bus lockup after IMU sleep/wake cycle",
        body: "After entering low-power sleep and waking the BMI270, the I2C bus locks up.",
        labels: ["bug", "i2c", "watchdog"],
        repo: "acme-robotics/helios-firmware",
      },
      context: {
        workflow_tags: ["standard-fix", "docs-loop"],
        model_defaults: { default: "claude-fable-5", docs: "claude-haiku-4-5" },
      },
    });
  });

  it("still carries the shared secret", async () => {
    const engine = alwaysAnswering(estimated);

    await clientWith(engine).estimate(ESTIMATE_REQUEST);

    expect(headerOf(engine, "X-Ouro-Internal-Key")).toBe(SHARED_SECRET);
  });

  it("reads the estimate back in this service's names", async () => {
    const engine = alwaysAnswering(estimated);

    await expect(clientWith(engine).estimate(ESTIMATE_REQUEST)).resolves.toMatchObject({
      effort: "m",
      confidence: 92,
      suggestedWorkflow: "standard-fix",
      routedModel: "claude-fable-5",
      breakdown: { estTokens: 180_000, cycleMin: 12, cycleMax: 18, estMinutes: 23 },
      riskNote: "Isolated to the I²C driver path; full HIL coverage exists for bus recovery.",
      trace: { estimator: "heuristic-v0", tokensUsed: 41_000 },
    });
  });

  it("answers 502 when the engine refused the request", async () => {
    // A 422 means this service sent a body the engine's own contract does not describe,
    // which is a bug here rather than something a caller can act on.
    const engine = alwaysAnswering(() =>
      engineError(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed"),
    );

    await expect(clientWith(engine).estimate(ESTIMATE_REQUEST)).rejects.toMatchObject({
      code: ENGINE_ERRORS.unavailable,
    });
  });

  it("answers 502 when the engine escalates to the 202 it does not yet send", async () => {
    // The engine specifies a `202`-plus-poll path for the LLM estimator (#123) and cannot
    // answer one today. A 202 is a 2xx, so it reaches the schema and fails to parse — which
    // is the honest answer for a response this service does not know how to follow, and the
    // assertion that pins where the poll support has to arrive.
    const engine = alwaysAnswering(
      () =>
        new Response(JSON.stringify({ estimation_id: "5f2c", status: "accepted" }), {
          status: HttpStatus.ACCEPTED,
          headers: { "content-type": "application/json", "retry-after": "5" },
        }),
    );

    await expect(clientWith(engine).estimate(ESTIMATE_REQUEST)).rejects.toMatchObject({
      code: ENGINE_ERRORS.unavailable,
    });
  });

  it("answers 502 for an estimate outside the vocabularies the row can store", async () => {
    // The wire is parsed rather than asserted. An effort `issue_estimates` would refuse is
    // stopped here, at the boundary, instead of at the insert several layers later.
    const engine = alwaysAnswering(() => jsonResponse({ ...ENGINE_ESTIMATE_BODY, effort: "xxl" }));

    await expect(clientWith(engine).estimate(ESTIMATE_REQUEST)).rejects.toMatchObject({
      code: ENGINE_ERRORS.unavailable,
    });
  });
});

describe("validating a workflow definition", () => {
  /** Mockup 04's canvas, reduced to the two keys this suite needs it to have. */
  const DEFINITION = { dsl_version: "1.0", nodes: [{ id: "issue-queued", type: "trigger" }] };

  /** What an engine that implements R.2 answers a green definition with. */
  function green(): Response {
    return jsonResponse({ findings: [] });
  }

  it("posts the definition to the engine's validate route", async () => {
    const engine = alwaysAnswering(green);

    await clientWith(engine).validateWorkflow(DEFINITION);

    expect(engine.calls[0].url).toBe(`${ENGINE_URL}/v0/workflows/validate`);
    expect(engine.calls[0].method).toBe("POST");
    expect(JSON.parse(engine.calls[0].body ?? "")).toEqual({ definition: DEFINITION });
  });

  it("still carries the shared secret", async () => {
    const engine = alwaysAnswering(green);

    await clientWith(engine).validateWorkflow(DEFINITION);

    expect(headerOf(engine, "X-Ouro-Internal-Key")).toBe(SHARED_SECRET);
  });

  it("reads the findings back in this service's names", async () => {
    const engine = alwaysAnswering(() =>
      jsonResponse({
        findings: [
          { code: "unreachable_node", message: "Nothing reaches this node.", node_id: "review" },
        ],
      }),
    );

    await expect(clientWith(engine).validateWorkflow(DEFINITION)).resolves.toEqual({
      findings: [
        { code: "unreachable_node", message: "Nothing reaches this node.", node: "review" },
      ],
    });
  });

  it("answers undefined for a 404, which is an engine that predates the route", async () => {
    // The one status this client reads as an answer rather than a failure, and only where a
    // caller asked for it. R.2 (#144) has not landed, so this is every build today.
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const engine = alwaysAnswering(() => engineError(HttpStatus.NOT_FOUND, "not_found"));

    await expect(clientWith(engine).validateWorkflow(DEFINITION)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("does not publish the route"));

    warn.mockRestore();
  });

  it.each([
    ["an engine that is unwell", HttpStatus.SERVICE_UNAVAILABLE],
    ["an engine holding the wrong secret", HttpStatus.UNAUTHORIZED],
    ["an engine that failed", HttpStatus.INTERNAL_SERVER_ERROR],
  ])("still answers engine_unavailable for %s", async (_name, status) => {
    // The tolerance above is exactly one status wide: an outage must refuse a publish rather
    // than wave it through.
    const engine = alwaysAnswering(() => engineError(status));

    await expect(clientWith(engine).validateWorkflow(DEFINITION)).rejects.toMatchObject({
      response: { code: ENGINE_ERRORS.unavailable },
    });
  });

  it("refuses a body outside the contract rather than answering undefined", async () => {
    const engine = alwaysAnswering(() => jsonResponse({ ok: true }));

    await expect(clientWith(engine).validateWorkflow(DEFINITION)).rejects.toMatchObject({
      response: { code: ENGINE_ERRORS.unavailable },
    });
  });

  it("leaves the other routes intolerant of a 404", async () => {
    // `absentWhenUnpublished` is opt-in per call. A `404` from the status route is an engine
    // this deployment is misconfigured against, not an answer.
    const engine = alwaysAnswering(() => engineError(HttpStatus.NOT_FOUND, "not_found"));

    await expect(clientWith(engine).status()).rejects.toMatchObject({
      response: { code: ENGINE_ERRORS.unavailable },
    });
  });
});

describe("when the engine cannot be reached", () => {
  it.each([...RETRYABLE_CONNECT_CODES])("retries once after %s", async (code) => {
    const engine = failingThenAnswering(() => connectFailure(code), jsonResponse);

    await expect(clientWith(engine).status()).resolves.toMatchObject({ version: "0.3.0" });
    expect(engine.calls).toHaveLength(2);
  });

  it("retries a POST too, because nothing was delivered", async () => {
    const engine = failingThenAnswering(
      () => connectFailure("ECONNREFUSED"),
      () =>
        jsonResponse({
          accepted: true,
          echo: { task_kind: "echo", payload: {} },
          engine_version: "0.3.0",
        }),
    );

    await expect(clientWith(engine).echo({ taskKind: "echo", payload: {} })).resolves.toMatchObject(
      {
        accepted: true,
      },
    );
  });

  it("gives up after one retry rather than hammering a service that is down", async () => {
    const engine = alwaysFailing(() => connectFailure("ECONNREFUSED"));

    await expect(clientWith(engine).status()).rejects.toBeDefined();
    expect(engine.calls).toHaveLength(MAX_ATTEMPTS);
  });

  it("gives each attempt its own deadline", async () => {
    // A signal built once and reused would already have fired by the time the retry went
    // out, which would make the second attempt a formality that fails instantly.
    const engine = failingThenAnswering(() => connectFailure("ECONNREFUSED"), jsonResponse);

    await clientWith(engine).status();

    expect(engine.calls[0].signal).not.toBe(engine.calls[1].signal);
  });

  it("does not retry a connection that was reset after it was established", async () => {
    // ECONNRESET may mean the request *was* delivered, and a task the engine has already
    // accepted must not be sent a second time because this side never saw the answer.
    const engine = alwaysFailing(() => connectFailure("ECONNRESET"));

    await expect(clientWith(engine).status()).rejects.toBeDefined();
    expect(engine.calls).toHaveLength(1);
  });

  it("does not retry a deadline, because the caller's patience is already spent", async () => {
    const engine = alwaysFailing(timedOut);

    await expect(clientWith(engine).status()).rejects.toBeDefined();
    expect(engine.calls).toHaveLength(1);
  });

  it("does not retry an answer, however unwelcome", async () => {
    const engine = alwaysAnswering(() => engineError(500, "internal_error"));

    await expect(clientWith(engine).status()).rejects.toBeDefined();
    expect(engine.calls).toHaveLength(1);
  });
});

describe("what a caller is told", () => {
  it.each([
    ["the engine is not there", () => alwaysFailing(() => connectFailure("ECONNREFUSED"))],
    ["the engine is too slow", () => alwaysFailing(timedOut)],
    ["the engine failed", () => alwaysAnswering(() => engineError(500, "internal_error"))],
    ["the engine refused the key", () => alwaysAnswering(() => engineError(401))],
    ["the answer is not JSON", () => alwaysAnswering(() => new Response("<html>502</html>"))],
    ["the answer is not the contract", () => alwaysAnswering(() => jsonResponse({ ok: true }))],
  ])("answers 502 engine_unavailable when %s", async (_description, engineFor) => {
    await expect(clientWith(engineFor()).status()).rejects.toMatchObject({
      status: HttpStatus.BAD_GATEWAY,
      code: ENGINE_ERRORS.unavailable,
    });
  });

  it("never answers 401, whatever the engine said", async () => {
    // The acceptance criterion, and the one mapping that would be a security bug rather
    // than a bad message: a browser told `401` here would try to sign in again over a
    // boundary it cannot reach, and would learn that there is an inner service with its own
    // credential.
    const engine = alwaysAnswering(() => engineError(401));

    await expect(clientWith(engine).status()).rejects.not.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  it.each([
    ["the engine's address", ENGINE_URL],
    ["the engine's hostname", "svc.cluster.local"],
    ["the engine's port", "8000"],
    ["the shared secret", SHARED_SECRET],
  ])("never puts %s in the answer", async (_description, secret) => {
    const engine = alwaysFailing(() => connectFailure("ECONNREFUSED"));

    await clientWith(engine)
      .status()
      .catch((error: { envelope(): unknown }) => {
        expect(JSON.stringify(error.envelope())).not.toContain(secret);
      });

    expect.hasAssertions();
  });

  it("never repeats what the engine said", async () => {
    const engine = alwaysAnswering(() => engineError(401));

    await clientWith(engine)
      .status()
      .catch((error: { envelope(): { message: string; details: unknown } }) => {
        expect(error.envelope().message).toBe(ENGINE_UNAVAILABLE_MESSAGE);
        expect(error.envelope().details).toEqual({});
      });

    expect.hasAssertions();
  });
});

describe("what an operator is told", () => {
  it("names the shared-secret mismatch, which nothing else would reveal", async () => {
    // Every other failure looks like an unwell engine from the outside. This one is a
    // configuration mistake in *this* deployment, and the log is the only place it can be
    // said out loud.
    const logged = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const engine = alwaysAnswering(() => engineError(401));

    await clientWith(engine).status().catch(noop);

    expect(logged.mock.calls.flat().join(" ")).toContain("OURO_ENGINE_SHARED_SECRET");
  });

  it("never writes the secret itself into the log", async () => {
    const logged = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const engine = alwaysAnswering(() => engineError(401));

    await clientWith(engine).status().catch(noop);

    expect(logged.mock.calls.flat().join(" ")).not.toContain(SHARED_SECRET);
  });

  it("names the address, which is what the answer is not allowed to", async () => {
    const logged = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const engine = alwaysFailing(() => connectFailure("ECONNREFUSED"));

    await clientWith(engine).status().catch(noop);

    expect(logged.mock.calls.flat().join(" ")).toContain(`${ENGINE_URL}/v0/status`);
  });

  it("says the answer was outside the contract, and what was wrong with it", async () => {
    const logged = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const engine = alwaysAnswering(() => jsonResponse({ service: "ouroboros-engine" }));

    await clientWith(engine).status().catch(noop);

    const written = logged.mock.calls.flat().join(" ");
    expect(written).toContain("/v0 contract");
    expect(written).toContain("version");
  });
});

describe("isRetryable", () => {
  it.each([...RETRYABLE_CONNECT_CODES])("says %s is worth another attempt", (code) => {
    expect(isRetryable(connectFailure(code))).toBe(true);
  });

  it("looks through the wrapper `fetch` reports a network failure in", () => {
    expect(isRetryable(Object.assign(new Error("direct"), { code: "ECONNREFUSED" }))).toBe(true);
  });

  it.each([
    ["a reset connection", connectFailure("ECONNRESET")],
    ["a deadline", timedOut()],
    ["an error with no code", new Error("something happened")],
    ["a thrown string", "ECONNREFUSED"],
    ["nothing", undefined],
  ])("says %s is not", (_description, error) => {
    expect(isRetryable(error)).toBe(false);
  });
});

describe("the fetch the client is given", () => {
  it("is the one it uses — the seam is the whole of the coupling", async () => {
    const engine = fakeFetch(() => Promise.resolve(jsonResponse()));

    await clientWith(engine).status();

    expect(engine.calls).toHaveLength(1);
  });
});

/** Swallow a rejection whose contents another assertion is about. */
function noop(): void {
  return undefined;
}
