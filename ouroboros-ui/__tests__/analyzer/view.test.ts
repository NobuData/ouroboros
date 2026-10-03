import { describe, expect, it } from "vitest";

import {
  NO_CORPUS_HEADLINE,
  RUN_MEMBER_REASON,
  RUN_STARTING_REASON,
  RUN_UNREAD_REASON,
  alreadyRunningLine,
  analyzerEyebrow,
  analyzerHeadline,
  analyzerLines,
  basisLines,
  computeDuration,
  corpusHeadline,
  corpusLine,
  counterLine,
  lastRunLine,
  modelAnalyzers,
  phaseState,
  repoTitle,
  runBlock,
  runStatusLine,
  samplingNotes,
  scheduleForm,
  scheduleLabel,
  scheduleVerdict,
} from "@/app/analyzer/view";

import { ANALYZER_NOW, HELIOS, progressOf, runningRun, seededRun, seededSchedule } from "../helpers/analyzer";

/**
 * The Build Analyzer frame's sentences (#516) — the computed headline, decision A3's provenance
 * and cost rules, the sampling indicator, the confidence basis, the progress states and the
 * schedule editor's rules.
 */

const NOW = new Date(ANALYZER_NOW);

/**
 * The seeded run with another manifest build count.
 *
 * @param builds The count.
 * @returns The run.
 */
function withBuilds(builds: number) {
  const run = seededRun();

  return seededRun({ manifest: { ...run.manifest!, counts: { ...run.manifest!.counts, builds } } });
}

describe("the head", () => {
  it("writes the eyebrow from the real repository, as the mockup does", () => {
    expect(repoTitle(HELIOS)).toBe("Helios-Firmware");
    expect(analyzerEyebrow(HELIOS)).toBe("Build Analyzer · Helios-Firmware");
    expect(analyzerEyebrow(null)).toBe("Build Analyzer");
  });

  it("takes the headline's number from the corpus manifest", () => {
    expect(analyzerHeadline(seededRun())).toBe("Your last 1,284 builds have opinions.");
    expect(analyzerHeadline(withBuilds(90))).toBe("Your last 90 builds have opinions.");
  });

  it("does not boast about a corpus thinner than a build a day", () => {
    expect(analyzerHeadline(withBuilds(40))).toBe("40 builds in 90 days — early opinions, held loosely.");
    expect(analyzerHeadline(withBuilds(1))).toBe("1 build in 90 days — early opinions, held loosely.");
    expect(analyzerHeadline(withBuilds(0))).toBe("No builds in the last 90 days to learn from yet.");
  });

  it("says what it knows before the first run and before the manifest", () => {
    expect(analyzerHeadline(null)).toBe("No analysis has run here yet.");
    expect(analyzerHeadline(runningRun({ phase: "assembling", manifest: null }))).toBe("Reading your build history…");
  });

  it("never says it is reading the history for a run that has ended without a manifest (#521)", () => {
    for (const status of ["failed", "budget_exceeded"] as const) {
      expect(analyzerHeadline(seededRun({ status, manifest: null, failureReason: "It stopped." }))).toBe(
        NO_CORPUS_HEADLINE,
      );
    }
  });

  it("writes the headline from a corpus's own size, for a page whose newest run carries none", () => {
    expect(corpusHeadline(1284, 90)).toBe("Your last 1,284 builds have opinions.");
    expect(corpusHeadline(40, 90)).toBe("40 builds in 90 days — early opinions, held loosely.");
    expect(corpusHeadline(0, 90)).toBe("No builds in the last 90 days to learn from yet.");
  });

  it("says why Run analysis now is inert — the role first, then a press on its way, then an unread page", () => {
    const live = { mayAdminister: true, starting: false, unread: false };

    expect(runBlock(live)).toBeUndefined();
    expect(runBlock({ ...live, mayAdminister: false, starting: true, unread: true })).toBe(RUN_MEMBER_REASON);
    expect(runBlock({ ...live, starting: true, unread: true })).toBe(RUN_STARTING_REASON);
    expect(runBlock({ ...live, unread: true })).toBe(RUN_UNREAD_REASON);
  });
});

