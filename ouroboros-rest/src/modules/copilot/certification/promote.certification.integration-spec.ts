/**
 * The promote gate, certified against the planes that enforce it (CD.6,
 * [#564](https://github.com/NobuData/ouroboros/issues/564)).
 *
 * **Promote** is two requests: `GET …/copilot/promotion` — what the dialog shows: the version
 * about to exist, each guard with where it is really enforced, the references that do not
 * resolve — and the workflow's own `POST …/publish`, which runs the two-validator gate and
 * closes the conversation as `promoted`. **Discard** is `POST …/copilot/discard`.
 *
 * **What a guard is held against.** CE.1 (#565) decided that a guard is not compiled into new
 * configuration on promote — DSL v1 has no guard construct — and this suite asserts what is
 * built, on the plane that decides, never on the document's text:
 *
 *   * `never auto-merge` is a property of the published graph. The plane that decides whether a
 *     pull request may merge without an administrator is the merge executor, which reads the
 *     **run's pinned version** (`runs.workflow_tag` + `workflow_version_pin`); the plane that
 *     decides whether a person must review is the guardrail evaluation, which reads the same
 *     pin. A seeded loop's run is re-pinned to the version this suite published, and both are
 *     asked — and asked again with a version that *does* auto-merge, which they must treat
 *     differently, or the first answer proved nothing.
 *   * `spend cap $X/run` is honoured by dry runs and by nothing else yet (per-run enforcement
 *     on real runs is #237). The suite asserts the cap the engine is actually sent, and pins
 *     the honesty: the promotion never reports the spend guard as `enforced`. A change that
 *     claimed real-run enforcement without building it turns this suite red.
 *
 * Drafts are built in conversation, through the scripted engine, so the session, its transcript
 * and the `set_guard` proposal on a reply's trace are the ones the product wrote.
 */

import type { Transaction } from "kysely";
import type request from "supertest";

import type { Person } from "../../../testing/harness.fixture";
import { memberOf } from "../../../testing/registry.seed.fixture";
import { DatabaseService } from "../../db/db.service";
import { SCHEMA_NAME, type Database } from "../../db/schema";
import { GuardrailService } from "../../guardrails/guardrails.service";
import { COPILOT_ERRORS } from "../copilot.errors";
import { SPEND_GUARD_ENFORCED_BY } from "../copilot.promotion";
import type {
  CopilotConversationResource,
  CopilotDiscardResource,
  CopilotPromotionResource,
} from "../copilot.resources";
import {
  IMPLEMENT_NODE,
  TEST_NODE,
  TRIGGER,
  ofKind,
  startCopilotStage,
  type CopilotStage,
  type Exchange,
  type StagedWorkflow,
} from "./certification.fixture";
import {
  delta,
  done,
  runOf,
  stage as stageRow,
  toolCall,
  usage,
  type WireEvent,
} from "./scripted-engine.fixture";

/** The cap the conversation sets — `$5/run`, mockup 20's. */
const CAP_CENTS = 500;

/** The trigger node every draft here starts from. */
const START = {
  id: "start",
  type: "trigger",
  title: "Ticket queued",
  position: { x: 40, y: 200 },
  config: {},
} as const;

/** An ending that hands the pull request to a person. */
const REVIEW_END = {
  id: "hand-off",
  type: "term",
  title: "Needs review",
  position: { x: 820, y: 200 },
  config: { action: "needs_review", options: {} },
} as const;

/** An ending that merges on its own. */
const AUTOMERGE_END = {
  id: "hand-off",
  type: "term",
  title: "Open PR and auto-merge",
  position: { x: 820, y: 200 },
  config: { action: "open_pr_automerge", options: { merge_method: "squash", delete_branch: true } },
} as const;

/** `IMPLEMENT_NODE` with its routing or mode changed — what the reference cases vary. */
function implementWith(config: Record<string, unknown>): Record<string, unknown> {
  return { ...IMPLEMENT_NODE, config: { ...IMPLEMENT_NODE.config, ...config } };
}

/** A default edge. */
function edge(from: string, to: string): WireEvent {
  return toolCall(`edge-${from}-${to}`, "add_edge", { edge: { from, to, kind: "default" } });
}

