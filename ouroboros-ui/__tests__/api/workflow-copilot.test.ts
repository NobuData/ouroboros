import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { STUB_BASE_URL, clientAnswering } from "../helpers/api";
import {
  NO_GATEWAY,
  SECURITY_PATCH_ID,
  copilotConversation,
  copilotPromotion,
  copilotReadiness,
  copilotSession,
} from "../helpers/workflow-copilot";

// The facade sits on the server-side client — see `server.test.ts` for what each of these answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { COPILOT_SESSION_NOT_FOUND, workflowCopilot } = await import("@/app/api/workflow-copilot");

/**
 * The copilot's promote gate on the wire (CE.1, #565): the three operations beneath one workflow.
 *
 * What each call must get right: the path the contract names, with the workflow's **id**; no body
 * on the discard, because what is discarded is the service's to decide; and the one refusal that
 * is a state rather than a failure — `404 copilot_session_not_found` — handed back as `null`
 * while every other refusal stays an `ApiError`.
 */

const BASE = `${STUB_BASE_URL}/api/v1/workflows/${SECURITY_PATCH_ID}/copilot`;

describe("workflowCopilot.promotion", () => {
  it("reads the promotion summary by the workflow's id", async () => {
    const { client, requests } = clientAnswering(copilotPromotion());

    await expect(workflowCopilot.promotion(SECURITY_PATCH_ID, client)).resolves.toEqual(copilotPromotion());

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("GET");
    expect(requests[0].url).toBe(`${BASE}/promotion`);
  });

  it("rejects with the service's refusal for a workflow this workspace does not have", async () => {
    const { client } = clientAnswering({ code: "workflow_not_found", message: "No such workflow.", details: {} }, 404);

    const refused = await workflowCopilot.promotion(SECURITY_PATCH_ID, client).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(ApiError);
    expect(refused).toMatchObject({ status: 404, code: "workflow_not_found" });
  });
});

describe("workflowCopilot.readiness", () => {
  it("reads the readiness by the workflow's id", async () => {
    const { client, requests } = clientAnswering(NO_GATEWAY);

    await expect(workflowCopilot.readiness(SECURITY_PATCH_ID, client)).resolves.toEqual(NO_GATEWAY);

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("GET");
    expect(requests[0].url).toBe(`${BASE}/readiness`);
  });

  it("hands back a ready copilot as the service serves it — the route's alias and model, no dry run", async () => {
    const { client } = clientAnswering(copilotReadiness());

    await expect(workflowCopilot.readiness(SECURITY_PATCH_ID, client)).resolves.toMatchObject({
      gateway: { available: true },
      route: { taskKind: "copilot-workflow", resolved: true, alias: "coder-max", reason: null },
      dryRun: null,
    });
  });

  it("rejects with the service's refusal for a workflow this workspace does not have", async () => {
    const { client } = clientAnswering({ code: "workflow_not_found", message: "No such workflow.", details: {} }, 404);

    const refused = await workflowCopilot.readiness(SECURITY_PATCH_ID, client).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(ApiError);
    expect(refused).toMatchObject({ status: 404, code: "workflow_not_found" });
  });
});

describe("workflowCopilot.conversation", () => {
  it("reads the conversation by the workflow's id", async () => {
    const { client, requests } = clientAnswering(copilotConversation());

    await expect(workflowCopilot.conversation(SECURITY_PATCH_ID, client)).resolves.toEqual(copilotConversation());

    expect(requests[0].method).toBe("GET");
    expect(requests[0].url).toBe(`${BASE}/conversation`);
  });

  it("answers null for a workflow that never had a conversation — a state, not a failure", async () => {
    const { client } = clientAnswering(
      { code: COPILOT_SESSION_NOT_FOUND, message: "This workflow has no copilot conversation.", details: {} },
      404,
    );

    await expect(workflowCopilot.conversation(SECURITY_PATCH_ID, client)).resolves.toBeNull();
    expect(COPILOT_SESSION_NOT_FOUND).toBe("copilot_session_not_found");
  });

  it("does not fold a missing workflow into null — that 404 is a different fact", async () => {
    const { client } = clientAnswering({ code: "workflow_not_found", message: "No such workflow.", details: {} }, 404);

    const refused = await workflowCopilot.conversation(SECURITY_PATCH_ID, client).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(ApiError);
    expect(refused).toMatchObject({ status: 404, code: "workflow_not_found" });
  });
});

describe("workflowCopilot.discard", () => {
  it("posts to the discard with no body — what is discarded is the service's to decide", async () => {
    const result = {
      workflowId: SECURITY_PATCH_ID,
      draftDiscarded: true,
      session: copilotSession({ status: "discarded", closedAt: "2026-09-13T11:00:00.000Z" }),
    };
    const { client, requests } = clientAnswering(result);

    await expect(workflowCopilot.discard(SECURITY_PATCH_ID, client)).resolves.toEqual(result);

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("POST");
    expect(requests[0].url).toBe(`${BASE}/discard`);
    expect(await requests[0].text()).toBe("");
  });

  it.each([
    [409, "copilot_nothing_to_discard"],
    [409, "dry_run_in_progress"],
    [403, "forbidden"],
  ])("rejects a %i %s as the service's ApiError, for the dialog to say in words", async (status, code) => {
    const { client } = clientAnswering({ code, message: "Refused.", details: {} }, status);

    const refused = await workflowCopilot.discard(SECURITY_PATCH_ID, client).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(ApiError);
    expect(refused).toMatchObject({ status, code });
  });
});