describe("the schedule control", () => {
  it("names each trigger that is on — the mockup's weekly + every 50 builds", () => {
    expect(scheduleLabel(seededSchedule())).toBe("Schedule: weekly + every 50 builds");
    expect(scheduleLabel(seededSchedule({ weeklyEnabled: false }))).toBe("Schedule: every 50 builds");
    expect(scheduleLabel(seededSchedule({ everyNBuilds: null }))).toBe("Schedule: weekly");
    expect(scheduleLabel(seededSchedule({ weeklyEnabled: false, everyNBuilds: null }))).toBe("Schedule: manual only");
    expect(scheduleLabel(seededSchedule({ enabled: false }))).toBe("Schedule: paused");
    expect(scheduleLabel(null)).toBe("Schedule");
  });

  it("shows the live counter against its threshold", () => {
    expect(counterLine(seededSchedule())).toBe("12 of 50 builds finished since the every-N trigger last fired.");
    expect(counterLine(seededSchedule({ everyNBuilds: null, buildCounter: 1 }))).toBe(
      "1 build finished since the every-N trigger last fired.",
    );
  });
});

describe("the meta strip", () => {
  it("draws the corpus line as the mockup prints it", () => {
    expect(corpusLine(seededRun().manifest!)).toBe(
      "1,284 builds · 312 loops · 90 days · 4.1M log lines · 62 HIL sessions",
    );
  });

  it("says which sources were sampled, at what rate, under which budget — and nothing when none was", () => {
    expect(samplingNotes(seededRun().manifest!)).toEqual([
      "log lines read at 30%, capped by the max-log-lines budget",
    ]);

    const run = seededRun();
    const full = { sampled: false, rate: 1, cap: null };
    expect(
      samplingNotes({ ...run.manifest!, sources: { builds: full, loops: full, logLines: full, hilSessions: full } }),
    ).toEqual([]);
  });

  it("names no model for a deterministic set, and only the llm analyzers otherwise", () => {
    expect(modelAnalyzers(seededRun().analyzerSet)).toEqual([]);
    expect(
      modelAnalyzers({
        label: "analyzers v2",
        analyzers: [
          { id: "change_point", version: 1, kind: "deterministic" },
          { id: "synthesis", version: 1, kind: "llm" },
        ],
      }),
    ).toEqual(["synthesis"]);
  });

  it("lists every analyzer with its version, kind and outcome", () => {
    expect(analyzerLines(seededRun())[0]).toEqual({
      id: "change_point",
      version: "v1",
      kind: "deterministic",
      outcome: "completed · 3 findings",
    });
    expect(analyzerLines(seededRun())).toHaveLength(7);
  });

  it("is compute time with no $ when no model spent anything", () => {
    expect(lastRunLine(seededRun(), NOW)).toBe("2h ago · 41 min");
    expect(lastRunLine(seededRun(), NOW)).not.toContain("$");
  });

  it("adds the $ only when llmCostCents is non-null", () => {
    expect(lastRunLine(seededRun({ llmCostCents: 286 }), NOW)).toBe("2h ago · 41 min · $2.86");
    expect(lastRunLine(seededRun({ llmCostCents: 0 }), NOW)).toBe("2h ago · 41 min · $0.00");
  });

  it("says a running run is running", () => {
    expect(lastRunLine(runningRun(), NOW)).toBe("running · started 4m ago");
  });

  it("formats compute time in seconds, minutes, then hours", () => {
    expect(computeDuration(45)).toBe("45 s");
    expect(computeDuration(2460)).toBe("41 min");
    expect(computeDuration(3900)).toBe("1 h 05 min");
    expect(computeDuration(-3)).toBe("0 s");
  });

  it("explains the confidence note from its stored basis and rule", () => {
    expect(basisLines(seededRun().manifest!.confidence!)).toEqual([
      "Builds on 89 of 90 days (98.9%) — high needs 90.0%, medium 60.0%.",
      "14.27 builds a day (1,284 builds) — high needs 5, medium 1.",
      "Judged high: high needs both bars, medium both of its own; anything thinner is low.",
    ]);
  });
});

