import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import type { Workspace } from "@/app/api/access";

import { dashboardPayload, engineStatus, healthReport, memberPage } from "../helpers/dashboard";
import { enablement, membership, org, repo, sessionUser } from "../helpers/login";

/**
 * The dashboard's reader: five calls, one object, and a failure that stays inside its own
 * card.
 *
 * The five resources are replaced rather than driven — each has a suite of its own in
 * `__tests__/api/`, and repeating them here would be testing the client twice while testing
 * the composition once. What is under test is what this layer adds: that the reads go out
 * together, that one failing leaves the others alone, and — the case that matters most —
 * that a redirect is *not* caught on its way past.
 */

const read = vi.fn();
const list = vi.fn();
const readEnablement = vi.fn();
const readReadiness = vi.fn();
const status = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/dashboard", () => ({ dashboard: { read: () => read() } }));
vi.mock("@/app/api/members", () => ({ members: { list: (...args: unknown[]) => list(...args) } }));
vi.mock("@/app/api/enablement", () => ({
  readEnablement: (...args: unknown[]) => readEnablement(...args),
}));
vi.mock("@/app/api/health", () => ({ readReadiness: () => readReadiness() }));
vi.mock("@/app/api/engine", () => ({ engine: { status: () => status() } }));

const { MEMBER_LIMIT, readDashboard } = await import("@/app/dashboard/data");

/** What the gate hands the page, in the seeded world. */
const ACCESS: Workspace = {
  session: {
    user: sessionUser(),
    memberships: [membership()],
    membershipTotal: 1,
    activeOrganizationId: membership().id,
    tenantSuggestion: null,
  },
  membership: membership(),
};

/** The seeded enablement list: one organisation, one repository, both on. */
const SEEDED = enablement([[org(), [repo()]]]);

beforeEach(() => {
  read.mockReset().mockResolvedValue(dashboardPayload());
  list.mockReset().mockResolvedValue(memberPage());
  readEnablement.mockReset().mockResolvedValue(SEEDED);
  readReadiness.mockReset().mockResolvedValue(healthReport());
  status.mockReset().mockResolvedValue(engineStatus());
});

describe("readDashboard", () => {
  it("returns everything the screen draws", async () => {
    const readings = await readDashboard(ACCESS);

    expect(readings.workspace).toEqual(membership());
    expect(readings.user).toEqual(sessionUser());
    expect(readings.aggregate).toEqual({ ok: true, value: dashboardPayload() });
    expect(readings.members).toEqual({ ok: true, value: memberPage() });
    expect(readings.enablement).toEqual({ ok: true, value: SEEDED });
    expect(readings.readiness).toEqual(healthReport());
    expect(readings.engine).toEqual({ ok: true, value: engineStatus() });
  });

  it("scopes every workspace-scoped read to the workspace the gate resolved", async () => {
    // Not to a cookie, a parameter or anything else this layer could have chosen: the gate
    // has already resolved the session's active organization against its own memberships.
    await readDashboard(ACCESS);

    expect(list).toHaveBeenCalledWith(membership().id, { limit: MEMBER_LIMIT });
    expect(readEnablement).toHaveBeenCalledWith(membership().id);
  });

  it("asks for the contract's largest page of members, so the breakdown describes the most it can", () => {
    // The count itself is the service's `total` and does not depend on this at all; what
    // this bounds is how much of the role breakdown under it is real.
    expect(MEMBER_LIMIT).toBe(100);
  });

  it("issues the five reads together rather than one after another", async () => {
    // A screen whose job is reporting the system's health should not take five round trips
    // to do it. Each read is held open until all five have started, which only completes if
    // they were in flight at once.
    const started: string[] = [];
    const gate = Promise.withResolvers<void>();
    const hold = (name: string) => () => {
      started.push(name);
      if (started.length === 5) gate.resolve();
      return gate.promise;
    };

    read.mockImplementation(hold("aggregate"));
    list.mockImplementation(hold("members"));
    readEnablement.mockImplementation(hold("enablement"));
    readReadiness.mockImplementation(hold("readiness"));
    status.mockImplementation(hold("engine"));

    await readDashboard(ACCESS);

    expect(started.sort()).toEqual([
      "aggregate",
      "enablement",
      "engine",
      "members",
      "readiness",
    ]);
  });

  it("names no workspace on the aggregate, because the session already does", async () => {
    // `GET /api/v1/dashboard` is scoped to the session's active organization and this
    // client sends no `X-Ouro-Tenant` override (`app/api/server.ts`), so the call takes no
    // argument at all. A workspace passed here would be a second opinion about tenancy.
    await readDashboard(ACCESS);

    expect(read).toHaveBeenCalledExactlyOnceWith();
  });
});

