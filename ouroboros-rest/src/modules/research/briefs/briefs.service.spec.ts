import { RESEARCH_ERRORS } from "../research.errors";
import { exportBrief, readBriefExport } from "./brief.export";
import { BRIEF_ERRORS } from "./briefs.errors";
import type { BriefsRepository } from "./briefs.repository";
import { BriefsService } from "./briefs.service";
import {
  BRIEF,
  INVESTIGATION,
  MATRIX,
  MemoryBriefStore,
  OTHER_WORKSPACE,
  WORKSPACE,
  investigation,
  seeded,
  sourceId,
} from "./rs127.fixture";

/** The brief, made readable — on RS-127 as the seed writes it (#621). */

function bench(...held: Parameters<typeof seeded>) {
  const store = new MemoryBriefStore(seeded(...held));
  return { store, service: new BriefsService(store as unknown as BriefsRepository) };
}

async function code(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "resolved",
    (error: unknown) => (error as { code?: string }).code ?? String(error),
  );
}

describe("the brief read model, on RS-127", () => {
  it("heads the card: the investigation, its kind, depth, status and source count", async () => {
    const read = await bench().service.brief(WORKSPACE, INVESTIGATION);

    expect(read.investigation).toEqual({
      id: INVESTIGATION,
      displayId: "RS-127",
      question: "Autonomous docking vs. Skylink / AeroMesh / Novum",
      kind: "gap_analysis",
      kindLabel: "Gap analysis",
      tintKey: "gap",
      depth: "deep_dive",
      status: "brief_ready",
    });
    expect(read.brief).toMatchObject({
      id: BRIEF,
      version: 1,
      createdAt: "2026-10-07T12:31:00.000Z",
    });
    expect(read.sources.cited).toBe(44);
    expect(read.provenance).toEqual({ researcher: "loop-v1", alias: "researcher-long-ctx" });
    expect(read.exportFilename).toBe("RS-127-brief.md");
  });

  it("lists the panel's five sources exactly as mockup 22 prints them", async () => {
    const { panel } = (await bench().service.brief(WORKSPACE, INVESTIGATION)).sources;

    expect(panel.map((row) => [row.label, row.title, row.locatorLabel])).toEqual([
      [
        "[07]",
        "Skylink S4 docking module — teardown & sensor BOM",
        "droneanalysts.example.com/s4-teardown",
      ],
      [
        "[12]",
        'Skylink firmware 6.2 release notes — "gust-adaptive final approach"',
        "skylink.example.com/releases/6.2",
      ],
      [
        "[19]",
        "Churn interviews Q2 — 9 of 14 cite docking reliability",
        "issue-index://support/churn-2026-q2",
      ],
      [
        "[31]",
        '"MPC for precision landing in turbulent flow" — conf. paper',
        "arxiv.example.org/abs/2605.11423",
      ],
      [
        "[git]",
        "dock_ctrl.c blame — gains last tuned 14 months ago",
        "helios-firmware @ 8c1b2e4 · src/dock/dock_ctrl.c",
      ],
    ]);
    expect(panel[2].href).toBeNull();
    expect(panel[4].href).toBe(
      "https://github.com/acme-robotics/helios-firmware/blob/8c1b2e4/src/dock/dock_ctrl.c#L214",
    );
    // The panel is the short listing: the archive columns are the ledger's.
    expect(panel[0]).not.toHaveProperty("excerpt");
    expect(panel[0]).not.toHaveProperty("retrievedAt");
  });

  it("draws the matrix exactly: five capabilities × four subjects, the gap chips, the honest unknown", async () => {
    const { matrix } = await bench().service.brief(WORKSPACE, INVESTIGATION);

    expect(matrix?.id).toBe(MATRIX);
    expect(matrix?.title).toBe("Autonomous docking vs. the field");
    expect(matrix?.columns.map((column) => [column.label, column.us])).toEqual([
      ["Helios", true],
      ["Skylink", false],
      ["AeroMesh", false],
      ["Novum", false],
    ]);
    expect(
      matrix?.rows.map((row) => [
        row.capability,
        ...row.cells.map((cell) => `${cell.glyph} ${cell.label}`),
        row.gap.label,
      ]),
    ).toEqual([
      ["Docking in >8 m/s gusts", "◐ partial", "● shipping", "◐ partial", "○ none", "HIGH"],
      [
        "Visual-inertial approach (no beacon)",
        "○ none",
        "● shipping",
        "● shipping",
        "◐ beta",
        "HIGH",
      ],
      ["Abort & retry recovery logic", "◐ partial", "● shipping", "◐ partial", "○ none", "MED"],
      ["OTA resilience (A/B + rollback)", "◐ in flight", "● shipping", "○ none", "○ none", "WIP"],
      ["Recovery beacon over BLE", "● shipping", "○ none", "? unknown", "○ none", "LEAD"],
    ]);
  });

  it("gives every cell its citations — and the unknown cell none — and every gap its derivation", async () => {
    const { matrix } = await bench().service.brief(WORKSPACE, INVESTIGATION);
    const cells = matrix?.rows.flatMap((row) => row.cells) ?? [];

    expect(cells).toHaveLength(20);
    expect(cells.filter((cell) => cell.cites.length === 0).map((cell) => cell.status)).toEqual([
      "unknown",
    ]);
    expect(matrix?.rows[0].cells[1].cites.map((cite) => cite.label)).toEqual([
      "[01]",
      "[08]",
      "[40]",
    ]);
    expect(matrix?.rows[0].gap).toEqual({
      severity: "high",
      label: "HIGH",
      derivation:
        "Skylink ships it; we are partial, and 48% of our dockings above 8 m/s fail [25]. Behind the best rival on a core flow → high.",
    });
  });

  it("proposes from the gaps what the chip row shows", async () => {
    const { service } = bench();
    const proposed = await service.proposed(WORKSPACE, INVESTIGATION);

    expect(proposed?.epic.label).toBe("EPIC · Docking parity");
    expect(proposed?.top.map((ticket) => ticket.label)).toEqual([
      "DOCK-1 wind-feedforward MPC",
      "DOCK-2 re-planned retry",
    ]);
    expect(proposed?.more).toBe(3);
    expect(proposed?.effort).toBe("l");
    expect((await service.brief(WORKSPACE, INVESTIGATION)).proposed).toEqual(proposed);
  });

  it("uses one number for a source in the body, the panel, the matrix, the ledger and the export", async () => {
    const { service } = bench();
    const read = await service.brief(WORKSPACE, INVESTIGATION);
    const all = await service.sources(WORKSPACE, INVESTIGATION);
    const exported = readBriefExport((await service.export(WORKSPACE, INVESTIGATION)).markdown);

    const ledger = new Map(all.items.map((item) => [item.sourceId, item.label]));
    const everywhere = [
      ...read.brief.paragraphs.flatMap((paragraph) =>
        paragraph.spans.flatMap((span) => span.cites),
      ),
      ...read.sources.panel,
      ...(read.matrix?.rows ?? []).flatMap((row) => row.cells.flatMap((cell) => cell.cites)),
    ];

    expect(everywhere.length).toBeGreaterThan(30);
    for (const cite of everywhere) expect(cite.label).toBe(ledger.get(cite.sourceId));
    expect(exported.sources.map((each) => each.label)).toEqual(all.items.map((item) => item.label));
  });

  it("does not renumber on a second read", async () => {
    const { service } = bench();

    expect(await service.brief(WORKSPACE, INVESTIGATION)).toEqual(
      await service.brief(WORKSPACE, INVESTIGATION),
    );
    expect((await service.export(WORKSPACE, INVESTIGATION)).markdown).toBe(
      (await service.export(WORKSPACE, INVESTIGATION)).markdown,
    );
  });

  it("exports the document the brief route describes, under its file name", async () => {
    const { service } = bench();
    const exported = await service.export(WORKSPACE, INVESTIGATION);

    expect(exported.filename).toBe("RS-127-brief.md");
    expect(exported.markdown).toBe(exportBrief(await service.document(WORKSPACE, INVESTIGATION)));
  });
});

