import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OrgPolicy } from "@/app/api/org-policy";
import type { DryRunPolicy } from "@/app/api/policies";
import type { Reading } from "@/app/api/reading";
import {
  CUSTOM_RULE_NOTE,
  EDIT_AS_CODE,
  EDIT_AS_CODE_SOON,
  FOOTER_LINE,
  KEEP_EDITING,
  NOTE_LABEL,
  NOTHING_TO_PUBLISH,
  OVERRIDE_LEAD,
  OWNER_GATE_TITLE,
  POLICIES_READ_ONLY,
  PUBLISH_CANCELLED,
  PUBLISH_NEEDS_OWNER,
  type PreviewResult,
  type PublishResult,
  UNPUBLISHED_NOTE,
  historyTrigger,
  switchLabel,
  versionConflict,
} from "@/app/policies/card-view";
import { type CoreRuleId, type PolicyDocument, RULE_NAMES } from "@/app/policies/document";
import type { PolicyCardActions } from "@/app/policies/policy-card";
import { DRY_RUN_TITLE, dryRunUnread } from "@/app/policies/view";
import { settingsAccess } from "@/app/settings/access";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import {
  GATED_PREVIEW,
  POLICY_V7,
  UNPUBLISHED,
  orgPolicyV7,
  policyPreview,
} from "../helpers/org-policy";

/**
 * The Autonomy policies card, rendered under the page's real save model (BS.4,
 * [#494](https://github.com/NobuData/ouroboros/issues/494)): the seeded card with its chips
 * exact, an edit becoming the document the service is sent, the confirmation that names what a
 * save loosens, the owner gate, the toast and its audit link, and the read-only card a viewer gets.
 */

vi.mock("@/app/policies/card-actions", () => ({
  previewPolicy: vi.fn(),
  publishPolicy: vi.fn(),
  loadPolicyHistory: vi.fn(),
  previewPolicyPaths: vi.fn(),
}));
vi.mock("@/app/policies/policy-actions", () => ({ setDryRun: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  unstable_rethrow: () => {},
}));

const { SettingsSaveProvider } = await import("@/app/settings/save-provider");
const { SaveButton } = await import("@/app/settings/save-controls");
const { SettingsSeat } = await import("@/app/settings/settings-seat");
const { PolicyCard } = await import("@/app/policies/policy-card");

const preview = vi.fn<(document: PolicyDocument) => Promise<PreviewResult>>();
const publish =
  vi.fn<(document: PolicyDocument, base: number | null, note: string | null) => Promise<PublishResult>>();
const history = vi.fn();
const paths = vi.fn();

const ACTIONS: PolicyCardActions = { preview, publish, history, paths };

/** The workspace-wide dry-run policy, off. */
const DRY_RUN: Reading<DryRunPolicy> = {
  ok: true,
  value: {
    dryRun: false,
    explicit: true,
    reason: null,
    updatedAt: "2026-09-30T12:00:00.000Z",
    updatedBy: "user-ken",
  },
};

/**
 * The card in its seat under the page's save model, with a Save button.
 *
 * @param options.roles The reader's roles. Defaults to an owner.
 * @param options.policy The version in force. Defaults to mockup 17's v7.
 * @param options.dryRun The dry-run policy as read.
 * @param options.owners The workspace's owners.
 * @returns The element.
 */
function card({
  roles = ["owner"],
  policy = orgPolicyV7(),
  dryRun = DRY_RUN,
  owners = ["Ken"],
}: {
  roles?: Parameters<typeof settingsAccess>[0];
  policy?: OrgPolicy;
  dryRun?: Reading<DryRunPolicy>;
  owners?: readonly string[];
} = {}) {
  return (
    <SettingsSaveProvider access={settingsAccess(roles)}>
      <SaveButton />
      <SettingsSeat section="policies">
        <PolicyCard actions={ACTIONS} dryRun={dryRun} owners={owners} policy={policy} />
      </SettingsSeat>
    </SettingsSaveProvider>
  );
}

