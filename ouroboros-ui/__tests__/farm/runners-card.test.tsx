import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FarmPage } from "@/app/api/farm";
import type { FarmPollOptions } from "@/app/farm/farm-poll";
import { FarmScreen } from "@/app/farm/farm-screen";
import {
  BEARER_FALLBACK_NOTE,
  GROUP_BY_STATUS,
  HEALTH_HISTORY,
  HEALTH_HISTORY_SOON,
  JOB_SHEET_CLOSE,
  JOB_SHEET_NOTE,
  NO_RUNNERS_TITLE,
  RUNNERS_CAPTION,
  RUNNERS_TITLE,
  RUNNERS_UNREAD_TITLE,
  RUNNER_ACTIONS_SOON,
  RUNNER_COLUMNS,
  runnerActionsLabel,
} from "@/app/farm/runners";
import { NOT_MEASURED, SOON_MARK } from "@/app/farm/view";
import type { PollAnswer } from "@/app/poll";

import {
  emptyFarm,
  failedFarmReadings,
  farmReadings,
  farmRunner,
  runnerTelemetry,
  seededFarm,
} from "../helpers/farm";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The runners table as it is drawn (#257): mockup 08's `RUNNERS` card from the seeded farm, row
 * for row; the dimmed offline row and its em dashes; null telemetry; the bearer-fallback affix;
 * the CPU warning; the grouping; the keyboard; the honest *soon* controls; and the job sheet.
 *
 * What every cell *says* is `runners.test.ts`'s. How the table behaves as the poll moves under it
 * — no flicker, no full-row re-render — is `runners-live.test.tsx`'s.
 */

/** A poll that never answers, so a case draws exactly what the server read. */
const QUIET: FarmPollOptions = { read: () => new Promise(() => {}), visible: () => true };

/** What the live poll answers. Reassigned by the cases that care. */
let answer: PollAnswer<FarmPage>;

/** A poll that answers {@link answer}, at the fleet's cadence. */
const LIVE: FarmPollOptions = { read: () => Promise.resolve(answer), visible: () => true };

/**
 * Draw the screen over a page.
 *
 * @param page The page the first paint read. Defaults to the seeded farm.
 * @param poll The poll. Defaults to one that never answers.
 * @returns The render result.
 */
function draw(page: FarmPage = seededFarm(), poll: FarmPollOptions = QUIET) {
  return render(<FarmScreen poll={poll} readings={farmReadings(page)} />);
}

/** The runners card. */
function card(): HTMLElement {
  return screen.getByRole("region", { name: RUNNERS_TITLE });
}

/** The table's body rows, in drawn order. */
function bodyRows(): HTMLElement[] {
  return within(card()).getAllByRole("row").slice(1);
}

/**
 * One row, by its runner's name.
 *
 * @param name The runner's name.
 * @returns The row.
 */
function rowFor(name: string): HTMLElement {
  const row = bodyRows().find((candidate) => within(candidate).queryByText(name) !== null);
  if (row === undefined) throw new Error(`no row for ${name}`);

  return row;
}

/**
 * A row's cells as the reader sees them — visible text only, so the affix's hidden sentence and
 * the inert control's name do not blur what the mockup draws.
 *
 * @param row The row.
 * @returns One string per cell.
 */
function cellsOf(row: HTMLElement): string[] {
  // By element: a `td` in a grid is a `gridcell` to a browser (HTML-AAM), and a `cell` to
  // Testing Library's role table, which does not look at the table's own role.
  return [...row.querySelectorAll("td")].map((cell) => {
    const copy = cell.cloneNode(true) as HTMLElement;
    for (const hidden of copy.querySelectorAll(".sr-only")) hidden.remove();

    // Text node by text node, joined by a space: the name and its architecture line are two
    // blocks with no whitespace between them, which `textContent` would run together.
    const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? "");

    return parts.join(" ").replace(/\s+/g, " ").trim();
  });
}

/** The card's polite region, where the current row is said out loud. */
function announcement(): HTMLElement {
  return within(card()).getByRole("status");
}

