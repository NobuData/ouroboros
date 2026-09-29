import { describe, expect, it, vi } from "vitest";

import { clientAnswering } from "../helpers/api";
import { SEEDED_RUN_ID } from "../helpers/runs";
import {
  BUILD_3_ID,
  CORRECTION_NOTE,
  OVERSHOOT_CASE,
  classifyResult,
  intents,
  waiver,
} from "../helpers/test-results";

// The facade sits on the server-side client — see `server.test.ts`.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { testResults } = await import("@/app/api/test-results");

/**
 * Mark & Route's three writes (#340), against the contract: each asks the operation it names,
 * with the body it was given, and a refusal is the service's envelope.
 */

/** The service's origin in these suites. */
const ORIGIN = "http://rest.test:4000";

describe("testResults.classify", () => {
  it("posts the decision to the case the ids name, and answers what routing did", async () => {
    const { client, requests } = clientAnswering(classifyResult(), 201);
    const decision = { class: "product_bug", note: CORRECTION_NOTE } as const;

    expect(
      await testResults.classify(BUILD_3_ID, OVERSHOOT_CASE.caseId, decision, client),
    ).toEqual(classifyResult());
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe(
      `${ORIGIN}/api/v1/test-runs/${BUILD_3_ID}/cases/${OVERSHOOT_CASE.caseId}/classify`,
    );
    expect(await requests[0]?.json()).toEqual(decision);
  });

  it("rejects with the service's envelope for a correction round with no correction", async () => {
    const { client } = clientAnswering(
      {
        code: "classification_note_required",
        message: "Say what the next attempt should do differently.",
        details: { field: "note" },
      },
      422,
    );

    await expect(
      testResults.classify(BUILD_3_ID, OVERSHOOT_CASE.caseId, { class: "product_bug" }, client),
    ).rejects.toMatchObject({ status: 422, code: "classification_note_required" });
  });
});

describe("testResults.waive", () => {
  it("posts the reason and the cases to the attempt the id names", async () => {
    const { client, requests } = clientAnswering(waiver(), 201);
    const request = { reason: "Known rig drift.", caseIds: [OVERSHOOT_CASE.caseId] };

    expect(await testResults.waive(BUILD_3_ID, request, client)).toEqual(waiver());
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe(`${ORIGIN}/api/v1/test-runs/${BUILD_3_ID}/waivers`);
    expect(await requests[0]?.json()).toEqual(request);
  });

  it("rejects with the service's 403 for anyone but an owner or an admin", async () => {
    const { client } = clientAnswering(
      { code: "forbidden", message: "Only an owner or admin may waive.", details: {} },
      403,
    );

    await expect(testResults.waive(BUILD_3_ID, { reason: "r" }, client)).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
  });
});

describe("testResults.setIntents", () => {
  it("puts the toggle on the run the id names, and answers both as stored", async () => {
    const { client, requests } = clientAnswering(intents({ blockUntilGreen: false }));

    expect(
      await testResults.setIntents(SEEDED_RUN_ID, { blockUntilGreen: false }, client),
    ).toEqual(intents({ blockUntilGreen: false }));
    expect(requests[0]?.method).toBe("PUT");
    expect(requests[0]?.url).toBe(`${ORIGIN}/api/v1/runs/${SEEDED_RUN_ID}/pr-intents`);
    expect(await requests[0]?.json()).toEqual({ blockUntilGreen: false });
  });

  it("rejects with the service's envelope for a request naming neither toggle", async () => {
    const { client } = clientAnswering(
      { code: "pr_intents_empty", message: "Name the toggle to set.", details: {} },
      422,
    );

    await expect(testResults.setIntents(SEEDED_RUN_ID, {}, client)).rejects.toMatchObject({
      status: 422,
      code: "pr_intents_empty",
    });
  });
});
