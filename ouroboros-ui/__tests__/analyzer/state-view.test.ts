import { describe, expect, it } from "vitest";

import type { AnalyzerPage } from "@/app/analyzer/analyzer-poll";
import {
  FIRST_RUN_LABEL,
  GROWN_TITLE,
  HEADLINE_UNREAD,
  INSUFFICIENT_TITLE,
  NEVER_RUN_TITLE,
  NEW_RUN_LABEL,
  ctaLabel,
  floorLine,
  historyLine,
  isCold,
  neverRunTitle,
  pageHeadline,
  pageState,
  shownResultsLine,
  sideCards,
  thinAnalysisLine,
} from "@/app/analyzer/state-view";
import { NO_CORPUS_HEADLINE } from "@/app/analyzer/view";

import {
  ANALYZER_NOW,
  CORPUS_FLOOR,
  analyzerPage,
  corpusOf,
  emptyDuration,
  runningRun,
  seededCorpus,
  seededRun,
} from "../helpers/analyzer";
import { noMeasurements } from "../helpers/analyzer-measurements";
import { emptySuggestions } from "../helpers/analyzer-suggestions";
import { emptyTickets } from "../helpers/analyzer-tickets";

/**
 * Which picture the analyzer page draws (#521), on small values: the rule over the service's
 * corpus read, the cold states' sentences, the headline for each state, which side cards a cold
 * state keeps, and what the progress panel says about the cards under it.
 */

const NOW = new Date(ANALYZER_NOW);

/** A page with nothing analysed on it — the reads as the service answers them for such a repository. */
function bare(over: Partial<AnalyzerPage> = {}): AnalyzerPage {
  return analyzerPage({
    run: null,
    duration: emptyDuration(),
    suggestions: emptySuggestions(),
    tickets: emptyTickets(),
    measurements: noMeasurements(),
    corpus: corpusOf([0, 0]),
    ...over,
  });
}

describe("which picture the page draws", () => {
  it("holds every region's place, claiming nothing, before the page is read", () => {
    expect(pageState(null)).toBe("loading");
  });

  it("draws results when the newest ended analysis read enough history", () => {
    expect(pageState(analyzerPage())).toBe("results");
    expect(pageState(analyzerPage({ corpus: corpusOf([40, CORPUS_FLOOR], [40, CORPUS_FLOOR]) }))).toBe("results");
  });

  it("keeps results that came from enough history, even where today's window has thinned", () => {
    expect(pageState(analyzerPage({ corpus: corpusOf([2, 2], [1284, 89]) }))).toBe("results");
  });

  it("is insufficient with too little history and nothing analysed — a build or none at all", () => {
    expect(pageState(bare({ corpus: corpusOf([7, 5]) }))).toBe("insufficient");
    expect(pageState(bare({ corpus: corpusOf([0, 0]) }))).toBe("insufficient");
    expect(pageState(bare({ corpus: corpusOf([900, CORPUS_FLOOR - 1]) }))).toBe("insufficient");
  });

  it("stays insufficient after an analysis of too little — its findings are not results", () => {
    expect(pageState(analyzerPage({ corpus: corpusOf([3, 3], [3, 3]) }))).toBe("insufficient");
  });

  it("is never-run with enough history and no analysis of it — exactly on the floor is enough", () => {
    expect(pageState(bare({ corpus: corpusOf([1284, 89]) }))).toBe("never-run");
    expect(pageState(bare({ corpus: corpusOf([10, CORPUS_FLOOR]) }))).toBe("never-run");
  });

  it("is never-run again once the history outgrows a thin analysis — that analysis is still not results", () => {
    expect(pageState(analyzerPage({ corpus: corpusOf([60, 12], [3, 3]) }))).toBe("never-run");
  });

  it("does not let a run in flight or a failed one decide: only an ended, judged analysis is results", () => {
    const never = corpusOf([1284, 89]);

    expect(pageState(bare({ corpus: never, run: runningRun() }))).toBe("never-run");
    expect(pageState(bare({ corpus: never, run: seededRun({ status: "failed", manifest: null }) }))).toBe("never-run");
    expect(pageState(analyzerPage({ run: seededRun({ status: "failed", manifest: null }) }))).toBe("results");
  });

  it("names the two states that draw a panel in place of the result cards", () => {
    expect((["loading", "insufficient", "never-run", "results"] as const).map(isCold)).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });
});

