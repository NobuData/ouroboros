import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PullRequestPage } from "@/app/api/pull-requests";
import { GATES_ID, GATES_PENDING_CARD } from "@/app/prs/gates-slot";
import type { PrPollOptions } from "@/app/prs/poll";
import { PrScreen } from "@/app/prs/pr-screen";
import {
  FOLLOW_LATEST,
  GATES_TITLE,
  NO_GATES,
  NO_REVISIONS,
  SCOPED_HERE,
  STRIP_TAG,
  STRIP_TITLE,
} from "@/app/prs/strip";
import { DASHBOARD_ORIGIN } from "@/app/runs/origin";

import {
  CORRECTION_NOTE,
  HIL_RED,
  PR_514_ID,
  REV_1_ID,
  REV_2_ID,
  TESTS_RED,
  classification,
  prPage,
  revision,
  revisionOne,
  revisionTwo,
  stripPage,
} from "../helpers/pull-requests";

/**
 * The revision cycle strip (#364), rendered in the PR screen: the seeded strip against mockup 12,
 * the model pill by provenance, the future step ghosted and armed, and a revision press scoping
 * the gates and the address.
 */

// The Server Actions are never reached here.
vi.mock("@/app/prs/head-actions", () => ({
  requestHumanReview: vi.fn(),
  returnToLoop: vi.fn(),
}));

/** A poll that never answers — the page shows the server's first read. */
const QUIET: PrPollOptions = { read: () => new Promise(() => {}), visible: () => true };

/** Where the page is opened, before any scope. */
const ADDRESS = `/prs/${PR_514_ID}?from=dashboard`;

/**
 * The screen for one page.
 *
 * @param initial The page.
 * @param initialRevision The revision the address names, or `null`.
 * @returns The element.
 */
function screenOf(initial: PullRequestPage, initialRevision: number | null = null) {
  return (
    <PrScreen
      initial={initial}
      initialError={null}
      initialRevision={initialRevision}
      origin={DASHBOARD_ORIGIN}
      poll={QUIET}
      prId={PR_514_ID}
    />
  );
}

/** The strip's card. */
function strip(): HTMLElement {
  return screen.getByRole("region", { name: STRIP_TITLE });
}

/** The strip's steps, in order. */
function steps(): HTMLElement[] {
  return [...strip().querySelectorAll<HTMLElement>(".prv-step")];
}

/** The gates slot. */
function gates(): HTMLElement {
  return screen.getByRole("region", { name: GATES_TITLE });
}

/** The verdicts the gates slot lists, as `label: verdict`. */
function verdicts(): string[] {
  return [...gates().querySelectorAll(".prv-gates__row")].map(
    (row) =>
      `${row.querySelector(".prv-gates__name")?.textContent}: ` +
      `${row.querySelector(".ou-chip")?.textContent}`,
  );
}

/**
 * A revision's step.
 *
 * @param seq Its ordinal.
 * @returns The button.
 */
function revisionButton(seq: number): HTMLElement {
  return within(strip()).getByRole("button", { name: new RegExp(`^Revision ${seq} `) });
}

beforeEach(() => {
  window.history.replaceState(null, "", ADDRESS);
});

describe("the seeded strip", () => {
  it("draws mockup 12's four steps with their treatments, shas and summaries", () => {
    render(screenOf(stripPage()));

    const [first, correction, second, future] = steps();

    expect(steps()).toHaveLength(4);
    expect(within(strip()).getByText(STRIP_TAG)).toBeInTheDocument();

    expect(first).toHaveClass("prv-step--err");
    expect(first).toHaveTextContent("Revision 1 · 14:10 — blocked: Test suite, Physical HIL ✗");
    expect(first).toHaveTextContent("3f9c2ae · 2 gates red");

    expect(correction).toHaveClass("prv-step--correction");
    expect(correction).toHaveTextContent("Correction round · attempt 4");
    expect(correction).toHaveTextContent(CORRECTION_NOTE);

    expect(second).toHaveClass("prv-step--live");
    expect(second).toHaveTextContent("Revision 2 · 14:31 — pushed, re-verification running");
    expect(second).toHaveTextContent("b7e41d0 · 5/7 gates green");

    expect(future).toHaveClass("prv-step--ghosted");
    expect(future).toHaveTextContent("Auto-merge (squash)");
    expect(future).toHaveTextContent("on all gates green · policy: standard-fix");
  });

  it("pulses on the live revision alone, hidden from a screen reader", () => {
    render(screenOf(stripPage()));

    const dots = strip().querySelectorAll(".prv-step__dot");

    expect(dots).toHaveLength(1);
    expect(dots[0]!.closest(".prv-step")).toHaveClass("prv-step--live");
    expect(dots[0]).toHaveAttribute("aria-hidden", "true");
  });

  it("is a list inside its own scrolling wrapper", () => {
    render(screenOf(stripPage()));

    const wrapper = strip().querySelector(".prv-strip__scroll");

    expect(wrapper).not.toBeNull();
    expect(within(wrapper as HTMLElement).getByRole("list").children).toHaveLength(4);
  });

  it("makes revisions pressable and nothing else", () => {
    render(screenOf(stripPage()));

    expect(within(strip()).getAllByRole("button")).toEqual([revisionButton(1), revisionButton(2)]);
  });

  it("says so before the first revision, and draws no gates", () => {
    render(screenOf(prPage({ revisions: [], gates: null })));

    expect(within(strip()).getByText(NO_REVISIONS)).toBeInTheDocument();
    expect(steps()).toHaveLength(0);
    expect(screen.queryByRole("region", { name: GATES_TITLE })).toBeNull();
  });
});

