/**
 * The research estimator's published shapes — what `POST /research/estimates` answers, and what
 * the service hands CM.6 ([#625](https://github.com/NobuData/ouroboros/issues/625)) and CM.1
 * ([#620](https://github.com/NobuData/ouroboros/issues/620)).
 *
 * [#622](https://github.com/NobuData/ouroboros/issues/622). The mapping from rows and the pure
 * estimate to these shapes lives here, once, so the endpoint and the store path cannot describe
 * one estimate two ways.
 */

import type { InvestigationDepth, InvestigationEstimateOutcome } from "../db/schema";
import type { Range, ScopeEstimate, ToolOperations } from "./estimate";
import { renderEstimateLabel } from "./estimate";
import type { ResearchToolConfig, ResearchToolFormField } from "./tools/research-tool.config";
import type { ToolHealthDot, ToolHealthState } from "./tools/research-tool.health";

/** The task kind the researcher's alias is resolved for — routing's `route.task("research")`. */
export const RESEARCH_TASK_KIND = "research";

/**
 * The researcher the composer's pill names — the alias routing resolved `research` to.
 *
 * The first **kept** hop of the resolved chain: the alias that will actually run if the run
 * starts now. When the primary is down that is the fallback, and the pill says so rather than
 * naming an alias that will not answer.
 */
export interface ResearcherResource {
  /** Always `research`. */
  readonly taskKind: string;
  /** The route's tag — `research-primary`. */
  readonly routeTag: string;
  /** The alias — `researcher-long-ctx`. What the pill prints. */
  readonly alias: string;
  /** What the alias means — the raw model id (decision M1: the only place it appears). */
  readonly modelId: string;
}

/** One estimate, as the composer receives it. */
export interface ScopeEstimateResource {
  /** The depth estimated. */
  readonly depth: InvestigationDepth;
  /** The tools estimated — the request's, or the kind's playbook defaults. */
  readonly tools: readonly string[];
  /**
   * The researcher, or null when routing has nothing to run: no `research` route in this
   * workspace, or a resolution with no kept hop. Null makes the estimate unpriced, too.
   */
  readonly researcher: ResearcherResource | null;
  /** Which estimator calibration computed it. */
  readonly calibrationVersion: number;
  /** The operation budget — total and per tool. */
  readonly operations: { readonly total: number; readonly byTool: readonly ToolOperations[] };
  /** Planned model calls through the researcher alias. */
  readonly synthesisCalls: Range;
  /** Citable sources expected. Always present. */
  readonly sources: Range;
  /** Expected spend in cents — or null when the researcher is unpriced, and then no cost anywhere. */
  readonly costCents: Range | null;
  /** The composer's line, verbatim — `est. 40–60 sources · ~$6`. No `$` when `costCents` is null. */
  readonly label: string;
}

/**
 * One investigation kind, as the composer's segmented control draws it (CN.2,
 * [#628](https://github.com/NobuData/ouroboros/issues/628)) — V106's `investigation_kinds` row
 * without its ids and stamps.
 */
export interface InvestigationKindResource {
  /** `gap_analysis` — what a start or an estimate names. */
  readonly slug: string;
  /** The segment's label — *Gap analysis*. */
  readonly name: string;
  /** The chip's hue key — `bug`, `reg`, `road`, `gap`. A key the UI maps to its tokens. */
  readonly tint: string;
  /** The kind's playbook: which tools it turns on by default, and what it delivers. */
  readonly playbook: {
    readonly version: number;
    /** The chips on when this kind is chosen — registered `research_tools` slugs. */
    readonly defaultTools: readonly string[];
    /** `brief` always; then `matrix`, `roadmap_doc` or `fix_draft`. The deliverable line. */
    readonly deliverables: readonly string[];
  };
}

/** `GET /research/kinds` — a workspace's kinds, in the composer's order. */
export interface InvestigationKindCatalogResource {
  readonly kinds: readonly InvestigationKindResource[];
}

