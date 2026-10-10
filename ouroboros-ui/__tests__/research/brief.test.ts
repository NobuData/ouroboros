import { describe, expect, it } from "vitest";

import {
  briefTitle,
  cellCitesWords,
  cellName,
  culpritOf,
  deliverableChips,
  depthWord,
  effortLetter,
  isCited,
  ledgerTitle,
  moreLabel,
  offersDraftEpic,
  panelSource,
  planningBatchPath,
  retrievedWords,
  sourceRowId,
  sourcesTag,
  sourcesTitle,
  usHeader,
} from "@/app/research/brief";

import {
  briefSource,
  cite,
  featuredBrief,
  investigationDetail,
  ledgerSource,
  seededBrief,
  seededPanel,
  sourceIdOf,
} from "../helpers/research";

/**
 * The brief card's rules (#630), each without rendering: the head's words, where a marker lands,
 * what the strip of deliverables says for each kind, and the proposals' chips.
 */

describe("the head", () => {
  it("titles a gap analysis by its matrix, and any other kind by its question", () => {
    expect(briefTitle(seededBrief())).toBe("Autonomous docking vs. the field");
    expect(briefTitle(seededBrief({ matrix: null }))).toBe(
      "Why do our drones abort autonomous docking in wind that Skylink's handle?",
    );
  });

  it("tags the source count and the depth in the mockup's words", () => {
    expect(sourcesTag(seededBrief())).toBe("44 sources · deep dive");
    expect(depthWord("quick")).toBe("quick");
    expect(sourcesTag(seededBrief({ sources: { cited: 1, panel: [] } }))).toBe("1 source · deep dive");
  });

  it("offers Draft epic only when the brief proposes tickets", () => {
    expect(offersDraftEpic(seededBrief())).toBe(true);
    expect(offersDraftEpic(seededBrief({ proposed: null }))).toBe(false);
    expect(
      offersDraftEpic(
        seededBrief({
          proposed: { epic: { title: "x", label: "x" }, tickets: [], top: [], more: 0, effort: null },
        }),
      ),
    ).toBe(false);
  });
});

describe("markers and sources", () => {
  it("names a source's row by its number, or its key", () => {
    expect(sourceRowId(cite(7))).toBe("research-source-7");
    expect(sourceRowId(cite(44, "git"))).toBe("research-source-git");
    expect(sourceRowId(briefSource(12))).toBe("research-source-12");
  });

  it("finds a cited record in the panel, and knows one the panel lacks", () => {
    const panel = seededPanel();

    expect(panelSource(panel, sourceIdOf(7))?.label).toBe("[07]");
    expect(panelSource(panel, sourceIdOf(25))).toBeUndefined();
    expect(isCited(ledgerSource(19), panel)).toBe(true);
    expect(isCited(ledgerSource(25), panel)).toBe(false);
  });

  it("heads the panel and the sheet with the counts", () => {
    expect(sourcesTitle(44)).toBe("Sources — 44 cited");
    expect(ledgerTitle("RS-127", 44)).toBe("RS-127 — every source, 44 of them");
  });

  it("prints a retrieval time in UTC, to the minute", () => {
    expect(retrievedWords("2026-10-07T12:07:00.000Z", "en-GB")).toBe("7 Oct 2026, 12:07");
  });
});

describe("the matrix's words", () => {
  it("names our column, a cell and its evidence", () => {
    expect(usHeader("Helios")).toBe("Helios (us)");
    expect(cellName("Skylink", "shipping")).toBe("Skylink: shipping");
    expect(cellCitesWords(1)).toBe("1 source");
    expect(cellCitesWords(3)).toBe("3 sources");
  });
});

describe("proposed from gaps", () => {
  it("counts the tickets not named, and prints the effort as a letter", () => {
    expect(moreLabel(3)).toBe("+3 more");
    expect(moreLabel(0)).toBeNull();
    expect(effortLetter("l")).toBe("L");
    expect(effortLetter(null)).toBeNull();
  });
});

describe("the deliverables strip", () => {
  const RUN = "5eed0009-0000-4000-8000-000000000482";

  it("is empty for a brief that led nowhere yet", () => {
    expect(deliverableChips(featuredBrief().detail, seededBrief())).toEqual([]);
  });

  it("leads a fix draft to Planning, a batch to its batch, and a roadmap document to the pipeline's seat", () => {
    const detail = investigationDetail({
      deliverables: [
        { kind: "brief", id: "b" },
        { kind: "fix_draft", id: "d" },
        { kind: "draft_batch", id: "batch-1" },
        { kind: "roadmap_doc", id: "doc-1" },
      ],
    });

    expect(deliverableChips(detail, seededBrief({ matrix: null, proposed: null }))).toEqual([
      { key: "fix_draft", label: "fix draft", target: { kind: "href", href: "/planning" } },
      { key: "draft_batch", label: "drafted tickets", target: { kind: "href", href: "/planning?batch=batch-1" } },
      { key: "roadmap_doc", label: "roadmap document", target: { kind: "seat", seat: "pipeline" } },
    ]);
    expect(planningBatchPath("a/b")).toBe("/planning?batch=a%2Fb");
  });

  it("leads a live run and the evidence run to their consoles, lit under Research", () => {
    const detail = investigationDetail({
      links: {
        run: { kind: "run", label: "open run →", runId: RUN },
        roadmap: null,
        brief: null,
        evidence: { kind: "evidence", label: "evidence →", testRunId: "t", runId: RUN },
      },
    });

    expect(deliverableChips(detail, seededBrief()).map((chip) => [chip.key, chip.target])).toEqual([
      ["run", { kind: "href", href: `/runs/${RUN}?from=research` }],
      ["evidence", { kind: "href", href: `/runs/${RUN}/tests?from=research` }],
    ]);
  });

  it("names a forensics brief's culprit from its bisect record, and only for forensics", () => {
    const bisect = briefSource(3, {
      kind: "code",
      tool: "code",
      locator: "bisect://acme-robotics/helios-firmware/v2.0.4..nightly",
      locatorLabel: "bisected → a41f2c9",
      href: null,
    });
    const forensics = seededBrief({
      investigation: { ...seededBrief().investigation, kind: "regression_forensics" },
      matrix: null,
      proposed: null,
      sources: { cited: 9, panel: [briefSource(1), bisect] },
    });

    expect(culpritOf(forensics.sources.panel)).toBe(bisect);
    expect(deliverableChips(investigationDetail(), forensics)).toEqual([
      { key: "culprit", label: "culprit · bisected → a41f2c9", target: null },
    ]);
    expect(deliverableChips(investigationDetail(), { ...forensics, investigation: seededBrief().investigation })).toEqual([]);
  });
});
