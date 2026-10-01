import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TimeSeries, type TimeSeriesPoint } from "@/app/charts";
import { moneyOfCents } from "@/app/format";

/**
 * The line-and-area chart (#442): the four combinations of its optional marks, the series
 * that have almost nothing in them, and the two ways to reach a day's detail.
 */

/** A week of figures, with the tooltip's detail on each. */
const WEEK: readonly TimeSeriesPoint[] = [3, 1, 4, 1, 5, 9, 6].map((value, index) => ({
  label: `Aug ${index + 1}`,
  value,
  meta: `${value} merged`,
}));

const LABEL = "Merged PRs per day, last 7 days, ending at 6";

/**
 * Render a series and return its container.
 *
 * @param props Anything to add to the week's series.
 * @returns The render's container.
 */
function draw(props: Partial<Parameters<typeof TimeSeries>[0]> = {}): HTMLElement {
  return render(<TimeSeries label={LABEL} points={WEEK} {...props} />).container;
}

describe("what a screen reader is told", () => {
  it("names the chart as one image, by the label that states its headline", () => {
    draw();

    expect(screen.getByRole("img", { name: LABEL })).toBeInTheDocument();
  });

  it("names every day's column by the tooltip's own sentence", () => {
    draw();

    expect(screen.getByRole("button", { name: "Aug 4 — 1 merged" })).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(7);
  });

  it("falls back to the formatted value when a day carries no detail", () => {
    render(
      <TimeSeries
        label="Daily cost"
        points={[{ label: "Aug 1", value: 1860 }]}
        formatValue={moneyOfCents}
      />,
    );

    expect(screen.getByRole("button", { name: "Aug 1 — $18.60" })).toBeInTheDocument();
  });
});

describe("the optional marks", () => {
  const guide = { value: 8, label: "8 target" };
  const annotation = { index: 5, label: "9 — release day" };

  it("draws neither by default", () => {
    const container = draw();

    expect(container.querySelector("[data-chart-guide]")).toBeNull();
    expect(container.querySelector("[data-chart-annotation]")).toBeNull();
    expect(container.querySelector(".chart-ts__line")).not.toBeNull();
  });

  it("draws a dashed guide with its own label", () => {
    const container = draw({ guide });

    expect(container.querySelector("[data-chart-guide] .chart-ts__guide")).not.toBeNull();
    expect(container.querySelector("[data-chart-guide]")).toHaveTextContent("8 target");
    expect(container.querySelector("[data-chart-annotation]")).toBeNull();
  });

  it("draws an annotated point with a dot and its label", () => {
    const container = draw({ annotation });

    expect(container.querySelector("[data-chart-annotation] circle")).not.toBeNull();
    expect(container.querySelector("[data-chart-annotation]")).toHaveTextContent("9 — release day");
    expect(container.querySelector("[data-chart-guide]")).toBeNull();
  });

  it("draws both together", () => {
    const container = draw({ guide, annotation });

    expect(container.querySelector("[data-chart-guide]")).not.toBeNull();
    expect(container.querySelector("[data-chart-annotation]")).not.toBeNull();
  });

  it("ignores an annotation pointing past the series rather than throwing", () => {
    const container = draw({ annotation: { index: 40, label: "nowhere" } });

    expect(container.querySelector("[data-chart-annotation]")).toBeNull();
  });

  it("keeps a guide above the series inside the plot", () => {
    const container = draw({ guide: { value: 18, label: "18 ceiling" } });
    const y = Number(container.querySelector(".chart-ts__guide")?.getAttribute("y1"));

    expect(y).toBeGreaterThan(0);
  });
});

describe("the endpoint", () => {
  it("is labelled directly with the latest value", () => {
    const container = draw();

    expect(container.querySelector("[data-chart-endpoint]")).toHaveTextContent("6");
  });

  it("uses the chart's own formatter", () => {
    const container = draw({ formatValue: (value) => `${value} PRs` });

    expect(container.querySelector("[data-chart-endpoint]")).toHaveTextContent("6 PRs");
  });
});

describe("the sparse ticks", () => {
  it("labels three days of a long series, the last one always", () => {
    const month = Array.from({ length: 30 }, (_, index) => ({ label: `d${index}`, value: index }));
    const container = render(<TimeSeries label="Month" points={month} />).container;
    const ticks = [...container.querySelectorAll("[data-chart-ticks] text")];

    expect(ticks.map((tick) => tick.textContent)).toEqual(["d2", "d15", "d29"]);
    expect(ticks.at(-1)?.getAttribute("text-anchor")).toBe("end");
  });

  it("takes explicit ticks, dropping any out of range", () => {
    const container = draw({ ticks: [0, 3, 99] });
    const ticks = [...container.querySelectorAll("[data-chart-ticks] text")];

    expect(ticks.map((tick) => tick.textContent)).toEqual(["Aug 1", "Aug 4"]);
  });
});

