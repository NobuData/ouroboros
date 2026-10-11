import { Logger } from "@nestjs/common";

import type { DatabaseService } from "../db/db.service";
import type { DryRun, DryRunSuggestion, WorkflowVersion } from "../db/schema";
import type { WorkflowCatalogService } from "../workflows/catalog.service";
import { draftEtag } from "../workflows/draft.etag";
import { WORKFLOW_ERRORS } from "../workflows/workflows.errors";
import { DRY_RUN_ERRORS } from "./dry-runs.errors";
import type { DryRunsRepository } from "./dry-runs.repository";
import { guardTrace, ticketRow, workflowRow } from "./dry-runs.store.fixture";
import { DRY_RUN_SUGGESTION_ERRORS } from "./suggestions.errors";
import type { DryRunSuggestionsRepository, NewSuggestion } from "./suggestions.repository";
import { RULE_PACK_VERSION } from "./suggestions.rules";
import {
  SEEDED_CATALOGUE,
  SEEDED_CONDITIONAL_OPS,
  SEEDED_DRAFT,
  SEEDED_REPLAY,
  SEEDED_STAGES,
} from "./suggestions.seed.fixture";
import { DryRunSuggestionsService, LLM_UNSCORED, wasIgnored } from "./suggestions.service";

const WORKSPACE = "acme-robotics-id";
const WORKFLOW = "5eed0089-0000-4000-8000-000000000001";
const DRY_RUN = "5eed008b-0000-4000-8000-000000000001";
const SESSION = "5eed008a-0000-4000-8000-000000000001";
const AT = new Date("2026-10-06T15:08:00Z");

function runRow(overrides: Partial<DryRun> = {}): DryRun {
  return {
    id: DRY_RUN,
    organization_id: WORKSPACE,
    workflow_id: WORKFLOW,
    base_version: null,
    draft_rev: 3,
    session_id: SESSION,
    ticket_id: "5eed0088-0000-4000-8000-000000000489",
    status: "complete",
    cost_cents: 31,
    guards_clean: true,
    ...overrides,
  } as DryRun;
}