/**
 * One research tool, as the composer's chips draw it (CN.2,
 * [#628](https://github.com/NobuData/ouroboros/issues/628)).
 *
 * **Connected means shipped**: the slug has an adapter registered in this build (CL.1's
 * registry), so an investigation can call it. Whether the workspace's configuration of it is
 * healthy is the tools card's dot (#629) — a different question, answered by `healthCheck()`.
 * A row of `research_tools` with no adapter — `docs`, until CO.1 — is the idle chip.
 */
export interface ResearchToolCatalogEntryResource {
  /** `web` — what a selection names. */
  readonly slug: string;
  /** The chip's label — the adapter's display name, or V106's title when no adapter exists. */
  readonly name: string;
  /** The adapter's one-character glyph — `⌖`; null when no adapter exists. */
  readonly glyph: string | null;
  /** Whether an adapter is registered for the slug in this build. */
  readonly connected: boolean;
  /**
   * The tools card's second line, its counts filled in for this workspace — `4 rivals watched ·
   * release notes, changelogs, filings`. Null only for a tool with neither an adapter nor a
   * planned entry.
   */
  readonly subLine: string | null;
  /** What `healthCheck()` answered for this workspace's configuration — the card's dot. */
  readonly health: ResearchToolHealthResource;
  /** Whether the workspace has stored settings for the tool — what *enabled* means. */
  readonly configured: boolean;
  /** Whether a credential is stored. Never the credential. */
  readonly hasCredential: boolean;
  /** What the row's **enable** opens; null for a tool nothing can be said about. */
  readonly enable: ResearchToolEnableResource | null;
}

/** A tool's health as the card draws it (CN.3, #629). */
export interface ResearchToolHealthResource {
  readonly state: ToolHealthState;
  /** The dot class — `ok`, `warn`, `err` or `idle`. */
  readonly dot: ToolHealthDot;
  /** The dot's tooltip — `SearXNG · 200 · 41ms`, `not configured`. */
  readonly detail: string;
}

/**
 * What **enable** opens: the configuration form `configSchema()` describes, or — for a tool this
 * build has no adapter for — the honest note saying when it arrives.
 */
export type ResearchToolEnableResource =
  | {
      readonly kind: "form";
      /** The schema's title — the sheet's heading. */
      readonly title: string;
      /** The form's fields, in schema order. */
      readonly fields: readonly ResearchToolFormField[];
      /** The stored non-secret settings, to start the form from; `{}` before the first save. */
      readonly values: ResearchToolConfig;
    }
  | {
      readonly kind: "planned";
      /** The release the tool arrives in — `v2`. */
      readonly release: string;
      /** The issue that tracks it. */
      readonly issue: number;
    };

/** `GET /research/tools` — every tool the installation answers to, in the composer's order. */
export interface ResearchToolCatalogResource {
  readonly tools: readonly ResearchToolCatalogEntryResource[];
  /** How many tools answer for this workspace — a `healthy` or `degraded` dot. */
  readonly connectedCount: number;
}

/**
 * A tool the mockup draws and no adapter answers to yet — the idle sixth row. Its glyph and
 * sub-line are the mockup's, because there is no adapter to ask; its **enable** says when it
 * arrives instead of opening a form that could not save.
 */
export interface PlannedTool {
  readonly glyph: string;
  readonly subLine: string;
  readonly release: string;
  readonly issue: number;
}

/** The planned tools, by slug. `docs` is CO.1's (#635). */
export const PLANNED_TOOLS: Readonly<Record<string, PlannedTool>> = {
  docs: {
    glyph: "§",
    subLine: "datasheets, RFCs, arXiv — PDF reader with citations",
    release: "v2",
    issue: 635,
  },
};

/** The health states that count toward `connectedCount`. */
export const ANSWERING_STATES: readonly ToolHealthState[] = ["healthy", "degraded"];

