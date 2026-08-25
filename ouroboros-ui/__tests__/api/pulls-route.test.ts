import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { pullsPath } from "@/app/api/providers/[id]/pulls/path";

import { pullRecord } from "../helpers/providers";

/**
 * The pull-list's poll ([#230](https://github.com/NobuData/ouroboros/issues/230)): a route
 * handler that passes the service's records through with the session this request carries,
 * and hands a refusal back with its status rather than redirecting a `fetch` nobody sees.
 */

const pulls = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/providers", () => ({ providers: { pulls: (id: string) => pulls(id) } }));
vi.mock("@/app/api/server", () => ({ anonymousApi: () => ({}) }));

const { CACHE_CONTROL, GET } = await import("@/app/api/providers/[id]/pulls/route");

const ID = pullRecord().connectionId;

function request(id: string) {
  return GET(new Request(`http://ui.test${pullsPath(id)}`), { params: Promise.resolve({ id }) });
}

describe("the poll's path", () => {
  it("is this origin's, with the connection encoded", () => {
    expect(pullsPath(ID)).toBe(`/api/providers/${ID}/pulls`);
    expect(pullsPath("a/b")).toBe("/api/providers/a%2Fb/pulls");
  });
});

describe("GET /api/providers/{id}/pulls", () => {
  it("passes the service's records through, uncached", async () => {
    const answer = { connectionId: ID, pulls: [pullRecord()] };
    pulls.mockResolvedValue(answer);

    const response = await request(ID);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
    expect(await response.json()).toEqual(answer);
    expect(pulls).toHaveBeenCalledWith(ID);
  });

  it("hands the service's refusal back with its status and code", async () => {
    pulls.mockRejectedValue(new ApiError(404, "provider_connection_not_found", "none such"));

    const response = await request(ID);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "provider_connection_not_found", message: "none such" });
  });

  it("answers 401 for a session that has gone, so the list stops polling", async () => {
    pulls.mockRejectedValue(new ApiError(401, "unauthenticated", "gone"));

    const response = await request(ID);

    expect(response.status).toBe(401);
  });

  it("lets anything that is not the service's refusal travel", async () => {
    pulls.mockRejectedValue(new TypeError("a bug"));

    await expect(request(ID)).rejects.toBeInstanceOf(TypeError);
  });
});
