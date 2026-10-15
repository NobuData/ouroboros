import { Logger } from "@nestjs/common";

import type { DatabaseService } from "../db/db.service";
import type { Workflow, WorkflowVersion } from "../db/schema";
import { UNIQUE_VIOLATION } from "../tenancy/constraints";
import { NO_DRAFT, draftEtag } from "./draft.etag";
import { readFixture } from "./dsl.golden.fixture";
import type { WorkflowPublishGate } from "./publish.gate";
import type { WorkflowStatsService } from "./stats.service";
import { WORKFLOW_CONSTRAINTS } from "./workflows.errors";
import type { WorkflowsRepository } from "./workflows.repository";
import { WorkflowsService } from "./workflows.service";

/**
 * The rules — the `404`, the guard, the gate and the two units of work.
 *
 * The statements are `workflows.repository.spec.ts`' and the whole pipeline is the integration
 * suite's; what only this suite can hold is the decisions between them, and four of them are
 * the ticket's own acceptance criteria:
 *
 *   * a stale `If-Match` is a `409` and **nothing is written**;
 *   * a missing one is a different refusal, because forgetting the guard and losing a race are
 *     different mistakes;
 *   * a publish the gate refuses **opens no transaction at all**, which is the strongest form
 *     of *creates nothing*;
 *   * what becomes immutable is the document that passed the gate, not whatever the draft held
 *     by the time the write ran.
 */

const WORKSPACE = "acme-robotics-id";
const WORKFLOW = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";
const PERSON = "user-1";
const AT = new Date("2026-09-12T10:00:00.000Z");
const LATER = new Date("2026-09-12T10:05:00.000Z");

/** A workflow row, with whatever a test changes. */
function workflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: WORKFLOW,
    organization_id: WORKSPACE,
    slug: "standard-fix",
    name: "Standard Fix",
    status: "active",
    current_version: 14,
    template_slug: null,
    template_version: null,
    draft_rev: 0,
    provenance_summary: { canvas: 0, code: 0, copilot: 0, suggestion: 0 },
    created_at: AT,
    updated_at: AT,
    ...overrides,
  };
}

/** A draft row — `version is null` *is* the draft (V029). */
function draft(overrides: Partial<WorkflowVersion> = {}): WorkflowVersion {
  return {
    id: "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9",
    workflow_id: WORKFLOW,
    version: null,
    definition: { dsl_version: "1.0", nodes: [] },
    published_at: null,
    published_by: null,
    change_note: null,
    edited_in: null,
    created_at: AT,
    updated_at: AT,
    ...overrides,
  };
}

/** A published version row. */
function published(overrides: Partial<WorkflowVersion> = {}): WorkflowVersion {
  return draft({
    id: "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d",
    version: 15,
    published_at: AT,
    published_by: PERSON,
    change_note: null,
    ...overrides,
  });
}

/** Everything the service is constructed from, each a spy. */
interface Harness {
  service: WorkflowsService;
  repository: jest.Mocked<WorkflowsRepository>;
  stats: jest.Mocked<WorkflowStatsService>;
  gate: jest.Mocked<WorkflowPublishGate>;
  /** Whether a transaction was ever opened — the *creates nothing* assertion. */
  transactions: number;
}

/**
 * A service over spies, with a transaction that really runs its body.
 *
 * The transaction is a pass-through rather than a no-op because the two units of work here are
 * sequences, and a stub that swallowed the callback would make every assertion about their
 * order vacuous. What it records is that one was *opened*, which is the property a refused
 * publish is measured by.
 */
