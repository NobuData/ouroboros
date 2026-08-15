import { describe, expect, it } from "vitest";

import type { LoopPulse } from "@/app/api/dashboard";

import {
  CYCLE_TIME_TARGET_SECONDS,
  EMPTY_QUEUE,
  INTERVENTION_BUDGET_7D,
  LEVEL_WITH_LAST_WEEK,
  MERGE_RATE_WINDOW,
  NEUTRAL_GREETING,
  NO_LOOPS,
  NO_USAGE_TODAY,
  NO_VALUE,
  PULSE_WINDOW,
  QUIET_SUBLINE,
  STATE_LABEL,
  UNSIZED_QUEUE,
  COMPLETIONS_SHOWN,
  activeLoops,
  checksLabel,
  checksShortfall,
  countOf,
  cycleTime,
  daypartAt,
  firstName,
  greeting,
  issuePair,
  loopsLiveStat,
  mergedStat,
  moreActiveLoops,
  overallState,
  pageSubline,
  pulseIsUnmeasured,
  pulseMeters,
  queuedStat,
  recentCompletions,
  stageCaption,
  stagePercent,
  statRow,
  systemRows,
  tokensStat,
} from "@/app/dashboard/view";

import {
  READ_AT,
  SEEDED_COMPLETIONS,
  SEEDED_RUNS,
  activeRun,
  closedRun,
  activity,
  dashboardPayload,
  emptyDashboard,
  engineStatus,
  failed,
  healthReport,
  read,
  startedSecondsAgo,
} from "../helpers/dashboard";

/**
 * Every decision the dashboard makes, as functions.
 *
 * This is where the screen's acceptance criteria actually live. "Stop the engine and the
 * pill degrades" is one call here rather than a container to stop; "the counts are the
 * service's own" is one call here rather than a page to read. The components that draw
 * these values are covered separately and decide nothing themselves, which is what makes
 * that split honest rather than a way of testing less.
 *
 * The rule underneath most of the cases is the design system's honesty clause (§ 3.5):
 * **a computed number or an em dash**, and never a zero standing in for a number nobody
 * could read.
 */

const UP = { status: "up" } as const;
const ENGINE = read(engineStatus("0.3.1"));

describe("systemRows", () => {
  it("reports the service and its two dependencies, in that order", () => {
    const rows = systemRows(healthReport(), ENGINE);

    expect(rows.map((row) => row.id)).toEqual(["rest", "database", "engine"]);
    expect(rows.map((row) => row.state)).toEqual(["up", "up", "up"]);
  });

  it("degrades the engine's pill when the probe says the engine is down", () => {
    // The acceptance criterion, as one call: stop the engine, and the probe stops finding
    // it. Nothing else on the card moves.
    const rows = systemRows(
      healthReport({
        database: UP,
        engine: { status: "down", message: "GET /healthz responded 503" },
      }),
      ENGINE,
    );

    expect(rows.find((row) => row.id === "engine")?.state).toBe("down");
    expect(rows.find((row) => row.id === "database")?.state).toBe("up");
    expect(rows.find((row) => row.id === "rest")?.state).toBe("up");
  });

  it("shows the probe's own reason for a dependency that is down", () => {
    // The probe's message classifies the failure without naming a host, a port or a role —
    // it answers unauthenticated, so it is written to be shown.
    const rows = systemRows(
      healthReport({ database: { status: "down", message: "SELECT 1 failed (ECONNREFUSED)" } }),
      ENGINE,
    );

    expect(rows.find((row) => row.id === "database")?.note).toBe(
      "SELECT 1 failed (ECONNREFUSED)",
    );
  });

  it("still says something for a dependency that is down without a message", () => {
    // `message` is optional in the contract, and a blank note under a red pill would be the
    // one place on this card that says nothing.
    const rows = systemRows(healthReport({ database: { status: "down" } }), ENGINE);

    expect(rows.find((row) => row.id === "database")?.note).toBe("Not answering.");
  });

  it("keeps the service up when a dependency is down, because that is what `error` means", () => {
    // `status: "error"` is the service's verdict on its dependencies. Reading it as the
    // service being down would take the row explaining the outage down with it.
    const rows = systemRows(healthReport({ database: { status: "down" }, engine: UP }), ENGINE);

    expect(rows.find((row) => row.id === "rest")?.state).toBe("up");
  });

  it("takes the service down when it says it is shutting down", () => {
    // The one status that is about the process rather than its dependencies: it should
    // neither be sent traffic nor counted live.
    const rows = systemRows(healthReport({ database: UP, engine: UP }, "shutting_down"), ENGINE);

    expect(rows.find((row) => row.id === "rest")?.state).toBe("down");
  });

  it("reports the engine's build from the status call, beside the probe's verdict", () => {
    const rows = systemRows(healthReport(), read(engineStatus("9.9.9")));

    expect(rows.find((row) => row.id === "engine")?.note).toBe("Build 9.9.9.");
  });

  it("keeps the engine up on the probe's word when only the build could not be read", () => {
    // The probe decides the state; the status call supplies the version. They are separate
    // round trips and a service can stop between them, so the card says what it knows
    // rather than choosing the more alarming of two answers.
    const rows = systemRows(healthReport(), failed("The engine is not available right now."));

    expect(rows.find((row) => row.id === "engine")?.state).toBe("up");
    expect(rows.find((row) => row.id === "engine")?.note).toBe(
      "Answering; its build could not be read.",
    );
  });

  it("falls back to the status call when the probe does not mention the engine", () => {
    // Then it is the sole evidence either way, so it decides rather than being discarded.
    const present = systemRows(healthReport({ database: UP }), read(engineStatus("0.4.0")));
    const absent = systemRows(healthReport({ database: UP }), failed("engine_unavailable"));

    expect(present.find((row) => row.id === "engine")?.state).toBe("up");
    expect(present.find((row) => row.id === "engine")?.note).toBe("Build 0.4.0.");
    expect(absent.find((row) => row.id === "engine")?.state).toBe("down");
    expect(absent.find((row) => row.id === "engine")?.note).toBe("engine_unavailable");
  });

  it("draws a dependency it cannot ask about as unknown, never as up", () => {
    const rows = systemRows(healthReport({ engine: UP }), ENGINE);

    expect(rows.find((row) => row.id === "database")?.state).toBe("unknown");
  });

  it("takes the service down, and both dependencies to unknown, when the probe is silent", () => {
    // The probe not answering is evidence about the service and about nothing else: it
    // says nothing at all about a database nobody managed to ask after.
    const rows = systemRows(null, ENGINE);

    expect(rows.find((row) => row.id === "rest")?.state).toBe("down");
    expect(rows.find((row) => row.id === "database")?.state).toBe("unknown");
  });
});

