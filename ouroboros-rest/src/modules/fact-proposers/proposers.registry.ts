/**
 * The proposer registry (BF.3, [#412](https://github.com/NobuData/ouroboros/issues/412), decision
 * **K5**) — versioned, declarative, one entry per source kind.
 *
 * ```
 * proposer         source                                       provenance                          category
 * correction_note  a person's classification carrying a note    {run, pull_request?, classification} convention
 * waiver           a waiver's reason (#327)                     {run, pull_request?, gate*, waiver}  environment | limitation
 * steer            a steer flagged *remember this* (#306)       {run, run_stage?, person?, steer}    instruction
 * import           a rule-file bullet (BF.4 #413)               {import}                             convention
 * ```
 *
 * **Provenance stays honest about its source.** A correction note's line is `from correction note
 * (run #1847)` — never the mockup's `from PR #498 review cycle`, which describes a richer
 * extraction and appears when #423's `llm` proposer, behind the `/v0/learn` contract, makes it.
 *
 * **Every rule is pure.** The same source gives the same answer, so a backfill over a run is
 * idempotent, and each entry's `version` is bumped whenever its answer would change — the
 * version is recorded on every suppression.
 */

import type { FactProvenanceRef } from "../facts/facts.resources";
import type { RuleFile } from "../knowledge-import/rule-import.plan";
import { importedProvenance } from "../knowledge-import/rule-import.resources";
import { extractLeadInstruction } from "./proposers.text";
import type {
  CandidateCategory,
  DeterministicProposerKind,
  FactCandidate,
  Proposal,
  ProposerDefinition,
} from "./proposers.types";

/** The registry's own version — bumped when an entry is added, removed or re-versioned. */
export const PROPOSER_REGISTRY_VERSION = 1;

/** Where a source ran — the parts of a run every provenance line and ref needs. */
export interface SourceRun {
  readonly id: string;
  /** `runs.loop_seq` — the *"Loop #1847"* the console prints. */
  readonly loopSeq: number;
  /** `owner/name`, lower-case — the fact's repository. */
  readonly repoRef: string;
  /** The PR the run opened, when there is one. */
  readonly pullRequest: { readonly id: string; readonly number: number } | null;
}

/** A classification, as the correction-note proposer reads it (#332). */
export interface CorrectionNoteSource {
  readonly classificationId: string;
  readonly note: string | null;
  /** `human` | `heuristic` | `model`. */
  readonly actor: string;
  readonly run: SourceRun;
}

/** A waiver, as the waiver proposer reads it (#327). */
export interface WaiverSource {
  readonly waiverId: string;
  readonly reason: string;
  /** The PR gates the waived cases count toward — `test_suite`, `physical_hil` — by id. */
  readonly gateIds: readonly string[];
  readonly run: SourceRun;
}

/** A steer, as the steer proposer reads it (#306 with the *remember this* amendment). */
export interface SteerSource {
  readonly controlId: string;
  readonly payload: string | null;
  readonly remember: boolean;
  /** The stage the run was in when the steer was asked, when known. */
  readonly stage: { readonly id: string; readonly label: string } | null;
  /** Who asked, while they are still a member of the workspace. */
  readonly actorId: string | null;
  readonly run: SourceRun;
}

/** A rule-file bullet the import planned (BF.4). */
export interface ImportSource {
  readonly file: RuleFile;
  readonly section: string | null;
  /** The bullet, already chosen by the import's parse. */
  readonly bullet: string;
  readonly repoRef: string;
}

/**
 * The words that mark a waiver's reason as a fact about the environment — the rig, the farm, the
 * network, the toolchain — rather than a known limitation of the product.
 */
const ENVIRONMENT_WORDS: readonly string[] = [
  "rig",
  "rigs",
  "bench",
  "chamber",
  "farm",
  "runner",
  "runners",
  "hardware",
  "board",
  "boards",
  "lab",
  "network",
  "ci",
  "infra",
  "infrastructure",
  "toolchain",
  "calibration",
  "power supply",
  "probe",
  "sensor",
  "fixture",
  "outage",
  "offline",
  "flaky",
];

/**
 * Whether a waiver's reason is about the environment.
 *
 * @param reason - The waiver's reason.
 * @returns `environment` when it names one of {@link ENVIRONMENT_WORDS} as a word, else
 *   `limitation`.
 */
export function waiverCategory(reason: string): CandidateCategory {
  const lower = reason.toLowerCase();

  return ENVIRONMENT_WORDS.some((word) =>
    new RegExp(`(^|[^a-z0-9])${word.replace(/ /g, "\\s+")}($|[^a-z0-9])`).test(lower),
  )
    ? "environment"
    : "limitation";
}

/**
 * `run #1847` — the run as the console names it.
 *
 * @param run - The run.
 * @returns The phrase.
 */
function runPhrase(run: SourceRun): string {
  return `run #${String(run.loopSeq)}`;
}

/**
 * The run and, when there is one, its PR — the refs every loop source starts with.
 *
 * @param run - The run.
 * @returns The refs.
 */
function runRefs(run: SourceRun): FactProvenanceRef[] {
  return [
    { kind: "run", id: run.id },
    ...(run.pullRequest === null
      ? []
      : [{ kind: "pull_request" as const, id: run.pullRequest.id }]),
  ];
}

/**
 * Turn extracted text into a candidate, or the extraction's refusal into a skip.
 *
 * @param raw - The source's text.
 * @param build - The candidate around the extracted text.
 * @returns The proposal.
 */
function fromText(raw: string, build: (text: string) => FactCandidate): Proposal {
  const extraction = extractLeadInstruction(raw);

  return extraction.ok
    ? { kind: "candidate", candidate: build(extraction.text) }
    : { kind: "skip", reason: extraction.refusal };
}

