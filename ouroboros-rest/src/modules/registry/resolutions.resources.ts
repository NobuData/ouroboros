/**
 * The resolution snapshot, as the API speaks it — mockup 21's chain card and the run console's
 * transcript ([#589](https://github.com/NobuData/ouroboros/issues/589), decision **R9**).
 *
 * The stored document is V024's snake_case; this is its camelCase resource, mapped once in
 * {@link toSnapshotResource}. Every optional member of the stored grammar arrives here as a key
 * that is present and `null`, so a client tests one thing — `=== null` — for *not known*.
 *
 * **Consumers.** CI.5's chain card ([#595](https://github.com/NobuData/ouroboros/issues/595)) and
 * the run console's transcript (AP.2 [#304](https://github.com/NobuData/ouroboros/issues/304),
 * AQ.4 [#312](https://github.com/NobuData/ouroboros/issues/312)). The writer is the executor
 * (AF.2 [#235](https://github.com/NobuData/ouroboros/issues/235)) through `routing/snapshot.ts`;
 * until it exists the dev seed's run #482 is the one row there is.
 *
 * **`resolvedHopIndex` is the card's line, named rather than re-derived.** The card draws the hop
 * that resolved — `alias coder-max → provider Anthropic (key …Xq4A) → model claude-fable-5` — and
 * that is the first kept hop. Carrying its index keeps the rule in one place; `null` for a run
 * that failed, whose chain is still all here to render.
 *
 * **`keySuffix` is the bare tail — `Xq4A`.** The card prints it as `(key …Xq4A)` and the inspector
 * as `sk-ant-…Xq4A`; both are presentations of these four characters, and neither is a key.
 */

import type {
  ProviderConnectionStatus,
  ResolutionSnapshotHopDocument,
  ResolutionSnapshotRuleDocument,
} from "../db/schema";
import type { ResolutionSnapshotRow } from "./resolutions.rows";

/** Where a snapshot hop's model ran, as it read then. */
export interface ResolutionSnapshotProviderResource {
  /** The adapter kind — `anthropic`. */
  readonly kind: string;
  /** The connection's display name then — `Anthropic Claude`. */
  readonly displayName: string;
  /** The masked tail of the key the hop resolved with — `Xq4A` — or null. Never a key. */
  readonly keySuffix: string | null;
  /** The connection's state in the health snapshot the resolution used. */
  readonly status: ProviderConnectionStatus;
  /** The latency measured then, in ms, or null. */
  readonly latencyMs: number | null;
  /** Why it was in that state, or null. */
  readonly detail: string | null;
}

/** One hop of a stored chain. */
export interface ResolutionSnapshotHopResource {
  /** 1-based place in the resolved chain, dropped hops included. */
  readonly index: number;
  /** `route_hops.position`, or null for a hop a rule prepended. */
  readonly position: number | null;
  /** The alias the hop named. */
  readonly alias: string;
  /** The raw provider model id it resolved to. */
  readonly modelId: string;
  /** The params it resolved with. */
  readonly params: Record<string, unknown>;
  /** Where it ran, or null for an unbound alias. */
  readonly provider: ResolutionSnapshotProviderResource | null;
  /** The operator's note, or null. */
  readonly note: string | null;
  /** Whether it was kept. */
  readonly decision: "kept" | "dropped";
  /** Z.1's code. */
  readonly code: string;
  /** Z.1's sentence, as written then — rendered verbatim. */
  readonly explanation: string;
  /** How long the hop took, in ms — only on a hop that was tried. */
  readonly durationMs: number | null;
}

/** One evaluated rule. */
export interface ResolutionSnapshotRuleResource {
  /** The rule's id then. */
  readonly id: string;
  /** Its evaluation order then, or null. */
  readonly sortOrder: number | null;
  /** V018's sentence, as it read then. */
  readonly display: string;
  /** Whether it changed the resolution. */
  readonly applied: boolean;
  /** What it did, or why not. */
  readonly code: string;
  /** The same, as a sentence, or null. */
  readonly explanation: string | null;
}