beforeEach(() => {
  answer = { state: "fresh", payload: seededFarm(), etag: null, pollAfterSeconds: 10 };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the card", () => {
  it("is a region named by its heading, with the mockup's live pill beside it", () => {
    draw();

    expect(within(card()).getByRole("heading", { level: 2 })).toHaveTextContent(RUNNERS_TITLE);
    const pill = within(card()).getByText("1 building");
    expect(pill).toHaveClass("ou-chip--accent");
    expect(pill.querySelector(".ou-chip__dot--pulse")).not.toBeNull();
  });

  it("draws no live pill over a fleet at rest", () => {
    draw(seededFarm({ runners: [farmRunner()] }));

    expect(within(card()).queryByText(/building/)).toBeNull();
  });

  it("names the table for a reader moving by landmark, and heads its nine columns", () => {
    draw();

    const table = within(card()).getByRole("grid", { name: RUNNERS_CAPTION });
    expect(within(table).getAllByRole("columnheader").map((head) => head.textContent)).toEqual(
      Object.values(RUNNER_COLUMNS),
    );
  });

  it("sits in the grid at the mockup's eight columns, under the stat row", () => {
    draw();

    expect(card()).toHaveClass("farm-col--8");
    expect(card().parentElement).toHaveClass("farm__grid");
    expect(card().previousElementSibling).toHaveAttribute("aria-label", "Cache hit rate");
  });
});

describe("the seeded table", () => {
  it("matches the mockup row for row, in the mockup's order once grouped by status", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: GROUP_BY_STATUS }));

    expect(bodyRows().map(cellsOf)).toEqual([
      ["forge-01 linux/arm64", "pool-a", "building", "#479 zephyr build", "82%", "14.2/32 GB", "q:2", "41d", "⋯"],
      ["forge-02 linux/arm64", "pool-a", "idle", NOT_MEASURED, "3%", "2.1/32 GB", "q:0", "41d", "⋯"],
      ["anvil-mac darwin/arm64", "pool-b", "idle", NOT_MEASURED, "6%", "5.0/64 GB", "q:0", "12d", "⋯"],
      ["bigiron linux/x86_64", "pool-b", "draining", "#472 HIL test rig · finishing", "54%", "88/256 GB", "q:1", "3d", "⋯"],
      ["forge-03 linux/arm64", "pool-a", "offline last seen 2h ago", NOT_MEASURED, NOT_MEASURED, NOT_MEASURED, "q:0", NOT_MEASURED, "⋯"],
    ]);
  });

  it("stands in pool-then-name order by default, so a row never moves because a build started", () => {
    draw();

    expect(bodyRows().map((row) => cellsOf(row)[0])).toEqual([
      "forge-01 linux/arm64",
      "forge-02 linux/arm64",
      "forge-03 linux/arm64",
      "anvil-mac darwin/arm64",
      "bigiron linux/x86_64",
    ]);
  });

  it("draws each status as the mockup's pill — hue, word and dot", () => {
    draw();

    const pill = (name: string, word: string) => within(rowFor(name)).getByText(word);
    expect(pill("forge-01", "building")).toHaveClass("ou-chip--accent");
    expect(pill("forge-01", "building").querySelector(".ou-chip__dot--pulse")).not.toBeNull();
    expect(pill("forge-02", "idle").className).toBe("ou-chip");
    expect(pill("bigiron", "draining")).toHaveClass("ou-chip--warn");
    expect(pill("forge-03", "offline")).toHaveClass("ou-chip--err");
  });

  it("draws the pool as a tag and the figures in the mono, end-aligned columns", () => {
    draw();

    expect(within(rowFor("forge-01")).getByText("pool-a")).toHaveClass("ou-tag");
    const ram = within(rowFor("forge-01")).getByText("14.2/32 GB");
    expect(ram).toHaveClass("ou-table__cell--mono", "ou-table__cell--end");
  });
});

describe("the offline row", () => {
  it("is dimmed, and no connected row is", () => {
    draw();

    expect(rowFor("forge-03")).toHaveClass("farm-runners__row--dim");
    for (const name of ["forge-01", "forge-02", "anvil-mac", "bigiron"]) {
      expect(rowFor(name)).not.toHaveClass("farm-runners__row--dim");
    }
  });

  it("draws no meter at all — an empty bar would be a picture of 0%", () => {
    draw();

    expect(rowFor("forge-03").querySelector(".ou-meter")).toBeNull();
    expect(card().querySelectorAll(".ou-meter")).toHaveLength(4);
  });

  it("does not render last-known figures as current, even when the payload still carries them", () => {
    const page = seededFarm();
    const runners = page.runners.map((runner) =>
      runner.name === "forge-01"
        ? { ...runner, status: "offline" as const, lastSeenAt: "2026-09-19T12:02:00.000Z" }
        : runner,
    );
    draw({ ...page, runners });

    const cells = cellsOf(rowFor("forge-01"));
    expect(cells.slice(4, 6)).toEqual([NOT_MEASURED, NOT_MEASURED]);
    expect(cells[7]).toBe(NOT_MEASURED);
    expect(rowFor("forge-01")).not.toHaveTextContent("82%");
    expect(rowFor("forge-01")).toHaveTextContent("last seen 2h ago");
  });
});

