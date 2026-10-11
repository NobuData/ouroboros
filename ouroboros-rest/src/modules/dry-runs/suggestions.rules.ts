/**
 * The suggestion rule pack — CD.5 ([#563](https://github.com/NobuData/ouroboros/issues/563)).
 *
 * The callouts under a dry run propose to change a workflow, so each is **arithmetic over the
 * run's own rows**, not an observation: a rule reads what the run recorded, stores what it
 * computed (`evidence`), builds the typed operations Apply executes (`proposedOps`, in V110's
 * vocabulary) and scores itself from inputs it stores beside the figure.
 *
 * ```
 * rule            fires when                                         proposes
 * ──────────────  ─────────────────────────────────────────────────  ───────────────────────────
 * skipped-        a stage skipped with `skip_kind: nothing_to_do`     a `has-<input>` decision
 * nothing-to-do                                                       ahead of it (the 93% card)
 * budget-         the run spent ≥ 80% of its cap, or stopped at it    raise the cap or trim the
 * proximity                                                           costliest stage (advisory)
 * unresolved-     a stage skipped on a reference (W7) the draft       the nearest name that
 * reference-      still does not resolve                              exists, else advisory
 * persists
 * reviewer-       review replays exist **and** ≥ half disagree on     the shared skill on both
 * disagreement    style, more than on substance                       reviewers (the 81% card)
 * ```
 *
 * **Confidence = rule strength × sample adequacy**, rounded to a whole percent — and it cannot
 * be produced any other way: {@link score} is the only constructor of a {@link RuleScore}, it
 * takes both factors, and it refuses a factor outside `(0, 1]`. The basis it returns carries the
 * rule, its version, both factors and whatever else the rule counted, so *Explain* shows the
 * derivation.
 *
 * **A rule whose data does not exist produces nothing.** `reviewer-disagreement` reads
 * `review_replay_pairs`, which CF.5 (#574) fills; with no replays there is no finding, and so no
 * card with placeholder numbers.
 *
 * **Adding a rule is a pack entry**: one {@link SuggestionRule} in {@link RULE_PACK}, with its
 * fixtures in `suggestions.rules.spec.ts`. Changing what an existing rule computes bumps that
 * rule's `version`; adding or removing a rule bumps {@link RULE_PACK_VERSION}.
 *
 * Pure: no database, no clock.
 */

import type {
  DryRunConfidenceBasis,
  DryRunStage,
  DryRunStatus,
  StoredDraftOperation,
} from "../db/schema";
import { asDraftDocument, nearest, type DraftDocument } from "../copilot/copilot.operations";
import type { UnresolvedReference } from "../copilot/copilot.references";
import { DslWarningCode } from "../workflows/dsl.errors";
import type { DslCatalogue } from "../workflows/dsl.references";
import type { DryRunBudget } from "./dry-runs.budget";

/** The pack's version — bumped when a rule is added or removed. */
export const RULE_PACK_VERSION = 1;

/** How every rule's confidence is scored; the basis's `method`. */
export const SCORING_METHOD = "rule_strength_x_sample_adequacy";

/**
 * The adequacy of one observed run: the outcome is certain, but a single ticket cannot show the
 * stage *always* behaves so.
 */
export const SINGLE_RUN_ADEQUACY = 0.98;

/** The adequacy of a replacement name that is close, not certain. */
export const NEAR_NAME_ADEQUACY = 0.9;

/** The share of its cap a run must spend before `budget-proximity` speaks. */
export const BUDGET_PROXIMITY_THRESHOLD = 0.8;

/** The fewest replayed pairs `reviewer-disagreement` will draw a conclusion from. */
export const MIN_REPLAY_PAIRS = 5;

/** The share of pairs that must disagree on style before the rule fires. */
export const STYLE_DISAGREEMENT_THRESHOLD = 0.5;

/** The skill a style-class reviewer disagreement is answered with. */
export const REVIEW_STYLE_SKILL = "pr-etiquette";

/** The statuses a rule reads — a run that ended with results. */
export const RULE_STATUSES: readonly DryRunStatus[] = ["complete", "budget_stopped"];

/** One replay set's totals — `review_replay_pairs`, counted. */
export interface ReplayStatistics {
  readonly replaySet: string;
  /** The two reviewer stages, as the draft names them. */
  readonly reviewerStages: readonly string[];
  readonly pairs: number;
  readonly styleDisagreements: number;
  readonly substanceDisagreements: number;
}

