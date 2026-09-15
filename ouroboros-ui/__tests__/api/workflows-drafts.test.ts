import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { WORKFLOW_DRAFT_CONFLICT } from "@/app/workflows/autosave";
import { WORKFLOW_DEFINITION_INVALID } from "@/app/workflows/publish";

import { STUB_BASE_URL, clientAnswering } from "../helpers/api";
import { dryRunWalk } from "../helpers/dry-run";
import { standardFixDefinition, workflowDetail } from "../helpers/workflows";

// The facade sits on the server-side client — see `server.test.ts` for what each of these answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { workflows } = await import("@/app/api/workflows");

/**
 * The studio's S.6 share of the contract (#152): the draft save, the publish, and the dry run.
 *
 * What each call must get right on the wire: the save is a `PUT` of the whole document **guarded by the
 * etag in `If-Match`** — never `*` — the publish sends no blank note, and the dry run names the issue by id
 * and nothing about it. Each refusal arrives as the service's `ApiError`, so the flows can branch on its code.
 */

const ID = "5eed001b-0000-4000-8000-000000000001";

describe("workflows.saveDraft", () => {
  it("puts the whole document to the draft, guarded by the etag it was edited from", async () => {
    const definition = standardFixDefinition();
    const slot = { etag: "etag-2", definition, updatedAt: "2026-09-13T12:00:00.000Z" };
    const { client, requests } = clientAnswering(slot);

    await expect(workflows.saveDraft(ID, "etag-1", definition, client)).resolves.toEqual(slot);

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("PUT");
    expect(requests[0].url).toBe(`${STUB_BASE_URL}/api/v1/workflows/${ID}/draft`);
    expect(requests[0].headers.get("If-Match")).toBe("etag-1");
    expect(await requests[0].json()).toEqual({ definition });
  });

  it("rejects a stale etag with the conflict's code and details, and nothing else is sent", async () => {
    const { client, requests } = clientAnswering(
      {
        code: WORKFLOW_DRAFT_CONFLICT,
        message: "This draft was changed in the code editor. Reload it before saving again.",
        details: { expected: "etag-1", current: "etag-9", editedIn: "code" },
      },
      409,
    );

    const refused = await workflows.saveDraft(ID, "etag-1", {}, client).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(ApiError);
    expect(refused).toMatchObject({ status: 409, code: WORKFLOW_DRAFT_CONFLICT, details: { current: "etag-9" } });
    expect(requests).toHaveLength(1);
  });
});

describe("workflows.publish", () => {
  it("posts the note when there is one", async () => {
    const version = workflowDetail().version;
    const { client, requests } = clientAnswering(version);

    await expect(workflows.publish(ID, "Added the review gate.", client)).resolves.toEqual(version);

    expect(requests[0].method).toBe("POST");
    expect(requests[0].url).toBe(`${STUB_BASE_URL}/api/v1/workflows/${ID}/publish`);
    expect(await requests[0].json()).toEqual({ changeNote: "Added the review gate." });
  });

  it("posts an empty body for a publish with nothing to say, never a blank note", async () => {
    const { client, requests } = clientAnswering(workflowDetail().version);

    await workflows.publish(ID, undefined, client);

    expect(await requests[0].json()).toEqual({});
  });

  it("rejects a refused definition with its findings", async () => {
    const findings = [{ source: "engine", code: "unreachable_node", message: "Nothing reaches this node.", node: "review" }];
    const { client } = clientAnswering(
      { code: WORKFLOW_DEFINITION_INVALID, message: "This definition cannot be published yet.", details: { findings } },
      422,
    );

    await expect(workflows.publish(ID, undefined, client)).rejects.toMatchObject({
      code: WORKFLOW_DEFINITION_INVALID,
      details: { findings },
    });
  });
});

describe("workflows.dryRun", () => {
  it("posts the issue's id and nothing about it, and answers the walk", async () => {
    const walk = dryRunWalk();
    const { client, requests } = clientAnswering(walk);

    await expect(workflows.dryRun(ID, "issue-485", client)).resolves.toEqual(walk);

    expect(requests[0].method).toBe("POST");
    expect(requests[0].url).toBe(`${STUB_BASE_URL}/api/v1/workflows/${ID}/dry-run`);
    expect(await requests[0].json()).toEqual({ issueId: "issue-485" });
  });

  it("rejects an issue the workspace does not hold", async () => {
    const { client } = clientAnswering(
      { code: "workflow_dry_run_issue_not_found", message: "No such issue.", details: { issueId: "x" } },
      404,
    );

    await expect(workflows.dryRun(ID, "x", client)).rejects.toMatchObject({
      status: 404,
      code: "workflow_dry_run_issue_not_found",
    });
  });
});
