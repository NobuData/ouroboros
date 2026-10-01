import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { SEEDED_REPO, manifest } from "../helpers/knowledge";

/**
 * The manifest preview's server hop (#421). A Server Action is a POST endpoint anybody can reach,
 * so the call takes no workspace and no person, forwards only the scope and the consumer — never
 * an override or a budget — and answers a refusal as a value.
 */

const preview = vi.fn();

vi.mock("@/app/api/context", () => ({ context: { preview: (body: unknown) => preview(body) } }));

const { previewContext } = await import("@/app/knowledge/preview-actions");

beforeEach(() => {
  preview.mockReset().mockResolvedValue(manifest("seeded"));
});

describe("previewContext", () => {
  it("asks for the consumer, the repository and the workflow — and nothing else", async () => {
    await expect(previewContext("run_stage", SEEDED_REPO, "standard-fix")).resolves.toEqual({ ok: true, value: manifest("seeded") });

    expect(preview).toHaveBeenCalledExactlyOnceWith({ consumer: "run_stage", repo: SEEDED_REPO, workflow: "standard-fix" });
  });

  it("leaves out a scope that names nothing, so the manifest is workspace-wide with no workflow", async () => {
    await previewContext("estimator", null, null);

    expect(preview).toHaveBeenCalledExactlyOnceWith({ consumer: "estimator" });
  });

  it("answers a refusal as a value, with the service's reason", async () => {
    preview.mockRejectedValue(new ApiError(404, "context_workflow_not_found", "No such workflow.", { workflow: "gone" }));

    await expect(previewContext("run_stage", null, "gone")).resolves.toEqual({
      ok: false,
      refusal: { code: "context_workflow_not_found", message: "No such workflow.", details: { workflow: "gone" } },
    });
  });

  it("lets anything that is not the service's refusal travel — the redirect signal above all", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    preview.mockRejectedValue(redirect);

    await expect(previewContext("run_stage", null, null)).rejects.toBe(redirect);
  });
});
