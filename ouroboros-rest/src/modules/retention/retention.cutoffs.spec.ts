import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
} from "kysely";

import { cutoffOf, cutoffSql, type RetentionCutoffs } from "./retention.cutoffs";

/** A sweep's cutoffs: one instant per workspace that stored a tier, the default for the rest. */

const FALLBACK = new Date("2026-09-04T00:00:00.000Z");
const SHORT = new Date("2026-09-27T00:00:00.000Z");

/** A compiler that never connects — the SQL is what is asserted. */
const db = new Kysely<Record<string, never>>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (kysely) => new PostgresIntrospector(kysely),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

/** Compile a predicate comparing a column with the cutoff. */
function compile(cutoffs: RetentionCutoffs): { sql: string; parameters: readonly unknown[] } {
  return sql`select 1 where stored_at < ${cutoffSql(cutoffs, "job.organization_id")}`.compile(db);
}

describe("retention cutoffs", () => {
  const cutoffs: RetentionCutoffs = {
    dataClass: "build_logs",
    fallback: FALLBACK,
    byOrganization: new Map([["org-short", SHORT]]),
  };

  it("gives a workspace its own cutoff, and every other the default", () => {
    expect(cutoffOf(cutoffs, "org-short")).toBe(SHORT);
    expect(cutoffOf(cutoffs, "org-other")).toBe(FALLBACK);
  });

  it("compiles to a case over the workspace column, every instant a parameter", () => {
    const compiled = compile(cutoffs);

    expect(compiled.sql).toBe(
      "select 1 where stored_at < (case job.organization_id when $1 then $2::timestamptz else $3::timestamptz end)",
    );
    expect(compiled.parameters).toEqual(["org-short", SHORT, FALLBACK]);
  });

  it("is the default alone when no workspace stored a tier", () => {
    const compiled = compile({ ...cutoffs, byOrganization: new Map() });

    expect(compiled.sql).toBe("select 1 where stored_at < $1::timestamptz");
    expect(compiled.parameters).toEqual([FALLBACK]);
  });

  it("refuses anything but a plain column reference", () => {
    expect(() => cutoffSql(cutoffs, "organization_id; drop table runs")).toThrow(
      "not a column reference",
    );
    expect(() => cutoffSql(cutoffs, "organization_id")).not.toThrow();
  });
});
