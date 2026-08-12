import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readings } from "../helpers/dashboard";
import { membership, sessionUser } from "../helpers/login";

/**
 * The dashboard's route.
 *
 * It is three lines, and this suite is about all three: the gate is asked first, what it
 * returns is what the reader is given, and what the reader returns is what the screen
 * draws. Everything else the page could be judged on — the arithmetic, the pills, the empty
 * states — is covered where it is decided, which is why this file is short rather than a
 * second copy of `dashboard-screen.test.tsx`.
 *
 * Both collaborators are replaced: `requireWorkspace()` has its own suite
 * (`__tests__/api/access.test.ts`) and so does the reader, and driving either through this
 * route would test them a second time while testing the wiring not at all.
 */

/** What the gate answers this case with, or the signal it throws instead. */
const requireWorkspace = vi.fn();

/** What the reader answers with. */
const readDashboard = vi.fn();

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/dashboard/data", () => ({
  readDashboard: (access: unknown) => readDashboard(access),
}));

const Page = (await import("@/app/(app)/dashboard/page")).default;

/** What the gate hands back, in the seeded world. */
const ACCESS = {
  session: { user: sessionUser(), memberships: [membership()], tenantSuggestion: null },
  membership: membership(),
};

beforeEach(() => {
  requireWorkspace.mockReset().mockResolvedValue(ACCESS);
  readDashboard.mockReset().mockResolvedValue(readings());
});

describe("the dashboard route", () => {
  it("asks the gate before it reads anything", async () => {
    // "Unauthenticated `(app)` routes redirect to the login screen" is true because of this
    // call, not because of a check in the layout — see app/(app)/layout.tsx for why.
    render(await Page());

    expect(requireWorkspace).toHaveBeenCalledOnce();
  });

  it("hands the reader exactly what the gate resolved, rather than resolving it again", async () => {
    // The page's authorization and the page's data are one decision: the workspace every
    // read is scoped to is the one the gate matched against the session's own memberships.
    await Page();

    expect(readDashboard).toHaveBeenCalledExactlyOnceWith(ACCESS);
  });

  it("draws what the reader returned", async () => {
    render(await Page());

    expect(screen.getByRole("heading", { level: 1, name: "Acme Robotics" })).toBeInTheDocument();
    expect(screen.getByText("Mission Control")).toBeInTheDocument();
  });

  it("reads nothing at all when the gate redirects instead of returning", async () => {
    // `redirect()` signals by throwing, so a request with no session or no chosen workspace
    // never reaches the reads — which is what keeps a signed-out visitor from costing four
    // calls to a service that would refuse all of them.
    requireWorkspace.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(Page()).rejects.toThrow("NEXT_REDIRECT /login");
    expect(readDashboard).not.toHaveBeenCalled();
  });

  it("lets a redirect raised during the reads through, rather than drawing around it", async () => {
    // A session that expired between the gate and the calls still reaches the login screen.
    readDashboard.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(Page()).rejects.toThrow("NEXT_REDIRECT /login");
  });
});
