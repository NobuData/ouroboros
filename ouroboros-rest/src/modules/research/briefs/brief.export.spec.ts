import {
  BRIEF_EXPORT_MEDIA_TYPE,
  exportBrief,
  exportFilename,
  readBriefExport,
} from "./brief.export";
import type { BriefsRepository } from "./briefs.repository";
import { BriefsService } from "./briefs.service";
import {
  INVESTIGATION,
  MemoryBriefStore,
  WORKSPACE,
  brief,
  investigation,
  seeded,
  source,
  sourceId,
} from "./rs127.fixture";

/** **Export brief ↗** — the Markdown document (#621). */

async function document(...held: Parameters<typeof seeded>) {
  const store = new MemoryBriefStore(seeded(...held));
  return new BriefsService(store as unknown as BriefsRepository).document(WORKSPACE, INVESTIGATION);
}

describe("the brief export", () => {
  it("is named for its investigation, and is Markdown", () => {
    expect(exportFilename("RS-127")).toBe("RS-127-brief.md");
    expect(BRIEF_EXPORT_MEDIA_TYPE).toBe("text/markdown; charset=utf-8");
  });

  it("carries the brief body with its markers inline and the code reference in backticks", async () => {
    const markdown = exportBrief(await document());

    expect(
      markdown.startsWith("# RS-127 — Autonomous docking vs. Skylink / AeroMesh / Novum\n"),
    ).toBe(true);
    expect(markdown).toContain("> Gap analysis · deep dive · 44 sources · brief v1\n");
    expect(markdown).toContain(
      "## Brief\n\n" +
        "The docking gap is not sensors: our IMU and rangefinder match Skylink's published spec.[07]" +
        " It is control — Skylink runs a wind-feedforward MPC in the final 2 m[12][31]" +
        " while ours is PID with fixed gains (`dock_ctrl.c:214`, unchanged in 14 months).[git]",
    );
    expect(markdown).toContain(
      'describe as "giving up."[19] Estimated closure: one epic, 5 tickets, ~3 weeks of loop time on the HIL rig.\n',
    );
  });

  it("carries the matrix as a table — cells cited, the unknown cell honest — and each derivation", async () => {
    const markdown = exportBrief(await document());

    expect(markdown).toContain(
      "| Capability | Helios (us) | Skylink | AeroMesh | Novum | Gap |\n" +
        "| --- | --- | --- | --- | --- | --- |\n" +
        "| Docking in >8 m/s gusts | ◐ partial [25][26] | ● shipping [01][08][40] | ◐ partial [03][04] | ○ none [05] | HIGH |\n" +
        "| Visual-inertial approach (no beacon) | ○ none [39] | ● shipping [02] | ● shipping [04] | ◐ beta [06][13] | HIGH |\n" +
        "| Abort & retry recovery logic | ◐ partial [28][34] | ● shipping [09] | ◐ partial [11] | ○ none [05] | MED |\n" +
        "| OTA resilience (A/B + rollback) | ◐ in flight [24][36] | ● shipping [10] | ○ none [11] | ○ none [05] | WIP |\n" +
        "| Recovery beacon over BLE | ● shipping [23][37] | ○ none [02] | ? unknown | ○ none [42] | LEAD |\n",
    );
    expect(markdown).toContain(
      "- **Recovery beacon over BLE — LEAD.** We ship it; no rival is known to → lead. AeroMesh is unknown, not none.",
    );
  });

  it("carries the proposal: the epic with its roll-up, and every stub with the gap it closes", async () => {
    const markdown = exportBrief(await document());

    expect(markdown).toContain(
      "## Proposed from gaps\n\n" +
        "- EPIC · Docking parity — effort L\n" +
        "- DOCK-1 wind-feedforward MPC — closes “Docking in >8 m/s gusts” (HIGH) — M\n" +
        "- DOCK-2 re-planned retry — closes “Abort & retry recovery logic” (MED) — M\n",
    );
  });

  it("lists all 44 sources, numbered, with locators and retrieval times", async () => {
    const { sources } = readBriefExport(exportBrief(await document()));

    expect(sources).toHaveLength(44);
    expect(sources[6]).toEqual({
      label: "[07]",
      title: "Skylink S4 docking module — teardown & sensor BOM",
      locator: "https://droneanalysts.example.com/s4-teardown",
      retrievedAt: "2026-10-07T12:07:00.000Z",
    });
    expect(sources[43]).toEqual({
      label: "[git]",
      title: "dock_ctrl.c blame — gains last tuned 14 months ago",
      locator: "git://helios-firmware@8c1b2e4/src/dock/dock_ctrl.c#L214",
      retrievedAt: "2026-10-07T12:44:00.000Z",
    });
  });

  it("ends with the provenance footer, dated by the brief and not by the clock", async () => {
    const markdown = exportBrief(await document());

    expect(
      markdown.endsWith(
        "\n---\n\n_Provenance: investigation RS-127 · researcher loop-v1 · alias researcher-long-ctx · brief v1 · 2026-10-07_\n",
      ),
    ).toBe(true);
    expect(exportBrief(await document())).toBe(markdown);
  });

  it("round-trips citations: every marker resolves to a numbered source with the ledger's locator", async () => {
    const exported = await document();
    const { markers, sources } = readBriefExport(exportBrief(exported));
    const listed = new Map(sources.map((each) => [each.label, each]));

    expect(markers.length).toBeGreaterThan(30);
    expect(markers.slice(0, 5)).toEqual(["[07]", "[12]", "[31]", "[git]", "[19]"]);
    for (const marker of markers) expect(listed.has(marker)).toBe(true);

    // The export's numbering is the ledger's, record for record.
    expect(sources.map((each) => [each.label, each.locator, each.retrievedAt])).toEqual(
      exported.ledger.map((each) => [each.label, each.locator, each.retrievedAt]),
    );
    // And the panel's.
    for (const row of exported.brief.sources.panel) {
      expect(listed.get(row.label)?.locator).toBe(row.locator);
    }
  });

  it("lists open questions apart from the findings, and marks one inside a findings paragraph", async () => {
    const markdown = exportBrief(
      await document({
        brief: brief({
          body: {
            paragraphs: [
              {
                spans: [
                  { text: "Skylink ships it.", claim: "f1" },
                  { text: " Does Novum?", claim: "q2" },
                ],
              },
              {
                spans: [
                  { text: "Does AeroMesh use a beacon?", claim: "q1" },
                  { text: " Is the S4 IMU rated below −10 °C?", claim: "q3" },
                ],
              },
            ],
          },
        }),
        claims: [
          { ref: "f1", type: "finding", text: "Ships.", demoted: false, sources: [sourceId(1)] },
          { ref: "q1", type: "open_question", text: "Beacon?", demoted: true, sources: [] },
          { ref: "q2", type: "open_question", text: "Novum?", demoted: false, sources: [] },
          { ref: "q3", type: "open_question", text: "IMU?", demoted: false, sources: [] },
        ],
      }),
    );

    expect(markdown).toContain("Skylink ships it.[01] Does Novum? _(open question)_\n");
    expect(markdown).toContain(
      "### Open questions\n\n- Does AeroMesh use a beacon?\n- Is the S4 IMU rated below −10 °C?\n",
    );
  });

  it("omits the matrix and the proposal for a brief that has neither", async () => {
    const markdown = exportBrief(
      await document({
        investigation: investigation({ provenance: null }),
        matrix: undefined,
        matrixInput: undefined,
      }),
    );

    expect(markdown).not.toContain("## Capability matrix");
    expect(markdown).not.toContain("## Proposed from gaps");
    expect(markdown).toContain("researcher unknown · alias unknown");
    expect(readBriefExport(markdown).sources).toHaveLength(44);
  });

  it("keeps a table and a source line whole whatever the text holds", async () => {
    const odd = seeded();
    const rows = odd.matrix?.rows ?? [];
    const markdown = exportBrief(
      await document({
        ledger: [
          source(1, { title: "A `quoted`\n title", locator: "https://example.com/a`b" }),
          ...(odd.ledger ?? []).slice(1),
        ],
        matrix: {
          ...(odd.matrix as NonNullable<typeof odd.matrix>),
          rows: [{ ...rows[0], capability: "Docking | landing\nin gusts" }, ...rows.slice(1)],
        },
        matrixInput: { ...odd.matrixInput, tickets: [] },
      }),
    );

    expect(markdown).toContain("| Docking \\| landing in gusts | ◐ partial");
    expect(readBriefExport(markdown).sources[0]).toEqual({
      label: "[01]",
      title: "A 'quoted' title",
      locator: "https://example.com/a%60b",
      retrievedAt: "2026-10-07T12:01:00.000Z",
    });
    expect(markdown).not.toContain("## Proposed from gaps");
  });

  it("reads nothing from text that is not an export", () => {
    expect(readBriefExport("Just prose, see [07].")).toEqual({ markers: ["[07]"], sources: [] });
    expect(readBriefExport("")).toEqual({ markers: [], sources: [] });
  });
});
