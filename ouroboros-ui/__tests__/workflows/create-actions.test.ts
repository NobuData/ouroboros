import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { workflowDetail } from "../helpers/workflows";

/**
 * The create dialog's server hop (#147).
 *
 * A Server Action is a POST endpoint anybody can reach, so the suite is written as the
 * security case first: **the call takes no workspace and no person**, so there is nothing to
 * forge — a workflow belongs to the workspace the caller's own session is acting in, and the
 * role gate is the service's. The rest is the posture: a refusal is a value the dialog draws
 * rather than a rejection that would replace the page underneath it, and the gate's redirect is
 * the one throw that must travel.
 */

/** What the API answers, per case. */
const create = vi.fn();

vi.mock("@/app/api/workflows", () => ({
  workflows: { create: (body: unknown) => create(body) },
}));

const { createWorkflow } = await import("@/app/workflows/create-actions");

/** The refusal a dialog most often meets, and the one the slug box has to draw. */
const SLUG_TAKEN = new ApiError(
  409,
  "workflow_slug_taken",
  "A workflow with that name already exists in this workspace.",
  { slug: "standard-fix" },
);

beforeEach(() => {
  create.mockReset().mockResolvedValue(
    workflowDetail({ slug: "hotfix-p1", name: "Hotfix P1", currentVersion: null, version: null }),
  );
});

describe("creating a workflow", () => {
  it("forwards the body as the dialog composed it, and nothing else", async () => {
    // No workspace, no person: the service resolves both from the session cookie this request
    // carries, and a body that could name either would be a body that could act elsewhere.
    await createWorkflow({ name: "Hotfix P1", slug: "hotfix-p1" });

    expect(create).toHaveBeenCalledExactlyOnceWith({ name: "Hotfix P1", slug: "hotfix-p1" });
  });

  it("answers with the slug the service stored, which is where the page then goes", async () => {
    // The service's, not the request's: the two agree today, and a page that navigated to what
    // it *asked for* would be wrong the day they do not.
    create.mockResolvedValue(workflowDetail({ slug: "hotfix-p1-2" }));

    await expect(createWorkflow({ name: "Hotfix P1", slug: "hotfix-p1" })).resolves.toEqual({
      ok: true,
      slug: "hotfix-p1-2",
    });
  });

  it("hands a refusal back as a value, carrying the contract's own envelope", async () => {
    create.mockRejectedValue(SLUG_TAKEN);

    await expect(createWorkflow({ name: "Standard Fix", slug: "standard-fix" })).resolves.toEqual({
      ok: false,
      refusal: {
        code: "workflow_slug_taken",
        message: "A workflow with that name already exists in this workspace.",
        details: { slug: "standard-fix" },
      },
    });
  });

  it("hands a member's refusal back the same way, having written nothing", async () => {
    // The gate that decides is the service's: a check made in the browser is a check anybody
    // can skip.
    create.mockRejectedValue(new ApiError(403, "forbidden", "Owners and admins only.", {}));

    const outcome = await createWorkflow({ name: "Hotfix P1", slug: "hotfix-p1" });

    expect(outcome).toMatchObject({ ok: false, refusal: { code: "forbidden" } });
  });

  it("lets anything that is not a refusal keep travelling", async () => {
    // Next.js's redirect signal above all — a session that expired since the page rendered
    // still reaches the login screen rather than being drawn as a failed create.
    create.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(createWorkflow({ name: "Hotfix P1", slug: "hotfix-p1" })).rejects.toThrow(
      "NEXT_REDIRECT /login",
    );
  });
});
