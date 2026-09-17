import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { clientAnswering } from "../helpers/api";
import {
  EMPTY_ROADMAP,
  SEEDED_BATCH_ID,
  generatedBatch,
  planningBatch,
  planningEpic,
  pushResult,
  seededRoadmap,
} from "../helpers/planning";
import { SEEDED_GITHUB_ID } from "../helpers/sources";

// The facade sits on the server-side client — see `server.test.ts`.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { planning } = await import("@/app/api/planning");

/**
 * The planning page's share of AL.4's contract (#280, consumed by #283 and #284): the roadmap read,
 * the lane create **New roadmap** is, and the generator card's batch, draft, push and milestone
 * operations.
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

/** The service's base, as the stub client is built on. */
const BASE = "http://rest.test:4000/api/v1/planning";

describe("the generator's operations (#284)", () => {
  it("generates a batch from the card's body", async () => {
    const { client, requests } = clientAnswering(generatedBatch({}, ["note"]), 201);
    const body = {
      prompt: "Survive power loss.",
      outline: null,
      targetSourceId: SEEDED_GITHUB_ID,
      milestone: "Helios 2.1",
      autoSize: true,
      queueSmall: false,
      localKeyPrefix: "OTA",
    };

    const batch = await planning.generate(body, client);

    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe(`${BASE}/batches`);
    expect(await requests[0]!.json()).toEqual(body);
    expect(batch.notes).toEqual(["note"]);
  });

  it("reads one batch by id", async () => {
    const { client, requests } = clientAnswering(planningBatch());

    await expect(planning.batch(SEEDED_BATCH_ID, client)).resolves.toEqual(planningBatch());
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toBe(`${BASE}/batches/${SEEDED_BATCH_ID}`);
  });

  it("regenerates, patches, pushes and resumes at the contract's paths", async () => {
    const regenerated = clientAnswering(generatedBatch());
    await planning.regenerate(SEEDED_BATCH_ID, regenerated.client);
    expect(regenerated.requests[0]?.method).toBe("POST");
    expect(regenerated.requests[0]?.url).toBe(`${BASE}/batches/${SEEDED_BATCH_ID}/regenerate`);

    const patched = clientAnswering(planningBatch());
    await planning.patchDraft(SEEDED_BATCH_ID, "OTA-2", { selected: false }, patched.client);
    expect(patched.requests[0]?.method).toBe("PATCH");
    expect(patched.requests[0]?.url).toBe(`${BASE}/batches/${SEEDED_BATCH_ID}/drafts/OTA-2`);
    expect(await patched.requests[0]!.json()).toEqual({ selected: false });

    const pushed = clientAnswering(pushResult());
    await expect(planning.push(SEEDED_BATCH_ID, pushed.client)).resolves.toEqual(pushResult());
    expect(pushed.requests[0]?.url).toBe(`${BASE}/batches/${SEEDED_BATCH_ID}/push`);

    const resumed = clientAnswering(pushResult());
    await planning.resumePush(SEEDED_BATCH_ID, resumed.client);
    expect(resumed.requests[0]?.method).toBe("POST");
    expect(resumed.requests[0]?.url).toBe(`${BASE}/batches/${SEEDED_BATCH_ID}/push/resume`);
  });

  it("reads a source's milestones", async () => {
    const answer = { sourceId: SEEDED_GITHUB_ID, supported: true, milestones: [{ externalRef: "3", name: "Helios 2.1" }] };
    const { client, requests } = clientAnswering(answer);

    await expect(planning.milestones(SEEDED_GITHUB_ID, client)).resolves.toEqual(answer);
    expect(requests[0]?.url).toBe(`${BASE}/sources/${SEEDED_GITHUB_ID}/milestones`);
  });

  it("rejects a push the service refuses, naming its code", async () => {
    const { client } = clientAnswering(
      { code: "push_target_read_only", message: "This tracker is read-only.", details: {} },
      409,
    );

    const failure: unknown = await planning.push(SEEDED_BATCH_ID, client).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe("push_target_read_only");
  });
});
