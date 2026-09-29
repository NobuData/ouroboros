import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import type { UpdateMergePlanRequest } from "@/app/api/pull-requests";
import { MAX_COMMIT_MESSAGE_LENGTH } from "@/app/prs/merge-message";
import {
  ACTION_INVALID,
  ACTION_INVALID_CODE,
  ACTION_UNREACHABLE,
  ACTION_UNREACHABLE_CODE,
  type PlanEdit,
  RECHECK_FAILED_CODE,
} from "@/app/prs/outcomes";

import {
  OTA_EPIC,
  PR_514_ID,
  REV_2_ID,
  armedPlan,
  mergeOutcome,
  mergePlan,
} from "../helpers/pull-requests";

/**
 * The merge plan's server hop (#369). These are the actions that end in an irreversible merge, so
 * the role gate and the re-check are the service's: this sends only the plan's five editable
 * fields, hands every refusal back as a value, and carries the re-check's own code so the card
 * can say which check failed.
 */

const edit = vi.fn();
const arm = vi.fn();
const disarm = vi.fn();
const merge = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/pull-requests", async (original) => ({
  ...(await original<typeof import("@/app/api/pull-requests")>()),
  pullRequests: {
    editMergePlan: (id: string, request: UpdateMergePlanRequest) => edit(id, request),
    armMergePlan: (id: string, revisionId: string) => arm(id, revisionId),
    disarmMergePlan: (id: string) => disarm(id),
    merge: (id: string) => merge(id),
  },
}));

const { armPlan, disarmPlan, editPlan, mergeNow } = await import("@/app/prs/merge-actions");

/** The refusal made before calling out. */
const REFUSED = {
  ok: false,
  status: 422,
  code: ACTION_INVALID_CODE,
  reason: ACTION_INVALID,
  recheck: null,
};

beforeEach(() => {
  for (const sender of [edit, arm, disarm, merge]) sender.mockReset();
});

