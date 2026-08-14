import { describe, expect, it } from "vitest";

import {
  EMPTY_QUEUE,
  LEVEL_WITH_LAST_WEEK,
  NEUTRAL_GREETING,
  NO_LOOPS,
  NO_USAGE_TODAY,
  NO_VALUE,
  QUIET_SUBLINE,
  STATE_LABEL,
  UNSIZED_QUEUE,
  countOf,
  daypartAt,
  firstName,
  greeting,
  loopsLiveStat,
  mergedStat,
  overallState,
  pageSubline,
  queuedStat,
  statRow,
  systemRows,
  tokensStat,
} from "@/app/dashboard/view";

import {
  activity,
  dashboardPayload,
  emptyDashboard,
  engineStatus,
  failed,
  healthReport,
  read,
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
