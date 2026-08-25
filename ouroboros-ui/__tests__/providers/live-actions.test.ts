import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { TEST_GONE, TEST_READ_ONLY } from "@/app/providers/live";

import { pullRecord, providerModels } from "../helpers/providers";

/**
 * The live surfaces' server hops ([#230](https://github.com/NobuData/ouroboros/issues/230)):
 * each a call and a refusal-to-sentence, and the test's second call after a pass.
 */

const test = vi.fn();
const discover = vi.fn();
const pull = vi.fn();

vi.mock("@/app/api/providers", () => ({
  providers: {
    test: (id: string) => test(id),
    discover: (id: string) => discover(id),
    pull: (id: string, modelId: string) => pull(id, modelId),
  },
}));

const { refreshModels, startPull, testConnection } = await import("@/app/providers/live-actions");

const ID = "5eed000c-0000-4000-8000-000000000001";

const PASSED = {
  connectionId: ID,
  checkedAt: "2026-08-25T10:00:12.004Z",
  status: "active",
  pill: { tone: "ok", label: "connected" },
  note: "200",
  latencyMs: 38,
  errorClass: null,
  retryable: false,
  detail: "200",
} as const;

const DISCOVERY = { ...providerModels(ID, []), added: [], removed: [] };

describe("testConnection", () => {
  it("tests, then refreshes the chips after a pass, and hands both back", async () => {
    test.mockResolvedValue(PASSED);
    discover.mockResolvedValue(DISCOVERY);

    await expect(testConnection(ID)).resolves.toEqual({
      ok: true,
      result: PASSED,
      models: { ok: true, value: DISCOVERY },
    });
    expect(test).toHaveBeenCalledWith(ID);
    expect(discover).toHaveBeenCalledWith(ID);
  });

  it("asks for no refresh after a failure — the chips are the last discovery's", async () => {
    const failed = { ...PASSED, status: "error", errorClass: "upstream", latencyMs: null };
    test.mockResolvedValue(failed);
    discover.mockClear();

    await expect(testConnection(ID)).resolves.toEqual({ ok: true, result: failed, models: null });
    expect(discover).not.toHaveBeenCalled();
  });

  it("keeps the pass and reports the refresh's refusal beside it", async () => {
    test.mockResolvedValue(PASSED);
    discover.mockRejectedValue(
      new ApiError(502, "provider_discovery_failed", "no", { detail: "unreachable" }),
    );

    const outcome = await testConnection(ID);

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.models).toMatchObject({ ok: false });
    expect(outcome.ok && outcome.models && !outcome.models.ok && outcome.models.reason).toContain(
      "unreachable",
    );
  });

  it("hands a refusal of the request back as a sentence", async () => {
    test.mockRejectedValue(new ApiError(403, "forbidden", "no"));

    await expect(testConnection(ID)).resolves.toEqual({ ok: false, reason: TEST_READ_ONLY });
  });

  it("lets anything that is not the service's refusal travel", async () => {
    test.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(testConnection(ID)).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("refreshModels", () => {
  it("hands the catalog back", async () => {
    discover.mockResolvedValue(DISCOVERY);

    await expect(refreshModels(ID)).resolves.toEqual({ ok: true, discovery: DISCOVERY });
  });

  it("hands a refusal back as a sentence", async () => {
    discover.mockRejectedValue(new ApiError(404, "provider_connection_not_found", "no"));

    await expect(refreshModels(ID)).resolves.toEqual({ ok: false, reason: TEST_GONE });
  });
});

describe("startPull", () => {
  it("asks for the model and hands the record back", async () => {
    const record = pullRecord();
    pull.mockResolvedValue(record);

    await expect(startPull(ID, "llama4:scout")).resolves.toEqual({ ok: true, pull: record });
    expect(pull).toHaveBeenCalledWith(ID, "llama4:scout");
  });

  it("hands a refusal back as a sentence", async () => {
    pull.mockRejectedValue(new ApiError(403, "forbidden", "no"));

    const outcome = await startPull(ID, "llama4:scout");

    expect(outcome.ok).toBe(false);
  });
});