/** Everything a rule may read. */
export interface RuleInput {
  /** How the run ended, and what it cost (`null` when unpriced). */
  readonly run: { readonly status: DryRunStatus; readonly costCents: number | null };
  /** The run's result rows, in card order. */
  readonly stages: readonly DryRunStage[];
  /** The ticket the run was against. */
  readonly ticket: { readonly key: string; readonly labels: readonly string[] };
  /** The draft as it stands — what the operations must apply to. */
  readonly draft: unknown;
  /** The run's budget. */
  readonly budget: DryRunBudget;
  /** The names that exist. */
  readonly catalogue: DslCatalogue;
  /** The draft's W7 references that still resolve to nothing. */
  readonly unresolved: readonly UnresolvedReference[];
  /** The newest review replay of this workflow, or `null` when there is none. */
  readonly replay: ReplayStatistics | null;
}

/** A confidence with the inputs that produced it — only {@link score} makes one. */
export interface RuleScore {
  /** 0–100. */
  readonly confidence: number;
  readonly basis: DryRunConfidenceBasis;
}

/** What a fired rule computed. */
export interface RuleFinding {
  readonly title: string;
  readonly body: string;
  /** Stage keys, counts, samples — what *Explain* shows. */
  readonly evidence: Record<string, unknown>;
  /** The operations Apply executes; empty on an advisory finding. */
  readonly proposedOps: StoredDraftOperation[];
  readonly score: RuleScore;
}

/** One entry of the pack. */
export interface SuggestionRule {
  /** `skipped-nothing-to-do`. */
  readonly id: string;
  /** Bumped when what the rule computes changes. */
  readonly version: number;
  /** When it fires, in a sentence — *Explain*'s first line. */
  readonly firesWhen: string;
  /** What it proposes, in a sentence. */
  readonly proposes: string;
  /** How its two factors are chosen, in a sentence each. */
  readonly scoring: { readonly strength: string; readonly adequacy: string };
  /**
   * Read a run.
   *
   * @param input - The run and its surroundings.
   * @returns One finding per thing it found; empty when it does not fire.
   */
  evaluate(input: RuleInput): RuleFinding[];
}

/**
 * Score a finding: `round(strength × adequacy × 100)`, with both factors in the basis.
 *
 * @param rule - The rule scoring itself.
 * @param strength - How strongly the rule's trigger implies its proposal, in `(0, 1]`.
 * @param adequacy - How adequate the sample behind this finding is, in `(0, 1]`.
 * @param inputs - What else the rule counted, stored beside the factors.
 * @returns The confidence and its basis.
 * @throws {RangeError} When a factor is not a number in `(0, 1]` — a rule cannot score without
 *   a basis.
 */
export function score(
  rule: Pick<SuggestionRule, "id" | "version">,
  strength: number,
  adequacy: number,
  inputs: Record<string, unknown> = {},
): RuleScore {
  for (const [name, factor] of [
    ["rule strength", strength],
    ["sample adequacy", adequacy],
  ] as const) {
    if (!Number.isFinite(factor) || factor <= 0 || factor > 1) {
      throw new RangeError(`${rule.id}: ${name} must be in (0, 1], got ${String(factor)}`);
    }
  }

  return {
    confidence: Math.round(strength * adequacy * 100),
    basis: {
      method: SCORING_METHOD,
      inputs: {
        rule: rule.id,
        rule_version: rule.version,
        rule_strength: strength,
        sample_adequacy: adequacy,
        ...inputs,
      },
    },
  };
}

