import { describe, expect, it } from "vitest";

import type { PrMergeRefusalCode, PullRequestState } from "@/app/api/pull-requests";
import { MERGE_PLAN_ID, MERGE_PLAN_TITLE } from "@/app/prs/merge-plan";
import {
  CLOSED_HEADLINE,
  NEVER_SYNCED_REASON,
  NOTHING_MERGED,
  NOT_THIS_PLAN,
  NOW_A_RECORD,
  PR_SYNC_LAG_AFTER_SECONDS,
  SYNC_LAG_REASON,
  hostLinks,
  stateBanner,
  syncLag,
  syncLagHeadline,
  syncLagReason,
  syncedWhen,
} from "@/app/prs/states";

import {
  GATE_RED_MESSAGE,
  HOST_CONFLICT_MESSAGE,
  HOST_URL,
  TICKET_URL,
  armedPlan,
  blockedPage,
  closedPage,
  disarmedPage,
  mergePlan,
  mergedPage,
  mergedPlan,
  prHeadOf,
  prPage,
  readyPage,
} from "../helpers/pull-requests";

/**
 * The PR page's states besides *mid-verification* (#370), without rendering: what the banner
 * says of a merged, closed and disarmed PR — and that it names **which** re-check refused — and
 * when a PR's sync is said to have gone quiet.
 */

/** 14:50 on the day the helper's PR was opened. */
const NOW = Date.parse("2026-09-27T14:50:00.000Z");

/** The threshold, in milliseconds. */
const AFTER = PR_SYNC_LAG_AFTER_SECONDS * 1000;

describe("the merged banner — the receipt", () => {
  it("says which sha, as whom, when, and which actions ran", () => {
    const banner = stateBanner(mergedPage(), null);

    expect(banner).toMatchObject({
      kind: "merged",
      tone: "ok",
      headline: "Merged — 9c4ab7f, as ken-s",
      moment: { at: "2026-09-27T14:45:02.000Z", text: "14:45:02" },
      skipped: [],
    });
    expect(banner?.lines).toEqual([
      "Ran: closed issue #482 · commented the evidence summary · deleted the branch.",
      NOW_A_RECORD,
    ]);
  });

  it("links the PR and the ticket on their host", () => {
    expect(stateBanner(mergedPage(), null)?.links).toEqual([
      { label: "PR #514 on its host", href: HOST_URL, external: true },
      { label: "issue #482 on its tracker", href: TICKET_URL, external: true },
    ]);
  });

  it("lists what was switched on and did not run, with the reason while it is held", () => {
    const plan = mergedPlan({
      backAnnotateEpic: true,
      epicId: "5eed001f-0000-4000-8000-000000000001",
    });
    const sha = plan.mergedResult!.sha;
    const held = stateBanner(mergedPage({ plan }), {
      sha,
      failedActions: [{ action: "back_annotate_epic", detail: "The roadmap refused the note." }],
    });

    expect(held?.skipped).toEqual([
      {
        action: "back_annotate_epic",
        label: "back-annotate the roadmap",
        detail: "The roadmap refused the note.",
      },
    ]);
    // After a reload the answer is gone: the action is still listed, without a reason.
    expect(stateBanner(mergedPage({ plan }), null)?.skipped[0]?.detail).toBeNull();
  });

  it("says so when the merge ran nothing afterwards", () => {
    const plan = mergedPlan({
      closeTicket: false,
      commentEvidence: false,
      deleteBranch: false,
      mergedResult: { ...mergedPlan().mergedResult!, actionsExecuted: [] },
    });

    expect(stateBanner(mergedPage({ plan }), null)?.lines[0]).toBe(
      "The merge ran no action afterwards.",
    );
  });

  it("never repeats a [bot] the schema forbids", () => {
    const plan = mergedPlan({
      mergedResult: { ...mergedPlan().mergedResult!, identityUsed: "ouroboros-app[bot]" },
    });

    expect(stateBanner(mergedPage({ plan }), null)?.headline).toBe(
      "Merged — 9c4ab7f, as configured token",
    );
  });

  it("is drawn from the plan before the host's mirror has caught up", () => {
    // The plan recorded the merge; the PR still reads `armed` until the next sync.
    const racing = readyPage({ pullRequest: { state: "armed" }, plan: mergedPlan() });

    expect(stateBanner(racing, null)?.kind).toBe("merged");
  });
});

