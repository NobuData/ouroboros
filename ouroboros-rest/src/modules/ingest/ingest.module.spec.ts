import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { IngestController } from "./ingest.controller";
import {
  GUARDRAIL_SCHEDULER,
  PendingGuardrailScheduler,
  guardrailSchedulerProvider,
} from "./ingest.guardrails";
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
 * The two decisions are **the seam** — `GUARDRAIL_SCHEDULER` is bound by token, which is what
 * makes AP.3 ([#305](https://github.com/NobuData/ouroboros/issues/305)) a one-line change
 * rather than an edit to the service — and **the empty export list**, because a second
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
    expect(moduleRef.get(GUARDRAIL_SCHEDULER)).toBeInstanceOf(PendingGuardrailScheduler);

    await moduleRef.close();
  });

  it("binds the guardrail scheduler by token, which is the seam AP.3 moves", () => {
    const providers = Reflect.getMetadata("providers", IngestModule) as unknown[];

    expect(providers).toContain(guardrailSchedulerProvider);
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
    const imports = Reflect.getMetadata("imports", IngestModule) as { name?: string }[];

    expect(imports.map((imported) => imported.name)).toEqual(["DbModule"]);
  });
});