/** A node of the draft, read loosely. */
interface LooseNode {
  readonly id: string;
  readonly position?: { readonly x?: unknown; readonly y?: unknown };
  readonly config?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

/** An edge of the draft, read loosely. */
interface LooseEdge {
  readonly from: string;
  readonly to: string;
  readonly [key: string]: unknown;
}

/**
 * The draft's nodes that carry an id.
 *
 * @param document - The draft.
 * @returns The nodes, in document order.
 */
function nodesOf(document: DraftDocument): LooseNode[] {
  return document.nodes.filter(
    (node): node is LooseNode =>
      node !== null && typeof node === "object" && typeof (node as LooseNode).id === "string",
  );
}

/**
 * The draft's edges that name both ends.
 *
 * @param document - The draft.
 * @returns The edges, in document order.
 */
function edgesOf(document: DraftDocument): LooseEdge[] {
  return document.edges.filter(
    (edge): edge is LooseEdge =>
      edge !== null &&
      typeof edge === "object" &&
      typeof (edge as LooseEdge).from === "string" &&
      typeof (edge as LooseEdge).to === "string",
  );
}

/**
 * Cents as the card prints them.
 *
 * @param cents - A whole number of cents.
 * @returns `$4.31`.
 */
export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Where a decision placed ahead of a stage sits: halfway between the stage and what leads to it.
 *
 * @param stage - The stage.
 * @param predecessor - The first stage leading to it, when it has a position.
 * @returns The position, or the stage's own when there is nothing to halve.
 */
function between(stage: LooseNode, predecessor: LooseNode | undefined): { x: number; y: number } {
  const at = (node: LooseNode | undefined): { x: number; y: number } | undefined =>
    typeof node?.position?.x === "number" && typeof node.position.y === "number"
      ? { x: node.position.x, y: node.position.y }
      : undefined;
  const here = at(stage) ?? { x: 0, y: 0 };
  const before = at(predecessor);

  return before === undefined
    ? here
    : { x: Math.round((here.x + before.x) / 2), y: Math.round((here.y + before.y) / 2) };
}

/**
 * `skipped-nothing-to-do` — the mockup's 93% card.
 *
 * A stage that ran into nothing to do names the input it missed (`cve`). The proposal puts a
 * `has-<input>` decision ahead of it: tickets carrying the label go through the stage, the rest
 * go straight to whatever followed it — so the next dry run skips it *by configuration*.
 */
export const SKIPPED_NOTHING_TO_DO: SuggestionRule = {
  id: "skipped-nothing-to-do",
  version: 1,
  firesWhen:
    "A stage was skipped because it had nothing to do, and named the input the ticket lacks.",
  proposes:
    "A decision ahead of the stage that routes tickets without that label around it (advisory when the draft cannot take one).",
  scoring: {
    strength: "0.95 — the skip is a recorded, deterministic outcome of the stage itself.",
    adequacy: "0.98 — observed in one dry run against one ticket.",
  },
  evaluate(input) {
    const document = asDraftDocument(input.draft);
    const nodes = nodesOf(document);
    const edges = edgesOf(document);

    return input.stages
      .filter((stage) => stage.verdict === "skipped" && stage.skip_kind === "nothing_to_do")
      .flatMap((stage): RuleFinding[] => {
        const missing = stage.skip_input;
        const node = nodes.find((candidate) => candidate.id === stage.stage_key);
        const decision = missing === null ? null : `has-${missing}`;
        // A draft that already holds the decision has the predicate: nothing to propose.
        if (decision !== null && nodes.some((candidate) => candidate.id === decision)) return [];

        const incoming = node === undefined ? [] : edges.filter((edge) => edge.to === node.id);
        const outgoing = node === undefined ? [] : edges.filter((edge) => edge.from === node.id);
        const proposedOps: StoredDraftOperation[] = [];

        if (missing !== null && decision !== null && node !== undefined && incoming.length > 0) {
          const carries = { kind: "labels", op: "any", values: [missing] };
          const lacks = { kind: "labels", op: "none", values: [missing] };
          const first = nodes.find((candidate) => candidate.id === incoming[0].from);

          proposedOps.push({
            kind: "add_stage",
            params: {
              node: {
                id: decision,
                type: "flow",
                title: `has ${missing.toUpperCase()}?`,
                position: between(node, first),
                config: { kind: "decision", predicate: carries },
              },
            },
          });
          for (const edge of incoming) {
            proposedOps.push(
              { kind: "remove_edge", params: { from: edge.from, to: node.id } },
              { kind: "add_edge", params: { edge: { ...edge, to: decision } } },
            );
          }
          proposedOps.push({
            kind: "add_edge",
            params: {
              edge: {
                from: decision,
                to: node.id,
                kind: "branch",
                label: missing,
                condition: carries,
              },
            },
          });
          for (const edge of outgoing) {
            proposedOps.push({
              kind: "add_edge",
              params: {
                edge: {
                  from: decision,
                  to: edge.to,
                  kind: "branch",
                  label: `no ${missing}`,
                  condition: lacks,
                },
              },
            });
          }
        }

        const trigger = (document.trigger ?? {}) as { conditions?: { labels?: unknown } };
        const triggerLabels = Array.isArray(trigger.conditions?.labels)
          ? trigger.conditions.labels
          : [];
        const because =
          missing === null
            ? `it had nothing to do on ${input.ticket.key}`
            : `it had nothing to do because ${input.ticket.key} carries no \`${missing}\` label`;
        const remedy =
          missing === null
            ? "Give it a condition, so it skips cleanly instead of running with nothing to check."
            : `Route issues without \`${missing}\` around it, so it skips cleanly instead of running with nothing to check.`;

        return [
          {
            title: `Make ${stage.stage_key} conditional`,
            body: `Make ${stage.stage_key} conditional — ${because}. ${remedy}`,
            evidence: {
              stage_key: stage.stage_key,
              verdict: stage.verdict,
              skip_kind: stage.skip_kind,
              skip_input: missing,
              skip_reason: stage.skip_reason,
              ticket: input.ticket.key,
              ticket_labels: [...input.ticket.labels],
              trigger_labels: triggerLabels,
            },
            proposedOps,
            score: score(this, 0.95, SINGLE_RUN_ADEQUACY, {
              outcome: "skipped_nothing_to_do",
              deterministic: true,
              observations: 1,
            }),
          },
        ];
      });
  },
};

/**
 * `budget-proximity` — the run consumed most of its cap, or stopped at it.
 *
 * Advisory: the cap is a workspace setting or a copilot guard, not a draft operation, and
 * removing a stage is not something to propose from one run's bill.
 */
export const BUDGET_PROXIMITY: SuggestionRule = {
  id: "budget-proximity",
  version: 1,
  firesWhen: "The run spent at least 80% of its cap, or stopped because it reached it.",
  proposes:
    "Raising the cap or trimming the costliest stage, with the run's actual figures (advisory — nothing to apply).",
  scoring: {
    strength: "0.9 — the figures are measured, the remedy is a judgement.",
    adequacy: "0.98 — observed in one dry run against one ticket.",
  },
  evaluate(input) {
    const { capCents } = input.budget;
    const spent = input.run.costCents;
    const stopped = input.run.status === "budget_stopped";
    if (spent === null || capCents <= 0) return [];

    const ratio = spent / capCents;
    if (!stopped && ratio < BUDGET_PROXIMITY_THRESHOLD) return [];

    const costliest = input.stages
      .map((stage) => ({ key: stage.stage_key, cents: stage.metrics.cost_cents }))
      .filter((stage): stage is { key: string; cents: number } => typeof stage.cents === "number")
      .sort((a, b) => b.cents - a.cents)
      .at(0);
    const percent = Math.round(ratio * 100);
    const spentLine = stopped
      ? `This run stopped at its ${dollars(capCents)} cap after spending ${dollars(spent)}`
      : `This run spent ${dollars(spent)} of its ${dollars(capCents)} cap (${String(percent)}%)`;
    const remedy =
      costliest === undefined
        ? "Raise the cap or trim a stage before the next run."
        : `${costliest.key} was the costliest stage at ${dollars(costliest.cents)} — raise the cap or trim that stage before the next run.`;

    return [
      {
        title:
          costliest === undefined
            ? "Raise the dry-run cap or trim a stage"
            : `Raise the dry-run cap or trim ${costliest.key}`,
        body: `${spentLine}. ${remedy}`,
        evidence: {
          status: input.run.status,
          cost_cents: spent,
          cap_cents: capCents,
          cap_source: input.budget.source,
          ratio: Number(ratio.toFixed(4)),
          costliest_stage: costliest?.key ?? null,
          costliest_stage_cents: costliest?.cents ?? null,
        },
        proposedOps: [],
        score: score(this, 0.9, SINGLE_RUN_ADEQUACY, {
          cost_cents: spent,
          cap_cents: capCents,
          threshold: BUDGET_PROXIMITY_THRESHOLD,
          budget_stopped: stopped,
          observations: 1,
        }),
      },
    ];
  },
};

/** What each W7 warning is about, in the body's words, and where the names that exist live. */
const REFERENCE_KINDS: Record<
  string,
  { readonly noun: string; readonly candidates: (catalogue: DslCatalogue) => readonly string[] }
> = {
  [DslWarningCode.REFERENCE_UNKNOWN_SKILL]: {
    noun: "skill",
    candidates: (catalogue) => catalogue.skills ?? [],
  },
  [DslWarningCode.REFERENCE_UNKNOWN_TASK]: {
    noun: "task route",
    candidates: (catalogue) => catalogue.tasks ?? [],
  },
  [DslWarningCode.REFERENCE_UNKNOWN_ALIAS]: {
    noun: "alias",
    candidates: (catalogue) => catalogue.aliases ?? [],
  },
};

/**
 * A node with the value at a document pointer replaced.
 *
 * @param node - The node.
 * @param path - An RFC 6901 pointer from the document root — `/nodes/3/config/skill`.
 * @param value - The replacement.
 * @returns A copy of the node with the value set, or `undefined` when the pointer does not lead
 *   into the node.
 */
function withValueAt(node: LooseNode, path: string, value: string): LooseNode | undefined {
  // `/nodes/<index>/…` — the part after the node is what is walked.
  const segments = path.split("/").slice(3);
  if (segments.length === 0) return undefined;

  const copy = structuredClone(node) as Record<string, unknown>;
  let cursor = copy;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (next === null || typeof next !== "object") return undefined;
    cursor = next as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]] = value;

  return copy as LooseNode;
}

