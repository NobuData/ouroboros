import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PullRequestPage } from "@/app/api/pull-requests";
import { BUILD_FARM_PATH, runPath } from "@/app/paths";
import type { PollAnswer } from "@/app/poll";
import {
  MERGE_PLAN_ID,
  MERGE_PLAN_TITLE,
  NOTHING_CHOSEN,
  handedOff,
} from "@/app/prs/merge-plan-slot";
import type { ReturnOutcome, ReviewRequestOutcome } from "@/app/prs/outcomes";
import type { PrPollOptions } from "@/app/prs/poll";
import { PR_CRUMB, PrScreen, type ReturnSender, type ReviewSender } from "@/app/prs/pr-screen";
import {
  ACTIONS_LABEL,
  ALREADY_ARMED,
  MERGE_LABEL,
  RECEIPT_LINK,
  RETURN_CANCEL,
  RETURN_GATES_LABEL,
  RETURN_KEEPS,
  RETURN_LABEL,
  RETURN_NEEDS_GATE,
  REVIEW_ALREADY_OPEN,
  REVIEW_LABEL,
  REVIEW_OPENED,
  REVIEW_REQUESTED_LABEL,
  REVIEW_SENDING_LABEL,
  STALE_HEADLINE,
  UNREAD_HEADLINE,
  returnTitle,
  reviewWaiting,
} from "@/app/prs/view";
import { BUILD_FARM_ORIGIN, DASHBOARD_ORIGIN, type RunOrigin } from "@/app/runs/origin";
import { navRegistry } from "@/app/shell/nav-registry";

import {
  HIL_RED,
  HOST_URL,
  PR_514_ID,
  REV_2_ID,
  TESTS_RED,
  TICKET_URL,
  blockedPage,
  prPage,
  returned,
  review,
} from "../helpers/pull-requests";
import { SEEDED_RUN_ID } from "../helpers/runs";

/**
 * The PR verification frame (#363), rendered: the seeded head against mockup 12, the loop and
 * issue links, *Return to loop*'s dialog and its receipt, *Request human review* becoming
 * state-aware, *Merge when all gates green* handing off or saying why it cannot, the actions
 * hidden by role, and the shell's contextual-surface contract.
 */

// The Server Actions are never reached here: the cases that press pass their own senders.
vi.mock("@/app/prs/head-actions", () => ({
  requestHumanReview: vi.fn(),
  returnToLoop: vi.fn(),
}));

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
 * @param options What to pass besides the seed.
 * @returns The Testing Library render result.
 */
function draw(
  options: {
    initial?: PullRequestPage | null;
    initialError?: string | null;
    origin?: RunOrigin;
    mayContribute?: boolean;
    mayArm?: boolean;
    poll?: PrPollOptions;
    sendReview?: ReviewSender;
    sendReturn?: ReturnSender;
  } = {},
) {
  return render(
    <PrScreen
      initial={options.initial === undefined ? prPage() : options.initial}
      initialError={options.initialError ?? null}
      mayArm={options.mayArm ?? true}
      mayContribute={options.mayContribute ?? true}
      origin={options.origin ?? DASHBOARD_ORIGIN}
      poll={options.poll ?? QUIET}
      prId={PR_514_ID}
      replayKey={() => "press-1"}
      sendReturn={options.sendReturn}
      sendReview={options.sendReview}
    />,
  );
}

/** The head's meta row, element by element. */
function meta(): string[] {
  return [...(document.querySelector(".prv-head__meta")?.children ?? [])].map(
    (child) => child.textContent?.trim() ?? "",
  );
}

/** The actions group. */
function actions(): HTMLElement {
  return screen.getByRole("group", { name: ACTIONS_LABEL });
}

/**
 * A head action, by its label.
 *
 * @param name The label.
 * @returns The button.
 */
function action(name: RegExp | string): HTMLElement {
  return within(actions()).getByRole("button", { name });
}

/** The open return dialog. */
function dialog(): HTMLElement {
  return screen.getByRole("alertdialog", { name: returnTitle(514) });
}

/**
 * A sender whose answer the case releases.
 *
 * @returns The sender, how many times it was called, and the release.
 * @typeParam T What it answers.
 */
function held<T>() {
  let release: (value: T) => void = () => undefined;
  const sender = vi.fn(
    () =>
      new Promise<T>((resolve) => {
        release = resolve;
      }),
  );

  return { sender, release: (value: T) => release(value) };
}

