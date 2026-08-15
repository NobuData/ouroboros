import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { failed, readings } from "../helpers/dashboard";
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

// The screen this route renders now holds a Client Component over a Server Action (the pulse
// card's switch), and neither half survives a jsdom render on its own: the action module sits
// on the server-only client, and `useRouter()` wants the App Router mounted. Both are subjects
// of their own suites — `auto-merge-switch.test.tsx` and `pulse-actions.test.ts`.
vi.mock("@/app/dashboard/pulse-actions", () => ({ setAutoMerge: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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

    // The seeded aggregate's own sentence, so this asserts the reader's payload reached the
    // screen rather than that the screen has a page head at all.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/, Ken —/);
    expect(screen.getByText(/^3 issues in flight, 12 queued behind them\./)).toBeInTheDocument();
    expect(screen.getByText("Mission Control")).toBeInTheDocument();
  });

  it("wraps the screen in the freshness boundary, so a read that starts failing degrades", async () => {
    // #86's boundary is the route's, not the screen's: it holds the last render that worked,
    // which is only meaningful for renders the *route* produces. A page that rendered the
    // screen directly would lose the reader's data the first time a refresh failed.
    readDashboard.mockResolvedValue(readings({ aggregate: failed("Choose a workspace first.") }));

    render(await Page());

    const banner = screen.getByRole("status");

    expect(banner).toHaveTextContent("The dashboard could not be read.");
    expect(banner).toHaveTextContent("Choose a workspace first.");
    expect(within(banner).getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("draws no banner over a read that worked", async () => {
    render(await Page());

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says why once on the whole page, banner included (#86)", async () => {
    // The end-to-end form of this ticket's rule, at the one place the banner and the cards
    // are rendered together: the service's sentence appears in the banner and nowhere else.
    readDashboard.mockResolvedValue(readings({ aggregate: failed("Choose a workspace first.") }));

    const { container } = render(await Page());

    const said = (container.textContent?.split("Choose a workspace first.").length ?? 1) - 1;

    expect(said).toBe(1);
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
