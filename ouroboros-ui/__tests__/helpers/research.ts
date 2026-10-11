import type {
  BriefCite,
  BriefLedgerSource,
  BriefSource,
  CapabilityMatrix,
  GapProposals,
  Investigation,
  InvestigationBrief,
  InvestigationDetail,
  InvestigationKind,
  InvestigationList,
  InvestigationProgress,
  MatrixCell,
  RegressionWatchCard,
  RegressionWatchItem,
  ResearchRoadmap,
  ResearchToolCatalog,
  ResearchToolCatalogEntry,
  ResearchToolEnableForm,
  RoadmapItem,
  RoadmapSuggestion,
  ScopeEstimate,
  StartedInvestigation,
} from "@/app/api/research";
import type { FeaturedBrief } from "@/app/research/brief";
import type { ComposerReadings, DepthEstimates } from "@/app/research/composer";
import type { FeaturedPipeline } from "@/app/research/pipeline";
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

/** A one-field form: what a tool with nothing required offers. */
export function plainForm(title: string): ResearchToolEnableForm {
  return {
    kind: "form",
    title,
    values: {},
    fields: [
      {
        name: "windowDays",
        label: "Window (days)",
        widget: "text",
        required: false,
        help: null,
        placeholder: null,
        defaultValue: null,
        choices: null,
        minLength: null,
        maxLength: null,
        pattern: null,
        minItems: null,
        maxItems: null,
      },
    ],
  };
}

/**
 * One enabled, healthy tool.
 *
 * @param slug Its slug.
 * @param name Its name.
 * @param glyph Its glyph.
 * @param subLine Its computed sub-line.
 * @param over What this case changes.
 * @returns The catalog entry.
 */
export function tool(
  slug: string,
  name: string,
  glyph: string,
  subLine: string,
  over: Partial<ResearchToolCatalogEntry> = {},
): ResearchToolCatalogEntry {
  return {
    slug,
    name,
    glyph,
    connected: true,
    subLine,
    health: { state: "healthy", dot: "ok", detail: "200 · 41ms" },
    configured: true,
    hasCredential: false,
    enable: plainForm(name),
    ...over,
  };
}

/** The six tools in the composer's order — five enabled and healthy, `docs` planned and idle. */
export function seededTools(): ResearchToolCatalogEntry[] {
  return [
    tool("web", "Web search & page reader", "◍", "SearXNG · full-page extraction, robots-aware"),
    tool("competitor", "Competitor tracker", "⌖", "4 rivals watched · release notes, changelogs, filings"),
    tool("code", "Codebase & git mining", "⌥", "blame, bisect, dependency graph over helios-firmware"),
    tool("tickets", "Issue & PR history index", "▤", "3,412 issues · support tickets · churn interviews"),
    tool("telemetry", "Build & test telemetry", "∿", "HIL bench measurements · 6 metrics"),
    {
      slug: "docs",
      name: "Docs, standards & papers",
      glyph: "§",
      connected: false,
      subLine: "datasheets, RFCs, arXiv — PDF reader with citations",
      health: { state: "not_configured", dot: "idle", detail: "not configured" },
      configured: false,
      hasCredential: false,
      enable: { kind: "planned", release: "v2", issue: 635 },
    },
  ];
}

/** The seeded catalog: the six tools, five of them answering. */
export function seededCatalog(tools: ResearchToolCatalogEntry[] = seededTools()): ResearchToolCatalog {
  return {
    tools,
    connectedCount: tools.filter((entry) => entry.health.dot === "ok" || entry.health.dot === "warn").length,
  };
}

/** A window of samples — what an item's `baseline` and `current` carry. */
const WINDOW: RegressionWatchItem["baseline"] = {
  n: 14,
  median: 31,
  spread: 4.2,
  spreadKind: "iqr",
  unit: "cm",
  from: "2026-10-03T00:00:00Z",
  to: "2026-10-10T00:00:00Z",
};

/**
 * One watch item — the seeded hover drift unless told otherwise.
 *
 * @param over What this case changes.
 * @returns The item.
 */