describe("the merged-elsewhere banner", () => {
  it("names who the host says merged it, and that this plan recorded nothing", () => {
    const banner = stateBanner(
      prPage({
        pullRequest: {
          state: "merged",
          mergedAt: "2026-09-27T15:02:11.000Z",
          mergedBy: "priya-n",
        },
      }),
      null,
    );

    expect(banner).toMatchObject({
      kind: "merged_elsewhere",
      tone: "ok",
      headline: "Merged on its host, by priya-n",
      moment: { at: "2026-09-27T15:02:11.000Z", text: "15:02:11" },
      lines: [NOT_THIS_PLAN, NOW_A_RECORD],
    });
  });

  it("names nobody and no moment when the host gave neither", () => {
    const banner = stateBanner(prPage({ pullRequest: { state: "merged" } }), null);

    expect(banner?.headline).toBe("Merged on its host");
    expect(banner?.moment).toBeNull();
  });
});

describe("the closed banner", () => {
  it("is a record of a PR that did not merge, in no outcome's hue", () => {
    expect(stateBanner(closedPage(), null)).toMatchObject({
      kind: "closed",
      tone: "neutral",
      headline: CLOSED_HEADLINE,
      moment: null,
      lines: ["PR #514 was closed on its host, and nothing was merged.", NOW_A_RECORD],
      skipped: [],
    });
  });

  it("says closed of a PR closed while armed, not armed", () => {
    expect(stateBanner(closedPage({ plan: armedPlan() }), null)?.kind).toBe("closed");
  });
});

describe("the disarmed banner", () => {
  /** Every code that disarms, with the headline it must be told apart by. */
  const REFUSALS: readonly [PrMergeRefusalCode, string][] = [
    ["gate_red", "Disarmed — A gate went red"],
    ["head_moved", "Disarmed — The head moved"],
    ["host_head_moved", "Disarmed — The host has a commit that is not verified yet"],
    ["host_conflict", "Disarmed — The host reports a conflict"],
    ["host_not_open", "Disarmed — The PR is no longer open on its host"],
    ["host_refused", "Disarmed — The host refused the merge"],
  ];

  it("names which re-check failed — a headline of its own for every code", () => {
    const headlines = REFUSALS.map(([code, headline]) => {
      const banner = stateBanner(
        prPage({ plan: mergePlan({ disarmReason: { code, message: "The service's sentence." } }) }),
        null,
      );

      expect(banner?.headline, code).toBe(headline);
      expect(banner?.tone, code).toBe("err");

      return banner?.headline;
    });

    expect(new Set(headlines).size).toBe(REFUSALS.length);
  });

  it("carries the service's own sentence, that nothing merged, and what to do next", () => {
    expect(stateBanner(disarmedPage(), null)?.lines).toEqual([
      HOST_CONFLICT_MESSAGE,
      `${NOTHING_MERGED} Resolve it on the host, or return the PR to the loop, then arm again.`,
    ]);
  });

  it("names the gate that went red after arming — the TOCTOU case", () => {
    const banner = stateBanner(
      blockedPage({
        plan: mergePlan({ disarmReason: { code: "gate_red", message: GATE_RED_MESSAGE } }),
      }),
      null,
    );

    expect(banner?.headline).toBe("Disarmed — A gate went red");
    expect(banner?.lines[0]).toBe(GATE_RED_MESSAGE);
    expect(banner?.lines[1]).toContain(NOTHING_MERGED);
  });

  it("leads to the Merge plan card, on this page", () => {
    expect(stateBanner(disarmedPage(), null)?.links).toEqual([
      { label: MERGE_PLAN_TITLE, href: `#${MERGE_PLAN_ID}`, external: false },
    ]);
  });

  it("is gone once the plan is armed again, and after a disarm by hand", () => {
    expect(stateBanner(prPage({ pullRequest: { state: "armed" }, plan: armedPlan() }), null)).toBeNull();
    expect(stateBanner(prPage({ plan: mergePlan({ disarmReason: null }) }), null)).toBeNull();
  });
});

describe("a PR that states itself in the head", () => {
  it("has no banner while it is open, verifying, blocked or armed", () => {
    const states: readonly PullRequestState[] = ["open", "verifying", "blocked"];

    for (const state of states) {
      expect(stateBanner(prPage({ pullRequest: { state } }), null), state).toBeNull();
    }
    expect(stateBanner(prPage({ pullRequest: { state: "armed" }, plan: armedPlan() }), null)).toBeNull();
  });
});

describe("the host's links", () => {
  it("leaves out a URL a link may not carry, rather than drawing it", () => {
    const head = prHeadOf({
      url: "javascript:alert(1)",
      ticket: { ...prHeadOf().ticket!, url: "ftp://tracker.example/482" },
    });

    expect(hostLinks(head)).toEqual([]);
  });

  it("links the PR alone when it closes no ticket", () => {
    expect(hostLinks(prHeadOf({ ticket: null }))).toEqual([
      { label: "PR #514 on its host", href: HOST_URL, external: true },
    ]);
  });
});

