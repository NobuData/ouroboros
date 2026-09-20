import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import type { RunnerPoolChange, RunnerPoolCreate } from "@/app/api/farm";
import {
  DELETE_FAILED,
  DELETE_FORBIDDEN,
  FIELDS_REFUSED,
  IMAGE_MISMATCH,
  NAME_TAKEN,
  POOL_GONE,
  WRITE_FAILED,
  WRITE_FORBIDDEN,
} from "@/app/farm/pools";

import { runnerPool } from "../helpers/farm";

const api = vi.hoisted(() => ({
  createPool: vi.fn(),
  updatePool: vi.fn(),
  deletePool: vi.fn(),
}));

vi.mock("@/app/api/farm", () => ({
  farm: {
    createPool: (pool: RunnerPoolCreate) => api.createPool(pool),
    updatePool: (id: string, change: RunnerPoolChange) => api.updatePool(id, change),
    deletePool: (id: string) => api.deletePool(id),
  },
}));

const actions = await import("@/app/farm/pool-actions");

/**
 * The pools card's Server Actions (#259): each write is handed to the service exactly as given,
 * every refusal is a value with its own sentence — under the field it is about where there is
 * one — and anything that is not an `ApiError`, Next.js's redirect above all, travels.
 */

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

describe("createPool", () => {
  const body: RunnerPoolCreate = { name: "pool-c", executor: "shell", image: null };

  it("creates the pool as given and answers it as stored", async () => {
    const stored = runnerPool({ name: "pool-c", executor: "shell", image: null, runners: 0 });
    api.createPool.mockResolvedValue(stored);

    await expect(actions.createPool(body)).resolves.toEqual({ ok: true, pool: stored });
    expect(api.createPool).toHaveBeenCalledExactlyOnceWith(body);
  });

  it.each([
    [refusal(409, "farm_pool_name_taken"), { reason: FIELDS_REFUSED, fields: { name: NAME_TAKEN } }],
    [refusal(422, "farm_pool_image_mismatch"), { reason: FIELDS_REFUSED, fields: { image: IMAGE_MISMATCH } }],
    [
      refusal(422, "validation_failed", { name: ["name must be a lower-case slug"] }),
      { reason: FIELDS_REFUSED, fields: { name: "name must be a lower-case slug" } },
    ],
    [refusal(403, "forbidden"), { reason: WRITE_FORBIDDEN, fields: {} }],
    [refusal(500, "internal_error"), { reason: WRITE_FAILED, fields: {} }],
  ])("answers a refusal as a value — %#", async (error, expected) => {
    api.createPool.mockRejectedValue(error);

    await expect(actions.createPool(body)).resolves.toEqual({ ok: false, ...expected });
  });

  it("lets what is not an ApiError travel — the redirect of an expired session", async () => {
    api.createPool.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(actions.createPool(body)).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("updatePool", () => {
  it("changes the pool named with the change given — a switch's one field, or a save's few", async () => {
    const changed = runnerPool({ enabled: false });
    api.updatePool.mockResolvedValue(changed);

    await expect(actions.updatePool(changed.id, { enabled: false })).resolves.toEqual({ ok: true, pool: changed });
    expect(api.updatePool).toHaveBeenCalledExactlyOnceWith(changed.id, { enabled: false });
  });

  it("hands the auto-scale preference through untouched — it is stored, and nothing here reads it", async () => {
    const pref = { enabled: true, queue_threshold: 5, max_runners: 3 };
    api.updatePool.mockResolvedValue(runnerPool({ autoscalePref: pref }));

    await actions.updatePool("id", { autoscalePref: pref });

    expect(api.updatePool).toHaveBeenCalledExactlyOnceWith("id", { autoscalePref: pref });
  });

  it("says a pool deleted since the page was read is gone", async () => {
    api.updatePool.mockRejectedValue(refusal(404, "farm_pool_not_found"));

    await expect(actions.updatePool("id", { enabled: true })).resolves.toEqual({
      ok: false,
      reason: POOL_GONE,
      fields: {},
    });
  });

  it("answers a member who reached the action anyway with the service's refusal", async () => {
    api.updatePool.mockRejectedValue(refusal(403, "forbidden"));

    await expect(actions.updatePool("id", { enabled: true })).resolves.toMatchObject({
      ok: false,
      reason: WRITE_FORBIDDEN,
    });
  });

  it("lets what is not an ApiError travel", async () => {
    api.updatePool.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(actions.updatePool("id", {})).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("deletePool", () => {
  it("deletes the pool named", async () => {
    api.deletePool.mockResolvedValue(undefined);

    await expect(actions.deletePool("id")).resolves.toEqual({ ok: true });
    expect(api.deletePool).toHaveBeenCalledExactlyOnceWith("id");
  });

  it("answers a pool still in use with the counts the service took", async () => {
    api.deletePool.mockRejectedValue(refusal(409, "farm_pool_in_use", { pool: "pool-c", runners: 1, jobs: 4 }));

    const outcome = await actions.deletePool("id");

    expect(outcome).toMatchObject({ ok: false });
    expect(outcome.ok === false && outcome.reason).toContain("1 runner (retired ones included) and 4 builds");
  });

  it.each([
    [refusal(403, "forbidden"), DELETE_FORBIDDEN],
    [refusal(404, "farm_pool_not_found"), POOL_GONE],
    [refusal(500, "internal_error"), DELETE_FAILED],
  ])("answers a refusal as a value — %#", async (error, reason) => {
    api.deletePool.mockRejectedValue(error);

    await expect(actions.deletePool("id")).resolves.toEqual({ ok: false, reason });
  });

  it("lets what is not an ApiError travel", async () => {
    api.deletePool.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(actions.deletePool("id")).rejects.toThrow("NEXT_REDIRECT");
  });
});