function bench(options: { draft?: unknown; run?: DryRun } = {}) {
  const rows: DryRunSuggestion[] = [];
  const batches: unknown[] = [];
  let definition: unknown = options.draft ?? SEEDED_DRAFT;
  let rev = 3;
  let ignored: Pick<DryRunSuggestion, "rule_id" | "title" | "proposed_ops">[] = [];
  const draftRow = (): WorkflowVersion =>
    ({
      id: "draft-1",
      workflow_id: WORKFLOW,
      version: null,
      definition,
      updated_at: new Date(AT.getTime() + rev),
    }) as unknown as WorkflowVersion;

  const suggestions = {
    forRun: jest.fn().mockImplementation(() => Promise.resolve([...rows])),
    find: jest
      .fn()
      .mockImplementation((_run: string, id: string) =>
        Promise.resolve(rows.find((row) => row.id === id)),
      ),
    insert: jest.fn().mockImplementation((run: DryRun, filed: NewSuggestion[]) => {
      const inserted = filed.map((suggestion, index): DryRunSuggestion => ({
        id: `s-${String(rows.length + index + 1)}`,
        organization_id: run.organization_id,
        dry_run_id: run.id,
        source: suggestion.source,
        rule_id: suggestion.ruleId,
        rule_version: suggestion.ruleVersion,
        title: suggestion.title,
        body: suggestion.body,
        evidence: suggestion.evidence,
        proposed_ops: [...suggestion.proposedOps],
        confidence: suggestion.confidence,
        confidence_basis: suggestion.confidenceBasis,
        status: "open",
        applied_op_batch_id: null,
        resolved_by: null,
        resolved_at: null,
        created_at: AT,
      }));
      rows.push(...inserted);
      return Promise.resolve(inserted);
    }),
    hasRuleSuggestions: jest
      .fn()
      .mockImplementation(() => Promise.resolve(rows.some((row) => row.source === "rule"))),
    ignoredAtRevision: jest.fn().mockImplementation(() => Promise.resolve(ignored)),
    replay: jest.fn().mockResolvedValue(SEEDED_REPLAY),
    latestForSession: jest.fn().mockResolvedValue(options.run ?? runRow()),
    lockDraft: jest.fn().mockImplementation(() => Promise.resolve(draftRow())),
    draft: jest.fn().mockImplementation(() => Promise.resolve(draftRow())),
    revision: jest
      .fn()
      .mockImplementation(() => Promise.resolve({ current_version: null, draft_rev: rev })),
    applyBatch: jest
      .fn()
      .mockImplementation(
        (_run: DryRun, _id: string, _user: string | null, operations: unknown[]) => {
          batches.push(operations);
          rev += 1;
          return Promise.resolve({ draft_rev: rev, batch_id: `batch-${String(rev)}` });
        },
      ),
    markApplied: jest.fn().mockImplementation((id: string, batchId: string, userId: string) => {
      const row = rows.find((candidate) => candidate.id === id) as DryRunSuggestion;
      Object.assign(row, {
        status: "applied",
        applied_op_batch_id: batchId,
        resolved_by: userId,
        resolved_at: AT,
      });
      return Promise.resolve(row);
    }),
    markIgnored: jest.fn().mockImplementation((id: string, userId: string) => {
      const row = rows.find((candidate) => candidate.id === id && candidate.status === "open");
      if (row === undefined) return Promise.resolve(undefined);
      Object.assign(row, { status: "ignored", resolved_by: userId, resolved_at: AT });
      return Promise.resolve(row);
    }),
  };

  const dryRuns = {
    workflow: jest.fn().mockResolvedValue(workflowRow()),
    find: jest.fn().mockResolvedValue(options.run ?? runRow()),
    stages: jest.fn().mockResolvedValue(SEEDED_STAGES),
    ticket: jest.fn().mockResolvedValue(ticketRow({ labels: ["bug", "can-bus"] })),
    draftDefinition: jest.fn().mockImplementation(() => Promise.resolve(definition)),
    workspaceCapCents: jest.fn().mockResolvedValue(1000),
    guardTraces: jest.fn().mockResolvedValue([guardTrace(500)]),
  };
  const catalog = { dslCatalogue: jest.fn().mockResolvedValue(SEEDED_CATALOGUE) };
  const trx = { transaction: "fake" };
  const database = {
    transaction: jest
      .fn()
      .mockImplementation((work: (t: unknown) => Promise<unknown>) => work(trx)),
  };

  const service = new DryRunSuggestionsService(
    suggestions as unknown as DryRunSuggestionsRepository,
    dryRuns as unknown as DryRunsRepository,
    catalog as unknown as WorkflowCatalogService,
    database as unknown as DatabaseService,
  );

  return {
    service,
    suggestions,
    dryRuns,
    database,
    trx,
    rows,
    batches,
    moveDraft: (next: unknown) => {
      definition = next;
      rev += 1;
    },
    ignore: (next: typeof ignored) => (ignored = next),
  };
}

describe("the draft's spend guard, as a dry run is held to it", () => {
  it("is the newest per-run cap the conversation proposed", async () => {
    const { service, dryRuns } = bench();

    await expect(service.draftSpendGuardCents(WORKSPACE, WORKFLOW)).resolves.toBe(500);
    expect(dryRuns.guardTraces).toHaveBeenCalledWith(WORKSPACE, WORKFLOW);
  });

  it("is null when no live conversation proposed one", async () => {
    const { service, dryRuns } = bench();
    dryRuns.guardTraces.mockResolvedValue([]);

    await expect(service.draftSpendGuardCents(WORKSPACE, WORKFLOW)).resolves.toBeNull();
  });
});