describe("overallState", () => {
  it("is up only when every row is", () => {
    expect(overallState(systemRows(healthReport(), ENGINE))).toBe("up");
  });

  it("is down when anything is down", () => {
    expect(overallState(systemRows(healthReport({ database: { status: "down" } }), ENGINE))).toBe(
      "down",
    );
  });

  it("is unknown rather than up when a row could not be read", () => {
    // A card headed "operational" above a row nobody could read would be the screen making
    // a claim on evidence it does not have.
    expect(overallState(systemRows(healthReport({ engine: UP }), ENGINE))).toBe("unknown");
  });

  it("prefers down to unknown, so the worst row is the one the head reports", () => {
    expect(
      overallState(systemRows(healthReport({ engine: { status: "down" } }), ENGINE)),
    ).toBe("down");
  });

  it("names all three states in words, not only in colour", () => {
    expect(Object.keys(STATE_LABEL).sort()).toEqual(["down", "unknown", "up"]);
    for (const label of Object.values(STATE_LABEL)) expect(label).not.toBe("");
  });
});

describe("loopsLiveStat", () => {
  it("counts the seeded workspace's runs and names what each is doing", () => {
    // The mockup prints "2 coding · 1 in review" over a table holding one run in each of
    // three statuses. Decision F.5 settled that disagreement in favour of the table, so the
    // seeded workspace reads as its rows do.
    const stat = loopsLiveStat(dashboardPayload().stats.loopsLive);

    expect(stat.value).toBe("3");
    expect(stat.delta).toBe("1 coding · 1 building · 1 in review");
    expect(stat.tone).toBe("muted");
  });

  it("is the one figure of the four drawn in the accent", () => {
    // It is the only card of the row that is in the present tense.
    expect(loopsLiveStat(dashboardPayload().stats.loopsLive).accent).toBe(true);
  });

  it("keeps the statuses in lifecycle order however the payload is keyed", () => {
    const stat = loopsLiveStat({ total: 6, byStatus: { review: 1, coding: 3, building: 2 } });

    expect(stat.delta).toBe("3 coding · 2 building · 1 in review");
  });

  it("leaves out a status holding nothing rather than printing its zero", () => {
    const stat = loopsLiveStat({ total: 3, byStatus: { coding: 2, building: 0, review: 1 } });

    expect(stat.delta).toBe("2 coding · 1 in review");
  });

  it("says nothing is running rather than drawing an empty line", () => {
    const stat = loopsLiveStat({ total: 0, byStatus: { coding: 0, building: 0, review: 0 } });

    expect(stat.value).toBe("0");
    expect(stat.delta).toBe(NO_LOOPS);
  });
});

describe("queuedStat", () => {
  it("counts the queue and estimates the work in it", () => {
    const stat = queuedStat(dashboardPayload().stats.queued);

    expect(stat.value).toBe("12");
    expect(stat.delta).toBe("est. 9h 40m of autonomous work");
  });

  it("draws an estimate under an hour without an empty hour on it", () => {
    expect(queuedStat({ count: 1, estMinutes: 45 }).delta).toBe(
      "est. 45m of autonomous work",
    );
  });

  it("says the queue is empty rather than estimating nothing", () => {
    const stat = queuedStat({ count: 0, estMinutes: 0 });

    expect(stat.value).toBe("0");
    expect(stat.delta).toBe(EMPTY_QUEUE);
  });

  it("distinguishes an unsized queue from an empty one", () => {
    // `estMinutes` skips the issues carrying no estimate rather than counting them as zero,
    // so a queue where nothing has been sized sums to zero while holding twelve issues.
    // `est. 0m of autonomous work` would be the card reading that as *no work*.
    const stat = queuedStat({ count: 12, estMinutes: 0 });

    expect(stat.value).toBe("12");
    expect(stat.delta).toBe(UNSIZED_QUEUE);
  });

  it("takes no accent, which the row gives to one card only", () => {
    expect(queuedStat(dashboardPayload().stats.queued).accent).toBe(false);
  });
});