/** The calls that build `start → implement → hand-off`, with the stage and the ending given. */
function graph(
  ending: Record<string, unknown> | null,
  implement: Record<string, unknown> = { ...IMPLEMENT_NODE },
): WireEvent[] {
  return [
    toolCall("trigger", "set_trigger", { trigger: TRIGGER }),
    toolCall("start", "add_stage", { node: START }),
    toolCall("implement", "add_stage", { node: implement }),
    edge("start", "implement"),
    ...(ending === null
      ? []
      : [toolCall("ending", "add_stage", { node: ending }), edge("implement", "hand-off")]),
  ];
}

/** The copilot's `$5 a run` — a proposal on the reply's trace, never in the document. */
function spendGuardCall(capCents: number = CAP_CENTS): WireEvent {
  return toolCall("guard", "set_guard", {
    guard: "spend_guard",
    params: { per_run_cap_cents: capCents },
  });
}

/** What a publish refused with. */
interface PublishRefusal {
  readonly code: string;
  readonly details?: { readonly findings?: readonly { readonly code: string }[] };
}

/** A seeded loop's pull request, and the run whose pin decides what may merge it. */
interface SeededLoop {
  readonly prId: string;
  readonly runId: string;
  readonly revisionId: string;
}

/** The fields of `GET …/merge-plan` this suite reads. */
interface MergePlanRead {
  readonly armed: boolean;
  readonly dryRun: {
    readonly autoMerge: { readonly requested: boolean; readonly effective: boolean };
  };
  readonly autoMergePolicy: { readonly eligible: boolean; readonly version: number | null };
}

