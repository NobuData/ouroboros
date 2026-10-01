/**
 * **The first-run launcher's guards, certified one by one** — BB.6
 * ([#389](https://github.com/NobuData/ouroboros/issues/389)).
 *
 * *Run my first loop* composes four planes in one call — sources and tenancy (the rail), workflows
 * (the pin), intake (the queue) and policy (dry-run). `launch.integration-spec.ts` proves the
 * composition; this suite proves that **each guard in front of it is load-bearing**: one bench is
 * made ready through the wizard's own routes, one thing is taken away through the subsystem that
 * owns it, and the launch must refuse with that guard's stated reason and write nothing — no
 * queue item, no completion stamp, no dry-run policy.
 *
 * ```
 * the rail      step 1 (source paused · no longer covering)   step 2 (repository · account)
 *               step 3 (no instantiated workflow)             several → the first is named
 * the pick      none · another repository's issue · not in the synced backlog
 * the queue     its own refusals pass through: unsized · workflow archived · number taken
 * the caller    a viewer is refused; a member is not
 * ```
 *
 * A control case launches the same bench untouched, so every refusal is the guard's and not the
 * bench's.
 *
 * **Mutation checks** (run for #389) — each removal turns exactly the named fixture red:
 *   * `launch` skipping `blockingStep` → all six rail fixtures (and *launches once… put right*).
 *   * `LAST_PREREQUISITE_STEP` lowered to 2 → *step 3*.
 *   * `pick` not refusing a missing ticket → *nothing is picked*.
 *   * `pick` not refusing `issueNumber === undefined` → *another repository's issue*.
 *   * `pick` not refusing an unmirrored issue → *not in the synced backlog*.
 *   * `@Roles(...CONTRIBUTORS)` removed from the route → *refuses a viewer*.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/onboarding/launch.certification
 * ```
 */

import { SECOND_REPO, addRepo } from "../../testing/dashboard.fixture";
import { startEngineStub, type EngineStub } from "../../testing/engine.stub.fixture";
import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import type { LaunchReceiptResource } from "./launch.resources";
import {
  FIRST_ISSUE_NUMBER,
  FIRST_ISSUE_TITLE,
  NO_FOOTPRINT,
  inWorkspace,
  issueIdOf,
  launchFirstLoop,
  launchFootprint,
  mirrorTicket,
  pickIssue,
  selectTemplate,
  shipTemplates,
  wizardBench,
  wizardRoute,
  type WizardBench,
} from "./onboarding.integration.fixture";

/** One guard: what is taken away, and what the launch must then answer. */
interface GuardCase {
  /** The guard, as the action bar would explain it. */
  readonly label: string;
  /** Take one thing away from a ready bench — through the subsystem that owns it. */
  readonly arrange: (at: WizardBench) => Promise<void>;
  /** The refusal's status. */
  readonly status: 409 | 422;
  /** The refusal's envelope, as far as the guard defines it. */
  readonly refusal: (at: WizardBench) => Record<string, unknown>;
}

