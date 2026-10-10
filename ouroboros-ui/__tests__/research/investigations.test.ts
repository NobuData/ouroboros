import { describe, expect, it } from "vitest";

import {
  countsTag,
  isLive,
  listQuery,
  moreLabel,
  openRowName,
  quarterChoices,
  quarterWords,
  rowFromProgress,
  rowLinkTarget,
  subLine,
  toListQuery,
} from "@/app/research/investigations";
import { NO_FILTERS } from "@/app/research/view";

import { EVIDENCE_RUN_ID, FIX_RUN_ID, investigationRow, progress, seededInvestigations } from "../helpers/research";

/**
 * The investigations card's rules (#632), each without rendering: the head's counts, a row's
 * sub-line, where each contextual link leads, what a live reading does to a row, and the
 * facets' choices and queries.
 */

const [RS127, RS124, RS121, RS118] = seededInvestigations();

describe("the head", () => {
  it("prints the service's two counts as the mockup's tag", () => {
    expect(countsTag({ active: 4, thisQuarter: 23 })).toBe("4 active · 23 this quarter");
  });

  it("counts the rows shown against the rows that match", () => {
    expect(moreLabel(25, 27)).toBe("Show more — 25 of 27");
  });
});

describe("a row", () => {
  it("sub-lines what is measured: the sources and the depth", () => {
    expect(subLine(RS127!)).toBe("44 sources · deep dive");
    expect(subLine(RS121!)).toBe("9 sources · standard");
    expect(subLine(investigationRow({ sources: 1, depth: "quick" }))).toBe("1 source · quick");
  });

  it("names its open control by its number", () => {
    expect(openRowName(RS118!)).toBe("Open RS-118");
  });

  it("knows which rows are live", () => {
    expect(isLive(RS121!)).toBe(true);
    expect(isLive(investigationRow({ status: "running" }))).toBe(true);
    expect(isLive(RS118!)).toBe(false);
  });
});

describe("the contextual link", () => {
  it("leads a run and the evidence to their consoles, lit under Research", () => {
    expect(rowLinkTarget(RS118!, null)).toEqual({ kind: "href", href: `/runs/${FIX_RUN_ID}?from=research` });
    expect(rowLinkTarget(RS121!, null)).toEqual({
      kind: "href",
      href: `/runs/${EVIDENCE_RUN_ID}/tests?from=research`,
    });
  });

  it("lands a roadmap on the pipeline's seat", () => {
    expect(rowLinkTarget(RS124!, null)).toEqual({ kind: "seat", seat: "pipeline" });
  });

  it("lands brief ↑ on the brief's seat for the featured row, and opens any other", () => {
    expect(rowLinkTarget(RS127!, RS127!.id)).toEqual({ kind: "seat", seat: "brief" });
    expect(rowLinkTarget(RS127!, RS118!.id)).toEqual({ kind: "open" });
    expect(rowLinkTarget(RS127!, null)).toEqual({ kind: "open" });
  });

  it("is nothing for a row with nowhere to go", () => {
    expect(rowLinkTarget(investigationRow({ link: null }), null)).toBeNull();
  });
});

describe("a live reading", () => {
  it("moves the row's sources and pill on, in the service's words", () => {
    const running = rowFromProgress(RS121!, progress({ status: "running", sources: 5 }));
    expect(running.status).toBe("running");
    expect(running.sources).toBe(5);
    expect(running.pill).toEqual({ state: "running", label: "running", tone: "run", live: true });

    const cancelling = rowFromProgress(RS121!, progress({ status: "running", sources: 6, cancelRequested: true }));
    expect(cancelling.pill).toEqual({ state: "cancelling", label: "cancelling", tone: "warn", live: true });

    const queued = rowFromProgress(RS121!, progress({ status: "queued", iteration: null, sources: 0 }));
    expect(queued.pill).toEqual({ state: "queued", label: "queued", tone: "warn", live: false });
  });

  it("leaves everything else — the link, the kind, the question — as the service said", () => {
    const moved = rowFromProgress(RS121!, progress({ status: "running", sources: 5 }));

    expect(moved.link).toBe(RS121!.link);
    expect(moved.question).toBe(RS121!.question);
  });
});

describe("the facets", () => {
  it("offer the current quarter and the ones before it, newest first, across a year end", () => {
    expect(quarterChoices("2026-Q1", 3)).toEqual(["2026-Q1", "2025-Q4", "2025-Q3"]);
    expect(quarterChoices("2026-Q4").length).toBe(8);
    expect(quarterChoices("nonsense")).toEqual([]);
    expect(quarterWords("2026-Q4")).toBe("Q4 2026");
    expect(quarterWords("current")).toBe("current");
  });

  it("read the card's active rows for the page, and the facets as given for the library", () => {
    expect(listQuery("page", { kind: "gap_analysis", status: null, quarter: null })).toEqual({
      kind: null,
      status: "active",
      quarter: null,
    });
    expect(listQuery("library", { kind: "gap_analysis", status: null, quarter: null })).toEqual({
      kind: "gap_analysis",
      status: null,
      quarter: null,
    });
  });

  it("send only the facets that are set, with the page", () => {
    expect(toListQuery(NO_FILTERS, 25)).toEqual({ limit: 25, offset: 0 });
    expect(toListQuery({ kind: "gap_analysis", status: "brief_ready", quarter: "current" }, 25, 50)).toEqual({
      kind: "gap_analysis",
      status: "brief_ready",
      quarter: "current",
      limit: 25,
      offset: 50,
    });
  });
});
