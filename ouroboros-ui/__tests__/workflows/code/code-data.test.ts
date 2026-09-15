import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Workspace } from "@/app/api/access";
import { ApiError } from "@/app/api/errors";

import { CODE_SYMBOLS } from "../../helpers/code-symbols";
import { TENANT_ID, membership, sessionUser } from "../../helpers/login";
import {
  UNPROJECTABLE_REFUSAL,
  codeChecks as codeChecksFixture,
  codeConfig,
  codeTreeFor,
  explorerReadings,
  panelReadings,
  workflowCode,
} from "../../helpers/workflow-code";
import { seededRail } from "../../helpers/workflows";

/**
 * The code route's reader (V.1, #169; the explorer, V.3, #171).
 *
 * The visual editor's reader's four properties, kept on the code route — **a refused read is a
 * value**, **anything that is not a refusal keeps travelling**, **one failed read is one degraded
 * region**, **the slug is resolved against the rail** — and two of its own: a `409
 * workflow_code_unprojectable` is kept apart from every other refusal, with its findings, because
 * the page guides a reader out of it rather than offering a retry; and the explorer's two reads
 * are made exactly when an explorer is drawn.
 */

vi.mock("server-only", () => ({}));

/** What the rail endpoint answers this case with. */
const list = vi.fn();

/** What the file endpoint answers this case with, keyed by the slug it was asked for. */
const code = vi.fn();

/** What the explorer's file list answers. */
const tree = vi.fn();

/** What `ouroboros.config.ts` answers. */
const config = vi.fn();

/** What the Loop Checks endpoint answers, keyed by the slug it was asked for. */
const codeChecks = vi.fn();

/** What the symbol table endpoint answers. */
const codeSymbols = vi.fn();

vi.mock("@/app/api/workflows", () => ({
  WORKFLOW_CODE_UNPROJECTABLE: "workflow_code_unprojectable",
  workflows: {
    list: () => list(),
    code: (slug: string) => code(slug),
    tree: () => tree(),
    config: () => config(),
    codeChecks: (slug: string) => codeChecks(slug),
    codeSymbols: () => codeSymbols(),
  },
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
  tree.mockReset().mockResolvedValue(codeTreeFor());
  config.mockReset().mockResolvedValue(codeConfig());
  codeChecks.mockReset().mockResolvedValue(codeChecksFixture());
  codeSymbols.mockReset().mockResolvedValue(CODE_SYMBOLS);
});

describe("a workflow the rail holds", () => {
  it("reads the rail, then the file by its slug and the explorer, and hands back all three", async () => {
    const readings = await readStudioCode(ACCESS, "standard-fix");

    expect(code).toHaveBeenCalledExactlyOnceWith("standard-fix");
    expect(tree).toHaveBeenCalledOnce();
    expect(config).toHaveBeenCalledOnce();
    expect(readings).toEqual({
      rail: { ok: true, value: seededRail() },
      requested: "standard-fix",
      selected: { entry: seededRail()[0], file: { kind: "file", file: workflowCode() } },
      explorer: explorerReadings(),
      panel: panelReadings(),
    });
  });

  it("reads the right panel — the workflow's Loop Checks by its slug, and the symbol table (V.5)", async () => {
    await readStudioCode(ACCESS, "standard-fix");

    expect(codeChecks).toHaveBeenCalledExactlyOnceWith("standard-fix");
    expect(codeSymbols).toHaveBeenCalledOnce();
  });

  it("reads the panel in parallel with the file, not after it", async () => {
    let releaseFile: (value: unknown) => void = () => {};
    code.mockReturnValue(new Promise((resolve) => (releaseFile = resolve)));

    const pending = readStudioCode(ACCESS, "standard-fix");
    await vi.waitFor(() => expect(codeChecks).toHaveBeenCalledOnce());
    expect(codeSymbols).toHaveBeenCalledOnce();

    releaseFile(workflowCode());
    await expect(pending).resolves.toMatchObject({ panel: panelReadings() });
  });

  it("reads the draft's file, whose etag is the canvas's — one draft, two editors", async () => {
    const readings = await readStudioCode(ACCESS, "standard-fix");

    expect(readings.selected?.file.kind === "file" && readings.selected.file.file.version).toBeNull();
  });

  it("reads the file and the explorer in parallel, not one after the other", async () => {
    let releaseFile: (value: unknown) => void = () => {};
    code.mockReturnValue(new Promise((resolve) => (releaseFile = resolve)));

    const pending = readStudioCode(ACCESS, "standard-fix");
    // The file has not answered, and the explorer has already been asked.
    await vi.waitFor(() => expect(tree).toHaveBeenCalledOnce());
    expect(config).toHaveBeenCalledOnce();

    releaseFile(workflowCode());
    await expect(pending).resolves.toMatchObject({ explorer: explorerReadings() });
  });
});

describe("a slug the rail does not hold", () => {
  it("costs no file request, selects nothing, and still reads the explorer to leave by", async () => {
    const readings = await readStudioCode(ACCESS, "retired-loop");

    expect(code).not.toHaveBeenCalled();
    expect(codeChecks).not.toHaveBeenCalled();
    expect(codeSymbols).not.toHaveBeenCalled();
    expect(readings).toEqual({
      rail: { ok: true, value: seededRail() },
      requested: "retired-loop",
      selected: null,
      explorer: explorerReadings(),
      panel: null,
    });
  });
});

describe("a refused rail", () => {
  it("is a value, asks for no file and no explorer, and keeps the service's reason", async () => {
    list.mockRejectedValue(new ApiError(503, "unavailable", "The service is unavailable."));

    const readings = await readStudioCode(ACCESS, "standard-fix");

    expect(code).not.toHaveBeenCalled();
    expect(tree).not.toHaveBeenCalled();
    expect(config).not.toHaveBeenCalled();
    expect(codeChecks).not.toHaveBeenCalled();
    expect(codeSymbols).not.toHaveBeenCalled();
    expect(readings.rail).toEqual({ ok: false, reason: "The service is unavailable." });
    expect(readings.selected).toBeNull();
    expect(readings.explorer).toBeNull();
    expect(readings.panel).toBeNull();
  });

  it("lets anything that is not a refusal keep travelling — the redirect signal above all", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    list.mockRejectedValue(redirect);

    await expect(readStudioCode(ACCESS, "standard-fix")).rejects.toBe(redirect);
  });
});