/** The seat the card is mounted in. */
function seat(): HTMLElement {
  return document.getElementById("policies") as HTMLElement;
}

/**
 * One rule's row.
 *
 * @param id The rule.
 * @returns The row's group.
 */
function rule(id: CoreRuleId): HTMLElement {
  return within(seat()).getByRole("group", { name: RULE_NAMES[id] });
}

/**
 * Press a rule's switch.
 *
 * @param id The rule.
 * @param enabled Whether it is on before the press.
 */
function flip(id: CoreRuleId, enabled: boolean): void {
  fireEvent.click(within(rule(id)).getByRole("switch", { name: switchLabel(id, enabled) }));
}

/** Press **Save changes** and let the preview answer. */
async function save(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
  });
}

beforeEach(() => {
  preview.mockReset().mockResolvedValue({ ok: true, preview: policyPreview() });
  publish
    .mockReset()
    .mockResolvedValue({ ok: true, version: 8, summary: "changed spend guard (policy v8)" });
  history.mockReset();
  paths.mockReset().mockResolvedValue({ ok: true, repositories: [] });
});

describe("the seeded card", () => {
  it("draws mockup 17's five rows in order, every chip from the document", () => {
    render(card());

    const rows = within(seat())
      .getAllByRole("group")
      .filter((group) => Object.values(RULE_NAMES).includes(group.getAttribute("aria-label") ?? ""));

    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual(Object.values(RULE_NAMES));

    const chips: Record<CoreRuleId, string[]> = {
      auto_merge: ["effort ≤ M", "non-refactor"],
      human_review: ["label:refactor", "OR effort ≥ L"],
      protected_paths: ["boot/", "keys/", ".github/"],
      spend_guard: ["pause loop at $2.50/run", "monthly cap $600/provider"],
      dry_run_new_repos: ["first 10 loops open draft PRs"],
    };

    for (const [id, expected] of Object.entries(chips) as [CoreRuleId, string[]][]) {
      for (const chip of expected) {
        expect(within(rule(id)).getByText(chip), `${id}: ${chip}`).toBeInTheDocument();
      }
      expect(within(rule(id)).getByRole("switch")).toHaveAttribute("aria-checked", "true");
    }
  });

  it("carries the version tag, the footer verbatim, and Edit as code as an honest soon-state", () => {
    render(card());

    expect(within(seat()).getByRole("button", { name: historyTrigger(7) })).toHaveTextContent("policy v7");
    expect(within(seat()).getByText(FOOTER_LINE)).toBeInTheDocument();

    const code = within(seat()).getByText(EDIT_AS_CODE, { exact: false });

    expect(code.closest("a")).toBeNull();
    expect(code.closest("button")).toBeNull();
    expect(within(seat()).getByText("soon")).toBeInTheDocument();
    expect(within(seat()).getByText(EDIT_AS_CODE_SOON)).toBeInTheDocument();
  });

  it("keeps the workspace-wide dry-run switch under the rules, outside the save", () => {
    render(card());

    expect(within(seat()).getByText(OVERRIDE_LEAD)).toBeInTheDocument();
    expect(within(seat()).getByRole("group", { name: DRY_RUN_TITLE })).toBeInTheDocument();
  });

  it("says the dry-run switch could not be read without losing the rules", () => {
    render(card({ dryRun: { ok: false, reason: "The service is restarting." } }));

    expect(within(seat()).getByText(dryRunUnread("The service is restarting."))).toBeInTheDocument();
    expect(rule("auto_merge")).toBeInTheDocument();
  });

  it("renders the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(card());

    expect(light).toContain("policy v7");
    expect(maskIds(light)).toBe(maskIds(dark));
  });
});