describe("editing the plan", () => {
  it("sends each field on its own, and answers the plan", async () => {
    const edits: PlanEdit[] = [
      { commitMessage: "fix(can): reworded" },
      { closeTicket: false },
      { commentEvidence: false },
      { backAnnotateEpic: true },
      { epicId: OTA_EPIC.id },
      { epicId: null },
    ];

    for (const sent of edits) {
      const answer = mergePlan(sent);
      edit.mockResolvedValue(answer);

      expect(await editPlan(PR_514_ID, sent)).toEqual({ ok: true, answer });
      expect(edit).toHaveBeenLastCalledWith(PR_514_ID, sent);
    }
  });

  it("tells a cleared epic from one left alone", async () => {
    edit.mockResolvedValue(mergePlan());

    await editPlan(PR_514_ID, { epicId: null });
    expect(edit).toHaveBeenLastCalledWith(PR_514_ID, { epicId: null });

    await editPlan(PR_514_ID, { closeTicket: false, epicId: undefined });
    expect(edit).toHaveBeenLastCalledWith(PR_514_ID, { closeTicket: false });
    expect(Object.keys(edit.mock.lastCall?.[1] as object)).toEqual(["closeTicket"]);
  });

  it("sends nothing but the five editable fields — never a strategy, an arm or a result", async () => {
    edit.mockResolvedValue(mergePlan());

    await editPlan(PR_514_ID, {
      closeTicket: false,
      strategy: "rebase",
      deleteBranch: false,
      armed: true,
      armedBy: "somebody",
      mergedResult: { sha: "deadbeef" },
    } as PlanEdit);

    expect(edit).toHaveBeenCalledExactlyOnceWith(PR_514_ID, { closeTicket: false });
  });

  it("refuses, before calling out, what the card could not have built", async () => {
    const malformed: unknown[] = [
      {},
      { strategy: "rebase" },
      null,
      "closeTicket",
      { commitMessage: "" },
      { commitMessage: "   " },
      { commitMessage: " padded" },
      { commitMessage: "padded\n" },
      { commitMessage: "x".repeat(MAX_COMMIT_MESSAGE_LENGTH + 1) },
      { commitMessage: 42 },
      { commitMessage: null },
      { closeTicket: "true" },
      { commentEvidence: 1 },
      { backAnnotateEpic: null },
      { epicId: "ota-hardening" },
      { epicId: 7 },
    ];

    for (const sent of malformed) {
      expect(await editPlan(PR_514_ID, sent as PlanEdit)).toEqual(REFUSED);
    }
    expect(await editPlan("514", { closeTicket: false })).toEqual(REFUSED);
    expect(edit).not.toHaveBeenCalled();
  });

  it("takes a message of exactly the bound, and one of several lines", async () => {
    edit.mockResolvedValue(mergePlan());

    expect(
      (await editPlan(PR_514_ID, { commitMessage: "x".repeat(MAX_COMMIT_MESSAGE_LENGTH) })).ok,
    ).toBe(true);
    expect((await editPlan(PR_514_ID, { commitMessage: "title\n\nCloses #482." })).ok).toBe(true);
  });

  it.each([
    [409, "merge_plan_armed", "This plan is armed — disarm it before changing what it will do."],
    [409, "merge_plan_merged", "This PR has merged; its plan is final."],
    [409, "pull_request_not_open", "The pull request is closed; its merge plan can no longer be changed."],
    [422, "merge_plan_epic_required", "Choose the roadmap epic to back-annotate before switching it on."],
    [422, "merge_plan_epic_not_found", "No such roadmap epic in this workspace."],
    [403, "forbidden", "A viewer may not change a merge plan."],
    [403, "merge_not_policy_eligible", "Only an owner or admin may merge this PR."],
  ])("hands back the service's %i %s as a value, in its own words", async (status, code, message) => {
    edit.mockRejectedValue(new ApiError(status, code, message));

    expect(await editPlan(PR_514_ID, { closeTicket: false })).toEqual({
      ok: false,
      status,
      code,
      reason: message,
      recheck: null,
    });
  });
});

describe("Merge when all gates green", () => {
  it("arms against the revision the confirmation stated, and answers the armed plan", async () => {
    arm.mockResolvedValue(armedPlan());

    expect(await armPlan(PR_514_ID, REV_2_ID)).toEqual({ ok: true, answer: armedPlan() });
    expect(arm).toHaveBeenCalledExactlyOnceWith(PR_514_ID, REV_2_ID);
  });

  it("refuses ids that are not ids before calling out", async () => {
    expect(await armPlan(PR_514_ID, "2")).toEqual(REFUSED);
    expect(await armPlan("514", REV_2_ID)).toEqual(REFUSED);
    expect(await armPlan(PR_514_ID, undefined as unknown as string)).toEqual(REFUSED);
    expect(arm).not.toHaveBeenCalled();
  });

  it("is refused for a viewer, and for a member whose PR does not auto-merge", async () => {
    arm.mockRejectedValueOnce(new ApiError(403, "forbidden", "A viewer may not arm a merge."));
    expect(await armPlan(PR_514_ID, REV_2_ID)).toMatchObject({
      ok: false,
      status: 403,
      code: "forbidden",
      reason: "A viewer may not arm a merge.",
    });

    arm.mockRejectedValueOnce(
      new ApiError(403, "merge_not_policy_eligible", "Only an owner or admin may merge this PR."),
    );
    expect(await armPlan(PR_514_ID, REV_2_ID)).toMatchObject({
      ok: false,
      status: 403,
      code: "merge_not_policy_eligible",
    });
  });

  it("hands back a stale revision as a value", async () => {
    arm.mockRejectedValue(
      new ApiError(409, "merge_revision_stale", "A newer revision exists — review its gates."),
    );

    expect(await armPlan(PR_514_ID, REV_2_ID)).toMatchObject({
      ok: false,
      code: "merge_revision_stale",
      reason: "A newer revision exists — review its gates.",
      recheck: null,
    });
  });
});

