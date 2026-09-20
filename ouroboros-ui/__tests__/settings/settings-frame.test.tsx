import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FARM_TOKENS_PATH, SOURCES_PATH } from "@/app/paths";
import { SettingsFrame } from "@/app/settings/settings-frame";
import { HUB_NOTE, SETTINGS_TABS, isLiveTab, settingsEyebrow } from "@/app/settings/view";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The settings section's frame and tab row
 * ([#141](https://github.com/NobuData/ouroboros/issues/141), ahead of BS.1 #491): mockup 17's
 * chrome, the mounted live tabs — Sources, and Farm tokens since #258 — and six honest `soon` ones.
 */

function frame() {
  return render(
    <SettingsFrame
      actions={<button type="button">An action</button>}
      active="sources"
      subline="The promise."
      title="The title"
      workspaceName="Acme Robotics"
    >
      <p>The content</p>
    </SettingsFrame>,
  );
}

describe("the anatomy", () => {
  it("is a main landmark starting at its page head, with no chrome of its own", () => {
    const { container } = frame();

    expect(screen.getByRole("main")).toHaveClass("settings");
    expect(container.querySelector("header")).toBeNull();
    expect(container.querySelector("[class*='shell-']")).toBeNull();
  });

  it("names the workspace in the eyebrow, as mockup 17 does", () => {
    frame();

    const headings = document.querySelector(".settings__headings") as HTMLElement;

    expect(within(headings).getByText(settingsEyebrow("Acme Robotics"))).toHaveClass("ou-eyebrow");
    expect(settingsEyebrow("Acme Robotics")).toBe("Settings · Acme Robotics");
    expect(within(headings).getByRole("heading", { level: 1 })).toHaveTextContent("The title");
    expect(within(headings).getByText("The promise.")).toHaveClass("settings__sub");
  });

  it("orders head, tab set, then the page's content, with one h1", () => {
    frame();

    const main = screen.getByRole("main");
    const order = [...main.children].map((child) =>
      child.classList.contains("settings__head")
        ? "head"
        : child.getAttribute("aria-label") === "Settings"
          ? "subnav"
          : "content",
    );

    expect(order).toEqual(["head", "subnav", "content"]);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(document.querySelector(".settings__actions") as HTMLElement).getByRole("button")).toBeInTheDocument();
  });

  it("is busy and named while loading", () => {
    render(
      <SettingsFrame actions={null} active="sources" busy="Loading" subline="s" title="t" workspaceName="w">
        <p />
      </SettingsFrame>,
    );

    expect(screen.getByRole("main", { name: "Loading" })).toHaveAttribute("aria-busy", "true");
  });
});

describe("the tab row", () => {
  it("draws mockup 17's sections with the mounted surfaces slotted among them, in one order on every page", () => {
    frame();

    const tabs = screen.getByRole("navigation", { name: "Settings" });

    expect([...tabs.children].map((tab) => tab.textContent)).toEqual([
      "Workspacesoon",
      "Memberssoon",
      "Policiessoon",
      "Sources",
      "Farm tokens",
      "Integrationssoon",
      "Auditsoon",
      "Danger zonesoon",
    ]);
  });

  it("links the built surfaces — the active one current — and names BS.1 on every other", () => {
    frame();

    const tabs = screen.getByRole("navigation", { name: "Settings" });
    const sources = within(tabs).getByRole("link", { name: "Sources" });
    const farmTokens = within(tabs).getByRole("link", { name: "Farm tokens" });

    expect(sources).toHaveAttribute("href", SOURCES_PATH);
    expect(sources).toHaveAttribute("aria-current", "page");
    // The build farm's enrollment tokens, mounted by the amendment on #258 (decision S2).
    expect(farmTokens).toHaveAttribute("href", FARM_TOKENS_PATH);
    expect(farmTokens).not.toHaveAttribute("aria-current");
    expect(within(tabs).getAllByRole("link")).toHaveLength(2);

    for (const tab of SETTINGS_TABS) {
      if (isLiveTab(tab)) continue;

      const soon = within(tabs).getByText(tab.label, { selector: ".ou-subnav__soon" });

      expect(soon.tagName).toBe("SPAN");
      expect(soon).toHaveAttribute("title", `${tab.label} — ${HUB_NOTE}`);
      expect(HUB_NOTE).toContain("#491");
    }
  });

  it("moves the underline to Farm tokens on that page", () => {
    render(
      <SettingsFrame actions={null} active="farm-tokens" subline="s" title="t" workspaceName="w">
        <p />
      </SettingsFrame>,
    );

    const tabs = screen.getByRole("navigation", { name: "Settings" });

    expect(within(tabs).getByRole("link", { name: "Farm tokens" })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByRole("link", { name: "Sources" })).not.toHaveAttribute("aria-current");
  });

  it("makes the honesty pair a type: a live tab has an href, a soon tab a note, never both", () => {
    for (const tab of SETTINGS_TABS) {
      expect("href" in tab).not.toBe("note" in tab);
    }
  });
});

describe("both palettes", () => {
  it("draws the same markup in both", () => {
    const [light, dark] = renderInBothPalettes(
      <SettingsFrame actions={null} active="sources" subline="s" title="t" workspaceName="w">
        <p />
      </SettingsFrame>,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});
