import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActiveLoopsCard } from "@/app/dashboard/active-loops-card";
import { NO_VALUE } from "@/app/dashboard/view";

import {
  READ_AT,
  activeRun,
  dashboardPayload,
  emptyDashboard,
  failed,
  read,
} from "../helpers/dashboard";

/**
 * *Active loops* — the mockup's `c-8` table
 * ([#82](https://github.com/NobuData/ouroboros/issues/82)).
 *
 * The card's acceptance criterion is *the seeded rows reproduce the mockup exactly*, so the
 * first block below is that comparison column by column: the issue cell, the workflow tag,
 * the stage caption and its meter, the model pill, the elapsed figure and the status pill,
 * against `docs/mockups/02-dashboard.html`'s own three rows.
 *
 * The arithmetic behind the meters is `view.test.ts`'s and the tick is `elapsed.test.tsx`'s.
 * What is here is what reaches the DOM: the treatments, the names things are announced
 * under, and — as much as any of it — what the card refuses to draw.
 */

/**
 * Render the card over an aggregate.
 *
 * @param over The parts of the payload this case is about.
 * @returns The Testing Library render result.
 */
function card(over: Parameters<typeof dashboardPayload>[0] = {}) {
  return render(
    <ActiveLoopsCard aggregate={read(dashboardPayload(over))} readAt={READ_AT} />,
  );
}

/** The card, by its heading. */
function region(): HTMLElement {
  return screen.getByRole("region", { name: "Active loops" });
}

/** The table's rows, head excluded. */
function rows(): HTMLElement[] {
  return within(region()).getAllByRole("row").slice(1);
}

/**
 * One row's cells, as text.
 *
 * @param index Which row.
 * @returns The six cells' text content, in the order the mockup draws them.
 */
function cells(index: number): string[] {
  return within(rows()[index]!)
    .getAllByRole("cell")
    .map((cell) => cell.textContent ?? "");
}

/**
 * The fill of one row's stage meter.
 *
 * @param index Which row.
 * @returns The percentage the sheet draws.
 */
function meter(index: number): string {
  const style = rows()[index]!.querySelector(".ou-meter__fill")?.getAttribute("style") ?? "";

  return /--ou-meter-fill:\s*([^;]+)/.exec(style)?.[1]?.trim() ?? "";
}

/*
 * The reader's clock is put where the readings were taken. The elapsed column is `now −
 * startedAt` on *both* sides of the hydration boundary (`app/dashboard/elapsed.tsx`), so a
 * suite that left the browser's clock at the wall time would be asserting how long ago the
 * fixture was written rather than what the card draws.
 */
