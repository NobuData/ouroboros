import { startEngineStub, type EngineStub } from "../../testing/engine.stub.fixture";
import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { StageCatalog } from "../workflows/catalog.resources";
import type { WorkflowCodeTree } from "../workflows/code.resources";
import type { WorkflowDetail } from "../workflows/workflows.resources";
import { REQUIRED_LOCK_MESSAGE, REQUIRED_LOCK_REASON } from "./skills.errors";
import type {
  SkillCode,
  SkillDetail,
  SkillDraft,
  SkillList,
  SkillScopePreview,
  SkillStats,
  SkillVersionResource,
} from "./skills.resources";

/**
 * The skills registry against a migrated database, through the whole pipeline — BF.1
 * ([#410](https://github.com/NobuData/ouroboros/issues/410)).
 *
 * The acceptance criteria the unit suites cannot hold alone, because they are about PostgreSQL's
 * rules and the guards together:
 *
 *   * the lifecycle round-trips — create → draft-save → publish → a new version, the prior one
 *     immutable (V069's trigger, not just this service's say-so);
 *   * disabling a required skill is the designed `403`, and changing `required` is an owner's,
 *     on direct API calls;
 *   * the stage catalog reads registry truth — a draft is never offered;
 *   * a code-view edit round-trips to a new version, and the tree lists `skills/*.skill.md`;
 *   * deleting a referenced skill names the referencing workflow;
 *   * a scope move is previewed before it commits, and a clash needs an explicit resolution.
 */

const SKILLS = "/api/v1/skills";
const WORKFLOWS = "/api/v1/workflows";

/**
 * A skill document.
 *
 * @param name - The frontmatter's name.
 * @param body - The markdown.
 * @returns The file.
 */
