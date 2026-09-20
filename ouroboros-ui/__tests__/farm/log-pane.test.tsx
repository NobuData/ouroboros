import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EARLIER_KEY, type LogRow, TAIL_KEY } from "@/app/farm/log-buffer";
import { LogPane, OVERSCAN, cursorRow, originOf } from "@/app/farm/log-pane";

import { PANE_PX, ROW_PX, layOutLogPanes, scrollPane as scrollTo } from "../helpers/log-pane";

/**
 * The log pane as a piece of glass (#261): a bounded DOM over any number of rows, a tail that is
 * followed until the reader scrolls away from it, and a cursor that blinks only for a live build.
 *
 * jsdom lays nothing out, so the scroller's geometry is supplied (`../helpers/log-pane.ts`): a
 * 20px row and a 200px pane — ten rows in view — with `scrollHeight` derived from the row count
 * the component itself publishes.
 */

/** What the pane assumes where nothing can be measured: forty rows in view. */
const ASSUMED_VISIBLE = 40;

/**
 * Rows `from`…`to - 1`, as the buffer would hold them.
 *
 * @param from The first key.
 * @param to One past the last key.
 * @returns The rows.
 */
function lines(from: number, to: number): LogRow[] {
  return Array.from({ length: to - from }, (_, index) => ({
    key: from + index,
    kind: "text" as const,
    text: `line ${String(from + index)}`,
  }));
}

/** @returns The pane's scroller. */
function scroller(): HTMLElement {
  return screen.getByRole("region", { name: "Build log" });
}

/** @returns The text of every rendered row, top to bottom, without the measuring probe. */
function drawn(): string[] {
  return [...document.querySelectorAll(".log-pane__window .log-pane__line")].map((row) => row.textContent ?? "");
}

/**
 * Draw a pane.
 *
 * @param rows The rows.
 * @param live Whether the build runs.
 * @returns The render result, with a `redraw` over new rows.
 */
function draw(rows: readonly LogRow[], live = true) {
  const pane = (next: readonly LogRow[], running: boolean) => (
    <LogPane columns={80} emptyNote="" label="Build log" live={running} rows={next} />
  );
  const result = render(pane(rows, live));

  return {
    ...result,
    redraw: (next: readonly LogRow[], running = live) => result.rerender(pane(next, running)),
  };
}

beforeEach(() => {
  layOutLogPanes();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a bounded DOM", () => {
  it("renders a window of a forty-thousand-line log, not the log", () => {
    draw(lines(0, 40_000));

    expect(drawn().length).toBeLessThanOrEqual(ASSUMED_VISIBLE + 2 * OVERSCAN);
    expect(drawn().at(-1)).toBe("line 39999");
    expect(drawn()).not.toContain("line 0");
  });

  it("stays the same size however long the log grows", () => {
    const { redraw } = draw(lines(0, 1000));
    const before = drawn().length;

    redraw(lines(0, 5000));
    redraw(lines(0, 40_000));

    expect(drawn().length).toBe(before);
  });

  it("publishes the geometry and leaves the lengths to the stylesheet", () => {
    draw(lines(0, 1000));
    const style = scroller().style;

    expect(style.getPropertyValue("--log-pane-rows")).toBe("1000");
    expect(style.getPropertyValue("--log-pane-first")).toBe(String(1000 - ASSUMED_VISIBLE - OVERSCAN));
    expect(style.getPropertyValue("--log-pane-cols")).toBe("80");
    // No pixel geometry is written from script.
    expect(scroller().getAttribute("style")).not.toMatch(/px/);
  });

  it("appends without re-painting: the rows already drawn are the same nodes afterwards", () => {
    const { redraw } = draw(lines(0, 20));
    const before = [...document.querySelectorAll(".log-pane__window .log-pane__line")];

    redraw(lines(0, 25));
    const after = [...document.querySelectorAll(".log-pane__window .log-pane__line")];

    expect(after).toHaveLength(25);
    before.forEach((node, index) => expect(after[index]).toBe(node));
  });

  it("changes one text node when the open line grows", () => {
    const { redraw } = draw([...lines(0, 3), { key: 3, kind: "text", text: "[6/7] Linking" }]);
    const open = document.querySelectorAll(".log-pane__window .log-pane__line")[3]!;

    redraw([...lines(0, 3), { key: 3, kind: "text", text: "[6/7] Linking zephyr.elf …" }]);

    expect(document.querySelectorAll(".log-pane__window .log-pane__line")[3]).toBe(open);
    expect(open.textContent).toBe("[6/7] Linking zephyr.elf …");
  });

  it("measures its own row, so the arithmetic is right at a larger font size", async () => {
    const observers: (() => void)[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          observers.push(callback);
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 25 } as DOMRect);

    draw(lines(0, 1000));
    // 200px of pane over a 25px row is eight rows in view.
    await act(async () => observers.forEach((callback) => callback()));

    expect(scroller().style.getPropertyValue("--log-pane-first")).toBe(String(1000 - 8 - OVERSCAN));
  });
});

