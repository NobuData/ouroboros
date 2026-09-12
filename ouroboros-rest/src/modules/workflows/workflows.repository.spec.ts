import type { Transaction } from "kysely";

import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import type { Database } from "../db/schema";
import { WorkflowsRepository } from "./workflows.repository";

/**
 * The statements, and the properties the endpoints rest on.
 *
 * Real Kysely over a recording driver, per `dashboard.repository.spec.ts`'s argument: this
 * layer holds statements, not rules, so what is asserted is the SQL PostgreSQL would receive.
 * Three things above all:
 *
 *   * **Every entity statement is scoped to one workspace** — the isolation criterion, and for
 *     `find` the whole of the no-existence-leak `404`.
 *   * **Every version statement is keyed by a workflow**, which V029 makes the tenancy: a
 *     version has no meaning apart from one, so the scope is the resolution the service already
 *     performed.
 *   * **The draft predicate is `version is null`**, which is
 *     `workflow_versions_one_draft_idx` exactly — and the read a write is based on takes a row
 *     lock.
 */

const WORKSPACE = "acme-robotics-id";
const WORKFLOW = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";
const DRAFT = "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9";

/** The default window, spelled out — what `windowOf({})` resolves to. */
const WINDOW = { limit: 25, offset: 0 };

/** A stand-in for a transaction: the recorder's own Kysely, which is what `queryOn` returns. */
function asTransaction(database: RecordingDatabase): Transaction<Database> {
  return database.service.db as unknown as Transaction<Database>;
}

