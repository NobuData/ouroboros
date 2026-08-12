import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge, Tag } from "@/app/ui";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The two markers that are not chips (#46): the tag and the count badge.
 *
 * The badge's whole behaviour is one rule, and it is an honesty rule rather than a styling
 * one: **it never renders a zero**. A badge showing `0` is a claim that something is waiting
 * when nothing is, which is the same mistake as a stat tile printing `0` for a figure nobody
 * could read (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.5).
 */

describe("the tag", () => {
  it("draws a value with no state attached to it", () => {
    const { container } = render(<Tag>main</Tag>);

    expect(screen.getByText("main")).toBeInTheDocument();
    expect(container.firstElementChild?.className).toBe("ou-tag");
  });

  it("keeps a page's own class", () => {
    const { container } = render(<Tag className="login-repo__branch">main</Tag>);

    expect(container.firstElementChild).toHaveClass("ou-tag", "login-repo__branch");
  });
});

describe("the badge", () => {
  it("names what it is counting, because a bare figure reads as nothing", () => {
    render(<Badge count={3} label="items need you" />);

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("items need you")).toHaveClass("sr-only");
  });

  it("renders nothing at all for a count of zero", () => {
    const { container } = render(<Badge count={0} label="items need you" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a count nobody could read", () => {
    // `null` is not zero: the caller passes it when the source could not be reached, and a
    // badge that turned that into a `0` would be inventing a fact.
    const { container } = render(<Badge count={null} label="items need you" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("wears the tone it was given", () => {
    const { container } = render(<Badge count={2} label="waiting" tone="warn" />);

    expect(container.firstElementChild).toHaveClass("ou-badge", "ou-badge--warn");
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders in the %s palette", (palette) => {
    renderInPalette(
      palette,
      <>
        <Tag>main</Tag>
        <Badge count={4} label="items need you" tone="warn" />
      </>,
    );

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByText("main")).toHaveClass("ou-tag");
    expect(screen.getByText("4")).toHaveClass("ou-badge--warn");
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(
      <>
        <Tag>main</Tag>
        <Badge count={4} label="items need you" />
      </>,
    );

    expect(light).toBe(dark);
  });
});
