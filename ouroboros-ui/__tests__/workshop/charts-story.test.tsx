import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChartsStory } from "@/app/workshop/charts-story";
import { BUILDS_PER_DAY, BUILDS_NOTE_INDEX, THROUGHPUT } from "@/app/workshop/chart-fixtures";

import { renderInBothPalettes } from "../helpers/palettes";

/**
 * The workshop's chart primitives story (#442) — the fixture the screenshot suite photographs.
 *
 * Whether it *looks* like mockup 15 is the e2e leg's question; here the story is markup, and
 * this suite holds it to drawing every case the acceptance list names.
 */

describe("the fixtures", () => {
  it("transcribe the mockup's figures where the mockup states them", () => {
    // The throughput chart ends at 6, and its tooltip's Aug 4 reads exactly as drawn.
    expect(THROUGHPUT.at(-1)?.value).toBe(6);
    expect(THROUGHPUT.find((day) => day.label === "Aug 4")?.meta).toBe(
      "6 merged · $9.12 · 1 intervention",
    );
    // The builds card's note day is 18 builds, two of them failed.
    const noted = BUILDS_PER_DAY[BUILDS_NOTE_INDEX]!;
    expect([noted.succeeded + noted.failed, noted.failed]).toEqual([18, 2]);
  });
});

describe("the story", () => {
  it("draws every time series case: neither mark, both, guide only, annotation only, one point, none", () => {
    const { container } = render(<ChartsStory />);
    const charts = [...container.querySelectorAll(".chart-ts__svg")];

    expect(charts).toHaveLength(6);

    const marks = charts.map((svg) => [
      svg.querySelector("[data-chart-guide]") !== null,
      svg.querySelector("[data-chart-annotation]") !== null,
    ]);

    expect(marks).toEqual([
      [false, false],
      [true, true],
      [true, false],
      [false, true],
      [false, false],
      [false, false],
    ]);
  });

  it("names every chart as an image stating its headline", () => {
    render(<ChartsStory />);

    expect(
      screen.getByRole("img", {
        name: "Merged PRs per day, last 30 days, trending up to 6 per day",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^Daily cost across all providers.*\$18\.60/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^Tokens by stage.*Implement 126M/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^Builds per day/ })).toBeInTheDocument();
  });

  it("draws the four bar-row cards, the token card in the model hue", () => {
    const { container } = render(<ChartsStory />);

    expect(container.querySelectorAll(".chart-hbars")).toHaveLength(4);
    expect(container.querySelectorAll(".chart-hbars--model")).toHaveLength(1);
    expect(container.querySelectorAll(".chart-hbar__label .ou-chip--effort")).toHaveLength(5);
  });

  it("draws the sparklines and the stacked bars", () => {
    const { container } = render(<ChartsStory />);

    expect(container.querySelectorAll(".chart-spark")).toHaveLength(4);
    expect(container.querySelectorAll(".chart-spark--dim")).toHaveLength(1);
    expect(container.querySelectorAll(".chart-vb")).toHaveLength(30);
    expect(container.querySelector(".chart-vbars__note")).toHaveTextContent("18 · 2 failed");
  });

  it("renders the same markup in both palettes — the theme is the sheet's alone", () => {
    const [light, dark] = renderInBothPalettes(<ChartsStory />);

    expect(light).toBe(dark);
  });
});
