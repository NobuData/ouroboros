import { ApiHarness } from "../../testing/harness.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { GithubRateLimiter } from "../github/github.rate-limit";
import { TicketSourceRegistry } from "../ticket-sources/ticket-source.registry";
import { TicketSourcesService } from "../ticket-sources/ticket-sources.service";
import { cycleWith, insertSource } from "../ticket-sources/ticket-sync.integration.fixture";
import { GithubTicketSourceProvider } from "../ticket-sources/providers/github.provider";
import {
  SOURCE_CONFIG,
  SOURCE_TOKEN,
  recordingFactory,
} from "../ticket-sources/providers/github.provider.fixture";
import {
  writeRecording,
  type WriteRecording,
} from "../ticket-sources/providers/github.write-recordings.fixture";
import { PushRepository, type PushStore } from "./push.repository";
import { PushService } from "./push.service";
import { OTA_BLOCKS, OTA_KEYS } from "./push.world.fixture";

/**
 * The push, end to end, against a migrated database (AL.3,
 * [#279](https://github.com/NobuData/ouroboros/issues/279)).
 *
 * `push.service.spec.ts` pins the orchestration over an in-memory store; this suite is the half
 * only PostgreSQL can answer — that `recordPushed` is one transaction V034–V036's triggers accept,
 * that the dependency rewrite leaves no draft end behind, that a crash between the tracker's `201`
 * and the commit is recovered without a duplicate, and that the canonical tickets a push creates
 * are the ones a WF-Q sync adopts rather than imports again.
 *
 * Nothing stands in but GitHub: the real `PushRepository`, the real `TicketSourcesService` opening a
 * vault-sealed credential, and the real `GithubTicketSourceProvider` over a recorded GitHub.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

describe("the planning push, against a migrated database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" });
  });

  afterAll(() => api.close());

  afterEach(() => api.truncate());

  /** A seeded workspace, its GitHub source, and mockup 09's batch. */
  interface Seeded {
    readonly organizationId: string;
    readonly sourceId: string;
    readonly batchId: string;
    readonly epicId: string;
    readonly github: WriteRecording;
    readonly provider: GithubTicketSourceProvider;
    /** A push service over a store — the real repository unless a case wraps it. */
    service(store?: PushStore): PushService;
  }

  /**
   * Seed a workspace with a GitHub source, an epic, and six drafts with five dependencies.
   *
   * @returns The seed.
   */
  async function seed(): Promise<Seeded> {
    const { organizationId, sourceId } = await insertSource(api, {
      kind: "github",
      displayName: "GitHub · acme-robotics",
      config: SOURCE_CONFIG,
      credential: SOURCE_TOKEN,
    });
    const epic = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.planning_epics (organization_id, name, sort_order)
       values ($1, 'OTA power-loss safety', 1) returning id`,
      [organizationId],
    );
    const epicId = epic.rows[0].id;
    const batch = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.draft_batches
         (organization_id, source_prompt, planner, target_source_id, target_milestone, status, epic_id)
       values ($1, 'OTA power-loss safety', 'outline-v0', $2, 'Helios 2.1', 'sized', $3)
       returning id`,
      [organizationId, sourceId, epicId],
    );
    const batchId = batch.rows[0].id;
    const drafts = new Map<string, string>();

    for (const key of OTA_KEYS) {
      const draft = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.ticket_drafts (batch_id, local_key, title, body)
         values ($1, $2, $3, $4) returning id`,
        [batchId, key, `${key}: planned work`, `Evidence for ${key}.`],
      );

      drafts.set(key, draft.rows[0].id);
    }

    for (const [blocker, blocked] of OTA_BLOCKS) {
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.ticket_dependencies
           (organization_id, blocker_draft_id, blocked_draft_id)
         values ($1, $2, $3)`,
        [organizationId, drafts.get(blocker), drafts.get(blocked)],
      );
    }

    const github = writeRecording();
    const provider = new GithubTicketSourceProvider(
      recordingFactory(github.octokit).factory,
      new GithubRateLimiter(),
    );

    return {
      organizationId,
      sourceId,
      batchId,
      epicId,
      github,
      provider,
      service: (store) =>
        new PushService(
          store ?? api.nest.get(PushRepository),
          new TicketSourceRegistry([provider]),
          api.nest.get(TicketSourcesService),
        ),
    };
  }

  /**
   * One count off the database.
   *
   * @param query - A `select count(*)::int as count …`.
   * @param values - Its parameters.
   * @returns The count.
   */
  async function count(query: string, values: unknown[]): Promise<number> {
    const { rows } = await api.sql.query<{ count: number }>(query, values);

    return rows[0].count;
  }

  it("lands the batch as tickets, rewritten dependencies, epic counts and a mirror", async () => {
    const world = await seed();

    const report = await world.service().push(world.organizationId, world.batchId);

    expect(report).toMatchObject({ outcome: "pushed", batchStatus: "pushed", pushedThisRun: 6 });
    expect(report.links).toStrictEqual({ native: 5, fallback: 0 });
    expect(world.github.ledger().tickets).toHaveLength(6);
    expect(world.github.relations).toHaveLength(5);
    expect(world.github.subIssues).toHaveLength(6);
    expect(world.github.milestones).toHaveLength(1);

    const s = SCHEMA_NAME;

    await expect(
      count(`select count(*)::int as count from ${s}.tickets where source_id = $1`, [
        world.sourceId,
      ]),
    ).resolves.toBe(6);
    await expect(
      count(
        `select count(*)::int as count from ${s}.ticket_drafts
          where batch_id = $1 and push_state = 'pushed' and pushed_ticket_id is not null`,
        [world.batchId],
      ),
    ).resolves.toBe(6);
    await expect(
      count(
        `select count(*)::int as count from ${s}.ticket_dependencies
          where organization_id = $1 and blocker_ticket_id is not null and blocked_ticket_id is not null
            and blocker_draft_id is null and blocked_draft_id is null`,
        [world.organizationId],
      ),
    ).resolves.toBe(5);
    await expect(
      count(`select count(*)::int as count from ${s}.epic_tickets where epic_id = $1`, [
        world.epicId,
      ]),
    ).resolves.toBe(6);

    const mirrors = await api.sql.query<{ kind: string; external_ref: string }>(
      `select kind, external_ref from ${s}.epic_mirrors where epic_id = $1`,
      [world.epicId],
    );

    expect(mirrors.rows).toStrictEqual([{ kind: "parent_issue", external_ref: "1" }]);

    const batch = await api.sql.query<{ status: string }>(
      `select status from ${s}.draft_batches where id = $1`,
      [world.batchId],
    );

    expect(batch.rows[0].status).toBe("pushed");
  });

  it("recovers a push killed between the tracker's answer and the commit, without duplicates", async () => {
    const world = await seed();
    const repository = api.nest.get(PushRepository);
    let commits = 0;
    const dying: PushStore = Object.assign(Object.create(repository) as PushRepository, {
      recordPushed: async (...args: Parameters<PushRepository["recordPushed"]>) => {
        if (commits === 4) {
          throw new Error("killed before the transaction committed");
        }

        commits += 1;

        return repository.recordPushed(...args);
      },
    });

    await expect(world.service(dying).push(world.organizationId, world.batchId)).rejects.toThrow(
      "killed",
    );
    expect(world.github.ledger().tickets).toHaveLength(5);

    const resumed = await world.service().resume(world.organizationId, world.batchId);

    expect(resumed).toMatchObject({ outcome: "pushed", pushedThisRun: 2 });
    expect(world.github.ledger().tickets).toHaveLength(6);
    expect(world.github.relations).toHaveLength(5);
    await expect(
      count(`select count(*)::int as count from ${SCHEMA_NAME}.tickets where source_id = $1`, [
        world.sourceId,
      ]),
    ).resolves.toBe(6);
  });

  it("hands the tickets to the WF-Q sync, which adopts them rather than importing them again", async () => {
    const world = await seed();
    const report = await world.service().push(world.organizationId, world.batchId);
    const pushedIds = report.drafts.map((draft) => draft.ticketId).sort();

    const cycle = await cycleWith(api, [world.provider]);
    const outcome = cycle.sources.find((source) => source.sourceId === world.sourceId);

    // Six pushed tickets updated in place with GitHub's own timestamps and body; the epic's parent
    // issue is the one ticket the push did not create, and the one the sync imports.
    expect(outcome).toMatchObject({ imported: 1, updated: 6 });

    const tickets = await api.sql.query<{ id: string }>(
      `select t.id from ${SCHEMA_NAME}.tickets t
         join ${SCHEMA_NAME}.ticket_drafts d on d.pushed_ticket_id = t.id
        where d.batch_id = $1 order by t.id`,
      [world.batchId],
    );

    expect(tickets.rows.map((row) => row.id)).toStrictEqual(pushedIds);
    await expect(
      count(`select count(*)::int as count from ${SCHEMA_NAME}.tickets where source_id = $1`, [
        world.sourceId,
      ]),
    ).resolves.toBe(7);
  });

  it("adopts a ticket a sync imported before the push could commit it", async () => {
    const world = await seed();
    const repository = api.nest.get(PushRepository);
    const dying: PushStore = Object.assign(Object.create(repository) as PushRepository, {
      recordPushed: () => Promise.reject(new Error("killed before the transaction committed")),
    });

    await expect(world.service(dying).push(world.organizationId, world.batchId)).rejects.toThrow(
      "killed",
    );

    // The one issue the dead push created, and the epic parent, reach the mirror through a sync.
    await cycleWith(api, [world.provider]);

    const resumed = await world.service().resume(world.organizationId, world.batchId);

    expect(resumed.outcome).toBe("pushed");
    await expect(
      count(`select count(*)::int as count from ${SCHEMA_NAME}.tickets where source_id = $1`, [
        world.sourceId,
      ]),
    ).resolves.toBe(7);
  });

  it("cannot push a batch from another workspace", async () => {
    const world = await seed();
    const other = await api.workspace(await api.signIn());

    await expect(world.service().push(other.id, world.batchId)).rejects.toMatchObject({
      code: "planning_batch_not_found",
    });
    expect(world.github.calls).toHaveLength(0);
  });
});
