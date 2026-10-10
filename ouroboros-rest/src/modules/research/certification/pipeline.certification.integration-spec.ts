/**
 * The regression watch and the roadmap pipeline, certified over the development seeds (CM.7,
 * [#626](https://github.com/NobuData/ouroboros/issues/626)).
 *
 * The seed is mockup 22 as rows: a watch with a fix in flight, a fix drafted and a fix merged;
 * and `RS-124`'s roadmap, filed as six issues, committed, with its document and its tracker
 * agreeing on every item. These cases hold the composed system to what that page promises —
 * **a pass changes nothing it has no business changing, filing is the opt-in, the file and the
 * tracker never drift silently, re-filing files nothing twice, and applying a suggestion is a
 * re-run** — reading everything from the seed by its natural keys.
 *
 * The chain from a detected drift to a drafted fix, and the no-repro and non-convergent paths,
 * are certified from scripted telemetry in `../watch/watch.integration-spec.ts`; the pipeline's
 * first run — brief → v1 → pull request → apply → six issues → writeback — in
 * `../pipeline/pipeline.integration-spec.ts`. Those suites build their own rows; this one reads
 * the seed's.
 */

import { ApiHarness } from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import { SCHEMA_NAME } from "../../db/schema";
import { EngineClient } from "../../engine/engine.client";
import type { EngineRoadmap, EngineSkillRunRequest } from "../../engine/engine.skills";
import { GithubRateLimiter } from "../../github/github.rate-limit";
import { BatchesService } from "../../planning/batches.service";
import { PushRepository, type PushedDraft } from "../../planning/push.repository";
import { PushService } from "../../planning/push.service";
import { GithubTicketSourceProvider } from "../../ticket-sources/providers/github.provider";
import {
  SOURCE_TOKEN,
  recordingFactory,
} from "../../ticket-sources/providers/github.provider.fixture";
import { writeRecording } from "../../ticket-sources/providers/github.write-recordings.fixture";
import { TicketSourceRegistry } from "../../ticket-sources/ticket-source.registry";
import { TicketSourcesService } from "../../ticket-sources/ticket-sources.service";
import { VaultService } from "../../vault/vault.service";
import { FakeRepo, issuesRun, roadmapRun, rs124Roadmap } from "../pipeline/pipeline.fixture";
import { ProviderRepoGateway } from "../pipeline/pipeline.repo";
import type {
  DriftResource,
  IssuesResource,
  RoadmapResource,
} from "../pipeline/pipeline.resources";
import { OPEN_STATUSES } from "../watch/watch.repository";
import type { WatchCardResource, WatchSettingsResource } from "../watch/watch.resources";
import { RegressionWatchScheduler } from "../watch/watch.scheduler";
import {
  seedResearch,
  type SeededInvestigation,
  type SeededResearch,
} from "./certification.fixture";

const RESEARCH = "/api/v1/research";
const ROADMAP_PATH = "docs/ROADMAP.md";

