/**
 * `GateEngineService` — materializes a PR's gates, evaluates them against the evidence, appends a
 * snapshot for the latest revision and moves the PR's state from the aggregate.
 *
 * AX.2 ([#358](https://github.com/NobuData/ouroboros/issues/358)), decision **V2**.
 *
 * ```
 * notify(org, event) ─▶ targets: the event's open PRs, in its workspace
 *   └─ per PR, one transaction (the PR row locked):
 *        policy sources ─▶ materializeDefinitions ─▶ upsert pr_gate_definitions   (provenance on each)
 *        evidence at the latest revision's head ─▶ GateFacts
 *        affected gates (+ any never evaluated on this revision) ─▶ evaluateGate
 *        drop rows identical to the latest result ─▶ append pr_gate_results       (idempotent)
 *        pr_gate_aggregate(revision) ─▶ statePath ─▶ pull_requests.state          (verifying | blocked)
 * ```
 *
 * **A new revision gets a new snapshot.** Results are keyed by revision, and only the latest
 * revision is evaluated, so a push leaves the previous revision's verdicts exactly as they were —
 * Revision 1's two red gates stay readable after Revision 2 turns them green.
 *
 * **Never failing an emitter.** {@link GateEngineService.notify} logs and swallows every failure,
 * per PR: the build result, test report or change-set that triggered it has already committed, and
 * a gate that could not be re-evaluated is re-evaluated by the next event.
 *
 * **Every evaluation is told to {@link GateListeners}** after its transaction commits — the merge
 * executor (AX.4, #360) fires an armed plan there, or disarms it.
 *
 * **Not wired yet, deliberately:** a gate-level waiver action and approval records (AX.5, #361), a
 * second-model provider (AZ.1, #371), and the org policy document's resolver (#481), which rebinds
 * {@link ORG_GATE_POLICY}.
 */

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

import type { BuiltInGateKey, PullRequestState } from "../../db/schema";
import type { ReviewPolicy } from "../../guardrails/guardrails.checks";
import {
  asQueueEffort,
  countVoteRules,
  readPinnedPolicy,
  reviewPolicy,
  type PinnedPolicy,
} from "../../guardrails/guardrails.policy";
import { materializeDefinitions } from "./gate.definitions";
import { evaluateGate, statePath, unchanged, type GateAggregate } from "./gate.engine";
import { AFFECTED_GATES, type GateEvidenceEvent, type GateEvidenceSink } from "./gate.evidence";
import { GateListeners } from "./gate.listeners";
import { ORG_GATE_POLICY, type OrgGatePolicy } from "./gate.policy";
import { GATE_PROVIDERS } from "./gate.providers";
import { GateRepository, type GateStore, type PolicySources } from "./gate.repository";
import type { GateFacts, GateWaiver } from "./gate.types";

/** What one evaluation did. */
export interface GateEvaluation {
  /** The PR. */
  readonly prId: string;
  /** The revision judged, or null when the PR has none yet. */
  readonly revisionId: string | null;
  /** How many results were appended — zero when nothing changed. */
  readonly written: number;
  /** The revision's aggregate, or null when nothing was judged. */
  readonly aggregate: GateAggregate | null;
  /** The PR's state after the evaluation. */
  readonly state: PullRequestState;
  /** Whether every required gate is satisfied — the merge executor's (#360) armed-ready. */
  readonly armedReady: boolean;
}

/** The policy as the engine reads it, derived from its sources. */
export interface DerivedPolicy {
  readonly pin: { readonly tag: string; readonly version: number } | null;
  readonly policy: PinnedPolicy | undefined;
  readonly voteRules: number;
  readonly review: ReviewPolicy | undefined;
}

/**
 * Derive the policy from its sources — AP.3's own readers, so a PR and its run agree.
 *
 * @param sources - The run's pin and document, the ticket and the rules.
 * @returns The pin, the pinned policy, the matching vote rules and the review facts.
 */
export function derivePolicy(sources: PolicySources): DerivedPolicy {
  const policy =
    sources.definition === undefined ? undefined : readPinnedPolicy(sources.definition);
  const effort = asQueueEffort(sources.ticket.effort);
  const voteRules = countVoteRules(sources.rules, {
    labels: sources.ticket.labels,
    ...(effort === undefined ? {} : { effort }),
  });
  const pin =
    sources.run === undefined || sources.run.workflowVersionPin === null
      ? null
      : { tag: sources.run.workflowTag, version: sources.run.workflowVersionPin };

  return { pin, policy, voteRules, review: reviewPolicy(policy, voteRules) };
}

/**
 * Gate-level waivers. None exist until AX.5's waiver action (#361) writes them; the engine's
 * overlay is in place for when it does.
 */
const NO_GATE_WAIVERS: readonly GateWaiver[] = Object.freeze([]);

