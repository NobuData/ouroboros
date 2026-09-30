/** The repo-map module's wiring ([#415](https://github.com/NobuData/ouroboros/issues/415)). */

import { SkillsRepository } from "../skills/skills.repository";
import { RepoMapController } from "./repo-map.controller";
import { RepoMapModule } from "./repo-map.module";
import { RepoMapRepository } from "./repo-map.repository";
import { RepoMapScheduler } from "./repo-map.scheduler";
import { RepoMapService } from "./repo-map.service";

describe("the repo-map module", () => {
  it("declares the route, the generator, its nightly slot and the registry's own statements", () => {
    expect(Reflect.getMetadata("controllers", RepoMapModule)).toEqual([RepoMapController]);
    expect(Reflect.getMetadata("providers", RepoMapModule)).toEqual([
      RepoMapService,
      RepoMapRepository,
      RepoMapScheduler,
      SkillsRepository,
    ]);
  });
});
