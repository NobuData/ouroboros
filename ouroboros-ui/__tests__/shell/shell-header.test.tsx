import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DASHBOARD_PATH } from "@/app/paths";
import { SIDEBAR_ID } from "@/app/shell/regions";

import { signedIn } from "../helpers/account";
import { renderThemed } from "../helpers/theme";

/**
 * The header. Its scope is defined as much by what it does *not* carry as by what it
 * does: no navigation links (they moved to the sidebar), and no invented numbers.
 *
 * CP.1 ([#643](https://github.com/NobuData/ouroboros/issues/643)) is what completed the row —
 * every slot design system § 1.1 names, in the order it names them — so the suite grew a
 * group about that order. Each slot's own behaviour is its own suite
 * (`search-pill.test.tsx`, `tenant-chip.test.tsx`); what is here is that the header offers it
 * and offers it in the right place.
 *
 * It is rendered through `renderThemed` because it carries the theme toggle (#42), which is a
 * `useTheme()` consumer — as it is in production, where the root layout puts the provider
 * above every screen.
 *
 * The account menu and the tenant chip both read the browser's session
 * ([#721](https://github.com/NobuData/ouroboros/issues/721)), which is why a header suite
 * has an auth stub in it: the hooks would otherwise reach for `fetch`, and a router that
 * does not exist. What the menu *is* is `__tests__/shell/user-menu.test.tsx`; all this suite
 * asks of it is that the header offers it.
 */

vi.mock("@/app/api/auth-client", async () =>
  (await import("../helpers/account")).authClientModule(),
);

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/shell/actions", () => ({ signOutOfSession: vi.fn() }));

const { ShellHeader } = await import("@/app/shell/shell-header");

beforeEach(() => {
  signedIn();
});

describe("the shell header", () => {
  it("is a banner landmark", () => {
    renderThemed(<ShellHeader />);

    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  it("puts the brand upper-left, linking to the dashboard", () => {
    renderThemed(<ShellHeader />);

    const brand = screen.getByRole("link", { name: /OUROBOROS/ });
    // `/dashboard`, not `/`. The specification says "links to Dashboard" (§ 1.1) and since #45
    // that is a segment of its own — `/` only redirects there, so linking to it would spend a
    // round trip on every press of the brand.
    expect(brand).toHaveAttribute("href", DASHBOARD_PATH);
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

  it("offers the way into the navigation, for the widths the navigation is not on screen at", () => {
    // Below 768px the sidebar is an overlay drawer (CP.2, #644) and the header is the only
    // chrome left, so the control that opens it lives here — first in the row, ahead of the
    // brand, because it opens the region immediately below it. That it is *hidden* above that
    // width is a rule in the stylesheet: `__tests__/shell/shell-styles.test.ts`.
    renderThemed(<ShellHeader />);

    const burger = screen.getByRole("button", { name: "Open navigation" });
    expect(burger).toHaveAttribute("aria-controls", SIDEBAR_ID);
    expect(burger).toHaveAttribute("aria-expanded", "false");

    const brand = screen.getByRole("link", { name: /OUROBOROS/ });
    expect(burger.compareDocumentPosition(brand)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
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

  it("shows an em dash for the live-loops count too", () => {
    renderThemed(<ShellHeader />);

    const pill = screen.getByTitle(/Live loop counts arrive/);
    expect(pill).toHaveTextContent("—");
    expect(pill).toHaveTextContent("loops live");
    // The count is #78's to fill. A hard-coded "3" — the number the specification's own
    // sketch draws — is a number a reader would believe.
    expect(pill.textContent).not.toMatch(/\d/);
  });

  it("keeps the notifications affordance reachable and explains itself", () => {
    renderThemed(<ShellHeader />);

    const bell = screen.getByRole("button", { name: /^Notifications/ });
    expect(bell).toHaveAttribute("aria-disabled", "true");
    expect(bell).not.toBeDisabled();
  });

  it("offers the search pill the shortcut is wired to", () => {
    renderThemed(<ShellHeader />);

    // What it opens is `__tests__/shell/search-pill.test.tsx`; that the header has one is
    // this suite's, because § 1.1 puts it first in the cluster.
    expect(screen.getByRole("button", { name: /Search/ })).toHaveAttribute(
      "aria-haspopup",
      "dialog",
    );
  });

  it("names the workspace between the brand and the cluster", () => {
    renderThemed(<ShellHeader />);

    const brand = screen.getByRole("link", { name: /OUROBOROS/ });
    const chip = screen.getByTitle(/#77/);
    const search = screen.getByRole("button", { name: /Search/ });

    expect(brand.compareDocumentPosition(chip)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(chip.compareDocumentPosition(search)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("puts the cluster in the order the specification lists it", () => {
    // § 1.1: search pill, live-loops pill, notifications, then the profile menu. The two
    // controls between them — the theme toggle and the settings gear — are items CP.3 (#645)
    // moves *into* the profile menu; until it does they stay in the row.
    renderThemed(<ShellHeader />);

    const order = [
      screen.getByRole("button", { name: /Search/ }),
      screen.getByTitle(/Live loop counts arrive/),
      screen.getByTitle(/Needs-you counts arrive/),
      screen.getByRole("button", { name: /^Notifications/ }),
      screen.getByRole("button", { name: /^Account menu/ }),
    ];

    for (let index = 1; index < order.length; index += 1) {
      expect(order[index - 1].compareDocumentPosition(order[index])).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
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

  it("offers the account menu, naming who it is for", () => {
    renderThemed(<ShellHeader />);

    // The name grew a session in #721 and still begins with the same two words, so the
    // control is findable by one name in every state — signed in, signed out, or still
    // asking.
    expect(screen.getByRole("button", { name: /^Account menu/ })).toBeInTheDocument();
  });
});
