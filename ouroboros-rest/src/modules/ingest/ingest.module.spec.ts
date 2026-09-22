import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { IngestController } from "./ingest.controller";
import { GuardrailsModule } from "../guardrails/guardrails.module";
import { GuardrailService } from "../guardrails/guardrails.service";
import { GUARDRAIL_SCHEDULER } from "./ingest.guardrails";
import { IngestModule } from "./ingest.module";
import { IngestRepository } from "./ingest.repository";
import { IngestService } from "./ingest.service";

/**
 * The wiring, and the two decisions it encodes.
 *
 * `pricing.module.spec.ts` carries the argument for asserting wiring at all: it is the thing
 * about a Nest module that can be wrong at run time and right at compile time. Nothing here
 * connects — `pg` connects lazily and no query is issued.
 *
 * The two decisions are **the seam** — `GUARDRAIL_SCHEDULER` is injected by token and supplied
 * by AP.3's `GuardrailsModule` ([#305](https://github.com/NobuData/ouroboros/issues/305)), so
 * the service depends on an interface rather than on the evaluator — and **the empty export
 * list**, because a second
 * in-process consumer of this contract would be the read-model growing a second writer, which
 * is exactly what decision R2 exists to prevent.
 */

describe("the ingestion module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), IngestModule],
    }).compile();

    expect(moduleRef.get(IngestController)).toBeInstanceOf(IngestController);
    expect(moduleRef.get(IngestService)).toBeInstanceOf(IngestService);
    expect(moduleRef.get(IngestRepository)).toBeInstanceOf(IngestRepository);
    expect(moduleRef.get(GUARDRAIL_SCHEDULER)).toBeInstanceOf(GuardrailService);

    await moduleRef.close();
  });

  it("receives the guardrail scheduler from AP.3's module rather than binding one", () => {
    const providers = Reflect.getMetadata("providers", IngestModule) as {
      provide?: unknown;
    }[];

    expect(providers.some((provider) => provider.provide === GUARDRAIL_SCHEDULER)).toBe(false);
    expect(Reflect.getMetadata("imports", IngestModule)).toContain(GuardrailsModule);
  });

  it("registers no guard of its own", () => {
    // `InternalKeyGuard` is an `APP_GUARD` registered by `InternalModule`, and it protects
    // whatever carries `@InternalOnly()` wherever that route lives. A second registration
    // here would run the same check twice and make the protection depend on which module was
    // initialised first.
    const providers = Reflect.getMetadata("providers", IngestModule) as {
      provide?: unknown;
    }[];

    expect(providers.some((provider) => provider.provide === "APP_GUARD")).toBe(false);
  });

  it("exports nothing", () => {
    // A second in-process consumer would be a sign that the read-model had grown a second
    // writer — which is what decision R2 exists to prevent.
    expect(Reflect.getMetadata("exports", IngestModule)).toBeUndefined();
  });

  it("imports the database module, which is the answer to who may reach these tables", () => {
    // `DbModule` is deliberately non-global, so the import list is the answer to *who can
    // reach the run read-model* — the convention every module with a repository follows.
    // `GuardrailsModule` is the other import, and it brings no connection of its own.
    const imports = Reflect.getMetadata("imports", IngestModule) as { name?: string }[];

    expect(imports.map((imported) => imported.name)).toEqual(["DbModule", "GuardrailsModule"]);
  });
});
