import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RetentionSettings, WorkspaceSettings } from "@/app/api/settings-workspace";
import { settingsAccess } from "@/app/settings/access";
import type { SectionCommitResult } from "@/app/settings/save-model";
import {
  ADVANCED_LABEL,
  PER_CLASS_OPTION,
  SSO_ENFORCED_TAG,
  auditFloorReason,
  regionReason,
} from "@/app/settings/workspace";
import { ThemeProvider } from "@/app/theme-provider";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import {
  CONSEQUENCE,
  EFFECT,
  READ_AT,
  RESIDENCY_URL,
  retentionSettings,
  viewerWorkspaceSettings,
  workspaceSettings,
} from "../helpers/workspace";

/**
 * The Workspace card, rendered (BS.2, [#492](https://github.com/NobuData/ouroboros/issues/492)):
 * the self-hosted variant S6 pins — region and training as text with their reasons, no dropdown,
 * no switch, no plan — and the card driven through the real save model, so an edit becomes the
 * body the service is sent.
 */

const save = vi.fn<(patches: unknown) => Promise<SectionCommitResult>>();

vi.mock("@/app/settings/workspace-actions", () => ({
  saveWorkspaceCard: (patches: unknown) => save(patches),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  unstable_rethrow: () => {},
}));

const { SettingsSaveProvider } = await import("@/app/settings/save-provider");
const { SaveButton } = await import("@/app/settings/save-controls");
const { SettingsSeat } = await import("@/app/settings/settings-seat");
const { WorkspaceCard } = await import("@/app/settings/workspace-card");

/**
 * The card in its seat under the page's save model, with a Save button.
 *
 * @param options.roles The reader's roles. Defaults to an owner.
 * @param options.settings The workspace payload.
 * @param options.retention The tiers.
 * @returns The element.
 */
function card({
  roles = ["owner"],
  settings = workspaceSettings(),
  retention = retentionSettings(),
}: {
  roles?: Parameters<typeof settingsAccess>[0];
  settings?: WorkspaceSettings;
  retention?: RetentionSettings;
} = {}) {
  return (
    <SettingsSaveProvider access={settingsAccess(roles)}>
      <SaveButton />
      <SettingsSeat section="workspace">
        <WorkspaceCard readAt={READ_AT} retention={retention} settings={settings} />
      </SettingsSeat>
    </SettingsSaveProvider>
  );
}

/** The seat the card is mounted in. */
function seat(): HTMLElement {
  return document.getElementById("workspace") as HTMLElement;
}

/** Press Save, and let the write answer. */
async function pressSave(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Save changes/ }));
  });
  for (let turn = 0; turn < 3; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Open the advanced per-class editor. */
function openAdvanced(): void {
  const details = screen.getByText(ADVANCED_LABEL).closest("details") as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event("toggle"));
}

beforeEach(() => {
  save.mockReset().mockResolvedValue({ ok: true });
});

