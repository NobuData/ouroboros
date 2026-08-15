import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RecentlyClosedCard } from "@/app/dashboard/recently-closed-card";
import { COMPLETIONS_SHOWN, NO_VALUE } from "@/app/dashboard/view";

import { closedRun, dashboardPayload, emptyDashboard, failed, read } from "../helpers/dashboard";

/**
 * *Recently closed by the loop* — the mockup's `c-7` table
 * ([#84](https://github.com/NobuData/ouroboros/issues/84)).
 *
 * The card's first acceptance criterion is *the seeded four rows match the mockup, including
 * the `13/14` needs-human row and its warn tint*, so the first block below is that
 * comparison column by column against `docs/mockups/02-dashboard.html`'s own four rows.
 *
 * The arithmetic behind the pairs, the cycles and the fractions is `view.test.ts`'s. What is
 * here is what reaches the DOM: the treatments, the names things are announced under, and —
 * as much as any of it — what the card refuses to draw.
 */

/**
 * Render the card over an aggregate.
 *
 * @param over The parts of the payload this case is about.
 * @returns The Testing Library render result.
 */
function card(over: Parameters<typeof dashboardPayload>[0] = {}) {
  return render(<RecentlyClosedCard aggregate={read(dashboardPayload(over))} />);
}

/**
 * The no-break space inside `PR #512`, as `view.ts` writes it.
 *
 * Spelled as an escape here for the reason it is spelled as one there: the character is
 * invisible in a diff, and an assertion that silently held an ordinary space would be the one
 * that stopped testing the rule.
 */
const NBSP = "\u00a0";

/** The card, by its heading. */
function region(): HTMLElement {
  return screen.getByRole("region", { name: "Recently closed by the loop" });
}

/** The table's rows, head excluded. */
function rows(): HTMLElement[] {
  return within(region()).getAllByRole("row").slice(1);
}

/**
 * One row's cells, as text.
 *
 * @param index Which row.
 * @returns The five cells' text content, in the order the mockup draws them.
 */
function cells(index: number): string[] {
  return within(rows()[index]!)
    .getAllByRole("cell")
    .map((cell) => cell.textContent ?? "");
}

/**
 * The chip in one row's outcome cell.
 *
 * @param index Which row.
 * @returns The element, or `null` when the row has none.
 */
function outcome(index: number): Element | null {
  return within(rows()[index]!).getAllByRole("cell").at(-1)?.querySelector(".ou-chip") ?? null;
}