describe("mergedStat", () => {
  it("counts the week and compares it with the one before", () => {
    const stat = mergedStat(dashboardPayload().stats.merged7d);

    expect(stat.value).toBe("27");
    expect(stat.delta).toBe("▲ 8 vs last week");
    expect(stat.tone).toBe("up");
  });

  it("turns the arrow and the tone over for a week that merged less", () => {
    const stat = mergedStat({ count: 19, deltaVsPrior: -8 });

    expect(stat.delta).toBe("▼ 8 vs last week");
    expect(stat.tone).toBe("down");
  });

  it("drops the sign from the sentence, because the arrow already carries it", () => {
    // `▼ -8 vs last week` reads as eight fewer than eight fewer.
    expect(mergedStat({ count: 19, deltaVsPrior: -8 }).delta).not.toContain("-");
  });

  it("draws a level week as neither, rather than as an up week with a zero on it", () => {
    const stat = mergedStat({ count: 27, deltaVsPrior: 0 });

    expect(stat.delta).toBe(LEVEL_WITH_LAST_WEEK);
    expect(stat.tone).toBe("muted");
  });

  it("carries the direction in the glyph as well as in the hue", () => {
    // Colour alone would leave a reader who cannot separate green from red with two
    // identical sentences.
    expect(mergedStat({ count: 30, deltaVsPrior: 3 }).delta).toContain("▲");
    expect(mergedStat({ count: 24, deltaVsPrior: -3 }).delta).toContain("▼");
  });

  it("reads sensibly for a workspace that has merged nothing either week", () => {
    const stat = mergedStat({ count: 0, deltaVsPrior: 0 });

    expect(stat.value).toBe("0");
    expect(stat.delta).toBe(LEVEL_WITH_LAST_WEEK);
  });
});

describe("tokensStat", () => {
  it("draws the mockup's day: a compact count over an approximate cost", () => {
    const stat = tokensStat(dashboardPayload().stats.tokensToday);

    expect(stat.value).toBe("4.2M");
    expect(stat.delta).toBe("≈ $18.60 across 4 providers");
  });

  it("drops the ≈ on a day where every event carries a price", () => {
    // The `≈` is `unpricedEvents`, not decoration: it is what makes the total a floor.
    const stat = tokensStat({
      tokens: 4_200_000,
      costCents: 1860,
      providers: 4,
      unpricedEvents: 0,
    });

    expect(stat.delta).toBe("$18.60 across 4 providers");
  });

  it("agrees with the number of providers it counted", () => {
    const stat = tokensStat({ tokens: 12_000, costCents: 40, providers: 1, unpricedEvents: 0 });

    expect(stat.delta).toBe("$0.40 across 1 provider");
  });

  it("hides the cost line — never $0 — when nothing recorded today has a price", () => {
    // The ticket's own criterion. A day of purely unpriced usage (local inference on a
    // workstation is the honest case) sums to zero while having cost *something unknown*;
    // #92 is what will make that a `cost unavailable` line rather than a missing one.
    const stat = tokensStat({
      tokens: 4_200_000,
      costCents: 0,
      providers: 1,
      unpricedEvents: 12,
    });

    expect(stat.value).toBe("4.2M");
    expect(stat.delta).toBeNull();
  });

  it("says nothing was recorded rather than pricing a day that did not happen", () => {
    const stat = tokensStat(emptyDashboard().stats.tokensToday);

    expect(stat.value).toBe("0");
    expect(stat.delta).toBe(NO_USAGE_TODAY);
  });

  it("keeps a genuine zero cost, which is not the same as an unknown one", () => {
    // Every event was priced, and every price was zero. That is a fact, so it is drawn.
    const stat = tokensStat({ tokens: 900, costCents: 0, providers: 1, unpricedEvents: 0 });

    expect(stat.delta).toBe("$0.00 across 1 provider");
  });
});

describe("the stat row", () => {
  it("is the mockup's four tiles, in its order", () => {
    const row = statRow(read(dashboardPayload()));

    expect(row.map((stat) => stat.id)).toEqual(["loops", "queued", "merged", "tokens"]);
    expect(row.map((stat) => stat.label)).toEqual([
      "Loops live",
      "Queued issues",
      "PRs merged · 7d",
      "Token spend · today",
    ]);
  });

  it("reproduces the mockup on the seeded organization", () => {
    const row = statRow(read(dashboardPayload()));

    expect(row.map((stat) => stat.value)).toEqual(["3", "12", "27", "4.2M"]);
    expect(row.map((stat) => stat.delta)).toEqual([
      "1 coding · 1 building · 1 in review",
      "est. 9h 40m of autonomous work",
      "▲ 8 vs last week",
      "≈ $18.60 across 4 providers",
    ]);
  });

  it("accents exactly one figure", () => {
    expect(statRow(read(dashboardPayload())).filter((stat) => stat.accent)).toHaveLength(1);
  });

  it("reads a workspace with nothing in it as four zeros and four sentences", () => {
    // Not an em dash: these figures were read, and they are zero. The row a workspace
    // could not read is the case below, and the two must not look alike.
    const row = statRow(read(emptyDashboard()));

    expect(row.map((stat) => stat.value)).toEqual(["0", "0", "0", "0"]);
    expect(row.every((stat) => stat.tone !== "failed")).toBe(true);
    expect(row.map((stat) => stat.delta)).toEqual([
      NO_LOOPS,
      EMPTY_QUEUE,
      LEVEL_WITH_LAST_WEEK,
      NO_USAGE_TODAY,
    ]);
  });

  it("degrades as one, because it is one read", () => {
    // Every figure on the row is the aggregate's — decision F5's single round trip — so a
    // refusal takes the whole row rather than one card of it. Four em dashes and the
    // service's reason, never four zeros.
    const row = statRow(failed("Choose a workspace first."));

    expect(row.map((stat) => stat.value)).toEqual([NO_VALUE, NO_VALUE, NO_VALUE, NO_VALUE]);
    expect(row.every((stat) => stat.tone === "failed")).toBe(true);
    expect(row.every((stat) => stat.delta === "Choose a workspace first.")).toBe(true);
  });

  it("keeps its captions when it could read nothing at all", () => {
    // A page reporting a failure, rather than a page that lost its stat row.
    const row = statRow(failed("Choose a workspace first."));

    expect(row.map((stat) => stat.label)).toEqual(
      statRow(read(dashboardPayload())).map((stat) => stat.label),
    );
    expect(row.some((stat) => stat.accent)).toBe(false);
  });
});