beforeEach(() => {
  vi.useFakeTimers({ now: READ_AT });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the seeded rows, against the mockup", () => {
  it("draws the mockup's three runs, in the payload's lifecycle order", () => {
    card();

    expect(rows()).toHaveLength(3);
    expect(cells(0)[0]).toBe("#482 Fix flaky CAN-bus telemetry test");
    expect(cells(1)[0]).toBe("#479 Add OTA rollback on failed checksum");
    expect(cells(2)[0]).toBe("#476 Bump MQTT client, migrate deprecated API");
  });

  it("draws every column of the first row exactly as the mockup does", () => {
    card();

    expect(cells(0)).toEqual([
      "#482 Fix flaky CAN-bus telemetry test",
      "standard-fix",
      "Implementing · 4/6",
      "claude-fable-5",
      "12m 40s",
      "coding",
    ]);
  });

  it("draws the elapsed column at the mockup's own figures", () => {
    // The one moving number on the page, at the instant the readings were taken. That it
    // keeps moving afterwards is `elapsed.test.tsx`'s.
    card();

    expect(cells(0)[4]).toBe("12m 40s");
    expect(cells(1)[4]).toBe("38m 05s");
    expect(cells(2)[4]).toBe("7m 12s");
  });

  it("fills each meter to the run's own position in its workflow", () => {
    // 4/6, 5/7 and 6/6. The mockup hand-draws its third bar at 94%; a run that has reached
    // the last step of its workflow is at the end of it, and the meter says so.
    card();

    expect(meter(0)).toBe("66%");
    expect(meter(1)).toBe("71%");
    expect(meter(2)).toBe("100%");
  });

  it("gives the run in review the mockup's ok-variant meter", () => {
    card();

    expect(rows()[2]!.querySelector(".ou-meter")).toHaveClass("ou-meter--ok");
    expect(rows()[0]!.querySelector(".ou-meter")).not.toHaveClass("ou-meter--ok");
  });

  it("maps each status onto the pill class the mockup gives it", () => {
    // `coding → run`, `building → warn`, `review → ok`, where the mockup's `run` is this
    // product's accent.
    card();

    for (const [index, tone] of [
      [0, "ou-chip--accent"],
      [1, "ou-chip--warn"],
      [2, "ou-chip--ok"],
    ] as const) {
      const status = within(rows()[index]!).getAllByRole("cell").at(-1);

      expect(status?.querySelector(".ou-chip")).toHaveClass(tone);
    }
  });

  it("draws the model identifier opaquely, in the model hue", () => {
    // Decision F8: there is no model catalogue in this product, so `ollama/qwen3-coder` is
    // rendered rather than split into a vendor and a name, or mapped to something prettier.
    card();

    const model = within(rows()[2]!).getByText("ollama/qwen3-coder");

    expect(model).toHaveClass("ou-chip--model");
    expect(model).toHaveClass("ou-chip--mono");
  });

  it("draws the workflow as a tag rather than as a chip with a state", () => {
    card();

    expect(within(rows()[0]!).getByText("standard-fix")).toHaveClass("ou-tag");
  });

  it("heads the six columns the mockup heads", () => {
    card();

    expect(
      within(region())
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Issue", "Workflow", "Stage", "Model", "Elapsed", "Status"]);
  });
});

describe("the card's head", () => {
  it("shows the live pill while something is running", () => {
    card();

    const live = within(region()).getByText("live");

    expect(live).toHaveClass("ou-chip--accent");
    expect(live.querySelector(".ou-chip__dot--pulse")).toBeInTheDocument();
  });

  it("drops the live pill when nothing is", () => {
    // The acceptance criterion, and the reason it is one: *live* over an empty table would
    // be the card's one-word summary contradicting the six columns under it.
    render(<ActiveLoopsCard aggregate={read(emptyDashboard())} readAt={READ_AT} />);

    expect(screen.queryByText("live")).not.toBeInTheDocument();
  });

  it("offers the run console, inert, and says why", () => {
    card();

    const link = within(region()).getByRole("button", { name: /Open run console/ });

    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link.getAttribute("title")).toMatch(/not built yet/);
  });

  it("names itself as a region, and the table inside it as a table", () => {
    card();

    expect(region()).toBeInTheDocument();
    expect(
      within(region()).getByRole("table", { name: "Loops running right now" }),
    ).toBeInTheDocument();
  });
});

describe("more runs than the card can show", () => {
  it("says how many the ten rows leave out", () => {
    // The aggregate caps its slice at ten and the count is not capped, so the two together
    // are what the footer says.
    card({
      activeRuns: Array.from({ length: 10 }, (_, index) =>
        activeRun({ id: `run-${index}`, issueNumber: 400 + index }),
      ),
      stats: {
        ...dashboardPayload().stats,
        loopsLive: { total: 12, byStatus: { coding: 10, building: 1, review: 1 } },
      },
    });

    expect(screen.getByRole("button", { name: "+2 more running →" })).toBeInTheDocument();
  });

  it("says nothing when the table is showing all of them", () => {
    card();

    expect(screen.queryByText(/more running/)).not.toBeInTheDocument();
  });

  it("never counts below zero, whatever the two figures disagree about", () => {
    card({
      stats: {
        ...dashboardPayload().stats,
        loopsLive: { total: 1, byStatus: { coding: 1, building: 0, review: 0 } },
      },
    });

    expect(screen.queryByText(/more running/)).not.toBeInTheDocument();
  });
});

describe("a workspace with nothing running", () => {
  it("says so, rather than drawing an empty table", () => {
    render(<ActiveLoopsCard aggregate={read(emptyDashboard())} readAt={READ_AT} />);

    expect(screen.getByText("Nothing is running right now")).toBeInTheDocument();
    expect(within(region()).queryByRole("table")).not.toBeInTheDocument();
  });

  it("names what would put a row there", () => {
    render(<ActiveLoopsCard aggregate={read(emptyDashboard())} readAt={READ_AT} />);

    expect(screen.getByText(/the moment Ouroboros picks an issue up/)).toBeInTheDocument();
  });
});

