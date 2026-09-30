import {
  PRIMARY_REPO,
  workspaceWithRepo,
  type SeededWorkspace,
} from "../../testing/dashboard.fixture";
import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { seedIntake } from "../../testing/intake.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { seedPublishedSkills } from "../../testing/skills.seed.fixture";
import { seedTriggerWorkflow } from "../../testing/workflow.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { PLAYBOOK_ERRORS } from "./playbooks.errors";
import type {
  PlaybookCounts,
  PlaybookDraftResource,
  PlaybookIssueList,
  PlaybookLaunchReceipt,
  PlaybookList,
  PlaybookResource,
} from "./playbooks.resources";

/**
 * Playbooks against a migrated database, through the whole pipeline — BF.7's certification of
 * BF.6 ([#416](https://github.com/NobuData/ouroboros/issues/416),
 * [#415](https://github.com/NobuData/ouroboros/issues/415)).
 *
 * What each case holds, so a refactor that loses it turns this file red:
 *
 *   * **create-from-run copies evidence** — the run's workflow pin (not the head), its injected
 *     skills as a delta against today's resolution, and the steers someone typed; a run still in
 *     flight is refused;
 *   * **`run N×` is derived** — a run carrying `playbook_id` appears in the count and a deleted one
 *     leaves it, while the playbook row is never written, and V072's table has no counter column
 *     for a refactor to start reading;
 *   * **run-on-issue is composition** — the launch is M.3's queue write under the playbook's pin,
 *     carrying its id, and V072's filter narrows both the picker and the launch.
 */

const PLAYBOOKS = "/api/v1/knowledge/playbooks";

/** The workflow every playbook here is pinned to; v2 is its head, v1 the pin. */
const WORKFLOW = "feature-loop";

/** A 64-hex manifest hash, as V071 requires. */
const HASH = "a".repeat(64);