describe("the self-hosted variant (S6)", () => {
  it("renders the region as text with its reason and a residency link — no dropdown affordance", () => {
    render(card());
    const region = screen.getByText("EU-West (Frankfurt)").closest(".ou-field") as HTMLElement;

    expect(within(region).queryByRole("combobox")).toBeNull();
    expect(region).toHaveTextContent(regionReason("configured"));
    expect(within(region).getByRole("link", { name: "Data residency" })).toHaveAttribute(
      "href",
      RESIDENCY_URL,
    );
    // The card's only select is retention's.
    expect(within(seat()).getAllByRole("combobox")).toHaveLength(1);
  });

  it("renders training data as the plain truthful sentence with no control and no plan lock", () => {
    render(card());

    expect(screen.getByText("Off — this deployment never trains on your data.")).toBeInTheDocument();
    expect(within(seat()).queryByRole("switch")).toBeNull();
    expect(seat()).not.toHaveTextContent(/enterprise|locked|plan/i);
  });

  it("pins the variant's anatomy: label, value as text, reason — and no form control in it", () => {
    render(card());
    const region = screen.getByText("EU-West (Frankfurt)").closest(".ou-field") as HTMLElement;

    expect(region).toHaveClass("settings-workspace__fact");
    expect(region.querySelector(".ou-field__label")).toHaveTextContent("Data region");
    expect(region.querySelector(".settings-workspace__value")).toHaveTextContent("EU-West (Frankfurt)");
    expect(region.querySelector(".ou-field__hint")).toHaveTextContent(regionReason("configured"));
    expect(region.querySelector("input, select, textarea, button, [role=switch]")).toBeNull();
    expect(screen.getByRole("paragraph", { name: "Data region" })).toHaveAccessibleDescription(
      expect.stringContaining("single region"),
    );
  });

  it("leaves no silently dead control: every inert or non-interactive value carries its reason", () => {
    for (const roles of [["owner"], ["viewer"]] as const) {
      const { unmount } = render(
        card({
          roles: [...roles],
          settings: roles[0] === "viewer" ? viewerWorkspaceSettings() : workspaceSettings(),
          retention:
            roles[0] === "viewer" ? retentionSettings({ editable: false, reason: "role" }) : retentionSettings(),
        }),
      );

      for (const control of seat().querySelectorAll("input, select, button, [role=switch]")) {
        const inert =
          control.hasAttribute("disabled") || control.getAttribute("aria-disabled") === "true";
        expect(inert, `${roles[0]}: ${control.outerHTML}`).toBe(false);
      }
      // Every value drawn as text names why it is text (training's sentence is its own reason).
      for (const fact of seat().querySelectorAll(".settings-workspace__fact")) {
        if (fact.classList.contains("settings-workspace__training")) continue;
        expect(fact.querySelector(".ou-field__hint"), `${roles[0]}: ${fact.textContent}`).not.toBeNull();
      }
      unmount();
    }
  });

  it("draws the same card in both palettes", () => {
    const [light, dark] = renderInBothPalettes(<ThemeProvider>{card()}</ThemeProvider>);

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});

describe("the tenant domain", () => {
  it("shows the SSO enforced tag only when sign-ins on it require SSO", () => {
    const owner = workspaceSettings();
    const { unmount } = render(card());

    expect(within(seat()).queryByText(SSO_ENFORCED_TAG)).toBeNull();
    unmount();

    render(card({ settings: workspaceSettings({ domain: { ...owner.domain, tags: ["sso_enforced"] } }) }));
    expect(within(seat()).getByText(SSO_ENFORCED_TAG)).toBeInTheDocument();
  });

  it("states its sign-in consequence before commit, as soon as it is edited", () => {
    render(card());
    const domain = screen.getByRole("textbox", { name: /Tenant domain/ });

    expect(screen.getByText(CONSEQUENCE)).toBeInTheDocument();
    fireEvent.change(domain, { target: { value: "acme.example.com" } });

    expect(seat()).toHaveTextContent(
      "After saving, sign-in finds this workspace at acme.example.com instead of acme.ouroboros.dev.",
    );
    expect(save).not.toHaveBeenCalled();
  });

  it("puts a refused domain's error on the domain input", async () => {
    save.mockResolvedValue({
      ok: false,
      reason: "Nothing on this card was saved.",
      fields: { domain: "That domain is already used by another workspace." },
    });
    render(card());

    fireEvent.change(screen.getByRole("textbox", { name: /Tenant domain/ }), {
      target: { value: "taken.dev" },
    });
    await pressSave();

    expect(screen.getByRole("textbox", { name: /Tenant domain/ })).toHaveAccessibleDescription(
      expect.stringContaining("That domain is already used by another workspace."),
    );
  });
});

describe("retention", () => {
  it("says which classes the select governs and when the change takes effect", () => {
    render(card());

    expect(screen.getByRole("combobox", { name: "Data retention" })).toHaveValue("30");
    expect(screen.getByText("transcripts, logs, artifacts")).toBeInTheDocument();
    expect(screen.getByText(`${EFFECT} Next sweep in 4h.`)).toBeInTheDocument();
  });

  it("sends one choice in the select as {loopDays}, counted as one change", async () => {
    render(card());

    fireEvent.change(screen.getByRole("combobox", { name: "Data retention" }), {
      target: { value: "7" },
    });
    expect(screen.getByRole("button", { name: /^Save changes/ })).toHaveTextContent("1");

    await pressSave();

    expect(save).toHaveBeenCalledWith({ retention: { loopDays: 7 }, retentionFields: ["loopDays"] });
  });

  it("sets classes independently in the advanced editor", async () => {
    render(card());
    openAdvanced();

    fireEvent.change(screen.getByLabelText("Build logs (days)"), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText("Audit log (days)"), { target: { value: "730" } });

    // The loop classes now differ, so the select says so.
    expect(screen.getByRole("combobox", { name: "Data retention" })).toHaveValue("");
    expect(screen.getByRole("option", { name: PER_CLASS_OPTION })).toBeInTheDocument();

    await pressSave();

    expect(save).toHaveBeenCalledWith({
      retention: { classes: { build_logs: 60, audit: 730 } },
      retentionFields: ["build_logs", "audit"],
    });
  });

  it("explains the audit floor at the input when a value is rejected, and sends nothing", async () => {
    render(card());
    openAdvanced();

    fireEvent.change(screen.getByLabelText("Audit log (days)"), { target: { value: "30" } });
    await pressSave();

    expect(save).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Audit log (days)")).toHaveAccessibleDescription(
      expect.stringContaining(auditFloorReason(90)),
    );
  });

  it("shows a shared tier the editor set, even one the select does not usually offer", () => {
    render(card());
    openAdvanced();

    for (const label of ["Transcripts (days)", "Build logs (days)", "Artifacts (days)"]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: "45" } });
    }

    expect(screen.getByRole("combobox", { name: "Data retention" })).toHaveValue("45");
  });
});

describe("the read-only variant", () => {
  it("draws every field as text with who can change it", () => {
    render(
      card({
        roles: ["viewer"],
        settings: viewerWorkspaceSettings(),
        retention: retentionSettings({ editable: false, reason: "role" }),
      }),
    );

    expect(within(seat()).queryByRole("textbox")).toBeNull();
    expect(within(seat()).queryByRole("combobox")).toBeNull();
    expect(within(seat()).queryByRole("spinbutton")).toBeNull();
    expect(within(seat()).getByText("acme-robotics")).toBeInTheDocument();
    expect(within(seat()).getAllByText(/Changing it takes an owner or an admin\./).length).toBeGreaterThan(1);
  });
});