describe("an aggregate that could not be read", () => {
  it("reports the reason rather than an empty workspace", () => {
    // *Nothing is running* and *nobody could ask what is running* are different facts, which
    // is the rule the stat row's em dash is written under.
    render(
      <ActiveLoopsCard aggregate={failed("Choose a workspace first.")} readAt={READ_AT} />,
    );

    expect(screen.getByText("The loops could not be read")).toBeInTheDocument();
    expect(screen.getByText("Choose a workspace first.")).toBeInTheDocument();
    expect(screen.queryByText("Nothing is running right now")).not.toBeInTheDocument();
  });

  it("keeps the card, its heading and its place in the grid", () => {
    const { container } = render(
      <ActiveLoopsCard aggregate={failed("Nope.")} readAt={READ_AT} />,
    );

    expect(region()).toHaveClass("dash-col--8");
    expect(container.querySelector(".ou-card")).toBeInTheDocument();
  });

  it("shows no live pill, since nobody could ask whether anything is live", () => {
    render(<ActiveLoopsCard aggregate={failed("Nope.")} readAt={READ_AT} />);

    expect(screen.queryByText("live")).not.toBeInTheDocument();
  });
});

describe("a row the service could not describe completely", () => {
  it("draws an em dash for a start time that cannot be read, and keeps the other five cells", () => {
    // Every timestamp in the contract is required and well formed, so this is the guard
    // rather than the expected case — and a guard that dropped the row, or drew `NaNm NaNs`,
    // would lose a run that is really happening.
    card({ activeRuns: [activeRun({ startedAt: "not a timestamp" })] });

    expect(cells(0)[4]).toBe(NO_VALUE);
    expect(cells(0)[0]).toBe("#482 Fix flaky CAN-bus telemetry test");
  });

  it("draws a workflow that reports a step past its own end as a full bar", () => {
    card({ activeRuns: [activeRun({ stageIndex: 9, stageTotal: 6 })] });

    expect(meter(0)).toBe("100%");
    expect(cells(0)[2]).toBe("Implementing · 9/6");
  });

  it("gives a run that somehow stopped a hue that suits it, rather than an accented one", () => {
    // A terminal run belongs in the completions card by definition. If one arrives here
    // anyway, it should not be drawn as the page's idea of *live*.
    card({ activeRuns: [activeRun({ status: "failed" })] });

    const status = within(rows()[0]!).getAllByRole("cell").at(-1);

    expect(status?.querySelector(".ou-chip")).toHaveClass("ou-chip--err");
    expect(status?.textContent).toBe("failed");
  });

  it("spells a status the contract writes with an underscore as words", () => {
    card({ activeRuns: [activeRun({ status: "needs_human" })] });

    expect(cells(0).at(-1)).toBe("needs human");
  });
});

describe("what the table does not pretend", () => {
  it("links no row to a run console that does not exist", () => {
    // #49's first acceptance criterion is *no dead nav links*, and the design system asks
    // that a surface which is not ready be labelled rather than left dead. The cell says
    // what is missing instead.
    card();

    expect(within(region()).queryAllByRole("link")).toHaveLength(0);
    expect(rows()[0]!.querySelector(".dash-run__issue")?.getAttribute("title")).toMatch(
      /not built yet/,
    );
  });

  it("puts nothing in a row that the run did not report", () => {
    // The run summary carries a pull request and a check count for the completions card;
    // both are null on a run in flight, and neither has a column here.
    card();

    expect(region().textContent).not.toMatch(/null|undefined|NaN/);
  });

  it("re-sorts nothing, so the card and its drill-in cannot disagree about order", () => {
    // The endpoint sorts over the whole table — lifecycle order, oldest first within a stage
    // — and ten rows sorted again on the client would come out in a different order from the
    // list that shows all of them.
    card({
      activeRuns: [
        activeRun({ id: "b", issueNumber: 2 }),
        activeRun({ id: "a", issueNumber: 1 }),
      ],
    });

    expect(rows().map((row) => row.textContent?.slice(0, 2))).toEqual(["#2", "#1"]);
  });
});