describe("a workspace that has published nothing", () => {
  it("draws every rule off, says nothing binds, and publishes its first version as v1", async () => {
    preview.mockResolvedValue({
      ok: true,
      preview: policyPreview({
        baseVersion: null,
        changes: [
          { ruleId: "spend_guard", classification: "tightening", verb: "enabled", summary: "enabled spend guard" },
        ],
      }),
    });
    render(card({ policy: UNPUBLISHED }));

    expect(within(seat()).getByText("not published")).toBeInTheDocument();
    expect(within(seat()).getByText(UNPUBLISHED_NOTE)).toBeInTheDocument();
    for (const id of Object.keys(RULE_NAMES) as CoreRuleId[]) {
      expect(within(rule(id)).getByRole("switch")).toHaveAttribute("aria-checked", "false");
    }

    flip("spend_guard", false);
    await save();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Publish policy v1" }));
    });

    const [document, base] = publish.mock.calls[0];

    expect(base).toBeNull();
    expect(document.spend_guard.enabled).toBe(true);
    expect(Object.keys(document)).toEqual(Object.keys(RULE_NAMES));
  });
});

describe("saving", () => {
  it("counts each edited rule once, previews the composed document, and publishes on the reader's word", async () => {
    render(card());

    flip("spend_guard", true);
    fireEvent.click(within(rule("dry_run_new_repos")).getByRole("button", { name: /first 10 loops/ }));
    fireEvent.click(within(rule("dry_run_new_repos")).getByRole("button", { name: "One more loop" }));

    expect(screen.getByRole("button", { name: /^Save/ })).toHaveTextContent("2");

    await save();

    const expected: PolicyDocument = {
      ...POLICY_V7,
      spend_guard: { ...POLICY_V7.spend_guard, enabled: false },
      dry_run_new_repos: { enabled: true, conditions: { first_n_loops: 11 } },
    };

    // Untouched rules travel exactly as they were read.
    expect(preview).toHaveBeenCalledExactlyOnceWith(expected);
    expect(publish).not.toHaveBeenCalled();

    const dialog = screen.getByRole("alertdialog", { name: "Publish policy v8?" });

    fireEvent.change(within(dialog).getByLabelText(NOTE_LABEL), { target: { value: "Lower the cap" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Publish policy v8" }));
    });

    expect(publish).toHaveBeenCalledExactlyOnceWith(expected, 7, "Lower the cap");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("toasts the new version with the audit log's line and a link to it", async () => {
    render(card());

    flip("spend_guard", true);
    await save();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Publish policy v8" }));
    });

    const toast = within(seat()).getByText("Policy v8 published.").closest("div") as HTMLElement;

    expect(within(toast).getByText("changed spend guard (policy v8)")).toBeInTheDocument();
    expect(within(toast).getByRole("link", { name: /See it in the audit log/ })).toHaveAttribute(
      "href",
      "/settings#audit",
    );

    fireEvent.click(within(toast).getByRole("button", { name: "Dismiss" }));
    expect(within(seat()).queryByText("Policy v8 published.")).toBeNull();
  });

  it("publishes nothing on Keep editing, and keeps the edits unsaved with the reason on the card", async () => {
    render(card());

    flip("spend_guard", true);
    await save();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: KEEP_EDITING }));
    });

    expect(publish).not.toHaveBeenCalled();
    expect(within(seat()).getByText(PUBLISH_CANCELLED)).toBeInTheDocument();
    expect(within(rule("spend_guard")).getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("button", { name: /^Save/ })).toHaveTextContent("1");
  });

  it("names a loosening in the confirmation before it publishes one for an owner", async () => {
    preview.mockResolvedValue({
      ok: true,
      preview: { ...GATED_PREVIEW, mayPublish: true },
    });
    render(card());

    flip("human_review", true);
    await save();

    const dialog = screen.getByRole("alertdialog", { name: "Publish policy v8?" });

    expect(within(dialog).getByRole("listitem")).toHaveTextContent("Loosens");
    expect(within(dialog).getByRole("listitem")).toHaveTextContent("Human review required");

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Publish policy v8" }));
    });

    expect(publish.mock.calls[0][0].human_review.enabled).toBe(false);
  });

  it("explains the owner requirement to an admin whose edit loosens a rule, and sends nothing", async () => {
    preview.mockResolvedValue({ ok: true, preview: GATED_PREVIEW });
    render(card({ roles: ["admin"], owners: ["Ken"] }));

    flip("human_review", true);
    await save();

    const dialog = screen.getByRole("alertdialog", { name: OWNER_GATE_TITLE });

    expect(
      within(dialog).getByText("This loosens Human review required — an owner must publish."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Ask Ken to make this change/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Publish/ })).toBeNull();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: KEEP_EDITING }));
    });

    expect(publish).not.toHaveBeenCalled();
    expect(within(seat()).getByText(PUBLISH_NEEDS_OWNER)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Save/ })).toHaveTextContent("1");
  });

  it("says why when the preview is refused, without opening a confirmation", async () => {
    preview.mockResolvedValue({ ok: false, reason: "The document is not valid." });
    render(card());

    flip("spend_guard", true);
    await save();

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(within(seat()).getByText("The document is not valid.")).toBeInTheDocument();
  });

  it("does not ask to confirm an edit the service says changes nothing", async () => {
    preview.mockResolvedValue({ ok: true, preview: policyPreview({ classification: "neutral", changes: [] }) });
    render(card());

    flip("spend_guard", true);
    await save();

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(publish).not.toHaveBeenCalled();
    expect(within(seat()).getByText(NOTHING_TO_PUBLISH)).toBeInTheDocument();
  });

  it("keeps the edits and says what happened when another version was published first", async () => {
    publish.mockResolvedValue({ ok: false, reason: versionConflict(8) });
    render(card());

    flip("spend_guard", true);
    await save();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Publish policy v8" }));
    });

    expect(within(seat()).getByText(versionConflict(8))).toBeInTheDocument();
    expect(within(seat()).queryByText("Policy v8 published.")).toBeNull();
    expect(screen.getByRole("button", { name: /^Save/ })).toHaveTextContent("1");
  });
});

