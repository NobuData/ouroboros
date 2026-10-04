import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DryRunPolicy } from "@/app/api/policies";
import { POLICIES_PATH, SETTINGS_PATH } from "@/app/paths";
import { DRY_RUN_TITLE } from "@/app/policies/view";
import { SETTINGS_TITLE, settingsEyebrow } from "@/app/settings/view";

import { membership, sessionUser } from "../helpers/login";
import { MEMBERS_READ_AT, SERVICE_LIST, membersPage } from "../helpers/members";
import { renderThemed as render } from "../helpers/theme";

/**
 * `/settings` — the hub's route (BS.1,
 * [#491](https://github.com/NobuData/ouroboros/issues/491)): the gate is asked first, what it
 * returns decides the eyebrow and which of the page's three variants the reader gets, and the
 * redirect that stood here until the hub existed is gone. The address the dry-run policy used
 * to have redirects to the hub's section instead.
 */

const requireWorkspace = vi.fn();
const readSettings = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/settings/data", () => ({ readSettings: (access: unknown) => readSettings(access) }));
vi.mock("@/app/policies/policy-actions", () => ({ setDryRun: vi.fn() }));
// The Members card's Server Actions are never reached here: its own suites drive them.
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
vi.mock("@/app/shell/preference-actions", () => ({ saveFontScale: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirect(path),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  unstable_rethrow: () => {},
}));

const Page = (await import("@/app/(app)/settings/page")).default;
const PoliciesPage = (await import("@/app/(app)/settings/policies/page")).default;

/** The dry-run policy, as the reader hands it on. */
const POLICY: DryRunPolicy = {
  dryRun: false,
  explicit: false,
  reason: null,
  updatedAt: null,
  updatedBy: null,
};

/**
 * What the gate returns for a reader holding some roles.
 *
 * @param roles The roles of the active membership.
 * @returns The access.
 */
function access(roles: ReturnType<typeof membership>["roles"]) {
  const active = membership({ roles });

  return {
    session: { user: sessionUser(), memberships: [active], tenantSuggestion: null },
    membership: active,
  };
}

/**
 * The buttons on the page that would change the workspace — every one outside the Appearance
 * card, whose controls are the reader's own preferences and every role's to use.
 *
 * @returns Their labels.
 */
function workspaceControls(): (string | null)[] {
  const appearance = document.getElementById("appearance") as HTMLElement;

  return within(screen.getByRole("main"))
    .queryAllByRole("button")
    .filter((button) => !appearance.contains(button))
    .map((button) => button.textContent);
}

beforeEach(() => {
  requireWorkspace.mockReset().mockResolvedValue(access(["owner"]));
  readSettings.mockReset().mockImplementation((gate: ReturnType<typeof access>) => {
    // The members page says whether the reader may manage, as the service does.
    const canManage = gate.membership.roles.some((role) => role === "owner" || role === "admin");

    return Promise.resolve({
      dryRun: { ok: true, value: POLICY },
      members: { ok: true, value: membersPage({ canManage }) },
      serviceAccounts: canManage ? SERVICE_LIST : null,
      readAt: MEMBERS_READ_AT,
    });
  });
  redirect.mockClear();
});

describe("the route", () => {
  it("draws the hub rather than redirecting away from it", async () => {
    render(await Page());

    expect(redirect).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(SETTINGS_TITLE);
  });

  it("asks the gate first, and reads for the workspace it returned", async () => {
    const gate = access(["owner"]);
    requireWorkspace.mockResolvedValue(gate);

    render(await Page());

    expect(requireWorkspace).toHaveBeenCalledOnce();
    expect(readSettings).toHaveBeenCalledExactlyOnceWith(gate);
    expect(screen.getByText(settingsEyebrow(membership().name))).toBeInTheDocument();
  });

  it("reads nothing for a request the gate turns away", async () => {
    requireWorkspace.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));

    await expect(Page()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(readSettings).not.toHaveBeenCalled();
  });

  it("hands the screen what the reader read", async () => {
    render(await Page());

    expect(
      within(document.getElementById("policies") as HTMLElement).getByRole("group", {
        name: DRY_RUN_TITLE,
      }),
    ).toBeInTheDocument();
  });

  it("keys the screen by the workspace, so a switch cannot carry one workspace's edits into another", async () => {
    const first = await Page();
    requireWorkspace.mockResolvedValue({
      ...access(["owner"]),
      membership: membership({ id: "5eed0001-0000-4000-8000-000000000002", slug: "acme-labs" }),
    });
    const second = await Page();

    expect(first.key).toBe(membership().id);
    expect(second.key).toBe("5eed0001-0000-4000-8000-000000000002");
  });
});

describe("the page's three variants", () => {
  it("gives an owner Save changes and the flip", async () => {
    render(await Page());

    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn dry-run on" })).toBeInTheDocument();
  });

  it("gives an admin the same", async () => {
    requireWorkspace.mockResolvedValue(access(["admin"]));

    render(await Page());

    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn dry-run on" })).toBeInTheDocument();
  });

  it.each([["viewer"], ["member"]] as const)(
    "gives a %s the page to read and nothing of the workspace's to press",
    async (role) => {
      requireWorkspace.mockResolvedValue(access([role]));

      render(await Page());

      expect(workspaceControls()).toEqual([]);
      expect(screen.getByText(`Viewing workspace settings as a ${role}.`)).toBeInTheDocument();
    },
  );

  it("errs low for a membership whose roles this installation does not recognise", async () => {
    requireWorkspace.mockResolvedValue(access([]));

    render(await Page());

    expect(workspaceControls()).toEqual([]);
  });
});

describe("the dry-run policy's old address", () => {
  it("redirects to the hub's Policies section, and renders nothing", () => {
    expect(() => PoliciesPage()).toThrow(`NEXT_REDIRECT:${POLICIES_PATH}`);
    expect(redirect).toHaveBeenCalledExactlyOnceWith("/settings#policies");
  });

  it("lands under the hub, so the Settings entry stays lit", () => {
    expect(POLICIES_PATH.startsWith(`${SETTINGS_PATH}#`)).toBe(true);
  });
});