/** One stored resolution. */
export interface ResolutionSnapshotResource {
  /** The shape the snapshot is written in — the number a consumer pins. */
  readonly shapeVersion: number;
  /** `resolution_snapshots.id`. */
  readonly id: string;
  /** The run it served. `issueNumber` is the card's `run #482`. */
  readonly run: { readonly id: string; readonly issueNumber: number };
  /** The kind resolved for — the card's `route.task("implement")`. */
  readonly taskKind: string;
  /** The route that answered — the card's `route implement-primary`. */
  readonly routeTag: string;
  /** `resolved` or `fail_run` — the card's `● resolved`. */
  readonly outcome: "resolved" | "fail_run";
  /** The whole resolution's duration in ms — the card's `· 42ms` — or null when untimed. */
  readonly durationMs: number | null;
  /** The index of the hop that resolved — the first kept one — or null for a failed run. */
  readonly resolvedHopIndex: number | null;
  /** Every hop, dropped ones included. */
  readonly chain: readonly ResolutionSnapshotHopResource[];
  /** Every matched rule, applied or not. */
  readonly rules: readonly ResolutionSnapshotRuleResource[];
  /** When the resolution was made, ISO 8601. */
  readonly resolvedAt: string;
}

/** `GET /registry/resolutions/latest?alias=` — the alias asked about, and its latest snapshot. */
export interface LatestResolutionResource {
  /** The alias, echoed. */
  readonly alias: string;
  /**
   * The most recent snapshot whose chain names the alias, or null when none does — the card's
   * cue to render a Simulate-driven preview labelled as one (R9), never a fabricated run.
   */
  readonly snapshot: ResolutionSnapshotResource | null;
}

/**
 * A stored hop, as the resource.
 *
 * @param hop - The stored hop.
 * @returns The hop, with every optional member present and null when not known.
 */
function toHopResource(hop: ResolutionSnapshotHopDocument): ResolutionSnapshotHopResource {
  return {
    index: hop.index,
    position: hop.position ?? null,
    alias: hop.alias,
    modelId: hop.model_id,
    params: hop.params ?? {},
    provider:
      hop.provider === null
        ? null
        : {
            kind: hop.provider.kind,
            displayName: hop.provider.display_name,
            keySuffix: hop.provider.key_suffix ?? null,
            status: hop.provider.status,
            latencyMs: hop.provider.latency_ms ?? null,
            detail: hop.provider.detail ?? null,
          },
    note: hop.note ?? null,
    decision: hop.decision,
    code: hop.code,
    explanation: hop.explanation,
    durationMs: hop.duration_ms ?? null,
  };
}

/**
 * A stored rule, as the resource.
 *
 * @param rule - The stored rule.
 * @returns The rule, with optional members null when not known.
 */
function toRuleResource(rule: ResolutionSnapshotRuleDocument): ResolutionSnapshotRuleResource {
  return {
    id: rule.id,
    sortOrder: rule.sort_order ?? null,
    display: rule.display,
    applied: rule.applied,
    code: rule.code,
    explanation: rule.explanation ?? null,
  };
}

/**
 * One snapshot row, as the resource.
 *
 * @param row - The row, joined to its run.
 * @returns The snapshot.
 */
export function toSnapshotResource(row: ResolutionSnapshotRow): ResolutionSnapshotResource {
  const chain = row.chain.map(toHopResource);

  return {
    shapeVersion: row.shape_version,
    id: row.id,
    run: { id: row.run_id, issueNumber: row.issue_number },
    taskKind: row.task_kind,
    routeTag: row.route_tag,
    outcome: row.outcome,
    durationMs: row.duration_ms,
    resolvedHopIndex: chain.find((hop) => hop.decision === "kept")?.index ?? null,
    chain,
    rules: row.rules.map(toRuleResource),
    resolvedAt: row.resolved_at.toISOString(),
  };
}
