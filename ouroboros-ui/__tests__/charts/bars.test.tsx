import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HBars, Sparkline, StackedVBars, hBarsLabel, type HBarRow } from "@/app/charts";

/**
 * The three CSS-bar primitives (#442): `HBars`, `Sparkline` and `StackedVBars`.
 *
 * Each draws its bars as a fraction in `--chart-fill`, which is the one thing these tests
 * read off the markup: the sheet owns every other property.
 */

/**
 * The fill an element carries.
 *
 * @param element The bar.
 * @returns The custom property's value, or `null` when it carries none.
 */
function fill(element: Element | null | undefined): string | null {
  const style = element?.getAttribute("style") ?? "";

  return /--chart-fill:\s*([^;]+)/.exec(style)?.[1]?.trim() ?? null;
}

const CAUSES: readonly HBarRow[] = [
  { name: "Flaky env / rig", value: 8, emphasis: "top" },
  { name: "Ambiguous ticket", value: 5 },
  { name: "Other", value: 1, emphasis: "dim" },
];

describe("HBars", () => {
  it("is one image whose name is the headline and then every row in words", () => {
    render(<HBars label="Interventions by cause, 14 total" rows={CAUSES} />);

    expect(
      screen.getByRole("img", {
        name: "Interventions by cause, 14 total: Flaky env / rig 8, Ambiguous ticket 5, Other 1",
      }),
    ).toBeInTheDocument();
  });

  it("scales every bar to the largest, so the top row is full width", () => {
    const { container } = render(<HBars label="Causes" rows={CAUSES} />);
    const bars = [...container.querySelectorAll(".chart-hbar__bar")];

    expect(bars.map(fill)).toEqual(["100%", "62.5%", "12.5%"]);
  });

  it("lifts the top row and recedes the dim one", () => {
    const { container } = render(<HBars label="Causes" rows={CAUSES} />);
    const rows = [...container.querySelectorAll(".chart-hbar")];

    expect(rows[0]).toHaveClass("chart-hbar--top");
    expect(rows[1]).not.toHaveClass("chart-hbar--top", "chart-hbar--dim");
    expect(rows[2]).toHaveClass("chart-hbar--dim");
  });

  it("draws a value's display in place of the raw number", () => {
    const { container } = render(
      <HBars label="Stages" rows={[{ name: "Implement", value: 364_000, display: "6m 04s" }]} />,
    );

    expect(container.querySelector(".chart-hbar__value")).toHaveTextContent("6m 04s");
    expect(screen.getByRole("img")).toHaveAccessibleName("Stages: Implement 6m 04s");
  });

  it("wears the model hue for token counts", () => {
    const { container } = render(<HBars label="Tokens" rows={CAUSES} hue="model" />);

    expect(container.firstElementChild).toHaveClass("chart-hbars--model");
  });

  it("draws an effort chip in the label's place", () => {
    const { container } = render(
      <HBars label="Ladder" rows={[{ name: "XL", effort: "XL", value: 1 }]} />,
    );

    expect(container.querySelector(".chart-hbar__label .ou-chip--effort")).toHaveTextContent("XL");
  });

  it("draws empty bars rather than full ones when every value is zero", () => {
    const { container } = render(
      <HBars label="None" rows={[{ name: "a", value: 0 }, { name: "b", value: 0 }]} />,
    );

    expect([...container.querySelectorAll(".chart-hbar__bar")].map(fill)).toEqual(["0%", "0%"]);
  });

  it("names an empty set by its label alone", () => {
    expect(hBarsLabel("Nothing yet", [])).toBe("Nothing yet");
  });
});

