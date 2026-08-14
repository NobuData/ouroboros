import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Chip, type ChipTone, EffortChip } from "@/app/ui";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The chip primitive and the effort chip built on it (#46).
 *
 * The rule this suite is written around is the token sheet's own: **hue is never the only
 * signal**. A chip always carries its state in words, and where two states sit side by side
 * it also carries a dot whose *shape* differs — filled for a state that was reported, a
 * ring for one nobody could report. A reader who cannot separate two hues still separates
 * the two states.
 */

/** Every tone, and the class each one is expected to wear. */
const TONES: readonly (readonly [ChipTone, string])[] = [
  ["neutral", "ou-chip"],
  ["accent", "ou-chip--accent"],
  ["ok", "ou-chip--ok"],
  ["warn", "ou-chip--warn"],
  ["err", "ou-chip--err"],
  ["model", "ou-chip--model"],
];

describe("the tones", () => {
  it.each(TONES)("draws the %s tone with its own class", (tone, expected) => {
    const { container } = render(<Chip tone={tone}>up</Chip>);

    expect(container.firstElementChild).toHaveClass("ou-chip", expected);
  });

  it("adds no modifier for the neutral tone, which is a label rather than a state", () => {
    const { container } = render(<Chip>owner</Chip>);

    expect(container.firstElementChild?.className).toBe("ou-chip");
  });

  it("always carries its state in words, whatever hue it is wearing", () => {
    render(<Chip tone="err">down</Chip>);

    expect(screen.getByText("down")).toBeInTheDocument();
  });
});

describe("the dot", () => {
  it("is not rendered unless the chip asks for one", () => {
    const { container } = render(<Chip tone="ok">on</Chip>);

    expect(container.querySelector(".ou-chip__dot")).not.toBeInTheDocument();
  });

  it("is filled for a state that was reported", () => {
    const { container } = render(
      <Chip tone="ok" dot="filled">
        up
      </Chip>,
    );

    const dot = container.querySelector(".ou-chip__dot");

    expect(dot).toBeInTheDocument();
    expect(dot).not.toHaveClass("ou-chip__dot--ring");
  });

  it("is a ring for a state nobody could report, which is the second signal", () => {
    const { container } = render(
      <Chip tone="warn" dot="ring">
        unknown
      </Chip>,
    );

    expect(container.querySelector(".ou-chip__dot")).toHaveClass("ou-chip__dot--ring");
  });

  it("carries the mockups' halo for a state that is happening right now", () => {
    // The *live* pill over the active-loops table (#82), and at most one per view.
    const { container } = render(
      <Chip tone="accent" dot="pulse">
        live
      </Chip>,
    );

    expect(container.querySelector(".ou-chip__dot")).toHaveClass("ou-chip__dot--pulse");
  });

  it("says in words what the halo says in movement, so stillness loses nothing", () => {
    // The animation is entirely inside a reduced-motion guard, so a reader who asked for
    // less motion sees a chip that stands still — and it has to mean the same thing.
    render(
      <Chip tone="accent" dot="pulse">
        live
      </Chip>,
    );

    expect(screen.getByText("live")).toBeInTheDocument();
  });

  it("is hidden from the accessibility tree — it repeats what the label says", () => {
    const { container } = render(
      <Chip tone="ok" dot="filled">
        up
      </Chip>,
    );

    expect(container.querySelector(".ou-chip__dot")).toHaveAttribute("aria-hidden");
  });
});

describe("the effort chip", () => {
  it("derives its hue from the size, so a scale cannot mean two things", () => {
    // An `L` that was green on one screen would make the whole scale unreadable.
    const { container } = render(<EffortChip effort="L" />);

    expect(container.firstElementChild).toHaveClass("ou-chip--warn", "ou-chip--effort");
  });

  it("puts the biggest sizes in the hue that asks for a second look", () => {
    const { container } = render(<EffortChip effort="XL" />);

    expect(container.firstElementChild).toHaveClass("ou-chip--err");
  });

  it("says what the letters mean, for a reader meeting the scale for the first time", () => {
    render(<EffortChip effort="XS" />);

    expect(screen.getByText("XS")).toHaveAttribute("title", "Effort: XS");
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders in the %s palette", (palette) => {
    renderInPalette(
      palette,
      <Chip tone="ok" dot="filled">
        operational
      </Chip>,
    );

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByText("operational")).toHaveClass("ou-chip--ok");
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(
      <>
        <Chip tone="warn" dot="ring">
          unknown
        </Chip>
        <EffortChip effort="M" />
      </>,
    );

    expect(light).toBe(dark);
  });
});
