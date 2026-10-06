/**
 * **Cross-organization isolation of every onboarding entity** — BB.6
 * ([#389](https://github.com/NobuData/ouroboros/issues/389)).
 *
 * The onboarding routes carry no ids: a wizard is named by `?repo=owner/name` and the workspace
 * header. So isolation here is not "another workspace's id is a 404" — it is that **two
 * workspaces mirroring the same GitHub repository share nothing**, even though every
 * `repo_ref` they store is the same string. A statement that forgot its `organization_id` would
 * pass every single-workspace suite and leak here.
 *
 * ```
 * Alice   acme-robotics/helios-firmware, fully worked: a source, two stored scans with their six
 *         rows, suggested and edited protected paths, her own template override, an instantiated
 *         workflow, a pick, a launched first loop (queue item · completion · dry-run on)
 * Bob     the same repository mirrored and its backlog synced, and one scan of his own — whose
 *         `scan_seq` is 1, as Alice's first is — and nothing else
 * ```
 *
 *   * **Every route** — enumerated from the application's route table, not sampled — answers
 *     Bob from his own workspace only, is a `404` to him under Alice's workspace header, and a
 *     `401` to a stranger.
 *   * **Every entity** — wizard state, detections, protected paths, templates, and the queue and
 *     policy the launch wrote — is absent from what Bob reads and untouched by what he writes.
 *
 * **Mutation checks** (run for #389) — the workspace predicate removed from one statement at a
 * time, each turning a case here red: `DetectionRepository.scan` (the scan, and its rows),
 * `DetectionRepository.policies`, `OnboardingRepository.state`, `.latestScan` and
 * `.instantiatedWorkflow`, and `FirstIssueRepository.protectedPaths`.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/onboarding/onboarding.isolation
 * ```
 */

