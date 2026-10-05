import {
  PRIMARY_REPO,
  SECOND_REPO,
  addRepo,
  workspaceWithRepo,
} from "../../testing/dashboard.fixture";
import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { sourceMissing } from "../detection/detection.errors";
import { DetectionService } from "../detection/detection.service";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { ADMINISTRATORS } from "../tenancy/roles.guard";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { RepoTree } from "../ticket-sources/ticket-source.probe";
import { OrgPolicyService, type DryRunPolicyResource } from "./org-policy.service";
import type { PathPreviewReader, PathPreviewResource } from "./path-preview.service";
import type { PolicyVersionListResource } from "./policy-history.service";
import type { PublishedPolicyResource } from "./policy-publish.service";

/**
 * `/api/v1/policies/dry-run`, over a socket and against a migrated database (BA.3,
 * [#382](https://github.com/NobuData/ouroboros/issues/382)).
 *
 * The criteria only this scale proves: the flip is refused for a member and a viewer on a direct
 * API call and writes nothing; an owner's or admin's flip persists and is audited with the actor,
 * the instant and the value it replaced; and onboarding completion's default turns an unset
 * workspace on without overwriting an explicit `false`.
 *
 * ```bash
 * yarn test:integration src/modules/policies
 * ```
 */

const POLICY = "/api/v1/policies/dry-run";

describe("the dry-run policy endpoint", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** The workspace's policy rows, straight from the table. */
  async function stored(organizationId: string): Promise<{ dry_run: boolean }[]> {
    const { rows } = await api.sql.query<{ dry_run: boolean }>(
      `select dry_run from ${SCHEMA_NAME}.org_policies where organization_id = $1`,
      [organizationId],
    );

    return rows;
  }

  /** The workspace's flips, from the audit trail. */
  async function flips(organizationId: string) {
    const { rows } = await api.sql.query<{
      actor_id: string | null;
      subject_type: string;
      subject_id: string;
      detail: Record<string, unknown>;
      occurred_at: Date;
    }>(
      `select actor_id, subject_type, subject_id, detail, occurred_at
         from ${SCHEMA_NAME}.audit_events
        where organization_id = $1 and action = 'policy.dry_run_changed'
        order by occurred_at`,
      [organizationId],
    );

    return rows;
  }

  it("refuses a stranger", async () => {
    await api.anonymous("get", POLICY).expect(401);
    await api.anonymous("patch", POLICY).expect(401);
  });

  it("lets a viewer read, and reads a workspace that never answered as off", async () => {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);
    const viewer = await api.signIn();
    await api.join(workspace.id, viewer, "viewer");

    const policy = bodyOf<DryRunPolicyResource>(
      await api.as(viewer)("get", POLICY).set(TENANT_HEADER, workspace.slug).expect(200),
    );

    expect(policy).toEqual({
      dryRun: false,
      explicit: false,
      reason: null,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it.each(["member", "viewer"] as const)(
    "refuses a %s's flip on a direct call, and writes nothing",
    async (role) => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);
      const person = await api.signIn();
      await api.join(workspace.id, person, role);

      const response = await api
        .as(person)("patch", POLICY)
        .set(TENANT_HEADER, workspace.slug)
        .send({ dryRun: false })
        .expect(403);

      expect(bodyOf<ErrorEnvelope>(response)).toMatchObject({
        code: "forbidden",
        details: { role, required: [...ADMINISTRATORS] },
      });
      expect(await stored(workspace.id)).toEqual([]);
      expect(await flips(workspace.id)).toEqual([]);
    },
  );

  it("persists an admin's flip and audits actor, instant and prior value", async () => {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);
    const admin = await api.signIn();
    await api.join(workspace.id, admin, "admin");

    const on = bodyOf<DryRunPolicyResource>(
      await api
        .as(admin)("patch", POLICY)
        .set(TENANT_HEADER, workspace.slug)
        .send({ dryRun: true })
        .expect(200),
    );
    const off = bodyOf<DryRunPolicyResource>(
      await api
        .as(owner)("patch", POLICY)
        .set(TENANT_HEADER, workspace.slug)
        .send({ dryRun: false })
        .expect(200),
    );

    expect(on).toMatchObject({ dryRun: true, explicit: true, reason: "dry-run policy active" });
    expect(off).toMatchObject({ dryRun: false, explicit: true, reason: null, updatedBy: owner.id });

    const trail = await flips(workspace.id);

    expect(trail).toMatchObject([
      {
        actor_id: admin.id,
        subject_type: "org_policy",
        subject_id: workspace.id,
        detail: { dry_run: true, previous: false, previous_explicit: false },
      },
      {
        actor_id: owner.id,
        detail: { dry_run: false, previous: true, previous_explicit: true },
      },
    ]);
    expect(trail[1].occurred_at.toISOString()).toBe(off.updatedAt);
  });

  it("refuses a body that is not a boolean", async () => {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);

    await api
      .as(owner)("patch", POLICY)
      .set(TENANT_HEADER, workspace.slug)
      .send({ dryRun: "false" })
      .expect(422);
    expect(await stored(workspace.id)).toEqual([]);
  });

  it("turns an unset workspace on at onboarding completion, and leaves an explicit false alone", async () => {
    const owner = await api.signIn();
    const unset = await api.workspace(owner);
    const chose = await api.workspace(owner);
    const policies = api.nest.get(OrgPolicyService);

    await policies.setDryRun(chose.id, owner.id, false);

    await expect(policies.adoptDefault(unset.id)).resolves.toBe(true);
    await expect(policies.adoptDefault(chose.id)).resolves.toBe(false);

    await expect(policies.read(unset.id)).resolves.toMatchObject({ dryRun: true, explicit: true });
    await expect(policies.read(chose.id)).resolves.toMatchObject({ dryRun: false });
  });

  it("reads a workspace whose policy document was published first as unanswered, and onboarding still turns it on", async () => {
    // V092 (#480): the publish creates the org_policies handle with dry_run null.
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);
    const policies = api.nest.get(OrgPolicyService);

    await api.sql.query(`select ${SCHEMA_NAME}.org_policy_publish($1, $2::jsonb, $3)`, [
      workspace.id,
      JSON.stringify(POLICY_V7),
      owner.id,
    ]);

    await expect(policies.dryRunNow(workspace.id)).resolves.toBe(false);
    await expect(policies.read(workspace.id)).resolves.toMatchObject({
      dryRun: false,
      explicit: false,
      updatedAt: null,
      updatedBy: null,
    });

    await expect(policies.adoptDefault(workspace.id)).resolves.toBe(true);
    await expect(policies.read(workspace.id)).resolves.toMatchObject({
      dryRun: true,
      explicit: true,
    });
  });
});

