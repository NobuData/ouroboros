import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prPath } from "@/app/paths";
import { navRegistry } from "@/app/shell/nav-registry";
import { MARK_ROUTE_TITLE, VIEWER_NOTE, WAIVE_LABEL } from "@/app/test-results/mark-route";
import { PHYSICAL_TITLE } from "@/app/test-results/physical";
import { SUITES_TITLE } from "@/app/test-results/suites";
import { ACTIONS_LABEL, VIEWER_REASON } from "@/app/test-results/view";

import { membership, sessionUser } from "../helpers/login";
import { SEEDED_RUN_ID } from "../helpers/runs";
import {
  COLLEAGUE_ID,
  CORRECTION_NOTE,
  classification,
  gate,
  mockupPage,
  page,
  timeline,
} from "../helpers/test-results";

/**
 * The test-results route (#335): the gate first, then one read — a run this workspace cannot see
 * is the not-found page, a failed read is the screen under a banner, `?from=` decides which module
 * stays lit, and `?attempt=` which build is read.
 */

const requireWorkspace = vi.fn();
const readTests = vi.fn();
const readPeople = vi.fn();

/** What `notFound()` throws, so the case can see it was called. */
class NotFound extends Error {}

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/api/people", () => ({ readPeople: () => readPeople() }));
vi.mock("@/app/test-results/data", () => ({
  readTests: (id: string, attempt: number | null) => readTests(id, attempt),
}));
vi.mock("@/app/test-results/rerun-actions", () => ({ requestRerun: vi.fn() }));
vi.mock("@/app/test-results/mark-route-actions", () => ({
  classifyFailure: vi.fn(),
  waiveFailure: vi.fn(),
  setRunIntent: vi.fn(),
}));
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
  readPeople.mockReset().mockResolvedValue(null);
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

  describe("Mark & Route's gates (#340)", () => {
    /** The rig's suite, whose one failure the seed decided. */
    const RIG = "PHYSICAL · HIL rig";

    /** Serve a page whose overshoot was classified by a colleague. */
    function decided(over: Record<string, unknown> = {}): void {
      readTests.mockResolvedValue({
        state: "found",
        value: {
          timeline: timeline(),
          trackerUrl: null,
          commitSource: null,
          gate: gate(),
          page: page({ classifications: [classification({ createdBy: COLLEAGUE_ID })] }),
          pullRequest: null,
          nextAttempt: 4,
          ...over,
        },
      });
    }

    /** The Mark & Route card. */
    function card() {
      return within(screen.getByRole("region", { name: MARK_ROUTE_TITLE }));
    }

    it.each([["owner"], ["admin"]] as const)("offers the waive action to an %s", async (role) => {
      holding([role]);
      decided();
      await open({ suite: RIG });

      expect(card().getByRole("button", { name: WAIVE_LABEL })).toBeInTheDocument();
      expect(card().getByRole("button", { name: "Re-classify" })).toBeInTheDocument();
    });

    it("offers a member classifying and the toggles, and no waive action", async () => {
      holding(["member"]);
      decided();
      await open({ suite: RIG });

      expect(card().getByRole("button", { name: "Re-classify" })).toBeInTheDocument();
      for (const toggle of card().getAllByRole("switch")) {
        expect(toggle).not.toHaveAttribute("aria-disabled");
      }
      expect(card().queryByRole("button", { name: /waive/i })).toBeNull();
    });

    it("offers a viewer the decision to read, and nothing to press", async () => {
      holding(["viewer"]);
      decided();
      await open({ suite: RIG });

      expect(card().getByText(VIEWER_NOTE)).toBeInTheDocument();
      expect(card().getByText(CORRECTION_NOTE)).toBeInTheDocument();
      expect(card().queryByRole("button", { name: "Re-classify" })).toBeNull();
      expect(card().queryByRole("button", { name: /waive/i })).toBeNull();
      for (const toggle of card().getAllByRole("switch")) {
        expect(toggle).toHaveAttribute("aria-disabled", "true");
      }
    });

    it("names a decision's author from the workspace's members, and the reader as you", async () => {
      readPeople.mockResolvedValue({ [COLLEAGUE_ID]: "Mel Member" });
      decided();
      const theirs = await open({ suite: RIG });

      expect(card().getByText(/by Mel Member/)).toBeInTheDocument();
      theirs.unmount();

      decided({
        page: page({ classifications: [classification({ createdBy: sessionUser().id })] }),
      });
      await open({ suite: RIG });

      expect(card().getByText(/by you/)).toBeInTheDocument();
    });

    it("says a member decided, and claims no name, when the members could not be read", async () => {
      readPeople.mockResolvedValue(null);
      decided();
      await open({ suite: RIG });

      expect(card().getByText(/by a member of this workspace/)).toBeInTheDocument();
    });

    it("names the attempt a correction round would open only when the read found it", async () => {
      readTests.mockResolvedValue({
        state: "found",
        value: {
          timeline: timeline(),
          trackerUrl: null,
          commitSource: null,
          gate: gate(),
          page: page(),
          pullRequest: null,
          nextAttempt: 4,
        },
      });
      const known = await open({ suite: RIG });

      // No hint has been read here, so nothing is pre-selected: the reader chooses.
      fireEvent.click(card().getByRole("radio", { name: /^Product bug$/ }));
      expect(
        card().getByRole("button", { name: "Queue correction round → attempt 4" }),
      ).toBeInTheDocument();
      known.unmount();

      readTests.mockResolvedValue({
        state: "found",
        value: {
          timeline: timeline(),
          trackerUrl: null,
          commitSource: null,
          gate: gate(),
          page: page(),
          pullRequest: null,
          nextAttempt: null,
        },
      });
      await open({ suite: RIG });

      fireEvent.click(card().getByRole("radio", { name: /^Product bug$/ }));
      expect(card().getByRole("button", { name: "Queue correction round" })).toBeInTheDocument();
    });
  });

  it("draws the suites the read found, with the one ?suite= names selected (#337)", async () => {
    readTests.mockResolvedValue({
      state: "found",
      value: {
        timeline: timeline(),
        trackerUrl: null,
        commitSource: null,
        gate: gate(),
        page: page(),
        pullRequest: null,
      },
    });
    await open({ suite: "telemetry integration" });

    const card = within(screen.getByRole("region", { name: SUITES_TITLE }));
    expect(card.getByRole("button", { name: "telemetry integration" })).toHaveAttribute("aria-pressed", "true");
    expect(card.getByRole("button", { name: "unit · drivers" })).toHaveAttribute("aria-pressed", "false");
  });

  it("selects nothing when the address names no suite (#337)", async () => {
    readTests.mockResolvedValue({
      state: "found",
      value: { timeline: timeline(), trackerUrl: null, commitSource: null, gate: gate(), page: page(), pullRequest: null },
    });
    await open();

    const card = within(screen.getByRole("region", { name: SUITES_TITLE }));
    expect(card.queryByRole("button", { pressed: true })).toBeNull();
  });

  it("draws the physical tests the read found, with the one ?case= names selected (#338)", async () => {
    readTests.mockResolvedValue({
      state: "found",
      value: { timeline: timeline(), trackerUrl: null, commitSource: null, gate: gate(), page: mockupPage(), pullRequest: null },
    });
    await open({ case: "Motor overshoot on e-stop release" });

    const card = within(screen.getByRole("region", { name: PHYSICAL_TITLE }));
    expect(card.getByRole("button", { pressed: true })).toHaveTextContent("Motor overshoot on e-stop release");
    expect(card.getByText(/overshoot/, { selector: ".tests-physical__measured" })).toHaveTextContent(
      "measured: overshoot 2.4% vs limit 2.0%",
    );
  });
});
