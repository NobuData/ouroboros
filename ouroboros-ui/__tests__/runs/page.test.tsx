import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Membership } from "@/app/api/membership";
import { ABORT_LABEL, CONTROLS_LABEL, PAUSE_LABEL, TAKEOVER_LABEL } from "@/app/runs/controls";
import { navRegistry } from "@/app/shell/nav-registry";

import { membership, sessionUser } from "../helpers/login";
import { SEEDED_RUN_ID, runConsole } from "../helpers/runs";

/**
 * The run console route (#309): the gate first, then one read — a run this workspace cannot see
 * is the not-found page, a failed read is the screen under a banner, and `?from=` decides which
 * module stays lit.
 */

const requireWorkspace = vi.fn();
const readRun = vi.fn();

/** What `notFound()` throws, so the case can see it was called. */
class NotFound extends Error {}

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/runs/data", () => ({ readRun: (id: string) => readRun(id) }));
vi.mock("@/app/runs/control-actions", () => ({ submitRunControl: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound();
  },
}));

// The route passes no poll seam, so the poll it starts is the real one; nothing answers here.
vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

const Page = (await import("@/app/(app)/runs/[id]/page")).default;

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

beforeEach(() => {
  requireWorkspace.mockReset().mockResolvedValue({
    session: { user: sessionUser(), memberships: [membership()], tenantSuggestion: null },
    membership: membership(),
  });
  readRun.mockReset().mockResolvedValue({ state: "found", value: runConsole() });
});

describe("the run console route", () => {
  it("reads the run the path names and renders its head", async () => {
    await open();

    expect(readRun).toHaveBeenCalledExactlyOnceWith(SEEDED_RUN_ID);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("#482 — Fix flaky CAN-bus telemetry test");
  });

  it("reads nothing when the gate refuses — its redirect is the answer", async () => {
    requireWorkspace.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(open()).rejects.toThrow("NEXT_REDIRECT");
    expect(readRun).not.toHaveBeenCalled();
  });

  it("answers a run this workspace cannot see with the not-found page", async () => {
    readRun.mockResolvedValue({ state: "missing" });

    await expect(open()).rejects.toBeInstanceOf(NotFound);
  });

  it("draws a failed read as a banner rather than an error page", async () => {
    readRun.mockResolvedValue({ state: "failed", reason: "The database is down." });
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
});

describe("the stage filter (#311)", () => {
  it("opens with the stage ?stage= names pressed", async () => {
    await open({ stage: "implement" });

    expect(screen.getByRole("button", { name: /^Implement/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("takes the first of a repeated ?stage=", async () => {
    await open({ stage: ["plan", "implement"] });

    expect(screen.getByRole("button", { name: /^Plan/ })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("the run controls (#310)", () => {
  /**
   * Sign in holding these roles.
   *
   * @param roles The active membership's roles.
   */
  function holding(roles: Membership["roles"]): void {
    const held = membership({ roles });
    requireWorkspace.mockResolvedValue({
      session: { user: sessionUser(), memberships: [held], tenantSuggestion: null },
      membership: held,
    });
  }

  it("draws pause, take-over and abort for an owner or an admin", async () => {
    for (const roles of [["owner"], ["admin"]] as const) {
      holding([...roles]);
      const view = await open();

      const group = screen.getByRole("group", { name: CONTROLS_LABEL });
      expect(within(group).getByRole("button", { name: PAUSE_LABEL })).toBeInTheDocument();
      expect(within(group).getByRole("button", { name: TAKEOVER_LABEL })).toBeInTheDocument();
      expect(within(group).getByRole("button", { name: ABORT_LABEL })).toBeInTheDocument();
      view.unmount();
    }
  });

  it("draws none of them for a member or a viewer", async () => {
    for (const roles of [["member"], ["viewer"], []] as const) {
      holding([...roles]);
      const view = await open();

      expect(screen.queryByRole("group", { name: CONTROLS_LABEL })).toBeNull();
      expect(screen.queryByRole("button", { name: PAUSE_LABEL })).toBeNull();
      expect(screen.queryByRole("button", { name: TAKEOVER_LABEL })).toBeNull();
      expect(screen.queryByRole("button", { name: ABORT_LABEL })).toBeNull();
      view.unmount();
    }
  });
});
