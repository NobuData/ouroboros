import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/app/api/membership";
import { COPY_COMMAND, MANAGE_TOKENS, MEMBER_NOTE } from "@/app/farm/enroll";

import { failedFarmReadings, farmReadings } from "../helpers/farm";
import { membership, sessionUser } from "../helpers/login";

/**
 * The build farm route (#256): the gate is asked first, and what it returns is what the reader is
 * given. Every member may look; the one thing a role changes is the enroll flow (#258), which the
 * route decides once, through `mayAdminister`.
 */

/** What the gate answers this case with, or the signal it throws instead. */
const requireWorkspace = vi.fn();

/** What the reader answers with. */
const readFarm = vi.fn();

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/farm/data", () => ({ readFarm: (access: unknown) => readFarm(access) }));
// The enroll card's Server Actions import the server-only client; the route presses none.
vi.mock("@/app/farm/enroll-actions", () => ({
  mintEnrollCommand: vi.fn(),
  readEnrollmentTokens: vi.fn(),
  revokeEnrollmentToken: vi.fn(),
}));

// The pools card (#259) writes through Server Actions too; this suite presses none of them.
vi.mock("@/app/farm/pool-actions", () => ({
  createPool: vi.fn(),
  deletePool: vi.fn(),
  updatePool: vi.fn(),
}));

// The runner menu and the submit dialog (#260) share the screen; this suite presses neither.
vi.mock("@/app/farm/lifecycle-actions", () => ({
  drainRunner: vi.fn(),
  undrainRunner: vi.fn(),
  removeRunner: vi.fn(),
}));

vi.mock("@/app/farm/submit-actions", () => ({ submitBuild: vi.fn() }));

// The route passes the screen no test seam, so the poll it starts is the real one; what it asks
// is this origin, which answers nothing here — the page under test is the server's.
vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

const Page = (await import("@/app/(app)/build-farm/page")).default;

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
  readFarm.mockReset().mockResolvedValue(farmReadings());
});

describe("the build farm route", () => {
  it("renders the page for the workspace the gate returned", async () => {
    render(await Page());

    expect(readFarm).toHaveBeenCalledExactlyOnceWith(access());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("5 runners. 2 pools. 78% cache hits.");
  });

  it("reads nothing when the gate refuses — its redirect is the answer", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    requireWorkspace.mockRejectedValue(redirect);

    await expect(Page()).rejects.toBe(redirect);
    expect(readFarm).not.toHaveBeenCalled();
  });

  it("draws the same farm for a viewer as for an owner, because looking is what a viewer is for", async () => {
    const owner = render(await Page());
    const asOwner = owner.container.querySelector(".farm-runners")?.innerHTML;
    const tiles = owner.container.querySelectorAll(".ou-stat").length;
    owner.unmount();

    requireWorkspace.mockResolvedValue(access(["viewer"]));
    const viewer = render(await Page());

    expect(asOwner).toBeDefined();
    expect(viewer.container.querySelector(".farm-runners")?.innerHTML).toBe(asOwner);
    expect(viewer.container.querySelectorAll(".ou-stat")).toHaveLength(tiles);
  });

  it.each<[Role]>([["owner"], ["admin"]])("hands an %s the mint and the way back (#258)", async (role) => {
    requireWorkspace.mockResolvedValue(access([role]));

    render(await Page());

    expect(screen.getByRole("button", { name: COPY_COMMAND })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: MANAGE_TOKENS })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Enroll runner" })).not.toHaveAttribute("aria-disabled");
  });

  it.each<[Role]>([["member"], ["viewer"]])("hands a %s the explainer and neither (#258)", async (role) => {
    requireWorkspace.mockResolvedValue(access([role]));

    render(await Page());

    expect(screen.getByText(MEMBER_NOTE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: COPY_COMMAND })).toBeNull();
    expect(screen.queryByRole("button", { name: MANAGE_TOKENS })).toBeNull();
    expect(screen.getByRole("button", { name: "+ Enroll runner" })).toHaveAttribute("aria-disabled", "true");
  });

  it("names the workspace's own slug in the command, which is what --tenant takes", async () => {
    render(await Page());

    expect(screen.getByRole("group", { name: "Enroll command" })).toHaveTextContent(
      `--tenant ${access().membership.slug}`,
    );
  });

  it("renders a refused read as a page under a banner rather than throwing", async () => {
    readFarm.mockResolvedValue(failedFarmReadings("Choose a workspace."));

    render(await Page());

    // By its class: the runners card (#257) holds a polite region of its own.
    expect(document.querySelector(".ou-retry")).toHaveTextContent("Choose a workspace.");
  });
});