/** #332's correction notes — a person explaining why an attempt was wrong. */
export const CORRECTION_NOTE_PROPOSER: ProposerDefinition<CorrectionNoteSource> = {
  kind: "correction_note",
  version: 1,
  trigger: "a person classifies a failing case with a correction note (Mark & Route)",
  source: "failure_classifications with actor human and a note",
  extraction: "lead instruction of the note, inline-code spans verbatim",
  provenanceShape: ["run", "pull_request?", "classification"],
  propose(source) {
    if (source.actor !== "human") return { kind: "skip", reason: "not_human" };
    if (source.note === null) return { kind: "skip", reason: "no_note" };

    return fromText(source.note, (text) => ({
      text,
      repoRef: source.run.repoRef,
      proposer: "correction_note",
      proposerVersion: CORRECTION_NOTE_PROPOSER.version,
      category: "convention",
      confidence: null,
      provenance: {
        line: `from correction note (${runPhrase(source.run)})`,
        refs: [...runRefs(source.run), { kind: "classification", id: source.classificationId }],
      },
      source: { kind: "classification", id: source.classificationId },
    }));
  },
};

/** #327's waiver reasons — why a failing gate is acceptable: the environment, or a known limit. */
export const WAIVER_PROPOSER: ProposerDefinition<WaiverSource> = {
  kind: "waiver",
  version: 1,
  trigger: "an administrator waives failing cases or a criterion",
  source: "pr_waivers reasons",
  extraction:
    "lead instruction of the reason, inline-code spans verbatim; environment when the reason " +
    "names the rig, farm, network, toolchain or similar, otherwise a known limitation",
  provenanceShape: ["run", "pull_request?", "gate*", "waiver"],
  propose(source) {
    const category = waiverCategory(source.reason);
    const where =
      source.run.pullRequest === null
        ? runPhrase(source.run)
        : `PR #${String(source.run.pullRequest.number)}`;

    return fromText(source.reason, (text) => ({
      text,
      repoRef: source.run.repoRef,
      proposer: "waiver",
      proposerVersion: WAIVER_PROPOSER.version,
      category,
      confidence: null,
      provenance: {
        line: `from waiver on ${where} · ${category}`,
        refs: [
          ...runRefs(source.run),
          ...source.gateIds.map((id) => ({ kind: "gate" as const, id })),
          { kind: "waiver", id: source.waiverId },
        ],
      },
      source: { kind: "waiver", id: source.waiverId },
    }));
  },
};

/** #306's steers — only one flagged *remember this*: meant generally, not for that run. */
export const STEER_PROPOSER: ProposerDefinition<SteerSource> = {
  kind: "steer",
  version: 1,
  trigger: "a member sends a steer with remember this",
  source: "run_controls of kind steer with remember = true",
  extraction: "lead instruction of the steer, inline-code spans verbatim",
  provenanceShape: ["run", "run_stage?", "person?", "steer"],
  propose(source) {
    if (!source.remember) return { kind: "skip", reason: "not_remembered" };
    if (source.payload === null) return { kind: "skip", reason: "empty" };

    const stage = source.stage === null ? "" : ` · ${source.stage.label}`;

    return fromText(source.payload, (text) => ({
      text,
      repoRef: source.run.repoRef,
      proposer: "steer",
      proposerVersion: STEER_PROPOSER.version,
      category: "instruction",
      confidence: null,
      provenance: {
        line: `from remembered steer (${runPhrase(source.run)}${stage})`,
        refs: [
          { kind: "run", id: source.run.id },
          ...(source.stage === null ? [] : [{ kind: "run_stage" as const, id: source.stage.id }]),
          ...(source.actorId === null ? [] : [{ kind: "person" as const, id: source.actorId }]),
          { kind: "steer", id: source.controlId },
        ],
      },
      source: { kind: "steer", id: source.controlId },
    }));
  },
};

/**
 * BF.4's imported rule-file bullets. Declared here so the registry is the whole list; the import
 * runs it inside its own apply transaction (preview, fingerprint, dedupe shown as counts), and the
 * provenance is the import's own `importedProvenance`, so the two cannot drift.
 */
export const IMPORT_PROPOSER: ProposerDefinition<ImportSource> = {
  kind: "import",
  version: 1,
  trigger: "an administrator applies a rule-file import preview (BF.4)",
  source: "imperative bullets of CLAUDE.md, AGENTS.md, .cursorrules, copilot-instructions",
  extraction: "the bullet as the import's parse chose it",
  provenanceShape: ["import"],
  propose(source) {
    const text = source.bullet.trim();

    if (text === "") return { kind: "skip", reason: "empty" };

    return {
      kind: "candidate",
      candidate: {
        text,
        repoRef: source.repoRef,
        proposer: "import",
        proposerVersion: IMPORT_PROPOSER.version,
        category: "convention",
        confidence: null,
        provenance: importedProvenance({ file: source.file, section: source.section }),
        source: {
          kind: "import",
          id: source.section === null ? source.file : `${source.file}#${source.section}`,
        },
      },
    };
  },
};

/** The registry: one entry per deterministic source kind. */
export const PROPOSER_REGISTRY = {
  correction_note: CORRECTION_NOTE_PROPOSER,
  waiver: WAIVER_PROPOSER,
  steer: STEER_PROPOSER,
  import: IMPORT_PROPOSER,
} as const satisfies Record<DeterministicProposerKind, ProposerDefinition<never>>;

/** Every entry, in the table's order. */
export const PROPOSER_DEFINITIONS: readonly ProposerDefinition<never>[] =
  Object.values(PROPOSER_REGISTRY);
