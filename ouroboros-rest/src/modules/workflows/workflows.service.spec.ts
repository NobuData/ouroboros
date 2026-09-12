import { Logger } from "@nestjs/common";

import type { DatabaseService } from "../db/db.service";
import type { Workflow, WorkflowVersion } from "../db/schema";
import { UNIQUE_VIOLATION } from "../tenancy/constraints";
import { NO_DRAFT, draftEtag } from "./draft.etag";
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

/** A workflow row, with whatever a test changes. */
function workflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: WORKFLOW,
    organization_id: WORKSPACE,
    slug: "standard-fix",
    name: "Standard Fix",
    status: "active",
    current_version: 14,
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
    versions: jest.fn().mockResolvedValue([]),
    countVersions: jest.fn().mockResolvedValue(0),
    versionAt: jest.fn().mockResolvedValue(published()),
    publish: jest.fn().mockResolvedValue(published()),
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
      definition: {},
    });
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

describe("saving a draft", () => {
  it("writes when the etag is the one the draft has", async () => {
    const { service, repository } = harness();
    const current = draftEtag(draft());

    const saved = await service.saveDraft(WORKSPACE, WORKFLOW, current, {
      definition: { nodes: [1] },
    });

    expect(repository.writeDraft).toHaveBeenCalledWith(
      draft().id,
      { nodes: [1] },
      expect.anything(),
    );
    expect(saved.etag).not.toBe(current);
  });

  it("reads the draft under a lock, inside the transaction it is about to write in", async () => {
    const { service, repository } = harness();

    await service.saveDraft(WORKSPACE, WORKFLOW, draftEtag(draft()), { definition: {} });

    expect(repository.draftOf).toHaveBeenCalledWith(WORKFLOW, expect.anything(), true);
  });

  it("refuses a stale etag with a 409, and writes nothing", async () => {
    const { service, repository } = harness();

    expect(
      await refusal(service.saveDraft(WORKSPACE, WORKFLOW, "an-older-token", { definition: {} })),
    ).toBe("workflow_draft_conflict");
    expect(repository.writeDraft).not.toHaveBeenCalled();
  });

  it("tells the loser what the etag is now, so the studio can reload in one round trip", async () => {
    const { service } = harness();

    const failure = await service
      .saveDraft(WORKSPACE, WORKFLOW, "an-older-token", { definition: {} })
      .catch((error: unknown) => error);

    expect((failure as { getResponse(): { details: object } }).getResponse().details).toEqual({
      expected: "an-older-token",
      current: draftEtag(draft()),
    });
  });

  it("refuses a request with no If-Match differently, because it is a different mistake", async () => {
    const { service, repository } = harness();

    expect(
      await refusal(service.saveDraft(WORKSPACE, WORKFLOW, undefined, { definition: {} })),
    ).toBe("workflow_draft_etag_required");
    expect(repository.writeDraft).not.toHaveBeenCalled();
  });

  it("creates the first draft when the slot is empty and the caller said so", async () => {
    const { service, repository } = harness();
    repository.draftOf.mockResolvedValue(undefined);

    await service.saveDraft(WORKSPACE, WORKFLOW, NO_DRAFT, { definition: { nodes: [] } });

    expect(repository.insertDraft).toHaveBeenCalledWith(WORKFLOW, { nodes: [] }, expect.anything());
  });

  it("turns the one-draft index into the same 409 when two tabs both create", async () => {
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

describe("publishing", () => {
  it("gates the draft's document, then writes the version", async () => {
    const { service, repository, gate } = harness();

    const version = await service.publish(WORKSPACE, WORKFLOW, {}, PERSON, AT);

    expect(gate.check).toHaveBeenCalledWith(draft().definition);
    expect(version.version).toBe(15);
    expect(repository.publish).toHaveBeenCalledWith(
      WORKFLOW,
      { definition: draft().definition, changeNote: null, publishedBy: PERSON, publishedAt: AT },
      expect.anything(),
    );
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

  it("records a publish the engine did not second", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const { service, gate } = harness();
    gate.check.mockResolvedValue({ findings: [], engineConsulted: false });

    await service.publish(WORKSPACE, WORKFLOW, {}, PERSON, AT);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("standard-fix"));
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
