/**
 * The Studio's runner pools — FE.2 ([#1835](https://github.com/NobuData/ouroboros/issues/1835)).
 *
 * A build or test stage (`infra`) names the pool it builds on in `runner_pool`. Before FE.2 the
 * inspector drew that as free text, so a person had to know the pool's slug and a typo surfaced
 * only when the run refused to build. This module is everything the Studio knows about pools:
 *
 * - **the choices** — each pool of the workspace with its online runner count, read from the farm
 *   page (`GET /api/v1/farm`), and the *Workspace default* entry, `$default` (FE.1,
 *   [#1834](https://github.com/NobuData/ouroboros/issues/1834));
 * - **the check** — a stage naming a pool the workspace does not have. The inspector shows it on
 *   the field and will not apply it; `publishWorkflow` refuses the publish with one finding per
 *   stage, from either view.
 *
 * The service's own reference check skips `runner_pool` on purpose
 * (`ouroboros-rest/src/modules/workflows/dsl.references.ts`): it has no list of pools. The Studio
 * has one — the farm page — so the check lives here. When the farm could not be read there is
 * nothing to check against, and nothing is flagged.
 *
 * **Framework-free and pure**, so the inspector, the page reads and the server action share it.
 */

import type { FarmPage } from "@/app/api/farm";
import type { WorkflowDefinition, WorkflowFinding } from "@/app/api/workflows";
import { isVouchedFor } from "@/app/farm/runners";

/** The config key a build or test stage names its pool in. */
export const POOL_FIELD = "runner_pool";

/**
 * The reserved `runner_pool` value meaning *the workspace's default pool* — FE.1's
 * `DEFAULT_POOL_REFERENCE` (`ouroboros-rest/src/modules/farm/fleet/default-pool.ts`). It can never
 * be a real pool's name, so it is always a known value.
 */
export const DEFAULT_POOL_REFERENCE = "$default";

/** One pool, as the picker offers it. */
export interface PoolChoice {
  /** The pool's name — what `runner_pool` holds. */
  readonly name: string;
  /** Whether it is the workspace's default pool, the one `$default` resolves to. */
  readonly isDefault: boolean;
  /** Whether it takes builds. A disabled pool is still a pool; it is offered and labelled. */
  readonly enabled: boolean;
  /** How many of its runners are connected now — `online`, `building` or `draining`. */
  readonly online: number;
}

/**
 * The pools a workspace offers, with each one's online runner count.
 *
 * *Online* is the farm stat row's own rule (`isVouchedFor`), so the picker and the Build Farm page
 * never disagree about the same machine.
 *
 * @param page The farm page — its pools and its runners.
 * @returns The pools, in the page's order.
 */
export function poolChoices(page: Pick<FarmPage, "pools" | "runners">): readonly PoolChoice[] {
  return page.pools.map((pool) => ({
    name: pool.name,
    isDefault: pool.isDefault,
    enabled: pool.enabled,
    online: page.runners.filter((runner) => runner.poolId === pool.id && isVouchedFor(runner.status)).length,
  }));
}

/* ------------------------------------------------------------------ the copy */

/** The picker's label. */
export const POOL_LABEL = "Runner pool";

/** The `$default` option's name. */
export const WORKSPACE_DEFAULT_LABEL = "Workspace default";

/** The *no pool named* option, for a stage that has none. */
export const NO_POOL_LABEL = "—";

/** Beside a disabled pool. */
export const DISABLED_POOL = "disabled";

/** Between the parts of an option's label. */
const SEPARATOR = " · ";

/**
 * A pool's online runner count, in words.
 *
 * @param online The count.
 * @returns `3 online`, or `none online`.
 */
export function onlineLabel(online: number): string {
  return online > 0 ? `${online} online` : "none online";
}

/**
 * A pool's option: its name, its online count, and *disabled* when it is.
 *
 * @param pool The pool.
 * @returns `linux-arm · 3 online`, `macos · none online · disabled`.
 */
