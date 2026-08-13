import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signedIn } from "../helpers/account";
import { renderThemed } from "../helpers/theme";

/**
 * The shell as a whole: the three regions, and the page inside the one of them that
 * scrolls.
 *
 * Scroll containment itself is a CSS property and is asserted where CSS can be read —
 * `__tests__/styles.test.ts` for the token rule, and the shell e2e leg (CP.5, #647) for
 * "only the pane moved". What is assertable here is the structure containment depends
 * on: the page renders *inside* the pane, not beside it.
 *
 * The header's account menu reads the browser's session
 * ([#721](https://github.com/NobuData/ouroboros/issues/721)), so the shell cannot be mounted
 * without an answer for it — see `__tests__/shell/user-menu.test.tsx` for what that answer
 * is worth asserting about.
 */

vi.mock("@/app/api/auth-client", async () =>
  (await import("../helpers/account")).authClientModule(),
);

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/app/shell/actions", () => ({ signOutOfSession: vi.fn() }));

const { default: AppLayout } = await import("@/app/(app)/layout");
const { AppShell, CONTENT_ID } = await import("@/app/shell/app-shell");

beforeEach(() => {
  signedIn();
});

describe("the app shell", () => {
  it("renders the three regions", () => {
    renderThemed(
      <AppShell>
        <p>page</p>
      </AppShell>,
    );

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(document.getElementById(CONTENT_ID)).not.toBeNull();
  });

  it("renders the page inside the scrolling pane", () => {
    renderThemed(
      <AppShell>
        <p>page</p>
      </AppShell>,
    );

    const pane = document.getElementById(CONTENT_ID);
    expect(pane).toContainElement(screen.getByText("page"));
  });

  it("offers the keyboard a way past the chrome", () => {
    const { container } = renderThemed(
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
    renderThemed(
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
    renderThemed(
      <AppLayout>
        <p>segment</p>
      </AppLayout>,
    );

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(document.getElementById(CONTENT_ID)).toContainElement(screen.getByText("segment"));
  });
});
