import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { MAX_NOTE_LENGTH } from "@/app/test-results/mark-route";
import {
  ROUTE_INVALID,
  ROUTE_INVALID_CODE,
  ROUTE_UNREACHABLE,
  ROUTE_UNREACHABLE_CODE,
} from "@/app/test-results/mark-route-outcomes";

import { SEEDED_RUN_ID } from "../helpers/runs";
import {
  BUILD_3_ID,
  CORRECTION_NOTE,
  OVERSHOOT_CASE,
  classifyResult,
  intents,
  waiver,
} from "../helpers/test-results";

/**
 * Mark & Route's server hop (#340). The role gates are the service's: this sends only what the
 * card may send — a class and a note, a reason and the case, one toggle — and hands a refusal
 * back as a value the card can draw.
 */

const classify = vi.fn();
const waive = vi.fn();
const setIntents = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/test-results", async (original) => ({
  ...(await original<typeof import("@/app/api/test-results")>()),
  testResults: {
    classify: (...sent: unknown[]) => classify(...sent),
    waive: (...sent: unknown[]) => waive(...sent),
    setIntents: (...sent: unknown[]) => setIntents(...sent),
  },
}));

const { classifyFailure, setRunIntent, waiveFailure } = await import(
  "@/app/test-results/mark-route-actions"
);

/** The refusal made before calling out. */
const REFUSED = { ok: false, status: 422, code: ROUTE_INVALID_CODE, reason: ROUTE_INVALID };

/** The case every call names. */
const CASE = OVERSHOOT_CASE.caseId;

beforeEach(() => {
  classify.mockReset();
  waive.mockReset();
  setIntents.mockReset();
});

describe("classifyFailure", () => {
  it("sends the class and the note, trimmed, and returns the service's answer", async () => {
    classify.mockResolvedValue(classifyResult());

    expect(
      await classifyFailure(BUILD_3_ID, CASE, {
        class: "product_bug",
        note: `  ${CORRECTION_NOTE}\n`,
      }),
    ).toEqual({ ok: true, result: classifyResult() });
    expect(classify).toHaveBeenCalledExactlyOnceWith(BUILD_3_ID, CASE, {
      class: "product_bug",
      note: CORRECTION_NOTE,
    });
  });

  it("sends no note for a class that needs none and was given none", async () => {
    classify.mockResolvedValue(classifyResult({ class: "flake_retry", note: null }));

    await classifyFailure(BUILD_3_ID, CASE, { class: "flake_retry", note: null });
    await classifyFailure(BUILD_3_ID, CASE, { class: "infra_rig" });

    expect(classify.mock.calls.map((call) => call[2])).toEqual([
      { class: "flake_retry" },
      { class: "infra_rig" },
    ]);
  });

  it("carries nothing the card may not send — no toggle, no requeue, no subtype", async () => {
    classify.mockResolvedValue(classifyResult());

    await classifyFailure(BUILD_3_ID, CASE, {
      class: "infra_rig",
      note: "rig PSU browned out",
      toggles: { requeue: true, blockUntilGreen: false },
      subtype: "unclear_requirements",
      actor: "model",
      confidence: 84,
    });

    expect(classify).toHaveBeenCalledExactlyOnceWith(BUILD_3_ID, CASE, {
      class: "infra_rig",
      note: "rig PSU browned out",
    });
  });

  it.each(["product_bug", "test_update"] as const)(
    "refuses %s without a note before calling out",
    async (failureClass) => {
      for (const note of [undefined, null, "", "   "]) {
        expect(await classifyFailure(BUILD_3_ID, CASE, { class: failureClass, note })).toEqual(
          REFUSED,
        );
      }

      expect(classify).not.toHaveBeenCalled();
    },
  );

  it("refuses ids that are not uuids, a class that is not one of four, and a note it cannot store", async () => {
    const decision = { class: "product_bug", note: CORRECTION_NOTE };

    for (const [testRunId, caseId, sent] of [
      ["..", CASE, decision],
      [`${BUILD_3_ID}/../x`, CASE, decision],
      [BUILD_3_ID, "not-an-id", decision],
      [BUILD_3_ID, CASE, { class: "wontfix", note: CORRECTION_NOTE }],
      [BUILD_3_ID, CASE, { note: CORRECTION_NOTE }],
      [BUILD_3_ID, CASE, { class: "flake_retry", note: "x".repeat(MAX_NOTE_LENGTH + 1) }],
      [BUILD_3_ID, CASE, { class: "flake_retry", note: 84 }],
      [BUILD_3_ID, CASE, { class: "flake_retry", note: "   " }],
      [BUILD_3_ID, CASE, null],
      [BUILD_3_ID, CASE, "product_bug"],
    ] as const) {
      expect(await classifyFailure(testRunId, caseId, sent)).toEqual(REFUSED);
    }

    expect(classify).not.toHaveBeenCalled();
  });

  it("hands the service's refusal back in its own words — a viewer's 403 included", async () => {
    classify.mockRejectedValue(new ApiError(403, "forbidden", "A viewer may not classify."));

    expect(
      await classifyFailure(BUILD_3_ID, CASE, { class: "product_bug", note: CORRECTION_NOTE }),
    ).toEqual({
      ok: false,
      status: 403,
      code: "forbidden",
      reason: "A viewer may not classify.",
    });
  });

  it("says a dropped connection as unreachable, and rethrows anything else", async () => {
    const decision = { class: "flake_retry" };

    classify.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await classifyFailure(BUILD_3_ID, CASE, decision)).toEqual({
      ok: false,
      status: 502,
      code: ROUTE_UNREACHABLE_CODE,
      reason: ROUTE_UNREACHABLE,
    });

    const redirect = new Error("NEXT_REDIRECT");
    classify.mockRejectedValueOnce(redirect);
    await expect(classifyFailure(BUILD_3_ID, CASE, decision)).rejects.toBe(redirect);
  });
});

