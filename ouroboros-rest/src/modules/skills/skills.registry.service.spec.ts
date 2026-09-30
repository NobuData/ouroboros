import type { SkillsRepository } from "./skills.repository";
import { SkillsRegistryService } from "./skills.registry.service";
import { skillRow } from "./skills.fixture";

/** What the workflow studio reads of the registry (#410). */

describe("the skills registry read", () => {
  const repository = {
    catalogSlugs: jest.fn().mockResolvedValue(["repo-map", "zephyr-conventions"]),
    list: jest
      .fn()
      .mockResolvedValue([
        skillRow({ slug: "hil-safety" }),
        skillRow({ slug: "power-budget-checks", draft: true }),
      ]),
  };
  const service = new SkillsRegistryService(repository as unknown as SkillsRepository);

  it("hands the catalog the repository's catalog slugs for the workspace", async () => {
    expect(await service.catalogSlugs("acme-robotics-id")).toEqual([
      "repo-map",
      "zephyr-conventions",
    ]);
    expect(repository.catalogSlugs).toHaveBeenCalledWith("acme-robotics-id");
  });

  it("lists every skill as a skills/<slug>.skill.md file, drafts included", async () => {
    expect(await service.codeFiles("acme-robotics-id")).toEqual([
      { path: "skills/hil-safety.skill.md", slug: "hil-safety" },
      { path: "skills/power-budget-checks.skill.md", slug: "power-budget-checks" },
    ]);
  });
});
