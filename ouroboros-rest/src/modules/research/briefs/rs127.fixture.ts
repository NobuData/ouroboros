/* eslint-disable @typescript-eslint/require-await -- an in-memory stand-in answers at once; async keeps the store's signatures */
/**
 * RS-127 as the development seed writes it, and an in-memory {@link BriefStore} — what the brief
 * suites run on (#621).
 *
 * The fixture mirrors `R__dev_seed_research.sql` and `R__dev_seed_workspace_research.sql`: the
 * 44-record ledger with its five featured citations verbatim, brief v1's four findings cited
 * `[07]` · `[12][31]` · `[git]` · `[19]`, the 5 × 4 matrix with the seeded severities and
 * derivations, and the matrix input the seed stores for it (the proposed gaps, the epic and the
 * five ticket stubs). {@link MemoryBriefStore} keeps a matrix the way V112 does: one per
 * investigation.
 */

import type { MatrixCellStatus, MatrixGapSeverity } from "../../db/schema";
import type { BriefClaim } from "./brief.read-model";
import type { LedgerRow, MatrixRow } from "./brief.resources";
import type {
  BriefInvestigation,
  BriefStore,
  MatrixPlan,
  MatrixWriteOutcome,
  StoredBrief,
} from "./briefs.repository";

export const WORKSPACE = "org-acme";
export const OTHER_WORKSPACE = "org-other";
export const INVESTIGATION = "5eed0084-0000-4000-8000-000000000127";
export const BRIEF = "5eed0086-0000-4000-8000-000000000001";
export const MATRIX = "5eed0095-0000-4000-8000-000000000127";

/** When RS-127 was opened; source `n` was retrieved `n` minutes later, as the seed has it. */
export const OPENED_AT = new Date("2026-10-07T12:00:00.000Z");

/** A `source_records` id for a cite number. */
export function sourceId(citeNo: number): string {
  return `5eed0085-0000-4000-8000-${citeNo.toString().padStart(12, "0")}`;
}

/** A `competitors` id — 1 Skylink, 2 AeroMesh, 3 Novum. */
export function rivalId(column: number): string {
  return `5eed0094-0000-4000-8000-${column.toString().padStart(12, "0")}`;
}

/** The five sources mockup 22's panel lists, verbatim. */
const FEATURED: Readonly<Record<number, Partial<LedgerRow>>> = {
  7: {
    title: "Skylink S4 docking module — teardown & sensor BOM",
    locator: "https://droneanalysts.example.com/s4-teardown",
    excerpt:
      "The S4 carries a 6-axis IMU and a 40 m time-of-flight rangefinder — the same sensor class as Helios.",
  },
  12: {
    tool: "competitor",
    title: 'Skylink firmware 6.2 release notes — "gust-adaptive final approach"',
    locator: "https://skylink.example.com/releases/6.2",
    excerpt:
      "Gust-adaptive final approach: wind feedforward is applied over the last 2 m of descent.",
  },
  19: {
    tool: "tickets",
    kind: "ticket",
    title: "Churn interviews Q2 — 9 of 14 cite docking reliability",
    locator: "issue-index://support/churn-2026-q2",
    excerpt:
      '9 of 14 churned accounts named docking reliability; several said the drone "gives up" after one abort.',
  },
  31: {
    kind: "doc",
    title: '"MPC for precision landing in turbulent flow" — conf. paper',
    locator: "https://arxiv.example.org/abs/2605.11423",
    excerpt: "Wind-feedforward MPC reduced touchdown error in gusts relative to fixed-gain PID.",
  },
  44: {
    tool: "code",
    kind: "code",
    citeKey: "git",
    title: "dock_ctrl.c blame — gains last tuned 14 months ago",
    locator: "git://helios-firmware@8c1b2e4/src/dock/dock_ctrl.c#L214",
    excerpt:
      "dock_ctrl.c:214  static const float kp = 1.8f, ki = 0.05f, kd = 0.4f;  /* fixed gains */",
  },
};

