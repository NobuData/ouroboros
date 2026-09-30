/**
 * The proposer registry's vocabulary (BF.3, [#412](https://github.com/NobuData/ouroboros/issues/412),
 * decision **K5**): what a source looks like, what a proposer offers, and what became of it.
 *
 * **A candidate has no status.** {@link FactCandidate} names the text, the proposer, the typed
 * provenance and the category — and nothing a proposer could use to say `confirmed`.
 * {@link sealCandidate} is the only way a proposer's output reaches the writer, and it refuses an
 * object carrying any key it does not know (a `status` above all), so a future proposer cannot
 * add an auto-confirm path by returning one: K3's *"and you approve"* is asserted, not trusted.
 */

import type { FactProposer } from "../db/schema";
import type { FactProvenance } from "../facts/facts.resources";

/** The deterministic proposers — every kind but `manual` (a person) and `llm` (#423). */
export type DeterministicProposerKind = Extract<
  FactProposer,
  "correction_note" | "waiver" | "steer" | "import"
>;

/** The sources the proposer service loads by id — the import proposes inside its own apply. */
export type LoadableProposerKind = Exclude<DeterministicProposerKind, "import">;

/**
 * What kind of knowledge a candidate is — so the card can phrase it and a reviewer can weigh it.
 * A waiver's reason is `environment` (the rig, the farm, the network) or a known `limitation`.
 */
export type CandidateCategory = "convention" | "environment" | "limitation" | "instruction";

/** The candidate categories, for validation and documentation. */
export const CANDIDATE_CATEGORIES: readonly CandidateCategory[] = [
  "convention",
  "environment",
  "limitation",
  "instruction",
];

/**
 * The row a candidate came from — `classification:<uuid>`, `waiver:<uuid>`, `steer:<uuid>`, an
 * import's `<file>#<section>`, or (for the `/v0/learn` contract's `llm` proposer, #423) the
 * source bundle entry's kind and its first ref's id.
 */
export interface CandidateSource {
  readonly kind:
    | "classification"
    | "waiver"
    | "steer"
    | "import"
    | "pr_review_cycle"
    | "run_observation"
    | "correction_note";
  /** The row's id, or `<file>#<section>` for an import. */
  readonly id: string;
}

/**
 * A fact a proposer offers. Lands `proposed` — there is no field to say otherwise.
 */
export interface FactCandidate {
  /** The text as it will be stored — inline-code spans verbatim. */
  readonly text: string;
  /** `owner/name`, or null for the whole workspace. */
  readonly repoRef: string | null;
  /** Who proposed it — the UI phrases provenance from this, honestly. */
  readonly proposer: DeterministicProposerKind | "llm";
  /** Which version of the proposer's rule produced it. */
  readonly proposerVersion: number;
  readonly category: CandidateCategory;
  /** A model's confidence, 0–1; null for a deterministic rule (no invented number). */
  readonly confidence: number | null;
  /** The typed provenance the fact will carry — its refs name the source itself. */
  readonly provenance: FactProvenance;
  /** The source row, so a re-run over it proposes nothing twice. */
  readonly source: CandidateSource;
}

/** Why a source yields no candidate. */
export type SkipReason =
  /** The source row is not this workspace's, or does not exist. */
  | "source_not_found"
  /** A classification without a correction note. */
  | "no_note"
  /** A classification a rule or a model made — a correction note is a person's teaching. */
  | "not_human"
  /** A steer without the *remember this* flag — meant for that run only (the #306 amendment). */
  | "not_remembered"
  /** Extraction left nothing. */
  | "empty"
  /** Extraction left one word. */
  | "too_short"
  /** Extraction left more than a fact should hold. */
  | "too_long";

/** What a proposer's rule answers for one source. */
export type Proposal =
  | { readonly kind: "candidate"; readonly candidate: FactCandidate }
  | { readonly kind: "skip"; readonly reason: SkipReason };

/**
 * One registry entry — declarative: its trigger, its source, its extraction rule and its
 * provenance shape are data, and `propose` is the pure rule. Adding a proposer is adding one of
 * these; the lifecycle service is never touched.
 */
export interface ProposerDefinition<Source> {
  readonly kind: DeterministicProposerKind;
  /** Bumped whenever `propose` would answer differently for the same source. */
  readonly version: number;
  /** When it runs. */
  readonly trigger: string;
  /** What it reads. */
  readonly source: string;
  /** How it turns the source into text. */
  readonly extraction: string;
  /** The provenance ref kinds its candidates carry; `?` optional, `*` zero or more. */
  readonly provenanceShape: readonly string[];
  /** The rule. Pure: the same source, the same answer. */
  propose(source: Source): Proposal;
}

/** What became of one source — the service's answer, and the backfill's rows. */
export type ProposalOutcome =
  | {
      readonly outcome: "proposed";
      readonly source: CandidateSource;
      readonly factId: string;
      readonly candidate: FactCandidate;
    }
  | {
      readonly outcome: "suppressed";
      readonly source: CandidateSource;
      readonly matchedFactId: string;
      readonly suppressionId: string;
      readonly candidate: FactCandidate;
    }
  | {
      readonly outcome: "already_proposed";
      readonly source: CandidateSource;
      readonly factId: string;
    }
  | {
      readonly outcome: "skipped";
      readonly source: CandidateSource;
      readonly reason: SkipReason;
    };

/** The keys a candidate may carry — and nothing else, a status least of all. */
const CANDIDATE_KEYS: ReadonlySet<string> = new Set([
  "text",
  "repoRef",
  "proposer",
  "proposerVersion",
  "category",
  "confidence",
  "provenance",
  "source",
]);

/** A proposer returned something that is not a candidate — a programming error, never a 4xx. */
export class ProposerContractViolation extends Error {
  /** @param message - What was wrong. */
  constructor(message: string) {
    super(message);
    this.name = "ProposerContractViolation";
  }
}

/**
 * The only way a proposer's output reaches the writer: check its keys, copy it, freeze it.
 *
 * @param raw - What the proposer returned.
 * @returns The candidate, copied and frozen.
 * @throws {ProposerContractViolation} On any key a candidate does not have — `status` above all —
 *   or a candidate whose confidence is outside 0–1.
 */
export function sealCandidate(raw: FactCandidate): FactCandidate {
  const unknown = Object.keys(raw).filter((key) => !CANDIDATE_KEYS.has(key));

  if (unknown.length > 0) {
    throw new ProposerContractViolation(
      `A fact candidate carries ${unknown.join(", ")}; a proposer offers text and provenance, ` +
        `and every candidate lands proposed (K3).`,
    );
  }
  if (raw.confidence !== null && !(raw.confidence >= 0 && raw.confidence <= 1)) {
    throw new ProposerContractViolation("A candidate's confidence is between 0 and 1, or null.");
  }

  return Object.freeze({
    text: raw.text,
    repoRef: raw.repoRef,
    proposer: raw.proposer,
    proposerVersion: raw.proposerVersion,
    category: raw.category,
    confidence: raw.confidence,
    provenance: Object.freeze({
      line: raw.provenance.line,
      refs: Object.freeze(raw.provenance.refs.map((ref) => Object.freeze({ ...ref }))),
    }),
    source: Object.freeze({ kind: raw.source.kind, id: raw.source.id }),
  });
}

/**
 * The source row as one string — the suppression's `source_key`.
 *
 * @param source - The source.
 * @returns `<kind>:<id>`.
 */
export function sourceKey(source: CandidateSource): string {
  return `${source.kind}:${source.id}`;
}