describe("the insufficient state's sentences", () => {
  it("states the count — builds, and the days they ran on — over the window", () => {
    expect(historyLine({ builds: 7, daysWithBuilds: 5 }, 90)).toBe("7 builds on 5 days in the last 90.");
    expect(historyLine({ builds: 1, daysWithBuilds: 1 }, 90)).toBe("1 build on 1 day in the last 90.");
    expect(historyLine({ builds: 1284, daysWithBuilds: 89 }, 90)).toBe("1,284 builds on 89 days in the last 90.");
  });

  it("says a repository with no build has none, rather than zero of something", () => {
    expect(historyLine({ builds: 0, daysWithBuilds: 0 }, 90)).toBe("No builds in the last 90 days.");
  });

  it("states the floor the service states — never a number of its own", () => {
    expect(floorLine({ minimumDaysWithBuilds: 10 })).toBe(
      "It needs builds on at least 10 days before it can tell a shift from noise.",
    );
    expect(floorLine({ minimumDaysWithBuilds: 14 })).toContain("at least 14 days");
  });

  it("names a thin analysis that came before, so nobody wonders where its chart went", () => {
    expect(thinAnalysisLine(corpusOf([3, 3], [3, 3]))).toBe(
      "The last analysis read 3 builds on 3 days — too little to show a chart or suggestions from.",
    );
    expect(thinAnalysisLine(corpusOf([0, 0], [0, 0]))).toBe(
      "The last analysis found no builds to read, so it has nothing to show.",
    );
  });

  it("says nothing of a last analysis where none ended, or the one that did read enough", () => {
    expect(thinAnalysisLine(corpusOf([3, 3]))).toBeNull();
    expect(thinAnalysisLine(seededCorpus())).toBeNull();
  });
});

describe("the never-run state's sentences", () => {
  it("is titled for a first analysis, or for history that has grown since a thin one", () => {
    expect(neverRunTitle(corpusOf([1284, 89]))).toBe(NEVER_RUN_TITLE);
    expect(neverRunTitle(corpusOf([60, 12], [3, 3]))).toBe(GROWN_TITLE);
  });

  it("offers the first analysis, or a new one — and neither is the head's control's name", () => {
    expect(ctaLabel(corpusOf([1284, 89]))).toBe(FIRST_RUN_LABEL);
    expect(ctaLabel(corpusOf([60, 12], [3, 3]))).toBe(NEW_RUN_LABEL);
    for (const label of [FIRST_RUN_LABEL, NEW_RUN_LABEL]) expect(label).not.toMatch(/Run analysis now/);
  });
});

describe("the headline, by state", () => {
  it("claims nothing about the repository before the page is read", () => {
    expect(pageHeadline(null)).toBe(HEADLINE_UNREAD);
    expect(HEADLINE_UNREAD).not.toMatch(/No analysis|builds/);
  });

  it("is the mockup's boast over results, from the newest run's manifest", () => {
    expect(pageHeadline(analyzerPage())).toBe("Your last 1,284 builds have opinions.");
  });

  it("keeps the thin-corpus hedge for a corpus that is thin and still sufficient", () => {
    const run = seededRun({
      manifest: { ...seededRun().manifest!, counts: { ...seededRun().manifest!.counts, builds: 40 } },
    });

    expect(pageHeadline(analyzerPage({ run, corpus: corpusOf([40, 30], [40, 30]) }))).toBe(
      "40 builds in 90 days — early opinions, held loosely.",
    );
  });

  it("says the analyzer needs more history instead of hedging over a corpus below the floor", () => {
    expect(pageHeadline(bare({ corpus: corpusOf([7, 5]) }))).toBe(`${INSUFFICIENT_TITLE}.`);
    expect(pageHeadline(analyzerPage({ corpus: corpusOf([3, 3], [3, 3]) }))).toBe(`${INSUFFICIENT_TITLE}.`);
  });

  it("says no analysis has run, or that there is enough history now, over a never-run page", () => {
    expect(pageHeadline(bare({ corpus: corpusOf([1284, 89]) }))).toBe(`${NEVER_RUN_TITLE}.`);
    expect(pageHeadline(bare({ corpus: corpusOf([60, 12], [3, 3]) }))).toBe(`${GROWN_TITLE}.`);
  });

  it("says a first analysis is reading the history while it runs — and stops saying so once it has failed", () => {
    const never = corpusOf([1284, 89]);

    expect(pageHeadline(bare({ corpus: never, run: runningRun({ phase: "assembling", manifest: null }) }))).toBe(
      "Reading your build history…",
    );
    expect(pageHeadline(bare({ corpus: never, run: seededRun({ status: "failed", manifest: null }) }))).toBe(
      `${NEVER_RUN_TITLE}.`,
    );
  });

  it("takes the number from the analysed corpus when the newest run carries no manifest", () => {
    expect(pageHeadline(analyzerPage({ run: seededRun({ status: "failed", manifest: null }) }))).toBe(
      "Your last 1,284 builds have opinions.",
    );
    expect(pageHeadline(analyzerPage({ run: seededRun({ status: "failed", manifest: null }) }))).not.toBe(
      NO_CORPUS_HEADLINE,
    );
  });
});