@Injectable()
export class GateEngineService implements GateEvidenceSink {
  private readonly logger = new Logger(GateEngineService.name);

  /**
   * @param store - The engine's statements.
   * @param org - The workspace's gate configuration.
   * @param listeners - Who hears each evaluation — the merge executor (#360). A fresh, empty
   *   registry when absent.
   */
  constructor(
    @Inject(GateRepository) private readonly store: GateStore,
    @Inject(ORG_GATE_POLICY) private readonly org: OrgGatePolicy,
    @Optional() private readonly listeners: GateListeners = new GateListeners(),
  ) {}

  /** @inheritdoc */
  async notify(organizationId: string, event: GateEvidenceEvent): Promise<void> {
    let targets: string[];

    try {
      targets = await this.store.targets(organizationId, event);
    } catch (error) {
      this.logger.error(`Could not resolve the PRs for a ${event.kind} event.`, describe(error));
      return;
    }

    const affected = AFFECTED_GATES[event.kind];

    for (const prId of targets) {
      try {
        const result = await this.evaluate(prId, affected);

        if (result !== undefined) {
          this.logger.debug(
            `pr ${prId} ${event.kind}: ${String(result.written)} written, state ${result.state}`,
          );
          this.listeners.emit({
            prId: result.prId,
            organizationId,
            revisionId: result.revisionId,
            state: result.state,
            mergeReady: result.armedReady,
            redCount: result.aggregate?.redCount ?? 0,
          });
        }
      } catch (error) {
        this.logger.error(
          `Gate evaluation failed for pr ${prId} on ${event.kind}.`,
          describe(error),
        );
      }
    }
  }

  /**
   * Materialize a PR's definitions and evaluate its latest revision.
   *
   * @param prId - The PR.
   * @param gates - The gates to re-evaluate — `"all"`, or the keys an event affects. A gate with no
   *   result on the revision yet is evaluated whatever this says, so the card is never missing a row.
   * @returns What was done, or undefined when there is no such PR.
   * @throws Whatever the database raises — {@link notify} is the caller that must not throw.
   */
  evaluate(
    prId: string,
    gates: readonly BuiltInGateKey[] | "all" = "all",
  ): Promise<GateEvaluation | undefined> {
    return this.store.transaction(async (tx) => {
      const subject = await tx.lockPr(prId);

      if (subject === undefined) {
        return undefined;
      }

      const { pr, revision } = subject;
      const sources = await tx.policySources(pr);
      const org = await this.org.forOrganization(pr.organizationId);
      const derived = derivePolicy(sources);
      const specs = materializeDefinitions({
        pin: derived.pin,
        policy: derived.policy,
        voteRules: derived.voteRules,
        blockUntilGreen: sources.blockUntilGreen,
        org,
      });
      const definitions = await tx.upsertDefinitions(pr.id, specs);
      const idle = {
        prId: pr.id,
        written: 0,
        aggregate: null,
        state: pr.state,
        armedReady: false,
      };

      if (revision === null) {
        return { ...idle, revisionId: null };
      }

      if (pr.state === "merged" || pr.state === "closed") {
        return { ...idle, revisionId: revision.id };
      }

      const evidence = await tx.evidence(pr, revision);
      const facts: GateFacts = {
        pr,
        revision,
        policy: derived.policy,
        review: derived.review,
        voteRules: derived.voteRules,
        build: evidence.build,
        attempt: evidence.attempt,
        hil: evidence.hil,
        waivedCaseKeys: new Set(evidence.waivedCaseKeys),
        planFiles: sources.ticket.planFiles,
        secrets: evidence.secrets,
        license: org.license,
      };
      const latest = new Map(
        (await tx.latestResults(revision.id)).map((row) => [row.definitionId, row]),
      );
      const specByKey = new Map(specs.map((spec) => [spec.gateKey, spec]));
      const rows = definitions
        .filter(
          (definition) =>
            gates === "all" ||
            (gates as readonly string[]).includes(definition.gateKey) ||
            !latest.has(definition.id),
        )
        .map((definition) =>
          evaluateGate(
            definition,
            specByKey.get(definition.gateKey),
            facts,
            GATE_PROVIDERS,
            NO_GATE_WAIVERS,
          ),
        )
        .filter((row) => !unchanged(row, latest.get(row.definitionId)));

      await tx.appendResults(revision.id, rows);

      const result = await tx.aggregate(revision.id);
      const path = statePath(pr.state, result);

      for (const state of path) {
        await tx.setState(pr.id, state);
      }

      return {
        prId: pr.id,
        revisionId: revision.id,
        written: rows.length,
        aggregate: result,
        state: path.at(-1) ?? pr.state,
        armedReady: result.mergeReady,
      };
    });
  }
}

/**
 * An error, for a log line — its message, never its payload.
 *
 * @param error - What was thrown.
 * @returns The message.
 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
