/**
 * `POST /v0/triage` — the failure-triage contract, committed now and implemented later (AT.4,
 * [#332](https://github.com/NobuData/ouroboros/issues/332); implemented by AV.1,
 * [#343](https://github.com/NobuData/ouroboros/issues/343)).
 *
 * The published document is `schemas/triage/v0.json`, and this file is it written as
 * TypeScript: the request this service will send the engine and the response it will read back.
 * The MVP answers the same **shape** with its heuristic rules (option **5-A**), so when AV.1's
 * model arrives behind the door the API, the Mark & Route card and its affix logic do not move:
 *
 * ```
 *                 class   subtype   confidence   narrative   provenance
 * heuristic (now) ✓       ✓|null    null         null        {actor: heuristic, rule_id, model: null}
 * model (AV.1)    ✓       ✓|null    0–100        a story     {actor: model, rule_id: null, model}
 * ```
 *
 * **What holds this file to the schema** is `triage.contract.spec.ts`: {@link TRIAGE_V0_FIELDS}
 * is every field of `v0.json` with its type, and the suite derives the same list from the
 * document — so a change to the schema's shape without this file (or the reverse) is red. It
 * also classifies every fixture under `schemas/triage/fixtures/` as `expected.json` records, and
 * validates what {@link triageRequest} and {@link heuristicTriageResponse} build.
 *
 * The contract is `snake_case` because it is engine-facing, as `/v0/plan` is.
 */

import type {
  FailureClass,
  FailureSubtype,
  HilLimitKind,
  HilVerdict,
  RunFileStatus,
  TestAttemptOutcome,
  TestCaseStatus,
} from "../db/schema";
import type { Hint } from "./triage.rules";

/** The value of every `contract` field — names the contract answered. */
export const TRIAGE_CONTRACT = "triage/v0";

/** The most changed files a request carries; beyond it `diff.truncated` is true. */
export const MAX_DIFF_FILES = 200;

/**
 * Every field of `schemas/triage/v0.json`, as `path:type` — the drift check's pin.
 *
 * `response.` is the document's root; `request.` is `$defs/triage_request`. A path through an
 * array is written `[]`, and a type is the schema's own (`string|null`, an `enum(…)`, `const(…)`).
 */
export const TRIAGE_V0_FIELDS: readonly string[] = [
  "response.class:enum(product_bug,test_update,flake_retry,infra_rig)",
  "response.subtype:enum(unclear_requirements,null)",
  "response.confidence:number|null",
  "response.narrative:string|null",
  "response.evidence:array",
  "response.evidence[].kind:enum(failure,hil_measurement,diff_path,prior_attempt,flake_history)",
  "response.evidence[].ref:string",
  "response.evidence[].note:string",
  "response.provenance:object",
  "response.provenance.contract:const(triage/v0)",
  "response.provenance.actor:enum(heuristic,model)",
  "response.provenance.rule_id:string|null",
  "response.provenance.model:string|null",
  "request.contract:const(triage/v0)",
  "request.case:object",
  "request.case.case_key:string",
  "request.case.name:string",
  "request.case.classname:string|null",
  "request.case.suite:string",
  "request.case.platform:string",
  "request.case.status:enum(failed,error,flaky)",
  "request.case.retry_outcomes:array",
  "request.case.retry_outcomes[]:enum(passed,failed,error,skipped)",
  "request.case.failure:object|null",
  "request.case.failure.message:string",
  "request.case.failure.log_excerpt:string",
  "request.case.failure.path:string",
  "request.hil_measurements:array",
  "request.hil_measurements[].metric:string",
  "request.hil_measurements[].value:number",
  "request.hil_measurements[].unit:string",
  "request.hil_measurements[].limit_value:number",
  "request.hil_measurements[].limit_kind:enum(max,min)",
  "request.hil_measurements[].verdict:enum(pass,fail)",
  "request.hil_measurements[].trials:array",
  "request.hil_measurements[].trials[]:object",
  "request.diff:object",
  "request.diff.files:array",
  "request.diff.files[].path:string",
  "request.diff.files[].status:enum(added,modified,deleted,renamed)",
  "request.diff.files[].additions:integer",
  "request.diff.files[].deletions:integer",
  "request.diff.truncated:boolean",
  "request.prior_attempts:array",
  "request.prior_attempts[].attempt_seq:integer",
  "request.prior_attempts[].outcome:enum(passed,failed,error,flaky,skipped,absent)",
  "request.prior_attempts[].commit_sha:string|null",
  "request.flake_history:object",
  "request.flake_history.occurrences:integer",
  "request.flake_history.pass_on_retry:integer",
  "request.flake_history.score:number|null",
  "request.flake_history.state:enum(healthy,watching,quarantined,null)",
];

/** `$defs/evidence` — one thing an answer cites. */
export interface TriageEvidence {
  readonly kind: "failure" | "hil_measurement" | "diff_path" | "prior_attempt" | "flake_history";
  readonly ref: string;
  readonly note: string;
}

