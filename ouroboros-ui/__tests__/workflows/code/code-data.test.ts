import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Workspace } from "@/app/api/access";
import { ApiError } from "@/app/api/errors";

import { TENANT_ID, membership, sessionUser } from "../../helpers/login";
import { UNPROJECTABLE_REFUSAL, workflowCode } from "../../helpers/workflow-code";
import { seededRail } from "../../helpers/workflows";

/**
 * The code route's reader (V.1, #169).
 *
 * The visual editor's reader's four properties, kept on the code route — **a refused read is a
 * value**, **anything that is not a refusal keeps travelling**, **one failed read is one degraded
 * region**, **the slug is resolved against the rail** — and one of its own: a `409
 * workflow_code_unprojectable` is kept apart from every other refusal, with its findings, because
 * the page guides a reader out of it rather than offering a retry.
 */

vi.mock("server-only", () => ({}));

/** What the rail endpoint answers this case with. */
const list = vi.fn();

/** What the file endpoint answers this case with, keyed by the slug it was asked for. */
const code = vi.fn();

vi.mock("@/app/api/workflows", () => ({
  WORKFLOW_CODE_UNPROJECTABLE: "workflow_code_unprojectable",
  workflows: { list: () => list(), code: (slug: string) => code(slug) },
}));

const { readStudioCode } = await import("@/app/workflows/code/code-data");

/** The workspace the gate hands over — typed as the gate's own return, for `data.test.ts`'s reason. */
const ACCESS: Workspace = {
  session: {
    user: sessionUser(),
    memberships: [membership()],
    membershipTotal: 1,
    activeOrganizationId: TENANT_ID,
    tenantSuggestion: null,
  },
  membership: membership(),
};

beforeEach(() => {
  list.mockReset().mockResolvedValue(seededRail());
  code.mockReset().mockResolvedValue(workflowCode());
});

describe("a workflow the rail holds", () => {
  it("reads the rail, then the file by its slug, and hands back both", async () => {
    const readings = await readStudioCode(ACCESS, "standard-fix");

    expect(code).toHaveBeenCalledExactlyOnceWith("standard-fix");
    expect(readings).toEqual({
      rail: { ok: true, value: seededRail() },
      requested: "standard-fix",
      selected: { entry: seededRail()[0], file: { kind: "file", file: workflowCode() } },
    });
  });

  it("reads the draft's file, whose etag is the canvas's — one draft, two editors", async () => {
    const readings = await readStudioCode(ACCESS, "standard-fix");

    expect(readings.selected?.file.kind === "file" && readings.selected.file.file.version).toBeNull();
  });
});

describe("a slug the rail does not hold", () => {
  it("costs no file request and selects nothing", async () => {
    const readings = await readStudioCode(ACCESS, "retired-loop");

    expect(code).not.toHaveBeenCalled();
    expect(readings).toEqual({
      rail: { ok: true, value: seededRail() },
      requested: "retired-loop",
      selected: null,
    });
  });
});

describe("a refused rail", () => {
  it("is a value, asks for no file, and keeps the service's reason", async () => {
    list.mockRejectedValue(new ApiError(503, "unavailable", "The service is unavailable."));

    const readings = await readStudioCode(ACCESS, "standard-fix");

    expect(code).not.toHaveBeenCalled();
    expect(readings.rail).toEqual({ ok: false, reason: "The service is unavailable." });
    expect(readings.selected).toBeNull();
  });

  it("lets anything that is not a refusal keep travelling — the redirect signal above all", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    list.mockRejectedValue(redirect);

    await expect(readStudioCode(ACCESS, "standard-fix")).rejects.toBe(redirect);
  });
});

describe("a refused file", () => {
  it("keeps a draft with no spelling as code apart, with the service's sentence and findings", async () => {
    code.mockRejectedValue(
      new ApiError(
        409,
        UNPROJECTABLE_REFUSAL.code,
        UNPROJECTABLE_REFUSAL.message,
        UNPROJECTABLE_REFUSAL.details,
      ),
    );

    const readings = await readStudioCode(ACCESS, "standard-fix");

    expect(readings.selected?.file).toEqual({
      kind: "unprojectable",
      reason: UNPROJECTABLE_REFUSAL.message,
      findings: [
        { message: "This property is required.", node: null, path: "/dsl_version" },
        { message: "A model stage needs a route.", node: "implement", path: "/nodes/1/config" },
      ],
    });
    // The rail entry stands, so the head still names the file and Publish still counts.
    expect(readings.selected?.entry).toEqual(seededRail()[0]);
  });

  it("is a failed reading for any other refusal, with the service's sentence", async () => {
    code.mockRejectedValue(new ApiError(500, "internal_error", "Something went wrong."));

    const readings = await readStudioCode(ACCESS, "standard-fix");

    expect(readings.selected?.file).toEqual({ kind: "failed", reason: "Something went wrong." });
  });

  it("is failed, not unprojectable, for a 409 with another code", async () => {
    code.mockRejectedValue(new ApiError(409, "workflow_draft_conflict", "Someone saved first."));

    const readings = await readStudioCode(ACCESS, "standard-fix");

    expect(readings.selected?.file.kind).toBe("failed");
  });

  it("lets anything that is not a refusal keep travelling", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    code.mockRejectedValue(redirect);

    await expect(readStudioCode(ACCESS, "standard-fix")).rejects.toBe(redirect);
  });
});
