import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { GUARDRAIL_SCHEDULER } from "../ingest/ingest.guardrails";
import { PoliciesModule } from "../policies/policies.module";
import { GuardrailsModule, guardrailSchedulerProvider } from "./guardrails.module";
import { GuardrailsRepository } from "./guardrails.repository";
import { GuardrailService } from "./guardrails.service";

/**
 * The wiring: AP.1's token and the service are one instance. The module's one import is the policy
 * plane (#481), whose resolver reads the org policy's protected globs; nothing connects — `pg`
 * connects lazily.
 */

describe("the guardrails module", () => {
  it("binds AP.1's token to the service, as the same instance", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), GuardrailsModule],
    }).compile();

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

  it("imports only the policy plane — every statement goes through the report's own transaction", () => {
    expect(Reflect.getMetadata("imports", GuardrailsModule)).toEqual([PoliciesModule]);
  });
});
