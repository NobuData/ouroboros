import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AppLayout from "@/app/(app)/layout";
import { AppShell, CONTENT_ID } from "@/app/shell/app-shell";

/**
 * The shell as a whole: the three regions, and the page inside the one of them that
 * scrolls.
 *
 * Scroll containment itself is a CSS property and is asserted where CSS can be read —
 * `__tests__/styles.test.ts` for the token rule, and the shell e2e leg (CP.5, #647) for
 * "only the pane moved". What is assertable here is the structure containment depends
 * on: the page renders *inside* the pane, not beside it.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

describe("the app shell", () => {
  it("renders the three regions", () => {
    render(
      <AppShell>
        <p>page</p>
      </AppShell>,
    );

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(document.getElementById(CONTENT_ID)).not.toBeNull();
  });

  it("renders the page inside the scrolling pane", () => {
    render(
      <AppShell>
        <p>page</p>
      </AppShell>,
    );

    const pane = document.getElementById(CONTENT_ID);
    expect(pane).toContainElement(screen.getByText("page"));
  });

  it("offers the keyboard a way past the chrome", () => {
    const { container } = render(
      <AppShell>
        <p>page</p>
      </AppShell>,
    );

    const skip = screen.getByRole("link", { name: "Skip to content" });
    expect(skip).toHaveAttribute("href", `#${CONTENT_ID}`);
    // First in the document, or it is a skip link the keyboard reaches last.
    expect(container.querySelector("a")).toBe(skip);
  });

  it("makes the pane a focus target without making it a tab stop", () => {
    render(
      <AppShell>
        <p>page</p>
      </AppShell>,
    );

    // -1 is what lets the skip link land focus there; anything ≥ 0 would put an empty
    // container into the tab order.
    expect(document.getElementById(CONTENT_ID)).toHaveAttribute("tabindex", "-1");
  });
});

describe("the (app) layout", () => {
  it("renders its segment inside the shell", () => {
    render(
      <AppLayout>
        <p>segment</p>
      </AppLayout>,
    );

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(document.getElementById(CONTENT_ID)).toContainElement(screen.getByText("segment"));
  });
});
