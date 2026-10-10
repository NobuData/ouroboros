import type {
  InvestigationDetail,
  InvestigationKind,
  InvestigationProgress,
  ResearchToolCatalogEntry,
  ScopeEstimate,
  StartedInvestigation,
} from "@/app/api/research";
import type { ComposerReadings, DepthEstimates } from "@/app/research/composer";
import type { ProgressMessage, ProgressSource, ProgressSourceFactory } from "@/app/research/progress";

/**
 * The composer's fixtures (CN.2, #628): the two catalogs as `GET /research/kinds` and
 * `GET /research/tools` serve them for the seeded workspace (V106's four kinds and six tools,
 * five of them with an adapter), the estimates the seeded deep dive answers — priced, and the
 * same choices unpriced — and the progress readings a run streams.
 */

/** V106's four kinds, in the composer's order, with their v1 playbooks. */
export function seededKinds(): InvestigationKind[] {
  return [
    kind("bug_root_cause", "Bug root cause", "bug", ["code", "tickets", "telemetry"], ["brief", "fix_draft"]),
    kind("regression_forensics", "Regression forensics", "reg", ["code", "telemetry", "tickets"], ["brief", "fix_draft"]),
    kind("roadmap_improvements", "Roadmap & improvements", "road", ["tickets", "web", "competitor"], ["brief", "roadmap_doc"]),
    kind("gap_analysis", "Gap analysis", "gap", ["web", "competitor", "code", "tickets", "telemetry"], ["brief", "matrix"]),
  ];
}

/**
 * One kind.
 *
 * @param slug The slug.
 * @param name The label.
 * @param tint The hue key.
 * @param defaultTools The playbook's default tools.
 * @param deliverables The playbook's deliverables.
 * @returns The kind.
 */
export function kind(
  slug: string,
  name: string,
  tint: string,
  defaultTools: string[],
  deliverables: InvestigationKind["playbook"]["deliverables"],
): InvestigationKind {
  return { slug, name, tint, playbook: { version: 1, defaultTools, deliverables } };
}

/** The six tools in the composer's order — five connected, `docs` idle. */
export function seededTools(): ResearchToolCatalogEntry[] {
  return [
    { slug: "web", name: "Web search & page reader", glyph: "◍", connected: true },
    { slug: "competitor", name: "Competitor tracker", glyph: "⌖", connected: true },
    { slug: "code", name: "Codebase & git mining", glyph: "⌥", connected: true },
    { slug: "tickets", name: "Issue & PR history index", glyph: "▤", connected: true },
    { slug: "telemetry", name: "Build & test telemetry", glyph: "∿", connected: true },
    { slug: "docs", name: "Docs, standards & papers", glyph: null, connected: false },
  ];
}

/** The five slugs the seeded gap analysis turns on. */
export const FIVE_TOOLS = ["web", "competitor", "code", "tickets", "telemetry"];

/**
 * The composer's three readings, every one answered.
 *
 * @param over What this case changes.
 * @returns The readings.
 */
export function composerReadings(over: Partial<ComposerReadings> = {}): ComposerReadings {
  return {
    kinds: { ok: true, value: { kinds: seededKinds() } },
    tools: { ok: true, value: { tools: seededTools() } },
    settings: { ok: true, value: { startRole: "member" } },
    ...over,
  };
}

/** The seeded researcher — `researcher-long-ctx` on the catalog's priced model. */
export const PRICED_RESEARCHER: ScopeEstimate["researcher"] = {
  taskKind: "research",
  routeTag: "research-primary",
  alias: "researcher-long-ctx",
  modelId: "claude-sonnet-4-6",
};

/** The same route resolving to a model with no per-token price. */
export const UNPRICED_RESEARCHER: ScopeEstimate["researcher"] = {
  taskKind: "research",
  routeTag: "research-primary",
  alias: "researcher-experimental",
  modelId: "gpt-5.2-preview",
};

/** The figures of each depth over the five tools — the service's own for the deep dive. */
const DEPTH_FIGURES = {
  quick: { operations: 10, sources: { min: 10, max: 15 }, cost: { min: 130, max: 172 }, dollars: "~$2" },
  standard: { operations: 20, sources: { min: 20, max: 30 }, cost: { min: 261, max: 344 }, dollars: "~$3" },
  deep_dive: { operations: 40, sources: { min: 40, max: 60 }, cost: { min: 522, max: 687 }, dollars: "~$6" },
} as const;

/**
 * One estimate, as `POST /research/estimates` answers it.
 *
 * @param depth The depth.
 * @param priced Whether the researcher is priced. Unpriced, `costCents` is null and the label
 *   carries no `$`.
 * @param over What this case changes.
 * @returns The estimate.
 */