describe("which side cards a cold state keeps", () => {
  it("draws both over results, and while the page is unread", () => {
    expect(sideCards(analyzerPage())).toEqual({ tickets: true, measurements: true });
    expect(sideCards(null)).toEqual({ tickets: true, measurements: true });
  });

  it("withholds both where they hold nothing", () => {
    expect(sideCards(bare({ corpus: corpusOf([7, 5]) }))).toEqual({ tickets: false, measurements: false });
    expect(sideCards(bare({ corpus: corpusOf([1284, 89]) }))).toEqual({ tickets: false, measurements: false });
  });

  it("keeps a drafted batch and an applied suggestion's measurement — work somebody made does not vanish", () => {
    const thin = corpusOf([3, 3], [3, 3]);

    expect(sideCards(analyzerPage({ corpus: thin }))).toEqual({ tickets: true, measurements: true });
    expect(sideCards(analyzerPage({ corpus: thin, tickets: emptyTickets() }))).toEqual({
      tickets: false,
      measurements: true,
    });
    expect(sideCards(analyzerPage({ corpus: thin, measurements: noMeasurements() }))).toEqual({
      tickets: true,
      measurements: false,
    });
  });
});

describe("what the progress panel says about the cards under it", () => {
  const seeded = seededCorpus();

  it("says nothing under a complete run — the cards are simply its results", () => {
    expect(shownResultsLine(seededRun(), seeded, NOW)).toBeNull();
  });

  it("says the cards are the last finished analysis's while another runs, and that they stay", () => {
    expect(shownResultsLine(runningRun(), seeded, NOW)).toBe(
      "The results below are the last finished analysis's, from 2h ago — they stay until this one ends.",
    );
  });

  it("says a failed run changed none of them", () => {
    expect(shownResultsLine(runningRun({ status: "failed" }), seeded, NOW)).toBe(
      "The results below are the last finished analysis's, from 2h ago — this run changed none of them.",
    );
  });

  it("says a budget stop's cards include what its finished analyzers found, and whose the rest is", () => {
    const stopped = seededRun({ status: "budget_exceeded", failureReason: "The compute ceiling was reached." });

    // The stopped run judged its corpus, so it is itself the newest analysis that ended.
    expect(shownResultsLine(stopped, seeded, NOW)).toBe(
      "The results below include what its finished analyzers found; anything from an analyzer that did not finish is an earlier analysis's.",
    );
  });

  it("treats a budget stop that never analysed as it does a failure: the cards are an earlier run's", () => {
    const early = runningRun({ status: "budget_exceeded", failureReason: "No analyzer ran." });

    expect(shownResultsLine(early, seeded, NOW)).toMatch(/last finished analysis's, from 2h ago — this run changed none/);
  });

  it("says nothing where no results are drawn at all", () => {
    expect(shownResultsLine(runningRun(), corpusOf([1284, 89]), NOW)).toBeNull();
    expect(shownResultsLine(runningRun({ status: "failed" }), corpusOf([3, 3], [3, 3]), NOW)).toBeNull();
  });
});