describe("the first-run launcher's guards", () => {
  let api: ApiHarness;
  let engine: EngineStub;

  beforeAll(async () => {
    engine = await startEngineStub();
    // A day, so the application's own sync loop cannot poll in the middle of a test.
    api = await ApiHarness.start({
      OURO_ENGINE_URL: engine.url,
      OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400",
    });
  });

  afterAll(async () => {
    await shipTemplates(api);
    await api.close();
    await engine.stop();
  });

  beforeEach(async () => {
    engine.reset();
    await shipTemplates(api);
  });

  afterEach(() => api.truncate());

  /** Run one statement on the suite's own connection. */
  async function sql(text: string, values: unknown[]): Promise<void> {
    await api.sql.query(text, values);
  }

  /**
   * A bench one press away from launching: steps 1 and 2 true, `quick-fixes` instantiated through
   * the wizard's own route, and `#488` picked the way the card picks it.
   *
   * @returns The bench.
   */
  async function ready(): Promise<WizardBench> {
    const at = await wizardBench(api);

    await selectTemplate(api, at).expect(200);
    await pickIssue(api, at).expect(200);

    return at;
  }

  /** Pick a canonical ticket directly — the wizard's other way to name a pick. */
  async function pickTicket(at: WizardBench, ticketId: string): Promise<void> {
    await inWorkspace(
      api,
      at.owner,
      at.workspace,
    )("patch", wizardRoute(at.repo))
      .send({ pickedTicketId: ticketId })
      .expect(200);
  }

  /** Step 3's reason once the workspace's `quick-fixes` workflow is no longer the template's. */
  const NOT_INSTANTIATED = "No workflow has been created from the quick-fixes template yet.";

  /** Strip the template provenance off the instantiated workflow. */
  function forgetProvenance(at: WizardBench): Promise<void> {
    return sql(
      `update ${SCHEMA_NAME}.workflows
          set template_slug = null, template_version = null where organization_id = $1`,
      [at.workspace.id],
    );
  }

  /** Pause the covering source — a teammate's click on the sources screen. */
  function pauseSource(at: WizardBench): Promise<void> {
    return sql(`update ${SCHEMA_NAME}.ticket_sources set status = 'paused' where id = $1`, [
      at.sourceId,
    ]);
  }

  /** Step 1's reason while the covering source is paused. */
  function pausedReason(at: WizardBench): string {
    return (
      `The GitHub source "GitHub · ${at.workspace.slug}" is paused, so ${at.repo} ` +
      "is not being read."
    );
  }

  /** A step-incomplete envelope for a launch — the launch is step 4. */
  function blockedBy(blockingStep: number, message: string): Record<string, unknown> {
    return {
      code: "onboarding_step_incomplete",
      message,
      details: { step: 4, blockingStep, reason: message },
    };
  }

  /** A pick-required envelope. */
  function pickRefused(message: string): Record<string, unknown> {
    return { code: "onboarding_pick_required", message, details: { step: 4, reason: message } };
  }

  const guards: GuardCase[] = [
    // ---- the rail ------------------------------------------------------------------------
    {
      label: "step 1 — the covering source was paused",
      arrange: pauseSource,
      status: 409,
      refusal: (at) => blockedBy(1, pausedReason(at)),
    },
    {
      label: "step 1 — the source no longer lists the repository",
      arrange: (at) =>
        sql(
          `update ${SCHEMA_NAME}.ticket_sources
              set config = jsonb_set(config, '{repos}', $2::jsonb) where id = $1`,
          [at.sourceId, JSON.stringify([SECOND_REPO])],
        ),
      status: 409,
      refusal: (at) =>
        blockedBy(1, `No GitHub source covers ${at.repo} yet — connect GitHub to continue.`),
    },
    {
      label: "step 2 — the repository was disabled",
      arrange: (at) =>
        sql(`update ${SCHEMA_NAME}.github_repos set enabled = false where id = $1`, [
          at.workspace.repoId,
        ]),
      status: 409,
      refusal: (at) => blockedBy(2, `${at.repo} is not enabled — enable it to continue.`),
    },
    {
      label: "step 2 — the GitHub account was disabled",
      arrange: (at) =>
        sql(`update ${SCHEMA_NAME}.github_orgs set enabled = false where organization_id = $1`, [
          at.workspace.id,
        ]),
      status: 409,
      refusal: (at) =>
        blockedBy(2, `The GitHub account ${at.workspace.slug} is not enabled for this workspace.`),
    },
    {
      label: "step 3 — no workflow instantiated from the picked template",
      arrange: forgetProvenance,
      status: 409,
      refusal: () => blockedBy(3, NOT_INSTANTIATED),
    },
    {
      label: "steps 1 and 3 both incomplete — the first is the one named",
      arrange: async (at) => {
        await forgetProvenance(at);
        await pauseSource(at);
      },
      status: 409,
      refusal: (at) => blockedBy(1, pausedReason(at)),
    },
    // ---- the pick ------------------------------------------------------------------------
    {
      label: "nothing is picked — the pick's ticket was deleted at its source",
      arrange: (at) => sql(`delete from ${SCHEMA_NAME}.tickets where id = $1`, [at.ticketId]),
      status: 409,
      refusal: () => pickRefused("No first issue has been picked yet."),
    },
    {
      label: "the pick is another repository's issue",
      arrange: async (at) => {
        await pickTicket(
          at,
          await mirrorTicket(api, at.workspace, at.sourceId, { number: 142, repo: SECOND_REPO }),
        );
      },
      status: 409,
      refusal: (at) =>
        pickRefused(`#142 is not an issue of ${at.repo}, so it cannot be its first run.`),
    },
    {
      label: "the pick is not in the repository's synced backlog",
      arrange: async (at) => {
        await pickTicket(at, await mirrorTicket(api, at.workspace, at.sourceId, { number: 999 }));
      },
      status: 409,
      refusal: (at) =>
        pickRefused(`#999 is not in ${at.repo}'s synced backlog yet, so it cannot be queued.`),
    },
    // ---- the queue's own refusals, passed through -----------------------------------------
    {
      label: "the pick has not been sized yet",
      arrange: async (at) => {
        // `#483` is the seeded backlog's one issue still being estimated.
        await mirrorTicket(api, at.workspace, at.sourceId, { number: 483 });
        await pickIssue(api, at, await issueIdOf(api, at.workspace, 483)).expect(200);
      },
      status: 422,
      refusal: () => ({ code: "queue_issues_not_queueable" }),
    },
    {
      label: "the instantiated workflow was archived",
      arrange: (at) =>
        sql(`update ${SCHEMA_NAME}.workflows set status = 'archived' where organization_id = $1`, [
          at.workspace.id,
        ]),
      status: 422,
      refusal: () => ({ code: "queue_workflow_unknown" }),
    },
    {
      label: "another repository already queued the same issue number",
      arrange: async (at) => {
        const elsewhere = await addRepo(api, at.workspace);

        await sql(
          `insert into ${SCHEMA_NAME}.queue_items
                  (organization_id, github_repo_id, issue_number, issue_title, effort,
                   workflow_tag, position)
           values ($1, $2, $3, 'Another repository''s #488', 'xs', 'quick-fixes', 1)`,
          [at.workspace.id, elsewhere, FIRST_ISSUE_NUMBER],
        );
      },
      status: 409,
      refusal: () => ({ code: "queue_issues_conflict" }),
    },
  ];

  it("launches the ready bench — every refusal below is its guard's, not the bench's", async () => {
    const at = await ready();

    const receipt = bodyOf<LaunchReceiptResource>(await launchFirstLoop(api, at).expect(200));

    expect(receipt).toMatchObject({
      outcome: "queued",
      issue: { id: at.issueId, number: FIRST_ISSUE_NUMBER, title: FIRST_ISSUE_TITLE },
      workflow: { slug: "quick-fixes", version: 1, pinReason: "explicit" },
      dryRun: { active: true },
      links: { dashboard: "/dashboard", queue: "/dashboard#dash-up-next-title", console: null },
      run: null,
      timeline: { kind: "projected" },
    });
    expect(receipt.timeline.rows.every((row) => row.kind === "projected")).toBe(true);
    // One press, three writes: the queue item, the completion stamp and the dry-run policy.
    expect(await launchFootprint(api, at.workspace.id)).toEqual({
      queued: 1,
      completed: 1,
      policies: 1,
    });
  });

  it.each(guards.map((guard) => [guard.label, guard] as const))(
    "refuses when %s, and writes nothing",
    async (_label, guard) => {
      const at = await ready();

      await guard.arrange(at);

      const before = await launchFootprint(api, at.workspace.id);
      const response = await launchFirstLoop(api, at);

      expect(response.status).toBe(guard.status);
      expect(bodyOf<ErrorEnvelope>(response)).toMatchObject(guard.refusal(at));
      // Refused before anything was written: no queue item, no stamp, no policy answered.
      expect(await launchFootprint(api, at.workspace.id)).toEqual(before);
      expect(before).toMatchObject({ completed: 0, policies: 0 });
    },
  );

  it("launches once the thing a guard named is put right", async () => {
    const at = await ready();

    await pauseSource(at);
    await launchFirstLoop(api, at).expect(409);
    await sql(`update ${SCHEMA_NAME}.ticket_sources set status = 'active' where id = $1`, [
      at.sourceId,
    ]);

    const receipt = bodyOf<LaunchReceiptResource>(await launchFirstLoop(api, at).expect(200));

    expect(receipt.outcome).toBe("queued");
    expect(receipt.onboarding.steps.map((step) => step.status)).toEqual([
      "done",
      "done",
      "done",
      "done",
    ]);
  });

  describe("the caller", () => {
    it("refuses a viewer and a stranger, and writes nothing", async () => {
      const at = await ready();
      const viewer = await api.signIn();

      await api.join(at.workspace.id, viewer, "viewer");

      await launchFirstLoop(api, at, viewer).expect(403);
      await api.anonymous("post", wizardRoute(at.repo, "/launch")).expect(401);
      expect(await launchFootprint(api, at.workspace.id)).toEqual(NO_FOOTPRINT);
    });

    it("lets a member launch what an administrator instantiated", async () => {
      const at = await ready();
      const member = await api.signIn();

      await api.join(at.workspace.id, member, "member");

      const receipt = bodyOf<LaunchReceiptResource>(
        await launchFirstLoop(api, at, member).expect(200),
      );

      expect(receipt.outcome).toBe("queued");
    });
  });

  describe("an issue the loop already has", () => {
    it("writes no queue item once a run of the pick exists, and links its console", async () => {
      const at = await ready();
      const { rows } = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.runs
                (organization_id, github_repo_id, issue_number, issue_title, workflow_tag, model,
                 status, stage_label, stage_index, stage_total, started_at)
         values ($1, $2, $3, $4, 'quick-fixes', 'claude-fable-5', 'coding', 'Code', 3, 6, now())
         returning id`,
        [at.workspace.id, at.workspace.repoId, FIRST_ISSUE_NUMBER, FIRST_ISSUE_TITLE],
      );

      const receipt = bodyOf<LaunchReceiptResource>(await launchFirstLoop(api, at).expect(200));

      expect(receipt).toMatchObject({
        outcome: "already_started",
        queue: null,
        workflow: { slug: "quick-fixes", version: null, pinReason: null },
        run: { id: rows[0].id, path: `/runs/${rows[0].id}` },
        links: { console: `/runs/${rows[0].id}` },
      });
      // The wizard is completed all the same; the queue was never written.
      expect(await launchFootprint(api, at.workspace.id)).toEqual({
        queued: 0,
        completed: 1,
        policies: 1,
      });
    });
  });
});
