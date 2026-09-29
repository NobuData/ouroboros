import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PullRequestPage } from "@/app/api/pull-requests";
import type { PollAnswer } from "@/app/poll";
import {
  ADD_CLAIM_LABEL,
  ATTACH_LABEL,
  CRITERIA_TITLE,
  IMPORT_LABEL,
  VERIFY_LABEL,
  WAIVE_AGAIN_LABEL,
  WAIVE_LABEL,
} from "@/app/prs/criteria";
import {
  APPROVE_LABEL,
  AWAITS_APPROVER,
  DECLINE_LABEL,
  GATES_FINAL_CLOSED,
  GATES_FINAL_MERGED,
  GATES_TITLE,
  REQUEST_LABEL,
} from "@/app/prs/gates";
import { DISARM_LABEL, MERGE_PLAN_ID, MERGE_PLAN_TITLE } from "@/app/prs/merge-plan";
import type { PrPollOptions } from "@/app/prs/poll";
import {
  PR_LOADING_LABEL,
  PrLoading,
  SKELETON_CARD_ROWS,
  SKELETON_GATES,
  SKELETON_STEPS,
} from "@/app/prs/pr-loading";
import { PrScreen } from "@/app/prs/pr-screen";
import { SKIPPED_LABEL } from "@/app/prs/pr-state-banner";
import {
  CLOSED_HEADLINE,
  NEVER_SYNCED_REASON,
  NOT_THIS_PLAN,
  NOW_A_RECORD,
  PR_SYNC_LAG_AFTER_SECONDS,
  STATE_BANNER_LABEL,
  SYNC_LAG_REASON,
  SYNC_LAG_RETRY,
} from "@/app/prs/states";
import { THREAD_TITLE } from "@/app/prs/thread";
import {
  ACTIONS_LABEL,
  MERGE_LABEL,
  PR_EYEBROW,
  RETURN_LABEL,
  REVIEW_LABEL,
  STALE_HEADLINE,
} from "@/app/prs/view";
import { DASHBOARD_ORIGIN } from "@/app/runs/origin";

import {
  GATE_RED_MESSAGE,
  HOST_CONFLICT_MESSAGE,
  HOST_URL,
  PR_514_ID,
  TICKET_URL,
  armedPlan,
  blockedPage,
  closedPage,
  disarmedPage,
  matrixPage,
  mergePlan,
  mergedPage,
  mergedPlan,
  prPage,
  review,
  revisionOne,
  revisionTwo,
  stripPage,
  threadPage,
} from "../helpers/pull-requests";

/**
 * The PR page's states besides *mid-verification* (#370), rendered through the whole screen: a
 * merged PR and its receipt, a closed one, a plan a re-check disarmed, a blocked PR, a sync gone
 * quiet, who is reading, and the skeleton.
 */

// The Server Actions are never reached here: no case sends anything.
vi.mock("@/app/prs/head-actions", () => ({
  decideApproval: vi.fn(),
  requestHumanReview: vi.fn(),
  returnToLoop: vi.fn(),
}));
vi.mock("@/app/prs/criteria-actions", () => ({
  addClaim: vi.fn(),
  attachEvidence: vi.fn(),
  importFromPlan: vi.fn(),
  readEvidenceOptions: vi.fn(),
  verifyClaim: vi.fn(),
  waiveClaim: vi.fn(),
}));
vi.mock("@/app/prs/thread-actions", () => ({
  resolveEntry: vi.fn(),
}));
vi.mock("@/app/prs/merge-actions", () => ({
  armPlan: vi.fn(),
  disarmPlan: vi.fn(),
  editPlan: vi.fn(),
  mergeNow: vi.fn(),
}));

/** 14:50 on the day the helper's PR was opened — after its merge, its arm and its pushes. */
const NOW = Date.parse("2026-09-27T14:50:00.000Z");

/** The sync-lag threshold, in milliseconds. */
const AFTER = PR_SYNC_LAG_AFTER_SECONDS * 1000;

/** A poll that never answers — the page shows the server's first read. */
const QUIET: PrPollOptions = { read: () => new Promise(() => {}), visible: () => true };

/**
 * A poll that answers one value, fresh.
 *
 * @param payload The page.
 * @returns The options.
 */