describe("the blocking reason", () => {
  it("is composed from the revision's red gates, not stored text", () => {
    const page = stripPage();
    const renamed = stripPage({
      revisions: [
        revisionOne({
          gates: {
            ...revisionOne().gates,
            rows: revisionOne().gates.rows.map((row) =>
              row.key === "physical_hil" ? { ...row, label: "Rig overshoot" } : row,
            ),
          },
        }),
        revisionTwo(),
      ],
    });
    const { rerender } = render(screenOf(page));

    expect(steps()[0]).toHaveTextContent("blocked: Test suite, Physical HIL ✗");

    rerender(screenOf(renamed));

    expect(steps()[0]).toHaveTextContent("blocked: Test suite, Rig overshoot ✗");
  });
});

describe("the correction step's model pill", () => {
  /**
   * The page with the bridging classification made by this actor.
   *
   * @param actor Who classified.
   * @returns The page.
   */
  function classifiedBy(actor: "human" | "heuristic" | "model"): PullRequestPage {
    return stripPage({
      revisions: [
        revisionOne(),
        revisionTwo({
          correction: {
            fromRevisionId: REV_1_ID,
            classification: classification({ actor }),
            loopReturn: null,
          },
        }),
      ],
    });
  }

  it("names the model when the classification's provenance is a model", () => {
    render(screenOf(classifiedBy("model")));

    const pill = steps()[1]!.querySelector(".ou-chip");

    expect(pill).toHaveTextContent("claude-fable-5");
    expect(pill).toHaveClass("ou-chip--model");
  });

  it.each(["human", "heuristic"] as const)("draws none for a %s classification", (actor) => {
    render(screenOf(classifiedBy(actor)));

    expect(steps()[1]).toHaveTextContent(CORRECTION_NOTE);
    expect(steps()[1]!.querySelector(".ou-chip")).toBeNull();
    expect(strip()).not.toHaveTextContent("claude-fable-5");
  });
});

describe("the future step", () => {
  it("re-styles when the PR is armed and returns to ghosted on disarm", () => {
    const unarmed = stripPage();
    const armed = stripPage({
      plan: { ...unarmed.plan, armed: true, armedAgainstRevisionId: REV_2_ID },
      pullRequest: { state: "armed" },
    });
    const { rerender } = render(screenOf(unarmed));

    expect(steps().at(-1)).toHaveClass("prv-step--ghosted");

    rerender(screenOf(armed));

    expect(steps().at(-1)).toHaveClass("prv-step--armed");
    expect(steps().at(-1)).not.toHaveClass("prv-step--ghosted");
    expect(steps().at(-1)).toHaveTextContent("Auto-merge (squash) — armed");

    rerender(screenOf(unarmed));

    expect(steps().at(-1)).toHaveClass("prv-step--ghosted");
    expect(steps().at(-1)).not.toHaveClass("prv-step--armed");
    expect(steps().at(-1)).not.toHaveTextContent("armed");
  });

  it("is left out of a merged PR's strip", () => {
    render(screenOf(stripPage({ pullRequest: { state: "merged" } })));

    expect(steps()).toHaveLength(3);
    expect(strip()).not.toHaveTextContent("Auto-merge");
  });
});

