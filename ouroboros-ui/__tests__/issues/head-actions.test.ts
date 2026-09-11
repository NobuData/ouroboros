import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import {
  NOTHING_QUEUED,
  QUEUE_FAILED,
  QUEUE_NOTHING_SELECTED,
  QUEUE_ROLE_REASON,
  REESTIMATE_BUSY,
  REESTIMATE_FAILED,
  REESTIMATE_ROLE_REASON,
} from "@/app/issues/view";

import {
  SYNC_FAILED,
  SYNC_ROLE_REASON,
  SYNC_RUNNING,
  SYNC_STARTED,
  syncTooSoon,
} from "@/app/issues/table";

import {
  REESTIMATE_ONE_BUSY,
  REESTIMATE_ONE_FAILED,
  REESTIMATE_ONE_NOT_FOUND,
  REESTIMATE_ONE_ROLE_REASON,
  REESTIMATE_ONE_STARTED,
} from "@/app/issues/panel";

import { SELECTED_TRIO, estimationAccepted, fanout, issueId, queuedSelection, syncStatus } from "../helpers/issues";

/**
 * The intake page's server hops — the head's two (#115), the freshness tag's (#117), the
 * selection bar's (#118) and the detail panel's single re-estimate (#119).
 *
 * A Server Action is a POST endpoint anybody can reach, so the security cases come first: no
 * action takes a workspace or a person, the role gates are the service's, and the two queue
 * actions refuse a selection that is not a list of ids — and a workflow outside the fixed set —
 * before anything is sent. The rest is the posture every action here keeps — a refusal is a
 * sentence the page can draw, with the issues it named where the service named any, and the
 * redirect signal is the one throw that travels.
 */

/** What the fan-out answers, per case. */
const estimateAll = vi.fn();

/** What the queue write answers, per case. */
const queue = vi.fn();

/** What the sync trigger answers, per case. */
const sync = vi.fn();

/** What the single re-estimate answers, per case. */
const estimate = vi.fn();

