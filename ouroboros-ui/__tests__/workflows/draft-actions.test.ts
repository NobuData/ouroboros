import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { standardFixDefinition, workflowDetail } from "../helpers/workflows";

/**
 * The draft, publish and dry-run flows' server hops (#152).
 *
 * The security case first, as `create-actions.test.ts` writes it: **no call takes a workspace or a
 * person**, so there is nothing to forge. Then the posture: a refusal is a value the page draws, and
 * anything that is not an `ApiError` — Next.js's redirect signal above all — keeps travelling.
 */

const saveDraftCall = vi.fn();
const publishCall = vi.fn();
const dryRunCall = vi.fn();
const listCall = vi.fn();

vi.mock("@/app/api/workflows", () => ({
  workflows: {
    saveDraft: (...args: unknown[]) => saveDraftCall(...args),
    publish: (...args: unknown[]) => publishCall(...args),
    dryRun: (...args: unknown[]) => dryRunCall(...args),
  },
}));
vi.mock("@/app/api/backlog", () => ({ backlog: { list: (...args: unknown[]) => listCall(...args) } }));

const { dryRunWorkflow, publishWorkflow, saveDraft, sizedTickets } = await import("@/app/workflows/draft-actions");

const ID = "5eed001b-0000-4000-8000-000000000001";

/** The refusal a stale autosave gets. */
const CONFLICT = new ApiError(409, "workflow_draft_conflict", "This draft was changed in another tab.", {
  expected: "a",
  current: "b",
  editedIn: "visual",
});

beforeEach(() => {
  saveDraftCall.mockReset();
  publishCall.mockReset();
  dryRunCall.mockReset();
  listCall.mockReset();
});

describe("saving the draft", () => {
  it("forwards the id, the etag and the document, and answers the new draft slot", async () => {
    const definition = standardFixDefinition();
    const slot = { etag: "b", definition, updatedAt: "2026-09-13T12:00:00.000Z" };
    saveDraftCall.mockResolvedValue(slot);

    await expect(saveDraft(ID, "a", definition)).resolves.toEqual({ ok: true, value: slot });
    expect(saveDraftCall).toHaveBeenCalledExactlyOnceWith(ID, "a", definition);
  });

  it("answers a stale etag as a refusal carrying the service's details, never a throw", async () => {
    saveDraftCall.mockRejectedValue(CONFLICT);

    await expect(saveDraft(ID, "a", {})).resolves.toEqual({
      ok: false,
      refusal: { code: "workflow_draft_conflict", message: CONFLICT.message, details: CONFLICT.details },
    });
  });

  it("lets anything that is not an ApiError travel", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    saveDraftCall.mockRejectedValue(redirect);

    await expect(saveDraft(ID, "a", {})).rejects.toBe(redirect);
  });
});

describe("publishing", () => {
  it("forwards the note as given, and answers the version", async () => {
    const version = workflowDetail().version;
    publishCall.mockResolvedValue(version);

    await expect(publishWorkflow(ID, "Added the gate.")).resolves.toEqual({ ok: true, value: version });
    expect(publishCall).toHaveBeenCalledExactlyOnceWith(ID, "Added the gate.");
  });

  it("answers the gate's findings as a refusal", async () => {
    const findings = [{ source: "engine", code: "unreachable_node", message: "m", node: "review" }];
    publishCall.mockRejectedValue(
      new ApiError(422, "workflow_definition_invalid", "This definition cannot be published yet.", { findings }),
    );

    const outcome = await publishWorkflow(ID, undefined);

    expect(outcome).toMatchObject({ ok: false, refusal: { code: "workflow_definition_invalid", details: { findings } } });
  });
});

describe("dry-running", () => {
  it("asks about the issue by id, and answers the walk", async () => {
    const walk = { ticket: {}, findings: [], steps: [], verdicts: [], highlightPath: [] };
    dryRunCall.mockResolvedValue(walk);

    await expect(dryRunWorkflow(ID, "issue-1")).resolves.toEqual({ ok: true, value: walk });
    expect(dryRunCall).toHaveBeenCalledExactlyOnceWith(ID, "issue-1");
  });

  it("answers an unavailable engine as a refusal", async () => {
    dryRunCall.mockRejectedValue(new ApiError(502, "engine_unavailable", "The engine is unavailable."));

    await expect(dryRunWorkflow(ID, "issue-1")).resolves.toMatchObject({ ok: false, refusal: { code: "engine_unavailable" } });
  });
});

describe("the picker's issues", () => {
  it("reads one page of open issues by number, and keeps the sized ones", async () => {
    listCall.mockResolvedValue({
      items: [
        { id: "a", number: 484, title: "Unsized", state: "open", sizingStatus: "unsized", estimate: null },
        { id: "b", number: 485, title: "Watchdog", state: "open", sizingStatus: "sized", estimate: { effort: "m" } },
      ],
    });

    await expect(sizedTickets()).resolves.toEqual({
      ok: true,
      value: [{ id: "b", number: 485, title: "Watchdog", effort: "m" }],
    });
    expect(listCall).toHaveBeenCalledExactlyOnceWith({ state: "open", sort: "number", limit: 100 });
  });

  it("answers a refused backlog as a refusal", async () => {
    listCall.mockRejectedValue(new ApiError(403, "forbidden", "No."));

    await expect(sizedTickets()).resolves.toMatchObject({ ok: false, refusal: { code: "forbidden" } });
  });
});
