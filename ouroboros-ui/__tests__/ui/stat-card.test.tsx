import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Meter, StatCard, type StatTone } from "@/app/ui";

import { renderInBothPalettes } from "../helpers/palettes";

/**
 * The stat tile primitive — the dashboard's composition (#81), a primitive since the build farm
 * drew the same row (#256).
 *
 * What it is held to is that it decides nothing: a caption, a figure and a line go in and come
 * out, a tone becomes a class, and the two shapes mockup 08 added — a quieter suffix on the
 * figure, and something between the figure and its line — are drawn only when asked for.
 */

describe("the tile", () => {
  it("is a region named by its caption, holding the figure and the line under it", () => {
    render(<StatCard delta="1 coding · 1 building" label="Loops live" value="3" />);

    const tile = screen.getByRole("region", { name: "Loops live" });

    expect(tile).toHaveClass("ou-card");
    expect(tile.querySelector(".ou-stat__label")).toHaveTextContent("Loops live");
    expect(tile.querySelector(".ou-stat__value")).toHaveTextContent("3");
    expect(tile.querySelector(".ou-stat__delta")).toHaveTextContent("1 coding · 1 building");
  });

  it("draws no line at all for a tile with nothing it can honestly say", () => {
    const { container } = render(<StatCard label="Avg build time" value="—" />);

    expect(container.querySelector(".ou-stat__delta")).toBeNull();
    expect(render(<StatCard delta={null} label="Token spend" value="—" />).container.querySelector(".ou-stat__delta")).toBeNull();
  });

  it("takes the accent only when asked", () => {
    const plain = render(<StatCard label="Queued" value="12" />).container;
    const live = render(<StatCard accent label="Loops live" value="3" />).container;

    expect(plain.querySelector(".ou-stat__value--accent")).toBeNull();
    expect(live.querySelector(".ou-stat__value")).toHaveClass("ou-stat__value--accent");
  });

  it("places itself with the page's class and nothing else of the page's", () => {
    render(<StatCard className="farm-col--3" label="Builds today" value="23" />);

    expect(screen.getByRole("region", { name: "Builds today" })).toHaveClass("ou-card", "farm-col--3");
  });
});

describe("the tones", () => {
  const CLASSES: readonly (readonly [StatTone, string | null])[] = [
    ["muted", null],
    ["up", "ou-stat__delta--up"],
    ["down", "ou-stat__delta--down"],
    ["failed", "ou-stat__delta--failed"],
  ];

  it.each(CLASSES)("maps %s to its class, and to no other", (tone, expected) => {
    const { container } = render(<StatCard delta="a line" label="A figure" tone={tone} value="1" />);
    const delta = container.querySelector(".ou-stat__delta");

    for (const [, name] of CLASSES) {
      if (name === null) continue;
      if (name === expected) expect(delta).toHaveClass(name);
      else expect(delta).not.toHaveClass(name);
    }
  });

  it("draws a line muted unless told otherwise", () => {
    const { container } = render(<StatCard delta="a line" label="A figure" value="1" />);

    expect(container.querySelector(".ou-stat__delta")?.className).toBe("ou-stat__delta");
  });
});

describe("the figure's suffix (#256)", () => {
  it("is part of the figure, in an element of its own so the sheet can quieten it", () => {
    const { container } = render(<StatCard accent label="Runners online" value="4" valueSuffix="/5" />);
    const figure = container.querySelector(".ou-stat__value");

    expect(figure).toHaveTextContent("4/5");
    expect(figure?.querySelector(".ou-stat__suffix")).toHaveTextContent("/5");
  });

  it("is absent unless given, so the dashboard's tiles are unchanged", () => {
    const { container } = render(<StatCard label="Loops live" value="3" />);

    expect(container.querySelector(".ou-stat__suffix")).toBeNull();
  });
});

describe("what sits between the figure and its line (#256)", () => {
  it("is drawn there, in that order", () => {
    const { container } = render(
      <StatCard delta="ccache · per-runner" label="Cache hit rate" value="78%">
        <Meter value={0.78} />
      </StatCard>,
    );
    const parts = [...(container.querySelector(".ou-stat")?.children ?? [])].map((child) => child.className);

    expect(parts).toEqual(["ou-stat__label", "ou-stat__value", "ou-meter", "ou-stat__delta"]);
  });
});

describe("both palettes", () => {
  it("renders identically under either, so the theme is the sheet's alone", () => {
    const [light, dark] = renderInBothPalettes(
      <StatCard accent delta="forge-03 offline · 2h" label="Runners online" tone="up" value="4" valueSuffix="/5">
        <Meter value={0.8} />
      </StatCard>,
    );

    expect(light).toBe(dark);
  });
});
