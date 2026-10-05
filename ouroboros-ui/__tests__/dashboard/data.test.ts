import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import type { Workspace } from "@/app/api/access";

import { completionRunIds } from "@/app/dashboard/view";

import { dashboardPayload, engineStatus, healthReport } from "../helpers/dashboard";
import { membership, sessionUser } from "../helpers/login";

/**
 * The dashboard's reader: three calls, one object, and a failure that stays inside its own
 * card — then one lookup of the completions card's pull requests (#363), which follows the
 * aggregate because it is of the aggregate's rows.
 *
 * The three resources are replaced rather than driven — each has a suite of its own in
 * `__tests__/api/`, and repeating them here would be testing the client twice while testing
 * the composition once. What is under test is what this layer adds: that the reads go out
 * together, that one failing leaves the others alone, and — the case that matters most —
 * that a redirect is *not* caught on its way past.
 *
 * It was five until [#81](https://github.com/NobuData/ouroboros/issues/81). The members
 * listing and the enablement lists fed #45's stat row, which counted people and
 * repositories while nothing could report on a loop; the row is now the aggregate's own
 * four figures, so both reads lost their card and this page stopped making them.
 */

const read = vi.fn();
const readReadiness = vi.fn();
const status = vi.fn();
const offer = vi.fn();
const runPullRequests = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/dashboard", () => ({ dashboard: { read: () => read() } }));
vi.mock("@/app/api/health", () => ({ readReadiness: () => readReadiness() }));
vi.mock("@/app/api/engine", () => ({ engine: { status: () => status() } }));
vi.mock("@/app/get-started/data", () => ({ readGetStartedOffer: () => offer() }));
vi.mock("@/app/prs/data", () => ({
  runPullRequests: (runIds: readonly string[]) => runPullRequests(runIds),
}));

const { readDashboard } = await import("@/app/dashboard/data");

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

beforeEach(() => {
  read.mockReset().mockResolvedValue(dashboardPayload());
  readReadiness.mockReset().mockResolvedValue(healthReport());
  status.mockReset().mockResolvedValue(engineStatus());
  offer.mockReset().mockResolvedValue(null);
  runPullRequests.mockReset().mockResolvedValue(new Map());
});

describe("readDashboard", () => {
  it("returns everything the screen draws", async () => {
    const readings = await readDashboard(ACCESS);

    expect(readings.workspace).toEqual(membership());
    expect(readings.user).toEqual(sessionUser());
    expect(readings.aggregate).toEqual({ ok: true, value: dashboardPayload() });
    expect(readings.readiness).toEqual(healthReport());
    expect(readings.engine).toEqual({ ok: true, value: engineStatus() });
  });

  it("stamps the page with one clock reading, taken after the reads", async () => {
    // The active-loops table draws durations that are still running (#82), so `now` is an
    // input to the render rather than something a component may look up — one reading for
    // the page, so two cards cannot disagree about what time it is. Taken *after* the reads
    // so a slow round trip is not counted as part of a run's elapsed time.
    const before = Date.now();
    const readings = await readDashboard(ACCESS);

    expect(readings.readAt).toBeGreaterThanOrEqual(before);
    expect(readings.readAt).toBeLessThanOrEqual(Date.now());
  });

  it("issues the three reads together rather than one after another", async () => {
    // A screen whose job is reporting the system's health should not take three round trips
    // to do it. Each read is held open until all three have started, which only completes
    // if they were in flight at once.
    const started: string[] = [];
    const gate = Promise.withResolvers<void>();
    const hold = (name: string, answer: unknown) => () => {
      started.push(name);
      if (started.length === 3) gate.resolve();
      return gate.promise.then(() => answer);
    };

    read.mockImplementation(hold("aggregate", dashboardPayload()));
    readReadiness.mockImplementation(hold("readiness", healthReport()));
    status.mockImplementation(hold("engine", engineStatus()));

    await readDashboard(ACCESS);

    expect(started.sort()).toEqual(["aggregate", "engine", "readiness"]);
  });

  it("names no workspace on the aggregate, because the session already does", async () => {
    // `GET /api/v1/dashboard` is scoped to the session's active organization and this
    // client sends no `X-Ouro-Tenant` override (`app/api/server.ts`), so the call takes no
    // argument at all. A workspace passed here would be a second opinion about tenancy.
    await readDashboard(ACCESS);

    expect(read).toHaveBeenCalledExactlyOnceWith();
  });
});