function answering(payload: PullRequestPage): PrPollOptions {
  const answer: PollAnswer<PullRequestPage> = {
    state: "fresh",
    payload,
    etag: null,
    pollAfterSeconds: null,
  };

  return { read: () => Promise.resolve(answer), visible: () => true };
}

/**
 * A poll that fails.
 *
 * @param reason Why.
 * @returns The options.
 */
function failing(reason: string): PrPollOptions {
  const answer: PollAnswer<PullRequestPage> = { state: "failed", reason, pollAfterSeconds: null };

  return { read: () => Promise.resolve(answer), visible: () => true };
}

/**
 * Draw the screen, as an owner unless told otherwise.
 *
 * @param initial The server's first read.
 * @param options Who is reading, and the poll.
 * @returns The Testing Library render result.
 */
function draw(
  initial: PullRequestPage,
  options: {
    mayContribute?: boolean;
    mayArm?: boolean;
    mayWaive?: boolean;
    mayApprove?: boolean;
    poll?: PrPollOptions;
  } = {},
) {
  return render(
    <PrScreen
      initial={initial}
      initialError={null}
      mayApprove={options.mayApprove ?? true}
      mayArm={options.mayArm ?? true}
      mayContribute={options.mayContribute ?? true}
      mayWaive={options.mayWaive ?? true}
      origin={DASHBOARD_ORIGIN}
      poll={options.poll ?? QUIET}
      prId={PR_514_ID}
      readAt={NOW}
    />,
  );
}

/** The state banner. */
function banner() {
  return screen.getByRole("status", { name: STATE_BANNER_LABEL });
}

/** The state banner, or `null`. */
function noBanner() {
  return screen.queryByRole("status", { name: STATE_BANNER_LABEL });
}

/**
 * A card, by its title.
 *
 * @param title The card's title.
 * @returns The region.
 */
function card(title: string) {
  return screen.getByRole("region", { name: title });
}

/** Every control the criteria matrix authors with. */
const AUTHORING = [
  ADD_CLAIM_LABEL,
  IMPORT_LABEL,
  ATTACH_LABEL,
  VERIFY_LABEL,
  WAIVE_LABEL,
  WAIVE_AGAIN_LABEL,
] as const;

/**
 * Require that the matrix offers no authoring. A hunk reference is still a button: it is
 * navigation, to the changed files on this page.
 */
function expectNoAuthoring(): void {
  const matrix = within(card(CRITERIA_TITLE));

  for (const label of AUTHORING) {
    expect(matrix.queryByRole("button", { name: label }), label).toBeNull();
  }
}

/** The labels of the head's actions, in the order they are drawn. */
function actionsDrawn(): (string | null)[] {
  const group = screen.queryByRole("group", { name: ACTIONS_LABEL });

  return group === null
    ? []
    : within(group)
        .getAllByRole("button")
        .map((button) => button.textContent);
}

/**
 * The page synced this long ago.
 *
 * @param agoMs How long before {@link NOW}.
 * @param over What else to change.
 * @returns The page.
 */
