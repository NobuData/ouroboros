import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import type { Page } from "../tenancy/pagination";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { StageCatalog } from "../workflows/catalog.resources";
import type { WorkflowCode } from "../workflows/code.resources";
import type { CodeSymbolTable } from "../workflows/code.symbols";
import { DslWarningCode } from "../workflows/dsl.errors";
import { seedPinnedAliases } from "../workflows/pins.fixture";
import type { WorkflowDetail } from "../workflows/workflows.resources";
import { REQUIRED_LOCK_REASON } from "./skills.errors";
import type { SkillCode, SkillDetail, SkillVersionSummary } from "./skills.resources";

/**
 * The skills registry's certification — BF.7 ([#416](https://github.com/NobuData/ouroboros/issues/416)).
 *
 * `skills.integration-spec.ts` (BF.1, #410) walks each feature once. This suite exists so the
 * rules mockup 14 promises stay true after someone who never saw the mockup refactors the code
 * behind them — each case is written so that removing the rule turns it red:
 *
 *   * **A published version is immutable through every route.** A draft save, a code-view save
 *     and a second publish all leave v1 byte-identical, and the database refuses a revision
 *     beneath the service.
 *   * **The required lock holds on every path that would switch a skill off** — `enabled: false`,
 *     back to draft, delete, and a direct `UPDATE` — and only an owner may set or lift it.
 *   * **Registry truth reaches every integration**: the stage catalog, the code editor's
 *     completions and P7's unknown-skill warning all move together as a skill is published,
 *     and sent back to draft, and none of them ever offers a draft.
 */

const SKILLS = "/api/v1/skills";
const WORKFLOWS = "/api/v1/workflows";

/** Mockup 04's canvas, whose stages name `repo-map` and `zephyr-conventions`. */
const STANDARD_FIX = JSON.parse(
  readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "schemas",
      "workflow-dsl",
      "fixtures",
      "valid",
      "standard-fix.json",
    ),
    "utf8",
  ),
) as Record<string, unknown>;

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