describe("following the tail", () => {
  it("starts at the end", () => {
    draw(lines(0, 500));

    expect(scroller().scrollTop).toBe(500 * ROW_PX);
  });

  it("stays at the end as output arrives", () => {
    const { redraw } = draw(lines(0, 500));

    redraw(lines(0, 540));

    expect(scroller().scrollTop).toBe(540 * ROW_PX);
    expect(drawn().at(-1)).toBe("line 539");
  });
});

describe("scroll lock", () => {
  it("locks when the reader scrolls up: new output no longer moves them", () => {
    const { redraw } = draw(lines(0, 500));

    scrollTo(scroller(), 100 * ROW_PX);
    redraw(lines(0, 540));
    redraw(lines(0, 600));

    expect(scroller().scrollTop).toBe(100 * ROW_PX);
  });

  it("honours a scroll the browser has not reported yet: a page landing mid-gesture pins nothing", () => {
    const { redraw } = draw(lines(0, 500));
    const pane = scroller();

    // The wheel has moved the scroller; the `scroll` event is still to be dispatched.
    pane.scrollTop = 100 * ROW_PX;
    redraw(lines(0, 540));

    expect(pane.scrollTop).toBe(100 * ROW_PX);

    // The event arrives, and the pane is locked where the reader put it.
    scrollTo(pane, 100 * ROW_PX);
    redraw(lines(0, 580));
    expect(pane.scrollTop).toBe(100 * ROW_PX);
    expect(drawn()).toContain("line 100");
  });

  it("still follows after an unreported scroll that turns out to have stayed at the tail", () => {
    const { redraw } = draw(lines(0, 500));
    const pane = scroller();

    pane.scrollTop = 100 * ROW_PX;
    redraw(lines(0, 540));
    // The reader came straight back to the bottom before anything was reported.
    scrollTo(pane, 540 * ROW_PX - PANE_PX);
    redraw(lines(0, 580));

    expect(pane.scrollTop).toBe(580 * ROW_PX);
  });

  it("draws the rows the reader is looking at while locked, not the tail", () => {
    const { redraw } = draw(lines(0, 500));

    scrollTo(scroller(), 100 * ROW_PX);
    redraw(lines(0, 600));

    expect(drawn()).toContain("line 100");
    expect(drawn()).toContain("line 110");
    expect(drawn()).not.toContain("line 599");
  });

  it("resumes when the reader returns to the bottom", () => {
    const { redraw } = draw(lines(0, 500));
    const pane = scroller();

    scrollTo(pane, 100 * ROW_PX);
    redraw(lines(0, 540));
    expect(pane.scrollTop).toBe(100 * ROW_PX);

    scrollTo(pane, 540 * ROW_PX - PANE_PX);
    redraw(lines(0, 580));

    expect(pane.scrollTop).toBe(580 * ROW_PX);
    expect(drawn().at(-1)).toBe("line 579");
  });

  it("counts within half a row of the end as the end, so a fractional position does not lock", () => {
    const { redraw } = draw(lines(0, 500));
    const pane = scroller();

    scrollTo(pane, 500 * ROW_PX - PANE_PX - ROW_PX / 2);
    redraw(lines(0, 520));

    expect(pane.scrollTop).toBe(520 * ROW_PX);
  });

  it("keeps a locked reader's lines in place when older rows leave the head", () => {
    const { redraw } = draw(lines(0, 500));
    const pane = scroller();

    scrollTo(pane, 100 * ROW_PX);
    expect(drawn()).toContain("line 100");

    // The bounded buffer drops forty rows and gains forty: same length, new origin.
    redraw(lines(40, 540));

    // The scroller moved back by exactly the height that left…
    expect(pane.scrollTop).toBe(60 * ROW_PX);
    // …and the window moved with it in the same render — no frame of the wrong rows.
    expect(drawn()).toContain("line 100");
    expect(drawn()).toContain("line 110");
  });

  it("stops at the top when the rows a locked reader was on have left altogether", () => {
    const { redraw } = draw(lines(0, 500));
    const pane = scroller();

    scrollTo(pane, 10 * ROW_PX);
    redraw(lines(400, 900));

    expect(pane.scrollTop).toBe(0);
    expect(drawn()[0]).toBe("line 400");
  });
});

