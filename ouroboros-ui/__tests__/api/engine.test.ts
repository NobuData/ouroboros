import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
// Types only, so this import is erased and nothing loads before the mocks below.
import type { EngineStatus } from "@/app/api/engine";

import { clientAnswering } from "../helpers/api";

// The facade sits on the server-side client — see `server.test.ts` for what each of these
// three answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { ENGINE_UNAVAILABLE_CODE, engine } = await import("@/app/api/engine");

/**
 * The engine-status resource.
 *
 * The interesting half is the failure, because it is the one the dashboard actually draws:
 * every way the engine can fail to answer is a single `502 engine_unavailable`, and this
 * suite holds that it arrives as an `ApiError` with that code rather than as anything a
 * caller could use to tell those ways apart.
 */

/** What the engine answered. */
const UP = { engine: "up", version: "0.3.1" };

/** The one failure the contract describes for an engine that did not serve the request. */
const UNAVAILABLE = {
  code: ENGINE_UNAVAILABLE_CODE,
  message: "The engine is not available right now. Try again in a moment.",
  details: {},
};

describe("engine.status", () => {
  it("calls the operation and returns the body itself", async () => {
    const { client, requests } = clientAnswering(UP);

    const status = await engine.status(client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/engine/status");
    expect(status).toEqual(UP);
  });

  it("carries the engine's own build, which is not this service's", async () => {
    // Which pair is deployed together is exactly what this route exists to report.
    const { client } = clientAnswering({ engine: "up", version: "9.9.9" });

    expect((await engine.status(client)).version).toBe("9.9.9");
  });

  it("rejects with `engine_unavailable` when the engine did not serve the request", async () => {
    const { client } = clientAnswering(UNAVAILABLE, 502);

    const caught: unknown = await engine.status(client).catch((e: unknown) => e);

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe(ENGINE_UNAVAILABLE_CODE);
    expect((caught as ApiError).status).toBe(502);
  });

  it("carries a message written for a person, naming nothing about the network", async () => {
    // The status the engine answered, the socket's error code and the URL that was called
    // all go to the service's log instead. A caller must not be able to probe the inside of
    // the network through this.
    const { client } = clientAnswering(UNAVAILABLE, 502);

    const caught = (await engine.status(client).catch((e: unknown) => e)) as ApiError;

    expect(caught.message).toBe(UNAVAILABLE.message);
    expect(caught.details).toEqual({});
    expect(caught.message).not.toMatch(/http|:\d{2,5}|ECONN/i);
  });

  it("does not turn a shared-secret mismatch into a 401", async () => {
    // That is this deployment's mistake rather than the caller's, so the contract answers
    // the same `502` for it — and a `401` here would send a signed-in person to the login
    // screen because two services disagree about a key they share.
    const { client } = clientAnswering(UNAVAILABLE, 502);

    const caught = (await engine.status(client).catch((e: unknown) => e)) as ApiError;

    expect(caught.isUnauthenticated).toBe(false);
  });
});

describe("the typing, which is the reason the client is generated", () => {
  it("types the body end to end", async () => {
    const { client } = clientAnswering(UP);

    const status: EngineStatus = await engine.status(client);

    expect(status.engine).toBe("up");
    expect(status.version).toBe("0.3.1");
  });

  it("rejects any engine state but the one the contract publishes", () => {
    // `engine` is the constant `"up"`: a body that exists at all came from a reachable
    // engine, so *down* is a rejection rather than a second value of this field. The day
    // the contract grows `degraded`, this line stops compiling and the card that reads it
    // is found by the typecheck.
    // @ts-expect-error — `engine` is "up", and only "up".
    const state: EngineStatus["engine"] = "down";

    expect(state).toBe("down");
  });
});
