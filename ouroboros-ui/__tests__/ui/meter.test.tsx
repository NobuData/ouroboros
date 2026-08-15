import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Meter } from "@/app/ui";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The meter primitive (#46's shape, landed with
 * [#82](https://github.com/NobuData/ouroboros/issues/82)).
 *
 * Three things are worth holding it to, and each of them is a way a progress bar can lie:
 * that the fill is the fraction it was given and never more, that the fraction is the *only*
 * thing written inline, and that whether it is announced depends on whether anything beside
 * it already says the same figure.
 */

/**
 * The bar's fill, as the sheet reads it.
 *
 * @param container The render's container.
 * @returns The custom property's value, or `null` when the fill carries no style at all.
 */
function fill(container: HTMLElement): string | null {
  const style = container.querySelector(".ou-meter__fill")?.getAttribute("style") ?? "";

  return /--ou-meter-fill:\s*([^;]+)/.exec(style)?.[1]?.trim() ?? null;
}

describe("the fill", () => {
  it("is the fraction it was given, as a percentage", () => {
    const { container } = render(<Meter value={0.66} />);

    expect(fill(container)).toBe("66%");
  });

  it("draws an empty track for nothing and a full one for everything", () => {
    expect(fill(render(<Meter value={0} />).container)).toBe("0%");
    expect(fill(render(<Meter value={1} />).container)).toBe("100%");
  });

  it("clamps rather than refusing, so one bad row cannot take a card down", () => {
    // A bar drawn past its own track is a rendering bug; a card that threw over one would be
    // a page nobody can read because one run reported a step past the end of its workflow.
    expect(fill(render(<Meter value={1.4} />).container)).toBe("100%");
    expect(fill(render(<Meter value={-0.2} />).container)).toBe("0%");
  });

  it("reads a fraction nobody could compute as empty, never as full", () => {
    // `0/0` is `NaN`, and `width: NaN%` is a declaration a browser drops — which would leave
    // the bar showing whatever the previous render left. Empty is the honest answer: nothing
    // is known about this run's progress.
    expect(fill(render(<Meter value={Number.NaN} />).container)).toBe("0%");
  });

  it("rounds to a tenth, so a poll cannot rewrite the attribute with sixteen digits", () => {
    const { container } = render(<Meter value={1 / 3} />);

    expect(fill(container)).toBe("33.3%");
  });

  it("writes nothing inline but that fraction", () => {
    // The whole point of the custom property: the sheet keeps the colour, the height and the
    // radius, and the call site contributes one number.
    const { container } = render(<Meter value={0.5} tone="ok" />);

    for (const styled of container.querySelectorAll("[style]")) {
      expect(styled.getAttribute("style")).toMatch(/^--ou-meter-fill:\s*[\d.]+%;?$/);
    }
  });
});

describe("the tones", () => {
  it("takes the accent gradient by default, which is this product's progress", () => {
    const { container } = render(<Meter value={0.5} />);

    expect(container.firstElementChild).toHaveClass("ou-meter");
    expect(container.firstElementChild?.className).toBe("ou-meter");
  });

  it.each(["ok", "warn", "err"] as const)("carries its own class for %s", (tone) => {
    const { container } = render(<Meter value={0.5} tone={tone} />);

    expect(container.firstElementChild).toHaveClass(`ou-meter--${tone}`);
  });
});

describe("what a screen reader is told", () => {
  it("is a progressbar with a name and a value when it is the only statement of one", () => {
    render(<Meter value={0.92} label="Autonomous merge rate" />);

    const bar = screen.getByRole("progressbar", { name: "Autonomous merge rate" });

    expect(bar).toHaveAttribute("aria-valuenow", "92");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("announces the caller's own words for the value where it has some", () => {
    // `67%` is what the bar draws; `Implementing · 4/6` is what the figure means, and it is
    // what a reader who cannot see the bar's position needs to hear.
    render(<Meter value={0.667} label="Stage" valueText="Implementing · 4/6" />);

    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      "Implementing · 4/6",
    );
  });

  it("says nothing at all when a caption beside it already says the same thing", () => {
    // The dashboard's stage cell: the caption is the fact, the bar is a picture of it, and
    // announcing both would read the run's position twice.
    render(<Meter value={0.66} />);

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("is hidden rather than merely unnamed in that case", () => {
    // An unnamed `div` is silent to most readers and announced by some; `aria-hidden` is the
    // only way to say *this is decoration* rather than *nobody labelled this*.
    const { container } = render(<Meter value={0.66} />);

    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders in the %s palette", (palette) => {
    renderInPalette(palette, <Meter value={0.5} label="Stage" />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("progressbar")).toHaveClass("ou-meter");
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(<Meter value={0.5} tone="ok" />);

    expect(light).toBe(dark);
  });
});
