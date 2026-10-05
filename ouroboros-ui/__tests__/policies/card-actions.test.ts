import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import {
  HISTORY_FAILED,
  NOTHING_TO_PUBLISH,
  PREVIEW_FAILED,
  PUBLISH_FAILED,
  PUBLISH_NEEDS_OWNER,
  versionConflict,
} from "@/app/policies/card-view";

import { POLICY_V7, VERSION_7, policyPreview } from "../helpers/org-policy";

/**
 * The Autonomy policies card's Server Actions (BS.4, #494): each answers a value the card can
 * word — the service's own sentence where it gave one — and lets anything that is not the
 * service refusing keep travelling.
 */

const preview = vi.fn();
const publish = vi.fn();
const versions = vi.fn();
const pathPreview = vi.fn();

vi.mock("@/app/api/org-policy", () => ({
  orgPolicy: {
    preview: (...args: unknown[]) => preview(...args),
    publish: (...args: unknown[]) => publish(...args),
    versions: (...args: unknown[]) => versions(...args),
    pathPreview: (...args: unknown[]) => pathPreview(...args),
  },
}));

const { loadPolicyHistory, previewPolicy, previewPolicyPaths, publishPolicy } = await import(
  "@/app/policies/card-actions"
);

beforeEach(() => {
  preview.mockReset().mockResolvedValue(policyPreview());
  publish.mockReset().mockResolvedValue({ version: 8, summary: "changed spend guard (policy v8)" });
  versions.mockReset().mockResolvedValue({ items: [VERSION_7], nextBefore: null });
  pathPreview.mockReset().mockResolvedValue({ repositories: [] });
});

describe("previewPolicy", () => {
  it("answers the service's preview of the document it was given", async () => {
    expect(await previewPolicy(POLICY_V7)).toEqual({ ok: true, preview: policyPreview() });
    expect(preview).toHaveBeenCalledWith(POLICY_V7);
  });

  it("answers the service's sentence for a refusal, and its own when the service gave none", async () => {
    preview.mockRejectedValueOnce(new ApiError(422, "policy_document_invalid", "The document is not valid."));
    expect(await previewPolicy(POLICY_V7)).toEqual({ ok: false, reason: "The document is not valid." });

    preview.mockRejectedValueOnce(new ApiError(500, "internal_error", ""));
    expect(await previewPolicy(POLICY_V7)).toEqual({ ok: false, reason: PREVIEW_FAILED });
  });

  it("lets a redirect to sign in keep travelling", async () => {
    preview.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/login"));

    await expect(previewPolicy(POLICY_V7)).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

describe("publishPolicy", () => {
  it("publishes against the base version and answers the version and its audit line", async () => {
    expect(await publishPolicy(POLICY_V7, 7, "Lower the cap")).toEqual({
      ok: true,
      version: 8,
      summary: "changed spend guard (policy v8)",
    });
    expect(publish).toHaveBeenCalledWith({
      document: POLICY_V7,
      baseVersion: 7,
      changeNote: "Lower the cap",
    });
  });

  it("says which version won a race, when the service named it", async () => {
    publish.mockRejectedValueOnce(
      new ApiError(409, "policy_version_conflict", "Stale.", { baseVersion: 7, currentVersion: 8 }),
    );
    expect(await publishPolicy(POLICY_V7, 7, null)).toEqual({ ok: false, reason: versionConflict(8) });

    publish.mockRejectedValueOnce(new ApiError(409, "policy_version_conflict", "Stale."));
    expect(await publishPolicy(POLICY_V7, 7, null)).toEqual({ ok: false, reason: versionConflict(null) });
  });

  it("words a publish of nothing, and a loosening the service held to the owner", async () => {
    publish.mockRejectedValueOnce(new ApiError(422, "policy_unchanged", "Unchanged."));
    expect(await publishPolicy(POLICY_V7, 7, null)).toEqual({ ok: false, reason: NOTHING_TO_PUBLISH });

    publish.mockRejectedValueOnce(new ApiError(403, "policy_loosening_requires_owner", "Owner only."));
    expect(await publishPolicy(POLICY_V7, 7, null)).toEqual({ ok: false, reason: PUBLISH_NEEDS_OWNER });
  });

  it("answers any other refusal in the service's words, or its own", async () => {
    publish.mockRejectedValueOnce(new ApiError(403, "forbidden", "Only an owner or admin may publish."));
    expect(await publishPolicy(POLICY_V7, 7, null)).toEqual({
      ok: false,
      reason: "Only an owner or admin may publish.",
    });

    publish.mockRejectedValueOnce(new ApiError(500, "internal_error", ""));
    expect(await publishPolicy(POLICY_V7, 7, null)).toEqual({ ok: false, reason: PUBLISH_FAILED });
  });

  it("lets a redirect to sign in keep travelling", async () => {
    publish.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/login"));

    await expect(publishPolicy(POLICY_V7, 7, null)).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

describe("loadPolicyHistory", () => {
  it("reads a page, passing the cursor through", async () => {
    expect(await loadPolicyHistory()).toEqual({ ok: true, page: { items: [VERSION_7], nextBefore: null } });
    expect(versions).toHaveBeenLastCalledWith(undefined);

    await loadPolicyHistory(6);
    expect(versions).toHaveBeenLastCalledWith(6);
  });

  it("answers why the history could not be read", async () => {
    versions.mockRejectedValueOnce(new ApiError(503, "unavailable", "The service is restarting."));
    expect(await loadPolicyHistory()).toEqual({ ok: false, reason: "The service is restarting." });

    versions.mockRejectedValueOnce(new ApiError(500, "internal_error", ""));
    expect(await loadPolicyHistory()).toEqual({ ok: false, reason: HISTORY_FAILED });
  });
});

describe("previewPolicyPaths", () => {
  it("answers each repository's matches", async () => {
    const repositories = [
      {
        repository: "acme/helios-firmware",
        status: "listed",
        reason: null,
        fileCount: 412,
        truncated: false,
        globs: [{ glob: "boot/**", matchCount: 9, samples: ["boot/start.S"] }],
      },
    ];
    pathPreview.mockResolvedValueOnce({ repositories });

    expect(await previewPolicyPaths(["boot/**"])).toEqual({ ok: true, repositories });
    expect(pathPreview).toHaveBeenCalledWith(["boot/**"]);
  });

  it("answers why there is no preview, without failing the editor", async () => {
    pathPreview.mockRejectedValueOnce(new ApiError(403, "forbidden", "Only an owner or admin may preview."));

    expect(await previewPolicyPaths(["boot/**"])).toEqual({
      ok: false,
      reason: "Only an owner or admin may preview.",
    });
  });
});