function syncedAgo(agoMs: number, over: Parameters<typeof prPage>[0] = {}): PullRequestPage {
  return prPage({
    ...over,
    pullRequest: { syncedAt: new Date(NOW - agoMs).toISOString(), ...over.pullRequest },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("a merged PR", () => {
  it("opens with its receipt — which sha, as whom, when, and which actions ran", () => {
    draw(mergedPage());

    expect(banner()).toHaveTextContent("Merged — 9c4ab7f, as ken-s");
    expect(within(banner()).getByText("14:45:02")).toHaveAttribute(
      "dateTime",
      "2026-09-27T14:45:02.000Z",
    );
    expect(banner()).toHaveTextContent(
      "Ran: closed issue #482 · commented the evidence summary · deleted the branch.",
    );
    expect(banner()).toHaveTextContent(NOW_A_RECORD);
    expect(banner()).toHaveClass("prv-state--ok");
  });

  it("says it before the head, so nobody scrolls to learn that it merged", () => {
    draw(mergedPage());

    expect(
      banner().compareDocumentPosition(screen.getByRole("heading", { level: 1 })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("links the PR and the ticket on their host, in a new tab", () => {
    draw(mergedPage());

    const pr = within(banner()).getByRole("link", { name: "PR #514 on its host ↗" });
    const ticket = within(banner()).getByRole("link", { name: "issue #482 on its tracker ↗" });

    expect(pr).toHaveAttribute("href", HOST_URL);
    expect(ticket).toHaveAttribute("href", TICKET_URL);
    for (const link of [pr, ticket]) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("offers no arm affordance — not in the head, and not on the card", () => {
    draw(mergedPage());

    expect(screen.queryByRole("group", { name: ACTIONS_LABEL })).toBeNull();
    expect(screen.queryByRole("button", { name: MERGE_LABEL })).toBeNull();
    expect(screen.queryByRole("button", { name: /merge now/i })).toBeNull();
    expect(screen.queryByRole("button", { name: DISARM_LABEL })).toBeNull();
    expect(within(card(MERGE_PLAN_TITLE)).queryAllByRole("button")).toHaveLength(0);
    expect(within(card(MERGE_PLAN_TITLE)).queryByRole("textbox")).toBeNull();
    for (const toggle of within(card(MERGE_PLAN_TITLE)).getAllByRole("switch")) {
      expect(toggle).toHaveAttribute("aria-disabled", "true");
    }
  });

  it("freezes the gates at their final verdicts, with nothing to request or answer", () => {
    draw(mergedPage({ review: review() }));

    const gates = within(card(GATES_TITLE));

    expect(gates.getByText(GATES_FINAL_MERGED)).toBeInTheDocument();
    expect(gates.queryByRole("button", { name: APPROVE_LABEL })).toBeNull();
    expect(gates.queryByRole("button", { name: DECLINE_LABEL })).toBeNull();
    expect(gates.queryByRole("button", { name: REQUEST_LABEL })).toBeNull();
    expect(gates.queryByText(AWAITS_APPROVER)).toBeNull();
  });

  it("leaves the strip without a future step and without a live one", () => {
    draw(mergedPage({ revisions: [revisionOne(), revisionTwo()] }));

    expect(document.querySelector(".prv-step--ghosted")).toBeNull();
    expect(document.querySelector(".prv-step--armed")).toBeNull();
    expect(document.querySelector(".prv-step--live")).toBeNull();
  });

  it("offers the matrix no authoring: the claims are what was claimed and shown", () => {
    draw(mergedPage({ ...matrixPage(), pullRequest: { state: "merged" }, plan: mergedPlan() }));

    expect(within(card(CRITERIA_TITLE)).getAllByRole("listitem").length).toBeGreaterThan(0);
    expectNoAuthoring();
  });

  it("offers the same matrix its authoring while the PR is open — the control for the above", () => {
    draw(matrixPage({ criteria: { ...matrixPage().criteria, planContext: true } }));

    const matrix = within(card(CRITERIA_TITLE));

    expect(matrix.getByRole("button", { name: ADD_CLAIM_LABEL })).toBeInTheDocument();
    expect(matrix.getByRole("button", { name: IMPORT_LABEL })).toBeInTheDocument();
    expect(matrix.getAllByRole("button", { name: ATTACH_LABEL }).length).toBeGreaterThan(0);
    expect(matrix.getAllByRole("button", { name: /^Waive/ }).length).toBeGreaterThan(0);
  });

  it("keeps reply and resolve on the thread, which is this plane's record (#368)", () => {
    const open = threadPage();
    const entries = open.thread.entries.map((entry, index) =>
      index === 0 ? { ...entry, resolved: false, resolutionBody: null } : entry,
    );

    draw(
      mergedPage({
        thread: { ...open.thread, entries, openCount: 1 },
        revisions: open.revisions,
      }),
    );

    expect(within(card(THREAD_TITLE)).getAllByRole("button").length).toBeGreaterThan(0);
  });

  it("lists what was switched on and did not run", () => {
    draw(
      mergedPage({
        plan: mergedPlan({
          backAnnotateEpic: true,
          epicId: "5eed001f-0000-4000-8000-000000000001",
        }),
      }),
    );

    expect(
      within(within(banner()).getByRole("list", { name: SKIPPED_LABEL }))
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual(["Did not run: back-annotate the roadmap"]);
  });

  it("is drawn the moment the poll says so, without a reload", async () => {
    draw(prPage({ pullRequest: { state: "armed" }, plan: armedPlan() }), {
      poll: answering(mergedPage()),
    });

    expect(await screen.findByRole("status", { name: STATE_BANNER_LABEL })).toHaveTextContent(
      "Merged — 9c4ab7f, as ken-s",
    );
    expect(screen.queryByRole("group", { name: ACTIONS_LABEL })).toBeNull();
    expect(screen.queryByRole("button", { name: DISARM_LABEL })).toBeNull();
  });

  it("says who merged it on the host when this plan did not", () => {
    draw(
      prPage({
        pullRequest: {
          state: "merged",
          mergedAt: "2026-09-27T15:02:11.000Z",
          mergedBy: "priya-n",
        },
      }),
    );

    expect(banner()).toHaveTextContent("Merged on its host, by priya-n");
    expect(banner()).toHaveTextContent(NOT_THIS_PLAN);
    expect(screen.queryByRole("group", { name: ACTIONS_LABEL })).toBeNull();
  });
});

describe("a PR closed without merging", () => {
  it("is a terminal record, in no outcome's hue", () => {
    draw(closedPage());

    expect(banner()).toHaveTextContent(CLOSED_HEADLINE);
    expect(banner()).toHaveTextContent("PR #514 was closed on its host, and nothing was merged.");
    expect(banner()).toHaveTextContent(NOW_A_RECORD);
    expect(banner()).toHaveClass("prv-state--neutral");
    expect(banner()).not.toHaveClass("prv-state--ok");
    expect(within(banner()).getByRole("link", { name: "PR #514 on its host ↗" })).toHaveAttribute(
      "href",
      HOST_URL,
    );
  });

  it("offers no verification affordance: nothing to arm, waive, approve, return or claim", () => {
    draw(
      closedPage({
        ...matrixPage(),
        pullRequest: { state: "closed" },
        review: review(),
        revisions: blockedPage().revisions,
        gates: blockedPage().gates,
      }),
    );

    expect(screen.queryByRole("group", { name: ACTIONS_LABEL })).toBeNull();
    expect(within(card(GATES_TITLE)).getByText(GATES_FINAL_CLOSED)).toBeInTheDocument();
    expect(within(card(GATES_TITLE)).queryAllByRole("button")).toHaveLength(0);
    expectNoAuthoring();
    expect(within(card(MERGE_PLAN_TITLE)).queryAllByRole("button")).toHaveLength(0);
    for (const label of [MERGE_LABEL, RETURN_LABEL, REVIEW_LABEL, APPROVE_LABEL]) {
      expect(screen.queryByRole("button", { name: label }), label).toBeNull();
    }
  });
});

describe("a plan a re-check disarmed", () => {
  it("names which re-check failed, in the service's words, and what to do next", () => {
    draw(disarmedPage());

    expect(banner()).toHaveTextContent("Disarmed — The host reports a conflict");
    expect(banner()).toHaveTextContent(HOST_CONFLICT_MESSAGE);
    expect(banner()).toHaveTextContent(
      "Nothing was merged. Resolve it on the host, or return the PR to the loop, then arm again.",
    );
    expect(banner()).toHaveClass("prv-state--err");
  });

  it("tells a moved head from a red gate from a refusal — never just that one failed", () => {
    const cases = [
      ["head_moved", "Disarmed — The head moved"],
      ["gate_red", "Disarmed — A gate went red"],
      ["host_refused", "Disarmed — The host refused the merge"],
    ] as const;

    for (const [code, headline] of cases) {
      const page = prPage({ plan: mergePlan({ disarmReason: { code, message: "Why." } }) });
      const { unmount } = draw(page);

      expect(banner(), code).toHaveTextContent(headline);
      unmount();
    }
  });

  it("leads to the Merge plan card, where it can be armed again", () => {
    draw(disarmedPage());

    expect(
      within(banner()).getByRole("link", { name: `${MERGE_PLAN_TITLE} →` }),
    ).toHaveAttribute("href", `#${MERGE_PLAN_ID}`);
    // Disarmed is not finished: the head still offers its actions.
    expect(actionsDrawn()).toEqual([REVIEW_LABEL, RETURN_LABEL, MERGE_LABEL]);
  });

  it("says a gate went red after arming, on the PR that gate now blocks — the TOCTOU case", () => {
    draw(
      blockedPage({
        plan: mergePlan({ disarmReason: { code: "gate_red", message: GATE_RED_MESSAGE } }),
      }),
    );

    expect(banner()).toHaveTextContent("Disarmed — A gate went red");
    expect(banner()).toHaveTextContent(GATE_RED_MESSAGE);
    expect(banner()).toHaveTextContent("Nothing was merged.");
    // And nothing on the page says otherwise: no receipt, no merged pill.
    expect(screen.queryByText(/^Merged/)).toBeNull();
    expect(actionsDrawn()[0]).toBe(RETURN_LABEL);
  });

  it("is drawn the moment the poll says so, for whoever armed and came back", async () => {
    draw(prPage({ pullRequest: { state: "armed" }, plan: armedPlan() }), {
      poll: answering(disarmedPage()),
    });

    expect(await screen.findByRole("status", { name: STATE_BANNER_LABEL })).toHaveTextContent(
      "Disarmed — The host reports a conflict",
    );
  });
});

describe("a blocked PR", () => {
  it("leads with Return to loop, and draws the merge last and not as the primary", () => {
    draw(blockedPage());

    expect(actionsDrawn()).toEqual([RETURN_LABEL, REVIEW_LABEL, MERGE_LABEL]);

    const group = within(screen.getByRole("group", { name: ACTIONS_LABEL }));

    expect(group.getByRole("button", { name: RETURN_LABEL })).not.toHaveAttribute("aria-disabled");
    expect(group.getByRole("button", { name: MERGE_LABEL })).not.toHaveClass("ou-btn--primary");
  });

  it("disables the merge with its reason, said under the row as well as on the button", () => {
    draw(blockedPage());

    const reason = "2 gates are red on revision 2 — a blocked PR cannot be armed.";
    const group = within(screen.getByRole("group", { name: ACTIONS_LABEL }));
    const merge = group.getByRole("button", { name: MERGE_LABEL });

    expect(merge).toHaveAttribute("aria-disabled", "true");
    expect(merge).toHaveAccessibleDescription(reason);
    expect(group.getByText(reason)).toBeInTheDocument();
  });

  it("keeps the mockup's order, and the merge as the primary, on a PR that is not blocked", () => {
    draw(prPage());

    expect(actionsDrawn()).toEqual([REVIEW_LABEL, RETURN_LABEL, MERGE_LABEL]);
    expect(
      within(screen.getByRole("group", { name: ACTIONS_LABEL })).getByRole("button", {
        name: MERGE_LABEL,
      }),
    ).toHaveClass("ou-btn--primary");
  });

  it("emphasises the gates it is blocked by, and only those", () => {
    draw(blockedPage({ revisions: [revisionOne(), blockedRevisionTwo()] }));

    expect(
      [...document.querySelectorAll(".prv-gate--blocking .prv-gate__name")].map(
        (name) => name.textContent,
      ),
    ).toEqual(["Test suite", "Physical HIL"]);
    expect(document.querySelectorAll(".prv-gate--red")).toHaveLength(2);
  });

  it("does not emphasise an earlier revision's red gates — those are history", () => {
    render(
      <PrScreen
        initial={blockedPage({ revisions: [revisionOne(), blockedRevisionTwo()] })}
        initialError={null}
        initialRevision={1}
        mayApprove
        mayArm
        mayContribute
        origin={DASHBOARD_ORIGIN}
        poll={QUIET}
        prId={PR_514_ID}
        readAt={NOW}
      />,
    );

    expect(document.querySelectorAll(".prv-gate--red").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".prv-gate--blocking")).toHaveLength(0);
  });

  it("has no state banner — a blocked PR says so in the head", () => {
    draw(blockedPage());

    expect(noBanner()).toBeNull();
    expect(document.querySelector(".prv-head__meta .ou-chip")).toHaveTextContent(/^blocked/);
  });
});

describe("the sync-lag banner", () => {
  /** The banner's headline for a PR last synced ten minutes before {@link NOW}. */
  const HEADLINE = "Last synced with its host at 14:40 — PR #514's sync has gone quiet.";

  it("appears once the sync goes stale, stating the last-synced time", () => {
    draw(syncedAgo(AFTER - 2000));
    expect(screen.queryByText(HEADLINE)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByText(HEADLINE)).toBeInTheDocument();
    expect(screen.getByText(SYNC_LAG_REASON)).toBeInTheDocument();
  });

  it("is not drawn for a PR the host was just asked about", () => {
    draw(syncedAgo(30_000));

    expect(screen.queryByRole("button", { name: SYNC_LAG_RETRY })).toBeNull();
  });

  it("says never of a PR no sync has written, and claims no time", () => {
    draw(prPage({ pullRequest: { syncedAt: null } }));

    expect(screen.getByText("PR #514 has never been synced with its host.")).toBeInTheDocument();
    expect(screen.getByText(NEVER_SYNCED_REASON)).toBeInTheDocument();
  });

  it("reads the page again when pressed", () => {
    const read = vi.fn(() => new Promise<PollAnswer<PullRequestPage>>(() => {}));
    draw(syncedAgo(AFTER * 2), { poll: { read, visible: () => true } });
    const asked = read.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: SYNC_LAG_RETRY }));

    expect(read.mock.calls.length).toBeGreaterThan(asked);
  });

  it("clears on its own once a sync is read", async () => {
    draw(syncedAgo(AFTER * 2), { poll: answering(syncedAgo(1000)) });

    expect(await screen.findByText(PR_EYEBROW, { exact: false })).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(screen.queryByRole("button", { name: SYNC_LAG_RETRY })).toBeNull();
    });
  });

  it("is never drawn for a merged or a closed PR, which is supposed to be quiet", () => {
    for (const page of [
      mergedPage({ pullRequest: { syncedAt: null } }),
      closedPage({ pullRequest: { syncedAt: new Date(NOW - AFTER * 100).toISOString() } }),
    ]) {
      const { unmount } = draw(page);

      act(() => {
        vi.advanceTimersByTime(AFTER);
      });

      expect(screen.queryByRole("button", { name: SYNC_LAG_RETRY })).toBeNull();
      unmount();
    }
  });

  it("gives way to a failed refresh's banner", async () => {
    draw(syncedAgo(AFTER * 2), { poll: failing("The service is down.") });

    expect(await screen.findByText(STALE_HEADLINE)).toBeInTheDocument();
    expect(screen.queryByText(/has gone quiet/)).toBeNull();
    expect(screen.queryByRole("button", { name: SYNC_LAG_RETRY })).toBeNull();
  });

  it("is drawn above a disarmed plan's banner, each said once", () => {
    draw(disarmedPage({ pullRequest: { syncedAt: null } }));

    const lag = screen.getByText("PR #514 has never been synced with its host.");

    expect(lag.compareDocumentPosition(banner()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("status", { name: STATE_BANNER_LABEL })).toHaveLength(1);
  });
});

describe("who is reading", () => {
  /** The page with a review waiting on Revision 2. */
  const waiting = () => stripPage({ review: review() });

  it("offers an owner or admin the answer to a waiting approval", () => {
    draw(waiting());

    const gates = within(card(GATES_TITLE));

    expect(gates.getByRole("button", { name: APPROVE_LABEL })).toBeInTheDocument();
    expect(gates.getByRole("button", { name: DECLINE_LABEL })).toBeInTheDocument();
    expect(gates.queryByText(AWAITS_APPROVER)).toBeNull();
  });

  it("draws a member no arm, no waive and no approve — and says who the approval waits for", () => {
    draw(
      { ...matrixPage(), ...pick(waiting()) },
      { mayArm: false, mayWaive: false, mayApprove: false },
    );

    const gates = within(card(GATES_TITLE));

    expect(gates.queryByRole("button", { name: APPROVE_LABEL })).toBeNull();
    expect(gates.queryByRole("button", { name: DECLINE_LABEL })).toBeNull();
    expect(gates.getByText(AWAITS_APPROVER)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: MERGE_LABEL })).toBeNull();
    expect(screen.queryByRole("button", { name: /waive/i })).toBeNull();
    expect(within(card(MERGE_PLAN_TITLE)).queryAllByRole("button")).toHaveLength(0);
  });

  it("still lets a member contribute: request a review, return to the loop, add a claim", () => {
    draw(blockedPage({ revisions: [revisionOne(), blockedRevisionTwo()] }), {
      mayArm: false,
      mayWaive: false,
      mayApprove: false,
    });

    expect(actionsDrawn()).toEqual([RETURN_LABEL, REVIEW_LABEL]);
    expect(
      within(card(GATES_TITLE)).getByRole("button", { name: REQUEST_LABEL }),
    ).toBeInTheDocument();
    expect(
      within(card(CRITERIA_TITLE)).getByRole("button", { name: ADD_CLAIM_LABEL }),
    ).toBeInTheDocument();
  });

  it("lets a member disarm — the safe direction", () => {
    draw(prPage({ pullRequest: { state: "armed" }, plan: armedPlan() }), {
      mayArm: false,
      mayWaive: false,
      mayApprove: false,
    });

    expect(
      within(card(MERGE_PLAN_TITLE)).getByRole("button", { name: DISARM_LABEL }),
    ).toBeInTheDocument();
  });

  it("draws a viewer the states and nothing to press on them", () => {
    draw(disarmedPage({ review: review() }), {
      mayContribute: false,
      mayArm: false,
      mayWaive: false,
      mayApprove: false,
    });

    expect(banner()).toHaveTextContent("Disarmed — The host reports a conflict");
    expect(screen.queryByRole("group", { name: ACTIONS_LABEL })).toBeNull();
    expect(within(card(GATES_TITLE)).queryAllByRole("button")).toHaveLength(0);
    expect(within(card(GATES_TITLE)).queryByText(AWAITS_APPROVER)).toBeNull();
  });
});

describe("the skeleton", () => {
  it("says loading once, on the landmark, and hides its bars from the accessibility tree", () => {
    render(<PrLoading />);

    const main = screen.getByRole("main", { name: PR_LOADING_LABEL });

    expect(main).toHaveAttribute("aria-busy", "true");
    expect(within(main).getByText(PR_EYEBROW)).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    for (const bar of main.querySelectorAll(".prv-skeleton__bar, .prv-skeleton__step")) {
      expect(bar.closest("[aria-hidden]"), bar.className).not.toBeNull();
    }
  });

  it("draws the head, the strip, the gates and the cards at their own geometry", () => {
    render(<PrLoading />);

    expect(document.querySelectorAll(".prv-skeleton__bar--title")).toHaveLength(1);
    expect(document.querySelectorAll(".prv-skeleton__bar--meta")).toHaveLength(1);
    expect(document.querySelectorAll(".prv-skeleton__step")).toHaveLength(SKELETON_STEPS);

    const cards = [...document.querySelectorAll(".prv-skeleton__card")];

    // The strip, the gates, then criteria, files, thread, merge plan and spend.
    expect(cards).toHaveLength(2 + SKELETON_CARD_ROWS.length);
    expect(cards.map((each) => each.querySelectorAll(".prv-skeleton__bar--row").length)).toEqual([
      0,
      SKELETON_GATES,
      ...SKELETON_CARD_ROWS,
    ]);
    for (const each of cards) {
      expect(each.querySelectorAll(".prv-skeleton__bar--heading")).toHaveLength(1);
    }
  });

  it("offers nothing to press", () => {
    render(<PrLoading />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

/**
 * Revision 2 with the blocked page's red rows in its own snapshot — what the gates card draws.
 *
 * @returns The revision.
 */
function blockedRevisionTwo() {
  const two = revisionTwo();
  const blocked = blockedPage().gates!;

  return { ...two, gates: { ...two.gates, aggregate: blocked.aggregate, rows: blocked.rows } };
}

/**
 * The regions of a page that state its revisions, gates and review.
 *
 * @param page The page.
 * @returns Those regions.
 */
function pick(page: PullRequestPage) {
  return { revisions: page.revisions, gates: page.gates, review: page.review };
}