/** One ledger record of RS-127. */
export function source(citeNo: number, overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: sourceId(citeNo),
    citeNo,
    citeKey: null,
    tool: "web",
    kind: "web",
    title: `Source ${citeNo.toString()}`,
    locator: `https://example.com/source/${citeNo.toString()}`,
    retrievedAt: new Date(OPENED_AT.getTime() + citeNo * 60_000),
    contentHash: `sha256:${citeNo.toString(16).padStart(64, "0")}`,
    excerpt: `What source ${citeNo.toString()} said.`,
    ...FEATURED[citeNo],
    ...overrides,
  };
}

/** RS-127's ledger — 44 records, numbered 1…44. */
export function ledger(): LedgerRow[] {
  return Array.from({ length: 44 }, (_, index) => source(index + 1));
}

/** RS-127. */
export function investigation(overrides: Partial<BriefInvestigation> = {}): BriefInvestigation {
  return {
    id: INVESTIGATION,
    organizationId: WORKSPACE,
    displayId: "RS-127",
    question: "Autonomous docking vs. Skylink / AeroMesh / Novum",
    kind: "gap_analysis",
    kindLabel: "Gap analysis",
    tintKey: "gap",
    depth: "deep_dive",
    status: "brief_ready",
    provenance: { researcher: "loop-v1", alias: "researcher-long-ctx", resolution_ref: null },
    ...overrides,
  };
}

/** Brief v1 — mockup 22's paragraph, one span per claim. */
export function brief(overrides: Partial<StoredBrief> = {}): StoredBrief {
  return {
    id: BRIEF,
    version: 1,
    createdAt: new Date(OPENED_AT.getTime() + 31 * 60_000),
    body: {
      paragraphs: [
        {
          spans: [
            {
              text: "The docking gap is not sensors: our IMU and rangefinder match Skylink's published spec.",
              claim: "sensors-match",
            },
            {
              text: " It is control — Skylink runs a wind-feedforward MPC in the final 2 m",
              claim: "control-mpc",
            },
            {
              text: " while ours is PID with fixed gains (dock_ctrl.c:214, unchanged in 14 months).",
              claim: "pid-fixed-gains",
            },
            {
              text: ' Their abort logic retries from a re-planned approach vector; ours returns to loiter and waits for the operator — the behavior customers describe as "giving up."',
              claim: "abort-gives-up",
            },
            {
              text: " Estimated closure: one epic, 5 tickets, ~3 weeks of loop time on the HIL rig.",
            },
          ],
        },
      ],
    },
    ...overrides,
  };
}

/** The four findings and what each cites. */
export function claims(): BriefClaim[] {
  const finding = (ref: string, text: string, cited: number[]): BriefClaim => ({
    ref,
    type: "finding",
    text,
    demoted: false,
    sources: cited.map(sourceId),
  });

  return [
    finding(
      "sensors-match",
      "The docking gap is not sensors: our IMU and rangefinder match Skylink's published spec.",
      [7],
    ),
    // Stored newest-first here, to prove the read model orders cites by the ledger.
    finding("control-mpc", "Skylink runs a wind-feedforward MPC in the final 2 m.", [31, 12]),
    finding(
      "pid-fixed-gains",
      "Our approach controller is PID with fixed gains, unchanged in 14 months.",
      [44],
    ),
    finding(
      "abort-gives-up",
      'Our abort returns to loiter and waits for the operator — what customers describe as "giving up."',
      [19],
    ),
  ];
}

/** The seeded cells: per row, us then Skylink, AeroMesh, Novum — status, note, cited numbers. */
const CELLS: readonly (readonly [MatrixCellStatus, string | null, readonly number[]])[][] = [
  [
    ["partial", null, [25, 26]],
    ["shipping", null, [1, 8, 40]],
    ["partial", null, [3, 4]],
    ["none", null, [5]],
  ],
  [
    ["none", null, [39]],
    ["shipping", null, [2]],
    ["shipping", null, [4]],
    ["partial", "beta", [6, 13]],
  ],
  [
    ["partial", null, [34, 28]],
    ["shipping", null, [9]],
    ["partial", null, [11]],
    ["none", null, [5]],
  ],
  [
    ["wip", "in flight", [36, 24]],
    ["shipping", null, [10]],
    ["none", null, [11]],
    ["none", null, [5]],
  ],
  [
    ["shipping", null, [37, 23]],
    ["none", null, [2]],
    ["unknown", null, []],
    ["none", null, [42]],
  ],
];

