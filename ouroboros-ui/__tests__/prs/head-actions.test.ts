import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import type { ReturnToLoopRequest } from "@/app/api/pull-requests";
import {
  ACTION_INVALID,
  ACTION_INVALID_CODE,
  ACTION_UNREACHABLE,
  ACTION_UNREACHABLE_CODE,
  MAX_REPLAY_KEY_LENGTH,
  MAX_RETURNED_GATES,
  type ReturnSelection,
} from "@/app/prs/outcomes";

import { PR_514_ID, REV_2_ID, returned, review } from "../helpers/pull-requests";

/**
 * The head actions' server hop (#363). The role gate and whether a gate is red are the service's:
 * this sends only ids, gate keys and a bounded replay key, and hands a refusal back as a value
 * the page can draw.
 */

const requestReview = vi.fn();
const sendReturn = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/pull-requests", async (original) => ({
  ...(await original<typeof import("@/app/api/pull-requests")>()),
  pullRequests: {
    requestReview: (id: string) => requestReview(id),
    returnToLoop: (id: string, request: ReturnToLoopRequest) => sendReturn(id, request),
  },
}));

const { requestHumanReview, returnToLoop } = await import("@/app/prs/head-actions");

/** The refusal made before calling out. */
const REFUSED = { ok: false, status: 422, code: ACTION_INVALID_CODE, reason: ACTION_INVALID };

/** A selection the dialog could have sent. */
const SELECTION: ReturnSelection = {
  gates: ["test_suite", "physical_hil"],
  revisionId: REV_2_ID,
  replayKey: "press-1",
};

beforeEach(() => {
  requestReview.mockReset();
  sendReturn.mockReset();
});

describe("requestHumanReview", () => {
  it("asks for the review and returns the service's answer", async () => {
    const outcome = { review: review(), created: true, humanApproval: null, aggregate: null };
    requestReview.mockResolvedValue(outcome);

    expect(await requestHumanReview(PR_514_ID)).toEqual({ ok: true, outcome });
    expect(requestReview).toHaveBeenCalledExactlyOnceWith(PR_514_ID);
  });

  it("refuses an id that is not a uuid before calling out", async () => {
    for (const id of ["514", "..", `${PR_514_ID}/../x`]) {
      expect(await requestHumanReview(id)).toEqual(REFUSED);
    }
    expect(requestReview).not.toHaveBeenCalled();
  });

  it("hands the service's refusal back in its own words — a viewer's 403 included", async () => {
    requestReview.mockRejectedValue(
      new ApiError(403, "forbidden", "A viewer may not request a review."),
    );

    expect(await requestHumanReview(PR_514_ID)).toEqual({
      ok: false,
      status: 403,
      code: "forbidden",
      reason: "A viewer may not request a review.",
    });
  });

  it("says a dropped connection as unreachable, and rethrows anything else", async () => {
    requestReview.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await requestHumanReview(PR_514_ID)).toEqual({
      ok: false,
      status: 502,
      code: ACTION_UNREACHABLE_CODE,
      reason: ACTION_UNREACHABLE,
    });

    const redirect = new Error("NEXT_REDIRECT");
    requestReview.mockRejectedValueOnce(redirect);
    await expect(requestHumanReview(PR_514_ID)).rejects.toBe(redirect);
  });
});

describe("returnToLoop", () => {
  it("sends the gates, the revision and the replay key, and returns the service's answer", async () => {
    sendReturn.mockResolvedValue(returned());

    expect(await returnToLoop(PR_514_ID, SELECTION)).toEqual({ ok: true, answer: returned() });
    expect(sendReturn).toHaveBeenCalledExactlyOnceWith(PR_514_ID, {
      gates: ["test_suite", "physical_hil"],
      revisionId: REV_2_ID,
      idempotencyKey: "press-1",
    });
  });

  it("sends no key when the press had none", async () => {
    sendReturn.mockResolvedValue(returned());

    await returnToLoop(PR_514_ID, { gates: ["custom:lint"], revisionId: REV_2_ID });

    expect(sendReturn).toHaveBeenCalledExactlyOnceWith(PR_514_ID, {
      gates: ["custom:lint"],
      revisionId: REV_2_ID,
    });
  });

  it("refuses what could not have come from the dialog, before calling out", async () => {
    const forged: unknown[] = [
      { ...SELECTION, gates: [] },
      { ...SELECTION, gates: ["test_suite", "test_suite"] },
      { ...SELECTION, gates: ["not a gate"] },
      { ...SELECTION, gates: ["../../admin"] },
      { ...SELECTION, gates: [7] },
      { ...SELECTION, gates: "test_suite" },
      { ...SELECTION, gates: Array.from({ length: MAX_RETURNED_GATES + 1 }, (_, n) => `custom:g${n}`) },
      { ...SELECTION, revisionId: "2" },
      { ...SELECTION, replayKey: "" },
      { ...SELECTION, replayKey: " padded " },
      { ...SELECTION, replayKey: "k".repeat(MAX_REPLAY_KEY_LENGTH + 1) },
      { ...SELECTION, replayKey: 7 },
      null,
      "selection",
    ];

    for (const selection of forged) {
      expect(await returnToLoop(PR_514_ID, selection as ReturnSelection)).toEqual(REFUSED);
    }
    expect(await returnToLoop("514", SELECTION)).toEqual(REFUSED);
    expect(sendReturn).not.toHaveBeenCalled();
  });

  it("hands back the service's refusal of a gate that is not red, and of a viewer", async () => {
    sendReturn.mockRejectedValueOnce(new ApiError(422, "pr_gate_not_red", "Build is not red."));
    expect(await returnToLoop(PR_514_ID, SELECTION)).toEqual({
      ok: false,
      status: 422,
      code: "pr_gate_not_red",
      reason: "Build is not red.",
    });

    sendReturn.mockRejectedValueOnce(new ApiError(403, "forbidden", "A viewer may not steer."));
    expect(await returnToLoop(PR_514_ID, SELECTION)).toMatchObject({ ok: false, status: 403 });
  });

  it("says a dropped connection as unreachable, and rethrows anything else", async () => {
    sendReturn.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await returnToLoop(PR_514_ID, SELECTION)).toMatchObject({
      ok: false,
      code: ACTION_UNREACHABLE_CODE,
    });

    const redirect = new Error("NEXT_REDIRECT");
    sendReturn.mockRejectedValueOnce(redirect);
    await expect(returnToLoop(PR_514_ID, SELECTION)).rejects.toBe(redirect);
  });
});
