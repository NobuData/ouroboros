import type { INestApplication } from "@nestjs/common";
import type request from "supertest";

import { API_BASE_PATH } from "../../application";
import { workspaceWithRepo } from "../../testing/dashboard.fixture";
import { startEngineStub, type EngineStub } from "../../testing/engine.stub.fixture";
import { ApiHarness, type Method, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { routeTable } from "../auth/route.table.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { sourceMissing, DETECTION_ERRORS } from "../detection/detection.errors";
import type { DetectionResource } from "../detection/detection.resources";
import { DetectionService } from "../detection/detection.service";
import type { ErrorEnvelope } from "../errors/error.envelope";
import type { BackfillResource, SuppressionList } from "../fact-proposers/proposers.resources";
import type { FactDetail, FactList, FactNeedsYou } from "../facts/facts.resources";
import type { SweepReport } from "../facts/facts.sweep";
import { CLAUDE_MD } from "../knowledge-import/rule-import.fixture";
import type {
  RuleImportPreview,
  RuleImportResult,
} from "../knowledge-import/rule-import.resources";
import type {
  PlaybookContextResource,
  PlaybookCounts,
  PlaybookIssueList,
  PlaybookList,
  PlaybookResource,
} from "../playbooks/playbooks.resources";
import type { RepoMapReport } from "../repo-map/repo-map.resources";
import type { SkillDetail, SkillList, SkillStats } from "../skills/skills.resources";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { RepoFile, RepoTree } from "../ticket-sources/ticket-source.probe";
import type { WorkflowDetail } from "../workflows/workflows.resources";
import type { ContextManifest } from "./context-assembly.resources";

/**
 * **Organization isolation, on every knowledge route — enumerated, not sampled.**
 *
 * BF.7 ([#416](https://github.com/NobuData/ouroboros/issues/416)), the issue's *Isolation* row:
 * *every knowledge entity unreachable across orgs, including via manifests and previews* — and the
 * criterion that names them: skills, facts, playbooks (the card calls them recipes), manifests and
 * previews. Each of BF.1–BF.6 checked a route or two of its own; nothing walked the *registered*
 * knowledge surface, so a route added tomorrow would be covered by no isolation claim at all. This
 * file is `farm.isolation.integration-spec.ts`'s trick asked of a different plane: {@link CASES} is
 * compared against what the router registered under `/skills`, `/facts`, `/fact-proposers` and
 * `/knowledge`, and a knowledge route with no claim fails the first test rather than going unseen.
 *
 * The caller is always the more dangerous of the two strangers — a signed-in **owner** of another
 * workspace, whom every role gate lets through — aiming the route at this workspace's things.
 *
 * ---------------------------------------------------------------------------
 * **Four kinds of claim:**
 *
 *   * **Addressed** — the route names a thing (a slug, an id, a run, a repository). Aimed at the
 *     other workspace's thing it is refused, and the last case checks *nothing changed*: a route
 *     that answered `404` after writing would satisfy a suite that only read the status.
 *   * **Collections** — the route names nothing; its answer holds nothing of the other workspace.
 *   * **References** — a body names the other workspace's ids (a playbook's overrides and preset,
 *     a skill's workflow, an injection record's versions and facts). V071/V072's triggers refuse
 *     them, and the resolver treats an override it did not resolve as `not_resolved`.
 *   * **Manifests and previews** — assembled in B for B's scope, they carry none of A's skill
 *     versions or facts, even when an override names them.
 *
 * ---------------------------------------------------------------------------
 * **The repository reads are stubbed at `DetectionService`**, the one seam the rule-file import and
 * the repo-map generator read through. The stub answers only for the workspace that connected the
 * repository and says `detection_source_missing` to anyone else — exactly what the real prober says
 * when no source of *that* workspace covers the repository. What it proves is that the import and
 * the generator ask with the caller's workspace, never the repository's owner's.
 *
 * **The two workspaces are built once**: every case asserts a refusal or an absence, and the few
 * that write (B's own fact, skill and scope preview) write into B.
 */

/** The knowledge plane's routes, from the origin root. */
const SKILLS = `${API_BASE_PATH}/skills`;
const FACTS = `${API_BASE_PATH}/facts`;
const PROPOSERS = `${API_BASE_PATH}/fact-proposers`;
const KNOWLEDGE = `${API_BASE_PATH}/knowledge`;
const CONTEXT = `${KNOWLEDGE}/context`;
const PLAYBOOKS = `${KNOWLEDGE}/playbooks`;
const WORKFLOWS = `${API_BASE_PATH}/workflows`;

/** A sha256 that no manifest or preview has. */
const NO_HASH = "0".repeat(64);

/** One workspace, populated with one of every knowledge entity a route can be aimed at. */
interface Tenant {
  readonly owner: Person;
  readonly id: string;
  readonly slug: string;
  /** `owner/name` of its connected repository. */
  readonly repo: string;
  /** A published, org-scoped skill. */
  readonly skillSlug: string;
  readonly skillId: string;
  /** The skill's v1, as the manifest names it. */
  readonly skillVersionId: string;
  /** A confirmed fact about the repository, anchored. */
  readonly factId: string;
  readonly anchorId: string;
  /** A published workflow the playbook pins. */
  readonly workflowSlug: string;
  readonly workflowId: string;
  /** A playbook — mockup 14's *recipe*. */
  readonly playbookId: string;
  readonly runId: string;
  readonly issueId: string;
  /** The facts the steer proposer proposed from the run, and what it suppressed. */
  readonly proposedFactId: string;
  readonly suppressionId: string;
  /** What the rule-file import wrote. */
  readonly imported: RuleImportResult["created"];
  /** The skill the repo-map generator published — `repo-map` in every workspace, so by id. */
  readonly repoMapSlug: string;
  readonly repoMapSkillId: string;
  /** The preview's manifest, assembled for the repository. */
  readonly manifest: ContextManifest;
  readonly previewFingerprint: string;
}

/**
 * What one route's isolation claim is, and how to ask it. `about` is printed beside the signature.
 */
interface IsolationCase {
  readonly about: string;
  readonly check: (mine: Tenant, theirs: Tenant) => Promise<void>;
}

/**
 * `DetectionService`'s two repository reads, answering only for the workspace that connected the
 * repository — the rest of the service is not reached by the knowledge plane.
 */
class ConnectedRepos {
  /** `<organizationId>|<repo>` for every connected pair. */
  private readonly connected = new Set<string>();

  /**
   * @param organizationId - The workspace.
   * @param repo - `owner/name`.
   */
  connect(organizationId: string, repo: string): void {
    this.connected.add(`${organizationId}|${repo.toLowerCase()}`);
  }

  /**
   * @param organizationId - The workspace asking.
   * @param repo - The repository.
   * @throws {ConflictError} `detection_source_missing` when that workspace did not connect it.
   */
  private require(organizationId: string, repo: string): void {
    if (!this.connected.has(`${organizationId}|${repo.toLowerCase()}`)) throw sourceMissing(repo);
  }

  /** `DetectionService.readFiles` — a `CLAUDE.md`, and nothing else. */
  readonly readFiles = (
    organizationId: string,
    repo: string,
    paths: readonly string[],
  ): Promise<Map<string, RepoFile | null>> => {
    this.require(organizationId, repo);

    return Promise.resolve(
      new Map(
        paths.map((path) => [
          path,
          path === "CLAUDE.md" ? { path, content: CLAUDE_MD, size: CLAUDE_MD.length } : null,
        ]),
      ),
    );
  };

  /** `DetectionService.readTree` — a two-module tree with no CODEOWNERS. */
  readonly readTree = (
    organizationId: string,
    repo: string,
    pick: (tree: RepoTree) => readonly string[],
  ): Promise<{ tree: RepoTree; files: Map<string, RepoFile | null> }> => {
    this.require(organizationId, repo);

    const tree: RepoTree = {
      truncated: false,
      entries: [
        { path: "drivers", type: "dir" },
        { path: "drivers/can.c", type: "file" },
        { path: "boards", type: "dir" },
        { path: "boards/helios.dts", type: "file" },
      ],
    };

    return Promise.resolve({ tree, files: new Map(pick(tree).map((path) => [path, null])) });
  };

  /** `DetectionService.read` — never scanned. */
  readonly read = (_organizationId: string, repo: string): Promise<DetectionResource> =>
    Promise.resolve({ repo, scan: null, rows: [], protectedPaths: [], progress: null });
}

/**
 * A skill document.
 *
 * @param name - The frontmatter's name.
 * @returns The file.
 */
function doc(name: string): string {
  return `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\nAlways ${name}.`;
}

/**
 * Assert a refusal and return its envelope.
 *
 * @param response - What the route answered.
 * @param status - The status it must be.
 * @returns The envelope.
 */
function refused(response: request.Response, status: number): ErrorEnvelope {
  expect({ status: response.status, body: response.body as unknown }).toMatchObject({ status });

  return bodyOf<ErrorEnvelope>(response);
}

/**
 * A body as text — what "holds nothing of theirs" is checked against.
 *
 * @param body - A response body.
 * @returns Its JSON.
 */
function textOf(body: unknown): string {
  return JSON.stringify(body);
}

/**
 * Assert a body names none of a tenant's knowledge.
 *
 * @param body - A response body.
 * @param other - The workspace it must not mention.
 */
function holdsNothingOf(body: unknown, other: Tenant): void {
  const text = textOf(body);
  const ids = [
    other.skillId,
    other.skillVersionId,
    other.factId,
    other.anchorId,
    other.playbookId,
    other.workflowId,
    other.runId,
    other.issueId,
    other.proposedFactId,
    other.suppressionId,
    other.repoMapSkillId,
    ...other.imported.facts.map((fact) => fact.id),
  ];

  for (const id of ids) expect(text).not.toContain(id);
  for (const slug of [other.skillSlug, other.workflowSlug, other.repo]) {
    expect(text).not.toContain(slug);
  }
}

/**
 * Every knowledge route the application registered.
 *
 * @param app - The application.
 * @returns Their signatures, sorted.
 */
function knowledgeRoutes(app: INestApplication): string[] {
  return routeTable(app)
    .filter((route) =>
      [SKILLS, FACTS, PROPOSERS, KNOWLEDGE].some(
        (prefix) => route.path === prefix || route.path.startsWith(`${prefix}/`),
      ),
    )
    .map((route) => route.signature)
    .sort();
}

describe("organization isolation, on every knowledge route", () => {
  let api: ApiHarness;
  let engine: EngineStub;
  const repos = new ConnectedRepos();
  let mine: Tenant;
  let theirs: Tenant;

  /**
   * A request as a tenant's owner, in that tenant's workspace.
   *
   * @param tenant - Who is asking, and where.
   * @returns The request builder.
   */
  function as(tenant: Pick<Tenant, "owner" | "slug">) {
    return (method: Method, path: string): request.Test =>
      api.as(tenant.owner)(method, path).set(TENANT_HEADER, tenant.slug);
  }

  /**
   * Populate a workspace with one of everything: a published skill, a confirmed anchored fact, a
   * published workflow, a playbook pinning it and naming both, a run with two remembered steers
   * (one proposed, one suppressed), an issue, a rule-file import, a repo-map and a preview.
   *
   * @param tag - Distinguishes the two workspaces' people and names.
   * @returns The tenant.
   */
  async function populate(tag: string): Promise<Tenant> {
    const owner = await api.signIn({ email: `owner-${tag}@ouroboros.invalid` });
    const workspace = await workspaceWithRepo(api, owner);
    const repo = `${workspace.slug}/helios-firmware`.toLowerCase();
    const call = as({ owner, slug: workspace.slug });

    repos.connect(workspace.id, repo);

    // A published skill.
    const skillSlug = `${tag}-zephyr-conventions`;
    await call("post", SKILLS)
      .send({ text: doc(skillSlug) })
      .expect(201);
    await call("post", `${SKILLS}/${skillSlug}/publish`).send({}).expect(200);
    const skill = bodyOf<SkillDetail>(await call("get", `${SKILLS}/${skillSlug}`).expect(200));

    // A confirmed, anchored fact about the repository.
    const proposal = bodyOf<FactDetail>(
      await call("post", FACTS)
        .send({ text: `${tag}: west update before the first build`, repoRef: repo })
        .expect(201),
    );
    await call("post", `${FACTS}/${proposal.id}/confirm`).send({}).expect(200);
    const anchored = bodyOf<FactDetail>(
      await call("post", `${FACTS}/${proposal.id}/anchors`)
        .send({ kind: "path_glob", value: "west.yml" })
        .expect(201),
    );

    // A published workflow, straight into the table: the pin is what is under test, not the gate.
    const workflow = bodyOf<WorkflowDetail>(
      await call("post", WORKFLOWS)
        .send({ name: `${tag} loop` })
        .expect(201),
    );
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.workflow_versions (workflow_id, version, definition, published_at)
       values ($1, 1, $2, now())`,
      [
        workflow.id,
        JSON.stringify({
          nodes: [{ id: "design", type: "llm", config: { mode: "skill", skill: skillSlug } }],
        }),
      ],
    );
    await api.sql.query(`update ${SCHEMA_NAME}.workflows set current_version = 1 where id = $1`, [
      workflow.id,
    ]);

    // A recipe naming the skill and the fact.
    const playbook = bodyOf<PlaybookResource>(
      await call("post", PLAYBOOKS)
        .send({
          name: `${tag} bring-up`,
          description: "Board bring-up.",
          workflow: workflow.slug,
          workflowVersion: 1,
          skillOverrides: { disable: [skill.skill.id] },
          contextPreset: { factIds: [proposal.id], steerNotes: ["Check the overlay first."] },
        })
        .expect(201),
    );

    // A run, two remembered steers of the same text, and an issue.
    const { rows: runs } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.runs (organization_id, github_repo_id, issue_number, issue_title,
                                         workflow_tag, model, status, stage_label, stage_index,
                                         stage_total, started_at)
       values ($1, $2, 482, 'Fix flaky CAN-bus telemetry test', $3, 'claude-fable-5',
               'building', 'Build farm', 5, 6, now() - interval '1 hour')
       returning id`,
      [workspace.id, workspace.repoId, workflow.slug],
    );
    const runId = runs[0].id;
    for (const minutes of [30, 20]) {
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.run_controls (run_id, kind, payload, remember, requested_at,
                                                   expires_at)
         values ($1, 'steer', $2, true, now() - make_interval(mins => $3::int),
                 now() + interval '1 hour')`,
        [runId, `Always flash the ${tag} board with \`west flash --runner jlink\`.`, minutes],
      );
    }
    const backfill = bodyOf<BackfillResource>(
      await call("post", `${PROPOSERS}/backfill`).send({ runId }).expect(200),
    );
    expect(backfill.counts).toMatchObject({ proposed: 1, suppressed: 1 });
    const suppressions = bodyOf<SuppressionList>(
      await call("get", `${PROPOSERS}/suppressions`).expect(200),
    );
    const proposedFactId = backfill.outcomes.flatMap((outcome) =>
      outcome.outcome === "proposed" ? [outcome.factId] : [],
    )[0];

    const { rows: issues } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_issues
              (organization_id, github_repo_id, number, title, body, state, labels, author_login,
               gh_created_at, gh_updated_at, gh_url, synced_at)
       values ($1, $2, 485, $3, 'body', 'open', '[]'::jsonb, 'ken', now(), now(),
               'https://github.com/acme-robotics/helios-firmware/issues/485', now())
       returning id`,
      [workspace.id, workspace.repoId, `${tag} flaky I2C test`],
    );

    // The rule-file import and the repo-map, through the stubbed reader.
    const preview = bodyOf<RuleImportPreview>(
      await call("post", `${KNOWLEDGE}/import/preview`).send({ repo }).expect(200),
    );
    const applied = bodyOf<RuleImportResult>(
      await call("post", `${KNOWLEDGE}/import/apply`)
        .send({ repo, fingerprint: preview.fingerprint })
        .expect(200),
    );
    const repoMap = bodyOf<RepoMapReport>(
      await call("post", `${KNOWLEDGE}/repo-map/regenerate`).send({ repo }).expect(200),
    );
    expect(repoMap.outcome).toBe("published");
    const repoMapSkill = bodyOf<SkillDetail>(
      await call("get", `${SKILLS}/${repoMap.skill ?? ""}`).expect(200),
    );

    // The manifest, as the preview assembles it for the repository.
    const manifest = bodyOf<ContextManifest>(
      await call("post", `${CONTEXT}/preview`).send({ consumer: "run_stage", repo }).expect(200),
    );
    const skillVersionId =
      manifest.skillVersions.find((entry) => entry.skillId === skill.skill.id)?.versionId ?? "";
    expect(skillVersionId).not.toBe("");
    expect(manifest.facts.map((fact) => fact.id)).toContain(proposal.id);

    return {
      owner,
      id: workspace.id,
      slug: workspace.slug,
      repo,
      skillSlug,
      skillId: skill.skill.id,
      skillVersionId,
      factId: proposal.id,
      anchorId: anchored.anchors[0]?.id ?? "",
      workflowSlug: workflow.slug,
      workflowId: workflow.id,
      playbookId: playbook.id,
      runId,
      issueId: issues[0].id,
      proposedFactId,
      suppressionId: suppressions.items[0]?.id ?? "",
      imported: applied.created,
      repoMapSlug: repoMap.skill ?? "",
      repoMapSkillId: repoMapSkill.skill.id,
      manifest,
      previewFingerprint: preview.fingerprint,
    };
  }

  beforeAll(async () => {
    engine = await startEngineStub();
    api = await ApiHarness.start({ OURO_ENGINE_URL: engine.url }, [
      { provide: DetectionService, useValue: repos },
    ]);
    mine = await populate("a");
    theirs = await populate("b");
  });

  afterAll(async () => {
    await api.truncate();
    await api.close();
    await engine.stop();
  });

  /**
   * B asks for A's thing by address; it is a `404`.
   *
   * @param about - The claim.
   * @param method - The verb.
   * @param path - The path, given A.
   * @param body - The body, given A and B.
   * @returns The case.
   */
  function notFound(
    about: string,
    method: Method,
    path: (other: Tenant) => string,
    body?: (other: Tenant, self: Tenant) => object,
  ): IsolationCase {
    return {
      about,
      check: async (self, other) => {
        const sent = as(self)(method, path(other)).set("If-Match", '"none"');

        refused(await (body === undefined ? sent : sent.send(body(other, self))), 404);
      },
    };
  }

  /**
   * B reads a collection; it holds nothing of A's.
   *
   * @param about - The claim.
   * @param method - The verb.
   * @param path - The path.
   * @param body - The body, if the route takes one.
   * @returns The case.
   */
  function collection(
    about: string,
    method: Method,
    path: string,
    body?: (self: Tenant) => object,
  ): IsolationCase {
    return {
      about,
      check: async (self, other) => {
        const sent = as(self)(method, path);
        const response = await (body === undefined ? sent : sent.send(body(self)));

        expect(response.status).toBeLessThan(300);
        holdsNothingOf(response.body, other);
      },
    };
  }

  /**
   * The claim made about each route, by signature. Adding a knowledge route means adding a line
   * here — the first test compares these keys against the router's own list.
   */
  const CASES: Record<string, IsolationCase> = {
    // ── skills ──────────────────────────────────────────────────────────────────────────────
    [`GET ${SKILLS}`]: collection("lists none of theirs", "get", SKILLS),
    [`GET ${SKILLS}/stats`]: collection("counts none of theirs", "get", `${SKILLS}/stats`),
    [`POST ${SKILLS}`]: {
      about: "cannot scope a skill to their workflow",
      check: async (self, other) => {
        const response = await as(self)("post", SKILLS).send({
          text: doc("borrowed"),
          scope: "workflow",
          workflowId: other.workflowId,
        });

        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);
        refused(await as(self)("get", `${SKILLS}/borrowed`), 404);
      },
    },
    [`GET ${SKILLS}/:slug`]: notFound(
      "theirs is not found",
      "get",
      (o) => `${SKILLS}/${o.skillSlug}`,
    ),
    [`PATCH ${SKILLS}/:slug`]: notFound(
      "cannot switch theirs off",
      "patch",
      (o) => `${SKILLS}/${o.skillSlug}`,
      () => ({ enabled: false }),
    ),
    [`DELETE ${SKILLS}/:slug`]: notFound(
      "cannot delete theirs",
      "delete",
      (o) => `${SKILLS}/${o.skillSlug}`,
    ),
    [`PUT ${SKILLS}/:slug/draft`]: notFound(
      "cannot draft into theirs",
      "put",
      (o) => `${SKILLS}/${o.skillSlug}/draft`,
      (o) => ({ text: doc(o.skillSlug) }),
    ),
    [`POST ${SKILLS}/:slug/publish`]: notFound(
      "cannot publish theirs",
      "post",
      (o) => `${SKILLS}/${o.skillSlug}/publish`,
      () => ({}),
    ),
    [`GET ${SKILLS}/:slug/versions`]: notFound(
      "cannot read theirs' history",
      "get",
      (o) => `${SKILLS}/${o.skillSlug}/versions`,
    ),
    [`POST ${SKILLS}/:slug/scope/preview`]: {
      about: "cannot preview theirs, nor move ours onto their workflow",
      check: async (self, other) => {
        refused(
          await as(self)("post", `${SKILLS}/${other.skillSlug}/scope/preview`).send({
            scope: "org",
          }),
          404,
        );

        const onto = await as(self)("post", `${SKILLS}/${self.skillSlug}/scope/preview`).send({
          scope: "workflow",
          workflowId: other.workflowId,
        });
        expect(onto.status).toBeGreaterThanOrEqual(400);
        expect(onto.status).toBeLessThan(500);
      },
    },
    [`POST ${SKILLS}/:slug/scope`]: notFound(
      "cannot move theirs",
      "post",
      (o) => `${SKILLS}/${o.skillSlug}/scope`,
      () => ({ scope: "org", previewToken: NO_HASH, resolve: "keep_both" }),
    ),
    [`GET ${SKILLS}/:slug/code`]: notFound(
      "cannot open theirs in the code view",
      "get",
      (o) => `${SKILLS}/${o.skillSlug}/code`,
    ),
    [`PUT ${SKILLS}/:slug/code`]: notFound(
      "cannot save theirs from the code view",
      "put",
      (o) => `${SKILLS}/${o.skillSlug}/code`,
      (o) => ({ text: doc(o.skillSlug) }),
    ),

    // ── facts ───────────────────────────────────────────────────────────────────────────────
    [`GET ${FACTS}`]: {
      about: "lists and counts none of theirs",
      check: async (self, other) => {
        const list = bodyOf<FactList>(await as(self)("get", FACTS).expect(200));

        holdsNothingOf(list, other);
        // One hand-confirmed fact; the steer's and the import's proposals await review.
        expect(list.counts.confirmed).toBe(1);
      },
    },
    [`POST ${FACTS}`]: {
      about: "writes into ours, and their identical fact is untouched",
      check: async (self, other) => {
        const theirsBefore = bodyOf<FactDetail>(
          await as(other)("get", `${FACTS}/${other.factId}`).expect(200),
        );
        const written = bodyOf<FactDetail>(
          await as(self)("post", FACTS).send({ text: theirsBefore.text }).expect(201),
        );

        expect(written.id).not.toBe(other.factId);
        expect(
          bodyOf<FactDetail>(await as(other)("get", `${FACTS}/${other.factId}`).expect(200)),
        ).toEqual(theirsBefore);
      },
    },
    [`GET ${FACTS}/needs-you`]: {
      about: "queues none of theirs",
      check: async (self, other) => {
        holdsNothingOf(
          bodyOf<FactNeedsYou>(await as(self)("get", `${FACTS}/needs-you`).expect(200)),
          other,
        );
      },
    },
    [`POST ${FACTS}/sweep`]: {
      about: "sweeps only our anchors",
      check: async (self, other) => {
        const report = bodyOf<SweepReport>(await as(self)("post", `${FACTS}/sweep`).expect(200));

        expect(report.organizationId).toBe(self.id);
        expect(report.anchors).toBe(1);
        holdsNothingOf(report, other);
      },
    },
    [`GET ${FACTS}/:factId`]: notFound("theirs is not found", "get", (o) => `${FACTS}/${o.factId}`),
    [`POST ${FACTS}/:factId/confirm`]: notFound(
      "cannot confirm their proposal",
      "post",
      (o) => `${FACTS}/${o.proposedFactId}/confirm`,
      () => ({}),
    ),
    [`POST ${FACTS}/:factId/reject`]: notFound(
      "cannot reject their proposal",
      "post",
      (o) => `${FACTS}/${o.proposedFactId}/reject`,
      () => ({}),
    ),
    [`POST ${FACTS}/:factId/reconfirm`]: notFound(
      "cannot reconfirm theirs",
      "post",
      (o) => `${FACTS}/${o.factId}/reconfirm`,
      () => ({}),
    ),
    [`POST ${FACTS}/:factId/expire`]: notFound(
      "cannot expire theirs",
      "post",
      (o) => `${FACTS}/${o.factId}/expire`,
      () => ({ reason: "not yours" }),
    ),
    [`POST ${FACTS}/:factId/relearn`]: notFound(
      "cannot re-learn from theirs",
      "post",
      (o) => `${FACTS}/${o.factId}/relearn`,
      () => ({ text: "a replacement" }),
    ),
    [`POST ${FACTS}/:factId/anchors`]: notFound(
      "cannot anchor theirs",
      "post",
      (o) => `${FACTS}/${o.factId}/anchors`,
      () => ({ kind: "dependency", value: "zephyr" }),
    ),
    [`DELETE ${FACTS}/:factId/anchors/:anchorId`]: notFound(
      "cannot remove their anchor",
      "delete",
      (o) => `${FACTS}/${o.factId}/anchors/${o.anchorId}`,
    ),

    // ── fact proposers ──────────────────────────────────────────────────────────────────────
    [`GET ${PROPOSERS}`]: collection("is the same registry for everyone", "get", PROPOSERS),
    [`GET ${PROPOSERS}/suppressions`]: collection(
      "lists none of their suppressions",
      "get",
      `${PROPOSERS}/suppressions`,
    ),
    [`POST ${PROPOSERS}/backfill`]: {
      about: "cannot propose from their run",
      check: async (self, other) => {
        const envelope = refused(
          await as(self)("post", `${PROPOSERS}/backfill`).send({ runId: other.runId }),
          404,
        );

        expect(envelope.code).toBe("run_not_found");
      },
    },

    // ── context assembly: manifests and previews ────────────────────────────────────────────
    [`POST ${CONTEXT}/preview`]: {
      about: "assembles none of theirs, even when an override or the workflow names it",
      check: async (self, other) => {
        for (const repo of [self.repo, other.repo, undefined]) {
          const manifest = bodyOf<ContextManifest>(
            await as(self)("post", `${CONTEXT}/preview`)
              .send({
                consumer: "run_stage",
                ...(repo === undefined ? {} : { repo }),
                overrides: { enable: [other.skillId] },
              })
              .expect(200),
          );

          expect(manifest.refusedOverrides).toEqual([
            { skillId: other.skillId, action: "enable", reason: "not_resolved" },
          ]);
          // The scope echoes what was asked — their repository's name, when that is what B asked for.
          holdsNothingOf({ ...manifest, scope: null, refusedOverrides: [] }, other);
          expect(manifest.skillVersions.map((entry) => entry.skillId)).toContain(self.skillId);
        }

        const disabled = bodyOf<ContextManifest>(
          await as(self)("post", `${CONTEXT}/preview`)
            .send({ consumer: "playbook", overrides: { disable: [other.skillId] } })
            .expect(200),
        );
        expect(disabled.refusedOverrides).toEqual([
          { skillId: other.skillId, action: "disable", reason: "not_resolved" },
        ]);

        refused(
          await as(self)("post", `${CONTEXT}/preview`).send({
            consumer: "run_stage",
            workflow: other.workflowSlug,
          }),
          404,
        );
      },
    },
    [`POST ${CONTEXT}/injections`]: {
      about: "cannot record their versions, facts or run",
      check: async (self, other) => {
        const bodies = [
          { runId: self.runId, skillVersionIds: [other.skillVersionId], factIds: [] },
          { runId: self.runId, skillVersionIds: [], factIds: [other.factId] },
          { runId: other.runId, skillVersionIds: [], factIds: [] },
        ];

        for (const body of bodies) {
          const envelope = refused(
            await as(self)("post", `${CONTEXT}/injections`).send({
              consumer: "playbook",
              manifestHash: NO_HASH,
              ...body,
            }),
            422,
          );

          expect(envelope.code).toBe("context_injection_unresolved");
        }
      },
    },

    // ── playbooks (recipes) ─────────────────────────────────────────────────────────────────
    [`GET ${PLAYBOOKS}`]: {
      about: "lists none of theirs",
      check: async (self, other) => {
        const list = bodyOf<PlaybookList>(await as(self)("get", PLAYBOOKS).expect(200));

        expect(list.items.map((item) => item.id)).toEqual([self.playbookId]);
        holdsNothingOf(list, other);
      },
    },
    [`GET ${PLAYBOOKS}/counts`]: {
      about: "counts none of theirs",
      check: async (self, other) => {
        const counts = bodyOf<PlaybookCounts>(
          await as(self)("get", `${PLAYBOOKS}/counts`).expect(200),
        );

        expect(counts.counts.map((row) => row.playbookId)).not.toContain(other.playbookId);
      },
    },
    [`GET ${PLAYBOOKS}/from-run/:runId`]: notFound(
      "cannot draft from their run",
      "get",
      (o) => `${PLAYBOOKS}/from-run/${o.runId}`,
    ),
    [`POST ${PLAYBOOKS}/from-run`]: notFound(
      "cannot create from their run",
      "post",
      () => `${PLAYBOOKS}/from-run`,
      (o) => ({ runId: o.runId, name: "stolen" }),
    ),
    [`POST ${PLAYBOOKS}`]: {
      about: "cannot pin their workflow, nor name their skills or facts",
      check: async (self, other) => {
        const base = {
          name: "borrowed",
          description: "Borrowed.",
          workflow: self.workflowSlug,
          workflowVersion: 1,
        };

        const workflow = refused(
          await as(self)("post", PLAYBOOKS).send({ ...base, workflow: other.workflowSlug }),
          422,
        );
        expect(workflow.code).toBe("playbook_workflow_not_found");

        for (const refs of [
          { skillOverrides: { enable: [other.skillId] } },
          { skillOverrides: { disable: [other.skillId] } },
          { contextPreset: { factIds: [other.factId] } },
        ]) {
          const envelope = refused(
            await as(self)("post", PLAYBOOKS).send({ ...base, ...refs }),
            422,
          );

          expect(envelope.code).toBe("playbook_reference_unresolved");
        }
      },
    },
    [`GET ${PLAYBOOKS}/:id`]: notFound(
      "theirs is not found",
      "get",
      (o) => `${PLAYBOOKS}/${o.playbookId}`,
    ),
    [`PATCH ${PLAYBOOKS}/:id`]: {
      about: "cannot edit theirs, nor point ours at their skills or facts",
      check: async (self, other) => {
        refused(
          await as(self)("patch", `${PLAYBOOKS}/${other.playbookId}`).send({ name: "renamed" }),
          404,
        );

        for (const refs of [
          { skillOverrides: { enable: [other.skillId] } },
          { contextPreset: { factIds: [other.factId] } },
        ]) {
          refused(await as(self)("patch", `${PLAYBOOKS}/${self.playbookId}`).send(refs), 422);
        }
      },
    },
    [`DELETE ${PLAYBOOKS}/:id`]: notFound(
      "cannot delete theirs",
      "delete",
      (o) => `${PLAYBOOKS}/${o.playbookId}`,
    ),
    [`GET ${PLAYBOOKS}/:id/issues`]: {
      about: "cannot list theirs' picker, and ours offers none of their issues",
      check: async (self, other) => {
        refused(await as(self)("get", `${PLAYBOOKS}/${other.playbookId}/issues`), 404);

        const ours = bodyOf<PlaybookIssueList>(
          await as(self)("get", `${PLAYBOOKS}/${self.playbookId}/issues`).expect(200),
        );
        expect(ours.items.map((item) => item.id)).toEqual([self.issueId]);
      },
    },
    [`GET ${PLAYBOOKS}/:id/context`]: {
      about: "cannot read theirs' context, and ours attaches none of theirs in their repository",
      check: async (self, other) => {
        refused(await as(self)("get", `${PLAYBOOKS}/${other.playbookId}/context`), 404);

        const ours = bodyOf<PlaybookContextResource>(
          await as(self)(
            "get",
            `${PLAYBOOKS}/${self.playbookId}/context?repo=${encodeURIComponent(other.repo)}`,
          ).expect(200),
        );
        holdsNothingOf({ ...ours, manifest: { ...ours.manifest, scope: null } }, other);
      },
    },
    [`POST ${PLAYBOOKS}/:id/launch`]: {
      about: "cannot launch theirs, nor launch ours on their issue",
      check: async (self, other) => {
        refused(
          await as(self)("post", `${PLAYBOOKS}/${other.playbookId}/launch`).send({
            issueId: self.issueId,
          }),
          404,
        );
        const envelope = refused(
          await as(self)("post", `${PLAYBOOKS}/${self.playbookId}/launch`).send({
            issueId: other.issueId,
          }),
          404,
        );
        expect(envelope.code).toBe("playbook_issue_not_found");
      },
    },

    // ── rule-file import and repo-map ───────────────────────────────────────────────────────
    [`POST ${KNOWLEDGE}/import/preview`]: {
      about: "cannot read their repository's rules files",
      check: async (self, other) => {
        const envelope = refused(
          await as(self)("post", `${KNOWLEDGE}/import/preview`).send({ repo: other.repo }),
          409,
        );

        expect(envelope.code).toBe(DETECTION_ERRORS.sourceMissing);
      },
    },
    [`POST ${KNOWLEDGE}/import/apply`]: {
      about: "cannot apply their preview",
      check: async (self, other) => {
        const envelope = refused(
          await as(self)("post", `${KNOWLEDGE}/import/apply`).send({
            repo: other.repo,
            fingerprint: other.previewFingerprint,
          }),
          409,
        );

        expect(envelope.code).toBe(DETECTION_ERRORS.sourceMissing);
      },
    },
    [`POST ${KNOWLEDGE}/repo-map/regenerate`]: {
      about: "cannot map their repository, nor republish their map",
      check: async (self, other) => {
        const report = bodyOf<RepoMapReport>(
          await as(self)("post", `${KNOWLEDGE}/repo-map/regenerate`)
            .send({ repo: other.repo })
            .expect(200),
        );

        expect(report).toMatchObject({ outcome: "skipped", reason: "no_source", skill: null });
      },
    },
  };

  it("HAS A CLAIM FOR EVERY KNOWLEDGE ROUTE THE APPLICATION REGISTERS", () => {
    // A knowledge route added without a line in CASES fails here, naming itself.
    expect(knowledgeRoutes(api.nest)).toEqual(Object.keys(CASES).sort());
  });

  describe("each route holds the line", () => {
    it.each(
      Object.entries(CASES).map(
        ([signature, value]) => [signature, value.about, value.check] as const,
      ),
    )("%s — %s", async (_signature, _about, check) => {
      await check(theirs, mine);
      await check(mine, theirs);
    });
  });

  it("left every workspace's knowledge as it was", async () => {
    for (const tenant of [mine, theirs]) {
      const call = as(tenant);
      const skills = bodyOf<SkillList>(await call("get", SKILLS).expect(200));
      const stats = bodyOf<SkillStats>(await call("get", `${SKILLS}/stats`).expect(200));
      const skill = bodyOf<SkillDetail>(
        await call("get", `${SKILLS}/${tenant.skillSlug}`).expect(200),
      );
      const fact = bodyOf<FactDetail>(await call("get", `${FACTS}/${tenant.factId}`).expect(200));
      const proposed = bodyOf<FactDetail>(
        await call("get", `${FACTS}/${tenant.proposedFactId}`).expect(200),
      );
      const playbook = bodyOf<PlaybookResource>(
        await call("get", `${PLAYBOOKS}/${tenant.playbookId}`).expect(200),
      );
      const manifest = bodyOf<ContextManifest>(
        await call("post", `${CONTEXT}/preview`)
          .send({ consumer: "run_stage", repo: tenant.repo })
          .expect(200),
      );

      expect(skills.skills.map((row) => row.slug)).toEqual(
        expect.arrayContaining([tenant.skillSlug, tenant.repoMapSlug]) as unknown,
      );
      expect(stats.skills.map((row) => row.slug)).toContain(tenant.skillSlug);
      expect(skill.skill).toMatchObject({ enabled: true, required: false, currentVersion: 1 });
      expect(skill.draft).toBeNull();
      expect(fact).toMatchObject({ status: "confirmed", relearnedByFactIds: [] });
      expect(fact.anchors.map((anchor) => anchor.id)).toEqual([tenant.anchorId]);
      expect(proposed.status).toBe("proposed");
      expect(playbook.name).toMatch(/bring-up$/);
      expect(manifest.manifestHash).toBe(tenant.manifest.manifestHash);
    }
  });
});
