import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { SIMULATE_FAILURE } from "@/app/models/simulation";

import { failRunExample, resolvedExample } from "../helpers/models";

/**
 * **Simulate routing**'s server hop (#203) — the one question the panel asks.
 *
 * A Server Action is a POST endpoint anybody can reach, so this suite is written as the
 * security case first: there is no workspace in the call and no person, and any member may
 * ask. The rest is the posture — a `fail_run` is an answer and travels as one, a refusal is a
 * sentence the panel can print, and the gate's redirect is the one throw that must travel.
 */

/** What the API answers, per case. */
const simulate = vi.fn();

vi.mock("@/app/api/routing", async () => {
  const actual = await vi.importActual<typeof import("@/app/api/routing")>("@/app/api/routing");

  return {
    ...actual,
    routing: { ...actual.routing, simulate: (request: unknown) => simulate(request) },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const actions = await import("@/app/models/simulate-actions");

/** The question, as `composeSimulation` forms it. */
const QUESTION = { taskKind: "review", ctx: { labels: ["security"] } };

beforeEach(() => {
  simulate.mockReset().mockResolvedValue(resolvedExample());
});

describe("simulateRoute", () => {
  it("asks exactly the question it was given — no workspace, no person", async () => {
    await actions.simulateRoute(QUESTION);

    expect(simulate).toHaveBeenCalledExactlyOnceWith(QUESTION);
  });

  it("answers ok with the resolution, unchanged", async () => {
    await expect(actions.simulateRoute(QUESTION)).resolves.toEqual({ ok: true, resolution: resolvedExample() });
  });

  it("answers ok with a fail_run too — it is an answer, not a failure", async () => {
    simulate.mockResolvedValue(failRunExample());

    const reading = await actions.simulateRoute({ taskKind: "implement" });

    expect(reading.ok).toBe(true);
    if (reading.ok) expect(reading.resolution.outcome).toBe("fail_run");
  });

  it("answers a refusal with the service's own sentence, which is written for a person", async () => {
    simulate.mockRejectedValue(
      new ApiError(404, "route_not_found", "This workspace has no route for deploy.", { taskKind: "deploy" }),
    );

    await expect(actions.simulateRoute({ taskKind: "deploy" })).resolves.toEqual({
      ok: false,
      reason: "This workspace has no route for deploy.",
    });
  });

  it("supplies a sentence when the service sent none", async () => {
    simulate.mockRejectedValue(new ApiError(500, "internal_error", ""));

    await expect(actions.simulateRoute(QUESTION)).resolves.toEqual({ ok: false, reason: SIMULATE_FAILURE });
  });

  it("lets anything that is not an API error through, which is how a redirect travels", async () => {
    simulate.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(actions.simulateRoute(QUESTION)).rejects.toThrow("NEXT_REDIRECT /login");
  });
});
