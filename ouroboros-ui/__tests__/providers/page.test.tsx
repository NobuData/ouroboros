import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PROVIDERS_TITLE, providersSubline } from "@/app/providers/view";

import { membership, sessionUser } from "../helpers/login";

/**
 * The providers page's route (#227).
 *
 * It is two lines, and this suite is about both: the gate is asked first, and what it returns
 * is what the screen is given — the workspace's display name, which is the one input the
 * approved subline needs. Everything else the page could be judged on is covered where it is
 * decided (`providers-screen.test.tsx`, `view.test.ts`), which is why this file is short
 * rather than a second copy of either.
 *
 * The gate is replaced: it has its own suite (`__tests__/api/access.test.ts`), and driving it
 * through this route would test it a second time while testing the wiring not at all. So is
 * the Server Action behind the sheet, for the reason `providers-screen.test.tsx` gives.
 */

/** What the gate answers this case with, or the signal it throws instead. */
const requireWorkspace = vi.fn();

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/providers/audit-actions", () => ({
  readAuditTrail: () => Promise.resolve({ ok: true, events: [], total: 0 }),
}));

const Page = (await import("@/app/(app)/models/providers/page")).default;

/** What the gate hands back, in the seeded world. */
const ACCESS = {
  session: { user: sessionUser(), memberships: [membership()], tenantSuggestion: null },
  membership: membership(),
};

beforeEach(() => {
  requireWorkspace.mockReset().mockResolvedValue(ACCESS);
});

describe("the providers route", () => {
  it("asks the gate before it draws anything", async () => {
    // "Unauthenticated `(app)` routes redirect to the login screen" is true because of this
    // call, not because of a check in the layout — see `app/(app)/layout.tsx` for why.
    render(await Page());

    expect(requireWorkspace).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PROVIDERS_TITLE);
  });

  it("draws the subline for the workspace the gate resolved", async () => {
    // The session/role context the ticket depends on, arriving through the same call every
    // signed-in screen makes: the name in the sentence is the active workspace's, resolved
    // against the memberships the service reported rather than trusted from anywhere else.
    render(await Page());

    expect(screen.getByText(providersSubline(ACCESS.membership.name))).toBeInTheDocument();
  });

  it("draws a different workspace's name when the gate resolves a different workspace", async () => {
    // The name is data from the gate, not a constant that happens to match the seed.
    requireWorkspace.mockResolvedValue({
      ...ACCESS,
      membership: membership({ id: "5eed0001-0000-4000-8000-000000000002", name: "Acme Labs" }),
    });

    render(await Page());

    expect(screen.getByText(providersSubline("Acme Labs"))).toBeInTheDocument();
    expect(screen.queryByText(/Acme Robotics/)).toBeNull();
  });

  it("draws nothing at all when the gate redirects instead of returning", async () => {
    // `redirect()` signals by throwing, so a request with no session or no chosen workspace
    // never reaches the screen.
    requireWorkspace.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(Page()).rejects.toThrow("NEXT_REDIRECT /login");
  });
});