describe("the skills registry's certification (#416)", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({});
  });

  afterAll(async () => {
    await api.close();
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
   * Create a skill, and publish it unless asked not to.
   *
   * @param place - Where.
   * @param name - Its name, which is also its slug.
   * @param publish - Whether to publish v1.
   * @returns Its slug.
   */
  async function skill(place: Bench, name: string, publish = true): Promise<string> {
    const created = bodyOf<SkillDetail>(
      await as(place.owner, place)("post", SKILLS)
        .send({ text: doc(name, "Body.") })
        .expect(201),
    );

    if (publish) {
      await as(place.owner, place)("post", `${SKILLS}/${created.skill.slug}/publish`)
        .send({})
        .expect(200);
    }

    return created.skill.slug;
  }

  describe("version immutability", () => {
    it("leaves a published version byte-identical through draft, code-view and publish", async () => {
      const place = await bench();
      const slug = await skill(place, "zephyr-conventions");
      const read = async (query: string) =>
        bodyOf<SkillDetail>(
          await as(place.admin, place)("get", `${SKILLS}/${slug}${query}`).expect(200),
        );
      const v1 = (await read("?version=1")).version;
      const v1File = bodyOf<SkillCode>(
        await as(place.admin, place)("get", `${SKILLS}/${slug}/code?version=1`).expect(200),
      );

      // Every write route a person has: the draft, the code view, then a second publish.
      const draft = await read("");
      await as(place.admin, place)("put", `${SKILLS}/${slug}/draft`)
        .set("If-Match", draft.draftEtag)
        .send({ text: doc("zephyr-conventions", "Rewritten through the draft.") })
        .expect(200);
      const file = bodyOf<SkillCode>(
        await as(place.admin, place)("get", `${SKILLS}/${slug}/code`).expect(200),
      );
      await as(place.admin, place)("put", `${SKILLS}/${slug}/code`)
        .set("If-Match", file.etag)
        .send({ text: doc("zephyr-conventions", "Rewritten through the code view.") })
        .expect(200);
      await as(place.admin, place)("post", `${SKILLS}/${slug}/publish`).send({}).expect(200);

      expect((await read("?version=1")).version).toEqual(v1);
      // Only the pointer to the version in force moved.
      expect(
        bodyOf<SkillCode>(
          await as(place.admin, place)("get", `${SKILLS}/${slug}/code?version=1`).expect(200),
        ),
      ).toEqual({ ...v1File, currentVersion: 2 });
      expect(v1File.readOnly).toBe(true);
      expect((await read("")).version).toMatchObject({
        version: 2,
        body: "Rewritten through the code view.",
      });

      const versions = bodyOf<Page<SkillVersionSummary>>(
        await as(place.admin, place)("get", `${SKILLS}/${slug}/versions`).expect(200),
      );
      expect(versions.items.map((row) => [row.version, row.isCurrent])).toEqual([
        [2, true],
        [1, false],
      ]);

      // Beneath the service: no column of a published version can be revised.
      for (const column of ["body = 'x'", `frontmatter = '{"name":"x"}'::jsonb`]) {
        await expect(
          api.sql.query(
            `update ${SCHEMA_NAME}.skill_versions set ${column}
              where version = 1 and skill_id = (select id from ${SCHEMA_NAME}.skills where slug = $1)`,
            [slug],
          ),
        ).rejects.toThrow(/immutable once published/);
      }
    });
  });

  describe("the required lock", () => {
    it("refuses every path that would switch a required skill off, for every role", async () => {
      const place = await bench();
      const slug = await skill(place, "hil-safety");
      await as(place.owner, place)("patch", `${SKILLS}/${slug}`)
        .send({ required: true })
        .expect(200);

      for (const person of [place.owner, place.admin]) {
        const disable = bodyOf<ErrorEnvelope>(
          await as(person, place)("patch", `${SKILLS}/${slug}`)
            .send({ enabled: false })
            .expect(403),
        );
        expect(disable).toMatchObject({
          code: "skill_required_locked",
          details: { slug, reason: REQUIRED_LOCK_REASON },
        });

        const removed = bodyOf<ErrorEnvelope>(
          await as(person, place)("delete", `${SKILLS}/${slug}`).expect(403),
        );
        expect(removed.code).toBe("skill_required_locked");

        const drafted = bodyOf<ErrorEnvelope>(
          await as(person, place)("patch", `${SKILLS}/${slug}`).send({ draft: true }).expect(422),
        );
        expect(drafted.code).toBe("skill_required_draft");
      }

      // The owner may not lock and disable in one breath either.
      await as(place.owner, place)("patch", `${SKILLS}/${slug}`)
        .send({ required: true, enabled: false })
        .expect(403);

      // And the database holds the lock beneath the service.
      await expect(
        api.sql.query(`update ${SCHEMA_NAME}.skills set enabled = false where slug = $1`, [slug]),
      ).rejects.toThrow(/skills_required_enabled/);

      const detail = bodyOf<SkillDetail>(
        await as(place.admin, place)("get", `${SKILLS}/${slug}`).expect(200),
      );
      expect(detail.skill).toMatchObject({ required: true, enabled: true, draft: false });
    });

    it("keeps setting and lifting `required` an owner's, and lifting it frees the switch", async () => {
      const place = await bench();
      const slug = await skill(place, "hil-safety");

      const set = bodyOf<ErrorEnvelope>(
        await as(place.admin, place)("patch", `${SKILLS}/${slug}`)
          .send({ required: true })
          .expect(403),
      );
      expect(set.code).toBe("skill_required_owner_only");

      await as(place.owner, place)("patch", `${SKILLS}/${slug}`)
        .send({ required: true })
        .expect(200);

      const lift = bodyOf<ErrorEnvelope>(
        await as(place.admin, place)("patch", `${SKILLS}/${slug}`)
          .send({ required: false })
          .expect(403),
      );
      expect(lift.code).toBe("skill_required_owner_only");

      await as(place.owner, place)("patch", `${SKILLS}/${slug}`)
        .send({ required: false })
        .expect(200);
      await as(place.admin, place)("patch", `${SKILLS}/${slug}`)
        .send({ enabled: false })
        .expect(200);
      await as(place.admin, place)("delete", `${SKILLS}/${slug}`).expect(204);
    });
  });

  describe("registry integrations", () => {
    it("moves the catalog, the completions and P7's warning together, never offering a draft", async () => {
      const place = await bench();
      await seedPinnedAliases(api, place.id);
      await skill(place, "repo-map");
      const zephyr = await skill(place, "zephyr-conventions", false);

      const created = bodyOf<WorkflowDetail>(
        await as(place.owner, place)("post", WORKFLOWS).send({ name: "Standard Fix" }).expect(201),
      );
      await as(place.owner, place)("put", `${WORKFLOWS}/${created.id}/draft`)
        .set("If-Match", created.draft.etag)
        .send({ definition: STANDARD_FIX })
        .expect(200);

      /** @returns What each integration offers or flags, read afresh. */
      const registry = async () => {
        const catalog = bodyOf<StageCatalog>(
          await as(place.owner, place)("get", `${WORKFLOWS}/catalog`).expect(200),
        );
        const symbols = bodyOf<CodeSymbolTable>(
          await as(place.owner, place)("get", `${WORKFLOWS}/code-symbols`).expect(200),
        );
        const file = bodyOf<WorkflowCode>(
          await as(place.owner, place)("get", `${WORKFLOWS}/standard-fix/code`).expect(200),
        );

        return {
          catalog: catalog.suggestions.skills,
          completions: symbols.scopes
            .find((scope) => scope.scope === "stage.llm.skill")
            ?.completions.map((completion) => completion.label),
          unknown: file.diagnostics
            .filter((diagnostic) => diagnostic.code === DslWarningCode.REFERENCE_UNKNOWN_SKILL)
            .map((diagnostic) => diagnostic.message),
        };
      };

      // Created but unpublished: a draft is never offered, and a reference to it is unknown.
      const before = await registry();
      expect(before.catalog).toEqual(["repo-map"]);
      expect(before.completions).toEqual(["repo-map"]);
      expect(before.unknown).toEqual([expect.stringContaining(zephyr) as unknown]);

      await as(place.owner, place)("post", `${SKILLS}/${zephyr}/publish`).send({}).expect(200);
      expect(await registry()).toEqual({
        catalog: ["repo-map", zephyr],
        completions: ["repo-map", zephyr],
        unknown: [],
      });

      // Sent back to draft, it leaves the registry again, everywhere at once.
      await as(place.owner, place)("patch", `${SKILLS}/${zephyr}`)
        .send({ draft: true })
        .expect(200);
      const drafted = await registry();
      expect(drafted.catalog).toEqual(["repo-map"]);
      expect(drafted.completions).toEqual(["repo-map"]);
      expect(drafted.unknown).toHaveLength(1);
    });

    it("round-trips a code-view document to exactly the version it publishes", async () => {
      const place = await bench();
      const slug = await skill(place, "commit-style");
      const file = bodyOf<SkillCode>(
        await as(place.owner, place)("get", `${SKILLS}/${slug}/code`).expect(200),
      );
      const edited = doc("commit-style", "Conventional commits, `feat:` first.");

      const saved = bodyOf<SkillCode>(
        await as(place.owner, place)("put", `${SKILLS}/${slug}/code`)
          .set("If-Match", file.etag)
          .send({ text: edited })
          .expect(200),
      );
      expect(saved).toMatchObject({ text: edited, readOnly: false, version: null });

      // A stale etag is refused, and the saved text is what publishes.
      await as(place.owner, place)("put", `${SKILLS}/${slug}/code`)
        .set("If-Match", file.etag)
        .send({ text: doc("commit-style", "Lost update.") })
        .expect(409);
      await as(place.owner, place)("post", `${SKILLS}/${slug}/publish`).send({}).expect(200);

      const published = bodyOf<SkillCode>(
        await as(place.owner, place)("get", `${SKILLS}/${slug}/code?version=2`).expect(200),
      );
      expect(published).toMatchObject({ text: edited, readOnly: true, version: 2 });
      expect(
        bodyOf<SkillDetail>(await as(place.owner, place)("get", `${SKILLS}/${slug}`).expect(200))
          .version?.body,
      ).toBe("Conventional commits, `feat:` first.");
    });
  });
});
