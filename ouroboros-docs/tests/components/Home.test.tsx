// @vitest-environment jsdom
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home, { HOME_DESCRIPTION, HOME_TITLE, QUICK_LINKS } from "../../src/pages/index";
import { BRAND_ASSETS, SECTIONS } from "../../site.constants";

describe("the home page", () => {
  it("sets the page title and description", () => {
    render(<Home />);
    const layout = screen.getByTestId("layout");
    expect(layout).toHaveAttribute("data-title", HOME_TITLE);
    expect(layout).toHaveAttribute("data-description", HOME_DESCRIPTION);
  });

  it("opens with one h1, the tagline and the loop in a paragraph", () => {
    render(<Home />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("Infinity in Autonomy")).toBeInTheDocument();
    expect(screen.getByText(/issues in, verified pull requests out/)).toBeInTheDocument();
  });

  it("shows the lockup in the treatment for each theme, with alt text", () => {
    render(<Home />);
    const lockups = screen.getAllByAltText("Ouroboros");
    expect(lockups.map((image) => image.getAttribute("src"))).toEqual([
      `/${BRAND_ASSETS.lockupLight}`,
      `/${BRAND_ASSETS.lockupDark}`,
    ]);
    // Drawn at the working size docs/BRAND.md gives the lockup, never under its minimum.
    expect(lockups[0]).toHaveAttribute("width", "320");
  });

  it("links the three sections with a card each", () => {
    render(<Home />);
    const sections = screen.getByRole("region", { name: "Find your way" });
    const links = within(sections).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      SECTIONS.map((section) => `/${section.dir}`),
    );
    expect(within(links[0]).getByText(/^Use the app/)).toBeInTheDocument();
    expect(within(links[1]).getByText(/^Run and configure it/)).toBeInTheDocument();
    expect(within(links[2]).getByText(/^Command-line tools/)).toBeInTheDocument();
  });

  it("offers the three quick links: get started, deploy, enrol a runner", () => {
    render(<Home />);
    const quick = screen.getByRole("region", { name: "Quick links" });
    const links = within(quick).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/user-guide/getting-started",
      "/administration/deploy/overview",
      "/cli/runner/enroll",
    ]);
    expect(QUICK_LINKS.map((link) => link.label)).toEqual([
      "Get started",
      "Deploy",
      "Enrol a runner",
    ]);
  });

  it("names no internal ticket references in its copy", () => {
    const { container } = render(<Home />);
    expect(container.textContent).not.toMatch(/\[[A-Z]{1,2}\.\d+\]|#\d{2,}/);
  });
});