describe("stageCaption", () => {
  it("draws the mockup's caption, from the run's own words and numbers", () => {
    expect(stageCaption("Implementing", 4, 6)).toBe("Implementing · 4/6");
    expect(stageCaption("Build farm", 5, 7)).toBe("Build farm · 5/7");
  });

  it("prints the run's label whatever it says, since nothing here has a workflow catalogue", () => {
    // The label is free text (decision F8's sibling): a run whose workflow has since been
    // renamed still renders under the word it recorded.
    expect(stageCaption("Waiting on the build farm", 1, 1)).toBe(
      "Waiting on the build farm · 1/1",
    );
  });
});

describe("stagePercent", () => {
  it("fills the meter to the run's position in its workflow", () => {
    // The acceptance criterion's own three figures, from the seeded runs' 4/6, 5/7 and 6/6.
    expect(stagePercent(4, 6)).toBe(66);
    expect(stagePercent(5, 7)).toBe(71);
    expect(stagePercent(6, 6)).toBe(100);
  });

  it("rounds down, so a bar never claims work that has not finished", () => {
    // 4/6 is 66.67%, and the honest way to round a progress bar is towards the work that
    // certainly has happened. It is also what keeps `100%` reachable only by a run that has
    // actually reached its last step.
    expect(stagePercent(2, 3)).toBe(66);
    expect(stagePercent(5, 6)).toBe(83);
  });

  it("draws a run that has not started a step as empty", () => {
    expect(stagePercent(0, 6)).toBe(0);
  });

  it("clamps a step past the end of its own workflow rather than overflowing the track", () => {
    expect(stagePercent(9, 6)).toBe(100);
    expect(stagePercent(-2, 6)).toBe(0);
  });

  it("draws a workflow with no steps as empty rather than dividing by zero", () => {
    // The contract promises at least one step so that a meter never has to; this is what
    // happens if that promise is ever broken, and it is a bar rather than a crash.
    expect(stagePercent(1, 0)).toBe(0);
    expect(stagePercent(1, Number.NaN)).toBe(0);
  });
});

describe("activeLoops", () => {
  it("draws the mockup's three runs, in the order the payload gave them", () => {
    // Lifecycle order — coding, building, review — is the endpoint's, over the whole table.
    // A client that sorted its ten rows again would disagree with the drill-in that shows
    // all of them.
    const rows = activeLoops(SEEDED_RUNS, READ_AT);

    expect(rows.map((row) => row.issueNumber)).toEqual([482, 479, 476]);
    expect(rows.map((row) => row.status)).toEqual(["coding", "building", "review"]);
  });

  it("composes each row's stage caption and meter from the run's own figures", () => {
    const [first] = activeLoops(SEEDED_RUNS, READ_AT);

    expect(first?.stageCaption).toBe("Implementing · 4/6");
    expect(first?.stagePercent).toBe(66);
  });

  it("measures every row against one instant, so no two of them disagree about now", () => {
    // The reason `readAt` is read once, in `data.ts`, rather than per card or per row.
    const rows = activeLoops(SEEDED_RUNS, READ_AT);

    expect(rows.map((row) => row.elapsedSeconds)).toEqual([760, 2285, 432]);
  });

  it("carries the start as well as the duration, which is what lets the column tick", () => {
    // The client counts from the origin rather than adding to the server's figure — see
    // `app/dashboard/elapsed.tsx`.
    const [first] = activeLoops([activeRun()], READ_AT);

    expect(first?.startedAtSeconds).toBe(Math.floor(READ_AT / 1000) - 760);
  });

  it("passes the opaque strings through untouched", () => {
    // Decision F8, and the workflow tag under the same rule: rendered, never parsed.
    const [row] = activeLoops(
      [activeRun({ model: "ollama/qwen3-coder", workflowTag: "deps-refresh" })],
      READ_AT,
    );

    expect(row?.model).toBe("ollama/qwen3-coder");
    expect(row?.workflowTag).toBe("deps-refresh");
  });

  it("reads a run that started in the future as zero rather than as a negative duration", () => {
    // Two clocks disagreeing is not a fact about the run.
    const [row] = activeLoops([activeRun({ startedAt: startedSecondsAgo(-90) })], READ_AT);

    expect(row?.elapsedSeconds).toBe(0);
  });

  it("keeps a row whose start could not be read, and says so with a null", () => {
    // Every timestamp in the contract is required and well formed, so this is the guard
    // rather than the expected case — and a guard that dropped the row would lose a run that
    // is really happening.
    const [row] = activeLoops([activeRun({ startedAt: "not a timestamp" })], READ_AT);

    expect(row?.startedAtSeconds).toBeNull();
    expect(row?.elapsedSeconds).toBeNull();
    expect(row?.issueNumber).toBe(482);
  });

  it("draws nothing at all for a workspace with nothing running", () => {
    expect(activeLoops([], READ_AT)).toEqual([]);
  });
});