/**
 * The built-in kinds in mockup 22's order — the segmented control reads left to right from
 * the quickest question to the broadest. A workspace's own kinds follow, by name.
 */
export const BUILT_IN_KIND_ORDER: readonly string[] = [
  "bug_root_cause",
  "regression_forensics",
  "roadmap_improvements",
  "gap_analysis",
];

/** The six tools in mockup 22's order — the composer's chips and the tools card's rows. */
export const BUILT_IN_TOOL_ORDER: readonly string[] = [
  "web",
  "competitor",
  "code",
  "tickets",
  "telemetry",
  "docs",
];

/**
 * Orders catalog entries the way the mockup reads them: the built-in ones in their published
 * order, then everything else by name.
 *
 * @param entries - The entries.
 * @param order - The built-in slugs, in order.
 * @returns A new array.
 */
export function orderCatalog<T extends { readonly slug: string; readonly name: string }>(
  entries: readonly T[],
  order: readonly string[],
): T[] {
  const rank = (entry: T): number => {
    const index = order.indexOf(entry.slug);
    return index === -1 ? order.length : index;
  };

  return [...entries].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug),
  );
}

/** An investigation's estimate set beside what it actually used — one calibration record. */
export interface EstimateOutcomeResource {
  /** The investigation. */
  readonly investigationId: string;
  /** The calibration its estimate was computed under. */
  readonly calibrationVersion: number;
  readonly depth: InvestigationDepth;
  readonly tools: readonly string[];
  /** The alias that ran it, or null when none was recorded. */
  readonly alias: string | null;
  /** The estimate. */
  readonly estimated: { readonly sources: Range; readonly costCents: Range | null };
  /** The actuals. */
  readonly actual: { readonly sources: number; readonly spendCents: number | null };
  /** Whether the actual source count fell inside the estimate. */
  readonly sourcesWithinEstimate: boolean;
  /** Whether the actual spend fell inside the cost range; null when either side is unpriced. */
  readonly costWithinEstimate: boolean | null;
  readonly recordedAt: string;
}

/**
 * The published form of an estimate.
 *
 * @param estimate - The pure estimate.
 * @param depth - The depth it was computed for.
 * @param tools - The tools it was computed for.
 * @param researcher - The resolved researcher, or null.
 * @returns The resource, with its label composed.
 */
export function scopeEstimateResource(
  estimate: ScopeEstimate,
  depth: InvestigationDepth,
  tools: readonly string[],
  researcher: ResearcherResource | null,
): ScopeEstimateResource {
  return {
    depth,
    tools: [...tools],
    researcher,
    calibrationVersion: estimate.calibrationVersion,
    operations: estimate.operations,
    synthesisCalls: estimate.synthesisCalls,
    sources: estimate.sources,
    costCents: estimate.costCents,
    label: renderEstimateLabel(estimate),
  };
}

/**
 * The published form of a calibration record.
 *
 * @param row - The `investigation_estimate_outcomes` row.
 * @returns The resource.
 */
export function estimateOutcomeResource(
  row: InvestigationEstimateOutcome,
): EstimateOutcomeResource {
  const cost =
    row.estimated_cost_cents_min === null || row.estimated_cost_cents_max === null
      ? null
      : { min: row.estimated_cost_cents_min, max: row.estimated_cost_cents_max };

  return {
    investigationId: row.investigation_id,
    calibrationVersion: row.calibration_version,
    depth: row.depth,
    tools: row.tools_enabled,
    alias: row.alias,
    estimated: {
      sources: { min: row.estimated_sources_min, max: row.estimated_sources_max },
      costCents: cost,
    },
    actual: { sources: row.actual_sources, spendCents: row.actual_spend_cents },
    sourcesWithinEstimate: row.sources_within_estimate,
    costWithinEstimate: row.cost_within_estimate,
    recordedAt: row.recorded_at.toISOString(),
  };
}
