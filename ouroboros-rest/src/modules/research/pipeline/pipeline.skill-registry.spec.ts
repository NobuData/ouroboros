import type { DatabaseService } from "../../db/db.service";
import type { SkillsRepository } from "../../skills/skills.repository";
import { PIPELINE_ERRORS } from "./pipeline.errors";
import { ORG } from "./pipeline.fixture";
import { PipelineSkillRegistry, skillStamp } from "./pipeline.skill-registry";
import { CREATE_ISSUES_BODY, CREATE_ROADMAP_BODY, SHIPPED_SKILLS } from "./pipeline.skills";

interface StoredSkill {
  id: string;
  slug: string;
  current_version: number | null;
  origin: string;
  versions: {
    id: string;
    version: number | null;
    body: string;
    frontmatter: unknown;
    note?: string;
    by?: string | null;
  }[];
}

/** The registry's statements over a list — enough of `SkillsRepository` for the pipeline. */
function memorySkills() {
  const skills: StoredSkill[] = [];
  const trx = { marker: "trx" };
  const transaction = jest.fn(async (work: (handle: unknown) => Promise<unknown>) => work(trx));
  const repository = {
    findBySlug: jest.fn((_org: string, slug: string) =>
      Promise.resolve(skills.find((skill) => skill.slug === slug)),
    ),
    versionAt: jest.fn((skillId: string, version: number) =>
      Promise.resolve(
        skills
          .find((skill) => skill.id === skillId)
          ?.versions.find((row) => row.version === version),
      ),
    ),
    create: jest.fn(
      (
        _org: string,
        input: { slug: string; origin: string; body: string; frontmatter: unknown },
      ) => {
        const skill: StoredSkill = {
          id: `skill-${String(skills.length + 1)}`,
          slug: input.slug,
          current_version: null,
          origin: input.origin,
          versions: [
            { id: "draft-1", version: null, body: input.body, frontmatter: input.frontmatter },
          ],
        };

        skills.push(skill);

        return Promise.resolve(skill.id);
      },
    ),
    draftOf: jest.fn((skillId: string) =>
      Promise.resolve(
        skills.find((skill) => skill.id === skillId)?.versions.find((row) => row.version === null),
      ),
    ),
    publish: jest.fn(
      (
        skillId: string,
        draftId: string,
        input: { changeNote: string; publishedBy: string | null },
      ) => {
        const skill = skills.find((candidate) => candidate.id === skillId) as StoredSkill;
        const draft = skill.versions.find(
          (row) => row.id === draftId,
        ) as StoredSkill["versions"][number];

        draft.version = 1;
        draft.note = input.changeNote;
        draft.by = input.publishedBy;
        skill.current_version = 1;

        return Promise.resolve(draft);
      },
    ),
  };
  const registry = new PipelineSkillRegistry(
    { transaction } as unknown as DatabaseService,
    repository as unknown as SkillsRepository,
  );

  return { registry, repository, skills, transaction, trx };
}

describe("the pipeline's skills in the registry", () => {
  it("ships the procedure to a workspace that has none: generated, published by nobody, in one transaction", async () => {
    const { registry, repository, skills, transaction, trx } = memorySkills();
    const resolved = await registry.resolve(ORG, "create-roadmap");

    expect(resolved).toEqual({ slug: "create-roadmap", version: 1, body: CREATE_ROADMAP_BODY });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(repository.create).toHaveBeenCalledWith(
      ORG,
      {
        slug: "create-roadmap",
        name: "create-roadmap",
        description: SHIPPED_SKILLS["create-roadmap"].description,
        scope: "org",
        repoRef: null,
        workflowId: null,
        origin: "generated",
        draft: false,
        frontmatter: {
          name: "create-roadmap",
          description: SHIPPED_SKILLS["create-roadmap"].description,
          scope: "org",
          load: "on_trigger",
          triggers: ["create-roadmap"],
        },
        body: CREATE_ROADMAP_BODY,
      },
      trx,
    );
    expect(skills[0]?.versions[0]).toMatchObject({
      version: 1,
      note: "Shipped procedure",
      by: null,
    });
  });

  it("runs the workspace's own published version once it has one — and ships nothing over it", async () => {
    const { registry, repository, skills } = memorySkills();

    await registry.resolve(ORG, "create-issues");

    const skill = skills[0];

    skill.versions.push({ id: "v2", version: 2, body: "# Our own procedure", frontmatter: {} });
    skill.current_version = 2;

    expect(await registry.resolve(ORG, "create-issues")).toEqual({
      slug: "create-issues",
      version: 2,
      body: "# Our own procedure",
    });
    expect(repository.create).toHaveBeenCalledTimes(1);
  });

  it("refuses a skill that exists but was never published", async () => {
    const { registry, skills, repository } = memorySkills();

    skills.push({
      id: "skill-1",
      slug: "create-roadmap",
      current_version: null,
      origin: "authored",
      versions: [],
    });

    await expect(registry.resolve(ORG, "create-roadmap")).rejects.toMatchObject({
      code: PIPELINE_ERRORS.skillUnpublished,
      details: { slug: "create-roadmap" },
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("refuses a pointer to a version that is not there", async () => {
    const { registry, skills } = memorySkills();

    skills.push({
      id: "skill-1",
      slug: "create-roadmap",
      current_version: 3,
      origin: "authored",
      versions: [],
    });

    await expect(registry.resolve(ORG, "create-roadmap")).rejects.toMatchObject({
      code: PIPELINE_ERRORS.skillUnpublished,
    });
  });

  it("runs the other request's skill when two ship at once", async () => {
    const { registry, repository, skills } = memorySkills();

    repository.create.mockImplementationOnce(() => {
      skills.push({
        id: "skill-9",
        slug: "create-roadmap",
        current_version: 1,
        origin: "generated",
        versions: [{ id: "v1", version: 1, body: CREATE_ROADMAP_BODY, frontmatter: {} }],
      });

      return Promise.reject(Object.assign(new Error("duplicate key"), { code: "23505" }));
    });

    expect((await registry.resolve(ORG, "create-roadmap")).version).toBe(1);
  });

  it("does not swallow any other failure to ship", async () => {
    const { registry, repository } = memorySkills();

    repository.create.mockRejectedValue(new Error("the database went away"));

    await expect(registry.resolve(ORG, "create-roadmap")).rejects.toThrow("the database went away");
  });

  it("fails loudly if the first draft is not there to publish", async () => {
    const { registry, repository } = memorySkills();

    repository.draftOf.mockResolvedValue(undefined);

    await expect(registry.resolve(ORG, "create-issues")).rejects.toThrow(
      "The first draft of create-issues vanished.",
    );
  });

  it("stamps a run with the skill and its version", () => {
    expect(skillStamp({ slug: "create-issues", version: 12, body: CREATE_ISSUES_BODY })).toBe(
      "create-issues@v12",
    );
  });
});
