/**
 * Copilot certification — the suggestion rule pack and a suggestion's life (CD.6,
 * [#564](https://github.com/NobuData/ouroboros/issues/564)).
 *
 * The callouts under a dry run propose to change a workflow, and each prints a confidence. What
 * is certified here is that neither is ever decoration:
 *
 *   * **The matrix.** Every rule of the pack has a row that makes it speak and a row — its
 *     nearest miss — that keeps it silent, each driven through a real dry run: the scripted
 *     harness answers stage rows, the runner records them, the pack reads the record. The
 *     matrix is checked against `RULE_PACK` itself, so a rule added without both rows turns
 *     this suite red before anything else runs.
 *   * **Honest absence.** A rule whose data does not exist files nothing — in particular
 *     `reviewer-disagreement` without review replays.
 *   * **No invented figure.** Every emission's basis is compared whole with the inputs the row
 *     scripted, its confidence is recomputed from the two factors it stores, and every number
 *     its title, body and evidence print is one the row put there.
 *   * **The life of a suggestion.** Explain answers the derivation, Apply writes the proposed
 *     operations as one batch (or refuses: advisory, settled, a draft that moved on), Ignore is
 *     remembered for the draft revision, a viewer may do neither, and what the copilot proposes
 *     is validated and unscored.
 */

import { randomUUID } from "node:crypto";

import { SCHEMA_NAME } from "../../db/schema";
import { DRY_RUN_SUGGESTION_ERRORS } from "../../dry-runs/suggestions.errors";
import type {
  DryRunSuggestionAppliedResource,
  DryRunSuggestionExplanationResource,
  DryRunSuggestionResource,
} from "../../dry-runs/suggestions.resources";
import { RULE_PACK, RULE_PACK_VERSION } from "../../dry-runs/suggestions.rules";
import {
  IMPLEMENT_NODE,
  TRIGGER,
  startCopilotStage,
  type CopilotStage,
  type StagedWorkflow,
} from "./certification.fixture";
import {
  called,
  chain,
  drafted,
  dryRunsPath,
  modelStage,
  ran,
  suggestionsOf,
  type DraftNode,
} from "./dry-run-plane.fixture";
import {
  done,
  runOf,
  stage as row,
  toolCall,
  usage,
  type WireEvent,
  type WireRequest,
} from "./scripted-engine.fixture";

/** The basis method every rule scores by. */
const RULE_METHOD = "rule_strength_x_sample_adequacy";

/** The share of its cap a run must spend before the budget rule speaks, as the issue has it. */
const PROXIMITY = 0.8;

/** A stage that looks for a CVE reference — the mockup's skipped row. */
const CVE_CHECK = modelStage("cve-check", 560);

/** The two reviewers of a draft that has two. */
const REVIEWERS = [modelStage("review-primary", 560), modelStage("review-second", 820)] as const;

/** The skill the seeded workspace defines for review style. */
const STYLE_SKILL = "pr-etiquette";

/** A skill name one letter away from {@link STYLE_SKILL}. */
const NEAR_SKILL = "pr-etiquete";

/** A skill name near nothing the workspace defines. */
const FAR_SKILL = "zzqx-unheard-of-vvkw";

/** A skipped row, as the harness reports one. */
function skipped(seq: number, key: string, kind: string, input: string | null = null): WireEvent {
  return row(seq, key, {
    verdict: "skipped",
    how: "skipped",
    note: "skipped",
    skip_reason: `scripted: ${kind}`,
    skip_kind: kind,
    skip_input: input,
  });
}

/** The cap a dry-run request was sent, in cents. */
function capOf(request: WireRequest): number {
  const cap = (request.budget as { run_cost_cents?: unknown }).run_cost_cents;
  if (typeof cap !== "number") throw new Error("The dry-run request carried no run cap.");

  return cap;
}

