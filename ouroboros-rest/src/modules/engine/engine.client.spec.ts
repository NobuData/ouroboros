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
  ENGINE_STATUS_BODY,
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