function harness(overrides: Partial<jest.Mocked<WorkflowsRepository>> = {}): Harness {
  const state = { transactions: 0 };

  const repository = {
    find: jest.fn().mockResolvedValue(workflow()),
    lock: jest.fn().mockResolvedValue(workflow()),
    create: jest.fn(),
    rename: jest.fn().mockResolvedValue(workflow()),
    draftOf: jest.fn().mockResolvedValue(draft()),
    insertDraft: jest.fn().mockResolvedValue(draft()),
    writeDraft: jest
      .fn()
      .mockImplementation((_id, definition) => Promise.resolve(draft({ definition }))),
    draftBase: jest.fn().mockResolvedValue({ dsl_version: "1.0", nodes: [], edges: [] }),
    applyBatch: jest.fn().mockResolvedValue(1),
    setChangeNote: jest.fn().mockResolvedValue(undefined),
    versions: jest.fn().mockResolvedValue([]),
    countVersions: jest.fn().mockResolvedValue(0),
    versionAt: jest.fn().mockResolvedValue(published()),
    publish: jest.fn().mockResolvedValue(published()),
    promoteCopilotSession: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as jest.Mocked<WorkflowsRepository>;

  const stats = {
    forWorkspace: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<WorkflowStatsService>;
  const gate = {
    check: jest.fn().mockResolvedValue({ findings: [], engineConsulted: true }),
  } as unknown as jest.Mocked<WorkflowPublishGate>;

  const database = {
    transaction: jest.fn(async (work: (trx: unknown) => Promise<unknown>) => {
      state.transactions += 1;
      return work({});
    }),
  } as unknown as DatabaseService;

  const service = new WorkflowsService(repository, stats, gate, database);

  return {
    service,
    repository,
    stats,
    gate,
    get transactions() {
      return state.transactions;
    },
  };
}

/** The code an envelope carries, for an assertion that is about the answer rather than the text. */
function codeOf(error: unknown): string {
  return (error as { getResponse(): { code: string } }).getResponse().code;
}

/**
 * The code a call refuses with.
 *
 * @param call - The promise that must reject.
 * @returns Its envelope's code — so an assertion reads as *which answer*, and a call that
 *   unexpectedly resolves fails loudly rather than passing an `undefined` to `toBe`.
 */
async function refusal(call: Promise<unknown>): Promise<string> {
  return call.then(
    () => {
      throw new Error("expected this call to be refused, and it resolved");
    },
    (error: unknown) => codeOf(error),
  );
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the rail", () => {
  it("is P.4's entries, measured from one instant", async () => {
    const { service, stats } = harness();

    await service.list(WORKSPACE, AT);

    expect(stats.forWorkspace).toHaveBeenCalledWith(WORKSPACE, AT);
  });

  it("composes no second listing of its own", async () => {
    const entries = [{ slug: "standard-fix", caption: "6 stages · auto-merge" }];
    const { service, stats } = harness();
    stats.forWorkspace.mockResolvedValue(entries as never);

    expect(await service.list(WORKSPACE)).toEqual({ workflows: entries });
  });
});

describe("creating", () => {
  it("derives the slug from the title when the caller chose none", async () => {
    const { service, repository } = harness();
    repository.create.mockResolvedValue({ workflow: workflow(), draft: draft() });

    await service.create(WORKSPACE, { name: "Standard Fix" });

    expect(repository.create).toHaveBeenCalledWith(WORKSPACE, {
      slug: "standard-fix",
      name: "Standard Fix",
      definition: { dsl_version: "1.0", nodes: [], edges: [] },
    });
  });

  it("opens a workflow created with a name only on the empty DSL document (#1744)", async () => {
    const { service, repository } = harness();
    repository.create.mockResolvedValue({ workflow: workflow(), draft: draft() });

    await service.create(WORKSPACE, { name: "First" });
    await service.create(WORKSPACE, { name: "Second" });

    const [first, second] = repository.create.mock.calls.map(([, row]) => row.definition);
    // `dsl_version` is what a draft built on it by operations alone needs to publish.
    expect(first).toEqual({ dsl_version: "1.0", nodes: [], edges: [] });
    // A fresh document each time: one workflow's draft is never another's.
    expect(first).not.toBe(second);
  });

  it("uses the slug the caller sent, verbatim", async () => {
    const { service, repository } = harness();
    repository.create.mockResolvedValue({ workflow: workflow(), draft: draft() });

    await service.create(WORKSPACE, { name: "The standard fix", slug: "standard-fix" });

    expect(repository.create.mock.calls[0][1].slug).toBe("standard-fix");
  });

  it("stores a template stub as the draft's opening document", async () => {
    const { service, repository } = harness();
    repository.create.mockResolvedValue({ workflow: workflow(), draft: draft() });

    await service.create(WORKSPACE, { name: "From template", definition: { nodes: [] } });

    expect(repository.create.mock.calls[0][1].definition).toEqual({ nodes: [] });
  });

  it("asks for a slug rather than inventing one", async () => {
    const { service, repository } = harness();

    expect(await refusal(service.create(WORKSPACE, { name: "***" }))).toBe(
      "workflow_slug_required",
    );
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("turns the unique index into a 409 rather than a 500", async () => {
    // The index is the thing that is actually true; a `select` first would leave a window two
    // creates could both pass through.
    const { service, repository } = harness();
    repository.create.mockRejectedValue({
      code: UNIQUE_VIOLATION,
      constraint: WORKFLOW_CONSTRAINTS.slugUnique,
    });

    expect(await refusal(service.create(WORKSPACE, { name: "Standard Fix" }))).toBe(
      "workflow_slug_taken",
    );
  });

  it("re-throws a failure that is not a constraint", async () => {
    const failure = new Error("connection terminated");
    const { service, repository } = harness();
    repository.create.mockRejectedValue(failure);

    await expect(service.create(WORKSPACE, { name: "Standard Fix" })).rejects.toBe(failure);
  });

  it("publishes nothing — the chip is null until somebody presses Publish", async () => {
    const { service, repository } = harness();
    repository.create.mockResolvedValue({
      workflow: workflow({ current_version: null }),
      draft: draft(),
    });

    const detail = await service.create(WORKSPACE, { name: "Standard Fix" });

    expect(detail.currentVersion).toBeNull();
    expect(detail.version).toBeNull();
    expect(detail.draft.etag).not.toBe(NO_DRAFT);
  });
});

describe("reading", () => {
  it("answers 404 for a workflow in another workspace, indistinguishably", async () => {
    // The org-scoped `find` cannot tell absent from not-yours, so neither can this, so neither
    // can a caller.
    const { service } = harness({ find: jest.fn().mockResolvedValue(undefined) });

    expect(await refusal(service.read(WORKSPACE, WORKFLOW))).toBe("workflow_not_found");
  });

  it("reads the version in force when none was named", async () => {
    const { service, repository } = harness();

    await service.read(WORKSPACE, WORKFLOW);

    expect(repository.versionAt).toHaveBeenCalledWith(WORKFLOW, 14);
  });

  it("reads a historical version when one was named", async () => {
    const { service, repository } = harness();

    await service.read(WORKSPACE, WORKFLOW, 3);

    expect(repository.versionAt).toHaveBeenCalledWith(WORKFLOW, 3);
  });

  it("answers 404 when the number names no version of a workflow it can see", async () => {
    const { service, repository } = harness();
    repository.versionAt.mockResolvedValue(undefined);

    expect(await refusal(service.read(WORKSPACE, WORKFLOW, 99))).toBe("workflow_version_not_found");
  });

  it("does not read a version for a workflow that has published nothing", async () => {
    const { service, repository } = harness();
    repository.find.mockResolvedValue(workflow({ current_version: null }));

    const detail = await service.read(WORKSPACE, WORKFLOW);

    expect(repository.versionAt).not.toHaveBeenCalled();
    expect(detail.version).toBeNull();
  });

  it("carries the draft slot whichever version was asked for", async () => {
    const { service } = harness();

    expect((await service.read(WORKSPACE, WORKFLOW, 3)).draft.definition).toEqual({
      dsl_version: "1.0",
      nodes: [],
    });
  });
});

describe("updating", () => {
  it("flips the rail to the paused state", async () => {
    const { service, repository } = harness();
    repository.rename.mockResolvedValue(workflow({ status: "paused" }));

    expect((await service.update(WORKSPACE, WORKFLOW, { status: "paused" })).status).toBe("paused");
    expect(repository.rename).toHaveBeenCalledWith(WORKSPACE, WORKFLOW, { status: "paused" });
  });

  it("answers a body that asks for nothing with the workflow as it stands", async () => {
    const { service, repository } = harness();

    expect((await service.update(WORKSPACE, WORKFLOW, {})).name).toBe("Standard Fix");
    expect(repository.rename).not.toHaveBeenCalled();
  });

  it("answers 404 when the update matched no row", async () => {
    const { service, repository } = harness();
    repository.rename.mockResolvedValue(undefined);

    expect(await refusal(service.update(WORKSPACE, WORKFLOW, { name: "x" }))).toBe(
      "workflow_not_found",
    );
  });
});

/** A stage, as the canvas saves one. */
const STAGE = { id: "test", type: "infra", title: "Test", position: { x: 0, y: 0 }, config: {} };

/** The draft fixture's document with {@link STAGE} added — one `add_stage` away from it. */
const WITH_STAGE = { dsl_version: "1.0", nodes: [STAGE], edges: [] };

describe("saving a draft", () => {
  it("records the save as a canvas batch, by the person who saved, when the etag is current", async () => {
    const { service, repository } = harness();
    const current = draftEtag(draft());
    repository.draftOf
      .mockResolvedValueOnce(draft())
      .mockResolvedValue(draft({ definition: WITH_STAGE, updated_at: LATER }));

    const saved = await service.saveDraft(
      WORKSPACE,
      WORKFLOW,
      current,
      { definition: WITH_STAGE },
      PERSON,
    );

    expect(repository.applyBatch).toHaveBeenCalledWith(
      WORKSPACE,
      WORKFLOW,
      "canvas",
      PERSON,
      [{ kind: "add_stage", params: { node: STAGE } }],
      expect.anything(),
    );
    expect(repository.writeDraft).not.toHaveBeenCalled();
    expect(saved.etag).not.toBe(current);
  });

  it("records nothing and writes nothing for a save that changes nothing", async () => {
    const { service, repository } = harness();
    const current = draftEtag(draft());

    const saved = await service.saveDraft(WORKSPACE, WORKFLOW, current, {
      definition: { dsl_version: "1.0", nodes: [], edges: [] },
    });

    expect(repository.applyBatch).not.toHaveBeenCalled();
    expect(repository.writeDraft).not.toHaveBeenCalled();
    expect(saved.etag).toBe(current);
  });

  it("refuses a save the operations cannot record with a 422 naming each problem, and writes nothing", async () => {
    const { service, repository } = harness();

    const failure = await service
      .saveDraft(WORKSPACE, WORKFLOW, draftEtag(draft()), {
        definition: { dsl_version: "2.0", nodes: [STAGE, STAGE], edges: [] },
      })
      .catch((error: unknown) => error);
    const envelope = (
      failure as { getResponse(): { code: string; details: { problems: { path: string }[] } } }
    ).getResponse();

    expect(envelope.code).toBe("workflow_draft_inexpressible");
    expect(envelope.details.problems.map((problem) => problem.path)).toEqual([
      "/dsl_version",
      "/nodes/1/id",
    ]);
    expect(repository.applyBatch).not.toHaveBeenCalled();
    expect(repository.insertDraft).not.toHaveBeenCalled();
  });

  it("names the editor whose change the draft holds, in the message and the details", async () => {
    // One draft, two editors (decision C3): the conflict dialog says which one it lost to.
    const { service, repository } = harness();
    repository.draftOf.mockResolvedValue(draft({ edited_in: "code" }));

    const failure = await service
      .saveDraft(WORKSPACE, WORKFLOW, "an-older-token", { definition: {} })
      .catch((error: unknown) => error);
    const envelope = (
      failure as { getResponse(): { message: string; details: Record<string, unknown> } }
    ).getResponse();

    expect(envelope.message).toBe(
      "This draft was changed in the code editor. Reload it before saving again.",
    );
    expect(envelope.details.editedIn).toBe("code");
  });

  it("reads the draft under a lock, inside the transaction it is about to write in", async () => {
    const { service, repository } = harness();

    await service.saveDraft(WORKSPACE, WORKFLOW, draftEtag(draft()), { definition: {} });

    expect(repository.draftOf).toHaveBeenCalledWith(WORKFLOW, expect.anything(), true);
  });

  it("refuses a stale etag with a 409, and writes nothing", async () => {
    const { service, repository } = harness();

    expect(
      await refusal(
        service.saveDraft(WORKSPACE, WORKFLOW, "an-older-token", { definition: WITH_STAGE }),
      ),
    ).toBe("workflow_draft_conflict");
    expect(repository.applyBatch).not.toHaveBeenCalled();
  });

  it("tells the loser what the etag is now, so the studio can reload in one round trip", async () => {
    const { service } = harness();

    const failure = await service
      .saveDraft(WORKSPACE, WORKFLOW, "an-older-token", { definition: {} })
      .catch((error: unknown) => error);

    expect((failure as { getResponse(): { details: object } }).getResponse().details).toEqual({
      expected: "an-older-token",
      current: draftEtag(draft()),
      editedIn: null,
      updatedAt: AT.toISOString(),
    });
  });

  it("refuses a request with no If-Match differently, because it is a different mistake", async () => {
    const { service, repository } = harness();

    expect(
      await refusal(service.saveDraft(WORKSPACE, WORKFLOW, undefined, { definition: {} })),
    ).toBe("workflow_draft_etag_required");
    expect(repository.applyBatch).not.toHaveBeenCalled();
  });

  it("creates the first draft by a batch over the base, under the workflow's lock", async () => {
    const { service, repository } = harness();
    repository.draftOf
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(draft({ definition: WITH_STAGE }));

    await service.saveDraft(WORKSPACE, WORKFLOW, NO_DRAFT, { definition: WITH_STAGE }, PERSON);

    expect(repository.lock).toHaveBeenCalledWith(WORKSPACE, WORKFLOW, expect.anything());
    expect(repository.draftBase).toHaveBeenCalledWith(WORKFLOW, expect.anything());
    expect(repository.applyBatch).toHaveBeenCalledWith(
      WORKSPACE,
      WORKFLOW,
      "canvas",
      PERSON,
      [{ kind: "add_stage", params: { node: STAGE } }],
      expect.anything(),
    );
    expect(repository.insertDraft).not.toHaveBeenCalled();
  });

  it("opens the slot on the base when a first save changes nothing — no batch to record", async () => {
    const { service, repository } = harness();
    repository.draftOf.mockResolvedValue(undefined);

    await service.saveDraft(WORKSPACE, WORKFLOW, NO_DRAFT, { definition: {} });

    expect(repository.applyBatch).not.toHaveBeenCalled();
    expect(repository.insertDraft).toHaveBeenCalledWith(
      WORKFLOW,
      { dsl_version: "1.0", nodes: [], edges: [] },
      "visual",
      expect.anything(),
      null,
    );
  });

  it("answers 409 when another request created the draft while this first save waited", async () => {
    const { service, repository } = harness();
    repository.draftOf.mockResolvedValueOnce(undefined).mockResolvedValue(draft());

    expect(
      await refusal(service.saveDraft(WORKSPACE, WORKFLOW, NO_DRAFT, { definition: WITH_STAGE })),
    ).toBe("workflow_draft_conflict");
    expect(repository.applyBatch).not.toHaveBeenCalled();
  });

  it("turns the one-draft index into the same 409 when two tabs both open an unchanged slot", async () => {
    // V029: "where two concurrent start-editing requests collide instead of producing two
    // drafts nobody can choose between".
    const { service, repository } = harness();
    repository.draftOf.mockResolvedValue(undefined);
    repository.insertDraft.mockRejectedValue({
      code: UNIQUE_VIOLATION,
      constraint: WORKFLOW_CONSTRAINTS.oneDraft,
    });

    expect(
      await refusal(service.saveDraft(WORKSPACE, WORKFLOW, NO_DRAFT, { definition: {} })),
    ).toBe("workflow_draft_conflict");
  });

  it("answers 404 before it asks about etags at all", async () => {
    const { service, repository } = harness();
    repository.find.mockResolvedValue(undefined);

    expect(
      await refusal(service.saveDraft(WORKSPACE, WORKFLOW, undefined, { definition: {} })),
    ).toBe("workflow_not_found");
  });
});

describe("the guarded write both editors share", () => {
  // Decision C3: one draft, two editors. The code view (U.3, #167) saves through this as well.
  it("records the code editor's save as a code batch, on the draft it locked", async () => {
    const { service, repository } = harness();
    repository.draftOf
      .mockResolvedValueOnce(draft())
      .mockResolvedValue(draft({ definition: WITH_STAGE, edited_in: "code" }));

    const written = await service.writeGuarded(
      workflow(),
      draftEtag(draft()),
      WITH_STAGE,
      "code",
      PERSON,
    );

    expect(repository.draftOf).toHaveBeenCalledWith(WORKFLOW, expect.anything(), true);
    expect(repository.applyBatch).toHaveBeenCalledWith(
      WORKSPACE,
      WORKFLOW,
      "code",
      PERSON,
      [{ kind: "add_stage", params: { node: STAGE } }],
      expect.anything(),
    );
    expect(written.definition).toEqual(WITH_STAGE);
  });

  it("records a half-built stage the DSL refuses — autosave keeps work in progress", async () => {
    const { service, repository } = harness();
    const unrouted = { id: "fix", type: "llm", title: "Fix", position: { x: 0, y: 0 }, config: {} };

    await service.writeGuarded(
      workflow(),
      draftEtag(draft()),
      { dsl_version: "1.0", nodes: [unrouted], edges: [] },
      "visual",
      PERSON,
    );

    expect(repository.applyBatch.mock.calls[0][4]).toEqual([
      { kind: "add_stage", params: { node: unrouted } },
    ]);
  });

  it("refuses a stale etag inside the transaction, and writes nothing", async () => {
    const state = harness();

    expect(await refusal(state.service.writeGuarded(workflow(), "stale", {}, "code", PERSON))).toBe(
      "workflow_draft_conflict",
    );
    expect(state.transactions).toBe(1);
    expect(state.repository.applyBatch).not.toHaveBeenCalled();
    expect(state.repository.insertDraft).not.toHaveBeenCalled();
  });
});

describe("publishing", () => {
  it("gates the draft's document, then writes the version", async () => {
    const { service, repository, gate } = harness();

    const version = await service.publish(WORKSPACE, WORKFLOW, {}, PERSON, AT);

    // The workspace travels with the document: a pin must resolve in *this* registry (CH.6).
    expect(gate.check).toHaveBeenCalledWith(WORKSPACE, draft().definition);
    expect(version.version).toBe(15);
    expect(repository.publish).toHaveBeenCalledWith(
      WORKFLOW,
      { definition: draft().definition, changeNote: null, publishedBy: PERSON, publishedAt: AT },
      expect.anything(),
    );
  });

  it("promotes the workflow's active copilot session in the publish's own transaction", async () => {
    const { service, repository } = harness({
      promoteCopilotSession: jest.fn().mockResolvedValue("5eed008a-0000-4000-8000-000000000001"),
    });

    const version = await service.publish(WORKSPACE, WORKFLOW, {}, PERSON, AT);

    // The same transaction object the version was written in — and after it.
    const trx = repository.publish.mock.calls[0][2];
    expect(repository.promoteCopilotSession).toHaveBeenCalledWith(WORKSPACE, WORKFLOW, trx);
    expect(repository.promoteCopilotSession.mock.invocationCallOrder[0]).toBeGreaterThan(
      repository.publish.mock.invocationCallOrder[0],
    );
    // No response-shape change: the version, as before.
    expect(version.version).toBe(15);
  });

  it("publishes a workflow with no conversation exactly as before", async () => {
    const { service, repository } = harness();

    const version = await service.publish(WORKSPACE, WORKFLOW, {}, PERSON, AT);

    expect(repository.promoteCopilotSession).toHaveBeenCalledTimes(1);
    expect(version.version).toBe(15);
  });

  it("promotes nothing when the publish is refused", async () => {
    const state = harness();
    state.gate.check.mockResolvedValue({
      findings: [{ source: "dsl", code: "structure.no_trigger", message: "…", path: "/nodes" }],
      engineConsulted: false,
    });

    await expect(state.service.publish(WORKSPACE, WORKFLOW, {}, PERSON, AT)).rejects.toBeDefined();

    expect(state.repository.promoteCopilotSession).not.toHaveBeenCalled();
  });

  it("carries the change note into the immutable row", async () => {
    const { service, repository } = harness();

    await service.publish(
      WORKSPACE,
      WORKFLOW,
      { changeNote: "Added the review gate." },
      PERSON,
      AT,
    );

    expect(repository.publish.mock.calls[0][1].changeNote).toBe("Added the review gate.");
  });

  it("refuses a document with findings, and opens no transaction at all", async () => {
    // The strongest form of *creates nothing*: there was never a unit of work to roll back.
    const findings = [
      { source: "dsl" as const, code: "structure.no_trigger", message: "…", path: "/nodes" },
    ];
    const state = harness();
    state.gate.check.mockResolvedValue({ findings, engineConsulted: false });

    const failure = await state.service
      .publish(WORKSPACE, WORKFLOW, {}, PERSON, AT)
      .catch((error: unknown) => error);

    expect(codeOf(failure)).toBe("workflow_definition_invalid");
    expect(
      (failure as { getResponse(): { details: { findings: unknown[] } } }).getResponse().details
        .findings,
    ).toEqual(findings);
    expect(state.transactions).toBe(0);
    expect(state.repository.publish).not.toHaveBeenCalled();
  });

  it("refuses when there is nothing to publish", async () => {
    const state = harness();
    state.repository.draftOf.mockResolvedValue(undefined);

    expect(await refusal(state.service.publish(WORKSPACE, WORKFLOW, {}, PERSON, AT))).toBe(
      "workflow_draft_absent",
    );
    expect(state.transactions).toBe(0);
  });

  it("refuses when the draft moved while the gate was running", async () => {
    // What becomes immutable has to be what passed. The second read is the one inside the
    // transaction, and a different document there is a 409 rather than a version of something
    // nobody validated.
    const { service, repository } = harness();
    repository.draftOf
      .mockResolvedValueOnce(draft())
      .mockResolvedValueOnce(draft({ definition: { nodes: [{ id: "added-meanwhile" }] } }));

    expect(await refusal(service.publish(WORKSPACE, WORKFLOW, {}, PERSON, AT))).toBe(
      "workflow_draft_conflict",
    );
    expect(repository.publish).not.toHaveBeenCalled();
  });

  it("answers 404 when the workflow went away while the engine was thinking", async () => {
    const { service, repository } = harness();
    repository.lock.mockResolvedValue(undefined);

    expect(await refusal(service.publish(WORKSPACE, WORKFLOW, {}, PERSON, AT))).toBe(
      "workflow_not_found",
    );
  });

  it.each([WORKFLOW_CONSTRAINTS.versionUnique, WORKFLOW_CONSTRAINTS.versionDense])(
    "turns %s into a 409 the writer must see",
    async (constraint) => {
      // V029: "two publishers racing both compute max + 1, and the unique key lets one commit,
      // which is a retry a writer must see" — their definition may no longer be the one they
      // meant to publish on top of.
      const { service, repository } = harness();
      repository.publish.mockRejectedValue({ code: UNIQUE_VIOLATION, constraint });

      expect(await refusal(service.publish(WORKSPACE, WORKFLOW, {}, PERSON, AT))).toBe(
        "workflow_publish_conflict",
      );
    },
  );

  it("re-throws a failure that is not one of those races", async () => {
    const failure = new Error("connection terminated");
    const { service, repository } = harness();
    repository.publish.mockRejectedValue(failure);

    await expect(service.publish(WORKSPACE, WORKFLOW, {}, PERSON, AT)).rejects.toBe(failure);
  });
});

describe("a proposed draft (#514)", () => {
  it("bases a proposal on the draft when there is one, with the etag it must be written against", async () => {
    const { service, repository } = harness({
      findBySlug: jest.fn().mockResolvedValue(workflow()),
    });

    const base = await service.draftBase(WORKSPACE, "standard-fix");

    expect(base).toMatchObject({ from: "draft", version: null, etag: draftEtag(draft()) });
    expect(repository.versionAt).not.toHaveBeenCalled();
  });

  it("bases it on the version in force when there is no draft", async () => {
    const { service } = harness({
      findBySlug: jest.fn().mockResolvedValue(workflow()),
      draftOf: jest.fn().mockResolvedValue(undefined),
    });

    const base = await service.draftBase(WORKSPACE, "standard-fix");

    expect(base).toMatchObject({ from: "version", version: 15, etag: NO_DRAFT });
  });

  it("answers a slug the workspace does not have with workflow_not_found", async () => {
    const { service } = harness({
      findBySlug: jest.fn().mockResolvedValue(undefined),
    });

    await expect(service.draftBase(WORKSPACE, "nope")).rejects.toMatchObject({
      code: "workflow_not_found",
    });
  });

  it("writes the document as a canvas batch with no person, sets its note, and never publishes", async () => {
    const { service, repository, gate } = harness();
    const document = readFixture("valid/standard-fix.json");

    await service.proposeDraft(WORKSPACE, WORKFLOW, draftEtag(draft()), document, "Cites 171.");

    expect(repository.applyBatch).toHaveBeenCalledWith(
      WORKSPACE,
      WORKFLOW,
      "canvas",
      null,
      expect.arrayContaining([expect.objectContaining({ kind: "add_stage" })]),
      expect.anything(),
    );
    expect(repository.setChangeNote).toHaveBeenCalledWith(
      draft().id,
      "Cites 171.",
      expect.anything(),
    );
    expect(repository.publish).not.toHaveBeenCalled();
    expect(gate.check).not.toHaveBeenCalled();
  });

  it("sets the note even when the proposal changes nothing in the document", async () => {
    const document = readFixture("valid/standard-fix.json");
    const { service, repository } = harness({
      draftOf: jest.fn().mockResolvedValue(draft({ definition: document })),
    });

    await service.proposeDraft(
      WORKSPACE,
      WORKFLOW,
      draftEtag(draft({ definition: document })),
      document,
      "Cites 171.",
    );

    expect(repository.applyBatch).not.toHaveBeenCalled();
    expect(repository.setChangeNote).toHaveBeenCalledWith(
      draft().id,
      "Cites 171.",
      expect.anything(),
    );
  });

  it("refuses a document that does not parse, writing nothing", async () => {
    const { service, repository } = harness();

    await expect(
      service.proposeDraft(WORKSPACE, WORKFLOW, draftEtag(draft()), { nodes: [] }, "x"),
    ).rejects.toMatchObject({ code: "workflow_definition_invalid" });
    expect(repository.applyBatch).not.toHaveBeenCalled();
  });

  it("refuses a stale base with workflow_draft_conflict", async () => {
    const { service } = harness();
    const document = readFixture("valid/standard-fix.json");

    await expect(
      service.proposeDraft(WORKSPACE, WORKFLOW, "an-older-token", document, "x"),
    ).rejects.toMatchObject({ code: "workflow_draft_conflict" });
  });

  it("publishing keeps the proposed note when the publisher writes none, and replaces it when they do", async () => {
    const proposed = draft({ change_note: "Cites 171." });
    const keeps = harness({ draftOf: jest.fn().mockResolvedValue(proposed) });

    await keeps.service.publish(WORKSPACE, WORKFLOW, {}, PERSON, AT);
    expect(keeps.repository.publish).toHaveBeenCalledWith(
      WORKFLOW,
      expect.objectContaining({ changeNote: "Cites 171." }),
      expect.anything(),
    );

    const replaces = harness({ draftOf: jest.fn().mockResolvedValue(proposed) });
    await replaces.service.publish(WORKSPACE, WORKFLOW, { changeNote: "Mine." }, PERSON, AT);
    expect(replaces.repository.publish).toHaveBeenCalledWith(
      WORKFLOW,
      expect.objectContaining({ changeNote: "Mine." }),
      expect.anything(),
    );
  });
});

describe("the history", () => {
  it("pages the versions and counts them together", async () => {
    const { service, repository } = harness();
    repository.versions.mockResolvedValue([
      { version: 14, published_at: AT, published_by: PERSON, change_note: null, created_at: AT },
    ]);
    repository.countVersions.mockResolvedValue(1);

    const page = await service.versions(WORKSPACE, WORKFLOW, { limit: 10, offset: 0 });

    expect(page).toEqual({
      items: [
        {
          version: 14,
          changeNote: null,
          publishedAt: AT.toISOString(),
          publishedBy: PERSON,
          isCurrent: true,
        },
      ],
      total: 1,
      limit: 10,
      offset: 0,
    });
  });

  it("answers 404 for a workflow this workspace cannot see", async () => {
    const { service, repository } = harness();
    repository.find.mockResolvedValue(undefined);

    expect(await refusal(service.versions(WORKSPACE, WORKFLOW, {}))).toBe("workflow_not_found");
  });
});

describe("instantiating a template (BB.3, #386)", () => {
  const TEMPLATE = {
    slug: "quick-fixes",
    version: 3,
    name: "Quick fixes",
    definition: { dsl_version: "1.0", nodes: [] },
  };

  /** A harness whose create and publish answer like the database would. */
  function instantiating(taken: string[] = []) {
    const run = harness({
      slugFamily: jest.fn().mockResolvedValue(taken),
      create: jest.fn().mockImplementation((_org, input: { slug: string; name: string }) =>
        Promise.resolve({
          workflow: workflow({
            slug: input.slug,
            name: input.name,
            current_version: null,
            template_slug: "quick-fixes",
            template_version: 3,
          }),
          draft: draft(),
        }),
      ),
      publish: jest.fn().mockResolvedValue(published({ version: 1 })),
    });

    return run;
  }

  it("runs the publish gate over the template's definition — the same gate, no bypass", async () => {
    const { service, gate } = instantiating();

    await service.createFromTemplate(WORKSPACE, TEMPLATE, PERSON, AT);

    expect(gate.check).toHaveBeenCalledWith(WORKSPACE, TEMPLATE.definition);
  });

  it("creates the workflow with provenance and publishes v1 in one transaction", async () => {
    const run = instantiating();
    const trx = expect.anything() as unknown;

    const result = await run.service.createFromTemplate(WORKSPACE, TEMPLATE, PERSON, AT);

    expect(run.transactions).toBe(1);
    expect(run.repository.create).toHaveBeenCalledWith(
      WORKSPACE,
      {
        slug: "quick-fixes",
        name: "Quick fixes",
        definition: TEMPLATE.definition,
        template: { slug: "quick-fixes", version: 3 },
      },
      trx,
    );
    expect(run.repository.publish).toHaveBeenCalledWith(
      WORKFLOW,
      {
        definition: TEMPLATE.definition,
        changeNote: "Instantiated from quick-fixes@v3.",
        publishedBy: PERSON,
        publishedAt: AT,
      },
      trx,
    );
    expect(result.workflow).toMatchObject({ slug: "quick-fixes", currentVersion: 1 });
    expect(result.version.version).toBe(1);
  });

  it("refuses a definition the gate finds fault with, and opens no transaction", async () => {
    const run = instantiating();
    run.gate.check.mockResolvedValue({
      findings: [{ source: "dsl", code: "structure.no_terminal", message: "No terminal." }],
      engineConsulted: false,
    });

    expect(await refusal(run.service.createFromTemplate(WORKSPACE, TEMPLATE, PERSON))).toBe(
      "workflow_definition_invalid",
    );
    expect(run.transactions).toBe(0);
    expect(run.repository.create).not.toHaveBeenCalled();
    expect(run.repository.slugFamily).not.toHaveBeenCalled();
  });

  it("takes the suffix flow when the template's slug is taken", async () => {
    const run = instantiating(["quick-fixes"]);

    const result = await run.service.createFromTemplate(WORKSPACE, TEMPLATE, PERSON, AT);

    expect(run.repository.create).toHaveBeenCalledWith(
      WORKSPACE,
      expect.objectContaining({ slug: "quick-fixes-2", name: "Quick fixes (2)" }),
      expect.anything(),
    );
    expect(result.workflow.slug).toBe("quick-fixes-2");
  });

  it("re-picks the next suffix when a concurrent create wins the slug", async () => {
    const run = instantiating();
    const lost = Object.assign(new Error("duplicate key"), {
      code: UNIQUE_VIOLATION,
      constraint: WORKFLOW_CONSTRAINTS.slugUnique,
    });
    const created = run.repository.create.getMockImplementation();
    run.repository.create.mockRejectedValueOnce(lost).mockImplementation(created);

    const result = await run.service.createFromTemplate(WORKSPACE, TEMPLATE, PERSON, AT);

    expect(run.transactions).toBe(2);
    expect(result.workflow.slug).toBe("quick-fixes-2");
  });

  it("answers workflow_slug_taken after losing every attempt", async () => {
    const run = instantiating();
    run.repository.create.mockRejectedValue(
      Object.assign(new Error("duplicate key"), {
        code: UNIQUE_VIOLATION,
        constraint: WORKFLOW_CONSTRAINTS.slugUnique,
      }),
    );

    expect(await refusal(run.service.createFromTemplate(WORKSPACE, TEMPLATE, PERSON))).toBe(
      "workflow_slug_taken",
    );
    expect(run.transactions).toBe(3);
  });

  it("rethrows any other failure as it came", async () => {
    const run = instantiating();
    run.repository.publish.mockRejectedValue(new Error("connection reset"));

    await expect(run.service.createFromTemplate(WORKSPACE, TEMPLATE, PERSON)).rejects.toThrow(
      "connection reset",
    );
  });
});