describe("the cursor", () => {
  it("follows the last line of output, which is drawn in the accent", () => {
    draw(lines(0, 5));
    const last = document.querySelector(".log-pane__line--last")!;

    expect(last.textContent).toBe("line 4");
    expect(last.querySelector(".log-pane__cursor")).not.toBeNull();
    expect(document.querySelectorAll(".log-pane__cursor")).toHaveLength(1);
  });

  it("blinks while the build is live", () => {
    draw(lines(0, 5), true);

    expect(document.querySelector(".log-pane__cursor")).toHaveClass("log-pane__cursor--live");
  });

  it("freezes on a finished build: still drawn, no longer moving", () => {
    draw(lines(0, 5), false);
    const cursor = document.querySelector(".log-pane__cursor")!;

    expect(cursor).toBeInTheDocument();
    expect(cursor).not.toHaveClass("log-pane__cursor--live");
  });

  it("freezes the moment the flag flips, with no new output at all", () => {
    const rows = lines(0, 5);
    const { redraw } = draw(rows, true);

    redraw(rows, false);

    expect(document.querySelector(".log-pane__cursor")).not.toHaveClass("log-pane__cursor--live");
  });

  it("is hidden from a screen reader: the pill says what it says", () => {
    draw(lines(0, 5));

    expect(document.querySelector(".log-pane__cursor")).toHaveAttribute("aria-hidden", "true");
  });

  it("stays on the build's last line when the pane's own marker follows it", () => {
    draw([...lines(0, 3), { key: TAIL_KEY, kind: "gap", text: "[… 9 bytes elided — log cap reached]" }]);

    expect(document.querySelector(".log-pane__line--last")!.textContent).toBe("line 2");
  });
});

describe("rows that are not output", () => {
  it("draws a hole distinctly from the output either side of it", () => {
    draw([
      { key: 0, kind: "text", text: "[4/7] Building" },
      { key: 1, kind: "gap", text: "[… 2,481,392 bytes elided]" },
      { key: 2, kind: "text", text: "[6/7] Linking" },
    ]);
    const rows = [...document.querySelectorAll(".log-pane__window .log-pane__line")];

    expect(rows[1]).toHaveClass("log-pane__line--gap");
    expect(rows[1]!.querySelector(".log-pane__gap")!.textContent).toBe("[… 2,481,392 bytes elided]");
    expect(rows[0]).not.toHaveClass("log-pane__line--gap");
    expect(rows[2]).not.toHaveClass("log-pane__line--gap");
  });

  it("draws the pane's own note in its own treatment", () => {
    draw([{ key: EARLIER_KEY, kind: "note", text: "[… earlier output]" }, ...lines(7, 9)]);

    expect(document.querySelector(".log-pane__line--note")!.textContent).toBe("[… earlier output]");
  });

  it("is a cursor and nothing else while a live build has printed nothing", () => {
    draw([], true);

    expect(drawn()).toEqual([""]);
    expect(document.querySelector(".log-pane__cursor")).toHaveClass("log-pane__cursor--live");
  });

  it("says what it was told to when there are no rows to draw", () => {
    render(<LogPane columns={0} emptyNote="This build printed nothing." label="Build log" live={false} rows={[]} />);

    expect(drawn()).toEqual(["This build printed nothing."]);
    expect(document.querySelector(".log-pane__cursor")).not.toHaveClass("log-pane__cursor--live");
  });
});

describe("the pane", () => {
  it("is a named region a keyboard can reach and scroll", () => {
    draw(lines(0, 5));

    expect(scroller()).toHaveAttribute("tabindex", "0");
  });

  it("takes the sheet's height when asked", () => {
    render(<LogPane columns={0} emptyNote="" label="Build log" live rows={[]} tall />);

    expect(document.querySelector(".log-pane")).toHaveClass("log-pane--tall");
  });

  it("keeps its measuring row out of the accessibility tree", () => {
    draw(lines(0, 5));

    expect(document.querySelector(".log-pane__probe")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("originOf", () => {
  it("is the first row's key, and one less under the note about earlier output", () => {
    expect(originOf([])).toBe(0);
    expect(originOf(lines(40, 50))).toBe(40);
    expect(originOf([{ key: EARLIER_KEY, kind: "note", text: "…" }, ...lines(40, 50)])).toBe(39);
  });

  it("is zero for a pane holding only its own note", () => {
    expect(originOf([{ key: EARLIER_KEY, kind: "note", text: "…" }])).toBe(0);
  });
});

describe("cursorRow", () => {
  it("is the last row the build printed, or none", () => {
    expect(cursorRow(lines(0, 3))).toBe(2);
    expect(cursorRow([...lines(0, 3), { key: TAIL_KEY, kind: "gap", text: "…" }])).toBe(2);
    expect(cursorRow([{ key: 0, kind: "gap", text: "…" }])).toBeNull();
    expect(cursorRow([])).toBeNull();
  });
});
