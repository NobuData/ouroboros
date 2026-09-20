import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/app/api/membership";

import { failedFarmReadings, farmReadings } from "../helpers/farm";
import { membership, sessionUser } from "../helpers/login";

/**
 * The build farm route (#256): the gate is asked first, and what it returns is what the reader is
 * given. No role changes the page — every member may look, and no action can act yet.
 */

/** What the gate answers this case with, or the signal it throws instead. */
const requireWorkspace = vi.fn();

/** What the reader answers with. */
const readFarm = vi.fn();

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/farm/data", () => ({ readFarm: (access: unknown) => readFarm(access) }));

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

  it("draws the same page for a viewer as for an owner, because looking is what a viewer is for", async () => {
    const owner = render(await Page());
    const asOwner = owner.container.innerHTML;
    owner.unmount();

    requireWorkspace.mockResolvedValue(access(["viewer"]));
    const viewer = render(await Page());

    expect(viewer.container.innerHTML).toBe(asOwner);
  });

  it("renders a refused read as a page under a banner rather than throwing", async () => {
    readFarm.mockResolvedValue(failedFarmReadings("Choose a workspace."));

    render(await Page());

    // By its class: the runners card (#257) holds a polite region of its own.
    expect(document.querySelector(".ou-retry")).toHaveTextContent("Choose a workspace.");
  });
});