export function estimate(
  depth: ScopeEstimate["depth"] = "deep_dive",
  priced = true,
  over: Partial<ScopeEstimate> = {},
): ScopeEstimate {
  const figures = DEPTH_FIGURES[depth];
  const sources = `est. ${String(figures.sources.min)}–${String(figures.sources.max)} sources`;

  return {
    depth,
    tools: [...FIVE_TOOLS],
    researcher: priced ? PRICED_RESEARCHER : UNPRICED_RESEARCHER,
    calibrationVersion: 1,
    operations: {
      total: figures.operations,
      byTool: FIVE_TOOLS.map((tool) => ({ tool, operations: figures.operations / 5, hostedCostCents: null })),
    },
    synthesisCalls: { min: figures.sources.min + 4, max: figures.sources.max + 4 },
    sources: figures.sources,
    costCents: priced ? figures.cost : null,
    label: priced ? `${sources} · ${figures.dollars}` : sources,
    ...over,
  };
}

/**
 * Every depth's estimate.
 *
 * @param priced Whether the researcher is priced.
 * @param over What every estimate changes.
 * @returns The three.
 */
export function depthEstimates(priced = true, over: Partial<ScopeEstimate> = {}): DepthEstimates {
  return {
    quick: estimate("quick", priced, over),
    standard: estimate("standard", priced, over),
    deep_dive: estimate("deep_dive", priced, over),
  };
}

/** The seeded deep dive's line. */
export const SEEDED_LABEL = "est. 40–60 sources · ~$6";

/** The id a start answers. */
export const STARTED_ID = "5eed0084-0000-4000-8000-000000000128";

/**
 * One progress reading.
 *
 * @param over What this case changes.
 * @returns A running reading in its first round.
 */
export function progress(over: Partial<InvestigationProgress> = {}): InvestigationProgress {
  return {
    status: "running",
    iteration: 1,
    iterations: 4,
    sources: 0,
    spendCents: null,
    cancelRequested: false,
    updatedAt: "2026-10-10T12:00:00.000Z",
    ...over,
  };
}

/**
 * An investigation, opened — as a start answers it, just dispatched.
 *
 * @param over What this case changes.
 * @returns The detail.
 */
export function investigationDetail(over: Partial<InvestigationDetail> = {}): InvestigationDetail {
  return {
    id: STARTED_ID,
    displayId: "RS-128",
    kind: { slug: "gap_analysis", name: "Gap analysis", tint: "gap" },
    question: "Why are we losing autonomous-docking deals?",
    depth: "deep_dive",
    tools: [...FIVE_TOOLS],
    origin: "user",
    status: "queued",
    pill: { state: "queued", label: "queued", tone: "warn", live: false },
    sources: 0,
    link: null,
    startedBy: { id: "user-ken", name: "Ken Suenobu" },
    createdAt: "2026-10-10T12:00:00.000Z",
    updatedAt: "2026-10-10T12:00:00.000Z",
    estimate: { sources: { min: 40, max: 60 }, costCents: { min: 522, max: 687 }, calibrationVersion: 1 },
    actuals: null,
    provenance: { researcher: "loop-v1", alias: "researcher-long-ctx", resolutionRef: null },
    progress: progress({ status: "queued", iteration: null }),
    brief: null,
    deliverables: [],
    ledger: { total: 0, byTool: [] },
    links: { run: null, roadmap: null, brief: null, evidence: null },
    failure: null,
    mayCancel: true,
    ...over,
  };
}

/**
 * What a start answers.
 *
 * @param over What this case changes on the investigation.
 * @returns The started investigation under the seeded estimate.
 */
export function startedInvestigation(over: Partial<InvestigationDetail> = {}): StartedInvestigation {
  return { investigation: investigationDetail(over), estimate: estimate() };
}

/**
 * A progress source a test drives: it records the address it was opened on, and dispatches what
 * the service would — `progress`, `done` and `error` events carrying JSON, or the browser's own
 * connection `error` carrying nothing.
 */
export class FakeProgressSource implements ProgressSource {
  /** Every source opened, in order. */
  static readonly opened: FakeProgressSource[] = [];

  private readonly listeners = new Map<string, ((event: ProgressMessage) => void)[]>();

  /** Whether `close()` has been called. */
  closed = false;

  /** @param url The address it was opened on. */
  constructor(readonly url: string) {
    FakeProgressSource.opened.push(this);
  }

  addEventListener(type: string, listener: (event: ProgressMessage) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  /**
   * Dispatch one event.
   *
   * @param type The event's name.
   * @param data Its payload, serialised as the `data:` line; omitted for a connection event.
   */
  emit(type: string, data?: unknown): void {
    const event: ProgressMessage = data === undefined ? {} : { data: JSON.stringify(data) };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  /**
   * Dispatch a raw `data:` line, for what is not JSON.
   *
   * @param type The event's name.
   * @param raw The line.
   */
  emitRaw(type: string, raw: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data: raw });
  }

  /** Forget every source opened so far. */
  static reset(): void {
    FakeProgressSource.opened.length = 0;
  }

  /** The newest source opened. */
  static latest(): FakeProgressSource {
    const source = FakeProgressSource.opened.at(-1);
    if (source === undefined) throw new Error("no progress source was opened");

    return source;
  }
}

/** Opens a {@link FakeProgressSource}. */
export const openFakeSource: ProgressSourceFactory = (url) => new FakeProgressSource(url);