/**
 * The version history and the glob editor's match preview, over a socket and against a migrated
 * database (BS.4, [#494](https://github.com/NobuData/ouroboros/issues/494)).
 *
 * The history is asserted against what the **publish itself answered and audited**: the same
 * changes, the same line. The preview reads repositories through `DetectionService`, which this
 * suite replaces with an in-memory host — what is asserted here is which repositories are asked,
 * the matching, and that an unlistable repository is an answer rather than a failure.
 */

const POLICIES = "/api/v1/policies";
const VERSIONS = "/api/v1/policies/versions";
const PATH_PREVIEW = "/api/v1/policies/path-preview";

/** An in-memory repository host, playing `DetectionService.readTree`. */
class FakeTrees implements PathPreviewReader {
  /** Each repository's files, by `owner/name`. A repository not listed here has no source. */
  files: Record<string, readonly string[]> = {};

  /** Every repository asked for, in order. */
  asked: string[] = [];

  /**
   * The repository's tree.
   *
   * @param _organizationId - Unused: the repository names are unique to a test.
   * @param repo - `owner/name`.
   * @returns The listing.
   * @throws The detection plane's `detection_source_missing` for a repository with no files here.
   */
  readTree(_organizationId: string, repo: string): ReturnType<PathPreviewReader["readTree"]> {
    this.asked.push(repo);

    const files = this.files[repo];

    if (files === undefined) return Promise.reject(sourceMissing(repo));

    const tree: RepoTree = {
      entries: files.map((path) => ({ path, type: "file" as const })),
      truncated: false,
    };

    return Promise.resolve({ tree, files: new Map() });
  }
}

