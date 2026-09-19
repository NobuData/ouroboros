/**
 * What a runner said it can do, as the `runners.capabilities` document dispatch reads.
 *
 * AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)): *capabilities from `hello` are
 * stored and available to dispatch eligibility*. The protocol's `capabilities` object is the
 * agent's answer to the enrollment card's own question — *is docker present?* — and AH.4
 * ([#252](https://github.com/NobuData/ouroboros/issues/252)) must not offer a container job to a
 * machine without a daemon, or a shell job to one whose operator refused them.
 *
 * ```
 * hello.capabilities                      runners.capabilities
 *   docker: true    ─────────────────────▶  docker: true,  executors: ["container", …]
 *   shell:  false   ─────────────────────▶  shell:  false  (no "shell" in executors)
 *   ccache, cpus, memory_mb  ────────────▶  ccache, cpu_count, memory_mb
 * ```
 *
 * **`executors` is derived here, once, rather than at every dispatch.** V040's
 * `farm_capabilities_valid` names it as the field eligibility reads, and a dispatcher that
 * re-derived it from `docker` and `shell` would be a second place the rule could be written
 * differently. `cpus` is stored as `cpu_count` because that is the name enrollment
 * (`registration.service.ts`) already writes and V040's constraint already types.
 */

import type { BuildExecutor } from "../../db/schema";
import type { HelloPayload } from "../protocol/protocol.messages";

/** The document this module writes to `runners.capabilities`. */
export interface RunnerCapabilities {
  /** A reachable Docker or Podman daemon. */
  readonly docker: boolean;
  /** Whether this agent will run shell jobs at all — an operator's answer, not a probe. */
  readonly shell: boolean;
  /** A `ccache` on `PATH`. */
  readonly ccache: boolean;
  /** Usable cores, after any operator limit. */
  readonly cpu_count: number;
  /** Usable memory in MiB, after any operator limit. */
  readonly memory_mb: number;
  /** The executors this runner can take a job under. What dispatch eligibility reads. */
  readonly executors: readonly BuildExecutor[];
}

/**
 * The stored document for a `hello`'s capabilities.
 *
 * @param reported - `hello.payload.capabilities`, already judged by the codec.
 * @returns The document.
 */
export function capabilitiesOf(reported: HelloPayload["capabilities"]): RunnerCapabilities {
  const executors: BuildExecutor[] = [];

  if (reported.docker) executors.push("container");
  if (reported.shell) executors.push("shell");

  return {
    docker: reported.docker,
    shell: reported.shell,
    ccache: reported.ccache,
    cpu_count: reported.cpus,
    memory_mb: reported.memory_mb,
    executors,
  };
}

/**
 * Whether a runner can take a job under an executor — the eligibility question AH.4 asks.
 *
 * @param capabilities - `runners.capabilities`, as read from the row. Typed `unknown` because
 *   that is what the column is: a runner enrolled and never connected holds `{}`, and one
 *   enrolled before this module wrote `executors` holds only what enrollment knew.
 * @param executor - The job's executor.
 * @returns True only when the runner has *said* it can — a runner that has never answered is
 *   not assumed able to, because offering it work would dispatch a job that cannot start.
 */
export function supportsExecutor(capabilities: unknown, executor: BuildExecutor): boolean {
  if (typeof capabilities !== "object" || capabilities === null) return false;

  const executors = (capabilities as { executors?: unknown }).executors;

  return Array.isArray(executors) && executors.includes(executor);
}
