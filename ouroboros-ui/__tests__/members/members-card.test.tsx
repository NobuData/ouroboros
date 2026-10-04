import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceMember } from "@/app/api/settings-members";
import {
  CAPABILITY_CONSEQUENCE,
  INVITE_LABEL,
  LAST_OWNER_DEMOTE,
  LAST_OWNER_REMOVE,
  OWNER_ONLY_REASON,
  SERVICE_CREATE,
  TOKEN_TITLE,
  TOKEN_WARNING,
  capabilityLabel,
  capabilityRefused,
  manageLabel,
  serviceActionLabel,
} from "@/app/members/view";
import type { MembersWrite } from "@/app/members/view";
import { COPIED } from "@/app/providers/keys";

import {
  HIERARCHY,
  MAYA,
  MEMBERS_READ_AT,
  MINTED_TOKEN,
  SERVICE_LIST,
  fakeActions,
  membersPage,
  refused,
} from "../helpers/members";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { settle } from "../helpers/settle";
import { renderThemed } from "../helpers/theme";

/**
 * The Members & Roles card (BS.3, [#493](https://github.com/NobuData/ouroboros/issues/493)),
 * against mockup 17's seed: every row class with its own affordances, the capability box that
 * states its consequence before it is used and rolls back when refused, invite → pending row →
 * resend → revoke, owner protection explained rather than hidden, the token shown once, and the
 * read-only variant.
 */

// The card's default actions are Server Actions; every case passes fakes instead.
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

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { MembersCard } = await import("@/app/members/members-card");

/** What the card was handed, and the fakes behind it. */
function card(
  options: {
    canManage?: boolean;
    mayOwn?: boolean;
    withList?: boolean;
    directorySync?: Parameters<typeof membersPage>[0] extends infer P
      ? P extends { footer?: infer F }
        ? F extends { directorySync: infer D }
          ? D
          : never
        : never
      : never;
  } = {},
) {
  const actions = fakeActions();
  const canManage = options.canManage ?? true;
  const page = membersPage({
    canManage,
    footer: { hierarchy: HIERARCHY, directorySync: options.directorySync ?? null },
  });

  renderThemed(
    <MembersCard
      actions={actions}
      mayOwn={options.mayOwn ?? true}
      page={page}
      readAt={MEMBERS_READ_AT}
      serviceAccounts={(options.withList ?? canManage) ? SERVICE_LIST : null}
    />,
  );

  return { actions };
}

/** The table's body rows. */
function bodyRows(): HTMLTableRowElement[] {
  return within(screen.getByRole("table")).getAllByRole("row").slice(1) as HTMLTableRowElement[];
}

/**
 * A row's cells as text, one string per cell.
 *
 * @param row The row.
 * @returns The texts.
 */
function cells(row: HTMLTableRowElement): string[] {
  return [...row.querySelectorAll("td")].map((cell) => cell.textContent?.trim() ?? "");
}

/** The row that names someone. */
function rowOf(name: string): HTMLTableRowElement {
  const row = bodyRows().find((each) => each.textContent?.includes(name));
  if (row === undefined) throw new Error(`no row for ${name}`);
  return row;
}

beforeEach(() => {
  refresh.mockClear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(MEMBERS_READ_AT));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the seeded table", () => {
  it("draws mockup 17's five row classes, each with its own truth", () => {
    card();

    expect(bodyRows().map(cells)).toEqual([
      ["KSKen Syou", "Owner", "✓" + CAPABILITY_CONSEQUENCE, "now"],
      ["MCMaya Chen", "Maintainer", "✓" + CAPABILITY_CONSEQUENCE, "12m"],
      ["JRJorge Reyes", "Viewer", "—" + CAPABILITY_CONSEQUENCE, "3d"],
      ["⚙︎devops-bot", "Service", "—", "41s"],
      ["Ppriya@acme.dev", "Maintainer", "invited 2h ago", "ResendRevoke"],
    ]);
  });

  it("dims the pending invitation and only it", () => {
    card();

    expect(rowOf("priya@acme.dev")).toHaveClass("members__row--pending");
    expect(rowOf("Maya Chen")).not.toHaveClass("members__row--pending");
  });

  it("gives a service account the service avatar and never the capability", () => {
    card();

    const bot = rowOf("devops-bot");
    expect(bot.querySelector(".members__avatar--service")).not.toBeNull();
    expect(within(bot).queryByRole("checkbox")).toBeNull();
  });

  it("prints the hierarchy footer, and no Okta line until directory sync is real", () => {
    card();

    expect(screen.getByText(HIERARCHY)).toBeInTheDocument();
    expect(screen.queryByText(/Okta/)).toBeNull();
  });

  it("prints the sync line once the service reports a real sync", () => {
    card({
      directorySync: {
        provider: "Okta",
        groupPattern: "ouroboros-*",
        cadence: "nightly",
        lastSyncedAt: new Date(Date.parse(MEMBERS_READ_AT) - 3600 * 1000).toISOString(),
      },
    });

    expect(screen.getByText(/Roles sync from Okta group ouroboros-\* nightly ✓/)).toBeInTheDocument();
  });

  it("draws the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(
      <MembersCard
        actions={fakeActions()}
        mayOwn
        page={membersPage()}
        readAt={MEMBERS_READ_AT}
        serviceAccounts={SERVICE_LIST}
      />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});

