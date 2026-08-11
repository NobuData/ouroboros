import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ShellHeader } from "@/app/shell/shell-header";

import { renderThemed } from "../helpers/theme";

/**
 * The header. Its scope is defined as much by what it does *not* carry as by what it
 * does: no navigation links (they moved to the sidebar), and no invented numbers.
 *
 * It is rendered through `renderThemed` because it now carries the theme toggle (#42),
 * which is a `useTheme()` consumer — as it is in production, where the root layout puts
 * the provider above every screen.
 */

describe("the shell header", () => {
  it("is a banner landmark", () => {
    renderThemed(<ShellHeader />);

    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  it("puts the brand upper-left, linking to the dashboard", () => {
    renderThemed(<ShellHeader />);

    const brand = screen.getByRole("link", { name: /OUROBOROS/ });
    expect(brand).toHaveAttribute("href", "/");
  });

  it("carries both brand treatments, so CSS can pick one before any script runs", () => {
    const { container } = renderThemed(<ShellHeader />);
    const marks = container.querySelectorAll("img.shell-brand__mark");

    expect(marks).toHaveLength(2);
    const sources = Array.from(marks, (mark) =>
      decodeURIComponent(mark.getAttribute("src") ?? ""),
    );
    expect(sources[0]).toContain("/brand/icon-light.png");
    expect(sources[1]).toContain("/brand/icon-dark.png");
    // Decorative — the wordmark beside them is the link's name.
    for (const mark of marks) expect(mark).toHaveAttribute("alt", "");
  });

  it("carries no navigation links — the sidebar owns navigation", () => {
    renderThemed(<ShellHeader />);

    expect(screen.queryByRole("navigation")).toBeNull();
    // The brand is the only link in the bar.
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("shows an em dash for the needs-you count rather than inventing one", () => {
    renderThemed(<ShellHeader />);

    const pill = screen.getByTitle(/Needs-you counts arrive/);
    expect(pill).toHaveTextContent("—");
    expect(pill.textContent).not.toMatch(/\d/);
  });

  it("keeps the settings control reachable and explains why it does nothing", () => {
    renderThemed(<ShellHeader />);

    // aria-disabled rather than disabled: a control removed from the tab order takes
    // its own explanation with it.
    const gear = screen.getByRole("button", { name: /Workspace settings/ });
    expect(gear).toHaveAttribute("aria-disabled", "true");
    expect(gear).not.toBeDisabled();
    expect(gear).toHaveAccessibleName(/#491/);
  });

  it("mounts the theme toggle in the cluster, between the pill and the gear", () => {
    renderThemed(<ShellHeader />);

    const pill = screen.getByTitle(/Needs-you counts arrive/);
    const toggle = screen.getByRole("button", { name: /^Theme:/ });
    const gear = screen.getByRole("button", { name: /Workspace settings/ });

    // Position rather than child index: the toggle brings a visually hidden live region
    // with it, and where that span sits is not a fact about the header's order.
    expect(pill.compareDocumentPosition(toggle)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(toggle.compareDocumentPosition(gear)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("offers the account menu", () => {
    renderThemed(<ShellHeader />);

    expect(screen.getByRole("button", { name: "Account menu" })).toBeInTheDocument();
  });
});