describe("the regression watch and the roadmap pipeline, certified over the seeds", () => {
  let api: ApiHarness;
  let seeded: SeededResearch;
  let rs124: SeededInvestigation;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_RESEARCH_ROADMAP_TICK_MS: "0" });
    seeded = await seedResearch(api);
    rs124 = await seeded.investigation("RS-124");
  });

  afterAll(async () => {
    await api.truncate();
    await api.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function one<T>(sql: string, values: unknown[]): Promise<T> {
    const { rows } = await api.sql.query(sql, values);

    return rows[0] as T;
  }

  /** How many rows the workspace holds in the tables a pass or a filing could add to. */
  async function footprint(): Promise<Record<string, number>> {
    return one(
      `select (select count(*)::int from ${SCHEMA_NAME}.tickets where organization_id = $1) as tickets,
              (select count(*)::int from ${SCHEMA_NAME}.draft_batches where organization_id = $1) as batches,
              (select count(*)::int from ${SCHEMA_NAME}.ticket_drafts d
                 join ${SCHEMA_NAME}.draft_batches b on b.id = d.batch_id
                where b.organization_id = $1) as drafts,
              (select count(*)::int from ${SCHEMA_NAME}.runs where organization_id = $1) as runs,
              (select count(*)::int from ${SCHEMA_NAME}.roadmap_doc_versions v
                 join ${SCHEMA_NAME}.roadmap_docs d on d.id = v.doc_id
                where d.organization_id = $1) as versions,
              (select count(*)::int from ${SCHEMA_NAME}.doc_suggestions s
                 join ${SCHEMA_NAME}.roadmap_docs d on d.id = s.doc_id
                where d.organization_id = $1) as suggestions`,
      [seeded.workspace.id],
    );
  }

  const repo = new FakeRepo();

  /** The pipeline reaches its repository through the fake, which holds the committed file. */
  function holdRepository(): void {
    jest
      .spyOn(api.nest.get(ProviderRepoGateway), "open")
      .mockImplementation((source, work) => repo.open(source, work));
  }

  describe("the watch", () => {
    it("runs a pass over the seeded watch and changes none of its rows, and files nothing", async () => {
      const read = () =>
        seeded.as(seeded.people.viewer, "get", `${RESEARCH}/regression-watch`).expect(200);
      const before = bodyOf<WatchCardResource>(await read());
      const rows = await footprint();

      expect(before.items.map((item) => item.status).sort()).toEqual([
        "fix_drafted",
        "fix_running",
        "fixed_merged",
      ]);

      const summary = await api.nest.get(RegressionWatchScheduler).tick();
      const after = bodyOf<WatchCardResource>(await read());

      // The pass looks at every open item; a merged fix has reached its end.
      expect(summary.items).toBe(
        before.items.filter((item) => OPEN_STATUSES.includes(item.status)).length,
      );
      expect(summary.moved).toBe(0);
      expect(after.items.map((item) => [item.id, item.status, item.severity])).toEqual(
        before.items.map((item) => [item.id, item.status, item.severity]),
      );
      expect(after.headline).toBe(before.headline);
      expect(await footprint()).toEqual(rows);
    });

    it("keeps filing as the opt-in, and reads a merged fix as merged", async () => {
      const settings = bodyOf<WatchSettingsResource>(
        await seeded
          .as(seeded.people.viewer, "get", `${RESEARCH}/regression-watch/settings`)
          .expect(200),
      );
      const card = bodyOf<WatchCardResource>(
        await seeded.as(seeded.people.viewer, "get", `${RESEARCH}/regression-watch`).expect(200),
      );
      const byStatus = new Map(card.items.map((item) => [item.status, item]));

      // Off by default: a drafted fix waits for a person, however many passes run.
      expect(settings.autoFile).toBe(false);
      expect(byStatus.get("fix_drafted")?.fixTicket).not.toBeNull();
      expect(byStatus.get("fix_drafted")?.pullRequest).toBeNull();
      // A fix in flight names its ticket; a merged one names the pull request that merged it.
      expect(byStatus.get("fix_running")?.fixTicket?.kind).toBe("ticket");
      expect(byStatus.get("fixed_merged")?.pullRequest?.key).toMatch(/^#\d+$/);
      expect(byStatus.get("fixed_merged")?.severity).toBe("ok");
    });
  });

  describe("the pipeline over RS-124", () => {
    const base = () => `${RESEARCH}/investigations/${rs124.id}/roadmap`;
    /** The roadmap as the skill would answer it again: what the current version says. */
    function answerFrom(card: RoadmapResource): EngineRoadmap {
      return {
        title: card.doc.title,
        milestones: card.milestones.map((milestone) => ({
          key: milestone.key,
          name: milestone.name,
          targetDate: milestone.targetDate,
          items: milestone.items.map((item) => ({
            key: item.key,
            title: item.title,
            mvp: item.mvp,
            effort: item.effort,
          })),
        })),
      };
    }

    it("holds the seeded document identical to its tracker and its file", async () => {
      const card = bodyOf<RoadmapResource>(
        await seeded.as(seeded.people.viewer, "get", base()).expect(200),
      );

      expect(card.projection.state).toBe("committed");
      expect(card.issues).toMatchObject({ filed: 6, total: 6 });
      expect(card.suggestions.open).toBe(2);

      repo.handEdit(ROADMAP_PATH, card.markdown);
      holdRepository();

      const check = bodyOf<DriftResource>(
        await seeded.as(seeded.people.member, "post", `${base()}/drift-check`).expect(200),
      );

      expect(check).toMatchObject({ identical: true, differences: [], raised: null });
      expect(check.roadmap.projection.state).toBe("committed");
    });

    it("files nothing twice when create-issues is run again", async () => {
      const runSkill = jest.spyOn(api.nest.get(EngineClient), "runSkill");
      const push = jest.spyOn(api.nest.get(BatchesService), "push");
      const rows = await footprint();

      holdRepository();

      const filed = bodyOf<IssuesResource>(
        await seeded.as(seeded.people.admin, "post", `${base()}/issues`).send({}).expect(200),
      );

      expect(filed).toMatchObject({
        stage: "filed",
        wroteVersion: false,
        unsized: 0,
        undrafted: [],
      });
      expect(filed.roadmap.doc.version).toBe(1);
      expect(runSkill).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
      expect(await footprint()).toEqual(rows);
      expect(rs124.status).toBe("issues_filed");
    });

    it("raises exactly one suggestion for a tracker-side change, and rewrites nothing", async () => {
      holdRepository();

      const before = bodyOf<RoadmapResource>(
        await seeded.as(seeded.people.viewer, "get", base()).expect(200),
      );
      const rows = await footprint();
      const changed = before.milestones
        .flatMap((milestone) => milestone.items)
        .find((item) => item.ticket !== null && !item.checked);

      expect(changed).toBeDefined();

      // Someone closes that issue in the tracker.
      await api.sql.query(`update ${SCHEMA_NAME}.tickets set state = 'closed' where id = $1`, [
        changed?.ticket?.id,
      ]);

      const first = bodyOf<DriftResource>(
        await seeded.as(seeded.people.member, "post", `${base()}/drift-check`).expect(200),
      );
      const second = bodyOf<DriftResource>(
        await seeded.as(seeded.people.member, "post", `${base()}/drift-check`).expect(200),
      );
      const after = bodyOf<RoadmapResource>(
        await seeded.as(seeded.people.viewer, "get", base()).expect(200),
      );

      expect(first.identical).toBe(false);
      expect(first.differences).toEqual([
        {
          field: "state",
          itemKey: changed?.key,
          ticketKey: changed?.ticket?.key,
          document: "open",
          tracker: "done",
        },
      ]);
      expect(first.raised).toMatchObject({
        authorKind: "ai",
        authorName: "drift-detector",
        status: "open",
      });
      expect(first.roadmap.projection.state).toBe("drift_detected");
      expect(second.raised).toBeNull();
      expect(after.suggestions.open).toBe(before.suggestions.open + 1);
      expect(await footprint()).toEqual({ ...rows, suggestions: rows.suggestions + 1 });
      // Never a silent rewrite: the version, its file and the document's markdown are as they were.
      expect(after.doc.version).toBe(before.doc.version);
      expect(after.markdown).toBe(before.markdown);
      expect(repo.branches.get("main")?.get(ROADMAP_PATH)?.content).toBe(before.markdown);
    });

    it("applies the drift suggestion by a genuine re-run, producing the next version", async () => {
      holdRepository();

      const before = bodyOf<RoadmapResource>(
        await seeded.as(seeded.people.viewer, "get", base()).expect(200),
      );
      const drift = before.suggestions.items.find(
        (suggestion) => suggestion.status === "open" && suggestion.authorName === "drift-detector",
      );
      const runs: EngineSkillRunRequest[] = [];

      expect(drift).toBeDefined();
      jest.spyOn(api.nest.get(EngineClient), "runSkill").mockImplementation((request) => {
        runs.push(request);

        return Promise.resolve({
          ok: true,
          data: {
            skill: request.skill.slug,
            version: request.skill.version,
            output: "roadmap",
            roadmap: answerFrom(before),
            issues: null,
            attempts: 1,
            usage: [],
          },
        });
      });

      const card = bodyOf<RoadmapResource>(
        await seeded
          .as(seeded.people.admin, "post", `${base()}/suggestions/${drift?.id ?? ""}/apply`)
          .expect(200),
      );

      // The skill was asked again, shown the version before and the suggestion it is applying.
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ output: "roadmap", skill: { slug: "create-roadmap" } });
      expect((runs[0]?.input.previous as { milestones: unknown[] }).milestones).toHaveLength(
        before.milestones.length,
      );
      expect(runs[0]?.input.suggestions).toEqual([
        { from: "drift-detector", text: drift?.text, hint: drift?.hint },
      ]);

      // The next version, from the answer — and the tracker's state folded in, not the skill's.
      expect(card.doc.version).toBe(before.doc.version + 1);
      expect(card.doc.generatedBy).toContain(`suggestion ${drift?.id ?? ""}`);
      expect(
        card.suggestions.items.find((suggestion) => suggestion.id === drift?.id),
      ).toMatchObject({
        status: "applied",
        appliedVersion: card.doc.version,
      });
      expect(
        card.milestones.flatMap((milestone) => milestone.items).filter((item) => item.checked),
      ).toHaveLength(
        before.milestones.flatMap((milestone) => milestone.items).filter((item) => item.checked)
          .length + 1,
      );
      // Version 1 is as the seed wrote it.
      expect(
        await one(
          `select generated_by, (select count(*)::int from jsonb_array_elements(structure -> 'milestones') m,
                                   jsonb_array_elements(m -> 'items') i where (i ->> 'checked')::boolean) as done
             from ${SCHEMA_NAME}.roadmap_doc_versions v join ${SCHEMA_NAME}.roadmap_docs d on d.id = v.doc_id
            where d.investigation_id = $1 and v.version = 1`,
          [rs124.id],
        ),
      ).toEqual({ generated_by: "create-roadmap@rs-124", done: 1 });

      // And with the new version proposed, document and tracker agree again.
      const check = bodyOf<DriftResource>(
        await seeded.as(seeded.people.member, "post", `${base()}/drift-check`).expect(200),
      );

      expect(check.identical).toBe(true);
      expect(check.raised).toBeNull();
    });
  });

  describe("the push idempotency key, under create-issues", () => {
    it("files each item once, even when the record of a filed issue is lost after the tracker answered", async () => {
      // A fresh roadmap over RS-127's brief, filed into the recorded GitHub through the real
      // push — with the seeded source's token re-sealed by this harness's vault, which the
      // seed's sealed development credential cannot be opened by.
      const rs127 = await seeded.investigation("RS-127");
      const sealed = await api.nest
        .get(VaultService)
        .encryptText(seeded.workspace.id, seeded.githubSourceId, SOURCE_TOKEN);

      await api.sql.query(
        `update ${SCHEMA_NAME}.ticket_sources set credentials_encrypted = $2 where id = $1`,
        [seeded.githubSourceId, sealed],
      );

      const github = writeRecording();
      const provider = new GithubTicketSourceProvider(
        recordingFactory(github.octokit).factory,
        new GithubRateLimiter(),
      );
      const store = api.nest.get(PushRepository);
      // The process dies once, after the tracker has answered and before the record is written.
      let deaths = 1;
      const crashing = Object.create(store) as PushRepository;

      Object.defineProperty(crashing, "recordPushed", {
        value: (pushed: PushedDraft): Promise<string> => {
          if (deaths > 0) {
            deaths -= 1;

            return Promise.reject(
              new Error("the process was killed before the record was written"),
            );
          }

          return store.recordPushed(pushed);
        },
      });

      const pusher = new PushService(
        crashing,
        new TicketSourceRegistry([provider]),
        api.nest.get(TicketSourcesService),
      );
      const batches = api.nest.get(BatchesService);

      jest.spyOn(batches, "push").mockImplementation(async (organizationId, batchId) => ({
        report: await pusher.push(organizationId, batchId),
        queueSmall: null,
      }));
      jest.spyOn(batches, "resume").mockImplementation(async (organizationId, batchId) => ({
        report: await pusher.resume(organizationId, batchId),
        queueSmall: null,
      }));

      const answers = [
        roadmapRun(rs124Roadmap()),
        issuesRun([
          "dock-mpc",
          "dock-retry",
          "dock-gust",
          "fleet-battery",
          "fleet-gaps",
          "fleet-playbook",
        ]),
      ];

      jest.spyOn(api.nest.get(EngineClient), "runSkill").mockImplementation(() => {
        const data = answers.shift();

        return data === undefined
          ? Promise.reject(new Error("no scripted skill answer"))
          : Promise.resolve({ ok: true, data });
      });
      holdRepository();

      const path = `${RESEARCH}/investigations/${rs127.id}/roadmap`;

      await seeded
        .as(seeded.people.admin, "post", path)
        .send({ targetSourceId: seeded.githubSourceId })
        .expect(201);

      // The first filing stops when the record of the first issue is lost.
      const died = await seeded
        .as(seeded.people.admin, "post", `${path}/issues`)
        .send({ pushUnsized: true });

      expect(died.status).toBe(500);
      expect(github.issues).toHaveLength(1);

      // The second files the rest — and finds the first by its key rather than filing it again.
      const filed = bodyOf<IssuesResource>(
        await seeded
          .as(seeded.people.admin, "post", `${path}/issues`)
          .send({ pushUnsized: true })
          .expect(200),
      );

      expect(filed).toMatchObject({ stage: "filed", wroteVersion: true });
      expect(filed.roadmap.issues).toMatchObject({ filed: 6, total: 6 });
      expect(github.issues).toHaveLength(6);
      expect(new Set(github.issues.map((issue) => issue.number)).size).toBe(6);
      expect(
        await one(
          `select count(*)::int as tickets from ${SCHEMA_NAME}.tickets t
             join ${SCHEMA_NAME}.ticket_drafts d on d.pushed_ticket_id = t.id
             join ${SCHEMA_NAME}.draft_batches b on b.id = d.batch_id
             join ${SCHEMA_NAME}.roadmap_docs doc on doc.batch_id = b.id
            where doc.investigation_id = $1`,
          [rs127.id],
        ),
      ).toEqual({ tickets: 6 });
    });
  });
});
