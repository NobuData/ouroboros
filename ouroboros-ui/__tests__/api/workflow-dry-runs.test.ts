import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { STUB_BASE_URL, clientAnswering } from "../helpers/api";
import { DRY_RUN_ID, SECURITY_PATCH_ID, seededDryRun, seededHistory, seededSuggestions } from "../helpers/workflow-copilot";

// The facade sits on the server-side client — see `server.test.ts` for what each of these answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { workflowDryRuns } = await import("@/app/api/workflow-dry-runs");

/**
 * The dry-run card's three server reads on the wire (CE.4, #568): each asks the path the
 * contract names with the workflow's **id** and the run's, and a refusal stays an `ApiError` for
 * the route's `attempt` to make a reading of.
 */

const BASE = `${STUB_BASE_URL}/api/v1/workflows/${SECURITY_PATCH_ID}/dry-runs`;

describe("workflowDryRuns", () => {
  it("reads the history by the workflow's id", async () => {
    const { client, requests } = clientAnswering(seededHistory());

    await expect(workflowDryRuns.history(SECURITY_PATCH_ID, client)).resolves.toEqual(seededHistory());

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("GET");
    expect(requests[0].url).toBe(BASE);
  });

  it("reads one run by both ids, with its replayed row's estimate as served", async () => {
    const { client, requests } = clientAnswering(seededDryRun());

    const run = await workflowDryRuns.read(SECURITY_PATCH_ID, DRY_RUN_ID, client);

    expect(requests[0].url).toBe(`${BASE}/${DRY_RUN_ID}`);
    expect(run.stages[3].estimate).toMatchObject({ status: "estimated", sampleCount: 217 });
    expect(run.stages[0].estimate).toBeNull();
  });

  it("reads a run's suggestions by both ids", async () => {
    const answer = { dryRunId: DRY_RUN_ID, suggestions: seededSuggestions() };
    const { client, requests } = clientAnswering(answer);

    await expect(workflowDryRuns.suggestions(SECURITY_PATCH_ID, DRY_RUN_ID, client)).resolves.toEqual(answer);

    expect(requests[0].method).toBe("GET");
    expect(requests[0].url).toBe(`${BASE}/${DRY_RUN_ID}/suggestions`);
  });

  it("rejects with the service's refusal for a run this workflow does not have", async () => {
    const { client } = clientAnswering({ code: "dry_run_not_found", message: "This workflow has no such dry run.", details: {} }, 404);

    const refused = await workflowDryRuns.read(SECURITY_PATCH_ID, DRY_RUN_ID, client).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(ApiError);
    expect(refused).toMatchObject({ status: 404, code: "dry_run_not_found" });
  });
});
