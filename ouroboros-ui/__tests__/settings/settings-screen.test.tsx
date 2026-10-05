import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DryRunPolicy } from "@/app/api/policies";
import type { Reading } from "@/app/api/reading";
import { FOOTER_LINE, historyTrigger, policyUnread } from "@/app/policies/card-view";
import { RULE_NAMES } from "@/app/policies/document";
import { DRY_RUN_TITLE, POLICY_READ_ONLY, dryRunUnread } from "@/app/policies/view";
import { FONT_SCALE_ATTRIBUTE, setFontScale } from "@/app/font-scale";
import { AUDIT_ADMINS_ONLY, auditUnread } from "@/app/audit-log/view";
import { DELETE_OWNER_ONLY, PAUSE_ROLE_NOTE, lifecycleUnread } from "@/app/lifecycle/danger";
import { routesUnread } from "@/app/integrations/routes";
import { integrationsUnread } from "@/app/integrations/view";
import { READ_ONLY_BODY, settingsAccess } from "@/app/settings/access";
import { APPEARANCE_TAG } from "@/app/settings/appearance";
import { NOTHING_TO_SAVE } from "@/app/settings/save-model";
import { SETTINGS_LOADING_LABEL, SKELETON_ROWS } from "@/app/settings/settings-skeleton";
import { unreadHeadline } from "@/app/settings/unread";
import {
  IMMEDIATE_MARK,
  SECTION_TABS,
  SETTINGS_SECTIONS,
  SETTINGS_SUBLINE,
  SETTINGS_TITLE,
  sectionTitleId,
} from "@/app/settings/view";

import { ThemeProvider } from "@/app/theme-provider";

import { auditToday } from "../helpers/audit-log";
import { integrations, notificationRoutes } from "../helpers/integrations";
import { lifecycle, pausedLifecycle } from "../helpers/lifecycle";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { webhookList } from "../helpers/webhooks";
import { renderThemed } from "../helpers/theme";
import { orgPolicyV7 } from "../helpers/org-policy";
import { READ_AT, retentionSettings, workspaceSettings } from "../helpers/workspace";

/**
 * The settings hub, rendered (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491)):
 * mockup 17's head, the section nav, the eight seats — and the page's three variants, owner,
 * admin and read-only, the last of which must be legible rather than a page of dead controls.
 */