describe("waiveFailure", () => {
  it("sends the reason, trimmed, and the one case", async () => {
    waive.mockResolvedValue(waiver());

    expect(await waiveFailure(BUILD_3_ID, CASE, "  Known rig drift.  ")).toEqual({
      ok: true,
      waiver: waiver(),
    });
    expect(waive).toHaveBeenCalledExactlyOnceWith(BUILD_3_ID, {
      reason: "Known rig drift.",
      caseIds: [CASE],
    });
  });

  it("requires a reason, and ids that are uuids, before calling out", async () => {
    for (const [testRunId, caseId, reason] of [
      [BUILD_3_ID, CASE, ""],
      [BUILD_3_ID, CASE, "   "],
      [BUILD_3_ID, CASE, "x".repeat(MAX_NOTE_LENGTH + 1)],
      [BUILD_3_ID, CASE, undefined as unknown as string],
      ["..", CASE, "Known rig drift."],
      [BUILD_3_ID, "..", "Known rig drift."],
    ] as const) {
      expect(await waiveFailure(testRunId, caseId, reason)).toEqual(REFUSED);
    }

    expect(waive).not.toHaveBeenCalled();
  });

  it("hands a member's 403 back as a refusal — hidden, and refused", async () => {
    waive.mockRejectedValue(new ApiError(403, "forbidden", "Only an owner or admin may waive."));

    expect(await waiveFailure(BUILD_3_ID, CASE, "not mine to waive")).toEqual({
      ok: false,
      status: 403,
      code: "forbidden",
      reason: "Only an owner or admin may waive.",
    });
  });

  it("says a dropped connection as unreachable, and rethrows anything else", async () => {
    waive.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await waiveFailure(BUILD_3_ID, CASE, "r")).toEqual(
      expect.objectContaining({ ok: false, code: ROUTE_UNREACHABLE_CODE }),
    );

    const redirect = new Error("NEXT_REDIRECT");
    waive.mockRejectedValueOnce(redirect);
    await expect(waiveFailure(BUILD_3_ID, CASE, "r")).rejects.toBe(redirect);
  });
});

describe("setRunIntent", () => {
  it("sends the one toggle that was pressed, and returns both as stored", async () => {
    setIntents.mockResolvedValue(intents({ autoRerunPhysical: true }));

    expect(
      await setRunIntent(SEEDED_RUN_ID, { field: "autoRerunPhysical", value: true }),
    ).toEqual({ ok: true, intents: intents({ autoRerunPhysical: true }) });
    expect(setIntents).toHaveBeenCalledExactlyOnceWith(SEEDED_RUN_ID, {
      autoRerunPhysical: true,
    });

    await setRunIntent(SEEDED_RUN_ID, { field: "blockUntilGreen", value: false });
    expect(setIntents).toHaveBeenLastCalledWith(SEEDED_RUN_ID, { blockUntilGreen: false });
  });

  it("refuses a run that is not a uuid, a field that is not one of two, and a value that is not a boolean", async () => {
    for (const [runId, change] of [
      ["..", { field: "blockUntilGreen", value: true }],
      [SEEDED_RUN_ID, { field: "requeue", value: true }],
      [SEEDED_RUN_ID, { field: "blockUntilGreen", value: "true" }],
      [SEEDED_RUN_ID, { field: "blockUntilGreen", value: null }],
      [SEEDED_RUN_ID, { field: "blockUntilGreen" }],
      [SEEDED_RUN_ID, { blockUntilGreen: true }],
      [SEEDED_RUN_ID, null],
    ] as const) {
      expect(await setRunIntent(runId, change)).toEqual(REFUSED);
    }

    expect(setIntents).not.toHaveBeenCalled();
  });

  it("hands the service's refusal back in its own words", async () => {
    setIntents.mockRejectedValue(new ApiError(404, "run_not_found", "No such run."));

    expect(await setRunIntent(SEEDED_RUN_ID, { field: "blockUntilGreen", value: true })).toEqual({
      ok: false,
      status: 404,
      code: "run_not_found",
      reason: "No such run.",
    });
  });

  it("says a dropped connection as unreachable, and rethrows anything else", async () => {
    const change = { field: "blockUntilGreen", value: true };

    setIntents.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await setRunIntent(SEEDED_RUN_ID, change)).toEqual(
      expect.objectContaining({ ok: false, code: ROUTE_UNREACHABLE_CODE }),
    );

    const redirect = new Error("NEXT_REDIRECT");
    setIntents.mockRejectedValueOnce(redirect);
    await expect(setRunIntent(SEEDED_RUN_ID, change)).rejects.toBe(redirect);
  });
});