/** The seeded rows: capability, stored severity, stored derivation. */
const ROWS: readonly (readonly [string, MatrixGapSeverity, string])[] = [
  [
    "Docking in >8 m/s gusts",
    "high",
    "Skylink ships it; we are partial, and 48% of our dockings above 8 m/s fail [25]. Behind the best rival on a core flow → high.",
  ],
  [
    "Visual-inertial approach (no beacon)",
    "high",
    "Two rivals ship it and one has it in beta; we have none. Behind the field on the docking flow → high.",
  ],
  [
    "Abort & retry recovery logic",
    "med",
    "Skylink ships re-planned retries; we and AeroMesh are partial. Behind one rival; customers notice [18] → med.",
  ],
  [
    "OTA resilience (A/B + rollback)",
    "wip",
    "Skylink ships it; ours is in flight (#456) and no other rival has it → wip.",
  ],
  [
    "Recovery beacon over BLE",
    "lead",
    "We ship it; no rival is known to → lead. AeroMesh is unknown, not none.",
  ],
];

const RIVALS = ["Skylink", "AeroMesh", "Novum"] as const;

/** RS-127's matrix, as the seed stores it. */
export function matrix(): MatrixRow {
  return {
    id: MATRIX,
    title: "Autonomous docking vs. the field",
    usLabel: "Helios",
    rivals: RIVALS.map((name, index) => ({ id: rivalId(index + 1), name })),
    rows: ROWS.map(([capability, severity, derivation], row) => ({
      id: `5eed0095-0000-4000-8000-${(row + 1).toString().padStart(12, "0")}`,
      capability,
      severity,
      derivation,
      cells: CELLS[row].map(([status, note, cited], column) => ({
        competitorId: column === 0 ? null : rivalId(column),
        status,
        note,
        sources: cited.map(sourceId),
      })),
    })),
  };
}

/** The status a playbook writes for a stored cell. */
function inputStatus(status: MatrixCellStatus, note: string | null): string {
  if (status === "wip") return "in_flight";
  return note === "beta" ? "beta" : status;
}

/**
 * The matrix input the seed stores for RS-127 — what the `gap_analysis@1` playbook produced:
 * the cells above, each row's proposed gap, the epic and its five ticket stubs.
 */
export function matrixInput(): Record<string, unknown> {
  const subjects = ["Helios", ...RIVALS];

  return {
    title: "Autonomous docking vs. the field",
    us: "Helios",
    rivals: [...RIVALS],
    rows: ROWS.map(([capability, gap], row) => ({
      capability,
      gap,
      cells: CELLS[row].map(([status, note, cited], column) => ({
        subject: subjects[column],
        status: inputStatus(status, note),
        sources: cited.map(sourceId),
      })),
    })),
    epic: "Docking parity",
    tickets: [
      stub("DOCK-1", "wind-feedforward MPC", "m", ROWS[0][0], [12, 31]),
      stub("DOCK-2", "re-planned retry", "m", ROWS[2][0], [9, 19]),
      stub("DOCK-3", "gust estimator from IMU residuals", "m", ROWS[0][0], [25]),
      stub("DOCK-4", "visual-inertial approach prototype", "l", ROWS[1][0], [2]),
      stub("DOCK-5", "HIL gust-profile regression suite", "s", ROWS[0][0], [26]),
    ],
  };
}

/** One ticket stub of a matrix input. */
export function stub(
  key: string,
  title: string,
  effort: string | null,
  capability: string,
  cited: readonly number[] = [],
): Record<string, unknown> {
  return { key, title, effort, capability, sources: cited.map(sourceId) };
}