/** Cents as the card prints them, less the sign: `4.31`. */
function printed(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** What a row knows once its run has been sent: the cap in force and the ticket's key. */
interface RowContext {
  readonly cap: number;
  readonly ticketKey: string;
}

/** What a positive row expects of the one suggestion its rule files. */
interface Emission {
  /** The rule's strength — what the pack's documentation says it is. */
  readonly strength: number;
  /** The sample's adequacy for this row. */
  readonly adequacy: number;
  /** The percentage mockup 20 prints on this card, where it shows the card. */
  readonly mockup?: number;
  /** Whether Apply has operations to execute. */
  readonly applicable: boolean;
  /** Everything the basis holds beside the rule, its version and the two factors. */
  inputs(context: RowContext): Record<string, unknown>;
  /** Every number the title, the body and the evidence may print. */
  figures(context: RowContext): readonly (number | string)[];
  /** What the draft must hold once the suggestion is applied — checked on an applicable row. */
  applied?(definition: { nodes: DraftNode[] }): void;
}

/** One row of the matrix: a draft, a scripted run, and what one rule makes of it. */
interface MatrixRow {
  readonly rule: string;
  readonly polarity: "positive" | "absence";
  readonly name: string;
  /** The draft under test. */
  readonly definition: Record<string, unknown>;
  /** What exists beside the run — review replays, say. */
  arrange?(stage: CopilotStage, workflow: StagedWorkflow): Promise<void>;
  /** The run the harness answers. */
  run(request: WireRequest): WireEvent[];
  /** On a positive row, the emission. */
  readonly emits?: Emission;
}

/**
 * Record review replays of a workflow: `style` pairs that disagreed on style, `substance` on
 * substance, and the rest agreeing.
 *
 * @returns The replay set's id.
 */
async function replayed(
  stage: CopilotStage,
  workflow: StagedWorkflow,
  counts: { pairs: number; style: number; substance: number },
  replaySet: string,
): Promise<void> {
  await stage.api.sql.query(
    `insert into ${SCHEMA_NAME}.review_replay_pairs
       (organization_id, workflow_id, replay_set, sample_ref, reviewer_stages, agreed,
        disagreement_class, replayed_at)
     select $1, $2, $3, 'sample-' || n, $4::text[], n > $5::int + $6::int,
            case when n <= $5::int then 'style' when n <= $5::int + $6::int then 'substance' end, now()
       from generate_series(1, $7::int) n`,
    [
      stage.workspace.id,
      workflow.id,
      replaySet,
      REVIEWERS.map((reviewer) => reviewer.id),
      counts.style,
      counts.substance,
      counts.pairs,
    ],
  );
}

/** The replay set of the reviewer rule's positive row. */
const REPLAY_SET = randomUUID();

/** A run in which every stage of a chain ran, at the scripted engine's default bill. */
const plain =
  (...keys: string[]) =>
  (request: WireRequest): WireEvent[] =>
    runOf(
      request,
      keys.map((key, index) => row(index + 1, key)),
    );

/** A node of the applied draft, by id. */
function nodeOf(definition: { nodes: DraftNode[] }, id: string): DraftNode | undefined {
  return definition.nodes.find((node) => node.id === id);
}

const MATRIX: readonly MatrixRow[] = [
  /* ---------------------------------------------------------------- skipped-nothing-to-do */
  {
    rule: "skipped-nothing-to-do",
    polarity: "positive",
    name: "a stage skipped with nothing to do, naming the label the ticket lacks",
    definition: chain(IMPLEMENT_NODE, CVE_CHECK),
    run: (request) =>
      runOf(request, [row(1, "implement"), skipped(2, "cve-check", "nothing_to_do", "cve")]),
    emits: {
      strength: 0.95,
      adequacy: 0.98,
      mockup: 93,
      applicable: true,
      inputs: () => ({ outcome: "skipped_nothing_to_do", deterministic: true, observations: 1 }),
      figures: () => [],
      applied: (definition) => {
        expect(nodeOf(definition, "has-cve")).toMatchObject({
          type: "flow",
          config: { kind: "decision", predicate: { kind: "labels", op: "any", values: ["cve"] } },
        });
      },
    },
  },
  {
    rule: "skipped-nothing-to-do",
    polarity: "positive",
    name: "a stage skipped with nothing to do that names no input — advice, with nothing to apply",
    definition: chain(IMPLEMENT_NODE, CVE_CHECK),
    run: (request) =>
      runOf(request, [row(1, "implement"), skipped(2, "cve-check", "nothing_to_do")]),
    emits: {
      strength: 0.95,
      adequacy: 0.98,
      applicable: false,
      inputs: () => ({ outcome: "skipped_nothing_to_do", deterministic: true, observations: 1 }),
      figures: () => [],
    },
  },
  {
    rule: "skipped-nothing-to-do",
    polarity: "absence",
    name: "the same stage skipped for another reason — its branch was not taken",
    definition: chain(IMPLEMENT_NODE, CVE_CHECK),
    run: (request) =>
      runOf(request, [row(1, "implement"), skipped(2, "cve-check", "branch_not_taken")]),
  },
  {
    rule: "skipped-nothing-to-do",
    polarity: "absence",
    name: "no stage skipped at all",
    definition: chain(IMPLEMENT_NODE, CVE_CHECK),
    run: plain("implement", "cve-check"),
  },

  /* --------------------------------------------------------------------- budget-proximity */
  {
    rule: "budget-proximity",
    polarity: "positive",
    name: "a run that spent exactly four fifths of its cap",
    definition: chain(IMPLEMENT_NODE, CVE_CHECK),
    run: (request) => {
      const spent = Math.ceil(capOf(request) * PROXIMITY);

      return runOf(
        request,
        [
          row(1, "implement", { metrics: { cost_cents: spent - 7 } }),
          row(2, "cve-check", { metrics: { cost_cents: 7 } }),
        ],
        { cost_cents: spent },
      );
    },
    emits: {
      strength: 0.9,
      adequacy: 0.98,
      applicable: false,
      inputs: ({ cap }) => ({
        cost_cents: Math.ceil(cap * PROXIMITY),
        cap_cents: cap,
        threshold: PROXIMITY,
        budget_stopped: false,
        observations: 1,
      }),
      figures: ({ cap }) => {
        const spent = Math.ceil(cap * PROXIMITY);

        return [
          spent,
          cap,
          spent - 7,
          Number((spent / cap).toFixed(4)),
          printed(spent),
          printed(cap),
          printed(spent - 7),
          String(Math.round((spent / cap) * 100)),
        ];
      },
    },
  },
  {
    rule: "budget-proximity",
    polarity: "positive",
    name: "a run the harness stopped at its budget, well short of four fifths",
    definition: chain(IMPLEMENT_NODE, CVE_CHECK),
    run: (request) =>
      runOf(request, [row(1, "implement", { metrics: { cost_cents: 11 } })], {
        status: "budget_stopped",
        failure_reason: "The stage budget was reached.",
        cost_cents: 11,
      }),
    emits: {
      strength: 0.9,
      adequacy: 0.98,
      applicable: false,
      inputs: ({ cap }) => ({
        cost_cents: 11,
        cap_cents: cap,
        threshold: PROXIMITY,
        budget_stopped: true,
        observations: 1,
      }),
      figures: ({ cap }) => [11, cap, Number((11 / cap).toFixed(4)), printed(11), printed(cap)],
    },
  },
  {
    rule: "budget-proximity",
    polarity: "absence",
    name: "a run one cent short of four fifths of its cap",
    definition: chain(IMPLEMENT_NODE, CVE_CHECK),
    run: (request) =>
      runOf(request, [row(1, "implement"), row(2, "cve-check")], {
        cost_cents: Math.ceil(capOf(request) * PROXIMITY) - 1,
      }),
  },
  {
    rule: "budget-proximity",
    polarity: "absence",
    name: "a run that carries no price",
    definition: chain(IMPLEMENT_NODE, CVE_CHECK),
    run: (request) =>
      runOf(request, [row(1, "implement"), row(2, "cve-check")], { cost_cents: null }),
  },

  /* -------------------------------------------------------- unresolved-reference-persists */
  {
    rule: "unresolved-reference-persists",
    polarity: "positive",
    name: "a stage skipped on a skill one letter from one the workspace defines",
    definition: chain(
      IMPLEMENT_NODE,
      modelStage("polish", 560, { mode: "skill", skill: NEAR_SKILL }),
    ),
    run: (request) =>
      runOf(request, [row(1, "implement"), skipped(2, "polish", "unresolved_reference")]),
    emits: {
      strength: 0.95,
      adequacy: 0.9,
      applicable: true,
      inputs: () => ({ reference: NEAR_SKILL, nearest: STYLE_SKILL, observations: 1 }),
      figures: () => [],
      applied: (definition) => {
        expect(nodeOf(definition, "polish")).toMatchObject({ config: { skill: STYLE_SKILL } });
      },
    },
  },
  {
    rule: "unresolved-reference-persists",
    polarity: "positive",
    name: "a stage skipped on a skill near nothing — advice, with nothing to apply",
    definition: chain(
      IMPLEMENT_NODE,
      modelStage("polish", 560, { mode: "skill", skill: FAR_SKILL }),
    ),
    run: (request) =>
      runOf(request, [row(1, "implement"), skipped(2, "polish", "unresolved_reference")]),
    emits: {
      strength: 0.95,
      adequacy: 0.98,
      applicable: false,
      inputs: () => ({ reference: FAR_SKILL, nearest: null, observations: 1 }),
      figures: () => [],
    },
  },
  {
    rule: "unresolved-reference-persists",
    polarity: "absence",
    name: "the same skip reported for a stage whose skill the workspace defines",
    definition: chain(
      IMPLEMENT_NODE,
      modelStage("polish", 560, { mode: "skill", skill: STYLE_SKILL }),
    ),
    run: (request) =>
      runOf(request, [row(1, "implement"), skipped(2, "polish", "unresolved_reference")]),
  },
  {
    rule: "unresolved-reference-persists",
    polarity: "absence",
    name: "a draft that names an undefined skill, on a run in which no stage skipped for it",
    definition: chain(
      IMPLEMENT_NODE,
      modelStage("polish", 560, { mode: "skill", skill: NEAR_SKILL }),
    ),
    run: (request) =>
      runOf(request, [row(1, "implement"), skipped(2, "polish", "branch_not_taken")]),
  },

  /* ---------------------------------------------------------------- reviewer-disagreement */
  {
    rule: "reviewer-disagreement",
    polarity: "positive",
    name: "ten replayed pairs, six disagreeing on style and none on substance",
    definition: chain(IMPLEMENT_NODE, ...REVIEWERS),
    arrange: (stage, workflow) =>
      replayed(stage, workflow, { pairs: 10, style: 6, substance: 0 }, REPLAY_SET),
    run: plain("implement", "review-primary", "review-second"),
    emits: {
      strength: 0.9,
      adequacy: 1 - 1 / 10,
      mockup: 81,
      applicable: true,
      inputs: () => ({
        replay_set: REPLAY_SET,
        pairs: 10,
        style_disagreements: 6,
        substance_disagreements: 0,
        disagreement_rate: 0.6,
      }),
      figures: () => [10, 6, 0, "10", "6"],
      applied: (definition) => {
        for (const reviewer of REVIEWERS) {
          expect(nodeOf(definition, reviewer.id)).toMatchObject({
            config: { mode: "skill", skill: STYLE_SKILL },
          });
        }
      },
    },
  },
  {
    rule: "reviewer-disagreement",
    polarity: "absence",
    name: "two reviewers and no review replay at all",
    definition: chain(IMPLEMENT_NODE, ...REVIEWERS),
    run: plain("implement", "review-primary", "review-second"),
  },
  {
    rule: "reviewer-disagreement",
    polarity: "absence",
    name: "four replayed pairs, every one disagreeing on style — one pair short of a sample",
    definition: chain(IMPLEMENT_NODE, ...REVIEWERS),
    arrange: (stage, workflow) =>
      replayed(stage, workflow, { pairs: 4, style: 4, substance: 0 }, randomUUID()),
    run: plain("implement", "review-primary", "review-second"),
  },
  {
    rule: "reviewer-disagreement",
    polarity: "absence",
    name: "ten replayed pairs, four disagreeing on style — one short of half",
    definition: chain(IMPLEMENT_NODE, ...REVIEWERS),
    arrange: (stage, workflow) =>
      replayed(stage, workflow, { pairs: 10, style: 4, substance: 0 }, randomUUID()),
    run: plain("implement", "review-primary", "review-second"),
  },
  {
    rule: "reviewer-disagreement",
    polarity: "absence",
    name: "ten replayed pairs disagreeing on substance as often as on style",
    definition: chain(IMPLEMENT_NODE, ...REVIEWERS),
    arrange: (stage, workflow) =>
      replayed(stage, workflow, { pairs: 10, style: 5, substance: 5 }, randomUUID()),
    run: plain("implement", "review-primary", "review-second"),
  },
];

/**
 * The rules a matrix leaves without a positive row or without an absence row.
 *
 * @param rules - The pack's rule ids.
 * @param rows - The matrix.
 * @returns `rule: polarity` for each missing half; empty when the matrix is complete.
 */
function uncovered(rules: readonly string[], rows: readonly MatrixRow[]): string[] {
  return rules.flatMap((rule) =>
    (["positive", "absence"] as const)
      .filter(
        (polarity) => !rows.some((entry) => entry.rule === rule && entry.polarity === polarity),
      )
      .map((polarity) => `${rule}: ${polarity}`),
  );
}

/**
 * Every number a text prints, as printed.
 *
 * @param text - A title or a body.
 * @returns `["4.31", "80"]`.
 */
function numbersIn(text: string): string[] {
  return text.match(/\d+(?:\.\d+)?/g) ?? [];
}

/**
 * Every number a JSON value holds, at any depth.
 *
 * @param value - The evidence, say.
 * @returns The numbers.
 */
function numbersOf(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (value === null || typeof value !== "object") return [];

  return Object.values(value).flatMap(numbersOf);
}

describe("copilot certification — the suggestion rule pack and a suggestion's life (#564)", () => {
  let stage: CopilotStage;
  let serial = 0;
  /** Every stray engine call of the suite; the engine forgets its own before each test. */
  const strays: string[] = [];

  beforeAll(async () => {
    stage = await startCopilotStage();
  });

  afterAll(async () => {
    await stage.close();
  });

  beforeEach(() => {
    stage.engine.reset();
  });

  afterEach(() => {
    strays.push(...stage.engine.strays);
  });

  /** A workflow of this suite, on a draft. */
  function workflowOn(definition: Record<string, unknown>): Promise<StagedWorkflow> {
    serial += 1;

    return drafted(stage, `Cert rules ${String(serial)}`, definition);
  }

  /** The route of one suggestion's action. */
  function actionPath(
    workflow: StagedWorkflow,
    suggestion: DryRunSuggestionResource,
    action: string,
  ) {
    return dryRunsPath(
      workflow.id,
      `/${suggestion.dryRunId}/suggestions/${suggestion.id}/${action}`,
    );
  }

  /** The mockup's skipped stage, run: the workflow, the run and the suggestion it files. */
  async function conditionalSuggestion(sessionId?: string, on?: StagedWorkflow) {
    const workflow = on ?? (await workflowOn(chain(IMPLEMENT_NODE, CVE_CHECK)));

    stage.engine.scriptRun((request) =>
      runOf(request, [row(1, "implement"), skipped(2, "cve-check", "nothing_to_do", "cve")]),
    );
    const run = await ran(stage, workflow.id, sessionId);
    const suggestions = await suggestionsOf(stage, workflow.id, run.id);

    expect(run.status).toBe("complete");

    return { workflow, run, suggestions };
  }

  /** The operations a suggestion's Apply recorded, in order. */
  async function recordedFor(suggestionId: string) {
    const { rows } = await stage.api.sql.query<{
      op: unknown;
      actor: string;
      actor_user_id: string | null;
      draft_rev: number;
      batch_id: string;
    }>(
      `select op, actor, actor_user_id, draft_rev, batch_id
         from ${SCHEMA_NAME}.draft_operations where suggestion_id = $1 order by seq`,
      [suggestionId],
    );

    return rows;
  }

  describe("the rule matrix", () => {
    it("holds a positive row and an honest-absence row for every rule of the pack", () => {
      const rules = RULE_PACK.map((rule) => rule.id);

      expect(rules.length).toBeGreaterThan(0);
      expect(uncovered(rules, MATRIX)).toEqual([]);
      // And no row is about a rule the pack does not hold.
      expect(MATRIX.filter((entry) => !rules.includes(entry.rule))).toEqual([]);

      // The control: take one rule's absence rows away and the check names it.
      const [first] = rules;
      expect(
        uncovered(
          rules,
          MATRIX.filter((entry) => !(entry.rule === first && entry.polarity === "absence")),
        ),
      ).toEqual([`${first}: absence`]);
      expect(uncovered([...rules, "a-rule-added-tomorrow"], MATRIX)).toEqual([
        "a-rule-added-tomorrow: positive",
        "a-rule-added-tomorrow: absence",
      ]);
    });

    it.each(MATRIX.map((entry) => [entry.rule, entry.polarity, entry.name, entry] as const))(
      "%s — %s: %s",
      async (_rule, _polarity, _name, entry) => {
        const workflow = await workflowOn(entry.definition);
        await entry.arrange?.(stage, workflow);
        stage.engine.scriptRun(entry.run);

        const run = await ran(stage, workflow.id);
        const filed = await suggestionsOf(stage, workflow.id, run.id);
        const [request] = stage.engine.runs;
        const context: RowContext = { cap: capOf(request), ticketKey: run.ticket.key };

        // The run ended with results — otherwise an empty card would prove nothing.
        expect(["complete", "budget_stopped"]).toContain(run.status);

        if (entry.emits === undefined) {
          // Honest absence: this rule is silent, and so is every other — the row holds no
          // other rule's data either.
          expect(filed).toEqual([]);
          return;
        }

        expect(filed.map((suggestion) => suggestion.ruleId)).toEqual([entry.rule]);
        const [suggestion] = filed;
        const rule = RULE_PACK.find((candidate) => candidate.id === entry.rule);
        const { strength, adequacy } = entry.emits;

        expect(suggestion).toMatchObject({
          source: "rule",
          ruleVersion: rule?.version,
          status: "open",
          applicable: entry.emits.applicable,
          // Confidence = rule strength × sample adequacy, to a whole percent.
          confidence: Math.round(strength * adequacy * 100),
        });
        // The basis, whole: the method, the two factors and what the row scripted — no more.
        expect(suggestion.confidenceBasis).toEqual({
          method: RULE_METHOD,
          inputs: {
            rule: entry.rule,
            rule_version: rule?.version,
            rule_strength: strength,
            sample_adequacy: adequacy,
            ...entry.emits.inputs(context),
          },
        });
        expect(suggestion.proposedOps.length > 0).toBe(entry.emits.applicable);
        if (entry.emits.mockup !== undefined)
          expect(suggestion.confidence).toBe(entry.emits.mockup);

        // Every number the card prints is one the row scripted (or the ticket's own key).
        const figures = entry.emits.figures(context);
        const text = `${suggestion.title} ${suggestion.body}`.replaceAll(context.ticketKey, "");
        expect(numbersIn(text).filter((printedNumber) => !figures.includes(printedNumber))).toEqual(
          [],
        );

        const explained = (
          await stage
            .as(stage.people.viewer, "get", actionPath(workflow, suggestion, "explanation"))
            .expect(200)
        ).body as DryRunSuggestionExplanationResource;

        expect(explained.confidenceBasis).toEqual(suggestion.confidenceBasis);
        expect(numbersOf(explained.evidence).filter((figure) => !figures.includes(figure))).toEqual(
          [],
        );

        // Apply does what `applicable` says: the operations fit the draft they were computed
        // for, or there is nothing to apply and the route says so.
        const applied = await stage
          .as(stage.people.owner, "post", actionPath(workflow, suggestion, "apply"))
          .send({});

        if (entry.emits.applicable) {
          expect(applied.status).toBe(200);
          entry.emits.applied?.(
            (await stage.draft(workflow.id)).definition as { nodes: DraftNode[] },
          );
        } else {
          expect(applied.status).toBe(409);
          expect((applied.body as { code: string }).code).toBe(
            DRY_RUN_SUGGESTION_ERRORS.notApplicable,
          );
        }
      },
    );
  });

  describe("a suggestion's life", () => {
    it("explains a rule's suggestion with the rule as the pack describes it, to any member", async () => {
      const { workflow, suggestions } = await conditionalSuggestion();
      const [suggestion] = suggestions;
      const rule = RULE_PACK.find((candidate) => candidate.id === suggestion.ruleId);

      const explained = (
        await stage
          .as(stage.people.viewer, "get", actionPath(workflow, suggestion, "explanation"))
          .expect(200)
      ).body as DryRunSuggestionExplanationResource;

      expect(rule).toBeDefined();
      expect(explained).toMatchObject({
        suggestionId: suggestion.id,
        source: "rule",
        rule: {
          id: rule?.id,
          version: rule?.version,
          packVersion: RULE_PACK_VERSION,
          firesWhen: rule?.firesWhen,
          proposes: rule?.proposes,
          scoring: rule?.scoring,
        },
        confidence: suggestion.confidence,
        confidenceBasis: suggestion.confidenceBasis,
        proposedOps: suggestion.proposedOps,
      });
      // The evidence is the row the harness reported, not a restatement of the card.
      expect(explained.evidence).toMatchObject({
        stage_key: "cve-check",
        verdict: "skipped",
        skip_kind: "nothing_to_do",
        skip_input: "cve",
        skip_reason: "scripted: nothing_to_do",
      });
    });

    it("applies the proposed operations as one batch by the person, on a draft that moved without disturbing them", async () => {
      const workflow = await workflowOn(chain(IMPLEMENT_NODE, CVE_CHECK));
      const session = await stage.session(workflow.id);
      const { run, suggestions } = await conditionalSuggestion(undefined, workflow);
      const [suggestion] = suggestions;

      // The draft moves on: a stage the suggestion's operations do not touch.
      expect(
        await called(stage, workflow.id, session, [
          "add_stage",
          { node: modelStage("notes", 300) },
        ]),
      ).toEqual(["applied"]);
      const moved = await stage.draft(workflow.id);
      expect(moved.draftRev).toBe(run.draft.rev + 1);

      const answered = await stage
        .as(stage.people.member, "post", actionPath(workflow, suggestion, "apply"))
        .send({})
        .expect(200);
      const applied = answered.body as DryRunSuggestionAppliedResource;
      const after = await stage.draft(workflow.id);
      const recorded = await recordedFor(suggestion.id);

      // One new revision, whatever the number of operations.
      expect(applied.draftRev).toBe(moved.draftRev + 1);
      expect(after.draftRev).toBe(moved.draftRev + 1);
      expect(applied.draftLabel).toBe(`v0.${String(after.draftRev)}`);
      expect(applied.suggestion).toMatchObject({ id: suggestion.id, status: "applied" });
      expect(applied.suggestion.resolvedAt).not.toBeNull();

      // The log holds exactly the proposed operations, as the suggestion's batch.
      expect(recorded.map((entry) => entry.op)).toEqual(suggestion.proposedOps);
      expect(new Set(recorded.map((entry) => entry.batch_id))).toEqual(
        new Set([applied.suggestion.appliedOpBatchId]),
      );
      for (const entry of recorded) {
        expect(entry).toMatchObject({
          actor: "suggestion",
          actor_user_id: stage.people.member.id,
          draft_rev: after.draftRev,
        });
      }

      // And the draft is what they produce: the decision ahead of the stage, both ways out.
      const definition = after.definition as {
        nodes: DraftNode[];
        edges: Record<string, unknown>[];
      };
      expect(nodeOf(definition, "has-cve")).toBeDefined();
      expect(nodeOf(definition, "notes")).toBeDefined();
      expect(definition.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ from: "implement", to: "has-cve" }),
          expect.objectContaining({ from: "has-cve", to: "cve-check", kind: "branch" }),
          expect.objectContaining({ from: "has-cve", to: "needs-review", kind: "branch" }),
        ]),
      );
      expect(definition.edges).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ from: "implement", to: "cve-check" })]),
      );

      // Settled is settled: neither Apply nor Ignore moves it again.
      for (const action of ["apply", "ignore"]) {
        const again = await stage
          .as(stage.people.owner, "post", actionPath(workflow, suggestion, action))
          .send({});

        expect(again.status).toBe(409);
        expect((again.body as { code: string }).code).toBe(DRY_RUN_SUGGESTION_ERRORS.resolved);
      }
      expect((await stage.draft(workflow.id)).draftRev).toBe(after.draftRev);
    });

    it("refuses to apply over a draft that moved on incompatibly, and writes nothing", async () => {
      const workflow = await workflowOn(chain(IMPLEMENT_NODE, CVE_CHECK));
      const session = await stage.session(workflow.id);
      const { run, suggestions } = await conditionalSuggestion(undefined, workflow);
      const [suggestion] = suggestions;

      // Somebody takes away the edge the suggestion's first rewiring removes.
      expect(
        await called(stage, workflow.id, session, [
          "remove_edge",
          { from: "implement", to: "cve-check" },
        ]),
      ).toEqual(["applied"]);
      const moved = await stage.draft(workflow.id);

      const refused = await stage
        .as(stage.people.owner, "post", actionPath(workflow, suggestion, "apply"))
        .send({});

      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({
        code: DRY_RUN_SUGGESTION_ERRORS.conflict,
        details: { kind: "remove_edge", testedDraftRev: run.draft.rev, draftRev: moved.draftRev },
      });

      // Nothing was written: the draft, the log and the suggestion are as they were.
      const after = await stage.draft(workflow.id);
      expect(after.draftRev).toBe(moved.draftRev);
      expect(after.definition).toEqual(moved.definition);
      expect(await recordedFor(suggestion.id)).toEqual([]);
      expect(
        (await suggestionsOf(stage, workflow.id, run.id)).map((entry) => entry.status),
      ).toEqual(["open"]);
    });

    it("remembers Ignore for the draft revision: the same finding is not filed again until the draft changes", async () => {
      const workflow = await workflowOn(chain(IMPLEMENT_NODE, CVE_CHECK));
      const session = await stage.session(workflow.id);

      // Twice on one revision, nothing ignored: the rule files its finding both times.
      const first = await conditionalSuggestion(undefined, workflow);
      const second = await conditionalSuggestion(undefined, workflow);
      expect(first.suggestions).toHaveLength(1);
      expect(second.suggestions).toHaveLength(1);
      expect(second.run.draft.rev).toBe(first.run.draft.rev);

      const ignored = (
        await stage
          .as(stage.people.member, "post", actionPath(workflow, second.suggestions[0], "ignore"))
          .send({})
          .expect(200)
      ).body as DryRunSuggestionResource;
      expect(ignored).toMatchObject({ id: second.suggestions[0].id, status: "ignored" });
      expect(ignored.resolvedAt).not.toBeNull();

      // The next run of the same revision: the same row, and no card.
      const third = await conditionalSuggestion(undefined, workflow);
      expect(third.run.draft.rev).toBe(first.run.draft.rev);
      expect(third.run.stages.map((entry) => entry.skipKind)).toContain("nothing_to_do");
      expect(third.suggestions).toEqual([]);
      // Ignoring one did not settle the other: the first run's is still open.
      expect(
        (await suggestionsOf(stage, workflow.id, first.run.id)).map((entry) => entry.status),
      ).toEqual(["open"]);

      // A new revision is a new question.
      expect(
        await called(stage, workflow.id, session, [
          "set_trigger",
          { trigger: { ...TRIGGER, conditions: { labels: ["bug", "security"] } } },
        ]),
      ).toEqual(["applied"]);
      const fourth = await conditionalSuggestion(undefined, workflow);
      expect(fourth.run.draft.rev).toBe(first.run.draft.rev + 1);
      expect(fourth.suggestions.map((entry) => entry.title)).toEqual([ignored.title]);
    });

    it("lets a viewer read and explain a suggestion, and neither apply nor ignore it", async () => {
      const { workflow, run, suggestions } = await conditionalSuggestion();
      const [suggestion] = suggestions;
      const before = await stage.draft(workflow.id);

      await stage
        .as(stage.people.viewer, "get", actionPath(workflow, suggestion, "explanation"))
        .expect(200);
      for (const action of ["apply", "ignore"]) {
        await stage
          .as(stage.people.viewer, "post", actionPath(workflow, suggestion, action))
          .send({})
          .expect(403);
      }

      expect((await stage.draft(workflow.id)).draftRev).toBe(before.draftRev);
      expect(
        (await suggestionsOf(stage, workflow.id, run.id)).map((entry) => entry.status),
      ).toEqual(["open"]);
    });

    it("files what the copilot proposes after a run as validated and unscored, and refuses what does not fit", async () => {
      const workflow = await workflowOn(chain(IMPLEMENT_NODE, CVE_CHECK));
      const session = await stage.session(workflow.id);
      const fits = { kind: "add_stage", params: { node: modelStage("changelog", 300) } };

      // The debrief exchange: one proposal whose operation names no stage, one that fits.
      stage.engine.script([
        toolCall("p1", "propose_suggestion", {
          title: "Wire a stage that is not there",
          body: "Join implement to a stage the draft does not hold.",
          ops: [
            {
              kind: "add_edge",
              params: { edge: { from: "implement", to: "nowhere", kind: "default" } },
            },
          ],
        }),
        toolCall("p2", "propose_suggestion", {
          title: "Add a changelog stage",
          body: "The run opened no changelog entry; add a stage that writes one.",
          ops: [fits],
        }),
        usage(200, 40, 2),
        done("tool_use"),
      ]);

      const { run } = await conditionalSuggestion(session, workflow);
      const deadline = Date.now() + 10_000;
      let filed: DryRunSuggestionResource[] = [];
      for (;;) {
        filed = await suggestionsOf(stage, workflow.id, run.id);
        const streaming = await stage.one<{ open: number }>(
          `select count(*)::int as open from ${SCHEMA_NAME}.copilot_messages
            where session_id = $1 and status = 'streaming'`,
          [session],
        );
        if (stage.engine.turns.length >= 2 && streaming?.open === 0) break;
        if (Date.now() > deadline) throw new Error("The debrief exchange did not finish.");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      filed = await suggestionsOf(stage, workflow.id, run.id);

      // The debrief was told the run's own rows, and that nobody typed them.
      expect(JSON.stringify(stage.engine.turns[0])).toContain("cve-check: skipped");

      const fromCopilot = filed.filter((entry) => entry.source === "llm");
      expect(filed.map((entry) => entry.source)).toEqual(["rule", "llm"]);
      expect(fromCopilot).toHaveLength(1);
      expect(fromCopilot[0]).toMatchObject({
        title: "Add a changelog stage",
        ruleId: null,
        ruleVersion: null,
        confidence: null,
        applicable: true,
        proposedOps: [fits],
        status: "open",
      });
      expect(fromCopilot[0].confidenceBasis.method).toBe("llm_unscored");
      expect(numbersOf(fromCopilot[0].confidenceBasis.inputs)).toEqual([1]);

      const explained = (
        await stage
          .as(stage.people.viewer, "get", actionPath(workflow, fromCopilot[0], "explanation"))
          .expect(200)
      ).body as DryRunSuggestionExplanationResource;
      expect(explained).toMatchObject({ source: "llm", rule: null, confidence: null });
      expect(explained.evidence).toMatchObject({
        session_id: session,
        dry_run_id: run.id,
        tested_draft_rev: run.draft.rev,
      });
    });

    it("never stores a confidence without a basis, nor a score on a copilot suggestion", async () => {
      const tally = await stage.one<{
        suggestions: number;
        rules: number;
        unscored: number;
        wrong: number;
      }>(
        `select count(*)::int as suggestions,
                count(*) filter (where s.source = 'rule')::int as rules,
                count(*) filter (where s.source = 'llm')::int as unscored,
                count(*) filter (
                  where (s.confidence is null) <> (s.source = 'llm')
                     or coalesce(s.confidence_basis ->> 'method', '') = ''
                     or coalesce(s.confidence_basis -> 'inputs', '{}'::jsonb) = '{}'::jsonb
                     or ((s.confidence_basis ->> 'method' = 'llm_unscored') <> (s.source = 'llm'))
                )::int as wrong
           from ${SCHEMA_NAME}.dry_run_suggestions s
           join ${SCHEMA_NAME}.dry_runs r on r.id = s.dry_run_id
           join ${SCHEMA_NAME}.workflows w on w.id = r.workflow_id
          where w.name like 'Cert rules %'`,
      );

      // Everything this suite caused to be filed, by either source.
      expect(tally?.rules).toBeGreaterThanOrEqual(MATRIX.filter((entry) => entry.emits).length);
      expect(tally?.unscored).toBe(1);
      expect(tally?.wrong).toBe(0);
    });

    it("called no engine route but the copilot's own", () => {
      expect(strays).toEqual([]);
    });
  });
});