describe("playbooks, against a migrated database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(async () => {
    await api.close();
  });

  afterEach(async () => {
    await api.truncate();
  });

  /** A workspace with a repository, its owner, and a two-version workflow. */
  interface Bench {
    owner: Person;
    workspace: SeededWorkspace;
    /** `owner/name`, lower-case — how the playbooks module names the repository. */
    repo: string;
  }

  /** @returns A bench, the workflow published at v1 and v2 with v2 in force. */
  async function bench(): Promise<Bench> {
    const owner = await api.signIn({ email: "owner@ouroboros.invalid" });
    const workspace = await workspaceWithRepo(api, owner);

    await seedTriggerWorkflow(api, workspace.id, WORKFLOW, {}, { versions: 2 });

    return { owner, workspace, repo: `${workspace.slug}/${PRIMARY_REPO}`.toLowerCase() };
  }

  /** A request as the bench's owner. */
  function as(place: Bench) {
    return (method: "get" | "post" | "patch" | "delete", path: string) =>
      api.as(place.owner)(method, path).set(TENANT_HEADER, place.workspace.slug);
  }

  /**
   * A run of the bench's repository.
   *
   * @param place - Where.
   * @param fields - The status, and optionally the pin and the playbook it was launched through.
   * @returns `runs.id`.
   */
  async function run(
    place: Bench,
    fields: { status: "coding" | "merged"; pin?: number; playbookId?: string },
  ): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.runs (organization_id, github_repo_id, issue_number, issue_title,
                                        workflow_tag, workflow_version_pin, playbook_id, model,
                                        status, stage_label, stage_index, stage_total, started_at,
                                        finished_at, pr_number, checks_passed, checks_total)
       values ($1, $2, 482, 'Fix flaky CAN-bus telemetry test', $3, $4, $5, 'claude-fable-5',
               $6, 'Merged', 6, 6, now() - interval '1 hour',
               case when $6 = 'merged' then now() end,
               case when $6 = 'merged' then 512 end,
               case when $6 = 'merged' then 14 end,
               case when $6 = 'merged' then 14 end)
       returning id`,
      [
        place.workspace.id,
        place.workspace.repoId,
        WORKFLOW,
        fields.pin ?? null,
        fields.playbookId ?? null,
        fields.status,
      ],
    );

    return rows[0].id;
  }

  /**
   * The skills of the workspace by slug, with their published v1's id.
   *
   * @param place - Where.
   * @returns `slug → {skillId, versionId}`.
   */
  async function skillsOf(
    place: Bench,
  ): Promise<Map<string, { skillId: string; versionId: string }>> {
    const { rows } = await api.sql.query<{ slug: string; skill_id: string; version_id: string }>(
      `select s.slug, s.id as skill_id, sv.id as version_id
         from ${SCHEMA_NAME}.skills s
         join ${SCHEMA_NAME}.skill_versions sv on sv.skill_id = s.id and sv.version = 1
        where s.organization_id = $1`,
      [place.workspace.id],
    );

    return new Map(
      rows.map((row) => [row.slug, { skillId: row.skill_id, versionId: row.version_id }]),
    );
  }

  /**
   * A hand-authored playbook pinned to v1.
   *
   * @param place - Where.
   * @param body - Anything beyond the name, description and pin.
   * @returns The playbook.
   */
  async function authored(
    place: Bench,
    body: Record<string, unknown> = {},
  ): Promise<PlaybookResource> {
    return bodyOf<PlaybookResource>(
      await as(place)("post", PLAYBOOKS)
        .send({
          name: "Flaky test hunt",
          description: "Reproduce, quarantine, fix.",
          workflow: WORKFLOW,
          workflowVersion: 1,
          ...body,
        })
        .expect(201),
    );
  }

  it("captures what a run used — its pin, its injected skills as a delta, and its steers", async () => {
    const place = await bench();

    // `kept` and `dropped` resolve for the repository; `borrowed` is another repository's, so it
    // does not. The run was injected with `kept` and `borrowed`.
    await seedPublishedSkills(api, place.workspace.id, ["kept", "dropped"]);
    await seedPublishedSkills(api, place.workspace.id, ["borrowed"]);
    await api.sql.query(
      `update ${SCHEMA_NAME}.skills set scope = 'repo', repo_ref = 'acme-robotics/elsewhere'
        where organization_id = $1 and slug = 'borrowed'`,
      [place.workspace.id],
    );
    const skills = await skillsOf(place);

    const runId = await run(place, { status: "coding", pin: 1 });

    // In flight, it has nothing to teach yet.
    const early = bodyOf<ErrorEnvelope>(
      await as(place)("get", `${PLAYBOOKS}/from-run/${runId}`).expect(409),
    );
    expect(early.code).toBe(PLAYBOOK_ERRORS.runNotTerminal);

    for (const [index, payload] of ["Quarantine before fixing.", "Quarantine before fixing."]
      .concat(["Run the HIL rig twice."])
      .entries()) {
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.run_controls (run_id, kind, payload, idempotency_key,
                                                  expires_at)
         values ($1, 'steer', $2, $3, now() + interval '1 hour')`,
        [runId, payload, `steer-${String(index)}`],
      );
    }
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.context_injections
              (organization_id, consumer, run_id, skill_version_ids, manifest_hash)
       values ($1, 'playbook', $2, $3::uuid[], $4)`,
      [
        place.workspace.id,
        runId,
        [skills.get("kept")?.versionId, skills.get("borrowed")?.versionId],
        HASH,
      ],
    );
    await api.sql.query(
      `update ${SCHEMA_NAME}.runs set status = 'merged', finished_at = now(), pr_number = 512,
                                         checks_passed = 14, checks_total = 14
        where id = $1`,
      [runId],
    );

    const draft = bodyOf<PlaybookDraftResource>(
      await as(place)("get", `${PLAYBOOKS}/from-run/${runId}`).expect(200),
    );

    expect(draft).toMatchObject({
      sourceRunId: runId,
      // The run's pin, not the workflow's head (v2).
      workflow: { slug: WORKFLOW, version: 1 },
      skillOverrides: {
        enable: [skills.get("borrowed")?.skillId],
        disable: [skills.get("dropped")?.skillId],
      },
      // Deduplicated, oldest first.
      contextPreset: {
        steerNotes: ["Quarantine before fixing.", "Run the HIL rig twice."],
        factIds: [],
      },
      derivedFrom: { repo: place.repo, injections: 1, steers: 3 },
    });

    const created = bodyOf<PlaybookResource>(
      await as(place)("post", `${PLAYBOOKS}/from-run`)
        .send({ runId, name: "Flaky test hunt" })
        .expect(201),
    );

    expect(created).toMatchObject({
      sourceRunId: runId,
      workflow: draft.workflow,
      skillOverrides: draft.skillOverrides,
      contextPreset: draft.contextPreset,
      description: draft.suggestedDescription,
      runCount: 0,
    });
  });

  it("derives `run N×` from the runs carrying its id — never a stored count", async () => {
    const place = await bench();
    const playbook = await authored(place);
    const countOf = async (): Promise<{ list: number; read: number; counts: number }> => ({
      list:
        bodyOf<PlaybookList>(await as(place)("get", PLAYBOOKS).expect(200)).items.find(
          (item) => item.id === playbook.id,
        )?.runCount ?? -1,
      read: bodyOf<PlaybookResource>(
        await as(place)("get", `${PLAYBOOKS}/${playbook.id}`).expect(200),
      ).runCount,
      counts:
        bodyOf<PlaybookCounts>(
          await as(place)("get", `${PLAYBOOKS}/counts`).expect(200),
        ).counts.find((count) => count.playbookId === playbook.id)?.runs ?? -1,
    });

    expect(await countOf()).toEqual({ list: 0, read: 0, counts: 0 });

    const first = await run(place, { status: "merged", pin: 1, playbookId: playbook.id });
    await run(place, { status: "coding", pin: 1, playbookId: playbook.id });
    await run(place, { status: "merged", pin: 1 });

    expect(await countOf()).toEqual({ list: 2, read: 2, counts: 2 });

    await api.sql.query(`delete from ${SCHEMA_NAME}.runs where id = $1`, [first]);

    expect(await countOf()).toEqual({ list: 1, read: 1, counts: 1 });

    // The playbook row was never written by any of it.
    const { rows } = await api.sql.query<{ updated_at: Date }>(
      `select updated_at from ${SCHEMA_NAME}.playbooks where id = $1`,
      [playbook.id],
    );
    expect(rows[0].updated_at.toISOString()).toBe(playbook.updatedAt);

    // And there is no counter column a refactor could start reading instead.
    const { rows: columns } = await api.sql.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = $1 and table_name = 'playbooks'
          and column_name ~ '(count|uses|usage|launch|runs)'`,
      [SCHEMA_NAME],
    );
    expect(columns).toEqual([]);
  });

  it("launches as the queue write under the pin, carrying its id, and the filter narrows both", async () => {
    const place = await bench();
    await seedIntake(api, place.workspace);

    const playbook = await authored(place, {
      contextPreset: { steerNotes: ["Quarantine before fixing."] },
      issueFilter: { labels: ["bug"], repos: [place.repo] },
    });
    const picker = async (): Promise<PlaybookIssueList["items"]> =>
      bodyOf<PlaybookIssueList>(
        await as(place)("get", `${PLAYBOOKS}/${playbook.id}/issues`).expect(200),
      ).items;
    const issueId = async (number: number): Promise<string> => {
      const { rows } = await api.sql.query<{ id: string }>(
        `select id from ${SCHEMA_NAME}.github_issues where organization_id = $1 and number = $2`,
        [place.workspace.id, number],
      );
      return rows[0].id;
    };

    // Open issues labelled `bug`, newest first — the enhancement, the docs and the tech-debt ones
    // are not offered.
    expect((await picker()).map((issue) => issue.number)).toEqual([491, 489, 485, 484, 483]);

    // The launch holds the same line as the picker.
    const filtered = bodyOf<ErrorEnvelope>(
      await as(place)("post", `${PLAYBOOKS}/${playbook.id}/launch`)
        .send({ issueId: await issueId(486) })
        .expect(422),
    );
    expect(filtered.code).toBe(PLAYBOOK_ERRORS.issueFiltered);

    const receipt = bodyOf<PlaybookLaunchReceipt>(
      await as(place)("post", `${PLAYBOOKS}/${playbook.id}/launch`)
        .send({ issueId: await issueId(484) })
        .expect(201),
    );
    expect(receipt).toMatchObject({
      playbookId: playbook.id,
      item: { issueNumber: 484, workflowTag: WORKFLOW, workflowVersion: 1 },
      context: { steerNotes: ["Quarantine before fixing."], factIds: [] },
    });

    // The queued row is M.3's, pinned to v1 while v2 is the head, and it carries the playbook.
    const { rows: queued } = await api.sql.query<{
      workflow_tag: string;
      workflow_version: number;
      playbook_id: string;
    }>(
      `select workflow_tag, workflow_version, playbook_id from ${SCHEMA_NAME}.queue_items
        where organization_id = $1`,
      [place.workspace.id],
    );
    expect(queued).toEqual([
      { workflow_tag: WORKFLOW, workflow_version: 1, playbook_id: playbook.id },
    ]);
    expect((await picker()).find((issue) => issue.number === 484)?.queued).toBe(true);

    // Queued once: a second launch is the queue's own refusal.
    await as(place)("post", `${PLAYBOOKS}/${playbook.id}/launch`)
      .send({ issueId: await issueId(484) })
      .expect(409);

    // Another repository admits nothing; clearing the filter admits every open issue.
    await as(place)("patch", `${PLAYBOOKS}/${playbook.id}`)
      .send({ issueFilter: { repos: ["acme-robotics/elsewhere"] } })
      .expect(200);
    expect(await picker()).toEqual([]);

    await as(place)("patch", `${PLAYBOOKS}/${playbook.id}`).send({ issueFilter: null }).expect(200);
    expect((await picker()).map((issue) => issue.number)).toEqual([
      491, 490, 489, 488, 487, 486, 485, 484, 483,
    ]);
  });
});
