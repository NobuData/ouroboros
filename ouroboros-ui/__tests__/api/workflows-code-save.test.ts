import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { WORKFLOW_DRAFT_CONFLICT } from "@/app/workflows/autosave";
import { WORKFLOW_CODE_INVALID } from "@/app/workflows/code/code-save";

import { STUB_BASE_URL, clientAnswering } from "../helpers/api";
import { workflowCode } from "../helpers/workflow-code";

// The facade sits on the server-side client — see `server.test.ts` for what each of these answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { workflows } = await import("@/app/api/workflows");

/**
 * The code editor's save on U.3's contract (V.4, #172).
 *
 * What the call must get right on the wire: a `PUT` of the whole file to the workflow's code, **guarded by
 * the etag in `If-Match`** — never `*` — so a stale one is a conflict rather than an overwrite. Each refusal
 * arrives as the service's `ApiError`, so the save loop can branch on its code.
 */

describe("workflows.saveCode", () => {
  it("puts the whole file to the workflow's code, guarded by the etag it was typed over", async () => {
    const file = workflowCode({ etag: "etag-2" });
    const { client, requests } = clientAnswering(file);

    await expect(workflows.saveCode("standard-fix", "etag-1", "the file\n", client)).resolves.toEqual(file);

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("PUT");
    expect(requests[0].url).toBe(`${STUB_BASE_URL}/api/v1/workflows/standard-fix/code`);
    expect(requests[0].headers.get("If-Match")).toBe("etag-1");
    expect(await requests[0].json()).toEqual({ text: "the file\n" });
  });

  it("restores the file's always-null outline reference, as the read does", async () => {
    const { outlineRef, ...served } = workflowCode({ etag: "etag-2" });
    const { client } = clientAnswering(served);

    await expect(workflows.saveCode("standard-fix", "etag-1", "text", client)).resolves.toMatchObject({
      outlineRef,
      etag: "etag-2",
    });
  });

  it("rejects a file that does not parse with its diagnostics, and nothing else is sent", async () => {
    const details = {
      errors: [{ code: "code_syntax_error", message: "Expected a value.", line: 4, column: 8, endLine: 4, endColumn: 11 }],
      diagnostics: [
        {
          severity: "error",
          range: { line: 4, column: 8, endLine: 4, endColumn: 11 },
          code: "code_syntax_error",
          message: "Expected a value.",
        },
      ],
    };
    const { client, requests } = clientAnswering(
      { code: WORKFLOW_CODE_INVALID, message: "This file does not read as a workflow.", details },
      422,
    );

    const refused = await workflows.saveCode("standard-fix", "etag-1", "typo", client).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(ApiError);
    expect(refused).toMatchObject({ status: 422, code: WORKFLOW_CODE_INVALID, details });
    expect(requests).toHaveLength(1);
  });

  it("rejects a stale etag with the conflict, naming the editor that changed the draft", async () => {
    const { client } = clientAnswering(
      {
        code: WORKFLOW_DRAFT_CONFLICT,
        message: "This draft was changed in the visual editor. Reload it before saving again.",
        details: { expected: "etag-1", current: "etag-9", editedIn: "visual", updatedAt: "2026-09-15T11:59:00.000Z" },
      },
      409,
    );

    const refused = await workflows.saveCode("standard-fix", "etag-1", "text", client).catch((error: unknown) => error);

    expect(refused).toMatchObject({ status: 409, code: WORKFLOW_DRAFT_CONFLICT, details: { editedIn: "visual" } });
  });
});
