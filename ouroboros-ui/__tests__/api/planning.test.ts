import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { clientAnswering } from "../helpers/api";
import { EMPTY_ROADMAP, planningEpic, seededRoadmap } from "../helpers/planning";

// The facade sits on the server-side client — see `server.test.ts`.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { planning } = await import("@/app/api/planning");

/**
 * The planning frame's share of AL.4's contract (#280, consumed by #283): the roadmap read and the
 * lane create **New roadmap** is.
 */

describe("planning.roadmap", () => {
  it("reads the roadmap endpoint and hands back the payload as served", async () => {
    const { client, requests } = clientAnswering(seededRoadmap());

    const roadmap = await planning.roadmap(client);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/planning/roadmap");
    expect(roadmap).toEqual(seededRoadmap());
  });

  it("names no workspace, because the workspace is the session's", async () => {
    const { client, requests } = clientAnswering(seededRoadmap());

    await planning.roadmap(client);

    expect(requests[0]?.headers.get("X-Ouro-Tenant")).toBeNull();
  });

  it("keeps an unnamed roadmap's nulls as nulls", async () => {
    const { client } = clientAnswering(EMPTY_ROADMAP);

    await expect(planning.roadmap(client)).resolves.toEqual({ name: null, window: null, lanes: [] });
  });

  it("rejects with the service's envelope when it refuses", async () => {
    const { client } = clientAnswering(
      { code: "organization_required", message: "Choose a workspace.", details: {} },
      400,
    );

    const failure: unknown = await planning.roadmap(client).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe("organization_required");
  });
});

describe("planning.createEpic", () => {
  it("posts the body as composed, and answers with the stored lane", async () => {
    const { client, requests } = clientAnswering(planningEpic(), 201);
    const body = { name: "OTA hardening", roadmapName: "Helios 2.1", startMonth: "2026-07", endMonth: "2026-09" };

    const epic = await planning.createEpic(body, client);

    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/planning/epics");
    expect(await requests[0]!.json()).toEqual(body);
    expect(epic).toEqual(planningEpic());
  });

  it("rejects with a range refusal, naming its code", async () => {
    const { client } = clientAnswering(
      { code: "epic_month_range_invalid", message: "The range runs backwards.", details: {} },
      422,
    );

    const failure: unknown = await planning
      .createEpic({ name: "x", startMonth: "2026-09", endMonth: "2026-07" }, client)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(422);
    expect((failure as ApiError).code).toBe("epic_month_range_invalid");
  });
});
