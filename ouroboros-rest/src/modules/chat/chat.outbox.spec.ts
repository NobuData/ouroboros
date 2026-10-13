import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
} from "kysely";

import type { Database } from "../db/schema";
import {
  CHAT_ROUTE_KINDS,
  DM_ROUTE_KIND,
  chatDedupeKey,
  enqueueBuildCard,
  enqueueChatIntent,
  enqueueLoopFinished,
} from "./chat.outbox";

/**
 * Writing the outbox (#536): which routes a message rides, what makes an intent the same intent,
 * and the one statement that evaluates routes and writes rows. The statement's behaviour against
 * a real database is `ouroboros-db/tests/constraints.sql` (V134's section).
 */

/** A Kysely that compiles for PostgreSQL and records what it would run. */
function recorder() {
  const queries: CompiledQuery[] = [];
  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    log: (event) => {
      if (event.level === "query") {
        queries.push(event.query);
      }
    },
  });

  return { db, queries };
}

describe("the dedupe key", () => {
  it("is a SHA-256 of what the message is about", () => {
    expect(chatDedupeKey(["loop_finished", "run-1"])).toMatch(/^[0-9a-f]{64}$/);
    expect(chatDedupeKey(["loop_finished", "run-1"])).toBe(
      chatDedupeKey(["loop_finished", "run-1"]),
    );
  });

  it("tells apart parts that would concatenate to the same string", () => {
    expect(chatDedupeKey(["a", "bc"])).not.toBe(chatDedupeKey(["ab", "c"]));
    expect(chatDedupeKey(["decision_card", "i"])).not.toBe(
      chatDedupeKey(["decision_card", "i", "allow_once"]),
    );
  });
});

describe("which routes a message rides", () => {
  it("is mockup 19's routing card, with the core kinds beside it", () => {
    expect(CHAT_ROUTE_KINDS).toEqual({
      decision: ["custom:blocking-questions", "needs_you_dm"],
      loop_finished: ["custom:loop-finished"],
      build_green: ["custom:stage-transitions"],
      build_failed: ["custom:build-failures", "loop_failures"],
      digest: ["custom:weekly-insights", "weekly_insights"],
    });
    expect(CHAT_ROUTE_KINDS.decision).toContain(DM_ROUTE_KIND);
  });
});

describe("enqueueing an intent", () => {
  it("writes nothing for an intent that rides no route", async () => {
    const { db, queries } = recorder();

    await expect(
      enqueueChatIntent(db, {
        organizationId: "org-acme",
        messageKind: "event_card",
        cardKind: "digest",
        subject: {},
        routeKinds: [],
        dedupe: ["digest", "slot"],
      }),
    ).resolves.toBe(0);
    expect(queries).toEqual([]);
  });

  it("evaluates routes and inserts in one statement, absorbing a duplicate", async () => {
    const { db, queries } = recorder();

    await enqueueLoopFinished(db, "org-acme", "run-1846");

    expect(queries).toHaveLength(1);
    const [{ sql, parameters }] = queries;

    // Only enabled Slack routes of the kinds the event rides, in a workspace with an active
    // connection; a bound channel and — for a DM route — the on-call member's linked identity.
    expect(sql).toMatch(/r\.channel = 'slack'\s+and r\.enabled/);
    expect(sql).toContain("c.status = 'active'");
    expect(sql).toContain("link.state = 'linked'");
    expect(sql).toContain("oncall.active");
    expect(sql).toMatch(
      /insert into ouroboros\.chat_outbox[\s\S]+on conflict do nothing\s+returning id/,
    );
    // Every value is bound, never spliced.
    expect(parameters).toEqual(
      expect.arrayContaining([
        "org-acme",
        "custom:loop-finished",
        "event_card",
        "loop_finished",
        JSON.stringify({ run_id: "run-1846" }),
        chatDedupeKey(["loop_finished", "run-1846"]),
      ]),
    );
    expect(sql).not.toContain("run-1846");
    expect(sql).not.toContain("org-acme");
  });

  it("carries a build's facts on the row, leaving out what the plane did not say", async () => {
    const { db, queries } = recorder();

    await enqueueBuildCard(db, "build_failed", {
      organizationId: "org-acme",
      runId: "run-1847",
      loopSeq: 1847,
      passed: 61,
      total: 63,
    });

    const { parameters } = queries[0];

    expect(parameters).toEqual(
      expect.arrayContaining([
        "custom:build-failures",
        "loop_failures",
        "build_failed",
        JSON.stringify({ run_id: "run-1847", loop_seq: 1847, passed: 61, total: 63 }),
        chatDedupeKey(["build_failed", "run-1847", ""]),
      ]),
    );
  });

  it("makes two builds of one loop two intents", async () => {
    const { db, queries } = recorder();
    const report = {
      organizationId: "org-acme",
      runId: "run-1847",
      loopSeq: 1847,
      passed: 63,
      total: 63,
    };

    await enqueueBuildCard(db, "build_green", { ...report, buildNumber: 2 });
    await enqueueBuildCard(db, "build_green", {
      ...report,
      buildNumber: 3,
      prNumber: 514,
      prId: "pr",
      revision: 2,
    });

    expect(queries[0].parameters).toContain(chatDedupeKey(["build_green", "run-1847", "2"]));
    expect(queries[1].parameters).toContain(chatDedupeKey(["build_green", "run-1847", "3"]));
    expect(queries[1].parameters).toContain(
      JSON.stringify({
        run_id: "run-1847",
        loop_seq: 1847,
        passed: 63,
        total: 63,
        build_number: 3,
        pr_number: 514,
        pr_id: "pr",
        revision: 2,
      }),
    );
  });
});