export function poolOptionLabel(pool: PoolChoice): string {
  return [pool.name, onlineLabel(pool.online), ...(pool.enabled ? [] : [DISABLED_POOL])].join(SEPARATOR);
}

/**
 * The *Workspace default* option, naming the pool it resolves to today.
 *
 * @param pools The workspace's pools.
 * @returns `Workspace default (pool-a · 3 online)`, or `Workspace default` alone when the
 *   workspace has no default pool yet.
 */
export function defaultOptionLabel(pools: readonly PoolChoice[]): string {
  const pool = pools.find((candidate) => candidate.isDefault);
  if (pool === undefined) return WORKSPACE_DEFAULT_LABEL;

  return `${WORKSPACE_DEFAULT_LABEL} (${poolOptionLabel(pool)})`;
}

/**
 * The option a stage's unknown pool keeps, so the select still shows what the stage says.
 *
 * @param name The name the stage holds.
 * @returns `typo-pool (unknown)`.
 */
export function unknownOptionLabel(name: string): string {
  return `${name} (unknown)`;
}

/**
 * What an unknown pool is told, on the field and as a publish finding.
 *
 * @param name The name the stage holds.
 * @returns The sentence.
 */
export function unknownPoolMessage(name: string): string {
  return `This workspace has no runner pool named "${name}". Pick a pool or Workspace default.`;
}

/** The code a publish finding about an unknown pool carries — the service's `reference.*` family. */
export const UNKNOWN_POOL_CODE = "reference.unknown_pool";

/** The refusal's sentence. */
export const UNKNOWN_POOL_REFUSAL = "This workflow names a runner pool this workspace does not have.";

/* ------------------------------------------------------------------ the check */

/**
 * Whether a `runner_pool` value is one the workspace has.
 *
 * @param name The value.
 * @param pools The workspace's pools.
 * @returns `true` for `$default` and for any pool's name.
 */
export function isKnownPool(name: string, pools: readonly PoolChoice[]): boolean {
  return name === DEFAULT_POOL_REFERENCE || pools.some((pool) => pool.name === name);
}

/**
 * The inspector's error for a stage's pool.
 *
 * @param config The draft config.
 * @param pools The workspace's pools, or `null` when they could not be read — nothing is checked.
 * @returns `{ runner_pool: … }` for a named pool the workspace does not have, or `{}`.
 */
export function poolErrors(
  config: Readonly<Record<string, unknown>>,
  pools: readonly PoolChoice[] | null,
): Readonly<Record<string, string>> {
  const name = config[POOL_FIELD];
  if (pools === null || typeof name !== "string" || name === "" || isKnownPool(name, pools)) return {};

  return { [POOL_FIELD]: unknownPoolMessage(name) };
}

/**
 * Whether a value is a plain object.
 *
 * @param value Anything.
 * @returns `true` for a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One finding for each stage that names a pool the workspace does not have — the publish gate.
 *
 * Read defensively: the definition is the stored draft, whatever shape it is in. A stage that names
 * no pool is not this check's business (the run refuses it as `build_pool_required`).
 *
 * @param definition The workflow definition.
 * @param pools The workspace's pools.
 * @returns The findings, in node order, each anchored to its node and its `runner_pool`.
 */
export function unknownPoolFindings(
  definition: WorkflowDefinition,
  pools: readonly PoolChoice[],
): readonly WorkflowFinding[] {
  const nodes = Array.isArray(definition.nodes) ? definition.nodes : [];

  return nodes.flatMap((node: unknown, index): WorkflowFinding[] => {
    if (!isRecord(node) || !isRecord(node.config)) return [];

    const name = node.config[POOL_FIELD];
    if (typeof name !== "string" || name === "" || isKnownPool(name, pools)) return [];

    return [
      {
        source: "dsl",
        code: UNKNOWN_POOL_CODE,
        message: unknownPoolMessage(name),
        path: `/nodes/${index}/config/${POOL_FIELD}`,
        ...(typeof node.id === "string" ? { node: node.id } : {}),
      },
    ];
  });
}