describe("filing a dry run's suggestions", () => {
  it("files the pack's findings as rule suggestions, each with its confidence and basis", async () => {
    const { service, rows } = bench();

    const filed = await service.file(runRow());

    expect(filed.map((row) => [row.source, row.ruleId, row.ruleVersion, row.confidence])).toEqual([
      ["rule", "skipped-nothing-to-do", 1, 93],
      ["rule", "reviewer-disagreement", 1, 81],
    ]);
    expect(rows[0].proposed_ops).toEqual(SEEDED_CONDITIONAL_OPS);
    for (const row of filed) {
      expect(row.confidenceBasis.method).toBe("rule_strength_x_sample_adequacy");
      expect(Object.keys(row.confidenceBasis.inputs).length).toBeGreaterThan(0);
      expect(row.applicable).toBe(true);
      expect(row.status).toBe("open");
    }
  });

  it("files once per run, and nothing for a run that did not end with results", async () => {
    const { service, suggestions } = bench();

    await service.file(runRow());
    expect(await service.file(runRow())).toEqual([]);
    expect(suggestions.insert).toHaveBeenCalledTimes(1);

    for (const status of ["failed", "cancelled", "running"] as const) {
      expect(await bench().service.file(runRow({ status }))).toEqual([]);
    }
  });

  it("does not re-propose what somebody ignored on this draft revision, and still files the rest", async () => {
    const { service, ignore, suggestions } = bench();
    ignore([
      {
        rule_id: "skipped-nothing-to-do",
        title: "Make exploit-verify conditional",
        proposed_ops: SEEDED_CONDITIONAL_OPS,
      },
    ]);

    const filed = await service.file(runRow({ id: "next-run" }));

    expect(filed.map((row) => row.ruleId)).toEqual(["reviewer-disagreement"]);
    expect(suggestions.ignoredAtRevision).toHaveBeenCalledWith(
      expect.objectContaining({ id: "next-run", draft_rev: 3 }),
    );
  });

  it("matches an ignored suggestion by rule, title and operations — a different proposal is new", () => {
    const finding = {
      rule: { id: "a-rule" },
      title: "T",
      proposedOps: [{ kind: "remove_stage", params: { id: "x" } }],
    } as never;
    const same = {
      rule_id: "a-rule",
      title: "T",
      proposed_ops: [{ kind: "remove_stage", params: { id: "x" } }],
    };

    expect(wasIgnored(finding, [same])).toBe(true);
    // `jsonb` hands an object's keys back in its own order; the operations are still the same.
    expect(
      wasIgnored(finding, [
        { ...same, proposed_ops: [{ params: { id: "x" }, kind: "remove_stage" }] },
      ]),
    ).toBe(true);
    expect(wasIgnored(finding, [{ ...same, rule_id: "other" }])).toBe(false);
    expect(wasIgnored(finding, [{ ...same, title: "U" }])).toBe(false);
    expect(wasIgnored(finding, [{ ...same, proposed_ops: [] }])).toBe(false);
    expect(wasIgnored(finding, [])).toBe(false);
  });

  it("never fails the run: a rule that cannot be evaluated is logged and files nothing", async () => {
    const logged = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const { service, dryRuns } = bench();
    dryRuns.stages.mockRejectedValue(new Error("connection lost"));

    expect(await service.file(runRow())).toEqual([]);
    expect(logged).toHaveBeenCalledWith(
      `suggestions for dry run ${DRY_RUN} were not filed`,
      expect.anything(),
    );
    logged.mockRestore();

    const gone = bench();
    gone.dryRuns.ticket.mockResolvedValue(undefined);
    expect(await gone.service.file(runRow())).toEqual([]);
  });
});