/**
 * `unresolved-reference-persists` — a W7 warning survived the run: a stage skipped because a
 * reference did not resolve, and the draft still names it.
 */
export const UNRESOLVED_REFERENCE_PERSISTS: SuggestionRule = {
  id: "unresolved-reference-persists",
  version: 1,
  firesWhen:
    "A stage was skipped because a skill, task route or alias it names does not resolve, and the draft still names it.",
  proposes:
    "The nearest name this workspace defines, when one is close; otherwise resolving or removing the reference (advisory).",
  scoring: {
    strength: "0.95 — an unresolved reference never runs; that is how the stage was skipped.",
    adequacy:
      "0.9 when a near name is proposed (close is not certain); 0.98 for the advisory finding.",
  },
  evaluate(input) {
    const document = asDraftDocument(input.draft);
    const nodes = nodesOf(document);
    const skipped = new Set(
      input.stages
        .filter(
          (stage) => stage.verdict === "skipped" && stage.skip_kind === "unresolved_reference",
        )
        .map((stage) => stage.stage_key),
    );

    return input.unresolved
      .filter((reference) => skipped.has(reference.node))
      .flatMap((reference): RuleFinding[] => {
        const kind = REFERENCE_KINDS[reference.code] as
          (typeof REFERENCE_KINDS)[string] | undefined;
        if (kind === undefined) return [];

        const replacement = nearest(reference.name, kind.candidates(input.catalogue));
        const node = nodes.find((candidate) => candidate.id === reference.node);
        const replaced =
          replacement === undefined || node === undefined
            ? undefined
            : withValueAt(node, reference.path, replacement);
        const remedy =
          replaced === undefined || replacement === undefined
            ? "Create it or remove the reference before promoting"
            : `Use \`${replacement}\`, the closest ${kind.noun} this workspace defines, or create \`${reference.name}\` before promoting`;

        return [
          {
            title: `Resolve ${reference.name} on ${reference.node}`,
            body: `${reference.node} was skipped because the ${kind.noun} \`${reference.name}\` does not resolve. ${remedy} — an unresolved reference never runs.`,
            evidence: {
              stage_key: reference.node,
              reference_kind: kind.noun,
              reference: reference.name,
              warning_code: reference.code,
              path: reference.path,
              nearest: replacement ?? null,
            },
            proposedOps:
              replaced === undefined ? [] : [{ kind: "set_stage", params: { node: replaced } }],
            score: score(
              this,
              0.95,
              replaced === undefined ? SINGLE_RUN_ADEQUACY : NEAR_NAME_ADEQUACY,
              { reference: reference.name, nearest: replacement ?? null, observations: 1 },
            ),
          },
        ];
      });
  },
};