describe("null telemetry", () => {
  it("renders a metric the platform cannot report as an em dash, never as zero", () => {
    const page = seededFarm({
      runners: [farmRunner({ name: "anvil-mac", telemetry: runnerTelemetry(null, null, null, null), uptimeSeconds: null })],
    });
    draw(page);

    const cells = cellsOf(rowFor("anvil-mac"));
    expect(cells.slice(4, 6)).toEqual([NOT_MEASURED, NOT_MEASURED]);
    expect(cells[7]).toBe(NOT_MEASURED);
    expect(rowFor("anvil-mac")).not.toHaveTextContent(/\b0%|\b0\.0|\b0s\b/);
    expect(rowFor("anvil-mac").querySelector(".ou-meter")).toBeNull();
    // Connected, so not dimmed: the machine is fine, one of its gauges is missing.
    expect(rowFor("anvil-mac")).not.toHaveClass("farm-runners__row--dim");
  });

  it("draws the metrics it has beside the one it lacks", () => {
    draw(seededFarm({ runners: [farmRunner({ telemetry: runnerTelemetry(null, 5, 64) })] }));

    const cells = cellsOf(rowFor("forge-02"));
    expect(cells[4]).toBe(NOT_MEASURED);
    expect(cells[5]).toBe("5.0/64 GB");
  });

  it("keeps a measured zero a zero, with its meter", () => {
    draw(seededFarm({ runners: [farmRunner({ telemetry: runnerTelemetry(0, 0, 32) })] }));

    expect(cellsOf(rowFor("forge-02")).slice(4, 6)).toEqual(["0%", "0.0/32 GB"]);
    expect(rowFor("forge-02").querySelector(".ou-meter")).not.toBeNull();
  });
});

describe("the CPU warning", () => {
  it("engages on the mockup's 82% row, and only there", () => {
    draw();

    expect(rowFor("forge-01").querySelector(".ou-meter")).toHaveClass("ou-meter--warn");
    expect(rowFor("bigiron").querySelector(".ou-meter")?.className).toBe("ou-meter farm-runners__cpu-meter");
    expect(rowFor("forge-02").querySelector(".ou-meter")).toHaveClass("ou-meter--ok");
    expect(card().querySelectorAll(".ou-meter--warn")).toHaveLength(1);
  });

  it("engages at exactly 80", () => {
    draw(
      seededFarm({
        runners: [
          farmRunner({ id: "a", name: "at-79", telemetry: runnerTelemetry(79, 1, 32) }),
          farmRunner({ id: "b", name: "at-80", telemetry: runnerTelemetry(80, 1, 32) }),
        ],
      }),
    );

    expect(rowFor("at-79").querySelector(".ou-meter")).not.toHaveClass("ou-meter--warn");
    expect(rowFor("at-80").querySelector(".ou-meter")).toHaveClass("ou-meter--warn");
  });

  it("draws the meter as a picture of the figure beside it, not a second announcement", () => {
    draw();

    const meter = rowFor("forge-01").querySelector(".ou-meter");
    expect(meter).toHaveAttribute("aria-hidden", "true");
    expect(meter?.querySelector(".ou-meter__fill")?.getAttribute("style")).toContain("--ou-meter-fill: 82%");
  });
});