describe("moreActiveLoops", () => {
  it("counts what the table's rows leave out", () => {
    // The aggregate answers at most ten rows and a count that is not capped.
    expect(moreActiveLoops(12, 10)).toBe(2);
  });

  it("counts nothing when the table is showing all of them", () => {
    expect(moreActiveLoops(3, 3)).toBe(0);
  });

  it("never goes below zero, whatever the two figures disagree about", () => {
    // They are separate queries and a run can stop between them; *−1 more* is not something
    // this card will ever say.
    expect(moreActiveLoops(1, 3)).toBe(0);
  });
});

describe("issuePair", () => {
  it("draws the mockup's pair", () => {
    expect(issuePair(474, 512)).toBe(`#474 \u2192 PR\u00a0#512`);
  });

  it("keeps `PR #512` together with a no-break space, and breaks nowhere else", () => {
    // The pair is one value read as one thing; the space before the arrow is the honest place
    // for a line to break, and the one inside the pull request is not.
    const pair = issuePair(474, 512);

    expect(pair.split("\u00a0")).toHaveLength(2);
    expect(pair.indexOf("\u00a0")).toBeGreaterThan(pair.indexOf("\u2192"));
  });

  it("draws the issue alone when the run never opened a pull request", () => {
    // A run may fail, or stop for a person, before there is anything to open one for. An
    // arrow pointing at nothing would be the row claiming half a fact.
    expect(issuePair(465, null)).toBe("#465");
  });
});

describe("cycleTime", () => {
  /**
   * A cycle of a given length, measured between two instants rather than stated.
   *
   * @param seconds How long the run took.
   * @returns What the column draws.
   */
  function cycleOf(seconds: number): string {
    return cycleTime(startedSecondsAgo(seconds), startedSecondsAgo(0));
  }

  it("draws the mockup's four cycles", () => {
    // 660, 1140, 360 and 2520 seconds, as `R__dev_seed_dashboard.sql` seeds them.
    expect([660, 1140, 360, 2520].map(cycleOf)).toEqual(["11m", "19m", "6m", "42m"]);
  });

  it("drops a part that is zero, because a finished cycle is not moving", () => {
    // The difference between this and the *Elapsed* column: a clock that hides the part that
    // is moving looks stopped, and a duration that has stopped has no such part.
    expect(cycleOf(2 * 60 * 60)).toBe("2h");
    expect(cycleOf(90 * 60)).toBe("1h 30m");
  });

  it("has nothing to measure while the run has not finished", () => {
    expect(cycleTime(startedSecondsAgo(600), null)).toBe(NO_VALUE);
  });

  it("has nothing to measure when either instant cannot be read", () => {
    // Every timestamp in the contract is required and well formed, so this is the guard
    // rather than the expected case — and `NaNm` on the page would be worse than an em dash.
    expect(cycleTime("not a timestamp", startedSecondsAgo(0))).toBe(NO_VALUE);
    expect(cycleTime(startedSecondsAgo(600), "not a timestamp")).toBe(NO_VALUE);
  });

  it("draws two clocks disagreeing as no time at all, never as a negative span", () => {
    expect(cycleTime(startedSecondsAgo(0), startedSecondsAgo(600))).toBe("0m");
  });
});

describe("checksLabel", () => {
  it("draws the fraction the mockup draws", () => {
    expect(checksLabel(14, 14)).toBe("14/14");
    expect(checksLabel(13, 14)).toBe("13/14");
  });

  it("draws a repository with no checks as `0/0` rather than as an unknown", () => {
    // `0` of `0` is a fact — no checks are configured — and it is **not** the same as nobody
    // having counted yet, which is the distinction the contract carries as a null.
    expect(checksLabel(0, 0)).toBe("0/0");
  });

  it("draws an em dash when nobody has counted", () => {
    expect(checksLabel(null, null)).toBe(NO_VALUE);
    expect(checksLabel(14, null)).toBe(NO_VALUE);
    expect(checksLabel(null, 14)).toBe(NO_VALUE);
  });
});

describe("checksShortfall", () => {
  it("counts the checks that did not pass", () => {
    expect(checksShortfall(13, 14)).toBe(1);
    expect(checksShortfall(9, 14)).toBe(5);
  });

  it("counts nothing on a run whose checks all passed", () => {
    expect(checksShortfall(14, 14)).toBeNull();
    expect(checksShortfall(0, 0)).toBeNull();
  });

  it("counts nothing when either figure is missing, so an unknown is never tinted", () => {
    expect(checksShortfall(null, 14)).toBeNull();
    expect(checksShortfall(13, null)).toBeNull();
  });

  it("counts nothing when more passed than ran, however that arrived", () => {
    expect(checksShortfall(15, 14)).toBeNull();
  });
});