/** The response — the document's root. */
export interface TriageResponse {
  readonly class: FailureClass;
  readonly subtype: FailureSubtype | null;
  /** Null for a heuristic, always. */
  readonly confidence: number | null;
  /** Null for a heuristic. */
  readonly narrative: string | null;
  readonly evidence: readonly TriageEvidence[];
  readonly provenance: {
    readonly contract: typeof TRIAGE_CONTRACT;
    readonly actor: "heuristic" | "model";
    readonly rule_id: string | null;
    readonly model: string | null;
  };
}

/** `$defs/triage_request` — one failed case with everything a triager may cite. */
export interface TriageRequest {
  readonly contract: typeof TRIAGE_CONTRACT;
  readonly case: {
    readonly case_key: string;
    readonly name: string;
    readonly classname: string | null;
    readonly suite: string;
    readonly platform: string;
    readonly status: "failed" | "error" | "flaky";
    readonly retry_outcomes: readonly TestAttemptOutcome[];
    readonly failure: {
      readonly message?: string;
      readonly log_excerpt?: string;
      readonly path?: string;
    } | null;
  };
  readonly hil_measurements: readonly {
    readonly metric: string;
    readonly value: number;
    readonly unit: string;
    readonly limit_value: number;
    readonly limit_kind: HilLimitKind;
    readonly verdict: HilVerdict;
    readonly trials: readonly Record<string, unknown>[];
  }[];
  readonly diff: {
    readonly files: readonly {
      readonly path: string;
      readonly status: RunFileStatus;
      readonly additions: number;
      readonly deletions: number;
    }[];
    readonly truncated: boolean;
  };
  readonly prior_attempts: readonly {
    readonly attempt_seq: number;
    readonly outcome: TestCaseStatus | "absent";
    readonly commit_sha: string | null;
  }[];
  readonly flake_history: {
    readonly occurrences: number;
    readonly pass_on_retry: number;
    readonly score: number | null;
    readonly state: "healthy" | "watching" | "quarantined" | null;
  };
}

/**
 * Everything the service knows about one failing case — what the rules and the contract read.
 * Gathered by `triage.repository.ts`; the numeric columns already converted.
 */
export interface CaseDossier {
  readonly case: TriageRequest["case"];
  readonly hilMeasurements: TriageRequest["hil_measurements"];
  readonly changedFiles: TriageRequest["diff"]["files"];
  readonly priorAttempts: TriageRequest["prior_attempts"];
  readonly flakeHistory: TriageRequest["flake_history"];
}

/**
 * The request `/v0/triage` is sent for one case — the door AV.1's model answers behind.
 *
 * @param dossier - The case and everything it may cite.
 * @returns The request: the diff capped at {@link MAX_DIFF_FILES} files, flagged when cut.
 */
export function triageRequest(dossier: CaseDossier): TriageRequest {
  return {
    contract: TRIAGE_CONTRACT,
    case: dossier.case,
    hil_measurements: dossier.hilMeasurements,
    diff: {
      files: dossier.changedFiles.slice(0, MAX_DIFF_FILES),
      truncated: dossier.changedFiles.length > MAX_DIFF_FILES,
    },
    prior_attempts: dossier.priorAttempts,
    flake_history: dossier.flakeHistory,
  };
}

/**
 * A heuristic hint, answered in the contract's shape: no confidence, no narrative, the rule as
 * provenance, and the rule's reason cited against what it read.
 *
 * @param hint - The hint.
 * @param dossier - The case, for the evidence's reference.
 * @returns The response.
 */
export function heuristicTriageResponse(hint: Hint, dossier: CaseDossier): TriageResponse {
  return {
    class: hint.suggestedClass,
    subtype: null,
    confidence: null,
    narrative: null,
    evidence: [{ kind: evidenceKind(hint), ref: evidenceRef(hint, dossier), note: hint.reason }],
    provenance: {
      contract: TRIAGE_CONTRACT,
      actor: "heuristic",
      rule_id: hint.ruleId,
      model: null,
    },
  };
}

/**
 * What a rule's reason rests on.
 *
 * @param hint - The hint.
 * @returns The evidence kind.
 */
function evidenceKind(hint: Hint): TriageEvidence["kind"] {
  switch (hint.ruleId) {
    case "flake.pass_on_retry":
      return "flake_history";
    case "infra.rig_error":
      return "failure";
    case "product.new_failure_in_diff":
      return "diff_path";
  }
}

/**
 * Which item of the request the evidence cites.
 *
 * @param hint - The hint.
 * @param dossier - The case.
 * @returns The case key, or the failure's path for a diff overlap.
 */
function evidenceRef(hint: Hint, dossier: CaseDossier): string {
  const path = dossier.case.failure?.path;

  return hint.ruleId === "product.new_failure_in_diff" && path !== undefined && path !== ""
    ? path
    : dossier.case.case_key;
}