/**
 * `reviewer-disagreement` — the mockup's 81% card. Dormant until CF.5 (#574) records replays:
 * with no `review_replay_pairs` there is no finding.
 */
export const REVIEWER_DISAGREEMENT: SuggestionRule = {
  id: "reviewer-disagreement",
  version: 1,
  firesWhen:
    "Review replays exist for this workflow, at least five pairs were replayed, and at least half disagreed on style — more than on substance.",
  proposes: `Loading the shared \`${REVIEW_STYLE_SKILL}\` skill into both reviewer stages (advisory when the workspace does not define it).`,
  scoring: {
    strength: "0.9 — style-class disagreement in at least half the replayed pairs.",
    adequacy: "1 − 1/n over the n replayed pairs: ten pairs score 0.9.",
  },
  evaluate(input) {
    const replay = input.replay;
    if (replay === null || replay.pairs < MIN_REPLAY_PAIRS) return [];

    const rate = replay.styleDisagreements / replay.pairs;
    if (
      rate < STYLE_DISAGREEMENT_THRESHOLD ||
      replay.styleDisagreements <= replay.substanceDisagreements
    ) {
      return [];
    }

    const nodes = nodesOf(asDraftDocument(input.draft));
    const reviewers = [...replay.reviewerStages]
      .sort()
      .map((id) => nodes.find((node) => node.id === id));
    // The replay is about stages this draft no longer has: nothing to say about it.
    if (reviewers.some((node) => node === undefined)) return [];

    const present = reviewers as LooseNode[];
    if (present.every((node) => node.config?.skill === REVIEW_STYLE_SKILL)) return [];

    const defined = (input.catalogue.skills ?? []).includes(REVIEW_STYLE_SKILL);

    return [
      {
        title: `Pin the ${REVIEW_STYLE_SKILL} skill to both reviewers`,
        body: `Pin the ${REVIEW_STYLE_SKILL} skill to both reviewers — ${String(replay.styleDisagreements)} of ${String(replay.pairs)} replayed review pairs disagreed on comment style, not substance.`,
        evidence: {
          stage_keys: present.map((node) => node.id),
          replay_set: replay.replaySet,
          pairs_replayed: replay.pairs,
          style_disagreements: replay.styleDisagreements,
          substance_disagreements: replay.substanceDisagreements,
          skill: REVIEW_STYLE_SKILL,
        },
        proposedOps: defined
          ? present.map((node) => ({
              kind: "set_stage",
              params: {
                node: {
                  ...node,
                  config: { ...node.config, mode: "skill", skill: REVIEW_STYLE_SKILL },
                },
              },
            }))
          : [],
        score: score(this, 0.9, 1 - 1 / replay.pairs, {
          replay_set: replay.replaySet,
          pairs: replay.pairs,
          style_disagreements: replay.styleDisagreements,
          substance_disagreements: replay.substanceDisagreements,
          disagreement_rate: Number(rate.toFixed(4)),
        }),
      },
    ];
  },
};