describe("recentCompletions", () => {
  it("draws the seeded four exactly as the mockup prints them", () => {
    const rows = recentCompletions(SEEDED_COMPLETIONS);

    expect(rows.map((row) => row.pair)).toEqual([
      `#474 \u2192 PR\u00a0#512`,
      `#471 \u2192 PR\u00a0#509`,
      `#468 \u2192 PR\u00a0#507`,
      `#465 \u2192 PR\u00a0#504`,
    ]);
    expect(rows.map((row) => row.cycle)).toEqual(["11m", "19m", "6m", "42m"]);
    expect(rows.map((row) => row.checks)).toEqual(["14/14", "14/14", "12/12", "13/14"]);
  });

  it("marks the one row that is short of its own total, and says how short", () => {
    const rows = recentCompletions(SEEDED_COMPLETIONS);

    expect(rows.map((row) => row.checksShort)).toEqual([false, false, false, true]);
    expect(rows.at(-1)?.checksNote).toBe("1 check did not pass.");
    expect(rows[0]?.checksNote).toBeNull();
  });

  it("counts a larger shortfall in words that agree with the number", () => {
    const [row] = recentCompletions([closedRun({ checksPassed: 11 })]);

    expect(row?.checksNote).toBe("3 checks did not pass.");
  });

  it("marks a run that merged with a check outstanding as short too", () => {
    // The tint is the comparison, not the status: `13/14` is short whatever the run went on
    // to be called, and a merge with an outstanding check should be as visible as a stop.
    const [row] = recentCompletions([closedRun({ status: "merged", checksPassed: 13 })]);

    expect(row?.checksShort).toBe(true);
  });

  it("draws four of the eight the aggregate carries", () => {
    // The endpoint answers eight so a client that expands already holds them; the card draws
    // four, and that is a number written down rather than one a payload happens to imply.
    const runs = Array.from({ length: 8 }, (_, index) =>
      closedRun({ id: `run-${index}`, issueNumber: 400 + index }),
    );

    expect(recentCompletions(runs)).toHaveLength(COMPLETIONS_SHOWN);
    expect(COMPLETIONS_SHOWN).toBe(4);
  });

  it("keeps the payload's order, so the card and its drill-in cannot disagree", () => {
    const runs = [closedRun({ id: "b", issueNumber: 2 }), closedRun({ id: "a", issueNumber: 1 })];

    expect(recentCompletions(runs).map((row) => row.pair.slice(0, 2))).toEqual(["#2", "#1"]);
  });

  it("interprets no model identifier, exactly as the active table does not", () => {
    const [row] = recentCompletions([closedRun({ model: "ollama/qwen3-coder" })]);

    expect(row?.model).toBe("ollama/qwen3-coder");
  });

  it("has nothing to draw for a workspace that has closed nothing", () => {
    expect(recentCompletions([])).toEqual([]);
  });
});

