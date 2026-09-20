import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import {
  LIFECYCLE_FORBIDDEN,
  RUNNER_ALREADY_REMOVED,
  RUNNER_GONE,
  lifecycleRefusal,
} from "@/app/farm/lifecycle";

import { farmRunner } from "../helpers/farm";

const api = vi.hoisted(() => ({
  drainRunner: vi.fn(),
  undrainRunner: vi.fn(),
  removeRunner: vi.fn(),
}));

vi.mock("@/app/api/farm", () => ({
  farm: {
    drainRunner: (id: string) => api.drainRunner(id),
    undrainRunner: (id: string) => api.undrainRunner(id),
    removeRunner: (id: string) => api.removeRunner(id),
  },
}));

const actions = await import("@/app/farm/lifecycle-actions");

/**
 * The runner menu's Server Actions (#260): each write is handed to the service for exactly the
 * runner it names, every refusal is a value with its own sentence, and anything that is not an
 * `ApiError` — Next.js's redirect above all — travels.
 */

/** The runner every case acts on. */
const RUNNER = "5eed0400-0000-4000-8000-0000000000a2";

/**
 * A refusal, as the typed client throws one.
 *
 * @param status The HTTP status.
 * @param code The service's code.
 * @param details What the envelope carried.
 * @returns The error.
 */
function refusal(status: number, code: string, details: Record<string, unknown> = {}): ApiError {
  return new ApiError(status, code, `${code} message`, details);
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
});

describe.each([
  ["drainRunner", "drain"],
  ["undrainRunner", "undrain"],
] as const)("%s", (name, action) => {
  it("asks the service about that runner, and answers whether the agent was told", async () => {
    api[name].mockResolvedValue({ runner: farmRunner(), pushed: true });

    await expect(actions[name](RUNNER)).resolves.toEqual({ ok: true, pushed: true });
    expect(api[name]).toHaveBeenCalledExactlyOnceWith(RUNNER);
  });

  it("passes on a frame that was not pushed as a success, not a failure", async () => {
    // The intent is written first; a runner on another replica is told at its next heartbeat.
    api[name].mockResolvedValue({ runner: farmRunner(), pushed: false });

    await expect(actions[name](RUNNER)).resolves.toEqual({ ok: true, pushed: false });
  });

  it("answers the runner only as far as the page needs it — not the resource", async () => {
    api[name].mockResolvedValue({ runner: farmRunner(), pushed: true });

    expect(Object.keys(await actions[name](RUNNER)).sort()).toEqual(["ok", "pushed"]);
  });

  it.each([
    [refusal(403, "forbidden"), LIFECYCLE_FORBIDDEN],
    [refusal(404, "farm_runner_not_found"), RUNNER_GONE],
    [refusal(409, "farm_runner_removed"), RUNNER_ALREADY_REMOVED],
  ])("answers %s as a sentence rather than a throw", async (error, reason) => {
    api[name].mockRejectedValue(error);

    await expect(actions[name](RUNNER)).resolves.toEqual({ ok: false, reason });
  });

  it("says an unexpected refusal in its own words", async () => {
    api[name].mockRejectedValue(refusal(500, "internal_error"));

    await expect(actions[name](RUNNER)).resolves.toEqual({
      ok: false,
      reason: lifecycleRefusal(action, { code: "internal_error", details: {} }),
    });
  });

  it("lets anything that is not a refusal travel — Next.js's redirect above all", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    api[name].mockRejectedValue(redirect);

    await expect(actions[name](RUNNER)).rejects.toBe(redirect);
  });
});

describe("removeRunner", () => {
  it("retires that runner, and has no frame to report", async () => {
    api.removeRunner.mockResolvedValue(farmRunner({ status: "removed", desiredState: "removed" }));

    await expect(actions.removeRunner(RUNNER)).resolves.toEqual({ ok: true, pushed: null });
    expect(api.removeRunner).toHaveBeenCalledExactlyOnceWith(RUNNER);
  });

  it("answers the service's guard with the state the machine is now in", async () => {
    // The menu only offered the removal because a page up to ten seconds old showed the
    // machine offline. It came back; the service's `409` says so, and so does the dialog.
    api.removeRunner.mockRejectedValue(
      refusal(409, "farm_runner_not_removable", { status: "building" }),
    );

    const outcome = await actions.removeRunner(RUNNER);

    expect(outcome.ok).toBe(false);
    expect(outcome).toMatchObject({ reason: expect.stringContaining("It is building now") });
  });

  it.each([
    [refusal(403, "forbidden"), LIFECYCLE_FORBIDDEN],
    [refusal(404, "farm_runner_not_found"), RUNNER_GONE],
    [refusal(409, "farm_runner_removed"), RUNNER_ALREADY_REMOVED],
  ])("answers %s as a sentence", async (error, reason) => {
    api.removeRunner.mockRejectedValue(error);

    await expect(actions.removeRunner(RUNNER)).resolves.toEqual({ ok: false, reason });
  });

  it("lets anything that is not a refusal travel", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    api.removeRunner.mockRejectedValue(redirect);

    await expect(actions.removeRunner(RUNNER)).rejects.toBe(redirect);
  });
});