/** The pack, in the order its suggestions are filed. */
export const RULE_PACK: readonly SuggestionRule[] = [
  SKIPPED_NOTHING_TO_DO,
  BUDGET_PROXIMITY,
  UNRESOLVED_REFERENCE_PERSISTS,
  REVIEWER_DISAGREEMENT,
];

/** A finding with the rule that made it. */
export interface PackFinding extends RuleFinding {
  readonly rule: SuggestionRule;
}

/**
 * Run the whole pack over one dry run.
 *
 * @param input - The run and its surroundings.
 * @param pack - The rules — the shipped pack unless a test supplies its own.
 * @returns Every finding, in pack order; empty for a run that did not end with results.
 */
export function evaluatePack(
  input: RuleInput,
  pack: readonly SuggestionRule[] = RULE_PACK,
): PackFinding[] {
  if (!RULE_STATUSES.includes(input.run.status)) return [];

  return pack.flatMap((rule) => rule.evaluate(input).map((finding) => ({ ...finding, rule })));
}

/**
 * A rule of the pack, by id.
 *
 * @param id - `skipped-nothing-to-do`.
 * @returns The rule, or `undefined` for an id this pack does not hold (a retired rule's
 *   suggestion keeps its id and version in the record).
 */
export function ruleById(id: string): SuggestionRule | undefined {
  return RULE_PACK.find((rule) => rule.id === id);
}