describe("pulseMeters", () => {
  /**
   * The pulse of the seeded workspace, with whatever this case is about changed.
   *
   * @param over The figures this case is about.
   * @returns A complete pulse.
   */
  function pulse(over: Partial<LoopPulse> = {}): LoopPulse {
    return { ...dashboardPayload().pulse, ...over };
  }

  it("draws the mockup's three figures, in its order", () => {
    // The card's acceptance criterion, as three strings: `92%`, `14m 20s` and `2 this week`,
    // from the seeded `0.92`, `860` seconds and `2` runs.
    const meters = pulseMeters(pulse());

    expect(meters.map((meter) => meter.id)).toEqual([
      "merge-rate",
      "cycle-time",
      "interventions",
    ]);
    expect(meters.map((meter) => meter.value)).toEqual(["92%", "14m 20s", "2 this week"]);
  });

  it("draws the mockup's three widths, from denominators that are written down", () => {
    // The other half of the same criterion, and the half that could otherwise be anything:
    // 92% is the rate itself, 48% is 860 seconds of the half-hour target, and 8% is two
    // interventions of a week's twenty-five. Every one of the three is arithmetic over an
    // exported constant rather than a number somebody matched to a screenshot.
    const [rate, cycle, interventions] = pulseMeters(pulse());

    expect(rate?.fill).toBe(0.92);
    expect(cycle?.fill).toBe(Math.round((860 / CYCLE_TIME_TARGET_SECONDS) * 100) / 100);
    expect(cycle?.fill).toBe(0.48);
    expect(interventions?.fill).toBe(2 / INTERVENTION_BUDGET_7D);
    expect(interventions?.fill).toBe(0.08);
  });

  it("gives each meter the hue the mockup gives it, whatever the figure says", () => {
    // A merge rate reports an outcome, a cycle time reports progress through a budget, and
    // an intervention is by definition something that wanted a person. None of the three
    // changes with the number: a bar that turned red at a threshold would be this card
    // inventing one nobody has agreed on.
    expect(pulseMeters(pulse()).map((meter) => meter.tone)).toEqual([
      "ok",
      "accent",
      "warn",
    ]);
    expect(
      pulseMeters(pulse({ mergeRate: 0.1, interventions7d: 40 })).map((meter) => meter.tone),
    ).toEqual(["ok", "accent", "warn"]);
  });

  it("labels the merge rate for the window it is actually measured over", () => {
    // The roadmap asks this card for it by name: the head's tag says `7 days` and the merge
    // rate is fourteen, because the mockup's own figures cannot all be true of one window.
    const [rate, cycle, interventions] = pulseMeters(pulse());

    expect(rate?.window).toBe(MERGE_RATE_WINDOW);
    expect(MERGE_RATE_WINDOW).toBe("14 days");
    expect(cycle?.window).toBe(PULSE_WINDOW);
    expect(interventions?.window).toBe(PULSE_WINDOW);
  });

  it("announces each bar as its own measurement rather than as a bare percentage", () => {
    // The figure beside a bar is hidden from the accessibility tree (`pulse-card.tsx`), so
    // this text is the *only* statement of it a screen reader gets — which is why it carries
    // the window and the denominator that the sighted reader infers from the caption.
    const [rate, cycle, interventions] = pulseMeters(pulse());

    expect(rate?.valueText).toBe("92% of runs merged without a person, over 14 days");
    expect(cycle?.valueText).toBe("14m 20s of the 30m 00s target, over 7 days");
    expect(interventions?.valueText).toBe(
      "2 runs needed a person, of the 25 this workspace allows for in 7 days",
    );
  });

  it("agrees with itself: the width drawn is the figure printed", () => {
    // Both are rounded to a whole percent, so `92%` printed can never sit over a bar drawn
    // at 91.5%. A ratio against a target somebody chose is a gauge, not a measurement.
    const [rate] = pulseMeters(pulse({ mergeRate: 0.9249 }));

    expect(rate?.value).toBe("92%");
    expect(rate?.fill).toBe(0.92);
  });

  it("clamps a cycle longer than the target rather than drawing past the track", () => {
    // The bar is a budget being used up, so an hour against a half-hour target is *full*,
    // and the figure beside it is still the measurement.
    const [, cycle] = pulseMeters(pulse({ avgCycleSeconds: 5400 }));

    expect(cycle?.fill).toBe(1);
    expect(cycle?.value).toBe("1h 30m 00s");
  });

  it("clamps a week that spent its whole intervention budget and more", () => {
    const [, , interventions] = pulseMeters(pulse({ interventions7d: 90 }));

    expect(interventions?.fill).toBe(1);
    expect(interventions?.value).toBe("90 this week");
  });

  it("draws a workspace with nothing to measure as empty rather than as a bad week", () => {
    // Every figure is a floor rather than a measurement when nothing has closed in the
    // window — the contract says so of each — so the bars are empty and the card says why.
    const meters = pulseMeters(emptyDashboard().pulse);

    expect(meters.map((meter) => meter.fill)).toEqual([0, 0, 0]);
    expect(meters.map((meter) => meter.value)).toEqual(["0%", "0m 00s", "0 this week"]);
  });

  it("draws a figure that arrived as no figure at all as zero, rather than as `NaN%`", () => {
    // The contract promises three numbers and the service computes each from a query that
    // cannot answer anything else. This is what a card does if that promise is ever broken,
    // and it is a bar at rest rather than a page of `NaN`.
    const meters = pulseMeters(
      pulse({
        mergeRate: Number.NaN,
        avgCycleSeconds: Number.NaN,
        interventions7d: Number.NaN,
      }),
    );

    expect(meters.map((meter) => meter.fill)).toEqual([0, 0, 0]);
    expect(meters.map((meter) => meter.value)).toEqual(["0%", "0m 00s", "0 this week"]);
  });

  it("counts one intervention in the singular", () => {
    const [, , interventions] = pulseMeters(pulse({ interventions7d: 1 }));

    expect(interventions?.value).toBe("1 this week");
    expect(interventions?.valueText).toContain("1 run needed a person");
  });
});

describe("pulseIsUnmeasured", () => {
  it("is true only when all three figures are floors at once", () => {
    // Which is the one state that means it: a workspace that has closed runs has a cycle
    // time, and one that closed them badly has interventions.
    expect(pulseIsUnmeasured(emptyDashboard().pulse)).toBe(true);
    expect(pulseIsUnmeasured(dashboardPayload().pulse)).toBe(false);
  });

  it("is false for a workspace that merged nothing but did finish something", () => {
    const pulse = { ...emptyDashboard().pulse, avgCycleSeconds: 400 };

    expect(pulseIsUnmeasured(pulse)).toBe(false);
  });

  it("ignores the switch, which is a setting rather than a measurement", () => {
    const pulse = { ...emptyDashboard().pulse, autoMerge: true };

    expect(pulseIsUnmeasured(pulse)).toBe(true);
  });
});

describe("countOf", () => {
  it("agrees with the number it is counting", () => {
    // The acceptance criterion says "correct pluralization", which is one rule rather than
    // one per sentence — so it is a function, and this is it.
    expect(countOf(1, "issue")).toBe("1 issue");
    expect(countOf(3, "issue")).toBe("3 issues");
    expect(countOf(0, "issue")).toBe("0 issues");
  });

  it("counts a two-word noun without splitting it", () => {
    expect(countOf(1, "pull request")).toBe("1 pull request");
    expect(countOf(6, "pull request")).toBe("6 pull requests");
  });

  it("takes an irregular plural rather than inventing one", () => {
    expect(countOf(2, "person", "people")).toBe("2 people");
  });
});