describe("the workflows repository", () => {
  let database: RecordingDatabase;
  let workflows: WorkflowsRepository;

  beforeEach(() => {
    database = recordingDatabase();
    workflows = new WorkflowsRepository(database.service);
  });

  describe("scoping", () => {
    /**
     * Every statement that can be reached with a workspace, as a callable — the assertion is
     * over the surface rather than a sample, so a method added without the predicate fails on
     * the day it is written.
     */
    const scoped: readonly [string, (repository: WorkflowsRepository) => Promise<unknown>][] = [
      ["find", (repository) => repository.find(WORKSPACE, WORKFLOW)],
      ["lock", (repository) => repository.lock(WORKSPACE, WORKFLOW, asTransaction(database))],
      ["rename", (repository) => repository.rename(WORKSPACE, WORKFLOW, { name: "New" })],
    ];

    it.each(scoped)("%s is scoped to the workspace", async (_name, statement) => {
      await statement(workflows);

      expect(database.statements[0].sql).toContain('"organization_id" = $');
      expect(database.statements[0].parameters).toContain(WORKSPACE);
    });

    /**
     * Every statement over `workflow_versions`. V029 gives that table no `organization_id`, so
     * the assertion is that each one is keyed by the workflow the service resolved.
     */
    const keyed: readonly [string, (repository: WorkflowsRepository) => Promise<unknown>][] = [
      ["draftOf", (repository) => repository.draftOf(WORKFLOW)],
      ["versions", (repository) => repository.versions(WORKFLOW, WINDOW)],
      [
        "countVersions",
        (repository) => {
          database.answers({ rows: [{ total: "0" }] });
          return repository.countVersions(WORKFLOW);
        },
      ],
      ["versionAt", (repository) => repository.versionAt(WORKFLOW, 14)],
    ];

    it.each(keyed)("%s is keyed by the workflow", async (_name, statement) => {
      await statement(workflows);

      expect(database.statements[0].sql).toContain('"workflow_id" = $');
      expect(database.statements[0].parameters).toContain(WORKFLOW);
    });
  });

  describe("find", () => {
    it("reads one row by workspace and id", async () => {
      await workflows.find(WORKSPACE, WORKFLOW);

      const { sql, parameters } = database.statements[0];
      expect(sql).toContain('from "ouroboros"."workflows"');
      expect(sql).toContain('"id" = $');
      expect(parameters).toEqual([WORKSPACE, WORKFLOW]);
    });
  });

  describe("lock", () => {
    it("takes a row lock, which is what turns a publish race into a wait", async () => {
      await workflows.lock(WORKSPACE, WORKFLOW, asTransaction(database));

      expect(database.statements[0].sql).toContain("for update");
    });
  });

  describe("create", () => {
    it("writes the workflow and its draft in one transaction", async () => {
      // `begin` and `commit` are recorded without consuming a queued answer, so the two rows
      // below are the two inserts.
      database.answers({ rows: [{ id: WORKFLOW }] }, { rows: [{ id: DRAFT }] });

      await workflows.create(WORKSPACE, {
        slug: "standard-fix",
        name: "Standard Fix",
        definition: {},
      });

      // A workflow with no draft is a state this API does not otherwise produce, and would
      // leave the studio's first autosave with nothing to match against.
      expect(database.sql()[0]).toBe("begin");
      expect(database.sql().at(-1)).toBe("commit");
      expect(database.sql()[1]).toContain('insert into "ouroboros"."workflows"');
      expect(database.sql()[2]).toContain('insert into "ouroboros"."workflow_versions"');
    });

    it("creates nothing published — the chip is null until somebody publishes", async () => {
      database.answers({ rows: [{ id: WORKFLOW }] }, { rows: [{ id: DRAFT }] });

      await workflows.create(WORKSPACE, {
        slug: "standard-fix",
        name: "Standard Fix",
        definition: {},
      });

      expect(database.statements[1].parameters).toContain("active");
      expect(database.statements[1].parameters).toContain(null);
      expect(database.statements[2].parameters).toContain(null);
    });

    it("serialises the definition, because Kysely sends what a driver will accept", async () => {
      database.answers({ rows: [{ id: WORKFLOW }] }, { rows: [{ id: DRAFT }] });

      await workflows.create(WORKSPACE, {
        slug: "from-template",
        name: "From template",
        definition: { dsl_version: "1.0" },
      });

      expect(database.statements[2].parameters).toContain('{"dsl_version":"1.0"}');
    });
  });

  describe("rename", () => {
    it("sets only the fields the request carried", async () => {
      await workflows.rename(WORKSPACE, WORKFLOW, { status: "paused" });

      const { sql, parameters } = database.statements[0];
      expect(sql).toContain('set "status" = $');
      expect(sql).not.toContain('"name" = ');
      expect(parameters).toContain("paused");
    });

    it("returns the row after the change, so a PATCH and a GET agree", async () => {
      await workflows.rename(WORKSPACE, WORKFLOW, { name: "Hotfix P0" });

      expect(database.statements[0].sql).toContain("returning *");
    });
  });

  describe("the draft", () => {
    it("is found by `version is null`, which is the partial unique index exactly", async () => {
      await workflows.draftOf(WORKFLOW);

      const { sql } = database.statements[0];
      expect(sql).toContain('"version" is null');
      expect(sql).not.toContain("for update");
    });

    it("is locked when a write is about to be based on it", async () => {
      // Two autosaves a millisecond apart are then separated by the database rather than by
      // luck: the second blocks, re-reads, and finds an etag its If-Match does not admit.
      await workflows.draftOf(WORKFLOW, asTransaction(database), true);

      expect(database.statements[0].sql).toContain("for update");
    });

    it("is inserted rather than upserted, so two creators do not both win", async () => {
      database.answers({ rows: [{ id: DRAFT }] });

      await workflows.insertDraft(WORKFLOW, { nodes: [] });

      const { sql } = database.statements[0];
      expect(sql).toContain('insert into "ouroboros"."workflow_versions"');
      expect(sql).not.toContain("on conflict");
    });

    it("is rewritten by id and only while it is still a draft", async () => {
      await workflows.writeDraft(DRAFT, { nodes: [1] });

      const { sql, parameters } = database.statements[0];
      expect(sql).toContain('"id" = $');
      expect(sql).toContain('"version" is null');
      expect(parameters).toContain(DRAFT);
      expect(parameters).toContain('{"nodes":[1]}');
    });
  });

  describe("the history", () => {
    it("excludes drafts and reads the unique key backwards", async () => {
      await workflows.versions(WORKFLOW, WINDOW);

      const { sql } = database.statements[0];
      expect(sql).toContain('"version" is not null');
      expect(sql).toContain('order by "version" desc');
      expect(sql).toContain("limit");
      expect(sql).toContain("offset");
    });

    it("does not select the documents", async () => {
      // A definition holds a prompt template per model stage; a history page that inlined them
      // would move megabytes to render a list of dates.
      expect(database.sql()).toEqual([]);

      await workflows.versions(WORKFLOW, WINDOW);

      expect(database.statements[0].sql).not.toContain('"definition"');
      expect(database.statements[0].sql).not.toContain("select *");
    });

    it("counts the same rows it lists", async () => {
      database.answers({ rows: [{ total: "2" }] });

      expect(await workflows.countVersions(WORKFLOW)).toBe(2);
      expect(database.statements[0].sql).toContain('"version" is not null');
    });

    it("reads one version by number, and never a draft", async () => {
      await workflows.versionAt(WORKFLOW, 14);

      const { sql, parameters } = database.statements[0];
      expect(sql).toContain('"version" = $');
      expect(parameters).toEqual([WORKFLOW, 14]);
    });
  });

  describe("publish", () => {
    it("offers max + 1, and lets the trigger be the rule", async () => {
      database.answers({ rows: [{ highest: 14 }] }, { rows: [{ id: "v15", version: 15 }] }, {});

      await workflows.publish(
        WORKFLOW,
        {
          definition: { nodes: [] },
          changeNote: "Added the review gate.",
          publishedBy: "user-1",
          publishedAt: new Date("2026-09-12T10:00:00.000Z"),
        },
        asTransaction(database),
      );

      expect(database.statements[0].sql).toContain("max(version)");
      expect(database.statements[1].parameters).toContain(15);
      expect(database.statements[1].parameters).toContain("Added the review gate.");
      expect(database.statements[1].parameters).toContain("user-1");
    });

    it("starts at 1 for a workflow that has published nothing", async () => {
      database.answers({ rows: [{ highest: null }] }, { rows: [{ id: "v1", version: 1 }] }, {});

      await workflows.publish(
        WORKFLOW,
        { definition: {}, changeNote: null, publishedBy: null, publishedAt: new Date() },
        asTransaction(database),
      );

      expect(database.statements[1].parameters).toContain(1);
    });

    it("points current_version at what it wrote", async () => {
      database.answers({ rows: [{ highest: 0 }] }, { rows: [{ id: "v1", version: 1 }] }, {});

      await workflows.publish(
        WORKFLOW,
        { definition: {}, changeNote: null, publishedBy: null, publishedAt: new Date() },
        asTransaction(database),
      );

      const move = database.statements[2];
      expect(move.sql).toContain('update "ouroboros"."workflows"');
      expect(move.sql).toContain('set "current_version" = $');
      expect(move.parameters).toEqual([1, WORKFLOW]);
    });

    it("leaves the draft where it is", async () => {
      // V029 permits promoting the draft in place; copying is the shape that leaves the canvas
      // with a draft to autosave into and an etag that did not move.
      database.answers({ rows: [{ highest: 0 }] }, { rows: [{ id: "v1", version: 1 }] }, {});

      await workflows.publish(
        WORKFLOW,
        { definition: {}, changeNote: null, publishedBy: null, publishedAt: new Date() },
        asTransaction(database),
      );

      expect(database.sql().some((statement) => statement.includes("delete from"))).toBe(false);
      expect(
        database
          .sql()
          .some((statement) => statement.includes('update "ouroboros"."workflow_versions"')),
      ).toBe(false);
    });
  });
});
