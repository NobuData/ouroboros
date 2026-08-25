import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ADD_PROVIDER_READ_ONLY } from "@/app/providers/catalog";
import { ADD_PROVIDER_LABEL, PROVIDERS_TITLE, providersSubline } from "@/app/providers/view";

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
 * through this route would test it a second time while testing the wiring not at all. So are
 * the Server Actions behind the sheet and the add dialog, for the reason
 * `providers-screen.test.tsx` gives.
 *
 * Since AE.5 (#231) the route answers a second question from the same membership — whether
 * this reader may connect a provider — and the two cases below hold it to
 * `app/api/membership.ts`'s answer rather than to a role of its own.
 */

/** What the gate answers this case with, or the signal it throws instead. */
const requireWorkspace = vi.fn();

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/providers/audit-actions", () => ({
  readAuditTrail: () => Promise.resolve({ ok: true, events: [], total: 0 }),
}));
vi.mock("@/app/providers/add-actions", () => ({
  readCatalog: () => Promise.resolve({ ok: true, entries: [], existing: [] }),
  addProvider: () => Promise.resolve({ ok: false, refusal: { code: "x", message: "", details: {} } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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

  it("lets an owner reach the add flow", async () => {
    // `mayAdminister` decided once, from the membership the gate resolved: an owner's
    // **+ Add provider** acts.
    render(await Page());

    expect(screen.getByRole("button", { name: ADD_PROVIDER_LABEL })).not.toHaveAttribute(
      "aria-disabled",
    );
  });

  it("keeps a member from reaching it, with the reason on the control", async () => {
    // The ticket's last criterion, at the route: a member session cannot reach the flow. The
    // control stays — labelled, in the tab order — and the gate that enforces is the service's.
    requireWorkspace.mockResolvedValue({
      ...ACCESS,
      membership: membership({ roles: ["member"] }),
    });

    render(await Page());

    const add = screen.getByRole("button", { name: ADD_PROVIDER_LABEL });

    expect(add).toHaveAttribute("aria-disabled", "true");
    expect(add).toHaveAttribute("title", ADD_PROVIDER_READ_ONLY);
  });

  it("draws nothing at all when the gate redirects instead of returning", async () => {
    // `redirect()` signals by throwing, so a request with no session or no chosen workspace
    // never reaches the screen.
    requireWorkspace.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(Page()).rejects.toThrow("NEXT_REDIRECT /login");
  });
});
