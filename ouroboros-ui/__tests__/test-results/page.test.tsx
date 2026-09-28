import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prPath } from "@/app/paths";
import { navRegistry } from "@/app/shell/nav-registry";
import { ACTIONS_LABEL, VIEWER_REASON } from "@/app/test-results/view";

import { membership, sessionUser } from "../helpers/login";
import { SEEDED_RUN_ID } from "../helpers/runs";
import { gate, timeline } from "../helpers/test-results";

/**
 * The test-results route (#335): the gate first, then one read — a run this workspace cannot see
 * is the not-found page, a failed read is the screen under a banner, `?from=` decides which module
 * stays lit, and `?attempt=` which build is read.
 */

const requireWorkspace = vi.fn();
const readTests = vi.fn();

/** What `notFound()` throws, so the case can see it was called. */
class NotFound extends Error {}

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/test-results/data", () => ({
  readTests: (id: string, attempt: number | null) => readTests(id, attempt),
}));
vi.mock("@/app/test-results/rerun-actions", () => ({ requestRerun: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound();
  },
}));

// The route passes no poll seam, so the polls it starts are the real ones; nothing answers here.
vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

const Page = (await import("@/app/(app)/runs/[id]/tests/page")).default;

/**
 * Render the route.
 *
 * @param query The search parameters.
 * @returns The rendered page.
 */
async function open(query: Record<string, string | string[] | undefined> = {}) {
  return render(
    await Page({ params: Promise.resolve({ id: SEEDED_RUN_ID }), searchParams: Promise.resolve(query) }),
  );
}

/**
 * Sign in holding these roles.
 *
 * @param roles The active membership's roles.
 */
function holding(roles: ReturnType<typeof membership>["roles"]): void {
  const held = membership({ roles });
  requireWorkspace.mockResolvedValue({
    session: { user: sessionUser(), memberships: [held], tenantSuggestion: null },
    membership: held,
  });
}

beforeEach(() => {
  holding(["owner"]);
  readTests.mockReset().mockResolvedValue({
    state: "found",
    value: { timeline: timeline(), trackerUrl: null, commitSource: null, gate: gate(), pullRequest: null },
  });
});

describe("the test-results route", () => {
  it("reads the run the path names, the latest attempt by default, and renders its head", async () => {
    await open();

    expect(readTests).toHaveBeenCalledExactlyOnceWith(SEEDED_RUN_ID, null);
    expect(screen.getByText("Test Results · Run #1847 · Build 3")).toBeInTheDocument();
  });

  it("reads the attempt ?attempt= names, and ignores one that is not an ordinal", async () => {
    const two = await open({ attempt: "2" });
    expect(readTests).toHaveBeenLastCalledWith(SEEDED_RUN_ID, 2);
    expect(screen.getByText("Test Results · Run #1847 · Build 2")).toBeInTheDocument();
    two.unmount();

    await open({ attempt: "../1" });
    expect(readTests).toHaveBeenLastCalledWith(SEEDED_RUN_ID, null);
  });

  it("reads nothing when the gate refuses — its redirect is the answer", async () => {
    requireWorkspace.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(open()).rejects.toThrow("NEXT_REDIRECT");
    expect(readTests).not.toHaveBeenCalled();
  });

  it("answers a run this workspace cannot see with the not-found page", async () => {
    readTests.mockResolvedValue({ state: "missing" });

    await expect(open()).rejects.toBeInstanceOf(NotFound);
  });

  it("draws a failed read as a banner rather than an error page", async () => {
    readTests.mockResolvedValue({ state: "failed", reason: "The database is down." });
    await open();

    expect(screen.getByText("The database is down.")).toBeInTheDocument();
  });

  it("keeps the module named by ?from= lit, and falls back to the dashboard", async () => {
    const farm = await open({ from: "build-farm" });
    expect(navRegistry().origin).toBe("build-farm");
    farm.unmount();

    await open({ from: "nowhere" });
    expect(navRegistry().origin).toBe("dashboard");
  });

  it("links the run's pull request to its verification page, keeping the origin (#363)", async () => {
    readTests.mockResolvedValue({
      state: "found",
      value: {
        timeline: timeline(),
        trackerUrl: null,
        commitSource: null,
        gate: gate(),
        pullRequest: { id: "5eed003a-0000-4000-8000-000000000514", number: 514 },
      },
    });
    await open({ from: "build-farm" });

    expect(screen.getByRole("link", { name: "PR #514" })).toHaveAttribute(
      "href",
      prPath("5eed003a-0000-4000-8000-000000000514", "build-farm"),
    );
  });

  it("links the timeline's shas through the commit source the read found (#336)", async () => {
    readTests.mockResolvedValue({
      state: "found",
      value: {
        timeline: timeline(),
        trackerUrl: null,
        commitSource: { kind: "github", owner: "acme-robotics", name: "helios-firmware" },
        gate: gate(),
        pullRequest: null,
      },
    });
    await open();

    for (const link of screen.getAllByRole("link", { name: "f42b9a0" })) {
      expect(link).toHaveAttribute(
        "href",
        "https://github.com/acme-robotics/helios-firmware/commit/f42b9a0",
      );
    }
    expect(screen.getAllByRole("link", { name: "f42b9a0" })).toHaveLength(3);
  });

  it("switches the re-runs on for a member and off, with the reason, for a viewer", async () => {
    holding(["member"]);
    const member = await open();
    const actions = within(screen.getByRole("group", { name: ACTIONS_LABEL }));
    expect(actions.getByRole("button", { name: /^Re-run full suite/ })).not.toHaveAttribute("aria-disabled");
    member.unmount();

    holding(["viewer"]);
    await open();
    expect(screen.getByText(VIEWER_REASON)).toBeInTheDocument();
  });
});
