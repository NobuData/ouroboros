import { afterEach, describe, expect, it, vi } from "vitest";

import { analyzerUrl, isAnalyzerPage, requestAnalyzer, UNREADABLE_ANALYZER } from "@/app/analyzer/analyzer-poll";
import { analyzerRepos, chooseRepo } from "@/app/analyzer/repo";

import { ANALYZER_REPOS, HELIOS, analyzerPage, emptyDuration, seededSchedule } from "../helpers/analyzer";

/** The analyzer page's poll and its repository (#516): one address per repository, a guard on what answered. */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("which repository", () => {
  it("names each enabled repository owner/name", () => {
    expect(analyzerRepos([{ id: "r1", name: "helios-firmware", login: "acme-robotics" }])).toEqual([
      { id: "r1", ref: HELIOS },
    ]);
  });

  it("is the tenant chip's focus when it is enabled", () => {
    expect(chooseRepo(ANALYZER_REPOS, { id: ANALYZER_REPOS[1]!.id, name: "helios-firmware" })).toEqual({
      repo: ANALYZER_REPOS[1],
      focused: true,
    });
  });

  it("is the first enabled one under All repos, or a focus no longer enabled — and says so", () => {
    expect(chooseRepo(ANALYZER_REPOS, null)).toEqual({ repo: ANALYZER_REPOS[0], focused: false });
    expect(chooseRepo(ANALYZER_REPOS, { id: "gone", name: "gone" })).toEqual({ repo: ANALYZER_REPOS[0], focused: false });
  });

  it("is none when the workspace enables none", () => {
    expect(chooseRepo([], null)).toBeNull();
  });
});

describe("analyzerUrl", () => {
  it("encodes the repository into this origin's address", () => {
    expect(analyzerUrl(HELIOS)).toBe("/api/analyzer?repo=acme-robotics%2Fhelios-firmware");
  });
});

describe("isAnalyzerPage", () => {
  it("accepts a page, with a run or before the first", () => {
    expect(isAnalyzerPage(analyzerPage())).toBe(true);
    expect(isAnalyzerPage(analyzerPage({ run: null }))).toBe(true);
  });

  it("refuses what the screen could not draw", () => {
    expect(isAnalyzerPage(null)).toBe(false);
    expect(isAnalyzerPage({})).toBe(false);
    expect(isAnalyzerPage({ repo: HELIOS, run: null })).toBe(false);
    expect(isAnalyzerPage({ repo: 1, run: null, schedule: {} })).toBe(false);
  });

  it("accepts a page whose duration chart is empty — a repository no run has analysed", () => {
    expect(isAnalyzerPage(analyzerPage({ run: null, duration: emptyDuration() }))).toBe(true);
  });

  it("refuses a page with no duration chart, or one missing its series or its change-points (#517)", () => {
    const page = { repo: HELIOS, run: null, schedule: seededSchedule() };

    expect(isAnalyzerPage(page)).toBe(false);
    expect(isAnalyzerPage({ ...page, duration: null })).toBe(false);
    expect(isAnalyzerPage({ ...page, duration: { series: [] } })).toBe(false);
    expect(isAnalyzerPage({ ...page, duration: { series: [], changePoints: "none" } })).toBe(false);
    expect(isAnalyzerPage({ ...page, duration: { series: [], changePoints: [] } })).toBe(true);
  });
});

describe("requestAnalyzer", () => {
  it("asks this origin and reads the page", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(analyzerPage()), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetch);

    const answer = await requestAnalyzer(analyzerUrl(HELIOS))(null);

    expect(fetch.mock.calls[0]![0]).toBe("/api/analyzer?repo=acme-robotics%2Fhelios-firmware");
    expect(answer).toMatchObject({ state: "fresh", payload: analyzerPage() });
  });

  it("calls a body that is not the page unreadable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ hello: "world" }), { status: 200, headers: { "Content-Type": "application/json" } }),
      ),
    );

    expect(await requestAnalyzer(analyzerUrl(HELIOS))(null)).toMatchObject({
      state: "failed",
      reason: UNREADABLE_ANALYZER,
    });
  });
});
