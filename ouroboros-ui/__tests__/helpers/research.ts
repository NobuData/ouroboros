import type {
  BriefCite,
  BriefLedgerSource,
  BriefSource,
  CapabilityMatrix,
  GapProposals,
  InvestigationBrief,
  InvestigationDetail,
  InvestigationKind,
  InvestigationProgress,
  MatrixCell,
  ResearchToolCatalogEntry,
  ScopeEstimate,
  StartedInvestigation,
} from "@/app/api/research";
import type { FeaturedBrief } from "@/app/research/brief";
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
