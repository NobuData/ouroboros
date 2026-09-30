import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { FINGERPRINT, SEEDED_REPO, importPreview, importResult } from "../helpers/knowledge";

/**
 * The import sheet's two server hops (#417): the preview writes nothing, the apply quotes the
 * preview's fingerprint, and both answer a refusal as a value.
 */

/** What the API answers, per case. */
const preview = vi.fn();
const apply = vi.fn();

vi.mock("@/app/api/knowledge-import", () => ({
  knowledgeImport: {
    preview: (body: unknown) => preview(body),
    apply: (body: unknown) => apply(body),
  },
}));

const { applyImport, previewImport } = await import("@/app/knowledge/import-actions");

beforeEach(() => {
  preview.mockReset().mockResolvedValue(importPreview());
  apply.mockReset().mockResolvedValue(importResult());
});

describe("previewImport", () => {
  it("forwards the repository and answers the preview", async () => {
    await expect(previewImport({ repo: SEEDED_REPO })).resolves.toEqual({ ok: true, value: importPreview() });

    expect(preview).toHaveBeenCalledExactlyOnceWith({ repo: SEEDED_REPO });
    expect(apply).not.toHaveBeenCalled();
  });

  it("answers a refusal as a value", async () => {
    preview.mockRejectedValue(new ApiError(409, "detection_source_missing", "No source.", { repo: SEEDED_REPO }));

    await expect(previewImport({ repo: SEEDED_REPO })).resolves.toEqual({
      ok: false,
      refusal: { code: "detection_source_missing", message: "No source.", details: { repo: SEEDED_REPO } },
    });
  });
});

describe("applyImport", () => {
  it("forwards the repository and the fingerprint, and answers what was written", async () => {
    await expect(applyImport({ repo: SEEDED_REPO, fingerprint: FINGERPRINT })).resolves.toEqual({
      ok: true,
      value: importResult(),
    });

    expect(apply).toHaveBeenCalledExactlyOnceWith({ repo: SEEDED_REPO, fingerprint: FINGERPRINT });
  });

  it("answers a stale preview as a value, so the sheet can say to preview again", async () => {
    apply.mockRejectedValue(new ApiError(409, "knowledge_import_preview_stale", "Stale.", {}));

    await expect(applyImport({ repo: SEEDED_REPO, fingerprint: FINGERPRINT })).resolves.toEqual({
      ok: false,
      refusal: { code: "knowledge_import_preview_stale", message: "Stale.", details: {} },
    });
  });

  it("lets anything that is not the service's refusal travel — the redirect signal above all", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    apply.mockRejectedValue(redirect);

    await expect(applyImport({ repo: SEEDED_REPO, fingerprint: FINGERPRINT })).rejects.toBe(redirect);
  });
});