describe("the security affix", () => {
  it("marks the bearer-fallback runner, in words as well as in a glyph", () => {
    draw();

    const affix = rowFor("anvil-mac").querySelector(".farm-runners__shield");
    expect(affix).toHaveAttribute("title", BEARER_FALLBACK_NOTE);
    expect(affix).toHaveTextContent(BEARER_FALLBACK_NOTE);
    expect(affix?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("marks no mTLS runner", () => {
    draw();

    expect(card().querySelectorAll(".farm-runners__shield")).toHaveLength(1);
  });

  it("leaves the status pill alone — the machine is still up", () => {
    draw();

    expect(within(rowFor("anvil-mac")).getByText("idle").className).toBe("ou-chip");
  });
});

describe("grouping", () => {
  it("is a pressed-state control, off on arrival, that the reader can turn back off", () => {
    draw();
    const control = screen.getByRole("button", { name: GROUP_BY_STATUS });

    expect(control).toHaveAttribute("aria-pressed", "false");
    expect(control).not.toHaveTextContent("✓");
    fireEvent.click(control);
    expect(control).toHaveAttribute("aria-pressed", "true");
    // Said without the hue, and without changing the control's name.
    expect(control).toHaveTextContent("✓");
    expect(screen.getByRole("button", { name: GROUP_BY_STATUS })).toBe(control);
    expect(cellsOf(bodyRows()[4]!)[0]).toBe("forge-03 linux/arm64");

    fireEvent.click(control);
    expect(control).toHaveAttribute("aria-pressed", "false");
    expect(cellsOf(bodyRows()[2]!)[0]).toBe("forge-03 linux/arm64");
  });

  it("reorders the rows it has rather than drawing new ones", () => {
    draw();
    const before = rowFor("forge-03");

    fireEvent.click(screen.getByRole("button", { name: GROUP_BY_STATUS }));

    expect(rowFor("forge-03")).toBe(before);
  });
});

describe("the keyboard", () => {
  it("puts exactly one row in the tab order, and selects nothing on arrival", () => {
    draw();

    expect(bodyRows().map((row) => row.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    expect(bodyRows().every((row) => row.getAttribute("aria-selected") === "false")).toBe(true);
    expect(announcement()).toBeEmptyDOMElement();
  });

  it("moves between rows with the arrows, Home and End, taking focus along", () => {
    draw();
    const [first, second, , , last] = bodyRows();

    first!.focus();
    fireEvent.keyDown(first!, { key: "ArrowDown" });
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(bodyRows().map((row) => row.tabIndex)).toEqual([-1, 0, -1, -1, -1]);

    fireEvent.keyDown(second!, { key: "End" });
    expect(last).toHaveFocus();

    fireEvent.keyDown(last!, { key: "Home" });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first!, { key: "ArrowUp" });
    expect(first).toHaveFocus();
  });

  it("announces the row it lands on — its state, its build, and a degraded connection", () => {
    draw();
    const rows = bodyRows();

    fireEvent.keyDown(rows[0]!, { key: "Enter" });
    expect(announcement()).toHaveTextContent("forge-01, pool-a, building, #479 zephyr build");

    fireEvent.keyDown(rows[0]!, { key: "End" });
    expect(announcement()).toHaveTextContent("bigiron, pool-b, draining, #472 HIL test rig · finishing");

    fireEvent.keyDown(rows[4]!, { key: "ArrowUp" });
    expect(announcement()).toHaveTextContent("anvil-mac, pool-b, idle, bearer-token fallback");

    fireEvent.keyDown(rows[3]!, { key: "ArrowUp" });
    expect(announcement()).toHaveTextContent("forge-03, pool-a, offline, last seen 2h ago");
  });

  it("announces a row picked with the pointer too, which moves no focus", () => {
    draw();

    fireEvent.click(rowFor("forge-02"));

    expect(rowFor("forge-02")).toHaveAttribute("aria-selected", "true");
    expect(announcement()).toHaveTextContent("forge-02, pool-a, idle");
  });

  it("keeps the announcement current as the selected row's state changes under it", async () => {
    vi.useFakeTimers();
    draw(seededFarm(), LIVE);
    fireEvent.click(rowFor("forge-02"));

    const page = seededFarm();
    answer = {
      state: "fresh",
      payload: {
        ...page,
        runners: page.runners.map((runner) =>
          runner.name === "forge-02" ? { ...runner, status: "draining" as const } : runner,
        ),
      },
      etag: null,
      pollAfterSeconds: 10,
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(announcement()).toHaveTextContent("forge-02, pool-a, draining");
  });

  it("drops a selection whose runner has left the fleet, so the table stays reachable", async () => {
    vi.useFakeTimers();
    draw(seededFarm(), LIVE);
    fireEvent.click(rowFor("bigiron"));

    const page = seededFarm();
    answer = {
      state: "fresh",
      payload: { ...page, runners: page.runners.filter((runner) => runner.name !== "bigiron") },
      etag: null,
      pollAfterSeconds: 10,
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(bodyRows()).toHaveLength(4);
    expect(bodyRows().map((row) => row.tabIndex)).toEqual([0, -1, -1, -1]);
    expect(announcement()).toBeEmptyDOMElement();
  });
});

describe("what cannot act yet", () => {
  it("draws Health history as an honest soon that navigates nowhere", () => {
    const { container } = draw();
    const control = within(card()).getByRole("button", { name: `${HEALTH_HISTORY} ${SOON_MARK}` });

    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(control).toHaveAttribute("title", HEALTH_HISTORY_SOON);
    expect(HEALTH_HISTORY_SOON).toContain("#266");
    expect(control).not.toHaveAttribute("href");
    // No link on the page at all: nothing here can navigate to a dead route.
    expect(container.querySelector("a")).toBeNull();
  });

  it("draws each row's ⋯ as inert, named for its machine, and out of the tab order", () => {
    draw();

    for (const name of ["forge-01", "forge-02", "forge-03", "anvil-mac", "bigiron"]) {
      const control = within(rowFor(name)).getByRole("button", { name: runnerActionsLabel(name) });

      expect(control).toHaveAttribute("aria-disabled", "true");
      expect(control).toHaveAttribute("title", RUNNER_ACTIONS_SOON);
      expect(control).toHaveAttribute("tabindex", "-1");
    }
    expect(RUNNER_ACTIONS_SOON).toContain("#260");
  });
});

describe("the current-job cell", () => {
  /** The cell's control for a job number. */
  function jobControl(number: string): HTMLElement {
    return within(card()).getByRole("button", { name: new RegExp(`^${number} `) });
  }

  it("is a button carrying the job's title, in the tab order — it is the one thing in the row that acts", () => {
    draw();

    expect(jobControl("#479")).toHaveAttribute("title", "Add OTA rollback on failed checksum");
    expect(jobControl("#479")).not.toHaveAttribute("tabindex");
    expect(jobControl("#472")).toHaveTextContent("#472 HIL test rig · finishing");
  });

  it("opens the job sheet — what the farm knows about the build, and that the console is coming", () => {
    draw();

    fireEvent.click(jobControl("#479"));

    const sheet = screen.getByRole("dialog", { name: "Build job #479" });
    expect(within(sheet).getByRole("heading", { level: 2 })).toHaveTextContent("Add OTA rollback on failed checksum");
    expect(sheet).toHaveTextContent("forge-01 · linux/arm64");
    expect(sheet).toHaveTextContent("pool-a");
    expect(sheet).toHaveTextContent("Running for3m");
    expect(sheet).toHaveTextContent(JOB_SHEET_NOTE);
    expect(JOB_SHEET_NOTE).toContain("#309");
    expect(sheet.querySelector("a")).toBeNull();
  });

  it("closes from its own control and on Escape", () => {
    draw();

    fireEvent.click(jobControl("#479"));
    fireEvent.click(screen.getByRole("button", { name: JOB_SHEET_CLOSE }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(jobControl("#472"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not let a key pressed on it move the row selection underneath", () => {
    draw();

    fireEvent.keyDown(jobControl("#479"), { key: "ArrowDown" });

    expect(bodyRows().every((row) => row.getAttribute("aria-selected") === "false")).toBe(true);
  });

  it("closes by itself when the build ends, rather than becoming a sheet about another build", async () => {
    vi.useFakeTimers();
    draw(seededFarm(), LIVE);
    fireEvent.click(jobControl("#479"));

    const page = seededFarm();
    answer = {
      state: "fresh",
      payload: {
        ...page,
        runners: page.runners.map((runner) =>
          runner.name === "forge-01"
            ? { ...runner, currentJob: { ...runner.currentJob!, id: "next", number: 480 } }
            : runner,
        ),
      },
      etag: null,
      pollAfterSeconds: 10,
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(jobControl("#480")).toBeInTheDocument();
  });
});

describe("scrolling", () => {
  it("puts the table inside its own wrapper, so the content pane never scrolls sideways", () => {
    draw();
    const table = within(card()).getByRole("grid");

    expect(table.parentElement).toHaveClass("ou-table-scroll", "farm-runners");
    // Not the opened (sticky-header) variant, which hands sideways scroll back to the pane.
    expect(table.parentElement).not.toHaveClass("ou-table-scroll--open");
  });
});

describe("the other states", () => {
  it("says so over an empty fleet, and draws no table", () => {
    draw(emptyFarm());

    expect(within(card()).getByText(NO_RUNNERS_TITLE)).toBeInTheDocument();
    expect(within(card()).queryByRole("grid")).toBeNull();
  });

  it("says what could not be read, and leaves the why to the banner", () => {
    render(<FarmScreen poll={QUIET} readings={failedFarmReadings("Choose a workspace.")} />);

    expect(within(card()).getByText(RUNNERS_UNREAD_TITLE)).toBeInTheDocument();
    expect(within(card()).queryByText(/Choose a workspace/)).toBeNull();
  });
});

describe("both themes", () => {
  it("renders the same markup under either palette, dimmed row and affix included", () => {
    const [light, dark] = renderInBothPalettes(<FarmScreen poll={QUIET} readings={farmReadings()} />);

    expect(light).toContain("farm-runners__row--dim");
    expect(light).toContain("farm-runners__shield");
    expect(maskIds(light!)).toBe(maskIds(dark!));
  });

  it("writes no inline style but a meter's fill, so every size is the sheet's rem", () => {
    draw();

    for (const styled of card().querySelectorAll("[style]")) expect(styled).toHaveClass("ou-meter__fill");
  });
});
