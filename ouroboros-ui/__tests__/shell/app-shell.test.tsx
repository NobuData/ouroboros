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

// The font-scale reconciler (#649) is mounted by the shell and its actions module sits on
// the server-only client, exactly as `actions.ts` does — same mock, same reason. What the
// reconciler does is `__tests__/shell/font-scale-sync.test.tsx`'s to assert.
vi.mock("@/app/shell/preference-actions", () => ({
  readFontScale: vi.fn().mockResolvedValue("100"),
  saveFontScale: vi.fn().mockResolvedValue(true),
}));

// The tenant chip reads its repositories through a Server Action over the same server-only
// client (H.1, #77). What it does with the answer is `tenant-chip.test.tsx`'s.
vi.mock("@/app/shell/repo-actions", () => ({
  readFocusRepos: vi.fn().mockResolvedValue({ ok: true, organizationId: "none", repos: [] }),
}));

const { default: AppLayout } = await import("@/app/(app)/layout");
const { AppShell, CONTENT_ID } = await import("@/app/shell/app-shell");
const { OVERLAY_LAYER_ID, PANE_ATTRIBUTE } = await import("@/app/shell/regions");

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

  it("marks the pane so #647 can audit it per route", () => {
    // The hook CP.5 enforces horizontal containment through: one selector that keeps meaning
    // *the scroll container* even if the skip link's target is ever renamed. See
    // `app/shell/regions.ts`.
    renderThemed(
      <AppShell>
        <p>page</p>
      </AppShell>,
    );

    const marked = document.querySelectorAll(`[${PANE_ATTRIBUTE}]`);

    expect(marked).toHaveLength(1);
    expect(marked[0]).toBe(document.getElementById(CONTENT_ID));
  });

  it("carries an overlay layer, and carries it outside the pane", () => {
    // The structural half of § 1.3's last clause. A dialog rendered inside the pane is clipped
    // by the pane's overflow and cannot cover the header; that it *portals* there is
    // `__tests__/shell/overlay.test.tsx`, and that it is a sibling is this.
    renderThemed(
      <AppShell>
        <p>page</p>
      </AppShell>,
    );

    const layer = document.getElementById(OVERLAY_LAYER_ID);
    const pane = document.getElementById(CONTENT_ID);

    expect(layer).not.toBeNull();
    expect(pane).not.toContainElement(layer);
    expect(layer?.parentElement).toBe(pane?.parentElement);
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