import { PRIMARY_REPO, type SeededWorkspace } from "../../testing/dashboard.fixture";
import { startEngineStub, type EngineStub } from "../../testing/engine.stub.fixture";
import { ApiHarness, type Method, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { seedIntake } from "../../testing/intake.fixture";
import { routeTable } from "../auth/route.table.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { EMPTY, ZEPHYR, fixtureProber, type FixtureRepo } from "../detection/detection.fixture";
import { DetectionRepository } from "../detection/detection.repository";
import type { DetectionResource } from "../detection/detection.resources";
import { runScan } from "../detection/detection.scan";
import { CORE_PACKS } from "../detection/packs/core.packs";
import type { ErrorEnvelope } from "../errors/error.envelope";
import type { DryRunPolicyResource } from "../policies/org-policy.service";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { SmartDefaultsResource } from "./defaults.resources";
import type { FirstIssueAlternativesResource, FirstIssueResource } from "./first-issue.resources";
import {
  FIRST_ISSUE_NUMBER,
  connectGithub,
  inWorkspace,
  issueIdOf,
  launchFirstLoop,
  mirrorTicket,
  pickIssue,
  selectTemplate,
  shipTemplates,
  wizardRoute,
  type WizardBench,
} from "./onboarding.integration.fixture";
import type { OnboardingResource, OnboardingSkipResource } from "./resources";
import type { TemplateSelectionResource, TemplateTilesResource } from "./templates.resources";

/** The GitHub account both workspaces mirror. */
const ACCOUNT = "acme-robotics";

/** The repository both wizards are for — one string, stored by both workspaces. */
const REPO = `${ACCOUNT}/${PRIMARY_REPO}`;

/** The protected path Alice edited in. It covers a file `#491`'s estimate names. */
const ALICE_PROTECTED = "src/config/**";

/** The caption on Alice's own override of the Docs & chores tile. */
const ALICE_CAPTION = "our house default";

/** One onboarding route: its tail under `/api/v1/onboarding`, and the body a write sends. */
interface RouteCase {
  readonly tail: string;
  readonly body?: object;
}

/** Every onboarding route, by the signature the route table prints. */
const CASES: Readonly<Record<string, RouteCase>> = {
  "GET /api/v1/onboarding": { tail: "" },
  "PATCH /api/v1/onboarding": { tail: "", body: { dismissed: true } },
  "POST /api/v1/onboarding/complete-step": { tail: "/complete-step", body: { step: 1 } },
  "POST /api/v1/onboarding/skip": { tail: "/skip" },
  "GET /api/v1/onboarding/templates": { tail: "/templates" },
  "POST /api/v1/onboarding/select-template": {
    tail: "/select-template",
    body: { slug: "feature-builder" },
  },
  "GET /api/v1/onboarding/first-issue": { tail: "/first-issue" },
  "GET /api/v1/onboarding/first-issue/alternatives": { tail: "/first-issue/alternatives" },
  "GET /api/v1/onboarding/defaults": { tail: "/defaults" },
  "POST /api/v1/onboarding/launch": { tail: "/launch" },
  "GET /api/v1/onboarding/detection": { tail: "/detection" },
  "GET /api/v1/onboarding/detection/scans/:scanSeq": { tail: "/detection/scans/1" },
  "POST /api/v1/onboarding/detection/scan": { tail: "/detection/scan" },
  "PUT /api/v1/onboarding/detection/protected-paths": {
    tail: "/detection/protected-paths",
    body: { globs: ["boot/**"] },
  },
  "GET /api/v1/onboarding/surfacing": { tail: "/surfacing" },
};

/** A route's verb, ready to send. */
function methodOf(signature: string): Method {
  return signature.slice(0, signature.indexOf(" ")).toLowerCase() as Method;
}

describe("onboarding isolation: two workspaces, one repository, nothing shared", () => {
  let api: ApiHarness;
  let engine: EngineStub;
  let alice: WizardBench;
  let bob: { owner: Person; workspace: SeededWorkspace; issueId: string };
  /** Alice's rows as her launch left them — what nothing Bob does may change. */
  let aliceBefore: unknown;

  /**
   * A workspace mirroring `acme-robotics/helios-firmware`, enabled, with mockup 03's backlog.
   *
   * @param owner - Its owner.
   * @returns The workspace.
   */
  async function mirroring(owner: Person): Promise<SeededWorkspace> {
    const workspace = await api.workspace(owner);
    const { rows: accounts } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_orgs (organization_id, login, enabled)
       values ($1, $2, true) returning id`,
      [workspace.id, ACCOUNT],
    );
    const { rows: repos } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_repos (org_id, name, enabled)
       values ($1, $2, true) returning id`,
      [accounts[0].id, PRIMARY_REPO],
    );
    const seeded = { id: workspace.id, slug: workspace.slug, repoId: repos[0].id };

    await seedIntake(api, seeded);

    return seeded;
  }

  /**
   * Store a scan of a tree for the shared repository — the rule packs' own rows, written by the
   * detection repository as a real scan writes them.
   *
   * @param workspace - Whose scan it is.
   * @param tree - What the scan found.
   */
  async function storeScan(workspace: SeededWorkspace, tree: FixtureRepo): Promise<void> {
    const scanned = await runScan(CORE_PACKS, fixtureProber(tree).prober);

    await api.nest.get(DetectionRepository).recordScan({
      organizationId: workspace.id,
      repo: REPO,
      durationMs: scanned.durationMs,
      packVersions: scanned.packVersions,
      probesUsed: scanned.probesUsed,
      rows: scanned.rows,
      protectedPaths: scanned.protectedPaths,
    });
  }

  /**
   * Every onboarding entity a workspace holds, as one comparable value.
   *
   * @param organizationId - The workspace.
   * @returns Its wizard rows, scans, detections, protected paths, template overrides, workflows,
   *   queue and policy.
   */
  async function entities(organizationId: string): Promise<unknown> {
    const { rows } = await api.sql.query(
      `select
         (select jsonb_agg(to_jsonb(s) order by s.repo_ref)
            from ${SCHEMA_NAME}.onboarding_state s where s.organization_id = $1) as wizard,
         (select jsonb_agg(to_jsonb(c) order by c.scan_seq)
            from ${SCHEMA_NAME}.repo_detection_scans c where c.organization_id = $1) as scans,
         (select jsonb_agg(to_jsonb(d) order by d.scan_seq, d.row_key)
            from ${SCHEMA_NAME}.repo_detections d where d.organization_id = $1) as detections,
         (select jsonb_agg(to_jsonb(p) order by p.path_glob)
            from ${SCHEMA_NAME}.protected_path_policies p where p.organization_id = $1) as paths,
         (select jsonb_agg(to_jsonb(t) order by t.slug, t.version)
            from ${SCHEMA_NAME}.workflow_templates t where t.organization_id = $1) as templates,
         (select jsonb_agg(to_jsonb(w) order by w.slug)
            from ${SCHEMA_NAME}.workflows w where w.organization_id = $1) as workflows,
         (select jsonb_agg(to_jsonb(q) order by q.position)
            from ${SCHEMA_NAME}.queue_items q where q.organization_id = $1) as queue,
         (select jsonb_agg(to_jsonb(o))
            from ${SCHEMA_NAME}.org_policies o where o.organization_id = $1) as policies`,
      [organizationId],
    );

    return rows[0];
  }

  /** A `GET` of an onboarding route for the shared repository, as Bob in his own workspace. */
  async function bobReads<T>(tail: string): Promise<T> {
    const response = await inWorkspace(
      api,
      bob.owner,
      bob.workspace,
    )("get", wizardRoute(REPO, tail)).expect(200);

    return bodyOf<T>(response);
  }

  /** A request as Bob in his own workspace, status left to the caller. */
  function bobSends(method: Method, tail: string) {
    return inWorkspace(api, bob.owner, bob.workspace)(method, wizardRoute(REPO, tail));
  }

  beforeAll(async () => {
    engine = await startEngineStub();
    // A day, so the application's own sync loop cannot poll in the middle of a test.
    api = await ApiHarness.start({
      OURO_ENGINE_URL: engine.url,
      OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400",
    });
    await shipTemplates(api);

    // ---- Alice: the repository, fully worked --------------------------------------------
    const aliceOwner = await api.signIn();
    const aliceSpace = await mirroring(aliceOwner);
    const sourceId = await connectGithub(api, aliceSpace, { login: ACCOUNT });

    alice = {
      owner: aliceOwner,
      workspace: aliceSpace,
      repo: REPO,
      sourceId,
      ticketId: await mirrorTicket(api, aliceSpace, sourceId, {
        number: FIRST_ISSUE_NUMBER,
        owner: ACCOUNT,
      }),
      issueId: await issueIdOf(api, aliceSpace, FIRST_ISSUE_NUMBER),
    };

    // Two scans, so her newest is scan 2 where Bob's is scan 1.
    await storeScan(aliceSpace, ZEPHYR);
    await storeScan(aliceSpace, ZEPHYR);
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.protected_path_policies
              (organization_id, repo_ref, path_glob, source)
       values ($1, $2, $3, 'edited')`,
      [aliceSpace.id, REPO, ALICE_PROTECTED],
    );
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.workflow_templates
              (organization_id, slug, version, name, description, stage_dots, effort_range,
               caption, definition, tier, unlock_rule, sort_order)
       select $1, slug, 1, name, description, stage_dots, effort_range, $2, definition, tier,
              unlock_rule, sort_order
         from ${SCHEMA_NAME}.workflow_templates
        where organization_id is null and slug = 'docs-chores'`,
      [aliceSpace.id, ALICE_CAPTION],
    );
    await selectTemplate(api, alice).expect(200);
    await pickIssue(api, alice).expect(200);
    await launchFirstLoop(api, alice).expect(200);

    // ---- Bob: the same repository mirrored, and nothing else ------------------------------
    const bobOwner = await api.signIn();
    const bobSpace = await mirroring(bobOwner);

    // His own scan of the same reference found an empty repository: six `missing` rows.
    await storeScan(bobSpace, EMPTY);
    bob = {
      owner: bobOwner,
      workspace: bobSpace,
      issueId: await issueIdOf(api, bobSpace, FIRST_ISSUE_NUMBER),
    };
    aliceBefore = await entities(aliceSpace.id);
  });

  afterAll(async () => {
    await api.truncate();
    await shipTemplates(api);
    await api.close();
    await engine.stop();
  });

  describe("the scene", () => {
    it("has Alice holding every onboarding entity, for the repository Bob also mirrors", () => {
      expect(aliceBefore).toMatchObject({
        wizard: [{ repo_ref: REPO, selected_template: "quick-fixes" }],
        scans: [
          { repo_ref: REPO, scan_seq: 1 },
          { repo_ref: REPO, scan_seq: 2 },
        ],
        paths: [{ path_glob: "boot/**" }, { path_glob: "keys/**" }, { path_glob: ALICE_PROTECTED }],
        templates: [{ slug: "docs-chores", caption: ALICE_CAPTION }],
        workflows: [{ slug: "quick-fixes", template_slug: "quick-fixes" }],
        queue: [{ issue_number: FIRST_ISSUE_NUMBER }],
        policies: [{ dry_run: true }],
      });
      expect((aliceBefore as { detections: unknown[] }).detections).toHaveLength(12);
    });

    it("has a case for every onboarding route — enumerated, not sampled", () => {
      const routes = routeTable(api.nest)
        .map((route) => route.signature)
        .filter((signature) => / \/api\/v1\/onboarding(\/|$)/.test(signature));

      expect(routes.sort()).toEqual(Object.keys(CASES).sort());
    });
  });

  describe("what Bob reads of the same repository", () => {
    it("reads his own wizard: no choice, no completion, and his own scan — not Alice's newer one", async () => {
      const wizard = await bobReads<OnboardingResource>("");

      expect(wizard.choices).toEqual({
        selectedTemplate: null,
        pickedTicketId: null,
        dismissed: false,
        completedAt: null,
        bypassedAt: null,
      });
      // Alice's source covers this very repository; it is not Bob's. Only his own mirror —
      // step 2 — is done.
      expect(wizard.steps.map((step) => step.status)).toEqual(["todo", "done", "todo", "todo"]);
      expect(wizard.steps[0].reason).toBe(
        `No GitHub source covers ${REPO} yet — connect GitHub to continue.`,
      );
      // Alice's newest scan is scan 2 of the same reference.
      expect(wizard.refs.detectionScan?.scanSeq).toBe(1);
      expect(wizard.refs.pickedTicket).toBeNull();
      expect(wizard.surfacing).toEqual({ offer: true, reason: "fresh_organization" });
    });

    it("reads his own detection: none of Alice's rows, scans or protected paths", async () => {
      const card = await bobReads<DetectionResource>("/detection");
      const first = bodyOf<DetectionResource>(
        await bobSends("get", "/detection/scans/1").expect(200),
      );

      // Scan 1 of this very reference exists in both workspaces. His found an empty repository.
      expect(card.scan?.scanSeq).toBe(1);
      expect(card.rows.map((row) => [row.rowKey, row.verdict])).toEqual([
        ["language", "missing"],
        ["build", "missing"],
        ["devcontainer", "missing"],
        ["tests", "missing"],
        ["protected_paths", "missing"],
        ["conventions", "missing"],
      ]);
      expect(first.rows).toEqual(card.rows);
      // Alice's three protected paths are for the same reference, and are not his.
      expect(card.protectedPaths).toEqual([]);

      // Alice has a scan 2; he does not.
      const second = await bobSends("get", "/detection/scans/2").expect(404);

      expect(bodyOf<ErrorEnvelope>(second).code).toBe("detection_scan_not_found");
    });

    it("reads the shipped tiles: not Alice's override, not her workflow, not her selection", async () => {
      const tiles = await bobReads<TemplateTilesResource>("/templates");

      expect(tiles.selectedTemplate).toBeNull();
      expect(tiles.tiles.map((tile) => [tile.scope, tile.selected, tile.workflow])).toEqual([
        ["global", false, null],
        ["global", false, null],
        ["global", false, null],
        ["global", false, null],
      ]);
      expect(JSON.stringify(tiles)).not.toContain(ALICE_CAPTION);
    });

    it("is not disqualified by another workspace's protected path, and is offered his own issue", async () => {
      const card = await bobReads<FirstIssueResource>("/first-issue");
      const alternatives = await bobReads<FirstIssueAlternativesResource>(
        "/first-issue/alternatives",
      );

      expect(card.pick).toMatchObject({ number: FIRST_ISSUE_NUMBER, issueId: bob.issueId });
      expect(card.pick?.issueId).not.toBe(alice.issueId);
      // Alice protects src/config/**, which #491 touches: in her ranking it is gone…
      expect(card.excluded.protectedPath).toBe(0);
      expect(alternatives.candidates.map((candidate) => candidate.number)).toContain(491);

      const hers = bodyOf<FirstIssueAlternativesResource>(
        await inWorkspace(
          api,
          alice.owner,
          alice.workspace,
        )("get", wizardRoute(REPO, "/first-issue/alternatives")).expect(200),
      );

      // …and only in hers.
      expect(hers.excluded.protectedPath).toBe(1);
      expect(hers.candidates.map((candidate) => candidate.number)).not.toContain(491);
    });

    it("reads defaults that know nothing of Alice's pick, source or dry-run policy", async () => {
      const defaults = await bobReads<SmartDefaultsResource>("/defaults");
      const policy = bodyOf<DryRunPolicyResource>(
        await inWorkspace(
          api,
          bob.owner,
          bob.workspace,
        )("get", "/api/v1/policies/dry-run").expect(200),
      );

      expect(policy).toMatchObject({ dryRun: false, explicit: false });
      expect(JSON.stringify(defaults.timeline)).not.toContain("#488");
      // No source of his own: no pause claim, though Alice's source covers the repository.
      expect(defaults.reassure.claims.map((claim) => claim.key)).toEqual(["draft_only", "vault"]);
    });

    it("never carries one of Alice's ids in any payload", async () => {
      const payloads = await Promise.all(
        Object.entries(CASES)
          .filter(
            ([signature, entry]) =>
              methodOf(signature) === "get" && !entry.tail.includes("/scans/"),
          )
          .map(([, entry]) => bobReads<unknown>(entry.tail)),
      );
      const text = JSON.stringify(payloads);

      for (const id of [alice.workspace.id, alice.sourceId, alice.ticketId, alice.issueId]) {
        expect(text).not.toContain(id);
      }
    });
  });

  describe("every route, under Alice's workspace header", () => {
    it.each(Object.keys(CASES))("%s is a 404 to Bob and a 401 to a stranger", async (signature) => {
      const entry = CASES[signature];
      const method = methodOf(signature);
      const path = wizardRoute(REPO, entry.tail);

      // The route is real: Alice reads her own.
      if (method === "get") {
        await inWorkspace(api, alice.owner, alice.workspace)("get", path).expect(200);
      }

      const refused = await api
        .as(bob.owner)(method, path)
        .set(TENANT_HEADER, alice.workspace.slug)
        .send(entry.body ?? {})
        .expect(404);

      expect(bodyOf<ErrorEnvelope>(refused).code).toBe("tenant_not_found");
      await api
        .anonymous(method, path)
        .send(entry.body ?? {})
        .expect(401);
    });
  });

  describe("what Bob writes", () => {
    it("cannot pick Alice's ticket or her issue, by id", async () => {
      const byTicket = await bobSends("patch", "")
        .send({ pickedTicketId: alice.ticketId })
        .expect(404);
      const byIssue = await bobSends("patch", "")
        .send({ pickedIssueId: alice.issueId })
        .expect(404);

      expect(bodyOf<ErrorEnvelope>(byTicket).code).toBe("onboarding_ticket_not_found");
      expect(bodyOf<ErrorEnvelope>(byIssue).code).toBe("onboarding_issue_not_found");
    });

    it("cannot borrow Alice's ticket for his own copy of the same issue", async () => {
      // Same account, same repository, same number — and a canonical ticket only in Alice's workspace.
      const refused = await bobSends("patch", "").send({ pickedIssueId: bob.issueId }).expect(422);

      expect(bodyOf<ErrorEnvelope>(refused).code).toBe("onboarding_issue_ticket_missing");
    });

    it("is not credited with Alice's workflow when he picks the template she instantiated", async () => {
      const wizard = bodyOf<OnboardingResource>(
        await bobSends("patch", "").send({ selectedTemplate: "quick-fixes" }).expect(200),
      );

      // She has a workflow from this template; his step 3 still waits for one of his own.
      expect(wizard.steps[2]).toMatchObject({
        status: "todo",
        reason: "No workflow has been created from the quick-fixes template yet.",
      });
    });

    it("cannot complete, launch or scan on the strength of Alice's finished wizard", async () => {
      const completed = await bobSends("post", "/complete-step").send({ step: 4 }).expect(409);
      const launched = await bobSends("post", "/launch").expect(409);
      const scanned = await bobSends("post", "/detection/scan").expect(409);

      expect(bodyOf<ErrorEnvelope>(completed)).toMatchObject({
        code: "onboarding_step_incomplete",
        details: { blockingStep: 1 },
      });
      expect(bodyOf<ErrorEnvelope>(launched).code).toBe("onboarding_step_incomplete");
      // Alice's source covers the repository; a scan of Bob's cannot ride it.
      expect(bodyOf<ErrorEnvelope>(scanned).code).toBe("detection_source_missing");
    });

    it("writes his own choices, bypass and workflow — in his own workspace", async () => {
      await bobSends("patch", "").send({ dismissed: true }).expect(200);

      const skipped = bodyOf<OnboardingSkipResource>(await bobSends("post", "/skip").expect(200));
      const selection = bodyOf<TemplateSelectionResource>(
        await bobSends("post", "/select-template").send({ slug: "feature-builder" }).expect(200),
      );

      expect(skipped.onboarding.choices.bypassedAt).not.toBeNull();
      // His first workflow: Alice's `quick-fixes` is not one he is keeping.
      expect(selection).toMatchObject({
        created: true,
        workflow: { slug: "feature-builder" },
        kept: [],
      });
      expect(await entities(bob.workspace.id)).toMatchObject({
        wizard: [{ repo_ref: REPO, selected_template: "feature-builder", dismissed: true }],
        workflows: [{ slug: "feature-builder" }],
        scans: [{ scan_seq: 1 }],
        paths: null,
        templates: null,
        queue: null,
        policies: null,
      });
    });
  });

  describe("Bob's protected paths (#391)", () => {
    it("saves his own list for the same repository, leaving Alice's edited glob where it is", async () => {
      const saved = bodyOf<DetectionResource>(
        await bobSends("put", "/detection/protected-paths")
          .send({ globs: ["docs/**"] })
          .expect(200),
      );

      expect(saved.protectedPaths).toEqual([{ glob: "docs/**", source: "edited" }]);
      expect(JSON.stringify(saved)).not.toContain(ALICE_PROTECTED);
      expect(await entities(bob.workspace.id)).toMatchObject({
        paths: [{ path_glob: "docs/**", source: "edited" }],
      });
    });
  });

  describe("afterwards", () => {
    it("has left every one of Alice's entities exactly as her launch left them", async () => {
      expect(await entities(alice.workspace.id)).toEqual(aliceBefore);
    });

    it("still reads Alice her own finished wizard", async () => {
      const wizard = bodyOf<OnboardingResource>(
        await inWorkspace(api, alice.owner, alice.workspace)("get", wizardRoute(REPO)).expect(200),
      );

      expect(wizard.steps.map((step) => step.status)).toEqual(["done", "done", "done", "done"]);
      expect(wizard.choices).toMatchObject({ selectedTemplate: "quick-fixes", dismissed: false });
      expect(wizard.choices.bypassedAt).toBeNull();
    });
  });
});