describe("the seeded rows, against the mockup", () => {
  it("draws the mockup's four runs, newest first", () => {
    card();

    expect(rows()).toHaveLength(4);
    expect(rows().map((row) => row.textContent?.slice(0, 4))).toEqual([
      "#474",
      "#471",
      "#468",
      "#465",
    ]);
  });

  it("draws every column of the first row exactly as the mockup does", () => {
    card();

    expect(cells(0)).toEqual([
      `#474 → PR${NBSP}#512 Debounce e-stop interrupt handler`,
      "claude-fable-5",
      "11m",
      "14/14",
      "merged",
    ]);
  });

  it("draws the row that stopped for a person, with its short check count", () => {
    // The honest row, and the reason this card exists: it keeps the same columns and the
    // same weight as the three that merged.
    card();

    expect(cells(3)).toEqual([
      `#465 → PR${NBSP}#504 Refactor telemetry buffer allocation`,
      "claude-sonnet-5",
      "42m",
      "13/14",
      // The outcome cell carries the pill and the control that will reach the inbox.
      "needs human" + "Review →",
    ]);
  });

  it("measures each cycle between the run's own two instants", () => {
    // `finishedAt − startedAt`, in the compact formatter #81 draws the queue's estimate with:
    // a cycle is over, so it drops its zero parts rather than padding a seconds figure that
    // is not moving.
    card();

    expect([0, 1, 2, 3].map((index) => cells(index)[2])).toEqual(["11m", "19m", "6m", "42m"]);
  });

  it("tints only the fraction that is short of its own total", () => {
    card();

    const short = rows()[3]!.querySelector(".dash-closed__checks--short");

    expect(short?.textContent).toBe("13/14");
    expect(short).toHaveAttribute("title", "1 check did not pass.");
    for (const index of [0, 1, 2]) {
      expect(rows()[index]!.querySelector(".dash-closed__checks--short")).toBeNull();
    }
  });

  it("maps each outcome onto the pill class the mockup gives it", () => {
    card();

    for (const index of [0, 1, 2]) {
      expect(outcome(index)).toHaveClass("ou-chip--ok");
    }
    expect(outcome(3)).toHaveClass("ou-chip--warn");
  });

  it("draws each model identifier opaquely, in the model hue", () => {
    // Decision F8, and the reason the mockup's four rows carry four different vendors'
    // strings: nothing here parses one, shortens one, or maps one to a prettier name.
    card();

    for (const [index, model] of [
      [0, "claude-fable-5"],
      [1, "copilot/gpt-5-codex"],
      [2, "ollama/qwen3-coder"],
      [3, "claude-sonnet-5"],
    ] as const) {
      const chip = within(rows()[index]!).getByText(model);

      expect(chip).toHaveClass("ou-chip--model");
      expect(chip).toHaveClass("ou-chip--mono");
    }
  });

  it("keeps the issue and its pull request together, in mono", () => {
    // One value read as one thing: the mono treatment is the mockup's, and the no-break space
    // inside `PR #512` is what stops a narrow column splitting it across two lines.
    card();

    const pair = rows()[0]!.querySelector(".dash-closed__pair");

    expect(pair?.textContent).toBe(`#474 → PR${NBSP}#512`);
  });

  it("heads the five columns the mockup heads", () => {
    card();

    expect(
      within(region())
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Issue → PR", "Model", "Cycle", "Checks", "Outcome"]);
  });

  it("aligns the two numeric columns to their own edge, in tabular figures", () => {
    // A cycle and a fraction are read down the column rather than across the row.
    card();

    for (const index of [2, 3]) {
      const cell = within(rows()[0]!).getAllByRole("cell")[index];

      expect(cell).toHaveClass("ou-table__cell--end");
      expect(cell).toHaveClass("ou-table__cell--mono");
    }
  });
});

describe("an outcome the mockup never drew", () => {
  it("renders a failed run in the danger treatment", () => {
    // The mockup has no failed row and the seed has none either, so this is the fixture the
    // acceptance criterion asks for: the status exists in the contract, and a run that failed
    // is exactly the row this card must not quietly drop.
    card({ recentRuns: [closedRun({ status: "failed" })] });

    expect(outcome(0)).toHaveClass("ou-chip--err");
    expect(cells(0)[4]).toBe("failed");
  });

  it("offers no inbox control on a failed row, which is not waiting for anybody", () => {
    card({ recentRuns: [closedRun({ status: "failed" })] });

    expect(within(region()).queryByRole("button", { name: "Review →" })).toBeNull();
  });

  it("draws a run that somehow arrived still running in a hue that suits it", () => {
    // An active run belongs in the loops table by definition. If one arrives here anyway it
    // should not be drawn as an outcome it has not reached.
    card({ recentRuns: [closedRun({ status: "coding" })] });

    expect(outcome(0)).toHaveClass("ou-chip--accent");
    expect(cells(0)[4]).toBe("coding");
  });
});

describe("the rows that need a person", () => {
  it("points them at the inbox, labelled rather than linked", () => {
    // The criterion is that a `needs human` row links toward the inbox placeholder. The
    // inbox is mockup 16 and #49 holds its route; neither exists, so the control says what is
    // missing instead of pointing at a 404 — #49's own first criterion is *no dead nav
    // links*, and the sidebar answers the same destination the same way.
    card();

    const review = within(rows()[3]!).getByRole("button", { name: "Review →" });

    expect(review).toHaveAttribute("aria-disabled", "true");
    expect(review.getAttribute("title")).toMatch(/needs-you inbox is not built yet/);
  });

  it("puts the control on no other row", () => {
    card();

    expect(within(region()).getAllByRole("button", { name: "Review →" })).toHaveLength(1);
  });
});

describe("the card's head", () => {
  it("offers the issues screen, inert, and says why", () => {
    card();

    const link = within(region()).getByRole("button", { name: /All issues/ });

    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link.getAttribute("title")).toMatch(/not built yet/);
  });

  it("names itself as a region, and the table inside it as a table", () => {
    card();

    expect(region()).toBeInTheDocument();
    expect(
      within(region()).getByRole("table", { name: "Runs the loop has closed, newest first" }),
    ).toBeInTheDocument();
  });
});

