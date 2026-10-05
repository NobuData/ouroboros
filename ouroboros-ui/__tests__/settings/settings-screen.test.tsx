import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DryRunPolicy } from "@/app/api/policies";
import type { Reading } from "@/app/api/reading";
import { DRY_RUN_TITLE, POLICY_READ_ONLY, dryRunUnread } from "@/app/policies/view";
import { FONT_SCALE_ATTRIBUTE, setFontScale } from "@/app/font-scale";
import { READ_ONLY_BODY, settingsAccess } from "@/app/settings/access";
import { APPEARANCE_TAG } from "@/app/settings/appearance";
import { NOTHING_TO_SAVE } from "@/app/settings/save-model";
import {
  IMMEDIATE_MARK,
  SECTION_TABS,
  SETTINGS_SECTIONS,
  SETTINGS_SUBLINE,
  SETTINGS_TITLE,
  sectionTitleId,
} from "@/app/settings/view";

import { ThemeProvider } from "@/app/theme-provider";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { renderThemed } from "../helpers/theme";
import { READ_AT, retentionSettings, workspaceSettings } from "../helpers/workspace";

/**
 * The settings hub, rendered (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491)):
 * mockup 17's head, the section nav, the eight seats — and the page's three variants, owner,
 * admin and read-only, the last of which must be legible rather than a page of dead controls.
 */

// The dry-run flip's Server Action is never reached: no case confirms one.
vi.mock("@/app/policies/policy-actions", () => ({ setDryRun: vi.fn() }));
// The Members card's Server Actions are never reached here: its own suites drive them.
// The Workspace card's Server Action is never reached here: its own suites drive it.
vi.mock("@/app/settings/workspace-actions", () => ({ saveWorkspaceCard: vi.fn() }));
vi.mock("@/app/members/members-actions", () => ({
  inviteMember: vi.fn(),
  resendInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  updateMember: vi.fn(),
  removeMember: vi.fn(),
  createServiceAccount: vi.fn(),
  rotateServiceAccount: vi.fn(),
  revokeServiceAccount: vi.fn(),
}));

/** The Server Action the Appearance card persists a font-size step through. */
const { saveFontScale } = vi.hoisted(() => ({
  saveFontScale: vi.fn<(scale: string) => Promise<boolean>>().mockResolvedValue(true),
}));

vi.mock("@/app/shell/preference-actions", () => ({
  saveFontScale: (scale: string) => saveFontScale(scale),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  unstable_rethrow: () => {},
}));

const { SettingsScreen } = await import("@/app/settings/settings-screen");

/** The dry-run policy, on. */
const POLICY: DryRunPolicy = {
  dryRun: true,
  explicit: true,
  reason: "dry-run policy active",
  updatedAt: "2026-09-30T12:00:00.000Z",
  updatedBy: null,
};

const READ: Reading<DryRunPolicy> = { ok: true, value: POLICY };

/**
 * Draw the hub for a reader.
 *
 * @param roles The reader's roles in the workspace. Defaults to an owner.
 * @param dryRun The dry-run policy as read. Defaults to a successful read.
 * @returns The render result.
 */
function hub(
  roles: Parameters<typeof settingsAccess>[0] = ["owner"],
  dryRun: Reading<DryRunPolicy> = READ,
) {
  // Under the theme provider, as the application renders everything: the Appearance card's
  // theme choice is the #17 engine's.
  return renderThemed(
    <SettingsScreen access={settingsAccess(roles)} dryRun={dryRun} workspaceName="acme-robotics" />,
  );
}

afterEach(() => {
  // The font-size engine is module state on `<html>`; each case starts at the default.
  setFontScale("100");
  saveFontScale.mockClear();
});

/** The head's actions. */
function actions(): HTMLElement {
  return document.querySelector(".settings__actions") as HTMLElement;
}