describe("the completions card's pull requests (#363)", () => {
  it("looks up, in one request, the shown rows that name a pull request", async () => {
    const mirrored = new Map([
      [
        dashboardPayload().recentRuns[0]!.id,
        { id: "5eed003a-0000-4000-8000-000000000512", number: 512 },
      ],
    ]);
    runPullRequests.mockResolvedValue(mirrored);

    const readings = await readDashboard(ACCESS);

    expect(runPullRequests).toHaveBeenCalledExactlyOnceWith(
      completionRunIds(dashboardPayload().recentRuns),
    );
    expect(readings.pullRequests).toBe(mirrored);
  });

  it("asks only once the aggregate is in — the lookup is of its rows", async () => {
    const order: string[] = [];
    read.mockImplementation(() => {
      order.push("aggregate");
      return Promise.resolve(dashboardPayload());
    });
    runPullRequests.mockImplementation(() => {
      order.push("pull requests");
      return Promise.resolve(new Map());
    });

    await readDashboard(ACCESS);

    expect(order).toEqual(["aggregate", "pull requests"]);
  });

  it("asks nothing when the aggregate could not be read, and knows no pull request", async () => {
    read.mockRejectedValue(new ApiError(500, "internal_error", "Something went wrong.", {}));

    const readings = await readDashboard(ACCESS);

    expect(runPullRequests).not.toHaveBeenCalled();
    expect(readings.pullRequests.size).toBe(0);
  });

  it("lets a redirect from the lookup through", async () => {
    runPullRequests.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(readDashboard(ACCESS)).rejects.toThrow("NEXT_REDIRECT /login");
  });
});

describe("a read that fails", () => {
  it("becomes a reason on its own card and leaves the rest alone", async () => {
    status.mockRejectedValue(new ApiError(502, "engine_unavailable", "No engine.", {}));

    const readings = await readDashboard(ACCESS);

    expect(readings.engine).toEqual({ ok: false, reason: "No engine." });
    expect(readings.aggregate.ok).toBe(true);
    expect(readings.readiness).not.toBeNull();
  });

  it("keeps a failed aggregate out of the cards that do not come from it", async () => {
    // The page head and the stat row are the aggregate's; the system card is the two #45
    // reads'. An aggregate the service refused degrades those and leaves this one reading.
    read.mockRejectedValue(
      new ApiError(400, "organization_required", "Choose a workspace first.", {}),
    );

    const readings = await readDashboard(ACCESS);

    expect(readings.aggregate).toEqual({ ok: false, reason: "Choose a workspace first." });
    expect(readings.engine.ok).toBe(true);
    expect(readings.readiness).not.toBeNull();
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
    status.mockRejectedValue(boom("internal_error"));
    readReadiness.mockResolvedValue(null);

    const readings = await readDashboard(ACCESS);

    expect(readings.aggregate.ok).toBe(false);
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
    read.mockRejectedValue(signal);

    await expect(readDashboard(ACCESS)).rejects.toThrow("NEXT_REDIRECT /login");
  });

  it("lets a bug in a resource module through rather than reporting it as an outage", async () => {
    read.mockRejectedValue(new TypeError("under is not iterable"));

    await expect(readDashboard(ACCESS)).rejects.toBeInstanceOf(TypeError);
  });

  it("still lets a redirect through when another read failed first", async () => {
    // `Promise.all` settles them together, so the one that rejects with something other
    // than an `ApiError` has to win however the others landed.
    read.mockRejectedValue(new ApiError(500, "internal_error", "Something went wrong.", {}));
    status.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(readDashboard(ACCESS)).rejects.toThrow("NEXT_REDIRECT /login");
  });
});