describe("the policy history and the path preview", () => {
  let api: ApiHarness;
  let host: FakeTrees;

  beforeAll(async () => {
    host = new FakeTrees();
    api = await ApiHarness.start({}, [{ provide: DetectionService, useValue: host }]);
  });

  afterAll(() => api.close());

  afterEach(async () => {
    host.files = {};
    host.asked = [];
    await api.truncate();
  });

  it("lists every version newest first, agreeing with what each publish answered and audited", async () => {
    const owner = await api.signIn({ displayName: "Ken" });
    const workspace = await api.workspace(owner);
    const viewer = await api.signIn();
    await api.join(workspace.id, viewer, "viewer");

    const before = bodyOf<PolicyVersionListResource>(
      await api.as(viewer)("get", VERSIONS).set(TENANT_HEADER, workspace.slug).expect(200),
    );

    expect(before).toEqual({ items: [], nextBefore: null });

    const v6 = { ...POLICY_V7, auto_merge: { ...POLICY_V7.auto_merge, enabled: false } };
    const publish = async (document: object, baseVersion: number | null, changeNote: string) =>
      bodyOf<PublishedPolicyResource>(
        await api
          .as(owner)("post", POLICIES)
          .set(TENANT_HEADER, workspace.slug)
          .send({ document, baseVersion, changeNote })
          .expect(201),
      );
    const first = await publish(v6, null, "Baseline.");
    const second = await publish(POLICY_V7, 1, "Enable auto-merge");

    // Any member reads it — a viewer here.
    const history = bodyOf<PolicyVersionListResource>(
      await api.as(viewer)("get", VERSIONS).set(TENANT_HEADER, workspace.slug).expect(200),
    );

    expect(history.nextBefore).toBeNull();
    expect(history.items).toEqual([
      {
        version: 2,
        publishedAt: second.publishedAt,
        publishedBy: owner.id,
        publisherName: "Ken",
        changeNote: "Enable auto-merge",
        document: POLICY_V7,
        classification: second.classification,
        changes: second.changes,
        summary: second.summary,
      },
      {
        version: 1,
        publishedAt: first.publishedAt,
        publishedBy: owner.id,
        publisherName: "Ken",
        changeNote: "Baseline.",
        document: v6,
        classification: first.classification,
        changes: first.changes,
        summary: first.summary,
      },
    ]);
    expect(history.items[0].changes).toEqual([
      {
        ruleId: "auto_merge",
        classification: "loosening",
        verb: "enabled",
        summary: "enabled auto-merge",
      },
    ]);

    // The audit rows name the same rules, version for version.
    const audited = await api.sql.query<{ detail: { version: number; changed_rules: string } }>(
      `select detail from ${SCHEMA_NAME}.audit_events
        where organization_id = $1 and action = 'policy.published'
        order by (detail->>'version')::int desc`,
      [workspace.id],
    );

    expect(audited.rows.map((row) => [row.detail.version, row.detail.changed_rules])).toEqual(
      history.items.map((item) => [
        item.version,
        item.changes.map((change) => change.ruleId).join(","),
      ]),
    );

    // Paged: one row at a time, the cursor carrying on.
    const page = bodyOf<PolicyVersionListResource>(
      await api
        .as(viewer)("get", `${VERSIONS}?limit=1`)
        .set(TENANT_HEADER, workspace.slug)
        .expect(200),
    );

    expect(page.items.map((item) => item.version)).toEqual([2]);
    expect(page.nextBefore).toBe(2);
    // v2's diff is against v1, though v1 is not on this page.
    expect(page.items[0].changes).toEqual(second.changes);

    const rest = bodyOf<PolicyVersionListResource>(
      await api
        .as(viewer)("get", `${VERSIONS}?limit=1&before=2`)
        .set(TENANT_HEADER, workspace.slug)
        .expect(200),
    );

    expect(rest.items.map((item) => item.version)).toEqual([1]);
    expect(rest.nextBefore).toBeNull();

    await api
      .as(viewer)("get", `${VERSIONS}?limit=101`)
      .set(TENANT_HEADER, workspace.slug)
      .expect(422);
    await api.anonymous("get", VERSIONS).expect(401);
  });

  it("keeps a version whose publisher is gone, and never shows another workspace's history", async () => {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);
    const gone = await api.signIn({ displayName: "Departed Admin" });
    await api.join(workspace.id, gone, "owner");

    await api
      .as(gone)("post", POLICIES)
      .set(TENANT_HEADER, workspace.slug)
      .send({ document: POLICY_V7, baseVersion: null })
      .expect(201);
    await api.sql.query(`delete from ${SCHEMA_NAME}."user" where "id" = $1`, [gone.id]);

    const history = bodyOf<PolicyVersionListResource>(
      await api.as(owner)("get", VERSIONS).set(TENANT_HEADER, workspace.slug).expect(200),
    );

    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({ version: 1, publishedBy: null, publisherName: null });

    const stranger = await api.signIn();
    const theirs = await api.workspace(stranger);

    expect(
      bodyOf<PolicyVersionListResource>(
        await api.as(stranger)("get", VERSIONS).set(TENANT_HEADER, theirs.slug).expect(200),
      ),
    ).toEqual({ items: [], nextBefore: null });
    await api.as(stranger)("get", VERSIONS).set(TENANT_HEADER, workspace.slug).expect(404);
  });

  it("previews each glob against each enabled repository, and answers an unlistable one as unavailable", async () => {
    const owner = await api.signIn({ email: "owner@ouroboros.invalid" });
    const workspace = await workspaceWithRepo(api, owner);
    const admin = await api.signIn();
    await api.join(workspace.id, admin, "admin");
    await addRepo(api, workspace, SECOND_REPO);

    const firmware = `${workspace.slug}/${PRIMARY_REPO}`.toLowerCase();
    const control = `${workspace.slug}/${SECOND_REPO}`.toLowerCase();

    // Another workspace's enabled repository is never asked for.
    const stranger = await api.signIn({ email: "stranger@ouroboros.invalid" });
    const theirs = await workspaceWithRepo(api, stranger);

    host.files = {
      [firmware]: ["boot/stage1.S", "boot/loader/main.c", "keys/prod.pem", "src/app.c"],
      [`${theirs.slug}/${PRIMARY_REPO}`.toLowerCase()]: ["boot/theirs.S"],
    };

    const preview = bodyOf<PathPreviewResource>(
      await api
        .as(admin)("post", PATH_PREVIEW)
        .set(TENANT_HEADER, workspace.slug)
        .send({ globs: ["boot/**", "docs/**"] })
        .expect(200),
    );

    expect(preview).toEqual({
      repositories: [
        {
          repository: control,
          status: "unavailable",
          reason: "No connected source covers this repository, so its files cannot be listed.",
          fileCount: null,
          truncated: false,
          globs: [
            { glob: "boot/**", matchCount: 0, samples: [] },
            { glob: "docs/**", matchCount: 0, samples: [] },
          ],
        },
        {
          repository: firmware,
          status: "listed",
          reason: null,
          fileCount: 4,
          truncated: false,
          globs: [
            { glob: "boot/**", matchCount: 2, samples: ["boot/loader/main.c", "boot/stage1.S"] },
            { glob: "docs/**", matchCount: 0, samples: [] },
          ],
        },
      ],
    });
    expect([...host.asked].sort()).toEqual([control, firmware].sort());

    // A second ask inside the minute lists nothing again for the repository already listed.
    host.asked = [];
    await api
      .as(owner)("post", PATH_PREVIEW)
      .set(TENANT_HEADER, workspace.slug)
      .send({ globs: ["keys/**"] })
      .expect(200);

    expect(host.asked).toEqual([control]);

    // It wrote nothing and audited nothing.
    const { rows } = await api.sql.query<{ events: number }>(
      `select count(*)::int as events from ${SCHEMA_NAME}.audit_events where organization_id = $1`,
      [workspace.id],
    );

    expect(rows[0].events).toBe(0);
  });

  it("refuses a bad glob naming it, and anybody below admin, before any repository is read", async () => {
    const owner = await api.signIn({ email: "owner@ouroboros.invalid" });
    const workspace = await workspaceWithRepo(api, owner);

    const refused = await api
      .as(owner)("post", PATH_PREVIEW)
      .set(TENANT_HEADER, workspace.slug)
      .send({ globs: ["boot/**", "/etc/passwd"] })
      .expect(422);

    expect(bodyOf<ErrorEnvelope>(refused)).toMatchObject({
      code: "policy_path_glob_invalid",
      details: { invalid: [{ index: 1, glob: "/etc/passwd" }] },
    });

    await api
      .as(owner)("post", PATH_PREVIEW)
      .set(TENANT_HEADER, workspace.slug)
      .send({ globs: [] })
      .expect(422);

    for (const role of ["member", "viewer"] as const) {
      const person = await api.signIn();
      await api.join(workspace.id, person, role);

      const forbidden = await api
        .as(person)("post", PATH_PREVIEW)
        .set(TENANT_HEADER, workspace.slug)
        .send({ globs: ["boot/**"] })
        .expect(403);

      expect(bodyOf<ErrorEnvelope>(forbidden)).toMatchObject({ code: "forbidden" });
    }

    await api
      .anonymous("post", PATH_PREVIEW)
      .send({ globs: ["boot/**"] })
      .expect(401);
    expect(host.asked).toEqual([]);
  });
});

/** Mockup 17's `policy v7` — `schemas/org-policy/fixtures/valid/policy-v7.json`. */
const POLICY_V7 = {
  auto_merge: {
    enabled: true,
    conditions: { all: [{ effort_lte: "m" }, { not: { label: "refactor" } }] },
  },
  human_review: {
    enabled: true,
    conditions: { any: [{ label: "refactor" }, { effort_gte: "l" }] },
  },
  protected_paths: {
    enabled: true,
    conditions: { path_globs: ["boot/**", "keys/**", ".github/**"] },
  },
  spend_guard: { enabled: true, conditions: { per_run_cap_cents: 250, monthly_cap_cents: 60000 } },
  dry_run_new_repos: { enabled: true, conditions: { first_n_loops: 10 } },
};