describe("reading and explaining", () => {
  it("lists a dry run's suggestions, and refuses a stranger's workflow or run", async () => {
    const { service, dryRuns } = bench();
    await service.file(runRow());

    const listed = await service.list(WORKSPACE, WORKFLOW, DRY_RUN);
    expect(listed.dryRunId).toBe(DRY_RUN);
    expect(listed.suggestions).toHaveLength(2);

    dryRuns.find.mockResolvedValueOnce(undefined);
    await expect(service.list(WORKSPACE, WORKFLOW, DRY_RUN)).rejects.toMatchObject({
      code: DRY_RUN_ERRORS.notFound,
    });
    dryRuns.workflow.mockResolvedValueOnce(undefined);
    await expect(service.list(WORKSPACE, WORKFLOW, DRY_RUN)).rejects.toMatchObject({
      code: WORKFLOW_ERRORS.workflowNotFound,
    });
  });

  it("explains with the rule, its version, the evidence and the scoring inputs", async () => {
    const { service } = bench();
    const [conditional] = await service.file(runRow());

    const explanation = await service.explain(WORKSPACE, WORKFLOW, DRY_RUN, conditional.id);

    expect(explanation.rule).toMatchObject({
      id: "skipped-nothing-to-do",
      version: 1,
      packVersion: RULE_PACK_VERSION,
    });
    expect(explanation.rule?.firesWhen).toContain("nothing to do");
    expect(explanation.rule?.scoring?.strength).toContain("0.95");
    expect(explanation.evidence).toMatchObject({ stage_key: "exploit-verify", skip_input: "cve" });
    expect(explanation.confidence).toBe(93);
    expect(explanation.confidenceBasis.inputs).toMatchObject({
      rule_strength: 0.95,
      sample_adequacy: 0.98,
    });
    expect(explanation.proposedOps).toEqual(SEEDED_CONDITIONAL_OPS);

    await expect(service.explain(WORKSPACE, WORKFLOW, DRY_RUN, "nope")).rejects.toMatchObject({
      code: DRY_RUN_SUGGESTION_ERRORS.notFound,
    });
  });
});

describe("Apply", () => {
  it("applies the operations as one suggestion batch and answers the new revision: v0.3 → v0.4", async () => {
    const { service, suggestions, batches, trx, rows } = bench();
    const [conditional] = await service.file(runRow());

    const applied = await service.apply(WORKSPACE, WORKFLOW, DRY_RUN, conditional.id, "user-1");

    expect(applied.draftRev).toBe(4);
    expect(applied.draftLabel).toBe("v0.4");
    expect(applied.etag).toBe(draftEtag((await suggestions.draft()) as WorkflowVersion));
    expect(applied.suggestion).toMatchObject({
      status: "applied",
      appliedOpBatchId: "batch-4",
      resolvedAt: AT.toISOString(),
    });
    expect(batches).toEqual([SEEDED_CONDITIONAL_OPS]);
    // The draft lock, the batch and the settlement share one transaction.
    expect(suggestions.lockDraft).toHaveBeenCalledWith(WORKFLOW, trx);
    expect(suggestions.applyBatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: DRY_RUN, session_id: SESSION }),
      conditional.id,
      "user-1",
      SEEDED_CONDITIONAL_OPS,
      trx,
    );
    expect(suggestions.markApplied).toHaveBeenCalledWith(conditional.id, "batch-4", "user-1", trx);
    expect(rows[0].status).toBe("applied");
  });

  it("surfaces a moved-on draft as a conflict and writes nothing", async () => {
    const { service, suggestions, moveDraft, rows } = bench();
    const [conditional] = await service.file(runRow());
    // Somebody removed the edge the suggestion rewires, in the canvas.
    moveDraft({
      ...SEEDED_DRAFT,
      edges: SEEDED_DRAFT.edges.filter(
        (edge) => !(edge.from === "test" && edge.to === "exploit-verify"),
      ),
    });

    await expect(
      service.apply(WORKSPACE, WORKFLOW, DRY_RUN, conditional.id, "user-1"),
    ).rejects.toMatchObject({
      code: DRY_RUN_SUGGESTION_ERRORS.conflict,
      details: { operation: 1, kind: "remove_edge", testedDraftRev: 3, draftRev: 4 },
    });
    expect(suggestions.applyBatch).not.toHaveBeenCalled();
    expect(suggestions.markApplied).not.toHaveBeenCalled();
    expect(rows[0].status).toBe("open");
  });

  it("still applies to a draft that moved without disturbing what the operations touch", async () => {
    const { service, moveDraft } = bench();
    const [conditional] = await service.file(runRow());
    moveDraft({ ...SEEDED_DRAFT, trigger: { event: "ticket_queued", conditions: {} } });

    const applied = await service.apply(WORKSPACE, WORKFLOW, DRY_RUN, conditional.id, null);

    expect(applied.draftLabel).toBe("v0.5");
  });

  it("refuses an advisory suggestion, a settled one, and one that does not exist", async () => {
    const { service, suggestions, rows } = bench({ run: runRow({ cost_cents: 480 }) });
    const filed = await service.file(runRow({ cost_cents: 480 }));
    const advisory = filed.find((row) => row.ruleId === "budget-proximity");
    expect(advisory?.applicable).toBe(false);

    await expect(
      service.apply(WORKSPACE, WORKFLOW, DRY_RUN, advisory?.id ?? "", "user-1"),
    ).rejects.toMatchObject({ code: DRY_RUN_SUGGESTION_ERRORS.notApplicable });

    await service.apply(WORKSPACE, WORKFLOW, DRY_RUN, rows[0].id, "user-1");
    await expect(
      service.apply(WORKSPACE, WORKFLOW, DRY_RUN, rows[0].id, "user-1"),
    ).rejects.toMatchObject({
      code: DRY_RUN_SUGGESTION_ERRORS.resolved,
      details: { status: "applied" },
    });
    expect(suggestions.applyBatch).toHaveBeenCalledTimes(1);

    await expect(
      service.apply(WORKSPACE, WORKFLOW, DRY_RUN, "nope", "user-1"),
    ).rejects.toMatchObject({ code: DRY_RUN_SUGGESTION_ERRORS.notFound });
  });
});

