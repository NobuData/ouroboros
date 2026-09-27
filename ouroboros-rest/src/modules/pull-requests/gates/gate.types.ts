/**
 * The values the gate engine passes between its parts — the facts a revision is judged on, what
 * a provider answers, and the definitions it answers for.
 *
 * AX.2 ([#358](https://github.com/NobuData/ouroboros/issues/358)), over V056's
 * `pr_gate_definitions` and `pr_gate_results` ([#353](https://github.com/NobuData/ouroboros/issues/353)).
 *
 * ```
 * gate.repository.ts  ── reads ──▶ GateFacts ──▶ GateProvider.evaluate ──▶ GateOutcome
 *                                                 (gate.providers.ts)        │
 *                                   gate.engine.ts: overlays, idempotency ◀──┘
 * ```
 *
 * Everything here is data. The facts are gathered once per evaluation so every provider is a pure
 * function of them — which is what makes re-evaluation idempotent: the same facts always produce
 * the same verdict and the same evidence line.
 */

import type {
  BuildJobStatus,
  BuiltInGateKey,
  GuardrailVerdict,
  HilLimitKind,
  HilVerdict,
  PrGateEvidenceRef,
  PrGateKey,
  PrGateVerdict,
  PrRevisionFile,
  PullRequestState,
  TestRunStatus,
} from "../../db/schema";
import type { ReviewPolicy } from "../../guardrails/guardrails.checks";
import type { PinnedPolicy } from "../../guardrails/guardrails.policy";
import type { LicensePolicy } from "./gate.policy";

/** What a provider decided about one gate on one revision. */
export interface GateOutcome {
  /** One of V056's six verdicts. */
  readonly verdict: PrGateVerdict;
  /** The card's mono line — non-blank; the engine bounds it to 512 characters. */
  readonly evidence: string;
  /** The row the line was composed from, or null when no table kind names it. */
  readonly evidenceRef: PrGateEvidenceRef | null;
}

/** One provider: a gate key and a pure function from facts to an outcome. */
export interface GateProvider {
  /** The gate it answers for. */
  readonly key: BuiltInGateKey;
  /** The provider build, written to `pr_gate_results.provider_version` — `gate-build@1.0.0`. */
  readonly version: string;
  /**
   * Judge one revision.
   *
   * @param facts - Everything gathered for the revision.
   * @returns The verdict and its evidence. Never throws for missing evidence — that is `pending`.
   */
  evaluate(facts: GateFacts): GateOutcome;
}

/** The PR being judged. */
export interface GatePr {
  /** `pull_requests.id`. */
  readonly id: string;
  /** Its workspace. */
  readonly organizationId: string;
  /** Where it stands. */
  readonly state: PullRequestState;
  /** The loop that opened it, or null for a PR without one. */
  readonly runId: string | null;
}

/** The revision being judged — always the PR's latest. */
export interface GateRevision {
  /** `pr_revisions.id`. */
  readonly id: string;
  /** Revision 1, 2. */
  readonly seq: number;
  /** The head after the push — 7 to 40 hex. */
  readonly headSha: string;
  /** The changed-files snapshot. */
  readonly files: readonly PrRevisionFile[];
  /** The host's bounded diff sample, or null. */
  readonly diffExcerpt: string | null;
}

/** The latest farm build of the revision's head. */
export interface BuildFact {
  /** `build_jobs.id`. */
  readonly jobId: string;
  /** Where it stands. */
  readonly status: BuildJobStatus;
  /** The runner that ran it — `forge-01` — or null before one took it. */
  readonly runnerName: string | null;
  /** The exit code, when it ran. */
  readonly exitCode: number | null;
  /** The end of the job's log, as text — where the memory map and the link line are. */
  readonly logTail: string;
}