describe("the full ledger", () => {
  it("returns all 44 records, numbered, with excerpts and retrieval times", async () => {
    const all = await bench().service.sources(WORKSPACE, INVESTIGATION);

    expect(all.investigation).toBe("RS-127");
    expect(all.total).toBe(44);
    expect(all.items).toHaveLength(44);
    expect(all.items.map((item) => item.citeNo)).toEqual(
      Array.from({ length: 44 }, (_, n) => n + 1),
    );
    expect(all.items[6]).toEqual({
      label: "[07]",
      citeNo: 7,
      citeKey: null,
      sourceId: sourceId(7),
      kind: "web",
      tool: "web",
      title: "Skylink S4 docking module — teardown & sensor BOM",
      locator: "https://droneanalysts.example.com/s4-teardown",
      locatorLabel: "droneanalysts.example.com/s4-teardown",
      href: "https://droneanalysts.example.com/s4-teardown",
      excerpt:
        "The S4 carries a 6-axis IMU and a 40 m time-of-flight rangefinder — the same sensor class as Helios.",
      retrievedAt: "2026-10-07T12:07:00.000Z",
      contentHash: `sha256:${"7".padStart(64, "0")}`,
    });
    expect(all.items[43].label).toBe("[git]");
  });

  it("is readable before the brief exists", async () => {
    const { service } = bench({
      investigation: investigation({ status: "running" }),
      brief: undefined,
      claims: undefined,
    });

    expect((await service.sources(WORKSPACE, INVESTIGATION)).total).toBe(44);
    expect(await code(service.brief(WORKSPACE, INVESTIGATION))).toBe(BRIEF_ERRORS.briefNotFound);
  });

  it("is empty for an investigation that has archived nothing", async () => {
    const { service } = bench({ ledger: [] });

    expect(await service.sources(WORKSPACE, INVESTIGATION)).toEqual({
      investigation: "RS-127",
      total: 0,
      items: [],
    });
  });
});