describe("more rows than the card draws", () => {
  it("draws four of the eight the aggregate carries", () => {
    // The endpoint answers eight so a client that expands already holds them; the mockup
    // draws four, and that number is written down rather than implied by a payload.
    card({
      recentRuns: Array.from({ length: 8 }, (_, index) =>
        closedRun({ id: `run-${index}`, issueNumber: 400 + index, prNumber: 500 + index }),
      ),
    });

    expect(rows()).toHaveLength(COMPLETIONS_SHOWN);
    expect(rows().map((row) => row.textContent?.slice(0, 4))).toEqual([
      "#400",
      "#401",
      "#402",
      "#403",
    ]);
  });

  it("re-sorts nothing, so the card and its drill-in cannot disagree about order", () => {
    // The endpoint orders the whole table, newest first by `finishedAt`, and four rows sorted
    // again on the client would come out in a different order from the listing that shows all
    // of them.
    card({
      recentRuns: [
        closedRun({ id: "b", issueNumber: 2 }, { closedSecondsAgo: 60 }),
        closedRun({ id: "a", issueNumber: 1 }, { closedSecondsAgo: 30 }),
      ],
    });

    expect(rows().map((row) => row.textContent?.slice(0, 2))).toEqual(["#2", "#1"]);
  });
});

describe("a workspace that has closed nothing", () => {
  it("says so, rather than drawing an empty table", () => {
    render(<RecentlyClosedCard aggregate={read(emptyDashboard())} />);

    expect(screen.getByText("Nothing closed yet")).toBeInTheDocument();
    expect(within(region()).queryByRole("table")).not.toBeInTheDocument();
  });

  it("names what would put a row there", () => {
    // The designed zero state for every card at once is #86's; this is the sentence until
    // then, and it says what fills the card rather than apologising for the emptiness.
    render(<RecentlyClosedCard aggregate={read(emptyDashboard())} />);

    expect(screen.getByText(/as soon as the first loop closes/)).toBeInTheDocument();
  });
});

describe("an aggregate that could not be read", () => {
  it("says what it could not read rather than reporting an empty workspace", () => {
    // *Nothing has closed* and *nobody could ask what has closed* are different facts, which
    // is the rule the stat row's em dash is written under.
    render(<RecentlyClosedCard aggregate={failed("Choose a workspace first.")} />);

    expect(screen.getByText("The completions could not be read")).toBeInTheDocument();
    expect(screen.queryByText("Nothing closed yet")).not.toBeInTheDocument();
  });

  it("leaves the reason to the page's banner, and repeats none of it (#86)", () => {
    render(<RecentlyClosedCard aggregate={failed("Choose a workspace first.")} />);

    expect(screen.queryByText("Choose a workspace first.")).not.toBeInTheDocument();
  });

  it("keeps the card, its heading and its place in the grid", () => {
    const { container } = render(<RecentlyClosedCard aggregate={failed("Nope.")} />);

    expect(region()).toHaveClass("dash-col--7");
    expect(container.querySelector(".ou-card")).toBeInTheDocument();
  });
});

describe("a row the service could not describe completely", () => {
  it("draws the issue alone when the run never opened a pull request", () => {
    // A run may fail, or stop for a person, before there is anything to open one for. An
    // arrow pointing at nothing would be the row claiming half a fact.
    card({ recentRuns: [closedRun({ status: "failed", prNumber: null })] });

    expect(rows()[0]!.querySelector(".dash-closed__pair")?.textContent).toBe("#474");
  });

  it("draws an em dash for checks nobody has counted, and does not tint it", () => {
    card({
      recentRuns: [closedRun({ status: "failed", checksPassed: null, checksTotal: null })],
    });

    expect(cells(0)[3]).toBe(NO_VALUE);
    expect(rows()[0]!.querySelector(".dash-closed__checks--short")).toBeNull();
  });

  it("draws a repository with no checks as `0/0` rather than as an unknown", () => {
    // `0` of `0` is a fact — a repository with no checks configured — and reporting a known
    // thing as an em dash would be the opposite of this card's whole rule.
    card({ recentRuns: [closedRun({ checksPassed: 0, checksTotal: 0 })] });

    expect(cells(0)[3]).toBe("0/0");
    expect(rows()[0]!.querySelector(".dash-closed__checks--short")).toBeNull();
  });

  it("draws an em dash for a cycle that cannot be measured, and keeps the other four cells", () => {
    // Every timestamp in the contract is required and well formed, so this is the guard
    // rather than the expected case — and a guard that dropped the row, or drew `NaNm`, would
    // lose a run that really closed.
    card({ recentRuns: [closedRun({ finishedAt: "not a timestamp" })] });

    expect(cells(0)[2]).toBe(NO_VALUE);
    expect(cells(0)[4]).toBe("merged");
  });

  it("puts nothing in a row that the run did not report", () => {
    card();

    expect(region().textContent).not.toMatch(/null|undefined|NaN/);
  });
});

describe("what the table does not pretend", () => {
  it("links no row anywhere, since neither destination exists", () => {
    card();

    expect(within(region()).queryAllByRole("link")).toHaveLength(0);
  });
});