describe("Can approve loops", () => {
  it("states its consequence before it is used", () => {
    card();

    const box = screen.getByRole("checkbox", { name: capabilityLabel("Maya Chen") });
    expect(box).toHaveAccessibleDescription(CAPABILITY_CONSEQUENCE);
    expect(screen.getAllByRole("tooltip", { hidden: true })[0]).toHaveTextContent(
      CAPABILITY_CONSEQUENCE,
    );
  });

  it("moves at once, sends only the capability, and confirms when it lands", async () => {
    const { actions } = card();
    let answer!: (result: MembersWrite<WorkspaceMember>) => void;
    actions.update.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)),
    );

    const box = screen.getByRole("checkbox", { name: capabilityLabel("Maya Chen") });
    fireEvent.click(box);

    // Optimistic: unticked before the service has answered.
    expect(box).not.toBeChecked();
    expect(actions.update).toHaveBeenCalledWith(MAYA.id, { canApproveLoops: false });

    await act(async () => {
      answer({ ok: true, value: { ...MAYA, canApproveLoops: false, canApproveLoopsSource: "explicit" } });
    });

    expect(box).not.toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent("Maya Chen can no longer approve or merge loops.");
  });

  it("goes back, with an error toast, when the service refuses", async () => {
    const { actions } = card();
    actions.update.mockResolvedValueOnce(refused("Your role does not permit this."));

    const box = screen.getByRole("checkbox", { name: capabilityLabel("Maya Chen") });
    fireEvent.click(box);
    await settle();

    expect(box).toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent(
      capabilityRefused("Maya Chen", "Your role does not permit this."),
    );
  });
});

