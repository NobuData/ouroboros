import { Test } from "@nestjs/testing";

import { GUARDRAIL_SCHEDULER } from "../ingest/ingest.guardrails";
import { GuardrailsModule, guardrailSchedulerProvider } from "./guardrails.module";
import { GuardrailsRepository } from "./guardrails.repository";
import { GuardrailService } from "./guardrails.service";

/** The wiring: AP.1's token and the service are one instance, and the module needs no database. */

describe("the guardrails module", () => {
  it("binds AP.1's token to the service, as the same instance", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [GuardrailsModule] }).compile();

    expect(moduleRef.get(GuardrailService)).toBeInstanceOf(GuardrailService);
    expect(moduleRef.get(GuardrailsRepository)).toBeInstanceOf(GuardrailsRepository);
    expect(moduleRef.get(GUARDRAIL_SCHEDULER)).toBe(moduleRef.get(GuardrailService));

    await moduleRef.close();
  });

  it("states the binding with useExisting, and exports both the token and the service", () => {
    expect(guardrailSchedulerProvider).toEqual({
      provide: GUARDRAIL_SCHEDULER,
      useExisting: GuardrailService,
    });
    expect(Reflect.getMetadata("exports", GuardrailsModule)).toEqual([
      GuardrailService,
      GUARDRAIL_SCHEDULER,
    ]);
  });

  it("imports nothing — every statement goes through the report's own transaction", () => {
    expect(Reflect.getMetadata("imports", GuardrailsModule)).toBeUndefined();
  });
});