describe("the series with almost nothing in it", () => {
  it("draws an empty series as a frame with no line, no endpoint and no stops", () => {
    const container = render(<TimeSeries label="No data yet" points={[]} />).container;

    expect(screen.getByRole("img", { name: "No data yet" })).toBeInTheDocument();
    expect(container.querySelector(".chart-ts__baseline")).not.toBeNull();
    expect(container.querySelector(".chart-ts__line")).toBeNull();
    expect(container.querySelector("[data-chart-endpoint]")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("draws a single point as a labelled dot, with no line and no area", () => {
    const container = render(
      <TimeSeries label="One day" points={[{ label: "Aug 8", value: 6 }]} />,
    ).container;

    expect(container.querySelector(".chart-ts__line")).toBeNull();
    expect(container.querySelector(".chart-ts__area")).toBeNull();
    expect(container.querySelector("[data-chart-endpoint]")).toHaveTextContent("6");
    expect(container.querySelector("[data-chart-ticks]")).toHaveTextContent("Aug 8");
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("draws a series of zeroes on the baseline rather than off the chart", () => {
    const container = render(
      <TimeSeries label="Quiet" points={[{ label: "a", value: 0 }, { label: "b", value: 0 }]} />,
    ).container;
    const baseline = container.querySelector(".chart-ts__baseline")?.getAttribute("y1");

    expect(container.querySelector(".chart-ts__line")?.getAttribute("points")).toBe(
      `10,${baseline} 630,${baseline}`,
    );
  });
});

describe("the crosshair and its tooltip", () => {
  it("draws nothing until a day is pointed at", () => {
    const container = draw();

    expect(container.querySelector("[data-chart-crosshair]")).toBeNull();
    expect(container.querySelector(".chart-tip")).toBeNull();
  });

  it("follows the pointer, and goes when the pointer leaves", () => {
    const container = draw();
    const day = screen.getByRole("button", { name: "Aug 2 — 1 merged" });

    fireEvent.pointerEnter(day);

    expect(container.querySelector("[data-chart-crosshair]")).not.toBeNull();
    expect(container.querySelector(".chart-tip")).toHaveTextContent("Aug 2 — 1 merged");
    // Early in the series, the card hangs to the right of the crosshair.
    expect(container.querySelector(".chart-tip")).not.toHaveClass("chart-tip--before");

    fireEvent.pointerLeave(day);

    expect(container.querySelector(".chart-tip")).toBeNull();
  });

  it("hangs the card to the left past the middle, so it stays in the plot", () => {
    const container = draw();

    fireEvent.pointerEnter(screen.getByRole("button", { name: "Aug 6 — 9 merged" }));

    expect(container.querySelector(".chart-tip")).toHaveClass("chart-tip--before");
  });

  it("keeps the card out of the accessibility tree, since the column already says it", () => {
    const container = draw();

    fireEvent.pointerEnter(screen.getByRole("button", { name: "Aug 2 — 1 merged" }));

    expect(container.querySelector(".chart-tip")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("the keyboard", () => {
  it("offers one tab stop, on the latest day", () => {
    draw();

    const stops = screen.getAllByRole("button").filter((day) => day.tabIndex === 0);

    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveAccessibleName("Aug 7 — 6 merged");
  });

  it("shows a day's detail when its column is focused", () => {
    const container = draw();

    act(() => screen.getByRole("button", { name: "Aug 7 — 6 merged" }).focus());

    expect(container.querySelector(".chart-tip")).toHaveTextContent("Aug 7 — 6 merged");
  });

  it("walks the series with the arrow keys, Home and End, and stops at its ends", () => {
    const container = draw();
    const latest = screen.getByRole("button", { name: "Aug 7 — 6 merged" });

    act(() => latest.focus());
    fireEvent.keyDown(latest, { key: "ArrowLeft" });

    expect(document.activeElement).toHaveAccessibleName("Aug 6 — 9 merged");
    expect(container.querySelector(".chart-tip")).toHaveTextContent("Aug 6 — 9 merged");

    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toHaveAccessibleName("Aug 1 — 3 merged");

    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.activeElement).toHaveAccessibleName("Aug 1 — 3 merged");

    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toHaveAccessibleName("Aug 7 — 6 merged");
  });

  it("moves the tab stop with the reader, so tabbing back returns to the same day", () => {
    draw();

    const latest = screen.getByRole("button", { name: "Aug 7 — 6 merged" });

    act(() => latest.focus());
    fireEvent.keyDown(latest, { key: "ArrowLeft" });
    act(() => (document.activeElement as HTMLElement).blur());

    const stops = screen.getAllByRole("button").filter((day) => day.tabIndex === 0);

    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveAccessibleName("Aug 6 — 9 merged");
  });
});

describe("the scroll wrapper", () => {
  it("wraps the chart in its own scroller, sized for a wide or a half card", () => {
    const wide = draw();
    const half = draw({ size: "half" });

    expect(wide.querySelector(".chart-scroll > .chart-scroll__inner")).not.toBeNull();
    expect(wide.querySelector(".chart-scroll__inner--half")).toBeNull();
    expect(half.querySelector(".chart-scroll__inner--half")).not.toBeNull();
  });

  it("carries only data in its inline styles", () => {
    const container = draw();

    for (const element of container.querySelectorAll("[style]")) {
      const declarations = element.getAttribute("style")!.split(";").filter(Boolean);

      for (const declaration of declarations) {
        expect(declaration.trim()).toMatch(/^--chart-/);
      }
    }
  });
});
