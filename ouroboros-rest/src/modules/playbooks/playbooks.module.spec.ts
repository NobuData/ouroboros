/** The playbooks module's wiring ([#415](https://github.com/NobuData/ouroboros/issues/415)). */

import { PlaybooksController } from "./playbooks.controller";
import { PlaybooksModule } from "./playbooks.module";
import { PlaybooksRepository } from "./playbooks.repository";
import { PlaybooksService } from "./playbooks.service";

describe("the playbooks module", () => {
  it("declares its routes and layers, and exports nothing", () => {
    expect(Reflect.getMetadata("controllers", PlaybooksModule)).toEqual([PlaybooksController]);
    expect(Reflect.getMetadata("providers", PlaybooksModule)).toEqual([
      PlaybooksService,
      PlaybooksRepository,
    ]);
    expect(Reflect.getMetadata("exports", PlaybooksModule)).toBeUndefined();
  });
});
