import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PullRequestPage } from "@/app/api/pull-requests";
import { MODELS_PATH, ROUTING_MATRIX_HASH } from "@/app/paths";
import { MERGE_PLAN_TITLE } from "@/app/prs/merge-plan";
import type { PrPollOptions } from "@/app/prs/poll";
import { PrScreen } from "@/app/prs/pr-screen";
import { NONE_RECORDED, NO_CAP, NO_LOOP_SPEND, ROUTING_LINK, SPEND_TITLE } from "@/app/prs/spend";
import { SPEND_ID } from "@/app/prs/spend-card";
import { DASHBOARD_ORIGIN } from "@/app/runs/origin";

import { PR_514_ID, prPage, seededSpend } from "../helpers/pull-requests";

/**
 * The Spend card (#369), rendered through the screen: the seeded figures against mockup 12, and
 * the unpriced case — counts with an em-dash, never `$0`.
 */

// The Server Actions are never reached here: nothing in this suite presses.
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

/** A poll that never answers — the page shows the server's first read. */
const QUIET: PrPollOptions = { read: () => new Promise(() => {}), visible: () => true };

/**
 * Draw the screen, as a viewer: the card is every reader's.
 *
 * @param initial The page.
 * @returns The Testing Library render result.
 */
function draw(initial: PullRequestPage = prPage({ spend: seededSpend() })) {
  return render(
    <PrScreen
      initial={initial}
      initialError={null}
      origin={DASHBOARD_ORIGIN}
      poll={QUIET}
      prId={PR_514_ID}
    />,
  );
}

/** The card. */
function card(): HTMLElement {
  return screen.getByRole("region", { name: SPEND_TITLE });
}

/** The card's rows, as `[name, figure]`. */
function rows(): (string | undefined)[][] {
  return within(card())
    .getAllByRole("term")
    .map((term) => [
      term.textContent ?? "",
      term.nextElementSibling?.querySelector("[aria-hidden]")?.textContent ?? undefined,
    ]);
}

describe("the seeded card (mockup 12)", () => {
  it("draws the loop's total, the verification share and the cap line", () => {
    draw();

    expect(card()).toHaveAttribute("id", SPEND_ID);
    expect(rows()).toEqual([
      ["Loop total", "284k tokens · $1.52"],
      ["Verification", "41k · $0.19"],
    ]);
    expect(within(card()).getByText("within $2.50 cap")).toHaveClass("prv-spend__cap--ok");
  });

  it("links Routing to the routing matrix", () => {
    draw();

    expect(within(card()).getByRole("link", { name: ROUTING_LINK })).toHaveAttribute(
      "href",
      `${MODELS_PATH}#${ROUTING_MATRIX_HASH}`,
    );
  });

  it("sits after the merge plan, and is drawn for every reader", () => {
    draw();

    const plan = screen.getByRole("region", { name: MERGE_PLAN_TITLE });

    expect(plan.compareDocumentPosition(card()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("the unpriced case", () => {
  /** A ledger nothing of which is priced. */
  const UNPRICED = seededSpend({
    loop: { tokens: 284_000, tokensIn: 227_200, tokensOut: 56_800, costCents: null, unpricedEvents: 6 },
    verification: {
      tokens: 41_000,
      tokensIn: 32_800,
      tokensOut: 8_200,
      costCents: null,
      unpricedEvents: 1,
    },
    withinCap: null,
  });

  it("shows counts with an em-dash rather than $0", () => {
    draw(prPage({ spend: UNPRICED }));

    expect(rows()).toEqual([
      ["Loop total", "284k tokens · —"],
      ["Verification", "41k · —"],
    ]);
    expect(card().textContent).not.toMatch(/\$0(?:\.00)?\b/);
    // The only money on the card is the cap the loop is held to.
    expect(card().textContent?.match(/\$[\d.]+/g)).toEqual(["$2.50"]);
  });

  it("says not priced to a screen reader, where a dash would say nothing", () => {
    draw(prPage({ spend: UNPRICED }));

    expect(within(card()).getByText("284k tokens, not priced")).toHaveClass("sr-only");
    expect(within(card()).getByText("41k tokens, not priced")).toHaveClass("sr-only");
  });

  it("never says within — it states the cap and why it cannot be compared", () => {
    draw(prPage({ spend: UNPRICED }));

    expect(card()).not.toHaveTextContent(/within/);
    expect(
      within(card()).getByText("$2.50 cap — not comparable: nothing the loop spent is priced"),
    ).toHaveClass("prv-spend__cap--neutral");
  });

  it("draws no dollar sign at all when the route sets no cap either", () => {
    draw(prPage({ spend: { ...UNPRICED, cap: null } }));

    expect(card().textContent).not.toContain("$");
    expect(within(card()).getByText(NO_CAP)).toBeInTheDocument();
  });
});

describe("the other verdicts", () => {
  it("says a lower bound is one", () => {
    draw(
      prPage({
        spend: seededSpend({
          loop: {
            tokens: 284_000,
            tokensIn: 227_200,
            tokensOut: 56_800,
            costCents: "152.0000",
            unpricedEvents: 3,
          },
          withinCap: null,
        }),
      }),
    );

    expect(within(card()).getByText("lower bound — 3 calls unpriced")).toHaveClass(
      "prv-spend__bound",
    );
    expect(within(card()).getByText("284k tokens, at least $1.52")).toBeInTheDocument();
    expect(card()).not.toHaveTextContent(/within/);
  });

  it("says over the cap in the error hue", () => {
    draw(
      prPage({
        spend: seededSpend({
          loop: {
            tokens: 520_000,
            tokensIn: 416_000,
            tokensOut: 104_000,
            costCents: "310.0000",
            unpricedEvents: 0,
          },
          withinCap: false,
        }),
      }),
    );

    expect(within(card()).getByText("over $2.50 cap")).toHaveClass("prv-spend__cap--err");
  });

  it("says none recorded for a share nothing was spent on", () => {
    draw(
      prPage({
        spend: seededSpend({
          verification: { tokens: 0, tokensIn: 0, tokensOut: 0, costCents: null, unpricedEvents: 0 },
        }),
      }),
    );

    expect(rows()[1]).toEqual(["Verification", NONE_RECORDED]);
  });

  it("says a PR no loop opened has no spend, with no rows", () => {
    draw(prPage({ spend: null }));

    expect(within(card()).getByText(NO_LOOP_SPEND)).toBeInTheDocument();
    expect(within(card()).queryAllByRole("term")).toHaveLength(0);
    expect(card().textContent).not.toContain("$");
  });
});
