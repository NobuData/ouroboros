import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NON_OWNER_NOTE, RESTORE_LABEL } from "@/app/lifecycle/recovery";
import type { RecoveryReading } from "@/app/lifecycle/recovery-data";
import { DASHBOARD_PATH, LOGIN_PATH } from "@/app/paths";

import { PURGE_AFTER } from "../helpers/lifecycle";
import { membership, sessionUser } from "../helpers/login";

/**
 * `/workspace-recovery` — the lockout screen's route (BS.6,
 * [#496](https://github.com/NobuData/ouroboros/issues/496)): who is asking, whether their
 * workspace is frozen, and where everybody else is sent.
 */

const currentAccess = vi.fn();
const readRecovery = vi.fn<() => Promise<RecoveryReading>>();
const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});

vi.mock("@/app/api/access", () => ({ currentAccess: () => currentAccess() }));
vi.mock("@/app/lifecycle/recovery-data", () => ({ readRecovery: () => readRecovery() }));
vi.mock("@/app/lifecycle/lifecycle-actions", () => ({ restoreWorkspace: vi.fn() }));
vi.mock("@/app/shell/switch-workspace", () => ({ switchWorkspace: vi.fn() }));
vi.mock("@/app/shell/actions", () => ({ signOutOfSession: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => redirect(path) }));

const Page = (await import("@/app/(auth)/workspace-recovery/page")).default;

/** The frozen workspace, and another the reader belongs to. */
const ACME = membership({ roles: ["owner"] });
const OTHER = membership({ id: "org-other", slug: "ken-personal", name: "ken-personal" });

beforeEach(() => {
  currentAccess.mockReset().mockResolvedValue({
    session: { user: sessionUser(), memberships: [ACME, OTHER], tenantSuggestion: null },
    membership: ACME,
  });
  readRecovery.mockReset().mockResolvedValue({
    state: "frozen",
    purgeAfter: PURGE_AFTER,
    restorable: true,
  });
  redirect.mockClear();
});

describe("the route", () => {
  it("draws the recovery screen for the session's workspace, with the reader's other workspaces", async () => {
    render(await Page());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      `${ACME.name} is scheduled for deletion`,
    );
    expect(screen.getByRole("button", { name: RESTORE_LABEL })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open ken-personal" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `Open ${ACME.name}` })).toBeNull();
  });

  it("draws the non-owner's variant from what the read said", async () => {
    readRecovery.mockResolvedValue({ state: "frozen", purgeAfter: PURGE_AFTER, restorable: false });

    render(await Page());

    expect(screen.getByRole("note")).toHaveTextContent(NON_OWNER_NOTE);
    expect(screen.queryByRole("button", { name: RESTORE_LABEL })).toBeNull();
  });

  it("sends a workspace that is not pending deletion to the dashboard", async () => {
    readRecovery.mockResolvedValue({ state: "open" });

    await expect(Page()).rejects.toThrow(`NEXT_REDIRECT:${DASHBOARD_PATH}`);
  });

  it("sends a request with no session, or no workspace, to sign in — and reads nothing", async () => {
    currentAccess.mockResolvedValue({ session: null, membership: undefined });

    await expect(Page()).rejects.toThrow(`NEXT_REDIRECT:${LOGIN_PATH}`);
    expect(readRecovery).not.toHaveBeenCalled();

    readRecovery.mockResolvedValue({ state: "signed-out" });
    currentAccess.mockResolvedValue({
      session: { user: sessionUser(), memberships: [ACME], tenantSuggestion: null },
      membership: ACME,
    });

    await expect(Page()).rejects.toThrow(`NEXT_REDIRECT:${LOGIN_PATH}`);
  });
});