describe("daypartAt", () => {
  it("names the three parts of the day at their boundaries", () => {
    expect(daypartAt(5)).toBe("morning");
    expect(daypartAt(11)).toBe("morning");
    expect(daypartAt(12)).toBe("afternoon");
    expect(daypartAt(17)).toBe("afternoon");
    expect(daypartAt(18)).toBe("evening");
    expect(daypartAt(23)).toBe("evening");
  });

  it("keeps the small hours in the evening rather than inventing a fourth part", () => {
    // The mockup's greeting has three. Somebody working at two in the morning is at the end
    // of a long evening rather than at the start of a night that needs its own word.
    expect(daypartAt(0)).toBe("evening");
    expect(daypartAt(4)).toBe("evening");
  });

  it("covers every hour a clock can report", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      expect(["morning", "afternoon", "evening"]).toContain(daypartAt(hour));
    }
  });
});

describe("firstName", () => {
  it("takes the name a person is called by", () => {
    expect(firstName("Ken Suenobu")).toBe("Ken");
  });

  it("leaves a single-word name whole", () => {
    expect(firstName("Ken")).toBe("Ken");
  });

  it("survives the names a session can actually carry", () => {
    expect(firstName("  Maya   Chen ")).toBe("Maya");
    expect(firstName("")).toBe("");
    expect(firstName("   ")).toBe("");
  });
});

describe("greeting", () => {
  it("is the mockup's sentence, from the daypart, the name and the loop", () => {
    expect(greeting("afternoon", "Ken Suenobu", activity())).toBe(
      "Good afternoon, Ken — the loop is turning.",
    );
  });

  it("says the loop is idle when nothing is in flight", () => {
    // "The loop is turning" is a claim about a workspace, not a decoration on a heading.
    expect(greeting("morning", "Ken Suenobu", activity({ inFlight: 0 }))).toBe(
      "Good morning, Ken — the loop is idle.",
    );
  });

  it("makes no claim at all when the aggregate could not be read", () => {
    expect(greeting("evening", "Ken Suenobu", null)).toBe("Good evening, Ken.");
  });

  it("greets neutrally where no clock has answered yet", () => {
    // The server render and the hydration pass that must match it. A daypart guessed on the
    // server is a wrong word half the time; this one is never wrong.
    expect(greeting(null, "Ken Suenobu", activity())).toBe(
      `${NEUTRAL_GREETING}, Ken — the loop is turning.`,
    );
  });

  it("is a whole sentence for a session carrying no name", () => {
    // A session may. "Good afternoon, ." would be worse than no name at all.
    expect(greeting("afternoon", "", activity())).toBe(
      "Good afternoon — the loop is turning.",
    );
    expect(greeting(null, "", null)).toBe(`${NEUTRAL_GREETING}.`);
  });
});

describe("pageSubline", () => {
  it("is the mockup's line, on the seeded workspace", () => {
    // The acceptance criterion, quoted: "3 issues in flight, 12 queued…".
    expect(pageSubline(read(dashboardPayload())).text).toBe(
      "3 issues in flight, 12 queued behind them. " +
        "Ouroboros merged 6 pull requests since midnight UTC.",
    );
  });

  it("agrees with itself about one of anything", () => {
    const one = pageSubline(
      read(dashboardPayload({ activity: activity({ inFlight: 1, queued: 1, mergedSinceMorning: 1 }) })),
    ).text;

    expect(one).toContain("1 issue in flight, 1 queued behind it.");
    expect(one).toContain("merged 1 pull request since");
  });

  it("says the queue is empty rather than counting to zero", () => {
    expect(
      pageSubline(read(dashboardPayload({ activity: activity({ queued: 0 }) }))).text,
    ).toContain("3 issues in flight, and nothing queued behind them.");
  });

  it("says nothing is in flight without pretending the queue is too", () => {
    expect(
      pageSubline(read(dashboardPayload({ activity: activity({ inFlight: 0 }) }))).text,
    ).toContain("Nothing in flight; 12 issues waiting for a loop.");
  });

  it("reports a day with no merges as a day with no merges", () => {
    expect(
      pageSubline(read(dashboardPayload({ activity: activity({ mergedSinceMorning: 0 }) })))
        .text,
    ).toContain("Nothing has merged since midnight UTC.");
  });

  it("names the boundary the figure is actually counted from", () => {
    // The mockup says "since this morning"; the contract counts from midnight UTC, which is
    // the same boundary the day's token spend uses. For a reader thirteen hours away those
    // are different mornings, and this page's whole argument is that its numbers are real.
    const line = pageSubline(read(dashboardPayload())).text;

    expect(line).toContain("since midnight UTC");
    expect(line).not.toContain("this morning");
  });

  it("reads quietly for a workspace with nothing in it", () => {
    // Three zeros are arithmetically true and useless. A fresh workspace has not failed at
    // anything; it has not started.
    const empty = pageSubline(read(emptyDashboard()));

    expect(empty.text).toBe(QUIET_SUBLINE);
    expect(empty.failed).toBe(false);
    expect(empty.text).not.toMatch(/\b0\b/);
  });

  it("carries the service's reason when the aggregate could not be read", () => {
    // Never an empty workspace: "nothing is running" and "nobody could ask what is running"
    // are different facts, which is the rule the stat row's em dash is written under too.
    const failure = pageSubline(failed("Choose a workspace first."));

    expect(failure).toEqual({ text: "Choose a workspace first.", failed: true });
  });
});