describe("invitations", () => {
  it("invite → a pending row with a real age → resend → revoke", async () => {
    const { actions } = card();

    fireEvent.click(screen.getByRole("button", { name: INVITE_LABEL }));
    const dialog = await screen.findByRole("dialog", { name: "Invite a member" });
    fireEvent.change(within(dialog).getByLabelText("Email"), {
      target: { value: "sam@acme.dev" },
    });
    fireEvent.click(within(dialog).getByRole("radio", { name: /^Maintainer/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    await settle();

    expect(actions.invite).toHaveBeenCalledWith("sam@acme.dev", "admin");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(cells(rowOf("sam@acme.dev"))[2]).toBe("invited just now");
    expect(screen.getByRole("status")).toHaveTextContent("Invitation sent to sam@acme.dev.");

    fireEvent.click(screen.getByRole("button", { name: "Resend invitation to sam@acme.dev" }));
    await settle();
    expect(actions.resend).toHaveBeenCalledWith("inv-sam@acme.dev");

    fireEvent.click(screen.getByRole("button", { name: "Revoke invitation to sam@acme.dev" }));
    await settle();
    expect(actions.revokeInvitation).toHaveBeenCalledWith("inv-sam@acme.dev");
    expect(bodyRows().some((row) => row.textContent?.includes("sam@acme.dev"))).toBe(false);
  });

  it("keeps a refused invitation in the dialog, with the address still typed", async () => {
    const { actions } = card();
    actions.invite.mockResolvedValueOnce(refused("That address is already a member."));

    fireEvent.click(screen.getByRole("button", { name: INVITE_LABEL }));
    const dialog = await screen.findByRole("dialog", { name: "Invite a member" });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "ken@acme.dev" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    await settle();

    expect(within(dialog).getByRole("alert")).toHaveTextContent("That address is already a member.");
    expect(within(dialog).getByLabelText("Email")).toHaveValue("ken@acme.dev");
  });

  it("invites as a Viewer by default — the viewer role", async () => {
    const { actions } = card();

    fireEvent.click(screen.getByRole("button", { name: INVITE_LABEL }));
    const dialog = await screen.findByRole("dialog", { name: "Invite a member" });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "v@acme.dev" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    await settle();

    expect(actions.invite).toHaveBeenCalledWith("v@acme.dev", "viewer");
  });

  it("explains the Owner choice to an admin instead of hiding it", async () => {
    card({ mayOwn: false });

    fireEvent.click(screen.getByRole("button", { name: INVITE_LABEL }));
    const dialog = await screen.findByRole("dialog", { name: "Invite a member" });

    expect(within(dialog).getByRole("radio", { name: /^Owner/ })).toBeDisabled();
    expect(within(dialog).getByText(new RegExp(OWNER_ONLY_REASON))).toBeInTheDocument();
  });
});

describe("role changes and removal", () => {
  it("explains the last owner's protection rather than hiding the options", async () => {
    const { actions } = card();

    fireEvent.click(screen.getByRole("button", { name: manageLabel("Ken S", "Owner") }));
    const dialog = await screen.findByRole("dialog", { name: /Ken S/ });

    expect(within(dialog).getByText(LAST_OWNER_DEMOTE)).toBeInTheDocument();
    expect(within(dialog).getByText(LAST_OWNER_REMOVE)).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: /^Maintainer/ })).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: "Remove from workspace" })).toBeNull();
    expect(actions.update).not.toHaveBeenCalled();
  });

  it("confirms a demotion before sending it, then shows the new role", async () => {
    const { actions } = card();

    fireEvent.click(screen.getByRole("button", { name: manageLabel("Maya Chen", "Maintainer") }));
    const dialog = await screen.findByRole("dialog", { name: /Maya Chen/ });
    fireEvent.click(within(dialog).getByRole("radio", { name: /^Viewer/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Change role" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent(/Maintainer to Viewer at once/);
    expect(actions.update).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Change role" }));
    await settle();

    expect(actions.update).toHaveBeenCalledWith(MAYA.id, { role: "viewer" });
    expect(cells(rowOf("Maya Chen"))[1]).toBe("Viewer");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("sends a promotion without asking twice", async () => {
    const { actions } = card();

    fireEvent.click(screen.getByRole("button", { name: manageLabel("Jorge Reyes", "Viewer") }));
    const dialog = await screen.findByRole("dialog", { name: /Jorge Reyes/ });
    fireEvent.click(within(dialog).getByRole("radio", { name: /^Maintainer/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Change role" }));
    await settle();

    expect(actions.update).toHaveBeenCalledWith("mem-jorge", { role: "admin" });
  });

  it("confirms a removal, then drops the row", async () => {
    const { actions } = card();

    fireEvent.click(screen.getByRole("button", { name: manageLabel("Jorge Reyes", "Viewer") }));
    const dialog = await screen.findByRole("dialog", { name: /Jorge Reyes/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove from workspace" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent(/loses access to this workspace/);
    expect(actions.remove).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Yes, remove" }));
    await settle();

    expect(actions.remove).toHaveBeenCalledWith("mem-jorge");
    expect(bodyRows().some((row) => row.textContent?.includes("Jorge Reyes"))).toBe(false);
  });

  it("shows the service's refusal in the dialog when the table was stale", async () => {
    const { actions } = card();
    actions.update.mockResolvedValueOnce(
      refused("This is the workspace's last owner.", "owner_protected"),
    );

    fireEvent.click(screen.getByRole("button", { name: manageLabel("Jorge Reyes", "Viewer") }));
    const dialog = await screen.findByRole("dialog", { name: /Jorge Reyes/ });
    fireEvent.click(within(dialog).getByRole("radio", { name: /^Maintainer/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Change role" }));
    await settle();

    expect(within(dialog).getByRole("alert")).toHaveTextContent("This is the workspace's last owner.");
  });
});

describe("service accounts", () => {
  /** A clipboard that records what it was given. */
  function stubClipboard() {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal(
      "navigator",
      Object.assign(Object.create(navigator) as Navigator, { clipboard: { writeText } }),
    );
    return writeText;
  }

  it("lists each account's scopes, masked token and last use", () => {
    card();

    const section = screen.getByRole("region", { name: "Service accounts" });
    expect(within(section).getByText("farm.submit · api.read")).toBeInTheDocument();
    expect(within(section).getByText("orb_svc_••••ab12")).toBeInTheDocument();
    expect(within(section).getByText("used 41s ago")).toBeInTheDocument();
  });

  it("creates with a picked scope, shows the token once with the warning, and never again", async () => {
    const { actions } = card();
    const writeText = stubClipboard();

    fireEvent.click(screen.getByRole("button", { name: SERVICE_CREATE }));
    const dialog = await screen.findByRole("dialog", { name: "Create a service account" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "ci-bot" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /api\.read/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Create and show token" }));
    await settle();

    expect(actions.createServiceAccount).toHaveBeenCalledWith("ci-bot", ["api.read"]);

    const shown = await screen.findByRole("alertdialog", { name: TOKEN_TITLE });
    expect(within(shown).getByText(MINTED_TOKEN)).toBeInTheDocument();
    expect(shown).toHaveAccessibleDescription(TOKEN_WARNING);

    fireEvent.click(within(shown).getByRole("button", { name: "Copy" }));
    await settle();
    expect(writeText).toHaveBeenCalledWith(MINTED_TOKEN);
    expect(within(shown).getByText(COPIED)).toBeInTheDocument();

    fireEvent.click(within(shown).getByRole("button", { name: "I have copied it" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.body.textContent).not.toContain(MINTED_TOKEN);
    expect(
      within(screen.getByRole("region", { name: "Service accounts" })).getByText("ci-bot"),
    ).toBeInTheDocument();
  });

  it("refuses to send an account with no scope, or a malformed name", async () => {
    const { actions } = card();

    fireEvent.click(screen.getByRole("button", { name: SERVICE_CREATE }));
    const dialog = await screen.findByRole("dialog", { name: "Create a service account" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "ci-bot" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create and show token" }));
    await settle();

    expect(within(dialog).getByRole("alert")).toHaveTextContent("Choose at least one scope.");

    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "CI Bot" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create and show token" }));
    await settle();

    expect(within(dialog).getByRole("alert")).toHaveTextContent(/lower-case letters/);
    expect(actions.createServiceAccount).not.toHaveBeenCalled();
  });

  it("rotates behind a warning and shows the new token once, as a replacement", async () => {
    const { actions } = card();

    fireEvent.click(screen.getByRole("button", { name: serviceActionLabel("Rotate", "devops-bot") }));
    const confirm = await screen.findByRole("alertdialog", { name: /Rotate devops-bot/ });
    expect(confirm).toHaveAccessibleDescription(/stops working the moment the new one is shown/);
    fireEvent.click(within(confirm).getByRole("button", { name: "Rotate and show new token" }));
    await settle();

    expect(actions.rotateServiceAccount).toHaveBeenCalledWith(SERVICE_LIST.items[0].id);
    const shown = await screen.findByRole("alertdialog", { name: TOKEN_TITLE });
    expect(shown).toHaveTextContent(/previous one has already stopped working/);
  });

  it("revokes behind a warning and drops the account", async () => {
    const { actions } = card();

    fireEvent.click(screen.getByRole("button", { name: serviceActionLabel("Revoke", "devops-bot") }));
    const confirm = await screen.findByRole("alertdialog", { name: /Revoke devops-bot/ });
    fireEvent.click(within(confirm).getByRole("button", { name: "Yes, revoke" }));
    await settle();

    expect(actions.revokeServiceAccount).toHaveBeenCalledWith(SERVICE_LIST.items[0].id);
    expect(screen.getByRole("status")).toHaveTextContent("devops-bot was revoked.");
    expect(bodyRows().some((row) => row.textContent?.includes("devops-bot"))).toBe(false);
  });
});

describe("a reader who may not manage", () => {
  it("reads the whole table, legible, with nothing to press and no token hint", () => {
    card({ canManage: false, mayOwn: false });

    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryAllByRole("checkbox")).toEqual([]);
    expect(bodyRows().map(cells)).toEqual([
      ["KSKen Syou", "Owner", "✓", "now"],
      ["MCMaya Chen", "Maintainer", "✓", "12m"],
      ["JRJorge Reyes", "Viewer", "—", "3d"],
      ["⚙︎devops-bot", "Service", "—", "41s"],
      ["Ppriya@acme.dev", "Maintainer", "invited 2h ago", "—"],
    ]);
    expect(screen.queryByText(/orb_svc_/)).toBeNull();
  });
});

afterEach(() => cleanup());
