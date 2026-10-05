import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SeededWorkspace } from "../../testing/dashboard.fixture";
import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { TranscriptRetentionSweeper } from "../runs/transcript.retention";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import {
  DAY_MS,
  keptOf,
  plantLoopData,
  retentionBench,
  sweepLoopData,
  type Planted,
} from "./retention.integration.fixture";
import type { RetentionSettingsResource } from "./retention.resources";

/**
 * The retention policy service against a migrated database (BQ.3,
 * [#482](https://github.com/NobuData/ouroboros/issues/482)):
 *
 *   * `GET`/`PATCH /api/v1/settings/retention` — defaults, the simple select against the advanced
 *     editor, bounds refused with their reason, custom classes, an audit row per change;
 *   * **one fixture per sweep**: changing a class's tier changes the next sweep of that class
 *     and leaves the other sweeps exactly where they were;
 *   * the defaults reproduce the old sweeps: data inside the old thirty-day boundary survives the
 *     first sweep, and data past it does not.
 *
 * ```bash
 * yarn test:integration src/modules/retention
 * ```
 */

const PATH = "/api/v1/settings/retention";

describe("retention tiers", () => {
  let api: ApiHarness;
  let volume: string;

  beforeAll(async () => {
    volume = await mkdtemp(join(tmpdir(), "ouro-retention-tiers-"));
    api = await ApiHarness.start({ OURO_ARTIFACT_STORE: "local", OURO_ARTIFACT_DIR: volume });
  });

  afterAll(async () => {
    await api.close();
    await rm(volume, { recursive: true, force: true });
  });

  afterEach(() => api.truncate());

  /** A workspace with a repository and a build pool, and its owner. */
  const workspace = () => retentionBench(api);

  /** A finished piece of each loop-data class, stored `ageMs` ago. */
  const plant = (at: SeededWorkspace, poolId: string, ageMs: number) =>
    plantLoopData(api, at, poolId, ageMs);

  /** Which of a planted set is still kept. */
  const kept = (planted: Planted) => keptOf(api, planted);

  /** Run each sweep once, as its timer would. */
  const sweepAll = () => sweepLoopData(api);

  /** A PATCH as a person. */
  function patch(person: Person, at: SeededWorkspace, body: object) {
    return api.as(person)("patch", PATH).set(TENANT_HEADER, at.slug).send(body);
  }

  describe("the routes", () => {
    it("answer the defaults to every member, and let only an administrator write", async () => {
      const { owner, at } = await workspace();
      const viewer = await api.signIn();
      await api.join(at.id, viewer, "viewer");

      const card = bodyOf<RetentionSettingsResource>(
        await api.as(viewer)("get", PATH).set(TENANT_HEADER, at.slug).expect(200),
      );
      expect(card).toMatchObject({ editable: false, reason: "role", loopDays: 30 });
      expect(card.classes.map((tier) => [tier.dataClass, tier.days])).toEqual([
        ["transcripts", 30],
        ["build_logs", 30],
        ["artifacts", 30],
        ["audit", 400],
      ]);
      // All four sweeps are booked in this process — the audit purge since BR.2 (#486).
      expect(card.classes.map((tier) => tier.nextSweepAt !== null)).toEqual([
        true,
        true,
        true,
        true,
      ]);

      await patch(viewer, at, { loopDays: 14 }).expect(403);
      await patch(owner, at, { loopDays: 14 }).expect(200);
    });

    it("map the simple select to the three loop classes, leave audit alone, and audit every change", async () => {
      const { owner, at } = await workspace();

      const card = bodyOf<RetentionSettingsResource>(
        await patch(owner, at, { loopDays: 90 }).expect(200),
      );

      expect(card.classes.map((tier) => [tier.dataClass, tier.days, tier.source])).toEqual([
        ["transcripts", 90, "policy"],
        ["build_logs", 90, "policy"],
        ["artifacts", 90, "policy"],
        ["audit", 400, "default"],
      ]);

      const { rows } = await api.sql.query<{
        actor_id: string;
        subject_id: string;
        detail: Record<string, unknown>;
      }>(
        `select actor_id, subject_id, detail from ${SCHEMA_NAME}.audit_events
          where organization_id = $1 and action = 'workspace.retention_changed'
          order by detail ->> 'dataClass'`,
        [at.id],
      );
      expect(rows).toEqual(
        ["artifacts", "build_logs", "transcripts"].map((dataClass) => ({
          actor_id: owner.id,
          subject_id: at.id,
          detail: { dataClass, previousDays: 30, previousSource: "default", days: 90 },
        })),
      );
    });

    it("refuse out-of-bounds tiers with a reason the card renders, and store nothing", async () => {
      const { owner, at } = await workspace();

      const audit = await patch(owner, at, { classes: { audit: 30 } }).expect(422);
      expect(audit.body).toMatchObject({
        code: "retention_out_of_bounds",
        details: {
          refusals: [{ dataClass: "audit", days: 30, reason: "below_floor", floor: 90 }],
          fields: { "classes.audit": ["Retention for audit must be at least 90 days."] },
        },
      });

      const loop = await patch(owner, at, { loopDays: 3 }).expect(422);
      expect(loop.body).toMatchObject({
        code: "retention_out_of_bounds",
        details: { fields: { loopDays: [expect.stringContaining("at least 7 days") as unknown] } },
      });

      await patch(owner, at, { classes: { artifacts: 366 } }).expect(422);
      await patch(owner, at, { loopDays: 30, classes: { audit: 400 } }).expect(422);
      await patch(owner, at, { classes: { everything: 30 } }).expect(422);

      const { rows } = await api.sql.query(
        `select 1 from ${SCHEMA_NAME}.retention_policies where organization_id = $1`,
        [at.id],
      );
      expect(rows).toEqual([]);
    });

    it("store and read a custom:* class without a schema change", async () => {
      const { owner, at } = await workspace();

      const card = bodyOf<RetentionSettingsResource>(
        await patch(owner, at, { classes: { "custom:chat-commands": 1095 } }).expect(200),
      );

      expect(card.classes.at(-1)).toMatchObject({
        dataClass: "custom:chat-commands",
        days: 1095,
        source: "policy",
        floor: 7,
        ceiling: 3650,
      });
    });
  });

  describe("the sweeps", () => {
    it("reproduce the old thirty days by default — inside the boundary kept, past it removed", async () => {
      const { at, poolId } = await workspace();
      const inside = await plant(at, poolId, 30 * DAY_MS - 3_600_000);
      const past = await plant(at, poolId, 30 * DAY_MS + 3_600_000);

      expect(await sweepAll()).toEqual({ logs: 1, artifacts: 1, transcripts: 1 });
      expect(await kept(inside)).toEqual({ logs: true, artifact: true, transcript: true });
      expect(await kept(past)).toEqual({ logs: false, artifact: false, transcript: false });
    });

    it("move each class's next cutoff when its tier changes — and only that class's", async () => {
      const { owner, at, poolId } = await workspace();
      const planted = await plant(at, poolId, 20 * DAY_MS);

      expect(await sweepAll()).toEqual({ logs: 0, artifacts: 0, transcripts: 0 });

      await patch(owner, at, { classes: { transcripts: 14 } }).expect(200);
      expect(await sweepAll()).toEqual({ logs: 0, artifacts: 0, transcripts: 1 });
      expect(await kept(planted)).toEqual({ logs: true, artifact: true, transcript: false });

      await patch(owner, at, { classes: { build_logs: 14 } }).expect(200);
      expect(await sweepAll()).toEqual({ logs: 1, artifacts: 0, transcripts: 0 });
      expect(await kept(planted)).toEqual({ logs: false, artifact: true, transcript: false });

      await patch(owner, at, { classes: { artifacts: 14 } }).expect(200);
      expect(await sweepAll()).toEqual({ logs: 0, artifacts: 1, transcripts: 0 });
      expect(await kept(planted)).toEqual({ logs: false, artifact: false, transcript: false });
    });

    it("hold each workspace to its own tier", async () => {
      const short = await workspace();
      const long = await workspace();
      const gone = await plant(short.at, short.poolId, 20 * DAY_MS);
      const stays = await plant(long.at, long.poolId, 20 * DAY_MS);

      await patch(short.owner, short.at, { loopDays: 7 }).expect(200);
      expect(await sweepAll()).toEqual({ logs: 1, artifacts: 1, transcripts: 1 });

      expect(await kept(gone)).toEqual({ logs: false, artifact: false, transcript: false });
      expect(await kept(stays)).toEqual({ logs: true, artifact: true, transcript: true });
    });

    it("report the last sweep's tombstone count on the card", async () => {
      const { owner, at, poolId } = await workspace();
      await plant(at, poolId, 40 * DAY_MS);

      // The card reports a tick's counts; drive the transcript sweeper's tick directly.
      await api.nest.get<{ tick: () => Promise<void> }>(TranscriptRetentionSweeper).tick();

      const card = bodyOf<RetentionSettingsResource>(
        await api.as(owner)("get", PATH).set(TENANT_HEADER, at.slug).expect(200),
      );
      expect(card.classes[0]).toMatchObject({
        dataClass: "transcripts",
        lastSweep: { removed: 1 },
      });
    });
  });
});