describe("Ignore", () => {
  it("persists, and is final", async () => {
    const { service, rows } = bench();
    const [conditional] = await service.file(runRow());

    const ignored = await service.ignore(WORKSPACE, WORKFLOW, DRY_RUN, conditional.id, "user-1");

    expect(ignored).toMatchObject({ status: "ignored", appliedOpBatchId: null });
    expect(rows[0]).toMatchObject({ status: "ignored", resolved_by: "user-1" });
    await expect(
      service.ignore(WORKSPACE, WORKFLOW, DRY_RUN, conditional.id, "user-1"),
    ).rejects.toMatchObject({ code: DRY_RUN_SUGGESTION_ERRORS.resolved });
    await expect(
      service.apply(WORKSPACE, WORKFLOW, DRY_RUN, conditional.id, "user-1"),
    ).rejects.toMatchObject({ code: DRY_RUN_SUGGESTION_ERRORS.resolved });
    await expect(service.ignore(WORKSPACE, WORKFLOW, DRY_RUN, "nope", null)).rejects.toMatchObject({
      code: DRY_RUN_SUGGESTION_ERRORS.notFound,
    });
  });

  it("says what a suggestion became when it was settled between the read and the write", async () => {
    const { service, suggestions } = bench();
    const [conditional] = await service.file(runRow());
    suggestions.markIgnored.mockResolvedValueOnce(undefined);

    await expect(
      service.ignore(WORKSPACE, WORKFLOW, DRY_RUN, conditional.id, "user-1"),
    ).rejects.toMatchObject({ code: DRY_RUN_SUGGESTION_ERRORS.resolved });
  });
});

