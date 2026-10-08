// @vitest-environment jsdom
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import SectionCards, { SECTION_CARDS } from "../../src/components/SectionCards";
import { SECTIONS } from "../../site.constants";

describe("<SectionCards>", () => {
  it("defaults to the three sections, in order, each linking its overview", () => {
    render(<SectionCards />);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/user-guide",
      "/administration",
      "/cli",
    ]);
    SECTIONS.forEach((section, index) => {
      expect(within(links[index]).getByText(section.label)).toHaveClass("title");
      expect(within(links[index]).getByText(section.description)).toHaveClass("description");
    });
  });

  it("derives the default cards from the section list", () => {
    expect(SECTION_CARDS).toHaveLength(SECTIONS.length);
  });

  it("renders the cards it is given", () => {
    render(
      <SectionCards
        cards={[
          { title: "install.sh", description: "Every flag.", to: "/cli/install-sh" },
          { title: "Policies", description: "Guardrails.", to: "/administration/policies" },
        ]}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/cli/install-sh");
    expect(within(links[1]).getByText("Guardrails.")).toBeInTheDocument();
  });

  it("fails loudly on an empty list", () => {
    expect(() => render(<SectionCards cards={[]} />)).toThrow(/at least one card/);
  });
});