describe("scoping the gates", () => {
  it("follows the latest revision until a step is pressed", () => {
    render(screenOf(stripPage()));

    expect(gates()).toHaveAttribute("id", GATES_ID);
    expect(gates()).toHaveTextContent("Revision 2 · b7e41d0 · 5/7 gates green");
    expect(gates()).toHaveTextContent(GATES_PENDING_CARD);
    expect(verdicts().filter((row) => row.endsWith(": red"))).toEqual([]);
    expect(revisionButton(1)).toHaveAttribute("aria-pressed", "false");
    expect(revisionButton(2)).toHaveAttribute("aria-pressed", "false");
    expect(within(gates()).queryByRole("button", { name: FOLLOW_LATEST })).toBeNull();
    expect(window.location.search).toBe("?from=dashboard");
  });

  it("scopes to revision 1's two-red snapshot on a press, and updates the address", () => {
    render(screenOf(stripPage()));

    fireEvent.click(revisionButton(1));

    expect(revisionButton(1)).toHaveAttribute("aria-pressed", "true");
    expect(revisionButton(1)).toHaveClass("prv-step--scoped");
    expect(revisionButton(1)).toHaveTextContent(SCOPED_HERE);
    expect(gates()).toHaveTextContent("Revision 1 · 3f9c2ae · 2 gates red");
    expect(verdicts()).toEqual([
      "Build: green",
      "Test suite: red",
      "Physical HIL: red",
      "Diff vs plan: green",
      "Secrets & license: green",
      "Second-model review: unavailable",
      "Human approval: not required",
    ]);
    expect(gates()).toHaveTextContent(TESTS_RED);
    expect(gates()).toHaveTextContent(HIL_RED);
    expect(window.location.search).toBe("?from=dashboard&rev=1");
    expect(window.location.pathname).toBe(`/prs/${PR_514_ID}`);
  });

  it("leaves the head describing the latest revision", () => {
    render(screenOf(stripPage()));

    fireEvent.click(revisionButton(1));

    expect(screen.getByText("PR Verification · PR #514 · Revision 2")).toBeInTheDocument();
  });

  it("moves the scope from one revision to another", () => {
    render(screenOf(stripPage()));

    fireEvent.click(revisionButton(1));
    fireEvent.click(revisionButton(2));

    expect(revisionButton(1)).toHaveAttribute("aria-pressed", "false");
    expect(revisionButton(2)).toHaveAttribute("aria-pressed", "true");
    expect(gates()).toHaveTextContent("Revision 2 · b7e41d0 · 5/7 gates green");
    expect(window.location.search).toBe("?from=dashboard&rev=2");
  });

  it("follows the latest again when the scoped step is pressed a second time", () => {
    render(screenOf(stripPage()));

    fireEvent.click(revisionButton(1));
    fireEvent.click(revisionButton(1));

    expect(revisionButton(1)).toHaveAttribute("aria-pressed", "false");
    expect(gates()).toHaveTextContent("Revision 2 · b7e41d0");
    expect(window.location.search).toBe("?from=dashboard");
  });

  it("follows the latest again from the gates' own button", () => {
    render(screenOf(stripPage()));

    fireEvent.click(revisionButton(1));
    fireEvent.click(within(gates()).getByRole("button", { name: FOLLOW_LATEST }));

    expect(gates()).toHaveTextContent("Revision 2 · b7e41d0");
    expect(strip()).not.toHaveTextContent(SCOPED_HERE);
    expect(window.location.search).toBe("?from=dashboard");
  });

  it("opens scoped from a linked address", () => {
    window.history.replaceState(null, "", `${ADDRESS}&rev=1`);
    render(screenOf(stripPage(), 1));

    expect(revisionButton(1)).toHaveAttribute("aria-pressed", "true");
    expect(gates()).toHaveTextContent("Revision 1 · 3f9c2ae · 2 gates red");
    expect(window.location.search).toBe("?from=dashboard&rev=1");
  });

  it("drops a scope naming a revision the PR does not have, from the address too", () => {
    window.history.replaceState(null, "", `${ADDRESS}&rev=9`);
    render(screenOf(stripPage(), 9));

    expect(strip()).not.toHaveTextContent(SCOPED_HERE);
    expect(gates()).toHaveTextContent("Revision 2 · b7e41d0");
    expect(within(gates()).queryByRole("button", { name: FOLLOW_LATEST })).toBeNull();
    expect(window.location.search).toBe("?from=dashboard");
  });

  it("keeps a linked scope in the address while the page has not been read", () => {
    window.history.replaceState(null, "", `${ADDRESS}&rev=1`);
    render(
      <PrScreen
        initial={null}
        initialError="The service did not answer."
        initialRevision={1}
        origin={DASHBOARD_ORIGIN}
        poll={QUIET}
        prId={PR_514_ID}
      />,
    );

    expect(window.location.search).toBe("?from=dashboard&rev=1");
  });

  it("says so for a revision that was never evaluated", () => {
    render(screenOf(prPage({ revisions: [revision()] })));

    expect(gates()).toHaveTextContent("Revision 2 · b7e41d0 · not evaluated");
    expect(gates()).toHaveTextContent(NO_GATES);
  });
});
