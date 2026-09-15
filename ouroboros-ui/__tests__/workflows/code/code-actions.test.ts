import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { codeValidation, workflowCode } from "../../helpers/workflow-code";

/**
 * The code editor's save hop (V.4, #172).
 *
 * The security case first, as `draft-actions.test.ts` writes it: **the call takes no workspace and no
 * person**, so there is nothing to forge — it passes the slug, the etag and the text through to the
 * service, which decides. Then the posture: a refusal is a value the page draws, and anything that is not
 * an `ApiError` keeps travelling.
 */

const saveCodeCall = vi.fn();
const validateCodeCall = vi.fn();

vi.mock("@/app/api/workflows", () => ({
  workflows: {
    saveCode: (...args: unknown[]) => saveCodeCall(...args),
    validateCode: (...args: unknown[]) => validateCodeCall(...args),
  },
}));

const { saveCode, validateCode } = await import("@/app/workflows/code/code-actions");

beforeEach(() => {
  saveCodeCall.mockReset();
  validateCodeCall.mockReset();
});

describe("validateCode (V.6, #174)", () => {
  it("passes the slug and nothing else through, and answers the gate's verdict", async () => {
    const validation = codeValidation();
    validateCodeCall.mockResolvedValue(validation);

    await expect(validateCode("standard-fix")).resolves.toEqual({ ok: true, value: validation });
    expect(validateCodeCall).toHaveBeenCalledExactlyOnceWith("standard-fix");
  });

  it("answers an engine that could not check the file as a refusal the page draws", async () => {
    validateCodeCall.mockRejectedValue(new ApiError(502, "engine_unavailable", "The engine is down.", {}));

    await expect(validateCode("standard-fix")).resolves.toEqual({
      ok: false,
      refusal: { code: "engine_unavailable", message: "The engine is down.", details: {} },
    });
  });

  it("lets anything that is not an ApiError travel — the redirect signal above all", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    validateCodeCall.mockRejectedValue(redirect);

    await expect(validateCode("standard-fix")).rejects.toBe(redirect);
  });
});

describe("saveCode", () => {
  it("passes the slug, the etag and the whole text through, and answers the file as the draft now reads", async () => {
    const file = workflowCode({ etag: "etag-2" });
    saveCodeCall.mockResolvedValue(file);

    await expect(saveCode("standard-fix", "etag-1", "the file\n")).resolves.toEqual({ ok: true, value: file });
    expect(saveCodeCall).toHaveBeenCalledExactlyOnceWith("standard-fix", "etag-1", "the file\n");
  });

  it("answers a file that does not parse as a refusal carrying its diagnostics", async () => {
    const details = { errors: [], diagnostics: [{ severity: "error", message: "Expected a value." }] };
    saveCodeCall.mockRejectedValue(new ApiError(422, "workflow_code_invalid", "This file does not read.", details));

    await expect(saveCode("standard-fix", "etag-1", "typo")).resolves.toEqual({
      ok: false,
      refusal: { code: "workflow_code_invalid", message: "This file does not read.", details },
    });
  });

  it("answers a stale etag as the conflict refusal, naming the editor that won", async () => {
    saveCodeCall.mockRejectedValue(
      new ApiError(409, "workflow_draft_conflict", "Changed in the visual editor.", { current: "etag-9", editedIn: "visual" }),
    );

    await expect(saveCode("standard-fix", "etag-1", "text")).resolves.toMatchObject({
      ok: false,
      refusal: { code: "workflow_draft_conflict", details: { editedIn: "visual" } },
    });
  });

  it("lets anything that is not an ApiError travel — the redirect signal above all", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    saveCodeCall.mockRejectedValue(redirect);

    await expect(saveCode("standard-fix", "etag-1", "text")).rejects.toBe(redirect);
  });
});
