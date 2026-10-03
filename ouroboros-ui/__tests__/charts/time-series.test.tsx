import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TimeSeries, type TimeSeriesMarker, type TimeSeriesPoint } from "@/app/charts";
import { plotFrame, xOf, yOf } from "@/app/charts/geometry";
import { moneyOfCents } from "@/app/format";

/**
 * The line-and-area chart (#442): the four combinations of its optional marks, the series
 * that have almost nothing in them, and the two ways to reach a day's detail — and its annotation
 * layer (#517): markers with their chips, and a labelled y-axis.
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

describe("markers", () => {
  const MARKERS: readonly TimeSeriesMarker[] = [
    { id: "slower", index: 1, label: "Aug 2 · Zephyr 4.1 migration +1m 30s", description: "It rose.", tone: "warn" },
    { id: "faster", index: 4, label: "Aug 5 · ccache enabled −2m 10s", tone: "ok" },
  ];

  it("draws none by default — no band, no verticals", () => {
    const container = draw();

    expect(container.querySelector(".chart-marks")).toBeNull();
    expect(container.querySelector("[data-chart-markers]")).toBeNull();
  });

  it("draws a dashed vertical through the plot at each marked point", () => {
    const container = draw({ markers: MARKERS });
    const frame = plotFrame(640, 196);
    const lines = [...container.querySelectorAll("[data-chart-markers] .chart-ts__marker")];

    expect(lines.map((line) => Number(line.getAttribute("x1")))).toEqual([xOf(1, 7, frame), xOf(4, 7, frame)]);
    for (const line of lines) {
      expect(line.getAttribute("x1")).toBe(line.getAttribute("x2"));
      expect(Number(line.getAttribute("y2"))).toBe(frame.baseline);
    }
  });

  it("draws each marker's chip in a named group, tinted by its tone", () => {
    const container = draw({ markers: MARKERS, markersLabel: "Detected change-points", onMarker: () => {} });
    const group = screen.getByRole("group", { name: "Detected change-points" });
    const chips = within(group).getAllByRole("button");

    expect(chips.map((chip) => chip.textContent)).toEqual([
      "Aug 2 · Zephyr 4.1 migration +1m 30s",
      "Aug 5 · ccache enabled −2m 10s",
    ]);
    expect(chips[0]).toHaveClass("chart-mark", "chart-mark--warn");
    expect(chips[1]).toHaveClass("chart-mark", "chart-mark--ok");
    expect(chips[1]).not.toHaveClass("chart-mark--warn");
    expect(container.querySelectorAll(".chart-mark__stem")).toHaveLength(2);
  });

  it("names a chip by its text and then what is said beyond it", () => {
    draw({ markers: MARKERS, onMarker: () => {} });

    expect(
      screen.getByRole("button", { name: "Aug 2 · Zephyr 4.1 migration +1m 30s — It rose." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aug 5 · ccache enabled −2m 10s" })).toBeInTheDocument();
  });

  it("makes each chip a tab stop of its own that hands its marker back when pressed", () => {
    const onMarker = vi.fn();
    draw({ markers: MARKERS, onMarker });
    const chip = screen.getByRole("button", { name: /ccache enabled/ });

    expect(chip.tagName).toBe("BUTTON");
    expect(chip).not.toHaveAttribute("tabindex", "-1");

    chip.focus();
    expect(chip).toHaveFocus();
    fireEvent.click(chip);

    expect(onMarker).toHaveBeenCalledExactlyOnceWith("faster");
  });

  it("draws the chips as text when nothing listens for a press", () => {
    draw({ markers: MARKERS });
    const group = screen.getByRole("group", { name: "Annotations" });

    expect(within(group).queryAllByRole("button")).toHaveLength(0);
    expect(within(group).getByText("Aug 5 · ccache enabled −2m 10s")).toHaveClass("chart-mark--ok");
    expect(group.querySelector(".chart-mark--warn")!.textContent).toBe(
      "Aug 2 · Zephyr 4.1 migration +1m 30s — It rose.",
    );
  });

  it("places each chip by its point's x, its row and its room", () => {
    // Two neighbouring days: the second chip starts under the first's span.
    const container = draw({
      markers: [MARKERS[0]!, { ...MARKERS[1]!, index: 2 }],
      onMarker: () => {},
    });
    const frame = plotFrame(640, 196);
    const band = container.querySelector<HTMLElement>(".chart-marks")!;
    const [first, second] = [...container.querySelectorAll<HTMLElement>("button.chart-mark")];

    expect(band.style.getPropertyValue("--chart-rows")).toBe("2");
    expect(first!.style.getPropertyValue("--chart-x")).toBe(`${Math.round((xOf(1, 7, frame) / 640) * 10000) / 100}%`);
    expect(first!.style.getPropertyValue("--chart-row")).toBe("0");
    expect(first!.style.getPropertyValue("--chart-chars")).toBe(String(MARKERS[0]!.label.length));
    expect(second!.style.getPropertyValue("--chart-row")).toBe("1");
  });

  it("keeps chips that are clear of one another on one row", () => {
    const container = draw({ markers: MARKERS, onMarker: () => {} });

    expect(container.querySelector<HTMLElement>(".chart-marks")!.style.getPropertyValue("--chart-rows")).toBe("1");
  });

  it("ignores a marker pointing past the series, and one at no whole point", () => {
    const container = draw({
      markers: [
        { id: "past", index: 40, label: "nowhere", tone: "warn" },
        { id: "between", index: 1.5, label: "between", tone: "warn" },
        { id: "before", index: -1, label: "before", tone: "ok" },
      ],
    });

    expect(container.querySelector(".chart-marks")).toBeNull();
    expect(container.querySelector("[data-chart-markers]")).toBeNull();
  });

  it("keeps the day columns under the plot only, so they never cover a chip", () => {
    const container = draw({ markers: MARKERS, onMarker: () => {} });
    const plot = container.querySelector(".chart-ts__plot")!;

    expect(plot.querySelector(".chart-ts__hits")).not.toBeNull();
    expect(plot.querySelector(".chart-ts__svg")).not.toBeNull();
    expect(plot.querySelector(".chart-marks")).toBeNull();
    expect(container.querySelector(".chart-marks")!.compareDocumentPosition(plot)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});

describe("a labelled y-axis", () => {
  const axis = { min: 180, max: 360, ticks: [180, 240, 300, 360], format: (value: number) => `${value / 60}m` };
  const minutes: readonly TimeSeriesPoint[] = [252, 342, 212, 252].map((value, index) => ({
    label: `Aug ${index + 1}`,
    value,
  }));

  it("draws none by default", () => {
    expect(draw().querySelector("[data-chart-axis]")).toBeNull();
  });

  it("writes each tick with the axis's own formatter, beside the plot", () => {
    const { container } = render(<TimeSeries label="Duration" points={minutes} axis={axis} />);
    const labels = [...container.querySelectorAll("[data-chart-axis] text")];
    const frame = plotFrame(640, 196, 30);

    expect(labels.map((label) => label.textContent)).toEqual(["3m", "4m", "5m", "6m"]);
    for (const label of labels) {
      expect(label.getAttribute("text-anchor")).toBe("end");
      expect(Number(label.getAttribute("x"))).toBeLessThan(frame.left);
    }
  });

  it("draws a gridline at every tick above the floor, which is the solid baseline", () => {
    const { container } = render(<TimeSeries label="Duration" points={minutes} axis={axis} gridlines={9} />);
    const frame = plotFrame(640, 196, 30);
    const ys = [...container.querySelectorAll(".chart-ts__grid")].map((line) => Number(line.getAttribute("y1")));

    expect(ys).toEqual([240, 300, 360].map((tick) => yOf(tick, 360, frame, 180)));
    expect(Number(container.querySelector(".chart-ts__baseline")!.getAttribute("y1"))).toBe(frame.baseline);
  });

  it("starts the plot after the labels' gutter and measures the series from the axis's floor", () => {
    const { container } = render(<TimeSeries label="Duration" points={minutes} axis={axis} />);
    const frame = plotFrame(640, 196, 30);
    const points = container.querySelector(".chart-ts__line")!.getAttribute("points")!.split(" ");

    expect(points[0]).toBe(`${frame.left},${yOf(252, 360, frame, 180)}`);
    expect(points[3]).toBe(`630,${yOf(252, 360, frame, 180)}`);
    expect(container.querySelector(".chart-ts__grid")!.getAttribute("x1")).toBe(String(frame.left));
  });

  it("drops a tick outside the domain rather than drawing it off the plot", () => {
    const { container } = render(
      <TimeSeries label="Duration" points={minutes} axis={{ ...axis, ticks: [120, 240, 420] }} />,
    );

    expect([...container.querySelectorAll("[data-chart-axis] text")].map((label) => label.textContent)).toEqual(["4m"]);
  });

  it("falls back to the chart's own formatter for the ticks", () => {
    const { container } = render(
      <TimeSeries
        label="Duration"
        points={minutes}
        axis={{ min: 180, max: 360, ticks: [240] }}
        formatValue={(value) => `${value}s`}
      />,
    );

    expect(container.querySelector("[data-chart-axis] text")!.textContent).toBe("240s");
    expect(container.querySelector("[data-chart-endpoint] text")!.textContent).toBe("252s");
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
    const container = draw({
      markers: [{ id: "m", index: 2, label: "Aug 3 · a merge +10s", tone: "warn" }],
      onMarker: () => {},
    });

    expect(container.querySelectorAll(".chart-marks [style]").length).toBeGreaterThan(0);

    for (const element of container.querySelectorAll("[style]")) {
      const declarations = element.getAttribute("style")!.split(";").filter(Boolean);

      for (const declaration of declarations) {
        expect(declaration.trim()).toMatch(/^--chart-/);
      }
    }
  });
});