describe("a brief that is not there", () => {
  it("answers 404 for an unknown investigation, and for another workspace's", async () => {
    const { service } = bench();
    const unknown = "5eed0084-0000-4000-8000-000000000999";

    for (const read of [
      service.brief(WORKSPACE, unknown),
      service.sources(WORKSPACE, unknown),
      service.export(WORKSPACE, unknown),
      service.proposed(WORKSPACE, unknown),
      service.brief(OTHER_WORKSPACE, INVESTIGATION),
      service.sources(OTHER_WORKSPACE, INVESTIGATION),
      service.export(OTHER_WORKSPACE, INVESTIGATION),
    ]) {
      expect(await code(read)).toBe(RESEARCH_ERRORS.investigationNotFound);
    }
  });

  it("answers 404 brief_not_found for an investigation that has delivered none", async () => {
    const { service } = bench({ brief: undefined });

    expect(await code(service.export(WORKSPACE, INVESTIGATION))).toBe(BRIEF_ERRORS.briefNotFound);
  });
});

describe("a brief without a matrix", () => {
  it("has no matrix and no proposal, even when an input was stored", async () => {
    const read = await bench({ matrix: undefined }).service.brief(WORKSPACE, INVESTIGATION);

    expect(read.matrix).toBeNull();
    expect(read.proposed).toBeNull();
  });

  it("has a matrix and no proposal when no input was stored, as for a hand-seeded matrix", async () => {
    const read = await bench({ matrixInput: undefined }).service.brief(WORKSPACE, INVESTIGATION);

    expect(read.matrix?.rows).toHaveLength(5);
    expect(read.proposed).toBeNull();
  });

  it("records no researcher for an investigation without provenance", async () => {
    const read = await bench({ investigation: investigation({ provenance: null }) }).service.brief(
      WORKSPACE,
      INVESTIGATION,
    );

    expect(read.provenance).toEqual({ researcher: null, alias: null });
  });

  it("draws a cell the store is missing as unknown rather than blank", async () => {
    const held = seeded();
    const [first, ...rest] = held.matrix?.rows ?? [];
    const read = await bench({
      matrix: {
        ...(held.matrix as NonNullable<typeof held.matrix>),
        rows: [{ ...first, cells: first.cells.slice(0, 3) }, ...rest],
      },
    }).service.brief(WORKSPACE, INVESTIGATION);

    expect(read.matrix?.rows[0].cells[3]).toEqual({
      status: "unknown",
      glyph: "?",
      label: "unknown",
      note: null,
      cites: [],
    });
  });
});
