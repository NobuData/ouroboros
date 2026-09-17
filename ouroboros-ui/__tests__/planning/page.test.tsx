import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/app/api/membership";
import { NEW_ROADMAP_LABEL, NEW_ROADMAP_ROLE_REASON, PLANNING_TITLE } from "@/app/planning/view";

import { membership, sessionUser } from "../helpers/login";
import { planningReadings } from "../helpers/planning";

/**
 * The planning route (#283): the gate is asked first, what it returns is what the reader is given,
 * and the role it resolved decides whether **New roadmap** acts.
 */

/** What the gate answers this case with, or the signal it throws instead. */
const requireWorkspace = vi.fn();

/** What the reader answers with. */
const readPlanning = vi.fn();

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/planning/data", () => ({ readPlanning: (access: unknown) => readPlanning(access) }));
vi.mock("@/app/planning/create-actions", () => ({ createRoadmap: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const Page = (await import("@/app/(app)/planning/page")).default;

/**
 * What the gate hands back, for a reader holding these roles.
 *
 * @param roles The roles. Defaults to the seed's owner.
 * @returns The workspace.
 */
function access(roles: Role[] = ["owner"]) {
  return {
    session: { user: sessionUser(), memberships: [membership({ roles })], tenantSuggestion: null },
    membership: membership({ roles }),
  };
}

beforeEach(() => {
  requireWorkspace.mockReset().mockResolvedValue(access());
  readPlanning.mockReset().mockResolvedValue(planningReadings());
});

describe("the planning route", () => {
  it("renders the frame for the workspace the gate returned", async () => {
    render(await Page());

    expect(readPlanning).toHaveBeenCalledExactlyOnceWith(access());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PLANNING_TITLE);
  });

  it("reads nothing when the gate refuses — its redirect is the answer", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    requireWorkspace.mockRejectedValue(redirect);

    await expect(Page()).rejects.toBe(redirect);
    expect(readPlanning).not.toHaveBeenCalled();
  });

  it.each<[Role, boolean]>([
    ["owner", true],
    ["admin", true],
    ["member", false],
    ["viewer", false],
  ])("lets a %s act on New roadmap: %s", async (role, acts) => {
    requireWorkspace.mockResolvedValue(access([role]));

    render(await Page());

    const action = screen.getByRole("button", { name: NEW_ROADMAP_LABEL });

    if (acts) expect(action).not.toHaveAttribute("aria-disabled");
    else expect(action).toHaveAttribute("title", NEW_ROADMAP_ROLE_REASON);
  });
});