vi.mock("@/app/api/backlog", async () => {
  const actual = await vi.importActual<typeof import("@/app/api/backlog")>("@/app/api/backlog");

  // The codes the actions branch on are the module's own, so a suite that spelled them out here
  // could pass on the day the constants stopped matching the service.
  return {
    ...actual,
    backlog: {
      ...actual.backlog,
      estimate: (id: unknown) => estimate(id),
      estimateAll: () => estimateAll(),
      queue: (selection: unknown) => queue(selection),
      sync: () => sync(),
    },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { queueSelected, queueUnder, reestimateAll, reestimateIssue, syncBacklog } = await import(
  "@/app/issues/head-actions"
);

beforeEach(() => {
  estimateAll.mockReset().mockResolvedValue(fanout());
  queue.mockReset().mockResolvedValue(queuedSelection());
  sync.mockReset().mockResolvedValue(syncStatus());
  estimate.mockReset().mockResolvedValue(estimationAccepted());
});

describe("reestimateIssue (#119)", () => {
  it("asks for the one issue by its id, and says sizing started", async () => {
    expect(await reestimateIssue(issueId(485))).toEqual({ ok: true, message: REESTIMATE_ONE_STARTED });
    expect(estimate).toHaveBeenCalledExactlyOnceWith(issueId(485));
  });

  it("sends nothing for a forged id that is not a non-empty string", async () => {
    for (const forged of ["", 485, null, [issueId(485)]]) {
      expect(await reestimateIssue(forged as unknown as string)).toEqual({ ok: false, reason: REESTIMATE_ONE_FAILED });
    }
    expect(estimate).not.toHaveBeenCalled();
  });

  it("answers a viewer with the panel's own sentence, not the API's", async () => {
    estimate.mockRejectedValue(new ApiError(403, "forbidden", "Your role does not permit this."));

    expect(await reestimateIssue(issueId(485))).toEqual({ ok: false, reason: REESTIMATE_ONE_ROLE_REASON });
  });

  it("says the issue is gone for an id this workspace cannot see", async () => {
    estimate.mockRejectedValue(new ApiError(404, "issue_not_found", "No issue with that id."));

    expect(await reestimateIssue(issueId(999))).toEqual({ ok: false, reason: REESTIMATE_ONE_NOT_FOUND });
  });

  it("reports an estimate already in flight as the thing asked for happening", async () => {
    estimate.mockRejectedValue(new ApiError(409, "issue_already_estimating", "Already estimating."));

    expect(await reestimateIssue(issueId(485))).toEqual({ ok: true, message: REESTIMATE_ONE_BUSY });
  });

  it("gives a rate-limited reader the wait the service asked for", async () => {
    estimate.mockRejectedValue(
      new ApiError(429, "estimation_rate_limited", "Too many.", { retryAfterSeconds: 24 }),
    );

    const outcome = await reestimateIssue(issueId(485));

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? "" : outcome.reason).toMatch(/Try again in 24 seconds\.$/);
  });

  it("carries any other refusal's sentence, with a fallback for an empty one", async () => {
    estimate.mockRejectedValue(new ApiError(400, "organization_required", "Choose a workspace."));
    expect(await reestimateIssue(issueId(485))).toEqual({ ok: false, reason: "Choose a workspace." });

    estimate.mockRejectedValue(new ApiError(502, "client_unreadable_error", ""));
    expect(await reestimateIssue(issueId(485))).toEqual({ ok: false, reason: REESTIMATE_ONE_FAILED });
  });

  it("lets the redirect signal through", async () => {
    estimate.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(reestimateIssue(issueId(485))).rejects.toThrow("NEXT_REDIRECT /login");
  });
});

describe("syncBacklog (#117)", () => {
  it("asks for a cycle with nothing but the session, and says one started", async () => {
    expect(await syncBacklog()).toEqual({ ok: true, message: SYNC_STARTED });
    expect(sync).toHaveBeenCalledExactlyOnceWith();
  });

  it("carries the service's sentence when the loop is paused and the press could move nothing", async () => {
    sync.mockResolvedValue(
      syncStatus({ state: "paused", pause: "not_configured", message: "No GitHub token is configured." }),
    );

    expect(await syncBacklog()).toEqual({ ok: false, reason: "No GitHub token is configured." });
  });

  it("answers a viewer with the tag's own sentence, not the API's", async () => {
    sync.mockRejectedValue(new ApiError(403, "forbidden", "Your role does not permit this."));

    expect(await syncBacklog()).toEqual({ ok: false, reason: SYNC_ROLE_REASON });
  });

  it("reports a cycle already in flight as the thing asked for happening", async () => {
    sync.mockRejectedValue(new ApiError(409, "backlog_sync_running", "A cycle is running."));

    expect(await syncBacklog()).toEqual({ ok: true, message: SYNC_RUNNING });
  });

  it("says how long to wait when the last cycle was too recent", async () => {
    sync.mockRejectedValue(
      new ApiError(409, "backlog_sync_too_soon", "Too soon.", { retryAfterSeconds: 12 }),
    );

    expect(await syncBacklog()).toEqual({ ok: false, reason: syncTooSoon(12) });
  });

  it("carries any other refusal's sentence, with a fallback for an empty one", async () => {
    sync.mockRejectedValue(new ApiError(503, "unavailable", "GitHub is not answering."));
    expect(await syncBacklog()).toEqual({ ok: false, reason: "GitHub is not answering." });

    sync.mockRejectedValue(new ApiError(500, "internal_error", ""));
    expect(await syncBacklog()).toEqual({ ok: false, reason: SYNC_FAILED });
  });

  it("lets the redirect signal through", async () => {
    sync.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(syncBacklog()).rejects.toThrow("NEXT_REDIRECT /login");
  });
});

describe("reestimateAll", () => {
  it("asks for the fan-out with nothing but the session, and says how many it started", async () => {
    expect(await reestimateAll()).toEqual({ ok: true, message: "Re-estimating 9 issues." });
    expect(estimateAll).toHaveBeenCalledExactlyOnceWith();
  });

  it("says what it left alone when fewer started than the workspace mirrors", async () => {
    estimateAll.mockResolvedValue(fanout({ enqueued: 7, skipped: 2 }));

    expect(await reestimateAll()).toEqual({
      ok: true,
      message: "Re-estimating 7 issues. 2 issues already being estimated were left alone.",
    });
  });

  it("answers a role below admin with the head's own sentence, not the API's", async () => {
    estimateAll.mockRejectedValue(new ApiError(403, "forbidden", "Your role does not permit this."));

    expect(await reestimateAll()).toEqual({ ok: false, reason: REESTIMATE_ROLE_REASON });
  });

  it("says every issue is already in flight when the backlog is busy", async () => {
    estimateAll.mockRejectedValue(
      new ApiError(409, "backlog_already_estimating", "Already estimating.", { estimating: 9 }),
    );

    expect(await reestimateAll()).toEqual({ ok: false, reason: REESTIMATE_BUSY });
  });

  it("gives a rate-limited reader the wait the service asked for", async () => {
    estimateAll.mockRejectedValue(
      new ApiError(429, "estimation_rate_limited", "Too many.", { retryAfterSeconds: 24 }),
    );

    const outcome = await reestimateAll();

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? "" : outcome.reason).toMatch(/Try again in 24 seconds\.$/);
  });

  it("passes any other refusal through in the service's words", async () => {
    estimateAll.mockRejectedValue(new ApiError(400, "organization_required", "Choose a workspace."));

    expect(await reestimateAll()).toEqual({ ok: false, reason: "Choose a workspace." });
  });

  it("falls back to its own sentence when the service gave none", async () => {
    estimateAll.mockRejectedValue(new ApiError(502, "client_unreadable_error", ""));

    expect(await reestimateAll()).toEqual({ ok: false, reason: REESTIMATE_FAILED });
  });

  it("lets a redirect through, so an expired session still reaches the login screen", async () => {
    estimateAll.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(reestimateAll()).rejects.toThrow("NEXT_REDIRECT /login");
  });
});

describe("queueSelected", () => {
  it("sends the selection in its order, with no workflow, and says how many were queued", async () => {
    // No workflow is what makes this *Queue N selected ⟳* rather than *Queue → standard-fix*: each
    // issue goes under the workflow its own estimate suggested.
    expect(await queueSelected(SELECTED_TRIO)).toEqual({ ok: true, message: "Queued 3 issues." });
    expect(queue).toHaveBeenCalledExactlyOnceWith({ issueIds: [...SELECTED_TRIO] });
  });

  it("sends nothing for an empty selection, and says what the button would have said", async () => {
    expect(await queueSelected([])).toEqual({ ok: false, reason: QUEUE_NOTHING_SELECTED });
    expect(queue).not.toHaveBeenCalled();
  });

  it("sends nothing for a forged selection that is not a list", async () => {
    // Types do not survive a hand-made POST. A string spread into a request would be one id per
    // character.
    const forged = SELECTED_TRIO[0] as unknown as readonly string[];

    expect(await queueSelected(forged)).toEqual({
      ok: false,
      reason: `${QUEUE_FAILED} ${NOTHING_QUEUED}`,
    });
    expect(queue).not.toHaveBeenCalled();
  });

  it("sends nothing for a list that holds something other than ids", async () => {
    const forged = [SELECTED_TRIO[0], 42, { id: SELECTED_TRIO[1] }] as unknown as readonly string[];

    expect((await queueSelected(forged)).ok).toBe(false);
    expect(queue).not.toHaveBeenCalled();
  });

  it("answers a viewer with the button's own role sentence", async () => {
    queue.mockRejectedValue(new ApiError(403, "forbidden", "Your role does not permit this."));

    expect(await queueSelected(SELECTED_TRIO)).toEqual({ ok: false, reason: QUEUE_ROLE_REASON });
  });

  it("passes an unsized-issue refusal through, and says nothing was queued", async () => {
    queue.mockRejectedValue(
      new ApiError(
        422,
        "queue_issues_not_queueable",
        "Some of those issues have not been sized yet. Only sized issues can be queued.",
      ),
    );

    expect(await queueSelected(SELECTED_TRIO)).toEqual({
      ok: false,
      reason: `Some of those issues have not been sized yet. Only sized issues can be queued. ${NOTHING_QUEUED}`,
    });
  });

  it("does the same for a selection the queue already holds", async () => {
    queue.mockRejectedValue(
      new ApiError(409, "queue_issues_conflict", "Some of those issues are already in the queue."),
    );

    expect(await queueSelected(SELECTED_TRIO)).toEqual({
      ok: false,
      reason: `Some of those issues are already in the queue. ${NOTHING_QUEUED}`,
    });
  });

  it("falls back to its own sentence when the service gave none", async () => {
    queue.mockRejectedValue(new ApiError(502, "client_unreadable_error", ""));

    expect(await queueSelected(SELECTED_TRIO)).toEqual({
      ok: false,
      reason: `${QUEUE_FAILED} ${NOTHING_QUEUED}`,
    });
  });

  it("lets a redirect through", async () => {
    queue.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(queueSelected(SELECTED_TRIO)).rejects.toThrow("NEXT_REDIRECT /login");
  });
});

describe("queueUnder (#118)", () => {
  it("sends the selection under the chosen workflow, and answers with what the service created", async () => {
    expect(await queueUnder(SELECTED_TRIO, "docs-loop")).toEqual({ ok: true, queued: queuedSelection() });
    expect(queue).toHaveBeenCalledExactlyOnceWith({ issueIds: [...SELECTED_TRIO], workflow: "docs-loop" });
  });

  it("sends no workflow at all for use suggested — not an undefined one", async () => {
    await queueUnder(SELECTED_TRIO, null);

    expect(queue).toHaveBeenCalledOnce();
    expect(queue.mock.calls[0]![0]).toEqual({ issueIds: [...SELECTED_TRIO] });
    expect(queue.mock.calls[0]![0]).not.toHaveProperty("workflow");
  });

  it("sends nothing for a workflow outside the fixed set", async () => {
    // A forged POST can name any string; the service would answer `validation_failed`, and
    // there is no reason to ask it.
    expect(await queueUnder(SELECTED_TRIO, "release-train")).toEqual({
      ok: false,
      reason: `${QUEUE_FAILED} ${NOTHING_QUEUED}`,
      offenders: [],
    });
    expect(queue).not.toHaveBeenCalled();
  });

  it("sends nothing for an empty or forged selection, as the head's action does", async () => {
    expect(await queueUnder([], null)).toEqual({ ok: false, reason: QUEUE_NOTHING_SELECTED, offenders: [] });
    expect((await queueUnder(SELECTED_TRIO[0] as unknown as readonly string[], null)).ok).toBe(false);
    expect(queue).not.toHaveBeenCalled();
  });

  it("answers a viewer with the role sentence and no offenders", async () => {
    queue.mockRejectedValue(new ApiError(403, "forbidden", "Your role does not permit this."));

    expect(await queueUnder(SELECTED_TRIO, null)).toEqual({
      ok: false,
      reason: QUEUE_ROLE_REASON,
      offenders: [],
    });
  });

  it("carries the issues a refusal named, read out of details", async () => {
    queue.mockRejectedValue(
      new ApiError(
        422,
        "queue_issues_not_queueable",
        "Some of those issues have not been sized yet. Only sized issues can be queued.",
        {
          issues: [
            { issueId: SELECTED_TRIO[2], code: "issue_not_sized", issueNumber: 491, sizingStatus: "estimating" },
          ],
        },
      ),
    );

    expect(await queueUnder(SELECTED_TRIO, "standard-fix")).toEqual({
      ok: false,
      reason: `Some of those issues have not been sized yet. Only sized issues can be queued. ${NOTHING_QUEUED}`,
      offenders: [
        { issueId: SELECTED_TRIO[2], code: "issue_not_sized", issueNumber: 491, sizingStatus: "estimating" },
      ],
    });
  });

  it("carries a conflict's issues the same way", async () => {
    queue.mockRejectedValue(
      new ApiError(409, "queue_issues_conflict", "Some of those issues are already in the queue.", {
        issues: [{ issueId: SELECTED_TRIO[0], code: "issue_already_queued", issueNumber: 485 }],
      }),
    );

    const outcome = await queueUnder(SELECTED_TRIO, null);

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? [] : outcome.offenders).toEqual([
      { issueId: SELECTED_TRIO[0], code: "issue_already_queued", issueNumber: 485, sizingStatus: null },
    ]);
  });

  it("names no offender for a refusal that carried none, with the fallback sentence", async () => {
    queue.mockRejectedValue(new ApiError(502, "client_unreadable_error", ""));

    expect(await queueUnder(SELECTED_TRIO, null)).toEqual({
      ok: false,
      reason: `${QUEUE_FAILED} ${NOTHING_QUEUED}`,
      offenders: [],
    });
  });

  it("lets a redirect through", async () => {
    queue.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(queueUnder(SELECTED_TRIO, null)).rejects.toThrow("NEXT_REDIRECT /login");
  });
});