describe("a read that fails", () => {
  it("becomes a reason on its own card and leaves the rest alone", async () => {
    list.mockRejectedValue(new ApiError(404, "tenant_not_found", "No such tenant.", {}));

    const readings = await readDashboard(ACCESS);

    expect(readings.members).toEqual({ ok: false, reason: "No such tenant." });
    expect(readings.aggregate.ok).toBe(true);
    expect(readings.enablement.ok).toBe(true);
    expect(readings.engine.ok).toBe(true);
    expect(readings.readiness).not.toBeNull();
  });

  it("keeps a failed aggregate out of the cards that do not come from it", async () => {
    // The page head is the aggregate's; the stat row and the system card are the four #45
    // reads'. An aggregate the service refused degrades one and leaves the others reading.
    read.mockRejectedValue(
      new ApiError(400, "organization_required", "Choose a workspace first.", {}),
    );

    const readings = await readDashboard(ACCESS);

    expect(readings.aggregate).toEqual({ ok: false, reason: "Choose a workspace first." });
    expect(readings.members.ok).toBe(true);
    expect(readings.enablement.ok).toBe(true);
    expect(readings.engine.ok).toBe(true);
  });

  it("carries the message the service wrote, which is written for a person", async () => {
    status.mockRejectedValue(
      new ApiError(502, "engine_unavailable", "The engine is not available right now.", {}),
    );

    const readings = await readDashboard(ACCESS);

    expect(readings.engine).toEqual({
      ok: false,
      reason: "The engine is not available right now.",
    });
  });

  it("can fail in every card at once and still return a page to draw", async () => {
    const boom = (code: string) => new ApiError(500, code, "Something went wrong.", {});
    read.mockRejectedValue(boom("internal_error"));
    list.mockRejectedValue(boom("internal_error"));
    readEnablement.mockRejectedValue(boom("internal_error"));
    status.mockRejectedValue(boom("internal_error"));
    readReadiness.mockResolvedValue(null);

    const readings = await readDashboard(ACCESS);

    expect(readings.aggregate.ok).toBe(false);
    expect(readings.members.ok).toBe(false);
    expect(readings.enablement.ok).toBe(false);
    expect(readings.engine.ok).toBe(false);
    expect(readings.readiness).toBeNull();
    // The workspace still came from the gate, so the page head still has something to say.
    expect(readings.workspace.name).toBe("Acme Robotics");
  });
});

describe("what is deliberately not caught", () => {
  it("lets a redirect through, so an expired session still reaches the login screen", async () => {
    // A `401` arrives here as Next.js's redirect signal rather than as an `ApiError`
    // (`app/api/server.ts`). A catch wide enough to hold it would swallow the navigation
    // and draw a dashboard captioned with the framework's internal message.
    const signal = new Error("NEXT_REDIRECT /login");
    list.mockRejectedValue(signal);

    await expect(readDashboard(ACCESS)).rejects.toThrow("NEXT_REDIRECT /login");
  });

  it("lets a bug in a resource module through rather than reporting it as an outage", async () => {
    readEnablement.mockRejectedValue(new TypeError("under is not iterable"));

    await expect(readDashboard(ACCESS)).rejects.toBeInstanceOf(TypeError);
  });

  it("still lets a redirect through when another read failed first", async () => {
    // `Promise.all` settles them together, so the one that rejects with something other
    // than an `ApiError` has to win however the others landed.
    list.mockRejectedValue(new ApiError(500, "internal_error", "Something went wrong.", {}));
    status.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(readDashboard(ACCESS)).rejects.toThrow("NEXT_REDIRECT /login");
  });
});