// The dry-run flip's Server Action is never reached: no case confirms one.
vi.mock("@/app/policies/policy-actions", () => ({ setDryRun: vi.fn() }));
// The Autonomy policies card's Server Actions are never reached here: its own suite drives them.
vi.mock("@/app/policies/card-actions", () => ({
  previewPolicy: vi.fn(),
  publishPolicy: vi.fn(),
  loadPolicyHistory: vi.fn(),
  previewPolicyPaths: vi.fn(),
}));
// The Members card's Server Actions are never reached here: its own suites drive them.
// The Workspace card's Server Action is never reached here: its own suites drive it.
vi.mock("@/app/settings/workspace-actions", () => ({ saveWorkspaceCard: vi.fn() }));
// BS.5's cards (#495) reach their Server Actions only in their own suites.
vi.mock("@/app/audit-log/audit-actions", () => ({ readAuditLog: vi.fn() }));
// The Danger zone's Server Actions (#496) are reached only in its own suite.
vi.mock("@/app/lifecycle/lifecycle-actions", () => ({
  readLifecycle: vi.fn(),
  pauseWorkspace: vi.fn(),
  resumeWorkspace: vi.fn(),
  // Opened once here, to show the switch is not a saved field; the read never answers.
  readDisconnectPreview: vi.fn(() => new Promise(() => {})),
  disconnectWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  restoreWorkspace: vi.fn(),
}));
vi.mock("@/app/integrations/routes-actions", () => ({ saveRoutes: vi.fn() }));
vi.mock("@/app/webhooks/webhook-actions", () => ({
  readWebhooks: vi.fn(),
  createWebhook: vi.fn(),
  updateWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  rotateWebhookSecret: vi.fn(),
  pingWebhook: vi.fn(),
  readDeliveries: vi.fn(),
  redeliverDelivery: vi.fn(),
}));
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
/** The router's re-read — what the error state's Retry calls. */
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/settings",
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
  refresh.mockClear();
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

  it("announces no card still to come: every seat's card is built", () => {
    hub();

    for (const section of SETTINGS_SECTIONS) {
      expect(section.arrives, section.id).toBeNull();
      expect(seat(section.id).querySelector(".ou-empty__note"), section.id).toBeNull();
    }
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
    // The card is built (#494): the seat no longer says what is coming.
    expect(within(seat("policies")).queryByText(/arrive here/)).toBeNull();
  });

  it("mounts the Autonomy policies card when the document was read, with the dry-run row under its rules", () => {
    renderThemed(
      <SettingsScreen
        access={settingsAccess(["owner"])}
        dryRun={READ}
        policy={{ ok: true, value: orgPolicyV7() }}
        workspaceName="acme-robotics"
      />,
    );

    const policies = within(seat("policies"));

    expect(policies.getByRole("heading", { level: 2 })).toHaveTextContent("Autonomy policies");
    expect(policies.getByRole("button", { name: historyTrigger(7) })).toBeInTheDocument();
    for (const name of Object.values(RULE_NAMES)) {
      expect(policies.getByText(name)).toBeInTheDocument();
    }
    expect(policies.getByText(FOOTER_LINE)).toBeInTheDocument();
    expect(policies.getByRole("group", { name: DRY_RUN_TITLE })).toBeInTheDocument();
  });

  it("says the document could not be read, and still offers the dry-run row", () => {
    renderThemed(
      <SettingsScreen
        access={settingsAccess(["owner"])}
        dryRun={READ}
        policy={{ ok: false, reason: "The service is restarting." }}
        workspaceName="acme-robotics"
      />,
    );

    const policies = within(seat("policies"));

    expect(policies.getByRole("note")).toHaveTextContent(policyUnread("The service is restarting."));
    expect(policies.getByRole("group", { name: DRY_RUN_TITLE })).toBeInTheDocument();
    expect(document.querySelectorAll(".settings__seat")).toHaveLength(8);
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

describe("the record surfaces — Audit, Integrations and Notifications (#495)", () => {
  /**
   * Draw the hub with BS.5's three reads.
   *
   * @param roles The reader's roles.
   * @param overrides Readings to replace.
   * @returns The render result.
   */
  function record(
    roles: Parameters<typeof settingsAccess>[0] = ["owner"],
    overrides: Partial<Parameters<typeof SettingsScreen>[0]> = {},
  ) {
    const administers = settingsAccess(roles).mayEdit;

    return renderThemed(
      <SettingsScreen
        access={settingsAccess(roles)}
        audit={administers ? { ok: true, value: auditToday() } : null}
        dryRun={READ}
        integrations={{ ok: true, value: integrations() }}
        routes={{ ok: true, value: notificationRoutes() }}
        webhooks={administers ? webhookList() : null}
        workspaceName="acme-robotics"
        {...overrides}
      />,
    );
  }

  it("seats the Audit card with the mockup's five rows, the tier's tag and the SIEM row", () => {
    record();

    const audit = within(seat("audit"));

    expect(audit.getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "14:31ouroboros-app[bot] (bot)pushed PR #514 rev 2",
      "14:12Ken (person)rotated Anthropic API key",
      "13:48Ken (person)enabled auto-merge (policy v7)",
      "13:22Maya (person)approved waiver on PR #509",
      "12:04system (system)runner forge-03 marked offline",
    ]);
    expect(audit.getByText("retained 400d")).toHaveClass("ou-tag");
    expect(audit.getByRole("button", { name: /^Stream to SIEM\./ })).toBeInTheDocument();
    expect(audit.getByRole("button", { name: "Export CSV" })).toBeInTheDocument();
  });

  it("seats the grid with the service's count, and the routes with their locked rows", () => {
    record();

    expect(within(seat("integrations")).getByText("4 connected")).toHaveClass("ou-tag");
    expect(within(seat("integrations")).getByText("not built yet")).toBeInTheDocument();
    expect(seat("notifications")).toHaveTextContent("connect PagerDuty first");
  });

  it("tells a viewer whose log the audit log is, and still draws the grid and the routes", () => {
    record(["viewer"]);

    expect(within(seat("audit")).getByRole("note")).toHaveTextContent(AUDIT_ADMINS_ONLY);
    expect(within(seat("audit")).queryByRole("button")).toBeNull();
    expect(within(seat("integrations")).getByText("4 connected")).toBeInTheDocument();
    expect(seat("notifications")).toHaveTextContent("connect PagerDuty first");
    // Nothing a viewer is drawn can change the workspace: no switch, no sheet, no dead control.
    for (const id of ["integrations", "notifications"]) {
      expect(within(seat(id)).queryByRole("button"), id).toBeNull();
      expect(within(seat(id)).queryByRole("switch"), id).toBeNull();
    }
    expect(screen.getByRole("main").querySelector("[aria-disabled='true'], [disabled]")).toBeNull();
  });

  it("keeps each failed read to its own seat, with the sentence that says why", () => {
    const down = { ok: false, reason: "The service is restarting." } as const;
    record(["owner"], { audit: down, integrations: down, routes: down, webhooks: null });

    expect(within(seat("audit")).getByRole("note")).toHaveTextContent(auditUnread(down.reason));
    expect(within(seat("integrations")).getByRole("note")).toHaveTextContent(
      integrationsUnread(down.reason),
    );
    expect(within(seat("notifications")).getByRole("note")).toHaveTextContent(
      routesUnread(down.reason),
    );
    expect(document.querySelectorAll(".settings__seat")).toHaveLength(8);
  });

  it("draws the same markup in both palettes, for an owner and for a viewer", () => {
    for (const role of ["owner", "viewer"] as const) {
      const administers = role === "owner";
      const [light, dark] = renderInBothPalettes(
        <ThemeProvider>
          <SettingsScreen
            access={settingsAccess([role])}
            audit={administers ? { ok: true, value: auditToday() } : null}
            dryRun={READ}
            integrations={{ ok: true, value: integrations() }}
            routes={{ ok: true, value: notificationRoutes() }}
            webhooks={administers ? webhookList() : null}
            workspaceName="acme-robotics"
          />
        </ThemeProvider>,
      );

      expect(maskIds(light!), role).toBe(maskIds(dark!));
    }
  });
});

describe("the Danger zone (#496)", () => {
  /**
   * Draw the hub with the workspace's lifecycle.
   *
   * @param roles The reader's roles.
   * @param read The lifecycle as read.
   * @returns The render result.
   */
  function danger(
    roles: Parameters<typeof settingsAccess>[0] = ["owner"],
    read: Parameters<typeof SettingsScreen>[0]["lifecycle"] = { ok: true, value: lifecycle() },
  ) {
    return renderThemed(
      <SettingsScreen
        access={settingsAccess(roles)}
        dryRun={READ}
        lifecycle={read}
        workspaceName="acme-robotics"
      />,
    );
  }

  it("seats the card in the error rim: the switch, Disconnect, and Delete naming the workspace", () => {
    danger();

    const card = within(seat("danger"));

    expect(screen.getByRole("region", { name: "Danger zone" })).toHaveClass("settings__card--danger");
    expect(card.getByRole("switch", { name: "Pause all loops" })).toHaveAttribute("aria-checked", "false");
    expect(card.getByRole("button", { name: "Disconnect…" })).toBeInTheDocument();
    expect(card.getByRole("button", { name: "Delete acme-robotics…" })).toBeInTheDocument();
    expect(card.getByText(IMMEDIATE_MARK)).toHaveClass("ou-tag");
  });

  it("draws the switch on for a paused workspace", () => {
    danger(["admin"], { ok: true, value: pausedLifecycle() });

    expect(within(seat("danger")).getByRole("switch", { name: "Resume all loops" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("keeps its controls out of the page's unsaved changes: nothing here can be saved later", () => {
    danger();

    fireEvent.click(within(seat("danger")).getByRole("switch"));

    expect(within(actions()).getByRole("button", { name: "Save changes" })).toHaveAttribute(
      "title",
      NOTHING_TO_SAVE,
    );
  });

  it("gives a viewer the three rows as text, and no control", () => {
    danger(["viewer"], { ok: true, value: pausedLifecycle() });

    const card = within(seat("danger"));

    expect(card.getByText(PAUSE_ROLE_NOTE)).toBeInTheDocument();
    expect(card.getByText(DELETE_OWNER_ONLY)).toBeInTheDocument();
    expect(card.queryByRole("switch")).toBeNull();
    expect(card.queryByRole("button")).toBeNull();
    expect(screen.getByRole("main").querySelector("[aria-disabled='true'], [disabled]")).toBeNull();
  });

  it("draws no control at all when the lifecycle could not be read, and says why", () => {
    danger(["owner"], { ok: false, reason: "The service is restarting." });

    const card = within(seat("danger"));

    expect(card.getByRole("note")).toHaveTextContent(lifecycleUnread("The service is restarting."));
    expect(card.queryByRole("switch")).toBeNull();
    expect(card.queryByRole("button")).toBeNull();
    expect(screen.getByRole("region", { name: "Danger zone" })).toHaveClass("settings__card--danger");
  });

  it("draws the same markup in both palettes — owner, viewer, and paused", () => {
    for (const [role, read] of [
      ["owner", lifecycle()],
      ["viewer", lifecycle()],
      ["owner", pausedLifecycle()],
    ] as const) {
      const [light, dark] = renderInBothPalettes(
        <ThemeProvider>
          <SettingsScreen
            access={settingsAccess([role])}
            dryRun={READ}
            lifecycle={{ ok: true, value: read }}
            workspaceName="acme-robotics"
          />
        </ThemeProvider>,
      );

      expect(maskIds(light!), `${role} ${read.state}`).toBe(maskIds(dark!));
    }
  });
});

describe("the page's error state (#496)", () => {
  const DOWN = { ok: false, reason: "The service is restarting." } as const;

  it("draws no retry box while every read that was made succeeded", () => {
    renderThemed(
      <SettingsScreen
        access={settingsAccess(["viewer"])}
        // Never requested for a viewer — which is not a failure.
        audit={null}
        dryRun={READ}
        lifecycle={{ ok: true, value: lifecycle() }}
        workspaceName="acme-robotics"
      />,
    );

    expect(document.querySelector(".ou-retry")).toBeNull();
  });

  it("says once, above the grid, how many sections could not be read — and which", () => {
    renderThemed(
      <SettingsScreen
        access={settingsAccess(["owner"])}
        audit={DOWN}
        dryRun={DOWN}
        lifecycle={DOWN}
        policy={DOWN}
        workspaceName="acme-robotics"
      />,
    );

    const box = document.querySelector(".ou-retry") as HTMLElement;

    // The policy document and the dry-run switch are one section.
    expect(box).toHaveTextContent(unreadHeadline(3));
    expect(box).toHaveTextContent("Autonomy policies, Audit log, Danger zone");
    expect(box).toHaveClass("settings__retry");
    expect(box.compareDocumentPosition(document.querySelector(".settings__grid") as Element)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    // Every seat is still drawn, each with its own reason.
    expect(document.querySelectorAll(".settings__seat")).toHaveLength(8);
  });

  it("re-reads the page on Retry", () => {
    renderThemed(
      <SettingsScreen
        access={settingsAccess(["owner"])}
        dryRun={DOWN}
        workspaceName="acme-robotics"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe("the loading state (#496)", () => {
  it("draws the hub's own frame, busy and named, with the real head and tab row", async () => {
    const { SettingsSkeleton } = await import("@/app/settings/settings-skeleton");
    renderThemed(<SettingsSkeleton />);

    const main = screen.getByRole("main", { name: SETTINGS_LOADING_LABEL });

    expect(main).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(SETTINGS_TITLE);
    expect(screen.getByRole("navigation", { name: "Settings" }).querySelectorAll("a")).toHaveLength(10);
  });

  it("fills the eight seats at the page's spans, so nothing jumps when the cards arrive", async () => {
    const { SettingsSkeleton } = await import("@/app/settings/settings-skeleton");
    renderThemed(<SettingsSkeleton />);

    const grid = document.querySelector(".settings__grid") as HTMLElement;
    const seats = [...grid.querySelectorAll(".settings__seat")];

    expect(grid).toHaveAttribute("aria-hidden", "true");
    expect(seats.map((one) => [...one.classList].find((name) => name.startsWith("settings__seat--")))).toEqual(
      SETTINGS_SECTIONS.map((section) => `settings__seat--${String(section.span)}`),
    );
    expect(seats.map((one) => one.querySelectorAll(".settings-skeleton__bar").length)).toEqual(
      SETTINGS_SECTIONS.map((section) => SKELETON_ROWS[section.id] + 1),
    );
    // A skeleton card is not a section to land on, and offers nothing to press.
    expect(seats.every((one) => one.id === "")).toBe(true);
    expect(within(grid).queryAllByRole("button")).toHaveLength(0);
  });

  it("is what the route's loading file draws", async () => {
    const Loading = (await import("@/app/(app)/settings/loading")).default;
    renderThemed(<Loading />);

    expect(screen.getByRole("main", { name: SETTINGS_LOADING_LABEL })).toBeInTheDocument();
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