describe("custom rules", () => {
  it("lists a custom rule read-only and publishes it untouched", async () => {
    const custom = {
      enabled: true,
      conditions: { all: [{ label: "hotfix" }], path_globs: ["drivers/**"], per_run_cap_cents: 100 },
    };
    render(card({ policy: orgPolicyV7({ document: { ...POLICY_V7, "custom:night-freeze": custom } }) }));

    const row = within(seat()).getByText("custom:night-freeze").closest("div") as HTMLElement;

    expect(within(row).getByText("label:hotfix")).toBeInTheDocument();
    expect(within(row).getByText("drivers/")).toBeInTheDocument();
    expect(within(row).getByText("pause loop at $1/run")).toBeInTheDocument();
    expect(within(row).getByText(CUSTOM_RULE_NOTE)).toBeInTheDocument();
    expect(within(row).queryByRole("switch")).toBeNull();

    flip("spend_guard", true);
    await save();

    expect(preview.mock.calls[0][0]["custom:night-freeze"]).toEqual(custom);
  });
});

describe("a viewer", () => {
  it("reads every rule in its real state with static chips, and has nothing to operate", () => {
    render(card({ roles: ["viewer"] }));

    for (const id of Object.keys(RULE_NAMES) as CoreRuleId[]) {
      const toggle = within(rule(id)).getByRole("switch");

      expect(toggle).toHaveAttribute("aria-checked", "true");
      expect(toggle).toHaveAttribute("aria-disabled", "true");
      expect(toggle).toHaveAttribute("title", POLICIES_READ_ONLY);
    }

    // No chip is a control: the terms are text.
    expect(within(rule("auto_merge")).queryByRole("button")).toBeNull();
    expect(within(rule("auto_merge")).getByText("effort ≤ M")).toBeInTheDocument();

    fireEvent.click(within(rule("spend_guard")).getByRole("switch"));
    expect(within(rule("spend_guard")).getByRole("switch")).toHaveAttribute("aria-checked", "true");

    // The history is theirs to read too.
    expect(within(seat()).getByRole("button", { name: historyTrigger(7) })).toBeInTheDocument();
  });
});
