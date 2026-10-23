import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/app/api/membership";

import { insightsReadings, seededInsights } from "../helpers/insights";
import { membership, sessionUser } from "../helpers/login";
import { maskIds } from "../helpers/palettes";

/**
 * The insights route (#443): the gate is asked first, the address's range and data origin (DJ.3)
 * are read, and every member — a viewer included — is given the same page.
 */

const requireWorkspace = vi.fn();
const readInsights = vi.fn();
/** The origin cookie this request carries, per case (DJ.3). */
let remembered: string | undefined;

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({ get: (name: string) => (name === "ouro_origin" && remembered !== undefined ? { value: remembered } : undefined) }),
}));

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/insights/data", () => ({
  readInsights: (access: unknown, range: string, origin: string) => readInsights(access, range, origin),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/insights/intervention-actions", () => ({
  listCauseEvents: vi.fn(),
  recategorizeEvent: vi.fn(),
}));
vi.mock("@/app/insights/digest-actions", () => ({ readDigestSheet: vi.fn(), setDigestSubscription: vi.fn() }));

// The route passes the screen no test seam, so the poll it starts is the real one; what it asks
// is this origin, which answers nothing here — the page under test is the server's.
vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

const Page = (await import("@/app/(app)/insights/page")).default;

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

/**
 * The page, for an address's query.
 *
 * @param query The query, as Next.js hands it.
 * @returns The rendered element.
 */
async function page(query: Record<string, string | string[] | undefined> = {}) {
  return Page({ searchParams: Promise.resolve(query) });
}

beforeEach(() => {
  remembered = undefined;
  requireWorkspace.mockReset().mockResolvedValue(access());
  readInsights.mockReset().mockImplementation((_access: unknown, range: "7d" | "30d" | "90d") =>
    Promise.resolve(insightsReadings(seededInsights({ range }))),
  );
});

describe("the insights route", () => {
  it("renders the default range for the workspace the gate returned", async () => {
    render(await page());

    expect(readInsights).toHaveBeenCalledExactlyOnceWith(access(), "30d", "live");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("27 PRs merged this week. 2 needed a human.");
  });

  it("opens on the range the address names", async () => {
    render(await page({ range: "90d" }));

    expect(readInsights).toHaveBeenCalledWith(access(), "90d", "live");
    expect(screen.getByRole("button", { name: "90d" })).toHaveAttribute("aria-pressed", "true");
  });

  it("reads the default for a range the service would refuse", async () => {
    await page({ range: "custom" });

    expect(readInsights).toHaveBeenCalledWith(access(), "30d", "live");
  });

  it("opens on the origin the address names, else the remembered one, else live (DJ.3)", async () => {
    await page({ origin: "seeded" });
    remembered = "simulated";
    await page();
    await page({ origin: "all" });
    await page({ origin: "bogus" });

    expect(readInsights.mock.calls.map((call) => call[2])).toEqual(["seeded", "simulated", "all", "simulated"]);
  });

  it("reads nothing when the gate refuses — its redirect is the answer", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    requireWorkspace.mockRejectedValue(redirect);

    await expect(page()).rejects.toBe(redirect);
    expect(readInsights).not.toHaveBeenCalled();
  });

  it("draws the same page for a viewer as for an owner", async () => {
    const owner = render(await page());
    const asOwner = maskIds(owner.container.innerHTML);
    owner.unmount();

    requireWorkspace.mockResolvedValue(access(["viewer"]));
    const viewer = render(await page());

    expect(maskIds(viewer.container.innerHTML)).toBe(asOwner);
  });
});
