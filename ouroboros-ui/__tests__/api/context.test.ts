import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { STUB_BASE_URL, clientAnswering } from "../helpers/api";
import { SEEDED_REPO, manifest } from "../helpers/knowledge";

// The facade sits on the server-side client — see `server.test.ts` for what each of these
// three answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { context } = await import("@/app/api/context");

/**
 * The context-assembly facade (#421): one call, the preview — the scope and the consumer posted
 * as they are, naming no workspace, answering BF.5's manifest untouched.
 */

describe("context.preview", () => {
  it("posts the consumer and the scope, naming no workspace, and answers the manifest as sent", async () => {
    const { client, requests } = clientAnswering(manifest("workflowOverride"));
    const body = { consumer: "run_stage" as const, repo: SEEDED_REPO, workflow: "standard-fix" };

    expect(await context.preview(body, client)).toEqual(manifest("workflowOverride"));
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/knowledge/context/preview`);
    expect(requests[0]?.method).toBe("POST");
    expect(await requests[0]?.json()).toEqual(body);
    expect(requests[0]?.headers.get("x-ouro-tenant")).toBeNull();
  });

  it("asks for a workspace-wide manifest with the consumer alone", async () => {
    const { client, requests } = clientAnswering(manifest("workspaceWide"));

    await context.preview({ consumer: "estimator" }, client);

    expect(await requests[0]?.json()).toEqual({ consumer: "estimator" });
  });

  it("answers a workflow the workspace does not have as the service's error", async () => {
    const { client } = clientAnswering(
      { code: "context_workflow_not_found", message: "No such workflow.", details: { workflow: "gone" } },
      404,
    );

    const error = await context.preview({ consumer: "run_stage", workflow: "gone" }, client).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: "context_workflow_not_found", details: { workflow: "gone" } });
  });
});
