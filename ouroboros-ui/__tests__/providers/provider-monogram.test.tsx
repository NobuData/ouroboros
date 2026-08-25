import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProviderMonogram } from "@/app/providers/provider-monogram";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The provider monogram (#228, shared with #592) — one component for mockup 07's card square
 * and mockup 21's table-cell square.
 *
 * The property this suite holds is the one the registry ticket states as a criterion: there
 * is **one** implementation, and the two sizes differ by a modifier and nothing else. The
 * tints themselves are `providers-styles.test.ts`'s.
 */

describe("the square", () => {
  it("draws the letters it is handed, in the tint it is handed", () => {
    render(<ProviderMonogram monogram={{ letters: "AN", tint: "model" }} />);

    const square = screen.getByText("AN");

    expect(square).toHaveClass("providers-card__monogram", "providers-card__monogram--model");
  });

  it("is hidden from the accessibility tree — the name beside it says it in words", () => {
    render(<ProviderMonogram monogram={{ letters: "GH", tint: "warn" }} />);

    expect(screen.getByText("GH")).toHaveAttribute("aria-hidden", "true");
  });

  it("is the card's size by default, and the cell's size on request", () => {
    const { rerender } = render(<ProviderMonogram monogram={{ letters: "OL", tint: "neutral" }} />);

    expect(screen.getByText("OL")).not.toHaveClass("providers-card__monogram--cell");

    rerender(<ProviderMonogram monogram={{ letters: "OL", tint: "neutral" }} size="cell" />);

    expect(screen.getByText("OL")).toHaveClass("providers-card__monogram--cell");
  });

  it("names every tint with its own modifier, so none falls back to another's", () => {
    for (const tint of ["model", "accent", "warn", "ok", "neutral"] as const) {
      const { unmount } = render(<ProviderMonogram monogram={{ letters: "XX", tint }} />);

      expect(screen.getByText("XX"), tint).toHaveClass(`providers-card__monogram--${tint}`);
      unmount();
    }
  });

  it("keeps the page's own class beside its own", () => {
    render(<ProviderMonogram className="where-it-goes" monogram={{ letters: "CU", tint: "accent" }} />);

    expect(screen.getByText("CU")).toHaveClass("providers-card__monogram", "where-it-goes");
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders in the %s palette", (palette) => {
    renderInPalette(palette, <ProviderMonogram monogram={{ letters: "VL", tint: "ok" }} size="cell" />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByText("VL")).toHaveClass("providers-card__monogram--ok");
  });

  it("draws the same markup in both, because the tint is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(
      <ProviderMonogram monogram={{ letters: "VL", tint: "ok" }} size="cell" />,
    );

    expect(light).toBe(dark);
  });
});
