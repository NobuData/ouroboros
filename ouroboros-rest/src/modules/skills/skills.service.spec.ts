import type { DatabaseService } from "../db/db.service";
import { NO_DRAFT } from "../workflows/draft.etag";
import { REQUIRED_LOCK_MESSAGE, REQUIRED_LOCK_REASON } from "./skills.errors";
import type { SkillsRepository } from "./skills.repository";
import { SkillsService } from "./skills.service";
import { SkillStore } from "./skills.store.fixture";

/**
 * The skills service's rules (#410), over an in-memory store that keeps V069's constraints.
 *
 * Every acceptance criterion the unit layer can hold is here — the lifecycle, the designed 403,
 * the owner-only flag, the delete guard naming workflows, the scope preview and its commit,
 * stats over a stated window, drafts never active, and the code view's round trip. The same
 * lifecycle runs against PostgreSQL in `skills.integration-spec.ts`.
 */

const ORG = "acme-robotics-id";
const PUBLISHER = "user-ken";
const NOW = new Date("2026-09-29T12:00:00Z");

/**
 * A skill document.
 *
 * @param body - The markdown.
 * @param extra - More frontmatter lines.
 * @returns The file.
 */
function doc(body: string, extra: string[] = []): string {
  return [
    "---",
    "name: Zephyr conventions",
    "description: Kconfig, devicetree & ISR-safety house rules",
    ...extra,
    "---",
    "",
    body,
  ].join("\n");
}

/**
 * The envelope a call refused with.
 *
 * @param call - The promise that must reject.
 * @returns Its status, code, message and details.
 */
async function refusal(call: Promise<unknown>): Promise<{
  status: number;
  code: string;
  message: string;
  details: Record<string, unknown>;
}> {
  return call.then(
    () => {
      throw new Error("expected this call to be refused, and it resolved");
    },
    (error: unknown) => {
      const refused = error as {
        getStatus(): number;
        getResponse(): { code: string; message: string; details: Record<string, unknown> };
      };

      return { status: refused.getStatus(), ...refused.getResponse() };
    },
  );
}