/** One section's seat. */
function seat(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

describe("the page head", () => {
  it("composes the eyebrow from the real workspace over mockup 17's title and subline", () => {
    hub();

    expect(screen.getByText("Settings · acme-robotics")).toHaveClass("ou-eyebrow");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(SETTINGS_TITLE);
    expect(screen.getByText(SETTINGS_SUBLINE)).toHaveClass("settings__sub");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("offers Export audit CSV as a shortcut to the Audit section, and Save changes", () => {
    hub();

    const shortcut = within(actions()).getByRole("link", { name: "Export audit CSV" });

    expect(shortcut).toHaveAttribute("href", "#audit");
    expect(seat("audit")).not.toBeNull();
    expect(within(actions()).getByRole("button", { name: "Save changes" })).toHaveClass("ou-btn--primary");
  });

  it("draws Save changes inert with its reason while nothing is unsaved", () => {
    hub();

    const save = within(actions()).getByRole("button", { name: "Save changes" });

    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(save).toHaveAttribute("title", NOTHING_TO_SAVE);
  });

  it("is a main landmark with no chrome of its own — the shell's pane is what scrolls", () => {
    const { container } = hub();

    expect(screen.getByRole("main")).toHaveClass("settings");
    expect(container.querySelector("[class*='shell-']")).toBeNull();
    expect(container.querySelector(".topbar")).toBeNull();
  });
});

describe("the section nav", () => {
  it("draws the six anchors and the four mounted tabs", () => {
    hub();

    const tabs = screen.getByRole("navigation", { name: "Settings" });

    expect([...tabs.querySelectorAll("a")].map((tab) => tab.textContent)).toEqual([
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

  it("gives every anchor a section to land on", () => {
    hub();

    for (const tab of SECTION_TABS) {
      const link = within(screen.getByRole("navigation", { name: "Settings" })).getByRole("link", {
        name: tab.label,
      });

      expect(link).toHaveAttribute("href", `#${tab.id}`);
      expect(seat(tab.id), tab.id).toHaveClass("settings__seat");
    }
  });
});

describe("the section grid", () => {
  it("seats mockup 17's eight cards, in its rows, under the ids the anchors name", () => {
    hub();

    const seats = [...document.querySelectorAll(".settings__grid > .settings__seat")];

    expect(seats.map((one) => one.id)).toEqual(SETTINGS_SECTIONS.map((section) => section.id));
    expect(seats.map((one) => [...one.classList].find((name) => name.startsWith("settings__seat--")))).toEqual([
      "settings__seat--5",
      "settings__seat--7",
      "settings__seat--12",
      "settings__seat--7",
      "settings__seat--5",
      "settings__seat--7",
      "settings__seat--5",
      "settings__seat--12",
    ]);
  });

  it("names every section as a region, with a real heading", () => {
    hub();

    for (const section of SETTINGS_SECTIONS) {
      const region = screen.getByRole("region", { name: section.title });

      expect(seat(section.id)).toContainElement(region);
      expect(within(region).getByRole("heading", { level: 2 })).toHaveAttribute(
        "id",
        sectionTitleId(section.id),
      );
    }
  });

  it("says, in every seat whose card is not built, what is coming and with which issue", () => {
    hub();

    for (const section of SETTINGS_SECTIONS) {
      if (section.arrives === null) continue;

      expect(within(seat(section.id)).getByText(section.arrives)).toHaveClass("ou-empty__note");
    }
    // The one card that is built has nothing left to announce.
    expect(seat("appearance").querySelector(".ou-empty__note")).toBeNull();
  });

  it("marks the sections whose controls act at once, and only those", () => {
    hub();

    const marked = SETTINGS_SECTIONS.filter(
      (section) => seat(section.id).querySelector(".ou-tag")?.textContent?.includes(IMMEDIATE_MARK),
    ).map((section) => section.id);

    expect(marked).toEqual(["members", "appearance", "danger"]);
    expect(within(seat("danger")).getByText(IMMEDIATE_MARK)).toHaveClass("ou-tag");
    expect(within(seat("appearance")).getByText(APPEARANCE_TAG)).toHaveClass("ou-tag");
  });

  it("draws the Danger zone in the error rim", () => {
    hub();

    expect(screen.getByRole("region", { name: "Danger zone" })).toHaveClass("settings__card--danger");
    expect(screen.getByRole("region", { name: "Workspace" })).not.toHaveClass("settings__card--danger");
  });
});

describe("the Appearance section", () => {
  it("mounts its card: the theme choice, the five font-size steps and the preview", () => {
    hub();

    const card = within(seat("appearance"));

    expect(card.getByRole("combobox", { name: "Theme" })).toHaveValue("system");
    expect(
      within(card.getByRole("group", { name: "Font size" }))
        .getAllByRole("button")
        .map((step) => step.textContent),
    ).toEqual(["87.5%", "100%", "112.5%", "125%", "150%"]);
    expect(card.getByRole("note", { name: "Preview" })).toHaveTextContent("dock_ctrl.c:214");
  });

  it("applies a step at once, outside the page's unsaved changes", () => {
    hub();

    fireEvent.click(within(seat("appearance")).getByRole("button", { name: "125%" }));

    expect(document.documentElement).toHaveAttribute(FONT_SCALE_ATTRIBUTE, "125");
    expect(saveFontScale).toHaveBeenCalledExactlyOnceWith("125");
    // Nothing became unsaved: the section is immediate, and Save changes never sends it.
    expect(within(actions()).getByRole("button", { name: "Save changes" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(document.querySelector(".settings-dirty")).toBeNull();
  });

  it("is a viewer's to operate too: it is their own preference, not the workspace's", () => {
    hub(["viewer"]);

    const step = within(seat("appearance")).getByRole("button", { name: "150%" });

    expect(step).not.toHaveAttribute("aria-disabled");
    fireEvent.click(step);

    expect(document.documentElement).toHaveAttribute(FONT_SCALE_ATTRIBUTE, "150");
  });
});

describe("the Workspace section", () => {
  it("holds the Workspace card when both of its reads succeeded", () => {
    renderThemed(
      <SettingsScreen
        access={settingsAccess(["owner"])}
        dryRun={READ}
        readAt={READ_AT}
        retention={{ ok: true, value: retentionSettings() }}
        workspace={{ ok: true, value: workspaceSettings() }}
        workspaceName="acme-robotics"
      />,
    );

    expect(within(seat("workspace")).getByLabelText("Workspace name")).toHaveValue("acme-robotics");
    expect(within(seat("workspace")).queryByText(/arrive/)).toBeNull();
  });

  it("says which read failed rather than drawing half a card", () => {
    renderThemed(
      <SettingsScreen
        access={settingsAccess(["owner"])}
        dryRun={READ}
        retention={{ ok: false, reason: "The service is restarting." }}
        workspace={{ ok: true, value: workspaceSettings() }}
        workspaceName="acme-robotics"
      />,
    );

    expect(within(seat("workspace")).getByRole("note")).toHaveTextContent(
      "The retention tiers could not be read, so this card is not drawn. The service is restarting.",
    );
    expect(within(seat("workspace")).queryByRole("textbox")).toBeNull();
  });
});

describe("the Policies section", () => {
  it("mounts the dry-run policy's row above the note for the rest of the card", () => {
    hub();

    const row = within(seat("policies")).getByRole("group", { name: DRY_RUN_TITLE });

    expect(within(row).getByRole("heading", { level: 3 })).toHaveTextContent(DRY_RUN_TITLE);
    expect(within(row).getAllByRole("status")[0]).toHaveTextContent(/^On — /);
    expect(within(seat("policies")).getByText(/arrive here with #494/)).toBeInTheDocument();
  });

  it("flips the policy as an immediate action behind a confirmation — never a saved field", async () => {
    hub();

    await act(async () => {
      fireEvent.click(within(seat("policies")).getByRole("button", { name: "Turn dry-run off" }));
    });

    // The confirmation states the consequences; nothing joined the page's unsaved changes.
    expect(screen.getByRole("alertdialog", { name: "Turn dry-run off?" })).toBeInTheDocument();
    expect(within(actions()).getByRole("button", { name: "Save changes" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(document.querySelector(".settings-dirty")).toBeNull();
  });

  it("says what could not be read, and keeps the rest of the page", () => {
    hub(["owner"], { ok: false, reason: "The service is restarting." });

    expect(within(seat("policies")).getByRole("note")).toHaveTextContent(
      dryRunUnread("The service is restarting."),
    );
    expect(within(seat("policies")).queryByRole("group", { name: DRY_RUN_TITLE })).toBeNull();
    // One failed read is one degraded region, never a blank page.
    expect(document.querySelectorAll(".settings__seat")).toHaveLength(8);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(SETTINGS_TITLE);
  });
});

describe("an owner and an admin", () => {
  it.each([["owner"], ["admin"]] as const)("as %s: Save changes, the flip, and no read-only note", (role) => {
    hub([role]);

    expect(within(actions()).getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(within(seat("policies")).getByRole("button", { name: "Turn dry-run off" })).toBeInTheDocument();
    expect(document.querySelector(".settings__readonly")).toBeNull();
  });
});

describe("a viewer", () => {
  it.each([["viewer"], ["member"]] as const)("as %s: the whole page, with a note naming the role", (role) => {
    hub([role]);

    const note = document.querySelector(".settings__readonly") as HTMLElement;

    expect(note).toHaveAttribute("role", "note");
    expect(note).toHaveTextContent(`Viewing workspace settings as a ${role}. ${READ_ONLY_BODY}`);
    // Every section is still there to be read.
    expect(document.querySelectorAll(".settings__seat")).toHaveLength(8);
    expect(screen.getByRole("navigation", { name: "Settings" }).querySelectorAll("a")).toHaveLength(10);
  });

  it("is offered no Save changes — and still the audit shortcut, which only navigates", () => {
    hub(["viewer"]);

    expect(within(actions()).queryByRole("button")).toBeNull();
    expect(within(actions()).getByRole("link", { name: "Export audit CSV" })).toBeInTheDocument();
  });

  it("reads the dry-run policy and why it cannot be changed, as text", () => {
    hub(["viewer"]);

    const row = within(seat("policies")).getByRole("group", { name: DRY_RUN_TITLE });

    expect(within(row).getAllByRole("status")[0]).toHaveTextContent(/^On — /);
    expect(within(row).getByRole("note")).toHaveTextContent(POLICY_READ_ONLY);
  });

  it("is drawn no dead-looking control anywhere on the page", () => {
    hub(["viewer"]);

    const main = screen.getByRole("main");

    // Every control on the page is one the viewer can use — their own Appearance preferences —
    // and nothing is drawn switched off.
    for (const button of within(main).queryAllByRole("button")) {
      expect(seat("appearance")).toContainElement(button);
    }
    expect(main.querySelector("[aria-disabled='true']")).toBeNull();
    expect(main.querySelector("[disabled]")).toBeNull();
    expect(main.querySelector(".ou-subnav__soon")).toBeNull();
  });

  it("is offered nothing that would change the workspace", () => {
    hub(["viewer"]);

    expect(screen.queryByRole("button", { name: /Save changes/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /dry-run/ })).toBeNull();
  });
});

describe("both palettes", () => {
  it("draws the same markup in both, for an owner and for a viewer", () => {
    for (const role of ["owner", "viewer"] as const) {
      const [light, dark] = renderInBothPalettes(
        <ThemeProvider>
          <SettingsScreen access={settingsAccess([role])} dryRun={READ} workspaceName="acme-robotics" />
        </ThemeProvider>,
      );

      expect(maskIds(light!), role).toBe(maskIds(dark!));
    }
  });
});