describe("Disarm", () => {
  it("disarms, and answers the plan", async () => {
    disarm.mockResolvedValue(mergePlan());

    expect(await disarmPlan(PR_514_ID)).toEqual({ ok: true, answer: mergePlan() });
    expect(disarm).toHaveBeenCalledExactlyOnceWith(PR_514_ID);
  });

  it("is refused for a viewer", async () => {
    disarm.mockRejectedValue(new ApiError(403, "forbidden", "A viewer may not disarm a merge."));

    expect(await disarmPlan(PR_514_ID)).toMatchObject({ ok: false, status: 403, code: "forbidden" });
    expect(await disarmPlan("514")).toEqual(REFUSED);
  });
});

describe("Merge now", () => {
  it("merges, and answers what the merge did", async () => {
    merge.mockResolvedValue(mergeOutcome());

    expect(await mergeNow(PR_514_ID)).toEqual({ ok: true, answer: mergeOutcome() });
    expect(merge).toHaveBeenCalledExactlyOnceWith(PR_514_ID);
    expect(await mergeNow("514")).toEqual(REFUSED);
  });

  it.each(["gate_red", "head_moved", "host_conflict", "gates_pending", "host_refused"])(
    "carries the re-check's own code for %s — the reason, not a generic error",
    async (code) => {
      merge.mockRejectedValue(
        new ApiError(409, RECHECK_FAILED_CODE, "Physical HIL is red on revision 2.", {
          prId: PR_514_ID,
          reason: code,
          disarmed: code !== "gates_pending",
        }),
      );

      expect(await mergeNow(PR_514_ID)).toEqual({
        ok: false,
        status: 409,
        code: RECHECK_FAILED_CODE,
        reason: "Physical HIL is red on revision 2.",
        recheck: { code, disarmed: code !== "gates_pending" },
      });
    },
  );

  it("names no re-check for a refusal that is not one, or one that does not say why", async () => {
    merge.mockRejectedValueOnce(new ApiError(409, "merge_plan_merged", "Already merged."));
    expect(await mergeNow(PR_514_ID)).toMatchObject({ recheck: null });

    merge.mockRejectedValueOnce(new ApiError(409, RECHECK_FAILED_CODE, "Refused.", {}));
    expect(await mergeNow(PR_514_ID)).toMatchObject({ code: RECHECK_FAILED_CODE, recheck: null });
  });
});

describe("every action", () => {
  it("answers a service that could not be reached as a value", async () => {
    const unreachable = {
      ok: false,
      status: 502,
      code: ACTION_UNREACHABLE_CODE,
      reason: ACTION_UNREACHABLE,
      recheck: null,
    };

    for (const sender of [edit, arm, disarm, merge]) {
      sender.mockRejectedValue(new TypeError("fetch failed"));
    }

    expect(await editPlan(PR_514_ID, { closeTicket: false })).toEqual(unreachable);
    expect(await armPlan(PR_514_ID, REV_2_ID)).toEqual(unreachable);
    expect(await disarmPlan(PR_514_ID)).toEqual(unreachable);
    expect(await mergeNow(PR_514_ID)).toEqual(unreachable);
  });

  it("rethrows what is neither — an ended session's redirect above all", async () => {
    const redirect = new Error("NEXT_REDIRECT");

    for (const sender of [edit, arm, disarm, merge]) sender.mockRejectedValue(redirect);

    await expect(editPlan(PR_514_ID, { closeTicket: false })).rejects.toBe(redirect);
    await expect(armPlan(PR_514_ID, REV_2_ID)).rejects.toBe(redirect);
    await expect(disarmPlan(PR_514_ID)).rejects.toBe(redirect);
    await expect(mergeNow(PR_514_ID)).rejects.toBe(redirect);
  });
});