function doc(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\n${body}`;
}

describe("the skills registry, against a migrated database", () => {
  let api: ApiHarness;
  let engine: EngineStub;

  beforeAll(async () => {
    engine = await startEngineStub();
    api = await ApiHarness.start({ OURO_ENGINE_URL: engine.url });
  });

  afterAll(async () => {
    await api.close();
    await engine.stop();
  });

  afterEach(async () => {
    await api.truncate();
  });

  /** A workspace, its owner and an admin. */
  interface Bench {
    owner: Person;
    admin: Person;
    id: string;
    slug: string;
  }

  /** @returns A workspace with an owner and an admin. */
  async function bench(): Promise<Bench> {
    const owner = await api.signIn({ email: "owner@ouroboros.invalid" });
    const admin = await api.signIn({ email: "admin@ouroboros.invalid" });
    const workspace = await api.workspace(owner);

    await api.join(workspace.id, admin, "admin");

    return { owner, admin, id: workspace.id, slug: workspace.slug };
  }

  /** A request as somebody, in the bench's workspace. */
  function as(person: Person, place: Bench) {
    return (method: "get" | "post" | "put" | "patch" | "delete", path: string) =>
      api.as(person)(method, path).set(TENANT_HEADER, place.slug);
  }

  /**
   * Create and publish a skill.
   *
   * @param place - Where.
   * @param name - Its name, which is also its slug.
   * @returns Its slug.
   */
  async function published(place: Bench, name: string): Promise<string> {
    const created = bodyOf<SkillDetail>(
      await as(place.owner, place)("post", SKILLS)
        .send({ text: doc(name, "Body.") })
        .expect(201),
    );

    await as(place.owner, place)("post", `${SKILLS}/${created.skill.slug}/publish`)
      .send({})
      .expect(200);

    return created.skill.slug;
  }

  it("round-trips the lifecycle, and a published version cannot be revised", async () => {
    const place = await bench();
    const created = bodyOf<SkillDetail>(
      await as(place.admin, place)("post", SKILLS)
        .send({
          text: doc("zephyr-conventions", "v1"),
          scope: "repo",
          repoRef: "acme-robotics/helios-firmware",
        })
        .expect(201),
    );
    const slug = created.skill.slug;

    const saved = bodyOf<SkillDraft>(
      await as(place.admin, place)("put", `${SKILLS}/${slug}/draft`)
        .set("If-Match", created.draftEtag)
        .send({ text: doc("zephyr-conventions", "v1 edited") })
        .expect(200),
    );
    const v1 = bodyOf<SkillVersionResource>(
      await as(place.admin, place)("post", `${SKILLS}/${slug}/publish`)
        .send({ changeNote: "First." })
        .expect(200),
    );

    expect(saved.body).toBe("v1 edited");
    expect(v1).toMatchObject({ version: 1, body: "v1 edited", changeNote: "First." });

    const reopened = bodyOf<SkillDetail>(
      await as(place.admin, place)("get", `${SKILLS}/${slug}`).expect(200),
    );

    await as(place.admin, place)("put", `${SKILLS}/${slug}/draft`)
      .set("If-Match", reopened.draftEtag)
      .send({ text: doc("zephyr-conventions", "v2") })
      .expect(200);
    await as(place.admin, place)("post", `${SKILLS}/${slug}/publish`).send({}).expect(200);

    expect(
      bodyOf<SkillDetail>(
        await as(place.admin, place)("get", `${SKILLS}/${slug}?version=1`).expect(200),
      ).version,
    ).toMatchObject({ version: 1, body: "v1 edited" });

    // The database's own rule, beneath the service's: v1 is immutable for every role.
    await expect(
      api.sql.query(
        `update ${SCHEMA_NAME}.skill_versions set body = 'rewritten'
          where version = 1 and skill_id = (select id from ${SCHEMA_NAME}.skills where slug = $1)`,
        [slug],
      ),
    ).rejects.toThrow(/immutable once published/);
  });

  it("refuses to disable a required skill with the designed reason, and keeps `required` an owner's", async () => {
    const place = await bench();
    const slug = await published(place, "hil-safety");

    // An admin may not set the lock; an owner may.
    const notOwner = bodyOf<ErrorEnvelope>(
      await as(place.admin, place)("patch", `${SKILLS}/${slug}`)
        .send({ required: true })
        .expect(403),
    );
    expect(notOwner.code).toBe("skill_required_owner_only");

    await as(place.owner, place)("patch", `${SKILLS}/${slug}`).send({ required: true }).expect(200);

    // Disabling is refused for everybody, owner included, with a machine-readable reason.
    for (const person of [place.admin, place.owner]) {
      const locked = bodyOf<ErrorEnvelope>(
        await as(person, place)("patch", `${SKILLS}/${slug}`).send({ enabled: false }).expect(403),
      );

      expect(locked).toMatchObject({
        code: "skill_required_locked",
        message: REQUIRED_LOCK_MESSAGE,
        details: { slug, reason: REQUIRED_LOCK_REASON },
      });
    }

    const list = bodyOf<SkillList>(await as(place.admin, place)("get", SKILLS).expect(200));
    expect(list.skills[0]).toMatchObject({ slug, required: true, enabled: true });
  });

  it("offers the catalog registry truth, never a draft", async () => {
    const place = await bench();
    await published(place, "repo-map");
    const draft = await published(place, "power-budget-checks");
    await as(place.owner, place)("patch", `${SKILLS}/${draft}`).send({ draft: true }).expect(200);

    const catalog = bodyOf<StageCatalog>(
      await as(place.owner, place)("get", `${WORKFLOWS}/catalog`).expect(200),
    );
    const list = bodyOf<SkillList>(await as(place.owner, place)("get", SKILLS).expect(200));
    const stats = bodyOf<SkillStats>(
      await as(place.owner, place)("get", `${SKILLS}/stats`).expect(200),
    );

    expect(catalog.suggestions.skills).toEqual(["repo-map"]);
    expect(list.active).toBe(1);
    expect(stats.window.days).toBe(30);
    expect(stats.skills.find((row) => row.slug === draft)).toMatchObject({
      active: false,
      usedBy: { label: "—" },
    });
  });

  it("serves skills/*.skill.md in the code view, and an edit there round-trips to a new version", async () => {
    const place = await bench();
    const slug = await published(place, "commit-style");

    const tree = bodyOf<WorkflowCodeTree>(
      await as(place.owner, place)("get", `${WORKFLOWS}/code-tree`).expect(200),
    );
    expect(tree.files).toContainEqual({
      path: "skills/commit-style.skill.md",
      kind: "skill",
      readOnly: false,
      slug,
      status: null,
    });

    const file = bodyOf<SkillCode>(
      await as(place.owner, place)("get", `${SKILLS}/${slug}/code`).expect(200),
    );
    const edited = file.text.replace("Body.", "Conventional commits.");

    await as(place.owner, place)("put", `${SKILLS}/${slug}/code`)
      .set("If-Match", file.etag)
      .send({ text: edited })
      .expect(200);
    await as(place.owner, place)("post", `${SKILLS}/${slug}/publish`).send({}).expect(200);

    const v2 = bodyOf<SkillCode>(
      await as(place.owner, place)("get", `${SKILLS}/${slug}/code?version=2`).expect(200),
    );
    expect(v2).toMatchObject({ text: edited, readOnly: true, version: 2 });
  });

  it("refuses to delete a skill a published workflow references, naming the workflow", async () => {
    const place = await bench();
    const slug = await published(place, "repo-map");
    const workflow = bodyOf<WorkflowDetail>(
      await as(place.owner, place)("post", WORKFLOWS).send({ name: "Feature loop" }).expect(201),
    );

    // Published straight into the table: the reference is what is under test, not the gate.
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.workflow_versions (workflow_id, version, definition, published_at)
       values ($1, 1, $2, now())`,
      [
        workflow.id,
        JSON.stringify({
          nodes: [{ id: "design", type: "llm", config: { mode: "skill", skill: slug } }],
        }),
      ],
    );
    await api.sql.query(`update ${SCHEMA_NAME}.workflows set current_version = 1 where id = $1`, [
      workflow.id,
    ]);

    const refused = bodyOf<ErrorEnvelope>(
      await as(place.owner, place)("delete", `${SKILLS}/${slug}`).expect(409),
    );

    expect(refused.code).toBe("skill_referenced");
    expect(refused.details).toMatchObject({
      workflows: [{ id: workflow.id, slug: "feature-loop", version: 1 }],
    });
    expect(refused.message).toContain("feature-loop");
  });

  it("previews a scope move before it commits, and needs a clash resolved explicitly", async () => {
    const place = await bench();
    const created = bodyOf<SkillDetail>(
      await as(place.owner, place)("post", SKILLS)
        .send({
          text: doc("repo-map", "Body."),
          scope: "repo",
          repoRef: "acme-robotics/helios-firmware",
        })
        .expect(201),
    );
    await as(place.owner, place)("post", SKILLS)
      .send({ text: doc("repo-map", "Org copy."), slug: "repo-map-org", scope: "org" })
      .expect(201);
    const slug = created.skill.slug;

    const preview = bodyOf<SkillScopePreview>(
      await as(place.owner, place)("post", `${SKILLS}/${slug}/scope/preview`)
        .send({ scope: "org" })
        .expect(200),
    );

    expect(preview.clashes).toEqual([expect.objectContaining({ slug: "repo-map-org" }) as unknown]);

    const conflict = bodyOf<ErrorEnvelope>(
      await as(place.owner, place)("post", `${SKILLS}/${slug}/scope`)
        .send({ scope: "org", previewToken: preview.previewToken })
        .expect(409),
    );
    expect(conflict.code).toBe("skill_scope_conflict");

    await as(place.owner, place)("post", `${SKILLS}/${slug}/scope`)
      .send({ scope: "org", previewToken: preview.previewToken, resolve: "keep_both" })
      .expect(200);

    expect(
      bodyOf<SkillDetail>(await as(place.owner, place)("get", `${SKILLS}/${slug}`).expect(200))
        .skill,
    ).toMatchObject({ scope: "org", repoRef: null });
  });

  it("lets a viewer read and refuses them every write", async () => {
    const place = await bench();
    const viewer = await api.signIn({ email: "viewer@ouroboros.invalid" });
    await api.join(place.id, viewer, "viewer");
    const slug = await published(place, "pr-etiquette");

    await as(viewer, place)("get", SKILLS).expect(200);
    await as(viewer, place)("get", `${SKILLS}/${slug}`).expect(200);
    await as(viewer, place)("post", SKILLS)
      .send({ text: doc("x", "y") })
      .expect(403);
    await as(viewer, place)("patch", `${SKILLS}/${slug}`).send({ enabled: false }).expect(403);
    await as(viewer, place)("delete", `${SKILLS}/${slug}`).expect(403);
  });
});