describe("the seeded head (mockup 12)", () => {
  it("draws the eyebrow, the headline linked to the host PR, and the meta row in the mockup's order", () => {
    draw();

    expect(screen.getByText("PR Verification · PR #514 · Revision 2")).toBeInTheDocument();

    const headline = screen.getByRole("heading", { level: 1 });
    expect(headline).toHaveTextContent("can: fix flaky telemetry frame order under ISR load");
    expect(within(headline).getByRole("link")).toHaveAttribute("href", HOST_URL);
    expect(within(headline).getByRole("link")).toHaveAttribute("rel", "noopener noreferrer");

    expect(meta()).toEqual([
      "loop #1847 · issue #482",
      "verifying — 5 of 7 gates green",
      "loop/482-canbus-flake → main",
      "+68 −15 · 3 files",
    ]);
  });

  it("colours the aggregate pill warn at 5 of 7", () => {
    draw();

    const pill = document.querySelector(".prv-head__meta .ou-chip");
    expect(pill).toHaveTextContent("verifying — 5 of 7 gates green");
    expect(pill).toHaveClass("ou-chip--warn");
  });

  it("colours the pill err once the PR is blocked", () => {
    draw({ initial: blockedPage() });

    expect(document.querySelector(".prv-head__meta .ou-chip")).toHaveClass("ou-chip--err");
  });

  it("draws the three actions in the mockup's order and treatments", () => {
    draw({ initial: blockedPage({ pullRequest: { state: "verifying" } }) });

    const buttons = within(actions()).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      REVIEW_LABEL,
      RETURN_LABEL,
      MERGE_LABEL,
    ]);
    expect(buttons[0]).toHaveClass("ou-btn--ghost");
    expect(buttons[1]).toHaveClass("ou-btn--danger");
    expect(buttons[2]).toHaveClass("ou-btn--primary");
  });
});

describe("the loop and issue tag", () => {
  it("links the loop to its run console and the issue to its tracker", () => {
    draw({ origin: BUILD_FARM_ORIGIN });

    const tag = document.querySelector(".prv-head__meta .ou-tag") as HTMLElement;
    expect(within(tag).getByRole("link", { name: "loop #1847" })).toHaveAttribute(
      "href",
      runPath(SEEDED_RUN_ID, BUILD_FARM_ORIGIN.id),
    );

    const issue = within(tag).getByRole("link", { name: "issue #482" });
    expect(issue).toHaveAttribute("href", TICKET_URL);
    expect(issue).toHaveAttribute("target", "_blank");
  });

  it("keeps the tag's halves and their separator in one box, so the spaces around the dot survive", () => {
    // The tag is a flex box; a separator that was a flex item of its own would be trimmed to `·`.
    draw();

    const tag = document.querySelector(".prv-head__meta .ou-tag") as HTMLElement;

    expect(tag.children).toHaveLength(1);
    expect(tag.firstElementChild?.textContent).toBe("loop #1847 · issue #482");
    expect(tag.firstElementChild?.querySelectorAll("a")).toHaveLength(2);
  });

  it("resolves the issue link for a tracker that is not GitHub", () => {
    draw({
      initial: prPage({
        pullRequest: {
          ticket: {
            id: "5eed0030-0000-4000-8000-000000000012",
            key: "HEL-12",
            title: "Fix flaky CAN-bus telemetry test",
            url: "https://acme.atlassian.net/browse/HEL-12",
          },
        },
      }),
    });

    expect(screen.getByRole("link", { name: "issue HEL-12" })).toHaveAttribute(
      "href",
      "https://acme.atlassian.net/browse/HEL-12",
    );
  });

  it("draws a PR no loop opened with no tag, and a URL that is not http(s) with no link", () => {
    draw({
      initial: prPage({
        pullRequest: { run: null, ticket: null, url: "javascript:alert(1)" },
      }),
    });

    expect(document.querySelector(".prv-head__meta .ou-tag")).toHaveTextContent(
      "loop/482-canbus-flake → main",
    );
    expect(within(screen.getByRole("heading", { level: 1 })).queryByRole("link")).toBeNull();
  });
});

