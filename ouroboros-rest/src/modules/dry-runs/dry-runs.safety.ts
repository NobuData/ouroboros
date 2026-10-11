/**
 * The safety strip, as data (CD.4, [#562](https://github.com/NobuData/ouroboros/issues/562)).
 *
 * Mockup 20's dry-run card stands on three claims — *writes are simulated*, *infrastructure is
 * replayed*, *the models are real* — and three columns of confident copy are exactly what
 * survives a refactor that quietly makes one of them untrue. So the page renders this payload
 * instead, and every column is **derived from the harness's own configuration**
 * (`GET /v0/dry-runs/harness`: the table that dispatches a tool call, the guards that refuse
 * one, the paths the harness asks). A column `holds` only while the mechanism behind it is
 * there; take the mechanism away in the engine and the column says so.
 *
 * ```
 * simulated_writes   the overlay            edit tools write to memory; no tool writes a repository
 * replayed_infra     the estimator service  build/test tools answer from history (CD.3)
 * real_models        gateway routing        every model call goes through /internal/llm/invoke
 * ```
 *
 * Pure: the service fetches the description and this file composes the answer.
 */

import type { EngineDryRunHarness } from "../engine/engine.dryruns";
import {
  INTERNAL_DRY_RUN_REPLAY_ESTIMATES_PATH,
  INTERNAL_INVOKE_PATH,
} from "../internal/internal.paths";
import { REPLAY_FORMULAS } from "../replay-estimates/replay.formulas";

/** The three columns, in the order the strip shows them. */
export type SafetyColumnId = "simulated_writes" | "replayed_infra" | "real_models";

/** What backs a column. */
export type SafetyMechanismKind = "overlay" | "estimator_service" | "gateway_routing";

/** One column of the strip: a claim, and the mechanism that makes it true. */
export interface SafetyColumn {
  readonly id: SafetyColumnId;
  /**
   * Whether the mechanism is in place. `false` means the harness as installed does not back
   * the claim, and the page must not make it.
   */
  readonly holds: boolean;
  readonly mechanism: {
    readonly kind: SafetyMechanismKind;
    /** The harness tools that carry the mechanism. */
    readonly tools: readonly string[];
    /** The control-plane path it goes through, when it goes through one. */
    readonly path: string | null;
    /** What the mechanism does, as a sentence. */
    readonly detail: string;
  };
  /** Facts the column may print beside the claim. */
  readonly facts: Readonly<Record<string, unknown>>;
}

/** What `GET /api/v1/workflows/{id}/dry-runs/safety` answers. */
export interface DryRunSafetyResource {
  /** The harness the claims are about. */
  readonly harness: string;
  readonly columns: readonly SafetyColumn[];
  /** What a dry run cannot do — the header pill's words, each backed by an absent capability. */
  readonly absent: readonly { readonly claim: string; readonly capability: string }[];
  /** The guards at the tool boundary, and what each refuses. */
  readonly guards: readonly { readonly name: string; readonly refuses: string }[];
  /** A dry run whose guards had to hold is failed, never trusted. */
  readonly blockedCallFailsRun: true;
}

/** The pill's claims, each tied to the forbidden capability that makes it true. */
const PILL_CLAIMS: readonly { readonly claim: string; readonly capability: string }[] = [
  { claim: "no writes", capability: "repository_write" },
  { claim: "no PRs", capability: "pull_request" },
  { claim: "no merges", capability: "pull_request" },
];

/** The engine's spelling of the replay-estimates path: `{id}` where this service writes `:id`. */
const REPLAY_PATH_AS_ENGINE_WRITES_IT = INTERNAL_DRY_RUN_REPLAY_ESTIMATES_PATH.replace(
  ":id",
  "{id}",
);

/**
 * The names of a harness's tools with one effect.
 *
 * @param harness - The harness description.
 * @param effect - The effect.
 * @returns The tool names, in manifest order.
 */
function toolsWith(harness: EngineDryRunHarness, effect: string): string[] {
  return harness.tools.filter((tool) => tool.effect === effect).map((tool) => tool.name);
}

/**
 * Compose the strip from the harness's description.
 *
 * @param harness - What the engine says its harness can and cannot do.
 * @returns The three columns, the pill's backed claims and the guards.
 */
export function safetyStrip(harness: EngineDryRunHarness): DryRunSafetyResource {
  const writers = toolsWith(harness, "simulated_write");
  const replayers = toolsWith(harness, "replay");
  const forbidden = new Set(harness.forbiddenCapabilities);
  const guarded = harness.guards.some((guard) => guard.name === "allow_list");

  return {
    harness: harness.harness,
    columns: [
      {
        id: "simulated_writes",
        // Simulated only while every write lands in memory, nothing can write a repository,
        // and the allow-list is what decides which tools exist.
        holds:
          harness.writes === "memory_overlay" &&
          writers.length > 0 &&
          forbidden.has("repository_write") &&
          guarded,
        mechanism: {
          kind: "overlay",
          tools: writers,
          path: null,
          detail:
            "A stage's edits are held in an in-memory overlay that later stages read through; the overlay becomes the simulated diff and is never written to the repository.",
        },
        facts: { writes: harness.writes, reads: harness.reads },
      },
      {
        id: "replayed_infra",
        // Replayed only while the build and test tools answer from history, through the
        // estimator this service serves, and nothing can dispatch to the farm.
        holds:
          replayers.length > 0 &&
          harness.replayEstimatesPath === REPLAY_PATH_AS_ENGINE_WRITES_IT &&
          forbidden.has("farm_dispatch"),
        mechanism: {
          kind: "estimator_service",
          tools: replayers,
          path: harness.replayEstimatesPath,
          detail:
            "Build and test stages are answered by the replay estimator from farm and test history — a median with its sample count and spread, or insufficient history; nothing is built or run.",
        },
        facts: {
          formulas: Object.values(REPLAY_FORMULAS).map((formula) => ({
            id: formula.id,
            version: formula.version,
            dispersion: formula.dispersion,
          })),
        },
      },
      {
        id: "real_models",
        // Real only while every model call goes through the invocation gateway — routed,
        // attributed to the dry run and held to its spend cap.
        holds: harness.invokePath === INTERNAL_INVOKE_PATH && forbidden.has("credential_access"),
        mechanism: {
          kind: "gateway_routing",
          tools: [],
          path: harness.invokePath,
          detail:
            "Model stages run their own prompts through the invocation gateway with the alias routing resolved for each, attributed to the dry run and stopped at its budget; the harness holds no provider credential.",
        },
        facts: {},
      },
    ],
    absent: PILL_CLAIMS.filter((entry) => forbidden.has(entry.capability)),
    guards: harness.guards,
    blockedCallFailsRun: true,
  };
}
