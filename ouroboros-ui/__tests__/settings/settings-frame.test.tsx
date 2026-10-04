import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  FARM_TOKENS_PATH,
  KNOWLEDGE_ENV_PATH,
  PROVIDERS_PATH,
  SOURCES_PATH,
  settingsSectionPath,
} from "@/app/paths";
import { SettingsFrame } from "@/app/settings/settings-frame";
import { MOUNTED_TABS, SECTION_TABS, settingsEyebrow } from "@/app/settings/view";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The settings section's frame and tab row, as a mounted page draws them (BS.1,
 * [#491](https://github.com/NobuData/ouroboros/issues/491)): mockup 17's chrome, the six
 * sections as links back to the hub, and the four mounted admin surfaces (decision S2). The
 * hub's own row — anchors and the scroll-spy — is `settings-subnav.test.tsx`'s.
 */

function frame(active: "sources" | "farm-tokens" = "sources") {
  return render(
    <SettingsFrame
      actions={<button type="button">An action</button>}
      active={active}
      subline="The promise."
      title="The title"
      workspaceName="Acme Robotics"
    >
      <p>The content</p>
    </SettingsFrame>,
  );
}

/** The tab row. */
function tabs(): HTMLElement {
  return screen.getByRole("navigation", { name: "Settings" });
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
    expect(
      within(document.querySelector(".settings__actions") as HTMLElement).getByRole("button"),
    ).toBeInTheDocument();
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

describe("the tab row on a mounted page", () => {
  it("draws mockup 17's six sections, then the mounted surfaces, in one order on every page", () => {
    frame();

    expect([...tabs().querySelectorAll("a")].map((tab) => tab.textContent)).toEqual([
      "Workspace",
      "Members",
      "Policies",
      "Integrations",
      "Audit",
      "Danger zone",
      "Sources",
      "Providers",
      "Farm tokens",
      "Knowledge / env",
    ]);
  });

  it("separates the two groups with a rule a screen reader does not hear", () => {
    frame();

    const rule = tabs().querySelector(".settings__subnav-rule") as HTMLElement;

    expect(rule).toHaveAttribute("aria-hidden", "true");
    // After the last section and before the first mounted tab.
    expect(rule.previousElementSibling).toHaveTextContent("Danger zone");
    expect(rule.nextElementSibling).toHaveTextContent("Sources");
  });

  it("leads each section back to the hub's own fragment, and marks none current", () => {
    frame();

    for (const tab of SECTION_TABS) {
      const link = within(tabs()).getByRole("link", { name: tab.label });

      expect(link).toHaveAttribute("href", settingsSectionPath(tab.id));
      expect(link).not.toHaveAttribute("aria-current");
    }
  });

  it("links every mounted surface where it lives, with no tab left as a stub", () => {
    frame();

    const hrefs = Object.fromEntries(
      MOUNTED_TABS.map((tab) => [
        tab.label,
        within(tabs()).getByRole("link", { name: tab.label }).getAttribute("href"),
      ]),
    );

    expect(hrefs).toEqual({
      Sources: SOURCES_PATH,
      Providers: PROVIDERS_PATH,
      "Farm tokens": FARM_TOKENS_PATH,
      "Knowledge / env": KNOWLEDGE_ENV_PATH,
    });
    // The honest *soon* tabs the row drew while it waited for #491 are all gone.
    expect(tabs().querySelector(".ou-subnav__soon")).toBeNull();
  });

  it("marks the page's own tab current, and only that one", () => {
    frame("sources");

    expect(within(tabs()).getByRole("link", { name: "Sources" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(tabs().querySelectorAll("[aria-current]")).toHaveLength(1);
  });

  it("moves the underline to Farm tokens on that page", () => {
    frame("farm-tokens");

    expect(within(tabs()).getByRole("link", { name: "Farm tokens" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(tabs()).getByRole("link", { name: "Sources" })).not.toHaveAttribute("aria-current");
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