describe("Return to loop", () => {
  it("is off, with a visible reason, while no gate is red", () => {
    draw();

    const button = action(RETURN_LABEL);
    const reason = "No gate is red on revision 2 — there is nothing to send back.";

    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(within(actions()).getByText(reason)).toBeInTheDocument();
    expect(button).toHaveAccessibleDescription(reason);

    fireEvent.click(button);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("opens a danger dialog listing the red gates with their evidence, all selected", () => {
    draw({ initial: blockedPage() });
    fireEvent.click(action(RETURN_LABEL));

    expect(dialog()).toHaveAccessibleDescription(expect.stringContaining(RETURN_KEEPS));
    expect(dialog()).toHaveAccessibleDescription(expect.stringMatching(/loop #1847/));

    const gates = within(dialog()).getByRole("group", { name: RETURN_GATES_LABEL });
    const boxes = within(gates).getAllByRole("checkbox");

    expect(boxes).toHaveLength(2);
    expect(boxes.every((box) => (box as HTMLInputElement).checked)).toBe(true);
    expect(within(gates).getByRole("checkbox", { name: new RegExp(`Test suite.*${"61/63"}`) })).toBe(
      boxes[0],
    );
    expect(gates).toHaveTextContent(TESTS_RED);
    expect(gates).toHaveTextContent(HIL_RED);
    expect(boxes[0]).toHaveFocus();
    expect(
      within(dialog()).getByRole("button", { name: "Return to loop with 2 gates" }),
    ).toHaveClass("ou-btn--danger");
  });

  it("sends only the gates the reader kept, on the revision they were shown, with the press's key", async () => {
    const sendReturn = vi.fn<ReturnSender>().mockResolvedValue({ ok: true, answer: returned() });
    draw({ initial: blockedPage(), sendReturn });

    fireEvent.click(action(RETURN_LABEL));
    fireEvent.click(within(dialog()).getByRole("checkbox", { name: /Test suite/ }));
    await act(async () => {
      fireEvent.click(within(dialog()).getByRole("button", { name: "Return to loop with 1 gate" }));
    });

    expect(sendReturn).toHaveBeenCalledExactlyOnceWith(PR_514_ID, {
      gates: ["physical_hil"],
      revisionId: REV_2_ID,
      replayKey: "press-1",
    });
  });

  it("will not send with nothing selected, and says why", () => {
    const sendReturn = vi.fn<ReturnSender>();
    draw({ initial: blockedPage(), sendReturn });

    fireEvent.click(action(RETURN_LABEL));
    for (const box of within(dialog()).getAllByRole("checkbox")) fireEvent.click(box);

    const confirm = within(dialog()).getByRole("button", { name: "Return to loop with 0 gates" });
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    expect(confirm).toHaveAttribute("title", RETURN_NEEDS_GATE);

    fireEvent.click(confirm);
    fireEvent.submit(confirm.closest("form")!);
    expect(sendReturn).not.toHaveBeenCalled();
  });

  it("closes on a queued return and draws a receipt linking into the run console", async () => {
    const sendReturn = vi.fn<ReturnSender>().mockResolvedValue({ ok: true, answer: returned() });
    draw({ initial: blockedPage(), origin: BUILD_FARM_ORIGIN, sendReturn });

    fireEvent.click(action(RETURN_LABEL));
    await act(async () => {
      fireEvent.click(within(dialog()).getByRole("button", { name: "Return to loop with 2 gates" }));
    });

    expect(screen.queryByRole("alertdialog")).toBeNull();

    const receipt = within(actions()).getByRole("status");
    expect(receipt).toHaveTextContent(
      "Correction round queued for loop #1847, with the evidence of 2 gates as its steer.",
    );
    expect(within(receipt).getByRole("link", { name: RECEIPT_LINK })).toHaveAttribute(
      "href",
      runPath(SEEDED_RUN_ID, BUILD_FARM_ORIGIN.id),
    );
  });

  it("stays open on a refusal and says it in the service's words", async () => {
    const refusal: ReturnOutcome = {
      ok: false,
      status: 422,
      code: "pr_gate_not_red",
      reason: "Test suite is no longer red on revision 2.",
    };
    draw({ initial: blockedPage(), sendReturn: vi.fn<ReturnSender>().mockResolvedValue(refusal) });

    fireEvent.click(action(RETURN_LABEL));
    await act(async () => {
      fireEvent.click(within(dialog()).getByRole("button", { name: "Return to loop with 2 gates" }));
    });

    expect(within(dialog()).getByRole("alert")).toHaveTextContent(refusal.reason);
    expect(within(actions()).queryByRole("status")).toBeNull();
  });

  it("cannot be sent twice while the first is in flight", async () => {
    const { sender, release } = held<ReturnOutcome>();
    draw({ initial: blockedPage(), sendReturn: sender });

    fireEvent.click(action(RETURN_LABEL));
    const form = within(dialog()).getByRole("button", { name: /^Return to loop with/ }).closest("form")!;

    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(sender).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ ok: true, answer: returned() });
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("draws a correction round the loop rejected as a failure, with no link", async () => {
    const rejected = returned({
      control: { ...returned().control, state: "rejected" },
      loopReturn: null,
      skipped: ["The run has finished, so no correction round was queued: merged."],
    });
    draw({
      initial: blockedPage(),
      sendReturn: vi.fn<ReturnSender>().mockResolvedValue({ ok: true, answer: rejected }),
    });

    fireEvent.click(action(RETURN_LABEL));
    await act(async () => {
      fireEvent.click(within(dialog()).getByRole("button", { name: "Return to loop with 2 gates" }));
    });

    const receipt = within(actions()).getByRole("status");
    expect(receipt).toHaveClass("prv-actions__outcome--failed");
    expect(within(receipt).queryByRole("link")).toBeNull();
  });

  it("leaves nothing behind when it is cancelled", () => {
    const sendReturn = vi.fn<ReturnSender>();
    draw({ initial: blockedPage(), sendReturn });

    fireEvent.click(action(RETURN_LABEL));
    fireEvent.click(within(dialog()).getByRole("checkbox", { name: /Test suite/ }));
    fireEvent.click(within(dialog()).getByRole("button", { name: RETURN_CANCEL }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(sendReturn).not.toHaveBeenCalled();

    fireEvent.click(action(RETURN_LABEL));
    expect(
      within(dialog())
        .getAllByRole("checkbox")
        .every((box) => (box as HTMLInputElement).checked),
    ).toBe(true);
  });
});

describe("Request human review", () => {
  it("sends the request and becomes state-aware from the answer", async () => {
    const outcome: ReviewRequestOutcome = {
      ok: true,
      outcome: { review: review(), created: true, humanApproval: null, aggregate: null },
    };
    const sendReview = vi.fn<ReviewSender>().mockResolvedValue(outcome);
    draw({ sendReview });

    await act(async () => {
      fireEvent.click(action(REVIEW_LABEL));
    });

    expect(sendReview).toHaveBeenCalledExactlyOnceWith(PR_514_ID);
    expect(within(actions()).getByRole("status")).toHaveTextContent(REVIEW_OPENED);

    const button = action(REVIEW_REQUESTED_LABEL);
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription(reviewWaiting(review()));
    expect(within(actions()).queryByRole("button", { name: REVIEW_LABEL })).toBeNull();

    fireEvent.click(button);
    expect(sendReview).toHaveBeenCalledTimes(1);
  });

  it("cannot be double-submitted while the request is in flight", async () => {
    const { sender, release } = held<ReviewRequestOutcome>();
    draw({ sendReview: sender });

    fireEvent.click(action(REVIEW_LABEL));
    const sending = action(REVIEW_SENDING_LABEL);

    expect(sending).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(sending);
    expect(sender).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({
        ok: true,
        outcome: { review: review(), created: false, humanApproval: null, aggregate: null },
      });
    });
    expect(within(actions()).getByRole("status")).toHaveTextContent(REVIEW_ALREADY_OPEN);
  });

  it("is state-aware on arrival when a review is already waiting", () => {
    draw({ initial: prPage({ review: review() }) });

    expect(action(REVIEW_REQUESTED_LABEL)).toHaveAttribute("aria-disabled", "true");
  });

  it("draws a refusal in the service's words and stays pressable", async () => {
    const refusal: ReviewRequestOutcome = {
      ok: false,
      status: 409,
      code: "pull_request_not_open",
      reason: "The PR was closed on its host.",
    };
    draw({ sendReview: vi.fn<ReviewSender>().mockResolvedValue(refusal) });

    await act(async () => {
      fireEvent.click(action(REVIEW_LABEL));
    });

    const status = within(actions()).getByRole("status");
    expect(status).toHaveTextContent(refusal.reason);
    expect(status).toHaveClass("prv-actions__outcome--failed");
    expect(action(REVIEW_LABEL)).not.toHaveAttribute("aria-disabled");
  });
});

describe("Merge when all gates green", () => {
  it("arms nothing: it hands off to the Merge plan slot and moves focus there", () => {
    draw();

    const slot = screen.getByRole("region", { name: MERGE_PLAN_TITLE });
    expect(slot).toHaveAttribute("id", MERGE_PLAN_ID);
    expect(slot).toHaveTextContent(NOTHING_CHOSEN);

    fireEvent.click(action(MERGE_LABEL));

    expect(slot).toHaveTextContent(handedOff(2));
    expect(slot).toHaveTextContent("nothing has been armed");
    expect(slot).toHaveFocus();
  });

  it("is disabled with a stated reason when the PR is not armable", () => {
    const cases: [PullRequestPage, string][] = [
      [blockedPage(), "2 gates are red on revision 2 — a blocked PR cannot be armed."],
      [prPage({ pullRequest: { state: "armed" } }), ALREADY_ARMED],
      [
        prPage({ pullRequest: { state: "merged" } }),
        "This PR has merged — there is nothing left to decide.",
      ],
    ];

    for (const [page, reason] of cases) {
      const { unmount } = draw({ initial: page });
      const button = action(MERGE_LABEL);

      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAttribute("title", reason);
      expect(button).toHaveAccessibleDescription(reason);
      expect(within(actions()).getByText(reason)).toBeInTheDocument();

      fireEvent.click(button);
      expect(screen.getByRole("region", { name: MERGE_PLAN_TITLE })).toHaveTextContent(
        NOTHING_CHOSEN,
      );
      unmount();
    }
  });
});

describe("the reasons under the actions", () => {
  it("says a reason three actions share once, and describes each of them by it", () => {
    draw({ initial: blockedPage({ pullRequest: { state: "merged" } }) });

    const reason = "This PR has merged — there is nothing left to decide.";

    expect(within(actions()).getAllByRole("listitem").map((note) => note.textContent)).toEqual([
      reason,
    ]);
    for (const button of within(actions()).getAllByRole("button")) {
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAccessibleDescription(reason);
    }
  });

  it("says nothing under the row when every action is on", () => {
    draw({ initial: blockedPage({ pullRequest: { state: "verifying" } }) });

    expect(within(actions()).queryByRole("list")).toBeNull();
  });
});

describe("role gating", () => {
  it("draws a member no arm affordance — no merge button and no merge plan slot", () => {
    draw({ initial: blockedPage(), mayArm: false });

    expect(within(actions()).getAllByRole("button").map((button) => button.textContent)).toEqual([
      REVIEW_LABEL,
      RETURN_LABEL,
    ]);
    expect(screen.queryByRole("button", { name: MERGE_LABEL })).toBeNull();
    expect(screen.queryByRole("region", { name: MERGE_PLAN_TITLE })).toBeNull();
  });

  it("draws a viewer the head and no actions at all", () => {
    draw({ initial: blockedPage(), mayArm: false, mayContribute: false });

    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: ACTIONS_LABEL })).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("polling", () => {
  it("redraws the head from the poll's answer without a reload", async () => {
    draw({ poll: answering(blockedPage()) });

    await vi.waitFor(() =>
      expect(document.querySelector(".prv-head__meta .ou-chip")).toHaveTextContent(
        "blocked — 3 of 7 gates green",
      ),
    );
    expect(action(RETURN_LABEL)).not.toHaveAttribute("aria-disabled");
  });

  it("keeps the last answer on screen under a banner when a refresh fails", async () => {
    draw({ poll: failing("The service did not answer.") });

    await vi.waitFor(() => expect(screen.getByText(STALE_HEADLINE)).toBeInTheDocument());
    expect(screen.getByText("The service did not answer.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("draws a failed first read as a banner, with nothing invented under it", () => {
    draw({ initial: null, initialError: "The database is down." });

    expect(screen.getByText(UNREAD_HEADLINE)).toBeInTheDocument();
    expect(screen.getByText("The database is down.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByRole("group", { name: ACTIONS_LABEL })).toBeNull();
    expect(screen.getByText(PR_CRUMB)).toHaveAttribute("aria-current", "page");
  });
});

describe("the shell's contextual-surface contract", () => {
  it("keeps the originating module lit and leads back to it through the loop", () => {
    const { unmount } = draw({ origin: BUILD_FARM_ORIGIN });

    expect(navRegistry().origin).toBe(BUILD_FARM_ORIGIN.id);

    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Build Farm",
      "Loop #1847",
      "PR #514",
    ]);
    expect(crumbs.getByRole("link", { name: "Build Farm" })).toHaveAttribute("href", BUILD_FARM_PATH);
    expect(crumbs.getByRole("link", { name: "Loop #1847" })).toHaveAttribute(
      "href",
      runPath(SEEDED_RUN_ID, BUILD_FARM_ORIGIN.id),
    );
    expect(crumbs.getByText("PR #514")).toHaveAttribute("aria-current", "page");

    unmount();
    expect(navRegistry().origin).toBeNull();
  });

  it("mounts as the pane's main landmark and adds no sidebar or navigation of its own", () => {
    const { container } = draw();

    expect(container.firstElementChild?.tagName).toBe("MAIN");
    expect(screen.queryByRole("complementary")).toBeNull();
    // The one navigation landmark is the breadcrumb.
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    expect(screen.getByRole("navigation")).toHaveAccessibleName("Breadcrumb");
  });

  it("leaves the loop out of the trail for a PR no loop opened", () => {
    draw({ initial: prPage({ pullRequest: { run: null } }) });

    expect(
      within(screen.getByRole("navigation", { name: "Breadcrumb" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Dashboard", "PR #514"]);
  });
});
