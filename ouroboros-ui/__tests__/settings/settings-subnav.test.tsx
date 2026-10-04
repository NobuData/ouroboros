import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SettingsSubnav } from "@/app/settings/settings-subnav";
import { SECTION_TABS } from "@/app/settings/view";
import { CHROME_SUBNAV_PROPERTY } from "@/app/ui";

import { type PaneFixture, mountPane } from "../helpers/settings";

/**
 * The hub's own tab row (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491)): six
 * anchors into the page being read, the one for the section being read marked current, and
 * that mark following the **pane's** scroll. The row a mounted page draws is
 * `settings-frame.test.tsx`'s.
 */

/** Mockup 17's rows at desktop width. */
const LAYOUT = {
  workspace: 180,
  members: 180,
  policies: 480,
  audit: 480,
  integrations: 760,
  danger: 900,
};

let fixture: PaneFixture | undefined;

/**
 * Draw the hub's row inside a scrolling pane that holds the six sections.
 *
 * @param hash The address's fragment, if the page was opened on one.
 * @returns The pane fixture.
 */
function hub(hash = ""): PaneFixture {
  window.history.replaceState(null, "", `/settings${hash}`);
  fixture = mountPane(LAYOUT);

  const seat = document.createElement("div");
  fixture.pane.prepend(seat);
  render(<SettingsSubnav page="hub" />, { container: seat });

  return fixture;
}

/** The tab row. */
function tabs(): HTMLElement {
  return screen.getByRole("navigation", { name: "Settings" });
}

/**
 * Press a section's tab.
 *
 * The press's default — the browser's fragment navigation — is prevented at the far end of the
 * event's path, after the row has heard it: jsdom has no fragment scroll to perform, and says
 * so on every unprevented link.
 *
 * @param name The tab's label.
 * @param init The click's modifiers.
 */
function pressTab(name: string, init: MouseEventInit = {}): void {
  const swallow = (event: Event): void => {
    event.preventDefault();
  };

  window.addEventListener("click", swallow);
  fireEvent.click(within(tabs()).getByRole("link", { name }), init);
  window.removeEventListener("click", swallow);
}

/** The labels of the tabs marked current. */
function current(): (string | null)[] {
  return [...tabs().querySelectorAll("[aria-current]")].map((tab) => tab.textContent);
}

afterEach(() => {
  fixture?.remove();
  fixture = undefined;
  window.history.replaceState(null, "", "/");
});

describe("the six anchors", () => {
  it("are fragments of the page being read, as plain links", () => {
    hub();

    for (const tab of SECTION_TABS) {
      const link = within(tabs()).getByRole("link", { name: tab.label });

      // The browser's own fragment navigation: the pane moves, the address updates, Back works.
      expect(link).toHaveAttribute("href", `#${tab.id}`);
    }
  });

  it("mark the first section current on a page at its head — as a location, not a page", () => {
    hub();

    expect(current()).toEqual(["Workspace"]);
    expect(within(tabs()).getByRole("link", { name: "Workspace" })).toHaveAttribute(
      "aria-current",
      "location",
    );
  });

  it("leave the mounted tabs as routes, none of them current on the hub", () => {
    hub();

    expect(within(tabs()).getByRole("link", { name: "Sources" })).toHaveAttribute(
      "href",
      "/settings/sources",
    );
    expect(within(tabs()).getByRole("link", { name: "Sources" })).not.toHaveAttribute("aria-current");
    expect(within(tabs()).getByRole("link", { name: "Providers" })).toHaveAttribute(
      "href",
      "/models/providers",
    );
  });
});

describe("the scroll-spy", () => {
  it("moves the mark as the pane scrolls", () => {
    const pane = hub();

    act(() => {
      pane.scrollTo(430);
    });
    expect(current()).toEqual(["Policies"]);

    act(() => {
      pane.scrollTo(710);
    });
    expect(current()).toEqual(["Danger zone"]);

    act(() => {
      pane.scrollTo(0);
    });
    expect(current()).toEqual(["Workspace"]);
  });

  it("never marks two tabs at once", () => {
    const pane = hub();

    for (const top of [0, 100, 300, 430, 500, 650, 700]) {
      act(() => {
        pane.scrollTo(top);
      });
      expect(current(), `at ${String(top)}`).toHaveLength(1);
    }
  });

  it("lights the tab that was pressed, though its section shares a row with another", () => {
    const pane = hub();

    pressTab("Audit");
    // The scroll event of the jump, arriving after it.
    act(() => {
      fireEvent.scroll(pane.pane);
    });

    expect(current()).toEqual(["Audit"]);
    expect(pane.pane.scrollTop).toBe(430);
  });

  it("lights a pressed tab whose section the page cannot scroll to the top", () => {
    const pane = hub();

    pressTab("Integrations");
    act(() => {
      fireEvent.scroll(pane.pane);
    });

    expect(pane.pane.scrollTop).toBe(pane.max);
    expect(current()).toEqual(["Integrations"]);
  });

  it("lets go of the pressed tab once the reader scrolls on", () => {
    const pane = hub();
    pressTab("Audit");

    act(() => {
      pane.scrollTo(460);
    });

    expect(current()).toEqual(["Policies"]);
  });

  it("leaves a press that opens the section in another tab alone", () => {
    const pane = hub();

    pressTab("Audit", { metaKey: true });

    expect(pane.pane.scrollTop).toBe(0);
    expect(current()).toEqual(["Workspace"]);
  });
});

describe("a deep link", () => {
  it("lands on its section and marks it on first load", () => {
    const pane = hub("#policies");

    expect(pane.pane.scrollTop).toBe(430);
    expect(current()).toEqual(["Policies"]);
  });

  it("lands on the Danger zone — where the lifecycle banner's action leads", () => {
    const pane = hub("#danger");

    expect(pane.pane.scrollTop).toBe(pane.max);
    expect(current()).toEqual(["Danger zone"]);
  });

  it("starts at the head for a fragment that names no section", () => {
    const pane = hub("#nowhere");

    expect(pane.pane.scrollTop).toBe(0);
    expect(current()).toEqual(["Workspace"]);
  });

  it("follows the fragment when Back or Forward changes it", () => {
    const pane = hub("#policies");

    window.history.replaceState(null, "", "/settings#members");
    act(() => {
      fireEvent(window, new HashChangeEvent("hashchange"));
    });

    expect(current()).toEqual(["Members"]);
    expect(pane.pane.scrollTop).toBe(130);
  });
});

describe("the chrome contract", () => {
  it("is the CP.4 primitive, publishing its height to the pane it sticks against", () => {
    const pane = hub();

    expect(tabs()).toHaveClass("ou-subnav", "settings__subnav");
    // The property the pane's `scroll-padding-top` — the spy's reading line — is computed from.
    expect(pane.pane.style.getPropertyValue(CHROME_SUBNAV_PROPERTY)).toBe("0px");
  });
});

describe("a mounted page", () => {
  it("does not spy: nothing is marked by scrolling, and the sections are routes", () => {
    window.history.replaceState(null, "", "/settings/sources");
    fixture = mountPane(LAYOUT);
    const seat = document.createElement("div");
    fixture.pane.prepend(seat);
    render(<SettingsSubnav page="sources" />, { container: seat });

    act(() => {
      fixture?.scrollTo(430);
    });

    expect(current()).toEqual(["Sources"]);
    expect(within(tabs()).getByRole("link", { name: "Policies" })).toHaveAttribute(
      "href",
      "/settings#policies",
    );
  });
});