describe("copilot certification — the promote gate (#564)", () => {
  let stage: CopilotStage;
  let admin: Person;
  let serial = 0;

  beforeAll(async () => {
    stage = await startCopilotStage();
    admin = await memberOf(stage.api, stage.workspace, "admin");
  });

  afterAll(async () => {
    expect(stage.engine.strays).toEqual([]);
    await stage.close();
  });

  beforeEach(() => {
    stage.engine.reset();
  });

  const copilot = (workflowId: string, tail: string): string =>
    `/api/v1/workflows/${workflowId}/copilot/${tail}`;

  /**
   * A workflow nobody else in this suite touches, created as **+ New workflow** creates one: a
   * name and nothing else. Every draft this suite publishes is built on that blank canvas by
   * the copilot's operations alone (#1744).
   */
  async function fresh(about: string): Promise<StagedWorkflow> {
    serial += 1;

    return stage.workflow(`Promote ${String(serial)} ${about}`);
  }

  /**
   * One exchange: the copilot makes the calls, then says it is done.
   *
   * @returns The stream, every proposal in it accounted for — a call that bounced fails here,
   *   naming the validator's sentence, so no later assertion runs against a draft that was never
   *   built.
   */
  async function converse(
    workflowId: string,
    sessionId: string,
    calls: readonly WireEvent[],
  ): Promise<Exchange> {
    stage.engine.script(
      [delta("On it. "), ...calls, usage(120, 30, 2), done("tool_use")],
      [delta("Done."), usage(40, 6, 1), done()],
    );

    const exchange = await stage.say(workflowId, sessionId, "Build it as we discussed.");

    expect(exchange.status).toBe(201);
    expect(
      ofKind(exchange.events, "operation").map((event) => ({
        kind: event.op.kind,
        outcome: event.outcome,
        why: event.validatorMessage,
      })),
    ).toEqual(
      calls.map((call) => ({
        kind: call.tool,
        outcome: call.tool === "set_guard" ? "proposed" : "applied",
        why: null,
      })),
    );

    return exchange;
  }

  /** A workflow with a conversation that built the given draft. */
  async function drafted(
    about: string,
    calls: readonly WireEvent[],
  ): Promise<{ workflow: StagedWorkflow; session: string }> {
    const workflow = await fresh(about);
    const session = await stage.session(workflow.id);

    await converse(workflow.id, session, calls);

    return { workflow, session };
  }

  /** What the promote dialog reads. */
  async function promotion(
    workflowId: string,
    as: Person = stage.people.owner,
  ): Promise<CopilotPromotionResource> {
    const read = await stage.as(as, "get", copilot(workflowId, "promotion")).expect(200);

    return read.body as CopilotPromotionResource;
  }

  /** The conversation, as the card reads it. */
  async function conversation(workflowId: string): Promise<CopilotConversationResource> {
    const read = await stage
      .as(stage.people.viewer, "get", copilot(workflowId, "conversation"))
      .expect(200);

    return read.body as CopilotConversationResource;
  }

  /** Publish — the second half of **Promote**. */
  function publish(workflowId: string, as: Person = stage.people.owner): request.Test {
    return stage.as(as, "post", `/api/v1/workflows/${workflowId}/publish`).send({});
  }

  /** The published versions of a workflow, lowest first. */
  async function versions(workflowId: string): Promise<{ version: number; definition: unknown }[]> {
    const { rows } = await stage.api.sql.query<{ version: number; definition: unknown }>(
      `select version, definition from ${SCHEMA_NAME}.workflow_versions
        where workflow_id = $1 and version is not null order by version`,
      [workflowId],
    );

    return rows;
  }

  /** A session's status, from the row. */
  async function sessionStatus(sessionId: string): Promise<string | undefined> {
    const row = await stage.one<{ status: string }>(
      `select status from ${SCHEMA_NAME}.copilot_sessions where id = $1`,
      [sessionId],
    );

    return row?.status;
  }

  /** The workspace's own dry-run cap, defaults resolved. */
  async function workspaceCapCents(): Promise<number> {
    const row = await stage.one<{ dry_run_cap_cents: number }>(
      `select dry_run_cap_cents from ${SCHEMA_NAME}.workspace_settings_effective
        where organization_id = $1`,
      [stage.workspace.id],
    );
    if (row === undefined) throw new Error("The workspace has no effective settings row.");

    return row.dry_run_cap_cents;
  }

  /** Dry-run the draft once and answer the run cap the engine was sent, in cents. */
  async function dryRunCapSent(workflowId: string): Promise<unknown> {
    const sentBefore = stage.engine.runs.length;

    stage.engine.scriptRun((sent) => runOf(sent, [stageRow(1, "implement")]));
    const run = await stage.dryRun(workflowId);

    expect(run.status).toBe("complete");
    expect(stage.engine.runs).toHaveLength(sentBefore + 1);

    return (stage.engine.runs[sentBefore]?.budget as { run_cost_cents?: unknown } | undefined)
      ?.run_cost_cents;
  }

  /* ---------------------------------------------------------------- the enforcement planes */

  /** A seeded loop whose pull request is still open — the run the planes are asked about. */
  async function seededLoop(): Promise<SeededLoop> {
    const row = await stage.one<{ pr_id: string; run_id: string; revision_id: string }>(
      `select p.id as pr_id, p.run_id, v.id as revision_id
         from ${SCHEMA_NAME}.pull_requests p
         join ${SCHEMA_NAME}.runs r on r.id = p.run_id and r.organization_id = p.organization_id
         join lateral (select v.id from ${SCHEMA_NAME}.pr_revisions v
                        where v.pr_id = p.id order by v.revision_seq desc limit 1) v on true
        where p.organization_id = $1 and p.state not in ('merged', 'closed')
        order by p.external_number limit 1`,
      [stage.workspace.id],
    );
    if (row === undefined) throw new Error("The seeds hold no open pull request opened by a run.");

    return { prId: row.pr_id, runId: row.run_id, revisionId: row.revision_id };
  }

  /** Pin a run to a published version, as dispatch pins one: the workflow's tag and the number. */
  async function pin(loop: SeededLoop, workflow: StagedWorkflow, version: number): Promise<void> {
    const { rowCount } = await stage.api.sql.query(
      `update ${SCHEMA_NAME}.runs set workflow_tag = $2, workflow_version_pin = $3 where id = $1`,
      [loop.runId, workflow.slug, version],
    );

    expect(rowCount).toBe(1);
  }

  /**
   * The guardrail plane's `review_required` verdict for a run, as an evaluation would record it.
   *
   * The real service over the real rows, inside a transaction that is rolled back: the verdict
   * is read, and the seeded run's evaluation history is left as it was.
   */
  async function reviewVerdict(
    loop: SeededLoop,
  ): Promise<{ verdict: string; detail: string | null }> {
    class ReadOnly extends Error {}
    const guardrails = stage.api.nest.get(GuardrailService);
    let found: { verdict: string; detail: string | null } | undefined;

    await stage.api.nest
      .get(DatabaseService)
      .transaction(async (trx: Transaction<Database>) => {
        const known = await trx
          .selectFrom("guardrail_evaluations")
          .select("id")
          .where("run_id", "=", loop.runId)
          .execute();
        const seq = await trx
          .selectFrom("runs")
          .select("change_set_seq")
          .where("id", "=", loop.runId)
          .executeTakeFirstOrThrow();

        await guardrails.evaluate(trx, {
          runId: loop.runId,
          changeSetSeq: Math.max(seq.change_set_seq, 1),
          files: 1,
          changeSet: [],
        });

        const rows = await trx
          .selectFrom("guardrail_evaluations")
          .select(["id", "verdict", "evidence"])
          .where("run_id", "=", loop.runId)
          .where("check", "=", "review_required")
          .execute();
        const written = rows.filter((row) => !known.some((before) => before.id === row.id));

        expect(written).toHaveLength(1);
        const row = written[0];
        if (row !== undefined) {
          const detail = (row.evidence as { detail?: unknown } | null)?.detail;
          found = { verdict: row.verdict, detail: typeof detail === "string" ? detail : null };
        }

        throw new ReadOnly();
      })
      .catch((error: unknown) => {
        if (!(error instanceof ReadOnly)) throw error;
      });

    if (found === undefined) throw new Error("The evaluation wrote no review_required verdict.");

    return found;
  }

  /** The merge plan's read: what the pinned workflow asks for, and what happens. */
  async function mergePlan(loop: SeededLoop): Promise<MergePlanRead> {
    const read = await stage
      .as(stage.people.owner, "get", `/api/v1/pull-requests/${loop.prId}/merge-plan`)
      .expect(200);

    return read.body as MergePlanRead;
  }

  /** A member — not an administrator — asking to arm the merge. */
  function memberArms(loop: SeededLoop): request.Test {
    return stage
      .as(stage.people.member, "post", `/api/v1/pull-requests/${loop.prId}/merge-plan/arm`)
      .send({ revisionId: loop.revisionId });
  }

  /* ------------------------------------------------------------------------------- the gate */

  describe("validation runs", () => {
    it("refuses to publish a draft with no ending, names the finding and publishes nothing", async () => {
      const { workflow, session } = await drafted("no ending", graph(null));

      const refused = await publish(workflow.id).expect(422);
      const body = refused.body as PublishRefusal;

      expect(body.code).toBe("workflow_definition_invalid");
      expect(body.details?.findings?.map((finding) => finding.code)).toContain(
        "document.no_terminal",
      );
      expect(await versions(workflow.id)).toEqual([]);
      // A refused promote closes nothing: the conversation is still the place to fix it.
      expect(await sessionStatus(session)).toBe("active");
      expect((await promotion(workflow.id)).publishes.version).toBe(1);
    });

    it("says before the press that a draft with no ending or an unreachable stage is blocked (#1745)", async () => {
      const noEnding = await drafted("no ending read", graph(null));
      const unreachable = await drafted("unreachable read", [
        ...graph(REVIEW_END),
        toolCall("orphan", "add_stage", { node: TEST_NODE }),
      ]);

      const first = await promotion(noEnding.workflow.id);
      expect(first.blocked).toBe(true);
      expect(first.blockedReasons).toEqual([expect.stringMatching(/terminal node/)]);

      const second = await promotion(unreachable.workflow.id);
      expect(second.blocked).toBe(true);
      expect(second.blockedReasons).toEqual([expect.stringMatching(/^Stage `test`: /)]);
      // …and publish agrees with both.
      await publish(noEnding.workflow.id).expect(422);
      await publish(unreachable.workflow.id).expect(422);
    });

    it("refuses a draft whose stage nothing leads to", async () => {
      const { workflow } = await drafted("unreachable", [
        ...graph(REVIEW_END),
        toolCall("orphan", "add_stage", { node: TEST_NODE }),
      ]);

      const refused = await publish(workflow.id).expect(422);

      expect(
        (refused.body as PublishRefusal).details?.findings?.map((finding) => finding.code),
      ).toContain("node.unreachable");
      expect(await versions(workflow.id)).toEqual([]);
    });

    it("says there is nothing to promote for a workflow with no draft, and publish agrees", async () => {
      const workflow = await fresh("no draft");
      await stage.session(workflow.id);
      await stage.as(stage.people.owner, "post", copilot(workflow.id, "discard")).expect(200);

      const read = await promotion(workflow.id);

      expect(read.draft.present).toBe(false);
      expect(read.blocked).toBe(true);
      expect(read.blockedReasons).toHaveLength(1);
      expect((await publish(workflow.id)).status).toBe(409);
      expect(await versions(workflow.id)).toEqual([]);
    });

    it("publishes a draft that validates, as the version the dialog named, and closes the conversation as promoted", async () => {
      const { workflow, session } = await drafted("valid", graph(REVIEW_END));
      const before = await promotion(workflow.id);
      const drafted_ = await stage.draft(workflow.id);

      expect(before).toMatchObject({
        publishes: { version: 1, label: `${workflow.slug} v1` },
        draft: { present: true },
        session: { id: session, status: "active" },
        blocked: false,
        blockedReasons: [],
      });

      const published = await publish(workflow.id).expect(200);

      expect((published.body as { version: number }).version).toBe(1);
      // The document that was validated is the document that became immutable.
      expect(await versions(workflow.id)).toEqual([
        { version: 1, definition: drafted_.definition },
      ]);
      expect(await sessionStatus(session)).toBe("promoted");

      const after = await promotion(workflow.id);

      expect(after.session).toEqual({ id: session, status: "promoted" });
      expect(after.publishes.version).toBe(2);
    });
  });

  describe("never auto-merge, on the planes that decide a merge", () => {
    it("holds for a run pinned to the promoted version — and not for one pinned to a version that auto-merges", async () => {
      const loop = await seededLoop();

      // The member may approve loops (#485), so the capability gate is not what answers below:
      // what is left between a member and the merge is the pinned workflow's ending.
      await stage.api.capability(stage.workspace.id, stage.people.member, true);

      // ── the promoted version: every ending hands the PR to a person ──────────────────────
      const guarded = await drafted("never auto-merge", graph(REVIEW_END));
      const dialog = await promotion(guarded.workflow.id);

      expect(dialog.guards.map((guard) => guard.id)).toEqual(["never_auto_merge"]);
      expect(dialog.guards[0]).toMatchObject({ source: "definition", enforcement: "enforced" });

      await publish(guarded.workflow.id).expect(200);
      await pin(loop, guarded.workflow, 1);

      // The merge plane: the pinned version asks for no auto-merge, so a member may not arm it.
      const held = await mergePlan(loop);

      expect(held.dryRun.autoMerge).toMatchObject({ requested: false, effective: false });

      const refused = await memberArms(loop).expect(403);

      expect(refused.body).toMatchObject({ code: "merge_not_policy_eligible" });
      expect((refused.body as { message: string }).message).toContain("does not auto-merge");
      // Refused by the workflow, not by an org policy rule: no rule is named.
      expect((refused.body as { details?: { ruleId?: string } }).details?.ruleId).toBeUndefined();
      expect((await mergePlan(loop)).armed).toBe(false);

      // The guardrail plane: the terminal policy routes this run to a person.
      const reviewed = await reviewVerdict(loop);

      expect(reviewed.verdict).toBe("pass");
      expect(reviewed.detail).toContain("routes this run to a person");

      // ── the counter-case: a version that ends in `open_pr_automerge` ─────────────────────
      const merging = await drafted("auto-merges", graph(AUTOMERGE_END));

      expect((await promotion(merging.workflow.id)).guards).toEqual([]);

      await publish(merging.workflow.id).expect(200);
      await pin(loop, merging.workflow, 1);

      const asked = await mergePlan(loop);

      expect(asked.dryRun.autoMerge.requested).toBe(true);
      expect(["not_applicable", "fail"]).toContain((await reviewVerdict(loop)).verdict);

      // The same member, the same PR, the same plane — and a different answer. The workflow now
      // allows the merge, so what refuses is no longer the pin but the workspace's published
      // `auto_merge` rule, which this seeded ticket does not meet; the refusal names the rule
      // and its version, where the guarded version's named none.
      expect(asked.autoMergePolicy.eligible).toBe(false);

      const ruled = await memberArms(loop).expect(403);

      expect(ruled.body).toMatchObject({
        code: "merge_not_policy_eligible",
        details: { ruleId: "auto_merge", policyVersion: asked.autoMergePolicy.version },
      });
      expect((ruled.body as { message: string }).message).not.toContain("does not auto-merge");

      // And back: re-pinned to the guarded version, the workflow is what refuses again.
      await pin(loop, guarded.workflow, 1);

      const again = await memberArms(loop).expect(403);

      expect((again.body as { message: string }).message).toContain("does not auto-merge");
      expect((await mergePlan(loop)).armed).toBe(false);
    });

    it("makes no never-auto-merge claim for a draft that does not end yet", async () => {
      const { workflow } = await drafted("endless", graph(null));

      expect((await promotion(workflow.id)).guards).toEqual([]);
    });
  });

  describe("the spend cap, where it is honoured", () => {
    it("is reported as dry-run-only — never as enforced — before and after promote, and dry runs are held to it", async () => {
      const workspaceCap = await workspaceCapCents();

      expect(CAP_CENTS).toBeLessThan(workspaceCap);

      const { workflow, session } = await drafted("spend cap", [
        ...graph(REVIEW_END),
        spendGuardCall(),
      ]);
      const expected = {
        id: "spend_guard",
        label: "spend cap $5.00/run",
        source: "conversation",
        enforcement: "dry_run_only",
        enforcedBy: SPEND_GUARD_ENFORCED_BY,
      };

      const before = await promotion(workflow.id);

      expect(before.guards.map((guard) => guard.id)).toEqual(["never_auto_merge", "spend_guard"]);
      expect(before.guards[1]).toEqual(expected);
      // The cap is on the reply's trace and nowhere in the document.
      expect(JSON.stringify((await stage.draft(workflow.id)).definition)).not.toContain(
        "per_run_cap_cents",
      );

      // The dry-run budget plane honours it: the engine is sent the guard, not the workspace's cap.
      expect(await dryRunCapSent(workflow.id)).toBe(CAP_CENTS);

      await publish(workflow.id).expect(200);
      expect(await sessionStatus(session)).toBe("promoted");

      // After promote the guard is still the promoted conversation's, still honest about where
      // it holds, and still what a dry run of this workflow is held to.
      const after = await promotion(workflow.id);

      expect(after.guards.find((guard) => guard.id === "spend_guard")).toEqual(expected);
      expect(await dryRunCapSent(workflow.id)).toBe(CAP_CENTS);

      // The honesty pin. Per-run spend is not enforced on real runs (#237); the day the read
      // says `enforced`, something must really enforce it — and this line is what asks.
      for (const read of [before, after]) {
        for (const guard of read.guards.filter((candidate) => candidate.id === "spend_guard")) {
          expect(guard.enforcement).not.toBe("enforced");
          expect(guard.enforcedBy).toContain("Not enforced on real runs yet");
        }
      }
      expect(JSON.stringify((await versions(workflow.id))[0]?.definition)).not.toContain(
        String(CAP_CENTS),
      );
    });

    it("leaves a dry run on the workspace's cap when the conversation that set the guard was discarded", async () => {
      const workspaceCap = await workspaceCapCents();
      const { workflow } = await drafted("discarded cap", [...graph(REVIEW_END), spendGuardCall()]);

      expect((await promotion(workflow.id)).guards.map((guard) => guard.id)).toContain(
        "spend_guard",
      );

      await stage.as(stage.people.owner, "post", copilot(workflow.id, "discard")).expect(200);

      expect((await promotion(workflow.id)).guards).toEqual([]);

      // A new conversation builds the same draft and sets no guard: nothing of the old one holds.
      const next = await stage.session(workflow.id);
      await converse(workflow.id, next, graph(REVIEW_END));

      expect((await promotion(workflow.id)).guards.map((guard) => guard.id)).toEqual([
        "never_auto_merge",
      ]);
      expect(await dryRunCapSent(workflow.id)).toBe(workspaceCap);
    });
  });

  describe("unresolved references block or flag, per policy (W7)", () => {
    it("blocks on an alias the registry does not hold: publish refuses it and nothing is published", async () => {
      const { workflow, session } = await drafted(
        "unknown alias",
        graph(REVIEW_END, implementWith({ routing: { pinned_model: { alias: "no-such-alias" } } })),
      );

      // The dialog says so before the press (#1745): the read checks the pin against the
      // workspace's registry, as the publish gate does.
      const read = await promotion(workflow.id);
      expect(read.references).toEqual([
        expect.objectContaining({
          code: "reference.unknown_alias",
          node: "implement",
          name: "no-such-alias",
          blocking: true,
        }),
      ]);
      expect(read.blocked).toBe(true);
      expect(read.blockedReasons).toEqual([
        "Stage `implement` pins the alias `no-such-alias`, which is not in this workspace's registry — publishing refuses it.",
      ]);

      const refused = await publish(workflow.id).expect(422);

      expect(
        (refused.body as PublishRefusal).details?.findings?.map((finding) => finding.code),
      ).toContain("reference.unknown_alias");
      expect(await versions(workflow.id)).toEqual([]);
      expect(await sessionStatus(session)).toBe("active");
    });

    it.each([
      [
        "skill",
        "reference.unknown_skill",
        "no-such-skill",
        implementWith({ mode: "skill", skill: "no-such-skill" }),
      ],
      [
        "task route",
        "reference.unknown_task",
        "no-such-task",
        implementWith({ routing: { inherit_task: "no-such-task" } }),
      ],
    ] as const)("flags an unknown %s and still publishes", async (_what, code, name, implement) => {
      const { workflow, session } = await drafted(`unknown ${name}`, graph(REVIEW_END, implement));

      const read = await promotion(workflow.id);

      expect(read.references).toEqual([
        expect.objectContaining({ code, node: "implement", name, blocking: false }),
      ]);
      expect(read.blocked).toBe(false);
      expect(read.blockedReasons).toEqual([]);

      await publish(workflow.id).expect(200);

      expect((await versions(workflow.id)).map((row) => row.version)).toEqual([1]);
      expect(await sessionStatus(session)).toBe("promoted");
    });

    it("reports no reference for a draft whose names all resolve", async () => {
      const { workflow } = await drafted("resolved", graph(REVIEW_END));

      expect((await promotion(workflow.id)).references).toEqual([]);
    });
  });

  describe("discard preserves the transcript", () => {
    it("drops the draft, keeps the unpublished workflow, closes the session and leaves the conversation readable", async () => {
      const { workflow, session } = await drafted("discard", [
        ...graph(REVIEW_END),
        spendGuardCall(),
      ]);
      const transcript = (await conversation(workflow.id)).messages;

      expect(transcript.map((message) => message.role)).toEqual(["user", "copilot"]);
      expect((await stage.draft(workflow.id)).definition).not.toBeNull();

      const discarded = await stage
        .as(stage.people.owner, "post", copilot(workflow.id, "discard"))
        .expect(200);
      const body = discarded.body as CopilotDiscardResource;

      expect(body).toMatchObject({
        workflowId: workflow.id,
        draftDiscarded: true,
        session: { id: session, status: "discarded" },
      });
      expect(body.session?.closedAt).not.toBeNull();

      // The draft is gone, the workflow is not: listed, unpublished, with nothing to promote.
      expect((await stage.draft(workflow.id)).definition).toBeNull();
      const kept = await stage.one<{
        current_version: number | null;
        draft_rev: number;
        ops: string;
      }>(
        `select w.current_version, w.draft_rev,
                (select count(*) from ${SCHEMA_NAME}.draft_operations o where o.workflow_id = w.id)::text as ops
           from ${SCHEMA_NAME}.workflows w where w.id = $1`,
        [workflow.id],
      );
      expect(kept).toEqual({ current_version: null, draft_rev: 0, ops: "0" });
      await stage.as(stage.people.owner, "get", `/api/v1/workflows/${workflow.id}`).expect(200);
      expect(await versions(workflow.id)).toEqual([]);

      // The transcript is whole, and read-only.
      const after = await conversation(workflow.id);

      expect(after.session).toMatchObject({ id: session, status: "discarded" });
      expect(after.messages).toEqual(transcript);

      const late = await stage.say(workflow.id, session, "One more thing.");

      expect(late.status).toBe(409);
      expect(late.refusal?.code).toBe(COPILOT_ERRORS.sessionClosed);
      expect(stage.engine.turns).toHaveLength(2);

      const again = await stage.as(stage.people.owner, "post", copilot(workflow.id, "discard"));

      expect(again.status).toBe(409);
      expect((again.body as { code?: string }).code).toBe(COPILOT_ERRORS.nothingToDiscard);
      expect((await conversation(workflow.id)).messages).toEqual(transcript);
    });

    it("lets a new conversation start on the discarded workflow, and its first operation applies cleanly", async () => {
      const { workflow, session } = await drafted("discard then restart", graph(REVIEW_END));

      await stage.as(stage.people.owner, "post", copilot(workflow.id, "discard")).expect(200);

      const next = await stage.session(workflow.id);

      expect(next).not.toBe(session);

      // The same stage ids as the discarded draft: an operation log that survived the discard
      // would bounce these as already there.
      const exchange = await converse(workflow.id, next, graph(REVIEW_END));
      const applied = ofKind(exchange.events, "operation");

      expect(applied[0]).toMatchObject({ outcome: "applied", draftRev: 1 });
      expect(
        ((await stage.draft(workflow.id)).definition as { nodes: { id: string }[] }).nodes.map(
          (node) => node.id,
        ),
      ).toEqual(["start", "implement", "hand-off"]);
      expect(await sessionStatus(session)).toBe("discarded");
      // The new conversation is the one the card reads now; it starts empty of the old one.
      expect((await conversation(workflow.id)).session.id).toBe(next);

      await publish(workflow.id).expect(200);
      expect(await sessionStatus(next)).toBe("promoted");
    });

    it("returns a published workflow to its published version", async () => {
      const { workflow } = await drafted("discard after publish", graph(REVIEW_END));

      await publish(workflow.id).expect(200);
      const [published] = await versions(workflow.id);

      const next = await stage.session(workflow.id);
      await converse(workflow.id, next, [toolCall("orphan", "add_stage", { node: TEST_NODE })]);

      await stage.as(stage.people.owner, "post", copilot(workflow.id, "discard")).expect(200);

      expect(await versions(workflow.id)).toEqual([published]);
      expect(
        await stage.one(`select current_version from ${SCHEMA_NAME}.workflows where id = $1`, [
          workflow.id,
        ]),
      ).toEqual({ current_version: 1 });
      expect((await stage.draft(workflow.id)).definition).toBeNull();
      expect(await sessionStatus(next)).toBe("discarded");
    });
  });

  describe("only owners and admins may discard or publish", () => {
    it("refuses a member and a viewer both, changing nothing, and allows an admin", async () => {
      const { workflow, session } = await drafted("roles", graph(REVIEW_END));
      const draft = await stage.draft(workflow.id);

      for (const person of [stage.people.member, stage.people.viewer]) {
        await stage.as(person, "post", copilot(workflow.id, "discard")).expect(403);
        await publish(workflow.id, person).expect(403);
        // Reading what a promotion would publish is every member's.
        expect((await promotion(workflow.id, person)).blocked).toBe(false);
      }

      expect(await stage.draft(workflow.id)).toEqual(draft);
      expect(await versions(workflow.id)).toEqual([]);
      expect(await sessionStatus(session)).toBe("active");

      await publish(workflow.id, admin).expect(200);
      expect(await sessionStatus(session)).toBe("promoted");

      const next = await stage.session(workflow.id);
      await stage.as(admin, "post", copilot(workflow.id, "discard")).expect(200);
      expect(await sessionStatus(next)).toBe("discarded");
    });
  });
});