/** The latest test attempt of the PR's run at the revision's head. */
export interface AttemptFact {
  /** `test_runs.id`. */
  readonly id: string;
  /** Build 1 · 2 · 3 · 4. */
  readonly attemptSeq: number;
  /** Where its results stand. */
  readonly status: TestRunStatus;
  /** Cases. */
  readonly total: number;
  /** Cases passed. */
  readonly passed: number;
  /** Cases failed or errored. */
  readonly failed: number;
  /** The durable keys of the failed and errored cases. */
  readonly failingCaseKeys: readonly string[];
}

/** One HIL measurement of the attempt's physical suites. */
export interface HilFact {
  /** `hil_measurements.id`. */
  readonly id: string;
  /** `overshoot_pct`. */
  readonly metric: string;
  /** The measured value, as `numeric` text — `1.7`. */
  readonly value: string;
  /** `%`, `count`, `ms`. */
  readonly unit: string;
  /** The limit, as `numeric` text — `2.0`. */
  readonly limitValue: string;
  /** Whether the limit is a ceiling or a floor. */
  readonly limitKind: HilLimitKind;
  /** `hil_verdict(value, limit, kind)`. */
  readonly verdict: HilVerdict;
  /** The suite's platform — `rig:helios-rig-02`. */
  readonly platform: string;
  /** The measured case's durable key, for waivers. */
  readonly caseKey: string;
}

/** The run's latest `secrets` guardrail verdict (AP.3). */
export interface SecretsFact {
  /** `guardrail_evaluations.id`. */
  readonly id: string;
  /** What the scan decided. */
  readonly verdict: GuardrailVerdict;
}

/**
 * Everything one evaluation judges — gathered by the repository, read by every provider.
 *
 * A fact that could not be found is `null` (or empty), never guessed: the provider turns absence
 * into an honest `pending` or `not_required`.
 */
export interface GateFacts {
  readonly pr: GatePr;
  readonly revision: GateRevision;
  /** The pinned workflow's policy, or undefined when the PR has no run or the pin is unreadable. */
  readonly policy: PinnedPolicy | undefined;
  /** The review facts `review_required` reads (auto-merge terminal, vote rules). */
  readonly review: ReviewPolicy | undefined;
  /** How many enabled `add_vote` rules match the run's ticket (#194). */
  readonly voteRules: number;
  /** The latest build of the head, or null. */
  readonly build: BuildFact | null;
  /** The latest test attempt at the head, or null. */
  readonly attempt: AttemptFact | null;
  /** The attempt's physical measurements. */
  readonly hil: readonly HilFact[];
  /** Case keys waived for the run by AS.4 waivers. */
  readonly waivedCaseKeys: ReadonlySet<string>;
  /** The plan's declared files (`issue_estimates.breakdown.files`), or undefined with no estimate. */
  readonly planFiles: readonly string[] | undefined;
  /** The run's latest secrets verdict, or null. */
  readonly secrets: SecretsFact | null;
  /** The workspace's license allow-list. */
  readonly license: LicensePolicy;
}

/** One gate definition as the engine materializes it — a `pr_gate_definitions` row minus ids. */
export interface GateDefinitionSpec {
  readonly gateKey: PrGateKey;
  readonly label: string;
  readonly sortOrder: number;
  readonly required: boolean;
  /** Provenance — `standard-fix@v14 pin`, `org config`. */
  readonly source: string;
  /** Whether org config switched the gate off — its verdict is then `not_required`. */
  readonly disabled: boolean;
}

/** A stored definition — a spec with its id. */
export interface StoredGateDefinition {
  readonly id: string;
  readonly gateKey: PrGateKey;
  readonly required: boolean;
  readonly source: string;
}

/** A waiver of a whole gate — the generic overlay; AX.5 (#361) adds the action that writes one. */
export interface GateWaiver {
  readonly gateKey: PrGateKey;
  /** Why — shown on the evidence line. */
  readonly reason: string;
}

/** One result the engine decided to write, or found already written. */
export interface GateResultRow {
  readonly definitionId: string;
  readonly gateKey: PrGateKey;
  readonly required: boolean;
  readonly verdict: PrGateVerdict;
  readonly evidence: string;
  readonly evidenceRef: PrGateEvidenceRef | null;
  readonly providerVersion: string;
}
