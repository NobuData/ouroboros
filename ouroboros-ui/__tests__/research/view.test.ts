import { describe, expect, it } from "vitest";

import { RESEARCH_PATH } from "@/app/paths";
import {
  COMPOSER_REGION,
  landingRegion,
  LIBRARY_REGION,
  NO_FILTERS,
  parseLibraryFilters,
  parseOpen,
  parseView,
  regionsAt,
  regionTitleId,
  RESEARCH_EYEBROW,
  RESEARCH_HEADLINE,
  RESEARCH_LIBRARY_PATH,
  RESEARCH_REGIONS,
  RESEARCH_SUBLINE,
  researchAddress,
  VIEWER_START_REASON,
} from "@/app/research/view";

/**
 * The Research frame's decisions (#627): the head's copy is the issue's, the address names one
 * view or the page, and the six regions sit where mockup 22 puts them.
 */

describe("the head's copy", () => {
  it("is the issue's, verbatim", () => {
    expect(RESEARCH_EYEBROW).toBe("Research");
    expect(RESEARCH_HEADLINE).toBe(
      "Ask a hard question. Get an evidenced answer — and the tickets to act on it.",
    );
    expect(RESEARCH_SUBLINE).toBe(
      "The same loop that handles the build runs investigations — root-cause briefs for bug fixes, forensics on regressions, product roadmaps and improvement proposals, and project & competitive gap analysis — with full research tools, every claim cited, every finding one click from a drafted ticket.",
    );
  });

  it("names the four investigation kinds between its em dashes", () => {
    const [, kinds] = RESEARCH_SUBLINE.split(" — ");

    expect(kinds?.split(/, (?:and )?/)).toEqual([
      "root-cause briefs for bug fixes",
      "forensics on regressions",
      "product roadmaps and improvement proposals",
      "project & competitive gap analysis",
    ]);
  });

  it("tells a viewer who may start an investigation", () => {
    expect(VIEWER_START_REASON).toMatch(/owners, admins and members/);
    expect(VIEWER_START_REASON).toMatch(/viewer/);
  });
});

describe("the address", () => {
  it("puts the library under the research route, so the sidebar entry stays lit", () => {
    expect(RESEARCH_LIBRARY_PATH).toBe("/research?view=library");
    expect(RESEARCH_LIBRARY_PATH.startsWith(RESEARCH_PATH)).toBe(true);
  });

  it("reads the library view and nothing else", () => {
    expect(parseView("library")).toBe("library");
    expect(parseView(undefined)).toBe("page");
    expect(parseView("")).toBe("page");
    expect(parseView("Library")).toBe("page");
    expect(parseView("history")).toBe("page");
    expect(parseView(["library", "library"])).toBe("page");
  });

  it("lands the library view on the investigations region and the page on none", () => {
    expect(landingRegion("library")).toBe("investigations");
    expect(landingRegion("page")).toBeNull();
    expect(LIBRARY_REGION).toBe("investigations");
    expect(COMPOSER_REGION).toBe("composer");
  });
});

describe("the regions", () => {
  it("are the mockup's six, in its order", () => {
    expect(RESEARCH_REGIONS.map((region) => region.id)).toEqual([
      "composer",
      "tools",
      "watch",
      "brief",
      "pipeline",
      "investigations",
    ]);
  });

  it("put the composer beside a side column of tools over the watch, and the rest full-width", () => {
    expect(regionsAt("main").map((region) => region.id)).toEqual(["composer"]);
    expect(regionsAt("side").map((region) => region.id)).toEqual(["tools", "watch"]);
    expect(regionsAt("wide").map((region) => region.id)).toEqual(["brief", "pipeline", "investigations"]);
  });

  it("name the issue that fills each seat", () => {
    const issues = Object.fromEntries(
      RESEARCH_REGIONS.map((region) => [region.id, /arrives? with (#\d+)\.$/.exec(region.arrives)?.[1]]),
    );

    expect(issues).toEqual({
      composer: "#628",
      tools: "#629",
      watch: "#629",
      brief: "#630",
      pipeline: "#631",
      investigations: "#632",
    });
  });

  it("give every region its own title and heading id", () => {
    expect(new Set(RESEARCH_REGIONS.map((region) => region.title)).size).toBe(RESEARCH_REGIONS.length);
    expect(regionTitleId("composer")).toBe("research-composer-title");
    expect(new Set(RESEARCH_REGIONS.map((region) => regionTitleId(region.id))).size).toBe(
      RESEARCH_REGIONS.length,
    );
  });
});

describe("the library's facets and the open investigation (#632)", () => {
  const RS127 = "5eed0084-0000-4000-8000-000000000127";

  it("reads the three facets off an address, and reads a value nobody wrote as unset", () => {
    expect(parseLibraryFilters({ kind: "gap_analysis", status: "brief_ready", quarter: "2026-Q3" })).toEqual({
      kind: "gap_analysis",
      status: "brief_ready",
      quarter: "2026-Q3",
    });
    expect(parseLibraryFilters({ kind: "Gap Analysis", status: "done", quarter: "Q3" })).toEqual(NO_FILTERS);
    expect(parseLibraryFilters({ status: ["active", "queued"], quarter: "current" })).toEqual({
      kind: null,
      status: "active",
      quarter: "current",
    });
    expect(parseLibraryFilters({})).toEqual(NO_FILTERS);
  });

  it("reads the open investigation, a uuid and nothing else", () => {
    expect(parseOpen({ open: RS127 })).toBe(RS127);
    expect(parseOpen({ open: "RS-127" })).toBeNull();
    expect(parseOpen({})).toBeNull();
  });

  it("writes an address back that reads to the same view, facets and open investigation", () => {
    expect(researchAddress("page")).toBe("/research");
    expect(researchAddress("library")).toBe("/research?view=library");
    expect(researchAddress("library", { kind: "gap_analysis", status: "active", quarter: null }, RS127)).toBe(
      `/research?view=library&kind=gap_analysis&status=active&open=${RS127}`,
    );
    expect(researchAddress("page", NO_FILTERS, RS127)).toBe(`/research?open=${RS127}`);

    const written = new URL(researchAddress("library", { kind: "bug_root_cause", status: null, quarter: "2026-Q2" }), "http://ouro.test");
    const query = Object.fromEntries(written.searchParams.entries());
    expect(parseView(query.view)).toBe("library");
    expect(parseLibraryFilters(query)).toEqual({ kind: "bug_root_cause", status: null, quarter: "2026-Q2" });
  });

  it("keeps the head's library address as the unfiltered library", () => {
    expect(RESEARCH_LIBRARY_PATH).toBe(researchAddress("library"));
  });
});