describe("a sync that has gone quiet", () => {
  /** The head, last synced this long before {@link NOW}. */
  function synced(agoMs: number, state: PullRequestState = "verifying") {
    return prHeadOf({ state, syncedAt: new Date(NOW - agoMs).toISOString() });
  }

  it("is ten minutes — twice the tracker sync's cadence", () => {
    expect(PR_SYNC_LAG_AFTER_SECONDS).toBe(600);
  });

  it("is not said of a PR synced inside the threshold, and is said at it", () => {
    expect(syncLag(synced(AFTER - 1000), NOW)).toBeNull();
    expect(syncLag(synced(AFTER), NOW)).toEqual({ kind: "stale", sinceMs: NOW - AFTER });
    expect(syncLag(synced(AFTER + 60_000), NOW)).toEqual({
      kind: "stale",
      sinceMs: NOW - AFTER - 60_000,
    });
  });

  it("says never of a PR no sync has written — the seed's #514", () => {
    expect(syncLag(prHeadOf({ syncedAt: null }), NOW)).toEqual({ kind: "never" });
  });

  it("is said of every state the host can still change", () => {
    for (const state of ["open", "verifying", "blocked", "armed"] as const) {
      expect(syncLag(synced(AFTER, state), NOW)?.kind, state).toBe("stale");
      expect(syncLag(prHeadOf({ state, syncedAt: null }), NOW)?.kind, state).toBe("never");
    }
  });

  it("is never said of a finished PR, which is supposed to be quiet", () => {
    for (const state of ["merged", "closed"] as const) {
      expect(syncLag(synced(AFTER * 100, state), NOW), state).toBeNull();
      expect(syncLag(prHeadOf({ state, syncedAt: null }), NOW), state).toBeNull();
    }
  });

  it("reports what it cannot know as nothing, never as late", () => {
    // A service one release behind sends no stamp at all.
    const behind: Partial<ReturnType<typeof prHeadOf>> = prHeadOf();
    delete behind.syncedAt;

    expect(syncLag(behind as ReturnType<typeof prHeadOf>, NOW)).toBeNull();
    expect(syncLag(prHeadOf({ syncedAt: "not a date" }), NOW)).toBeNull();
  });

  it("is not said before the clock has been read — the hydration pass", () => {
    expect(syncLag(synced(AFTER * 2), 0)).toBeNull();
  });

  it("takes the threshold it is given", () => {
    expect(syncLag(synced(90_000), NOW, 60)?.kind).toBe("stale");
    expect(syncLag(synced(30_000), NOW, 60)).toBeNull();
  });
});

describe("the sync-lag banner's words", () => {
  it("names the time of a sync of the same day", () => {
    const since = Date.parse("2026-09-27T14:02:41.000Z");

    expect(syncedWhen(since, NOW)).toBe("at 14:02");
    expect(syncLagHeadline({ kind: "stale", sinceMs: since }, 514, NOW)).toBe(
      "Last synced with its host at 14:02 — PR #514's sync has gone quiet.",
    );
  });

  it("names the day as well once it is not today's — a time alone would read as today", () => {
    const since = Date.parse("2026-09-25T23:58:00.000Z");

    expect(syncedWhen(since, NOW)).toBe("on 2026-09-25 at 23:58");
    expect(syncLagHeadline({ kind: "stale", sinceMs: since }, 514, NOW)).toBe(
      "Last synced with its host on 2026-09-25 at 23:58 — PR #514's sync has gone quiet.",
    );
  });

  it("says never, and claims no time, of a PR no sync has written", () => {
    const headline = syncLagHeadline({ kind: "never" }, 514, NOW);

    expect(headline).toBe("PR #514 has never been synced with its host.");
    expect(headline).not.toMatch(/\d{2}:\d{2}/);
  });

  it("names every cause it cannot rule out, and what may be out of date", () => {
    expect(syncLagReason({ kind: "stale", sinceMs: NOW - AFTER })).toBe(SYNC_LAG_REASON);
    expect(SYNC_LAG_REASON).toContain("unreachable");
    expect(SYNC_LAG_REASON).toContain("credential");
    expect(SYNC_LAG_REASON).toContain("stalled");
    expect(SYNC_LAG_REASON).toContain("may be out of date");
    expect(syncLagReason({ kind: "never" })).toBe(NEVER_SYNCED_REASON);
  });
});
