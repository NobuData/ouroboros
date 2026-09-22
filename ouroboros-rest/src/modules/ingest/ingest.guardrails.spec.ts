import { GUARDRAIL_SCHEDULER, InjectGuardrailScheduler } from "./ingest.guardrails";

/**
 * The seam between a change-set report and the evaluator that judges it.
 *
 * AP.1 ([#303](https://github.com/NobuData/ouroboros/issues/303)) owns the contract and AP.3
 * ([#305](https://github.com/NobuData/ouroboros/issues/305)) supplies the implementation from
 * `GuardrailsModule`. What is left in this file is the token and its decorator, and both are
 * load-bearing: a token renamed on one side is an injection that fails at boot.
 */

describe("the guardrail scheduler token", () => {
  it("is namespaced, because a token lives in one flat space", () => {
    expect(GUARDRAIL_SCHEDULER).toBe("ouroboros:ingest:guardrail-scheduler");
  });

  it("is what the decorator injects", () => {
    class Consumer {
      constructor(@InjectGuardrailScheduler() readonly scheduler: unknown) {}
    }

    const injected = Reflect.getMetadata("self:paramtypes", Consumer) as {
      index: number;
      param: unknown;
    }[];

    expect(injected).toEqual([{ index: 0, param: GUARDRAIL_SCHEDULER }]);
  });
});