describe("run progress", () => {
  it("places each phase before, at or after the run's", () => {
    const run = runningRun();

    expect(phaseState("assembling", run)).toBe("done");
    expect(phaseState("analyzing", run)).toBe("current");
    expect(phaseState("composing", run)).toBe("waiting");
    expect(phaseState("composing", seededRun())).toBe("done");
    expect(phaseState("analyzing", seededRun({ status: "failed", phase: "analyzing" }))).toBe("current");
  });

  it("counts the analyzers finished while analyzing", () => {
    expect(runStatusLine(runningRun())).toBe("Analyzing — 1 of 3 analyzers finished.");
    expect(runStatusLine(runningRun({ phase: "assembling" }))).toBe("Assembling corpus…");
    expect(runStatusLine(runningRun({ phase: "composing" }))).toBe("Composing suggestions…");
  });

  it("says failed and budget_exceeded differently, each with the run's reason", () => {
    const budget = runStatusLine(
      seededRun({
        status: "budget_exceeded",
        failureReason: "The compute ceiling of 3600 s was reached.",
        progress: { analyzers: [progressOf("change_point", "completed"), progressOf("waiver_cite", "not_run")] },
      }),
    );
    const failed = runStatusLine(
      seededRun({ status: "failed", failureReason: "The engine stream was cut off.", progress: { analyzers: [] } }),
    );

    expect(budget).toBe("Stopped at its budget. The compute ceiling of 3600 s was reached.");
    expect(failed).toBe("The analysis failed, and nothing from it is shown. The engine stream was cut off.");
  });

  it("lets the service's sentence say what a budget stop kept and what did not finish — once", () => {
    const reason =
      "The compute ceiling of 60 s was reached. Kept the findings of 2 analyzer(s); did not finish: cache_window, waiver_cite.";
    const line = runStatusLine(
      seededRun({
        status: "budget_exceeded",
        failureReason: reason,
        progress: { analyzers: [progressOf("change_point", "completed"), progressOf("log_signature", "completed")] },
      }),
    );

    expect(line).toBe(`Stopped at its budget. ${reason}`);
    expect(line.match(/findings of/g)).toHaveLength(1);
  });

  it("still says what was kept when a budget stop carries no reason", () => {
    expect(
      runStatusLine(
        seededRun({
          status: "budget_exceeded",
          failureReason: null,
          progress: { analyzers: [progressOf("change_point", "completed"), progressOf("waiver_cite", "not_run")] },
        }),
      ),
    ).toBe("Stopped at its budget; the findings of 1 analyzer were kept.");
  });

  it("names the running analysis in the concurrent-run state, and that nothing was queued", () => {
    expect(alreadyRunningLine(HELIOS, "2026-10-02T19:56:00.000Z", "analyzing", NOW)).toBe(
      "An analysis of acme-robotics/helios-firmware is already running — started 4m ago, analyzing. No second run was started.",
    );
    expect(alreadyRunningLine(HELIOS, null, null, NOW)).toBe(
      "An analysis of acme-robotics/helios-firmware is already running. No second run was started.",
    );
  });
});

describe("the schedule editor", () => {
  it("round-trips the seeded schedule unchanged", () => {
    expect(scheduleVerdict(HELIOS, scheduleForm(seededSchedule()))).toEqual({
      ok: true,
      input: {
        repo: HELIOS,
        enabled: true,
        weeklyEnabled: true,
        weeklyDay: 1,
        weeklyTime: "06:00",
        everyNBuilds: 50,
        maxBuilds: 2000,
        maxLogLines: 1_230_000,
        computeCeilingSeconds: 3600,
      },
    });
  });

  it("keeps the weekly slot while the trigger is off, and sends null for an every-N that is off", () => {
    const form = { ...scheduleForm(seededSchedule()), weeklyEnabled: false, everyEnabled: false };
    const verdict = scheduleVerdict(HELIOS, form);

    expect(verdict.ok && verdict.input).toMatchObject({ weeklyEnabled: false, weeklyDay: 1, everyNBuilds: null });
  });

  it("starts a never-saved schedule's every-N at 50, switched off", () => {
    const form = scheduleForm(seededSchedule({ saved: false, everyNBuilds: null, weeklyDay: null, weeklyTime: null }));

    expect(form).toMatchObject({ everyEnabled: false, everyNBuilds: "50", weeklyDay: "", weeklyTime: "" });
  });

  it("refuses what V080 refuses, field by field", () => {
    const verdict = scheduleVerdict(HELIOS, {
      ...scheduleForm(seededSchedule()),
      weeklyDay: "",
      weeklyTime: "6pm",
      everyNBuilds: "0",
      maxBuilds: "1.5",
      maxLogLines: "-1",
      computeCeilingSeconds: "",
    });

    expect(verdict).toEqual({
      ok: false,
      errors: {
        weeklyDay: "Choose a day for the weekly run.",
        weeklyTime: "Use a 24-hour UTC time, like 06:00.",
        everyNBuilds: "Use a whole number of builds, at least 1.",
        maxBuilds: "Use a whole number of builds, at least 1.",
        maxLogLines: "Use a whole number of log lines, at least 1.",
        computeCeilingSeconds: "Use a whole number of seconds, at least 1.",
      },
    });
  });

  it("ignores a bad threshold while the every-N trigger is off", () => {
    expect(
      scheduleVerdict(HELIOS, { ...scheduleForm(seededSchedule()), everyEnabled: false, everyNBuilds: "x" }).ok,
    ).toBe(true);
  });
});