describe("a workspace with no workflows", () => {
  it("asks for no explorer — its page draws none", async () => {
    list.mockResolvedValue([]);

    const readings = await readStudioCode(ACCESS, "standard-fix");

    expect(tree).not.toHaveBeenCalled();
    expect(config).not.toHaveBeenCalled();
    expect(readings).toEqual({
      rail: { ok: true, value: [] },
      requested: "standard-fix",
      selected: null,
      explorer: null,
      panel: null,
    });
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
    expect(readings.explorer).toEqual(explorerReadings());
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

describe("a refused panel read (V.5)", () => {
  it("is a value on the Loop Checks alone, and the file and the symbol table still read", async () => {
    codeChecks.mockRejectedValue(new ApiError(500, "internal_error", "The checks are unavailable."));

    const readings = await readStudioCode(ACCESS, "standard-fix");

    expect(readings.panel).toEqual({
      checks: { ok: false, reason: "The checks are unavailable." },
      symbols: { ok: true, value: CODE_SYMBOLS },
    });
    expect(readings.selected?.file).toEqual({ kind: "file", file: workflowCode() });
  });

  it("is a value on the symbol table alone when that is the read refused", async () => {
    codeSymbols.mockRejectedValue(new ApiError(503, "unavailable", "The symbol table is unavailable."));

    const readings = await readStudioCode(ACCESS, "standard-fix");

    expect(readings.panel?.checks).toEqual({ ok: true, value: codeChecksFixture() });
    expect(readings.panel?.symbols).toEqual({ ok: false, reason: "The symbol table is unavailable." });
  });

  it("lets anything that is not a refusal keep travelling", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    codeChecks.mockRejectedValue(redirect);

    await expect(readStudioCode(ACCESS, "standard-fix")).rejects.toBe(redirect);
  });
});

describe("a refused explorer read", () => {
  it("is a value on its own region — the file list — and the rest still reads", async () => {
    tree.mockRejectedValue(new ApiError(500, "internal_error", "The file list is unavailable."));

    const readings = await readStudioCode(ACCESS, "standard-fix");

    expect(readings.explorer).toEqual({
      tree: { ok: false, reason: "The file list is unavailable." },
      config: { ok: true, value: codeConfig() },
    });
    expect(readings.selected?.file).toEqual({ kind: "file", file: workflowCode() });
  });

  it("is a value on the configuration alone when that is the read refused", async () => {
    config.mockRejectedValue(new ApiError(500, "internal_error", "The configuration is unavailable."));

    const readings = await readStudioCode(ACCESS, "standard-fix");

    expect(readings.explorer?.tree).toEqual({ ok: true, value: codeTreeFor() });
    expect(readings.explorer?.config).toEqual({ ok: false, reason: "The configuration is unavailable." });
  });

  it("lets anything that is not a refusal keep travelling", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    config.mockRejectedValue(redirect);

    await expect(readStudioCode(ACCESS, "standard-fix")).rejects.toBe(redirect);
  });
});