describe("Sparkline", () => {
  it("is decoration by default, because the figure beside it says the value", () => {
    const { container } = render(<Sparkline values={[1, 2, 4]} />);

    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("becomes a named image when it is the only statement of its trend", () => {
    render(<Sparkline values={[1, 2, 4]} label="Deploys rising to 4.2 a day" />);

    expect(screen.getByRole("img", { name: "Deploys rising to 4.2 a day" })).toBeInTheDocument();
  });

  it("scales each bar to the tallest", () => {
    const { container } = render(<Sparkline values={[1, 2, 4]} />);

    expect([...container.querySelectorAll(".chart-spark__bar")].map(fill)).toEqual([
      "25%",
      "50%",
      "100%",
    ]);
  });

  it("recedes when dimmed", () => {
    const { container } = render(<Sparkline values={[1]} dim />);

    expect(container.firstElementChild).toHaveClass("chart-spark--dim");
  });

  it("draws nothing for no values, without breaking", () => {
    const { container } = render(<Sparkline values={[]} />);

    expect(container.querySelectorAll(".chart-spark__bar")).toHaveLength(0);
  });
});

describe("StackedVBars", () => {
  const DAYS = [
    { label: "Aug 1", succeeded: 14, failed: 0 },
    { label: "Aug 2", succeeded: 16, failed: 2 },
    { label: "Aug 3", succeeded: 6, failed: 3, hot: true },
  ];

  it("is one named image, and its legend is not read a second time", () => {
    const { container } = render(<StackedVBars label="Builds per day" days={DAYS} />);

    expect(screen.getByRole("img", { name: "Builds per day" })).toBeInTheDocument();
    expect(container.querySelector(".chart-legend")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".chart-legend")).toHaveTextContent("succeeded·failed");
  });

  it("draws a failure segment only on a day that had failures, scaled to the busiest day", () => {
    const { container } = render(<StackedVBars label="Builds" days={DAYS} />);
    const bars = [...container.querySelectorAll(".chart-vb")];

    expect(bars[0]!.querySelector(".chart-vb__seg--failed")).toBeNull();
    expect(fill(bars[0]!.querySelector(".chart-vb__seg"))).toBe("77.78%");
    expect(fill(bars[1]!.querySelector(".chart-vb__seg--failed"))).toBe("11.11%");
    expect(fill(bars[1]!.querySelector(".chart-vb__seg:not(.chart-vb__seg--failed)"))).toBe(
      "88.89%",
    );
  });

  it("lifts a hot day and the noted day", () => {
    const { container } = render(
      <StackedVBars label="Builds" days={DAYS} note={{ index: 1, text: "18 · 2 failed" }} />,
    );
    const bars = [...container.querySelectorAll(".chart-vb")];

    expect(bars.map((bar) => bar.classList.contains("chart-vb--hot"))).toEqual([false, true, true]);
    expect(container.querySelector(".chart-vbars__note")).toHaveTextContent("18 · 2 failed");
  });

  it("floats the note over the middle of its day", () => {
    const { container } = render(
      <StackedVBars label="Builds" days={DAYS} note={{ index: 1, text: "note" }} />,
    );

    expect(container.querySelector(".chart-vbars__note")?.getAttribute("style")).toContain(
      "--chart-x: 50%",
    );
  });

  it("ignores a note pointing past the days", () => {
    const { container } = render(
      <StackedVBars label="Builds" days={DAYS} note={{ index: 9, text: "nowhere" }} />,
    );

    expect(container.querySelector(".chart-vbars__note")).toBeNull();
  });

  it("takes its legend's words from the page", () => {
    const { container } = render(
      <StackedVBars label="Runs" days={DAYS} legend={{ succeeded: "passed", failed: "broke" }} />,
    );

    expect(container.querySelector(".chart-legend")).toHaveTextContent("passed·broke");
  });

  it("draws an empty strip for no days, and treats a negative count as none", () => {
    const empty = render(<StackedVBars label="None" days={[]} />).container;
    const odd = render(
      <StackedVBars label="Odd" days={[{ label: "x", succeeded: -4, failed: Number.NaN }]} />,
    ).container;

    expect(empty.querySelectorAll(".chart-vb")).toHaveLength(0);
    expect(odd.querySelector(".chart-vb__seg--failed")).toBeNull();
    expect(fill(odd.querySelector(".chart-vb__seg"))).toBe("0%");
  });
});