export function watchItem(over: Partial<RegressionWatchItem> = {}): RegressionWatchItem {
  return {
    id: "5eed0096-0000-4000-8000-000000000101",
    repository: "acme-robotics/helios-firmware",
    metric: "hover_drift_cm",
    metricLabel: "hover_drift_cm",
    releaseTag: "v2.0.4",
    severity: "err",
    status: "fix_running",
    drift: "+14%",
    driftValue: 14,
    driftUnit: "%",
    baseline: WINDOW,
    current: WINDOW,
    detail: "bisected → a41f2c9 · fix loop running · #512",
    pill: { label: "fixing", tone: "run" },
    note: null,
    bisect: {
      id: null,
      culpritSha: "a41f2c95d0b7e31c8a64f20e9d1b37c55a8f06e2",
      culprit: "a41f2c9",
      commitUrl:
        "https://github.com/acme-robotics/helios-firmware/commit/a41f2c95d0b7e31c8a64f20e9d1b37c55a8f06e2",
      steps: 5,
      farmJobIds: [],
    },
    investigation: null,
    fixTicket: { kind: "ticket", id: "5eed008e-0000-4000-8000-000000000512", key: "#512" },
    fixRun: { id: "5eed0009-0000-4000-8000-000000000512" },
    fixTicketUrl: "https://github.com/acme-robotics/helios-firmware/issues/512",
    pullRequest: null,
    detectedAt: "2026-10-05T02:00:00Z",
    statusChangedAt: "2026-10-06T02:00:00Z",
    ...over,
  };
}

/** Mockup 22's three rows: fixing with a run, queued with a ticket only, and merged. */
export function seededWatchItems(): RegressionWatchItem[] {
  return [
    watchItem(),
    watchItem({
      id: "5eed0096-0000-4000-8000-000000000102",
      metric: "boot_time_ms",
      metricLabel: "boot_time_ms",
      releaseTag: "v2.1.0-rc1",
      baseline: { ...WINDOW, median: 4120, spread: 35, unit: "ms" },
      current: { ...WINDOW, median: 4350, spread: 38, unit: "ms" },
      severity: "warn",
      status: "fix_drafted",
      drift: "+230 ms",
      detail: "bisected → 7c03d1e · fix ticket drafted · #517",
      pill: { label: "queued", tone: "warn" },
      bisect: {
        id: null,
        culpritSha: "7c03d1e4a92f6b08e31d57c2a9b40f61e7d38c05",
        culprit: "7c03d1e",
        commitUrl:
          "https://github.com/acme-robotics/helios-firmware/commit/7c03d1e4a92f6b08e31d57c2a9b40f61e7d38c05",
        steps: 4,
        farmJobIds: [],
      },
      fixTicket: { kind: "ticket", id: "5eed008e-0000-4000-8000-000000000517", key: "#517" },
      fixRun: null,
      fixTicketUrl: "https://github.com/acme-robotics/helios-firmware/issues/517",
    }),
    watchItem({
      id: "5eed0096-0000-4000-8000-000000000103",
      metric: "soc_error_pct",
      metricLabel: "soc_error_pct",
      baseline: { ...WINDOW, median: 2.1, spread: 0.4, unit: "%" },
      current: { ...WINDOW, median: 4.9, spread: 0.5, unit: "%" },
      severity: "ok",
      status: "fixed_merged",
      drift: "+2.8%",
      detail: "root-caused, fixed & merged · PR #641",
      pill: { label: "✓ merged", tone: "ok" },
      fixTicket: { kind: "ticket", id: "5eed008e-0000-4000-8000-000000000639", key: "#639" },
      fixRun: null,
      fixTicketUrl: "https://github.com/acme-robotics/helios-firmware/issues/639",
      pullRequest: { id: "5eed0098-0000-4000-8000-000000000641", key: "#641" },
    }),
  ];
}

/** An item the watch could not bisect, resting at `detected` with its explanation. */
export function needsReproItem(): RegressionWatchItem {
  return watchItem({
    id: "5eed0096-0000-4000-8000-000000000104",
    metric: "fan_rpm_variance",
    metricLabel: "fan_rpm_variance",
    baseline: { ...WINDOW, unit: "rpm" },
    current: { ...WINDOW, unit: "rpm" },
    severity: "warn",
    status: "detected",
    drift: "+9%",
    detail: "needs repro: no replayable test is configured for this metric, so it cannot be bisected",
    note: "needs repro: no replayable test is configured for this metric, so it cannot be bisected",
    pill: { label: "detected", tone: "warn" },
    bisect: null,
    fixTicket: null,
    fixRun: null,
    fixTicketUrl: null,
  });
}

/**
 * The watch card as the seed draws it.
 *
 * @param over What this case changes.
 * @returns The card.
 */
