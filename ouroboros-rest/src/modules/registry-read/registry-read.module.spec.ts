import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { RegistryReadController } from "./registry-read.controller";
import { RegistryReadModule } from "./registry-read.module";
import { RegistryReadRepository } from "./registry-read.repository";
import { RegistryReadService } from "./registry-read.service";

/**
 * The wiring — the one thing about a Nest module that can be wrong at run time and right at
 * compile time; `tenancy.module.spec.ts` carries the argument. Nothing connects: `pg` connects
 * lazily, and no query is issued.
 *
 * Two of these assertions are decisions rather than checks.
 *
 * **The absent `ProvidersModule` is decision R8, made structural.** Alias health is *composed*
 * and no alias-level synthetic call is ever made — and the way that is guaranteed rather than
 * remembered is that `ModelProviderRegistry` is not injectable here. The import that would
 * change it is a visible edit that fails this assertion first; the *behavioural* half, that a
 * real request reaches no adapter, is counted in `registry-read.integration-spec.ts`.
 *
 * **The exports list is empty, and stays that way.** This module's one consumer is a browser.
 * A service that wants an alias's binding reads `RegistryService`; one that wants the alias
 * itself reads `AliasesService`. Composing them for a page is not an internal contract.
 */

/**
 * One of this module's files, with its commentary removed.
 *
 * Comments are stripped for the reason `registry.repository.spec.ts` strips them from the same
 * kind of assertion: three files here *discuss* the adapter registry — arguing why they cannot
 * reach one is most of what their headers are for — and a probe that could not tell a header
 * from an import would force the reasoning out of the files that need it most.
 *
 * @param file - The file, relative to this directory.
 * @returns Its lines that are not commentary.
 */
function code(file: string): string {
  return readFileSync(join(__dirname, file), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");
}

describe("the registry read module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), RegistryReadModule],
    }).compile();

    expect(moduleRef.get(RegistryReadService)).toBeInstanceOf(RegistryReadService);
    expect(moduleRef.get(RegistryReadRepository)).toBeInstanceOf(RegistryReadRepository);
    expect(moduleRef.get(RegistryReadController)).toBeInstanceOf(RegistryReadController);

    await moduleRef.close();
  });

  it("declares exactly one controller — the composed read, and no write", () => {
    // Every write mockup 21 can make is CH.1's (#584) and is role-gated there. A second entry
    // in this list would be a surface arriving, and this is where that has to be said out loud.
    expect(Reflect.getMetadata("controllers", RegistryReadModule) as unknown[] | undefined).toEqual(
      [RegistryReadController],
    );
  });

  it("imports the four modules it composes from, and no adapter registry", () => {
    const imports =
      (Reflect.getMetadata("imports", RegistryReadModule) as { name?: string }[]) ?? [];

    expect(imports.map((imported) => imported.name)).toEqual([
      "DbModule",
      "RegistryModule",
      "PricingModule",
      "VaultModule",
    ]);
    expect(imports.map((imported) => imported.name)).not.toContain("ProvidersModule");
  });

  it("exports nothing", () => {
    expect(
      Reflect.getMetadata("exports", RegistryReadModule) as unknown[] | undefined,
    ).toBeUndefined();
  });

  describe("decision R8, as something the code cannot express", () => {
    it("names no adapter and no provider registry anywhere in the module", () => {
      // The structural half of *zero adapter calls*. `.dependency-cruiser.cjs`'s
      // `core-imports-the-spi-only` rule refuses an adapter import outright; this refuses the
      // registry that is the only legitimate door to one, which the cruiser deliberately allows
      // everywhere else.
      for (const file of [
        "registry-read.service.ts",
        "registry-read.repository.ts",
        "registry-read.controller.ts",
        "registry-read.resources.ts",
        "alias.health.ts",
      ]) {
        expect(code(file)).not.toContain("ModelProviderRegistry");
      }
    });

    it("derives the chips from the stored documents rather than from a param schema", () => {
      // `ParamSchemaService` *does* reach an adapter, because a param schema is whatever the
      // bound adapter says it is. The chips do not need one: they are a pure function of the two
      // columns, and using the schema service here would have made this read cost a provider
      // call per binding.
      const composed = code("registry-read.resources.ts");

      expect(composed).toContain("paramChips");
      expect(composed).not.toContain("ParamSchemaService");
      expect(code("registry-read.service.ts")).not.toContain("ParamSchemaService");
    });
  });
});
