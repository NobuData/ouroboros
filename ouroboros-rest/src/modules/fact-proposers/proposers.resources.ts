/**
 * The shapes `/api/v1/fact-proposers` answers with (BF.3,
 * [#412](https://github.com/NobuData/ouroboros/issues/412)).
 *
 * Every candidate and suppression names its **proposer kind** — `correction_note`, `waiver`,
 * `steer`, `import` — so the UI phrases provenance from what actually produced it (K5).
 */

import type { FactSuppressionProposer } from "../db/schema";
import type { FactProvenance } from "../facts/facts.resources";
import { PROPOSER_DEFINITIONS, PROPOSER_REGISTRY_VERSION } from "./proposers.registry";
import type { ProposalOutcome } from "./proposers.types";

/** One registry entry, as data. */
export interface ProposerDefinitionResource {
  readonly kind: string;
  readonly version: number;
  readonly trigger: string;
  readonly source: string;
  readonly extraction: string;
  /** The provenance ref kinds its candidates carry; `?` optional, `*` zero or more. */
  readonly provenanceShape: readonly string[];
}

/** `GET /api/v1/fact-proposers` — the registry. */
export interface ProposerRegistryResource {
  readonly version: number;
  /** Always `proposed` — no proposer can land a candidate in any other status (K3). */
  readonly landsAs: "proposed";
  readonly proposers: readonly ProposerDefinitionResource[];
}

/** One recorded suppression — a candidate not proposed because an existing fact matched. */
export interface SuppressionResource {
  readonly id: string;
  readonly proposer: FactSuppressionProposer;
  readonly proposerVersion: number;
  readonly repoRef: string | null;
  /** The candidate as extracted. */
  readonly text: string;
  /** The fact it matched, in any status. */
  readonly matchedFactId: string;
  readonly provenance: FactProvenance;
  /** The source row — `classification:<uuid>`, `waiver:<uuid>`, `steer:<uuid>`. */
  readonly sourceKey: string;
  readonly createdAt: string;
}

/** `GET /api/v1/fact-proposers/suppressions`. */
export interface SuppressionList {
  readonly items: readonly SuppressionResource[];
}

/** `POST /api/v1/fact-proposers/backfill` — what every source of a run became. */
export interface BackfillResource {
  readonly runId: string;
  readonly outcomes: readonly ProposalOutcome[];
  readonly counts: {
    readonly proposed: number;
    readonly suppressed: number;
    readonly alreadyProposed: number;
    readonly skipped: number;
  };
}

/**
 * @returns The registry as data.
 */
export function registryResource(): ProposerRegistryResource {
  return {
    version: PROPOSER_REGISTRY_VERSION,
    landsAs: "proposed",
    proposers: PROPOSER_DEFINITIONS.map((definition) => ({
      kind: definition.kind,
      version: definition.version,
      trigger: definition.trigger,
      source: definition.source,
      extraction: definition.extraction,
      provenanceShape: [...definition.provenanceShape],
    })),
  };
}

/**
 * @param runId - The run.
 * @param outcomes - What each source became.
 * @returns The backfill's answer, with its counts.
 */
export function backfillResource(
  runId: string,
  outcomes: readonly ProposalOutcome[],
): BackfillResource {
  const count = (outcome: ProposalOutcome["outcome"]): number =>
    outcomes.filter((each) => each.outcome === outcome).length;

  return {
    runId,
    outcomes,
    counts: {
      proposed: count("proposed"),
      suppressed: count("suppressed"),
      alreadyProposed: count("already_proposed"),
      skipped: count("skipped"),
    },
  };
}
