/**
 * The guardrail evaluation service — AP.3
 * ([#305](https://github.com/NobuData/ouroboros/issues/305)), decision **R5**.
 *
 * ```
 * service     GuardrailService — gathers, judges, appends       → guardrails.service.ts
 * repository  the statements, and nothing else                  → guardrails.repository.ts
 * pure        the four checks, the pinned policy, the scan      → guardrails.checks.ts
 *                                                                  guardrails.policy.ts
 *                                                                  guardrails.secrets.ts
 * data        the secrets ruleset (v3) and the CI registry      → guardrails.ruleset.ts
 *                                                                  guardrails.ci.ts
 * ```
 *
 * **It binds AP.1's token.** `IngestModule` imports this module and receives
 * `GUARDRAIL_SCHEDULER` from it, so the ingestion service keeps depending on the
 * `GuardrailScheduler` interface and never on this implementation. `useExisting` rather than
 * `useClass`, so the token and `GuardrailService` are one instance — the card's read (#304/#313)
 * can inject the service for {@link GuardrailService.disclosure} and get the same object the
 * evaluation runs through.
 *
 * It imports no `DbModule`: every statement goes through the writer the change-set report hands
 * it, which is what keeps the verdicts inside the report's transaction.
 */

import { Module } from "@nestjs/common";

import { GUARDRAIL_SCHEDULER } from "../ingest/ingest.guardrails";
import { GuardrailsRepository } from "./guardrails.repository";
import { GuardrailService } from "./guardrails.service";

/** The token binding, stated once so the module and its spec agree on it. */
export const guardrailSchedulerProvider = {
  provide: GUARDRAIL_SCHEDULER,
  useExisting: GuardrailService,
};

@Module({
  providers: [GuardrailsRepository, GuardrailService, guardrailSchedulerProvider],
  exports: [GuardrailService, GUARDRAIL_SCHEDULER],
})
export class GuardrailsModule {}