export function seededWatch(over: Partial<RegressionWatchCard> = {}): RegressionWatchCard {
  return {
    headline: "nightly vs. 2 release baselines",
    releases: ["v2.1.0-rc1", "v2.0.4"],
    counts: { open: 2, err: 1, warn: 1 },
    items: seededWatchItems(),
    baselines: 3,
    lastComparedAt: "2026-10-10T02:00:00Z",
    ...over,
  };
}

/** A workspace that has captured no baseline. */
export function emptyWatch(): RegressionWatchCard {
  return {
    headline: null,
    releases: [],
    counts: { open: 0, err: 0, warn: 0 },
    items: [],
    baselines: 0,
    lastComparedAt: null,
  };
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
    tools: { ok: true, value: seededCatalog() },
    settings: { ok: true, value: { startRole: "member", gateway: { available: true } } },
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

/* ---------- the featured brief (#630) ---------- */

/** A `source_records` id for a cite number, as the seed spells it. */
export function sourceIdOf(citeNo: number): string {
  return `5eed0085-0000-4000-8000-${citeNo.toString().padStart(12, "0")}`;
}

/**
 * A cite marker.
 *
 * @param citeNo The number.
 * @param citeKey The symbolic key — `git` — or null.
 * @returns The cite.
 */
export function cite(citeNo: number, citeKey: string | null = null): BriefCite {
  return {
    label: citeKey === null ? `[${citeNo.toString().padStart(2, "0")}]` : `[${citeKey}]`,
    citeNo,
    citeKey,
    sourceId: sourceIdOf(citeNo),
  };
}

/** The five sources mockup 22's panel lists, verbatim from the seed. */
const FEATURED_SOURCES: Readonly<Record<number, Partial<BriefSource>>> = {
  7: {
    title: "Skylink S4 docking module — teardown & sensor BOM",
    locator: "https://droneanalysts.example.com/s4-teardown",
    locatorLabel: "droneanalysts.example.com/s4-teardown",
    href: "https://droneanalysts.example.com/s4-teardown",
  },
  12: {
    tool: "competitor",
    kind: "competitor_diff",
    title: 'Skylink firmware 6.2 release notes — "gust-adaptive final approach"',
    locator: "https://skylink.example.com/releases/6.2",
    locatorLabel: "skylink.example.com/releases/6.2",
    href: "https://skylink.example.com/releases/6.2",
  },
  19: {
    tool: "tickets",
    kind: "ticket",
    title: "Churn interviews Q2 — 9 of 14 cite docking reliability",
    locator: "issue-index://support/churn-2026-q2",
    locatorLabel: "issue-index://support/churn-2026-q2",
    href: null,
  },
  31: {
    title: '"MPC for precision landing in turbulent flow" — conf. paper',
    locator: "https://arxiv.example.org/abs/2605.11423",
    locatorLabel: "arxiv.example.org/abs/2605.11423",
    href: "https://arxiv.example.org/abs/2605.11423",
  },
  44: {
    citeKey: "git",
    tool: "code",
    kind: "code",
    title: "dock_ctrl.c blame — gains last tuned 14 months ago",
    locator: "git://acme-robotics/helios-firmware@8c1b2e4/src/dock/dock_ctrl.c",
    locatorLabel: "helios-firmware @ 8c1b2e4 · src/dock/dock_ctrl.c",
    href: "https://github.com/acme-robotics/helios-firmware/blob/8c1b2e4/src/dock/dock_ctrl.c",
  },
};

/**
 * One source as the panel lists it.
 *
 * @param citeNo The number.
 * @param over What this case changes.
 * @returns The source — a web page by default, one of the five featured ones by number.
 */
export function briefSource(citeNo: number, over: Partial<BriefSource> = {}): BriefSource {
  const featured = FEATURED_SOURCES[citeNo] ?? {};
  const citeKey = over.citeKey ?? featured.citeKey ?? null;

  return {
    ...cite(citeNo, citeKey),
    kind: "web",
    tool: "web",
    title: `Source ${String(citeNo)}`,
    locator: `https://example.com/source/${String(citeNo)}`,
    locatorLabel: `example.com/source/${String(citeNo)}`,
    href: `https://example.com/source/${String(citeNo)}`,
    ...featured,
    ...over,
  };
}

/**
 * One source as the full ledger lists it.
 *
 * @param citeNo The number.
 * @param over What this case changes.
 * @returns The record, retrieved `citeNo` minutes after noon.
 */
export function ledgerSource(citeNo: number, over: Partial<BriefLedgerSource> = {}): BriefLedgerSource {
  return {
    ...briefSource(citeNo),
    excerpt: `What was read of source ${String(citeNo)}.`,
    retrievedAt: new Date(Date.UTC(2026, 9, 7, 12, citeNo)).toISOString(),
    contentHash: `sha256:${citeNo.toString(16).padStart(8, "0")}`,
    ...over,
  };
}

/** The 44-record ledger, in cite-number order. */
export function seededLedger(): BriefLedgerSource[] {
  return Array.from({ length: 44 }, (_, index) => ledgerSource(index + 1));
}

/** The panel — the five records the brief's claims cite. */
export function seededPanel(): BriefSource[] {
  return [7, 12, 19, 31, 44].map((citeNo) => briefSource(citeNo));
}

/** The seeded cells: per row, us then Skylink, AeroMesh, Novum — status, note, cited numbers. */
const CELLS: readonly (readonly [MatrixCell["status"], string | null, readonly number[]])[][] = [
  [["partial", null, [25, 26]], ["shipping", null, [1, 8, 40]], ["partial", null, [3, 4]], ["none", null, [5]]],
  [["none", null, [39]], ["shipping", null, [2]], ["shipping", null, [4]], ["partial", "beta", [6, 13]]],
  [["partial", null, [34, 28]], ["shipping", null, [9]], ["partial", null, [11]], ["none", null, [5]]],
  [["wip", "in flight", [36, 24]], ["shipping", null, [10]], ["none", null, [11]], ["none", null, [5]]],
  [["shipping", null, [37, 23]], ["none", null, [2]], ["unknown", null, []], ["none", null, [42]]],
];

const GLYPHS: Readonly<Record<MatrixCell["status"], string>> = {
  shipping: "●",
  partial: "◐",
  wip: "◐",
  none: "○",
  unknown: "?",
};

const STATUS_WORDS: Readonly<Record<MatrixCell["status"], string>> = {
  shipping: "shipping",
  partial: "partial",
  wip: "in flight",
  none: "none",
  unknown: "unknown",
};

/** The seeded rows: capability, severity, label, derivation. */
const ROWS: readonly (readonly [string, CapabilityMatrix["rows"][number]["gap"]["severity"], string])[] = [
  ["Docking in >8 m/s gusts", "high", "Skylink ships it; we are partial → high."],
  ["Visual-inertial approach (no beacon)", "high", "Two rivals ship it; we have none → high."],
  ["Abort & retry recovery logic", "med", "Skylink ships re-planned retries; we are partial → med."],
  ["OTA resilience (A/B + rollback)", "wip", "Ours is in flight → wip."],
  ["Recovery beacon over BLE", "lead", "We ship it; no rival is known to → lead."],
];

/** RS-127's matrix, as `GET …/brief` answers it. */
export function seededMatrix(): CapabilityMatrix {
  const rivals = ["Skylink", "AeroMesh", "Novum"];

  return {
    id: "5eed0095-0000-4000-8000-000000000127",
    title: "Autonomous docking vs. the field",
    columns: [
      { label: "Helios", us: true, competitorId: null },
      ...rivals.map((name, index) => ({
        label: name,
        us: false,
        competitorId: `5eed0094-0000-4000-8000-${(index + 1).toString().padStart(12, "0")}`,
      })),
    ],
    rows: ROWS.map(([capability, severity, derivation], row) => ({
      id: `5eed0095-0000-4000-8000-${(row + 1).toString().padStart(12, "0")}`,
      capability,
      cells: CELLS[row]!.map(([status, note, cited]) => ({
        status,
        glyph: GLYPHS[status],
        label: note ?? STATUS_WORDS[status],
        note,
        cites: cited.map((citeNo) => cite(citeNo)),
      })),
      gap: { severity, label: severity.toUpperCase(), derivation },
    })),
  };
}

/** RS-127's proposals — the epic, five tickets, the first two named, effort L. */
export function seededProposals(): GapProposals {
  const ticket = (
    key: string,
    title: string,
    effort: "s" | "m" | "l",
    capability: string,
    severity: "high" | "med",
    cited: number[],
  ) => ({
    key,
    title,
    label: `${key} ${title}`,
    effort,
    capability,
    severity,
    sources: cited.map((citeNo) => sourceIdOf(citeNo)),
  });
  const tickets = [
    ticket("DOCK-1", "wind-feedforward MPC", "m", ROWS[0]![0], "high", [12, 31]),
    ticket("DOCK-2", "re-planned retry", "m", ROWS[2]![0], "med", [9, 19]),
    ticket("DOCK-3", "gust estimator from IMU residuals", "m", ROWS[0]![0], "high", [25]),
    ticket("DOCK-4", "visual-inertial approach prototype", "l", ROWS[1]![0], "high", [2]),
    ticket("DOCK-5", "HIL gust-profile regression suite", "s", ROWS[0]![0], "high", [26]),
  ];

  return {
    epic: { title: "Docking parity", label: "EPIC · Docking parity" },
    tickets,
    top: tickets.slice(0, 2),
    more: 3,
    effort: "l",
  };
}

/** A span of plain prose with its cites. */
function span(text: string, cites: BriefCite[], claim: InvestigationBrief["brief"]["paragraphs"][number]["spans"][number]["claim"] = null) {
  return { text, segments: [{ kind: "text" as const, text, href: null }], claim, cites };
}

/** RS-127's brief, as `GET …/brief` answers it — mockup 22's featured card. */
export function seededBrief(over: Partial<InvestigationBrief> = {}): InvestigationBrief {
  return {
    investigation: {
      id: "5eed0084-0000-4000-8000-000000000127",
      displayId: "RS-127",
      question: "Why do our drones abort autonomous docking in wind that Skylink's handle?",
      kind: "gap_analysis",
      kindLabel: "Gap analysis",
      tintKey: "gap",
      depth: "deep_dive",
      status: "brief_ready",
    },
    brief: {
      id: "5eed0086-0000-4000-8000-000000000001",
      version: 1,
      createdAt: "2026-10-07T12:20:00.000Z",
      paragraphs: [
        {
          kind: "findings",
          spans: [
            span(
              "The docking gap is not sensors: our IMU and rangefinder match Skylink's published spec.",
              [cite(7)],
              { ref: "sensors-match", type: "finding", demoted: false },
            ),
            span(" It is control — Skylink runs a wind-feedforward MPC in the final 2 m", [cite(12), cite(31)], {
              ref: "control-mpc",
              type: "finding",
              demoted: false,
            }),
            {
              text: " while ours is PID with fixed gains (dock_ctrl.c:214, unchanged in 14 months).",
              segments: [
                { kind: "text", text: " while ours is PID with fixed gains (", href: null },
                {
                  kind: "code",
                  text: "dock_ctrl.c:214",
                  href: "https://github.com/acme-robotics/helios-firmware/blob/8c1b2e4/src/dock/dock_ctrl.c#L214",
                },
                { kind: "text", text: ", unchanged in 14 months).", href: null },
              ],
              claim: { ref: "pid-fixed-gains", type: "finding", demoted: false },
              cites: [cite(44, "git")],
            },
            span(
              ' Our abort returns to loiter and waits for the operator — what customers describe as "giving up."',
              [cite(19)],
              { ref: "abort-gives-up", type: "finding", demoted: false },
            ),
          ],
        },
        {
          kind: "open_questions",
          spans: [
            span("Whether Skylink's MPC degrades above 12 m/s is not in any source read.", [], {
              ref: "mpc-ceiling",
              type: "open_question",
              demoted: true,
            }),
          ],
        },
      ],
    },
    sources: { cited: 44, panel: seededPanel() },
    matrix: seededMatrix(),
    proposed: seededProposals(),
    provenance: { researcher: "loop-v1", alias: "researcher-long-ctx" },
    exportFilename: "RS-127-brief.md",
    ...over,
  };
}

/**
 * The featured brief — RS-127 with its detail.
 *
 * @param over What this case changes.
 * @returns The brief and the detail.
 */
export function featuredBrief(over: Partial<FeaturedBrief> = {}): FeaturedBrief {
  return {
    brief: seededBrief(),
    detail: investigationDetail({
      id: "5eed0084-0000-4000-8000-000000000127",
      displayId: "RS-127",
      status: "brief_ready",
      sources: 44,
      progress: progress({ status: "brief_ready", iteration: null, sources: 44, spendCents: 612 }),
      brief: { id: "5eed0086-0000-4000-8000-000000000001", version: 1, createdAt: "2026-10-07T12:20:00.000Z" },
      deliverables: [
        { kind: "brief", id: "5eed0086-0000-4000-8000-000000000001" },
        { kind: "matrix", id: "5eed0095-0000-4000-8000-000000000127" },
      ],
      mayCancel: false,
    }),
    ...over,
  };
}

/* ---------- the investigations card (#632) ---------- */

/**
 * One row of the investigations card.
 *
 * @param over What this case changes.
 * @returns RS-127's row by default — a finished gap analysis whose link is its brief.
 */
export function investigationRow(over: Partial<Investigation> = {}): Investigation {
  return {
    id: "5eed0084-0000-4000-8000-000000000127",
    displayId: "RS-127",
    kind: { slug: "gap_analysis", name: "Gap analysis", tint: "gap" },
    question: "Autonomous docking vs. Skylink / AeroMesh / Novum",
    depth: "deep_dive",
    tools: [...FIVE_TOOLS],
    origin: "user",
    status: "brief_ready",
    pill: { state: "brief_ready", label: "✓ brief ready", tone: "ok", live: false },
    sources: 44,
    link: { kind: "brief", label: "brief ↑", briefId: "5eed0086-0000-4000-8000-000000000001", version: 1 },
    startedBy: { id: "user-ken", name: "Ken Suenobu" },
    createdAt: "2026-10-07T12:00:00.000Z",
    updatedAt: "2026-10-07T12:20:00.000Z",
    ...over,
  };
}

/** The run the seeded fix loop runs on. */
export const FIX_RUN_ID = "5eed0009-0000-4000-8000-000000000482";

/** The test run RS-121's evidence came from. */
export const EVIDENCE_RUN_ID = "5eed0009-0000-4000-8000-000000000476";

/** Mockup 22's four rows, as the seed and the service compose them, newest first. */
export function seededInvestigations(): Investigation[] {
  return [
    investigationRow(),
    investigationRow({
      id: "5eed0084-0000-4000-8000-000000000124",
      displayId: "RS-124",
      kind: { slug: "roadmap_improvements", name: "Roadmap & improvements", tint: "road" },
      question: "Q4 product improvements from support tickets + churn interviews",
      tools: ["tickets", "web", "competitor"],
      status: "issues_filed",
      pill: { state: "issues_filed", label: "✓ issues filed", tone: "ok", live: false },
      sources: 312,
      link: { kind: "roadmap", label: "to roadmap →", roadmapDocId: "5eed0097-0000-4000-8000-000000000124" },
      createdAt: "2026-10-05T12:00:00.000Z",
    }),
    investigationRow({
      id: "5eed0084-0000-4000-8000-000000000121",
      displayId: "RS-121",
      kind: { slug: "regression_forensics", name: "Regression forensics", tint: "reg" },
      question: "Motor PID overshoot appeared between v2.0.4 → v2.1.0-rc1",
      depth: "standard",
      tools: ["code", "telemetry", "tickets"],
      origin: "regression_watch",
      status: "queued",
      pill: { state: "queued", label: "queued", tone: "warn", live: false },
      sources: 9,
      link: { kind: "evidence", label: "evidence →", testRunId: "test-run-1", runId: EVIDENCE_RUN_ID },
      startedBy: null,
      createdAt: "2026-10-03T12:00:00.000Z",
    }),
    investigationRow({
      id: "5eed0084-0000-4000-8000-000000000118",
      displayId: "RS-118",
      kind: { slug: "bug_root_cause", name: "Bug root cause", tint: "bug" },
      question: "Root cause: altimeter spikes below −10 °C",
      tools: ["code", "tickets", "telemetry"],
      status: "brief_ready",
      pill: { state: "fix_loop_live", label: "fix loop live", tone: "run", live: true },
      sources: 18,
      link: { kind: "run", label: "open run →", runId: FIX_RUN_ID },
      createdAt: "2026-10-01T12:00:00.000Z",
    }),
  ];
}

/**
 * A page of the list.
 *
 * @param over What this case changes.
 * @returns The seeded four, under `4 active · 23 this quarter`.
 */
export function investigationList(over: Partial<InvestigationList> = {}): InvestigationList {
  const items = over.items ?? seededInvestigations();

  return {
    items,
    total: items.length,
    limit: 25,
    offset: 0,
    counts: { active: 4, thisQuarter: 23 },
    quarter: { key: "2026-Q4", from: "2026-10-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" },
    ...over,
  };
}

/** RS-124 — the investigation the seeded roadmap came from. */
export const RS124_ID = "5eed0091-0000-4000-8000-000000000124";

/** The seeded human suggestion's id, and the estimator's. */
export const HUMAN_SUGGESTION_ID = "5eed0097-0000-4000-8000-000000002001";
export const AI_SUGGESTION_ID = "5eed0097-0000-4000-8000-000000002002";

/** Where the seeded document is read in its repository. */
export const ROADMAP_HREF =
  "https://github.com/acme-robotics/helios-firmware/blob/8c1b2e4/docs/ROADMAP.md";

/**
 * One roadmap item, filed and sized — #742 as seeded unless the case says otherwise.
 *
 * @param number The issue number.
 * @param over What this case changes.
 * @returns The item.
 */
export function roadmapItem(number: number, over: Partial<RoadmapItem> = {}): RoadmapItem {
  return {
    key: `item-${String(number)}`,
    title: "Wind-feedforward MPC in final approach",
    mvp: false,
    effort: "m",
    checked: false,
    draftId: `draft-${String(number)}`,
    ticket: {
      id: `ticket-${String(number)}`,
      key: `#${String(number)}`,
      url: `https://github.com/acme-robotics/helios-firmware/issues/${String(number)}`,
      state: "open",
    },
    estimate: { effort: "m", complexity: "medium", estMinutes: 2160, loopDays: 1.5 },
    status: { state: "queued", label: "queued", tone: "idle", live: false },
    ...over,
  };
}

/**
 * One suggested change.
 *
 * @param over What this case changes.
 * @returns The seeded human suggestion unless the case says otherwise.
 */
export function roadmapSuggestion(over: Partial<RoadmapSuggestion> = {}): RoadmapSuggestion {
  return {
    id: HUMAN_SUGGESTION_ID,
    authorKind: "user",
    authorLabel: "KS",
    authorName: "Ken Suenobu",
    text: "Pull #744 into the M1 MVP set — churn interviews rank gust handling above battery accuracy.",
    hint: { item: "dock-gust", change: "mvp", to: true },
    status: "open",
    appliedVersion: null,
    createdAt: "2026-10-03T12:00:00.000Z",
    ...over,
  };
}

/**
 * RS-124's roadmap as the seeded stack answers it: version 1, committed at `8c1b2e4`, two
 * milestones of three issues each, #742 closed and the rest queued, two open suggestions.
 *
 * @param over What this case changes.
 * @returns The card.
 */
export function seededRoadmap(over: Partial<ResearchRoadmap> = {}): ResearchRoadmap {
  const closed = { state: "closed", label: "✓ closed", tone: "ok", live: false } as const;

  return {
    investigation: { id: RS124_ID, displayId: "RS-124" },
    doc: {
      id: "5eed0097-0000-4000-8000-000000000124",
      title: "Helios — Q4 Improvement Roadmap",
      version: 1,
      generatedBy: "create-roadmap@rs-124",
      generatedAt: "2026-10-01T13:00:00.000Z",
      targetSourceId: "5eed0020-0000-4000-8000-000000000001",
    },
    projection: {
      state: "committed",
      path: "docs/ROADMAP.md",
      prRef: null,
      committedSha: "8c1b2e4",
      observedSha: null,
      label: "docs/ROADMAP.md · committed 8c1b2e4",
      href: ROADMAP_HREF,
      problem: null,
    },
    skills: [
      { slug: "create-roadmap", label: "skill · create-roadmap", version: 1 },
      { slug: "create-issues", label: "skill · create-issues", version: 1 },
    ],
    markdown:
      "# Helios — Q4 Improvement Roadmap\n\n" +
      "## M1 · Docking parity — target Oct 15\n" +
      "- [x] #742 Wind-feedforward MPC in final approach `MVP` `L`\n" +
      "- [ ] #743 Re-planned abort & retry vectors `MVP` `M`\n" +
      "- [ ] #744 Gust estimator from IMU residuals `M`\n\n" +
      "## M2 · Fleet reliability — target Nov 20\n" +
      "- [ ] #745 Battery health model v2 `M`\n" +
      "- [ ] #746 Telemetry gap alerts `S`\n" +
      "- [ ] #747 Operator recovery playbook docs `XS`\n",
    milestones: [
      {
        key: "m1",
        name: "Docking parity",
        targetDate: "2026-10-15",
        dueLabel: "due Oct 15",
        done: 1,
        total: 3,
        items: [
          roadmapItem(742, {
            key: "dock-mpc",
            mvp: true,
            effort: "l",
            checked: true,
            ticket: {
              id: "ticket-742",
              key: "#742",
              url: "https://github.com/acme-robotics/helios-firmware/issues/742",
              state: "closed",
            },
            estimate: { effort: "l", complexity: "high", estMinutes: 4320, loopDays: 3 },
            status: closed,
          }),
          roadmapItem(743, { key: "dock-retry", title: "Re-planned abort & retry vectors", mvp: true }),
          roadmapItem(744, {
            key: "dock-gust",
            title: "Gust estimator from IMU residuals",
            estimate: { effort: "m", complexity: "medium", estMinutes: 1440, loopDays: 1 },
          }),
        ],
      },
      {
        key: "m2",
        name: "Fleet reliability",
        targetDate: "2026-11-20",
        dueLabel: "due Nov 20",
        done: 0,
        total: 3,
        items: [
          roadmapItem(745, {
            key: "fleet-battery",
            title: "Battery health model v2",
            estimate: { effort: "m", complexity: "high", estMinutes: 2880, loopDays: 2 },
          }),
          roadmapItem(746, {
            key: "fleet-gaps",
            title: "Telemetry gap alerts",
            effort: "s",
            estimate: { effort: "s", complexity: "low", estMinutes: 720, loopDays: 0.5 },
          }),
          roadmapItem(747, {
            key: "fleet-playbook",
            title: "Operator recovery playbook docs",
            effort: "xs",
            estimate: { effort: "xs", complexity: "low", estMinutes: 360, loopDays: 0.3 },
          }),
        ],
      },
    ],
    issues: {
      batchId: "5eed0090-0000-4000-8000-000000000124",
      filed: 6,
      total: 6,
      label: "6 issues · 2 milestones",
    },
    suggestions: {
      open: 2,
      items: [
        roadmapSuggestion(),
        roadmapSuggestion({
          id: AI_SUGGESTION_ID,
          authorKind: "ai",
          authorLabel: "AI",
          authorName: "create-roadmap",
          text: "Split #745 — complexity is high for a single loop; model + calibration land better as two issues.",
          hint: null,
          createdAt: "2026-10-04T12:00:00.000Z",
        }),
      ],
    },
    ...over,
  };
}

/**
 * The seeded roadmap after **Apply ⟳** on the human suggestion: version 2, #744 in the MVP set,
 * the suggestion applied to it.
 *
 * @returns The card the service answers the apply with.
 */
export function appliedRoadmap(): ResearchRoadmap {
  const before = seededRoadmap();
  const [m1, m2] = before.milestones as [ResearchRoadmap["milestones"][0], ResearchRoadmap["milestones"][0]];

  return {
    ...before,
    doc: { ...before.doc, version: 2, generatedBy: "create-roadmap@v1" },
    projection: {
      ...before.projection,
      state: "pr_open",
      prRef: "#88",
      label: "docs/ROADMAP.md · pull request #88 open",
      href: "https://github.com/acme-robotics/helios-firmware/pull/88",
    },
    markdown: before.markdown.replace("residuals `M`", "residuals `MVP` `M`"),
    milestones: [
      { ...m1, items: m1.items.map((item) => (item.key === "dock-gust" ? { ...item, mvp: true } : item)) },
      m2,
    ],
    suggestions: {
      open: 1,
      items: before.suggestions.items.map((suggestion) =>
        suggestion.id === HUMAN_SUGGESTION_ID
          ? { ...suggestion, status: "applied" as const, appliedVersion: 2 }
          : suggestion,
      ),
    },
  };
}

/**
 * The seeded roadmap in drift: the tracker's #743 was retitled, and the detector raised its
 * suggestion.
 *
 * @returns The card a drift check leaves.
 */
export function driftedRoadmap(): ResearchRoadmap {
  const before = seededRoadmap();

  return {
    ...before,
    projection: {
      ...before.projection,
      state: "drift_detected",
      observedSha: "a41f2c9",
      label: "docs/ROADMAP.md · drift detected since 8c1b2e4",
    },
    suggestions: {
      open: 3,
      items: [
        ...before.suggestions.items,
        roadmapSuggestion({
          id: "5eed0097-0000-4000-8000-000000002003",
          authorKind: "ai",
          authorLabel: "AI",
          authorName: "drift-detector",
          text: "Reconcile ROADMAP.md with the tracker: #743 is titled differently there.",
          hint: null,
        }),
      ],
    },
  };
}

/**
 * What the pipeline's seat is handed.
 *
 * @param over What this case changes.
 * @returns The seeded roadmap, from a roadmap investigation.
 */
export function featuredPipeline(over: Partial<FeaturedPipeline> = {}): FeaturedPipeline {
  return {
    roadmap: seededRoadmap(),
    kind: { slug: "roadmap_improvements", name: "Roadmap & improvements", tint: "road" },
    ...over,
  };
}
