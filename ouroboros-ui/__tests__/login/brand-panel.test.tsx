import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BrandPanel } from "@/app/login/brand-panel";

/**
 * The 55% half: the tagline lockup, the mockup's three lines, the trust row.
 *
 * The lockup is a **pair** — light and dark treatments of the same picture, stacked, with CSS
 * choosing which is visible — and the two properties that makes necessary are what these
 * cases hold: both are always laid out (so the column never moves), and only one of them is
 * described (so a screen reader hears the tagline once rather than twice).
 */

describe("<BrandPanel>", () => {
  it("carries the mockup's three brand lines, in order", () => {
    const { container } = render(<BrandPanel />);

    const lines = [...container.querySelectorAll(".login-brand__line")];

    expect(lines.map((line) => line.textContent)).toEqual([
      "Point it at your backlog.",
      "It plans, codes, builds, reviews, and merges.",
      "You watch the loop turn.",
    ]);
  });

  it("carries the mockup's trust row as a list, so it is three claims and not one sentence", () => {
    render(<BrandPanel />);

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "SOC 2 Type II",
      "SSO / SAML",
      "Self-hostable",
    ]);
  });

  it("renders both treatments of the lockup, from the copies under public/brand", () => {
    const { container } = render(<BrandPanel />);

    const marks = [...container.querySelectorAll("img")];

    expect(marks).toHaveLength(2);
    for (const mark of marks) {
      // next/image rewrites `src` through the optimiser, so the assertion is on what it was
      // pointed at rather than on the attribute it emitted.
      expect(mark.getAttribute("src")).toContain("lockup-tagline");
    }
    expect(container.querySelector(".login-brand__mark--light")).toBeInTheDocument();
    expect(container.querySelector(".login-brand__mark--dark")).toBeInTheDocument();
  });

  it("describes the picture once, on one of the pair", () => {
    render(<BrandPanel />);

    expect(screen.getByAltText("Ouroboros — Infinity in Autonomy")).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });

  it("names the panel, so a screen reader moving by region knows which half it is in", () => {
    render(<BrandPanel />);

    expect(screen.getByRole("region", { name: "Ouroboros" })).toBeInTheDocument();
  });
});