describe("a suggestion the copilot proposes", () => {
  const PROVENANCE = { sessionId: SESSION, alias: "coder-max", resolutionVersion: "z1-v1" };
  const OPS = [{ kind: "remove_edge", params: { from: "test", to: "exploit-verify" } }];

  it("is validated as operations, labelled llm, and never scored", async () => {
    const { service, rows } = bench();
    await service.file(runRow());

    const outcome = await service.propose(
      WORKSPACE,
      WORKFLOW,
      { title: "  Detach exploit-verify ", body: "It never has anything to check.", ops: OPS },
      PROVENANCE,
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.suggestion).toMatchObject({
      source: "llm",
      ruleId: null,
      ruleVersion: null,
      title: "Detach exploit-verify",
      confidence: null,
      confidenceBasis: {
        method: LLM_UNSCORED,
        inputs: { alias: "coder-max", resolution_version: "z1-v1", validated_ops: 1 },
      },
      applicable: true,
    });
    expect(rows.at(-1)?.evidence).toMatchObject({
      session_id: SESSION,
      alias: "coder-max",
      dry_run_id: DRY_RUN,
      tested_draft_rev: 3,
    });
    // Distinguishable from the rules' in the same list.
    const listed = await service.list(WORKSPACE, WORKFLOW, DRY_RUN);
    expect(listed.suggestions.map((row) => row.source)).toEqual(["rule", "rule", "llm"]);
    const explanation = await service.explain(WORKSPACE, WORKFLOW, DRY_RUN, outcome.suggestion.id);
    expect(explanation.rule).toBeNull();
    expect(explanation.confidence).toBeNull();
  });

  it("refuses operations that do not fit the draft, with the validator's sentence", async () => {
    const { service, suggestions } = bench();

    const outcome = await service.propose(
      WORKSPACE,
      WORKFLOW,
      {
        title: "Drop ghost",
        body: "Gone.",
        ops: [{ kind: "remove_stage", params: { id: "ghost" } }],
      },
      PROVENANCE,
    );

    expect(outcome).toMatchObject({ ok: false });
    if (outcome.ok) return;
    expect(outcome.message).toContain("operation 1 (remove_stage) does not fit the draft");
    expect(suggestions.insert).not.toHaveBeenCalled();
  });

  it("refuses a blank or oversized proposal, one with no or too many operations, and one with no dry run", async () => {
    const { service, suggestions } = bench();
    const refused = async (proposal: { title: string; body: string; ops: typeof OPS }) => {
      const outcome = await service.propose(WORKSPACE, WORKFLOW, proposal, PROVENANCE);
      expect(outcome.ok).toBe(false);
      return outcome.ok ? "" : outcome.message;
    };

    expect(await refused({ title: " ", body: "b", ops: OPS })).toContain("needs a title");
    expect(await refused({ title: "t", body: "", ops: OPS })).toContain("needs a title");
    expect(await refused({ title: "t".repeat(201), body: "b", ops: OPS })).toContain(
      "needs a title",
    );
    expect(await refused({ title: "t", body: "b".repeat(2001), ops: OPS })).toContain(
      "needs a title",
    );
    expect(await refused({ title: "t", body: "b", ops: [] })).toContain("1 to 50 operations");
    expect(
      await refused({ title: "t", body: "b", ops: Array.from({ length: 51 }, () => OPS[0]) }),
    ).toContain("1 to 50 operations");

    suggestions.latestForSession.mockResolvedValue(undefined);
    expect(await refused({ title: "t", body: "b", ops: OPS })).toContain("no finished dry run");
    expect(suggestions.insert).not.toHaveBeenCalled();
  });
});

describe("what the copilot is told about a finished dry run", () => {
  it("lists the rows with their skip kinds and the rules' suggestions, and forbids a confidence", async () => {
    const { service } = bench();
    await service.file(runRow());

    const text = await service.debriefing(runRow());

    expect(text).toContain("reported by the system, not typed by the user");
    expect(text).toContain('draft v0.3 against #489 ("CAN arbitration-lost storm');
    expect(text).toContain("ended complete: cost $0.31, guards clean.");
    expect(text).toContain(
      "- exploit-verify: skipped (skipped) [nothing_to_do: cve] — no PoC exists: stage had nothing to do",
    );
    expect(text).toContain("- open-pr: not_reached (deterministic)\n");
    expect(text).toContain("- Make exploit-verify conditional (rule skipped-nothing-to-do)");
    expect(text).toContain("do not repeat them");
    expect(text).toContain("no confidence");
  });

  it("says when no rule spoke, when the run was unpriced, and when a guard had to hold", async () => {
    const { service, suggestions } = bench();
    suggestions.forRun.mockResolvedValue([]);

    const text = await service.debriefing(
      runRow({ status: "budget_stopped", cost_cents: null, guards_clean: false }),
    );

    expect(text).toContain("ended budget_stopped: cost unpriced, guards NOT clean.");
    expect(text).toContain("The rule pack made no suggestion.");
  });

  it("has nothing to say about a run without results, or whose ticket is gone", async () => {
    const { service, dryRuns } = bench();

    expect(await service.debriefing(runRow({ status: "failed" }))).toBeUndefined();
    dryRuns.ticket.mockResolvedValue(undefined);
    expect(await service.debriefing(runRow())).toBeUndefined();
  });
});
