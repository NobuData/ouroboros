import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { ROUTES_FORBIDDEN, ROUTES_SAVE_FAILURE } from "@/app/models/chain";

import { seededMatrix } from "../helpers/models";

/**
 * **Save routes**' server hop (#202) — the one write chain editing makes.
 *
 * A Server Action is a POST endpoint anybody can reach, so this suite is written as the
 * security case first: there is no workspace in the call and no person, so there is nothing to
 * forge, and the role gate is the service's. The rest is the posture — a refusal is a value
 * the page can draw, keyed by task kind when the server keyed it so, and the gate's redirect is
 * the one throw that must travel.
 */

/** What the API answers, per case. */
const saveRoutes = vi.fn();

vi.mock("@/app/api/routing", async () => {
  const actual = await vi.importActual<typeof import("@/app/api/routing")>("@/app/api/routing");

  return {
    ...actual,
    routing: { ...actual.routing, saveRoutes: (routes: unknown) => saveRoutes(routes) },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const actions = await import("@/app/models/route-actions");

/** One entry, as `toSaveInput` forms it. */
const ENTRY = {
  taskKind: "implement",
  hops: [{ alias: "coder-max", note: null }],
  allowLocalFallback: true,
  floorHopIndex: null,
  maxCostCentsPerRun: 250,
};

/** What a save that landed answers. */
const SAVED = { revisionId: "a1000000-0000-4000-8000-000000000001", routes: [seededMatrix().taskKinds[3].route] };

/** The contract's refusal, keyed by task kind. */
const REFUSED = new ApiError(422, "route_save_invalid", "These routes could not be saved.", {
  routes: { implement: { "hops.0.alias": ['This workspace has no model alias named "coder-max".'] } },
});

/** The refusal a member meets. */
const FORBIDDEN = new ApiError(403, "forbidden", "Your role does not permit this.");

beforeEach(() => {
  saveRoutes.mockReset().mockResolvedValue(SAVED);
});

describe("saveRoutes", () => {
  it("sends the batch it was given and nothing else — no workspace, no person", async () => {
    await actions.saveRoutes([ENTRY]);

    expect(saveRoutes).toHaveBeenCalledExactlyOnceWith([ENTRY]);
  });

  it("answers ok with the revision the server wrote", async () => {
    await expect(actions.saveRoutes([ENTRY])).resolves.toEqual({ ok: true, revisionId: SAVED.revisionId });
  });

  it("answers ok with a null revision for a batch that changed nothing", async () => {
    saveRoutes.mockResolvedValue({ ...SAVED, revisionId: null });

    await expect(actions.saveRoutes([ENTRY])).resolves.toEqual({ ok: true, revisionId: null });
  });

  it("hands a refused batch back as problems keyed by task kind, so the matrix can mark its rows", async () => {
    saveRoutes.mockRejectedValue(REFUSED);

    const outcome = await actions.saveRoutes([ENTRY]);

    expect(outcome).toEqual({
      ok: false,
      kind: "refused",
      problems: { implement: { "hops.0.alias": ['This workspace has no model alias named "coder-max".'] } },
    });
  });

  it("answers a member's press with the page's own sentence rather than the API's", async () => {
    saveRoutes.mockRejectedValue(FORBIDDEN);

    await expect(actions.saveRoutes([ENTRY])).resolves.toEqual({ ok: false, kind: "failed", reason: ROUTES_FORBIDDEN });
  });

  it("passes any other refusal's sentence through, and supplies one when the service sent none", async () => {
    saveRoutes.mockRejectedValue(new ApiError(503, "unavailable", "Routing is down."));
    await expect(actions.saveRoutes([ENTRY])).resolves.toEqual({ ok: false, kind: "failed", reason: "Routing is down." });

    saveRoutes.mockRejectedValue(new ApiError(500, "internal_error", ""));
    await expect(actions.saveRoutes([ENTRY])).resolves.toEqual({ ok: false, kind: "failed", reason: ROUTES_SAVE_FAILURE });
  });

  it("lets anything that is not an API error through, which is how a redirect travels", async () => {
    saveRoutes.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(actions.saveRoutes([ENTRY])).rejects.toThrow("NEXT_REDIRECT /login");
  });
});
