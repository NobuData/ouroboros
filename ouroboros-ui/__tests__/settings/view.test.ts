import { describe, expect, it } from "vitest";

import {
  FARM_TOKENS_PATH,
  KNOWLEDGE_ENV_PATH,
  PROVIDERS_PATH,
  SETTINGS_PATH,
  SOURCES_PATH,
} from "@/app/paths";
import {
  EXPORT_AUDIT_LABEL,
  IMMEDIATE_MARK,
  MOUNTED_TABS,
  SECTION_TABS,
  SETTINGS_SECTIONS,
  SETTINGS_SUBLINE,
  SETTINGS_TITLE,
  isSectionTab,
  sectionTitleId,
  settingsEyebrow,
  settingsSection,
  unsavedMark,
} from "@/app/settings/view";

/**
 * The settings hub's copy, sections and tab set as values (BS.1,
 * [#491](https://github.com/NobuData/ouroboros/issues/491)) — held to mockup 17 and to the
 * decisions the issue names (S2: the mounted surfaces; S7: how a section saves).
 */

describe("the head's copy", () => {
  it("is mockup 17's, verbatim", () => {
    expect(SETTINGS_TITLE).toBe("Workspace settings");
    expect(SETTINGS_SUBLINE).toBe(
      "Who can do what, what merges on its own, and where the record lives.",
    );
    expect(EXPORT_AUDIT_LABEL).toBe("Export audit CSV");
  });

  it("composes the eyebrow from the real workspace", () => {
    expect(settingsEyebrow("acme-robotics")).toBe("Settings · acme-robotics");
  });
});

describe("the sections", () => {
  it("are mockup 17's eight cards, each under the id its anchor names", () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual([
      "workspace",
      "members",
      "appearance",
      "policies",
      "audit",
      "integrations",
      "notifications",
      "danger",
    ]);
    expect(new Set(SETTINGS_SECTIONS.map((section) => section.id)).size).toBe(8);
  });

  it("fill the twelve-column grid in whole rows, so no card leaves a hole", () => {
    const rows: number[] = [];
    let row = 0;

    for (const section of SETTINGS_SECTIONS) {
      if (row + section.span > 12) {
        rows.push(row);
        row = 0;
      }
      row += section.span;
    }
    rows.push(row);

    expect(rows).toEqual([12, 12, 12, 12, 12]);
  });

  it("each say what their card will hold and the issue that builds it — until the card is built", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(section.title.length, section.id).toBeGreaterThan(0);
      if (["appearance", "members", "workspace"].includes(section.id)) continue;

      expect(section.arrives, section.id).toMatch(/arrives? (here )?with #49[2-6]\./);
    }
    // The Appearance, Members and Workspace cards are built (#491, #493, #492), so their seats
    // announce nothing.
    expect(settingsSection("appearance").arrives).toBeNull();
    expect(settingsSection("workspace").arrives).toBeNull();
    expect(settingsSection("members").arrives).toBeNull();
  });

  it("mark the sections whose controls act at once — Members, Appearance and the Danger zone", () => {
    expect(
      SETTINGS_SECTIONS.filter((section) => section.saves === "immediate").map((section) => section.id),
    ).toEqual(["members", "appearance", "danger"]);
    expect(settingsSection("danger").saves).toBe("immediate");
    expect(settingsSection("workspace").saves).toBe("batch");
  });

  it("looks one up by id, and refuses an id that names none", () => {
    expect(settingsSection("audit").title).toBe("Audit log");
    expect(() => settingsSection("nowhere" as never)).toThrow(/not a settings section/);
  });

  it("gives each heading an id of its own", () => {
    expect(sectionTitleId("policies")).toBe("settings-policies-title");
    expect(new Set(SETTINGS_SECTIONS.map((section) => sectionTitleId(section.id))).size).toBe(8);
  });
});

describe("the section tabs", () => {
  it("are the six anchors of mockup 17's nav, in its order", () => {
    expect(SECTION_TABS.map((tab) => tab.label)).toEqual([
      "Workspace",
      "Members",
      "Policies",
      "Integrations",
      "Audit",
      "Danger zone",
    ]);
  });

  it("each name a section the page draws", () => {
    for (const tab of SECTION_TABS) {
      expect(settingsSection(tab.id).tab).toBe(tab.label);
    }
  });

  it("leave out the two cards the mockup's nav does not name", () => {
    const ids = SECTION_TABS.map((tab) => tab.id);

    expect(ids).not.toContain("appearance");
    expect(ids).not.toContain("notifications");
  });

  it("recognise a fragment that names one, and nothing else", () => {
    expect(isSectionTab("policies")).toBe(true);
    expect(isSectionTab("danger")).toBe(true);
    // A card with no tab is not a place the nav can be on.
    expect(isSectionTab("appearance")).toBe(false);
    expect(isSectionTab("")).toBe(false);
    expect(isSectionTab("sources")).toBe(false);
  });
});

describe("the mounted tabs (decision S2)", () => {
  it("are Sources, Providers, Farm tokens and Knowledge / env, in the issue's order", () => {
    expect(MOUNTED_TABS.map((tab) => tab.label)).toEqual([
      "Sources",
      "Providers",
      "Farm tokens",
      "Knowledge / env",
    ]);
  });

  it("each lead to the surface's own address — nothing is a second copy", () => {
    expect(Object.fromEntries(MOUNTED_TABS.map((tab) => [tab.id, tab.href]))).toEqual({
      sources: SOURCES_PATH,
      providers: PROVIDERS_PATH,
      "farm-tokens": FARM_TOKENS_PATH,
      "knowledge-env": KNOWLEDGE_ENV_PATH,
    });
  });

  it("keep Sources and Farm tokens under /settings, so the Settings entry stays lit there", () => {
    expect(SOURCES_PATH.startsWith(`${SETTINGS_PATH}/`)).toBe(true);
    expect(FARM_TOKENS_PATH.startsWith(`${SETTINGS_PATH}/`)).toBe(true);
  });

  it("leave Providers in the Models section and Knowledge / env on the Knowledge page", () => {
    expect(PROVIDERS_PATH).toBe("/models/providers");
    expect(KNOWLEDGE_ENV_PATH).toBe("/knowledge#repo-profile");
  });
});

describe("the save markers", () => {
  it("say how many of a section's fields are unsaved", () => {
    expect(unsavedMark(1)).toBe("1 unsaved");
    expect(unsavedMark(3)).toBe("3 unsaved");
  });

  it("say that an immediate section applies instantly — the word mockup 17's own tag uses", () => {
    expect(IMMEDIATE_MARK).toBe("applies instantly");
  });
});