describe("the skills service", () => {
  let store: SkillStore;
  let service: SkillsService;

  /** Create the zephyr-conventions skill, repo-scoped, and answer its slug. */
  async function created(): Promise<string> {
    const detail = await service.create(ORG, {
      text: doc("Prefer k_msgq."),
      scope: "repo",
      repoRef: "acme-robotics/helios-firmware",
    });

    return detail.skill.slug;
  }

  beforeEach(() => {
    store = new SkillStore();
    const database = {
      transaction: jest.fn((work: (trx: unknown) => Promise<unknown>) => work({})),
    } as unknown as DatabaseService;

    service = new SkillsService(store.asRepository() as unknown as SkillsRepository, database);
  });

  describe("the lifecycle — create, draft-save, publish, and a new version", () => {
    it("round-trips, and a published version is never revised", async () => {
      const slug = await created();
      const opened = await service.read(ORG, slug);

      expect(slug).toBe("zephyr-conventions");
      expect(opened.version).toBeNull();
      expect(opened.skill).toMatchObject({ currentVersion: null, active: false });

      const saved = await service.saveDraft(ORG, slug, opened.draftEtag, doc("v1 body"));
      const v1 = await service.publish(ORG, slug, { changeNote: "First." }, PUBLISHER, NOW);

      expect(saved.body).toBe("v1 body");
      expect(v1).toMatchObject({
        version: 1,
        body: "v1 body",
        changeNote: "First.",
        publishedBy: PUBLISHER,
      });

      // No draft after a publish: the next edit starts one, from the empty slot's etag.
      const afterV1 = await service.read(ORG, slug);

      expect(afterV1.draft).toBeNull();
      expect(afterV1.draftEtag).toBe(NO_DRAFT);

      await service.saveDraft(ORG, slug, NO_DRAFT, doc("v2 body"));
      const v2 = await service.publish(ORG, slug, {}, PUBLISHER, NOW);

      expect(v2.version).toBe(2);
      expect((await service.read(ORG, slug, 1)).version).toMatchObject({
        version: 1,
        body: "v1 body",
      });
      expect((await service.read(ORG, slug)).skill).toMatchObject({
        currentVersion: 2,
        active: true,
      });
      expect(
        (await service.versions(ORG, slug, {})).items.map((row) => [row.version, row.isCurrent]),
      ).toEqual([
        [2, true],
        [1, false],
      ]);
    });

    it("takes the row's name and description from the published frontmatter", async () => {
      const slug = await created();
      const { draftEtag } = await service.read(ORG, slug);

      await service.saveDraft(
        ORG,
        slug,
        draftEtag,
        doc("body").replace("name: Zephyr conventions", "name: Zephyr house rules"),
      );
      await service.publish(ORG, slug, {}, PUBLISHER, NOW);

      expect((await service.read(ORG, slug)).skill.name).toBe("Zephyr house rules");
    });
  });

  describe("create", () => {
    it("builds the slug from the name, and refuses one already taken", async () => {
      await created();

      expect(
        await refusal(service.create(ORG, { text: doc("x"), scope: "repo", repoRef: "a/b" })),
      ).toMatchObject({ status: 409, code: "skill_slug_taken" });
    });

    it("refuses a document that does not read, writing nothing", async () => {
      const refused = await refusal(service.create(ORG, { text: "no fence" }));

      expect(refused).toMatchObject({ status: 422, code: "skill_document_invalid" });
      expect(store.skills).toEqual([]);
    });

    it("refuses a scope whose referent is missing, extra, or another workspace's", async () => {
      expect(await refusal(service.create(ORG, { text: doc("x"), scope: "repo" }))).toMatchObject({
        code: "skill_scope_invalid",
      });
      expect(
        await refusal(service.create(ORG, { text: doc("x"), scope: "org", repoRef: "a/b" })),
      ).toMatchObject({ code: "skill_scope_invalid" });
      expect(
        await refusal(
          service.create(ORG, {
            text: doc("x"),
            scope: "workflow",
            workflowId: "00000000-0000-4000-8000-000000000000",
          }),
        ),
      ).toMatchObject({ code: "skill_scope_invalid" });
    });

    it("refuses a frontmatter that declares another scope than the one asked for", async () => {
      expect(
        await refusal(service.create(ORG, { text: doc("x", ["scope: repo"]), scope: "org" })),
      ).toMatchObject({ status: 422, code: "skill_scope_mismatch" });
    });

    it("takes the scope the frontmatter declares when the request names none", async () => {
      const detail = await service.create(ORG, { text: doc("x", ["scope: org"]) });

      expect(detail.skill.scope).toBe("org");
    });
  });

  describe("draft-save", () => {
    it("requires If-Match, refuses a stale one, and leaves the draft alone either way", async () => {
      const slug = await created();
      const { draftEtag } = await service.read(ORG, slug);

      expect(await refusal(service.saveDraft(ORG, slug, undefined, doc("x")))).toMatchObject({
        status: 400,
        code: "skill_draft_etag_required",
      });

      await service.saveDraft(ORG, slug, draftEtag, doc("first writer"));

      expect(await refusal(service.saveDraft(ORG, slug, draftEtag, doc("second")))).toMatchObject({
        status: 409,
        code: "skill_draft_conflict",
      });
      expect((await service.read(ORG, slug)).draft?.body).toBe("first writer");
    });

    it("refuses a file that does not read, and the stored draft is unchanged", async () => {
      const slug = await created();
      const { draftEtag, draft } = await service.read(ORG, slug);

      expect(
        await refusal(service.saveDraft(ORG, slug, draftEtag, "---\nname: a\n---\nbody")),
      ).toMatchObject({ status: 422, code: "skill_document_invalid" });
      expect((await service.read(ORG, slug)).draft).toEqual(draft);
    });

    it("answers 404 for a skill this workspace does not have", async () => {
      expect(
        await refusal(service.saveDraft("another-org", "zephyr-conventions", "*", doc("x"))),
      ).toMatchObject({
        status: 404,
        code: "skill_not_found",
      });
    });
  });

  describe("publish", () => {
    it("refuses when there is no draft", async () => {
      const slug = await created();

      await service.publish(ORG, slug, {}, PUBLISHER, NOW);

      expect(await refusal(service.publish(ORG, slug, {}, PUBLISHER, NOW))).toMatchObject({
        status: 409,
        code: "skill_draft_absent",
      });
    });

    it("refuses an empty body — a published skill says something", async () => {
      const slug = await created();
      const { draftEtag } = await service.read(ORG, slug);

      await service.saveDraft(ORG, slug, draftEtag, doc(""));

      expect(await refusal(service.publish(ORG, slug, {}, PUBLISHER, NOW))).toMatchObject({
        status: 422,
        code: "skill_document_invalid",
      });
    });

    it("refuses a draft declaring another scope than the skill's", async () => {
      const slug = await created();
      const { draftEtag } = await service.read(ORG, slug);

      await service.saveDraft(ORG, slug, draftEtag, doc("x", ["scope: org"]));

      expect(await refusal(service.publish(ORG, slug, {}, PUBLISHER, NOW))).toMatchObject({
        status: 422,
        code: "skill_scope_mismatch",
        details: { declared: "org", actual: "repo" },
      });
    });

    it("refuses when the draft moved while it was being checked", async () => {
      const slug = await created();
      const draft = await store.draftOf(store.skills[0].id);

      // The second read — inside the transaction — sees another writer's edit.
      store.draftOf
        .mockResolvedValueOnce(draft)
        .mockResolvedValueOnce({ ...(draft as NonNullable<typeof draft>), body: "moved" });

      expect(await refusal(service.publish(ORG, slug, {}, PUBLISHER, NOW))).toMatchObject({
        status: 409,
        code: "skill_draft_conflict",
      });
      expect(store.publish).not.toHaveBeenCalled();
    });

    it("turns a lost numbering race into a conflict", async () => {
      const slug = await created();

      store.publish.mockRejectedValueOnce(
        Object.assign(new Error("dup"), {
          code: "23505",
          constraint: "skill_versions_skill_version_key",
        }),
      );

      expect(await refusal(service.publish(ORG, slug, {}, PUBLISHER, NOW))).toMatchObject({
        status: 409,
        code: "skill_publish_conflict",
      });
    });
  });

  describe("the required lock", () => {
    /** hil-safety, published and required. */
    async function locked(): Promise<string> {
      const detail = await service.create(ORG, {
        text: doc("Interlocks first.").replace("name: Zephyr conventions", "name: hil-safety"),
        scope: "repo",
        repoRef: "acme-robotics/helios-firmware",
      });

      await service.publish(ORG, detail.skill.slug, {}, PUBLISHER, NOW);
      await service.update(ORG, detail.skill.slug, { required: true }, ["owner"]);

      return detail.skill.slug;
    }

    it("refuses to disable a required skill with the designed, machine-readable 403", async () => {
      const slug = await locked();

      expect(await refusal(service.update(ORG, slug, { enabled: false }, ["owner"]))).toEqual({
        status: 403,
        code: "skill_required_locked",
        message: REQUIRED_LOCK_MESSAGE,
        details: { slug, reason: REQUIRED_LOCK_REASON },
      });
      expect(REQUIRED_LOCK_MESSAGE).toBe("required by policy — cannot disable");
      expect((await service.read(ORG, slug)).skill.enabled).toBe(true);
    });

    it("holds changing `required` to an owner, whichever way", async () => {
      const slug = await locked();

      for (const roles of [["admin"], ["member"], ["viewer"]] as const) {
        expect(await refusal(service.update(ORG, slug, { required: false }, roles))).toMatchObject({
          status: 403,
          code: "skill_required_owner_only",
          details: { role: roles[0], requiredRoles: ["owner"] },
        });
      }

      const other = await created();

      expect(
        await refusal(service.update(ORG, other, { required: true }, ["admin"])),
      ).toMatchObject({
        code: "skill_required_owner_only",
      });
    });

    it("lets an admin send the flag unchanged, since nothing about the lock changes", async () => {
      const slug = await locked();

      await expect(service.update(ORG, slug, { required: true }, ["admin"])).resolves.toMatchObject(
        {
          required: true,
        },
      );
    });

    it("lets an owner lift the lock and switch the skill off in one request", async () => {
      const slug = await locked();

      expect(
        await service.update(ORG, slug, { required: false, enabled: false }, ["owner"]),
      ).toMatchObject({ required: false, enabled: false });
    });

    it("switches a skill on when it is made required", async () => {
      const slug = await created();

      await service.update(ORG, slug, { enabled: false }, ["admin"]);
      await service.publish(ORG, slug, {}, PUBLISHER, NOW);

      expect(await service.update(ORG, slug, { required: true }, ["owner"])).toMatchObject({
        required: true,
        enabled: true,
      });
    });

    it("refuses a required draft", async () => {
      const slug = await created();

      await service.update(ORG, slug, { draft: true }, ["owner"]);

      expect(await refusal(service.update(ORG, slug, { required: true }, ["owner"]))).toMatchObject(
        {
          status: 422,
          code: "skill_required_draft",
        },
      );
    });

    it("refuses to delete a required skill with the same designed reason", async () => {
      const slug = await locked();

      expect(await refusal(service.delete(ORG, slug))).toMatchObject({
        status: 403,
        code: "skill_required_locked",
        details: { reason: REQUIRED_LOCK_REASON },
      });
    });
  });

  describe("the draft flag", () => {
    it("refuses to promote a skill that has published nothing", async () => {
      const slug = await created();

      await service.update(ORG, slug, { draft: true }, ["admin"]);

      expect(await refusal(service.update(ORG, slug, { draft: false }, ["admin"]))).toMatchObject({
        status: 409,
        code: "skill_unpublished",
      });
    });

    it("never reports a draft as active, in the list or the stats", async () => {
      const slug = await created();

      await service.publish(ORG, slug, {}, PUBLISHER, NOW);
      await service.update(ORG, slug, { draft: true }, ["admin"]);

      const id = store.skills[0].id;
      store.usageRecords = {
        runs: [
          {
            runId: "r1",
            repoRef: "acme-robotics/helios-firmware",
            workflowSlug: "standard-fix",
            openedPr: false,
            physical: false,
          },
        ],
        carried: [{ skillId: id, runId: "r1" }],
        injections: new Map([[id, 1]]),
      };

      const list = await service.list(ORG);
      const stats = await service.stats(ORG, undefined, NOW);

      expect(list.active).toBe(0);
      expect(list.skills[0]).toMatchObject({ draft: true, active: false });
      expect(stats.skills[0]).toMatchObject({ active: false, usedBy: { label: "—" } });
    });
  });

  describe("delete", () => {
    it("is refused while a published workflow references the skill, naming every one", async () => {
      const slug = await created();
      const workflows = [
        { id: "wf-1", slug: "feature-loop", name: "Feature loop", version: 1 },
        { id: "wf-2", slug: "standard-fix", name: "Standard fix", version: 14 },
      ];
      store.references.set(slug, workflows);

      const refused = await refusal(service.delete(ORG, slug));

      expect(refused).toMatchObject({
        status: 409,
        code: "skill_referenced",
        details: { slug, workflows },
      });
      expect(refused.message).toContain("feature-loop, standard-fix");
      expect(store.skills).toHaveLength(1);
    });

    it("removes an unreferenced skill and its history", async () => {
      const slug = await created();

      await service.delete(ORG, slug);

      expect(store.skills).toEqual([]);
      expect(store.versions).toEqual([]);
      expect(await refusal(service.read(ORG, slug))).toMatchObject({ status: 404 });
    });
  });

  describe("scope moves", () => {
    const STANDARD = { id: "11111111-1111-4111-8111-111111111111", slug: "standard-fix" };

    beforeEach(() => {
      store.workflows.set(STANDARD.id, STANDARD);
    });

    it("previews the move's reach, its references and its clashes, and writes nothing", async () => {
      const slug = await created();
      store.references.set(slug, [
        { id: "wf-other", slug: "hotfix-p0", name: "Hotfix", version: 3 },
      ]);

      const preview = await service.previewScope(ORG, slug, {
        scope: "workflow",
        workflowId: STANDARD.id,
      });

      expect(preview).toMatchObject({
        from: { scope: "repo", repoRef: "acme-robotics/helios-firmware" },
        to: { scope: "workflow", workflow: STANDARD },
        reach: {
          gains: { repos: ["acme-robotics/helios-app"], workflows: [] },
          loses: { repos: [], workflows: [] },
        },
        references: [{ workflow: { slug: "hotfix-p0" }, outOfReach: true }],
        clashes: [],
      });
      expect(store.update).not.toHaveBeenCalled();
    });

    it("commits a previewed move", async () => {
      const slug = await created();
      const { previewToken } = await service.previewScope(ORG, slug, { scope: "org" });

      expect(await service.moveScope(ORG, slug, { scope: "org", previewToken })).toMatchObject({
        scope: "org",
        repoRef: null,
      });
    });

    it("refuses a commit whose preview is stale", async () => {
      const slug = await created();
      const { previewToken } = await service.previewScope(ORG, slug, { scope: "org" });

      // Something the preview reported changes before the commit: a clashing skill appears.
      await service.create(ORG, { text: doc("x"), slug: "zephyr-org", scope: "org" });

      expect(
        await refusal(service.moveScope(ORG, slug, { scope: "org", previewToken })),
      ).toMatchObject({
        status: 409,
        code: "skill_scope_preview_stale",
      });
      expect((await service.read(ORG, slug)).skill.scope).toBe("repo");
    });

    it("refuses a clashing move until it is resolved explicitly", async () => {
      const slug = await created();

      await service.create(ORG, { text: doc("x"), slug: "zephyr-org", scope: "org" });

      const preview = await service.previewScope(ORG, slug, { scope: "org" });

      expect(preview.clashes).toEqual([
        expect.objectContaining({ slug: "zephyr-org", name: "Zephyr conventions" }),
      ]);
      expect(
        await refusal(
          service.moveScope(ORG, slug, { scope: "org", previewToken: preview.previewToken }),
        ),
      ).toMatchObject({
        status: 409,
        code: "skill_scope_conflict",
        details: { clashes: preview.clashes },
      });

      expect(
        await service.moveScope(ORG, slug, {
          scope: "org",
          previewToken: preview.previewToken,
          resolve: "keep_both",
        }),
      ).toMatchObject({ scope: "org" });
    });

    it("refuses a move to where the skill already is", async () => {
      const slug = await created();

      expect(
        await refusal(
          service.previewScope(ORG, slug, {
            scope: "repo",
            repoRef: "acme-robotics/helios-firmware",
          }),
        ),
      ).toMatchObject({ status: 422, code: "skill_scope_invalid" });
    });

    it("brings a draft's declared scope along, so it can still publish", async () => {
      const slug = await created();
      const { draftEtag } = await service.read(ORG, slug);

      await service.saveDraft(ORG, slug, draftEtag, doc("x", ["scope: repo"]));

      const { previewToken } = await service.previewScope(ORG, slug, { scope: "org" });

      await service.moveScope(ORG, slug, { scope: "org", previewToken });

      expect((await service.read(ORG, slug)).draft?.frontmatter).toMatchObject({ scope: "org" });
      await expect(service.publish(ORG, slug, {}, PUBLISHER, NOW)).resolves.toMatchObject({
        version: 1,
      });
    });
  });

  describe("stats", () => {
    it("counts over 30 days by default, and states the window", async () => {
      await created();

      const stats = await service.stats(ORG, undefined, NOW);

      expect(stats.window).toEqual({
        days: 30,
        from: "2026-08-30T12:00:00.000Z",
        to: NOW.toISOString(),
      });
      expect(store.lastUsageWindow).toEqual({ from: new Date("2026-08-30T12:00:00Z"), to: NOW });
    });

    it("derives the Used-by label and the manifest count from the injection records", async () => {
      const slug = await created();

      await service.publish(ORG, slug, {}, PUBLISHER, NOW);

      const id = store.skills[0].id;
      const run = (runId: string) => ({
        runId,
        repoRef: "acme-robotics/helios-firmware",
        workflowSlug: "standard-fix",
        openedPr: false,
        physical: false,
      });
      store.usageRecords = {
        runs: [run("r1"), run("r2")],
        carried: [
          { skillId: id, runId: "r1" },
          { skillId: id, runId: "r2" },
        ],
        injections: new Map([[id, 3]]),
      };

      expect((await service.stats(ORG, 7, NOW)).skills).toEqual([
        {
          slug,
          active: true,
          usedBy: { label: "every run", carried: 2, inScope: 2 },
          injections: 3,
        },
      ]);
    });
  });

  describe("the code view's document API", () => {
    it("opens the draft editable, and a published version read-only", async () => {
      const slug = await created();
      const draftFile = await service.readCode(ORG, slug);

      expect(draftFile).toMatchObject({
        path: "skills/zephyr-conventions.skill.md",
        readOnly: false,
        version: null,
      });
      expect(draftFile.text).toContain("Prefer k_msgq.");

      await service.publish(ORG, slug, {}, PUBLISHER, NOW);

      // No draft: the version in force opens, editable.
      expect(await service.readCode(ORG, slug)).toMatchObject({ readOnly: false, version: 1 });
      expect(await service.readCode(ORG, slug, 1)).toMatchObject({ readOnly: true, version: 1 });
      expect(await refusal(service.readCode(ORG, slug, 9))).toMatchObject({
        code: "skill_version_not_found",
      });
    });

    it("round-trips an edit to a new skill version", async () => {
      const slug = await created();

      await service.publish(ORG, slug, {}, PUBLISHER, NOW);

      const opened = await service.readCode(ORG, slug);
      const edited = opened.text.replace("Prefer k_msgq.", "Prefer k_msgq in ISRs.");
      const saved = await service.saveCode(ORG, slug, opened.etag, edited);

      expect(saved).toMatchObject({ readOnly: false, version: null, text: edited });

      const v2 = await service.publish(ORG, slug, {}, PUBLISHER, NOW);

      expect(v2).toMatchObject({ version: 2, body: "Prefer k_msgq in ISRs." });
      expect((await service.readCode(ORG, slug, 2)).text).toBe(edited);
      expect((await service.readCode(ORG, slug, 1)).text).toContain("Prefer k_msgq.");
    });

    it("guards a code-view save with the same etag as the draft-save", async () => {
      const slug = await created();
      const opened = await service.readCode(ORG, slug);

      await service.saveDraft(ORG, slug, opened.etag, doc("from the other editor"));

      expect(await refusal(service.saveCode(ORG, slug, opened.etag, opened.text))).toMatchObject({
        status: 409,
        code: "skill_draft_conflict",
      });
    });
  });
});