/** What a {@link MemoryBriefStore} holds for one investigation. */
export interface Held {
  investigation: BriefInvestigation;
  brief?: StoredBrief;
  claims?: BriefClaim[];
  ledger?: LedgerRow[];
  matrix?: MatrixRow;
  matrixInput?: Record<string, unknown>;
}

/** RS-127, complete. */
export function seeded(overrides: Partial<Held> = {}): Held {
  return {
    investigation: investigation(),
    brief: brief(),
    claims: claims(),
    ledger: ledger(),
    matrix: matrix(),
    matrixInput: matrixInput(),
    ...overrides,
  };
}

/** An in-memory {@link BriefStore}. */
export class MemoryBriefStore implements BriefStore {
  private readonly held = new Map<string, Held>();

  /** `owner/name` slugs, by workspace. */
  readonly slugs = new Map<string, string[]>([[WORKSPACE, ["acme-robotics/helios-firmware"]]]);

  /** The registry: rival names by workspace, in the order they were added. */
  readonly registry = new Map<string, { id: string; name: string }[]>();

  /** @param investigations - What it starts with. */
  constructor(...investigations: Held[]) {
    for (const each of investigations) this.held.set(each.investigation.id, each);
  }

  /** @returns What is held for an investigation. */
  of(investigationId: string): Held | undefined {
    return this.held.get(investigationId);
  }

  /** @inheritdoc */
  async findInvestigation(
    organizationId: string,
    investigationId: string,
  ): Promise<BriefInvestigation | undefined> {
    const found = this.held.get(investigationId)?.investigation;
    return found?.organizationId === organizationId ? found : undefined;
  }

  /** @inheritdoc */
  async latestBrief(investigationId: string): Promise<StoredBrief | undefined> {
    return this.held.get(investigationId)?.brief;
  }

  /** @inheritdoc */
  async claims(briefId: string): Promise<BriefClaim[]> {
    for (const each of this.held.values()) {
      if (each.brief?.id === briefId) return each.claims ?? [];
    }
    return [];
  }

  /** @inheritdoc */
  async ledger(investigationId: string): Promise<LedgerRow[]> {
    return this.held.get(investigationId)?.ledger ?? [];
  }

  /** @inheritdoc */
  async matrix(investigationId: string): Promise<MatrixRow | undefined> {
    return this.held.get(investigationId)?.matrix;
  }

  /** @inheritdoc */
  async matrixInput(investigationId: string): Promise<Record<string, unknown> | undefined> {
    return this.held.get(investigationId)?.matrixInput;
  }

  /** @inheritdoc */
  async repositories(organizationId: string): Promise<string[]> {
    return this.slugs.get(organizationId) ?? [];
  }

  /** @inheritdoc */
  async createMatrix(
    organizationId: string,
    investigationId: string,
    plan: MatrixPlan,
  ): Promise<MatrixWriteOutcome> {
    const each = this.held.get(investigationId);
    if (each?.investigation.organizationId !== organizationId) return { outcome: "not_found" };
    if (each.matrix !== undefined) return { outcome: "exists", matrixId: each.matrix.id };

    const registry = this.registry.get(organizationId) ?? [];
    this.registry.set(organizationId, registry);
    const rivals = plan.rivals.map((name) => {
      const known = registry.find((rival) => rival.name.toLowerCase() === name.toLowerCase());
      if (known !== undefined) return known;

      const added = { id: rivalId(registry.length + 1), name };
      registry.push(added);
      return added;
    });

    each.matrix = {
      id: `matrix-${investigationId}`,
      title: plan.title,
      usLabel: plan.usLabel,
      rivals,
      rows: plan.rows.map((row, index) => ({
        id: `row-${index.toString()}`,
        capability: row.capability,
        severity: row.severity,
        derivation: row.derivation,
        cells: row.cells.map((cell) => ({
          competitorId: cell.rival === null ? null : rivals[cell.rival].id,
          status: cell.status,
          note: cell.note,
          sources: [...cell.sources],
        })),
      })),
    };
    return { outcome: "built", matrixId: each.matrix.id };
  }
}
