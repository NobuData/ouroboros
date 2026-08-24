import { InvalidRequestError } from "../errors/error.envelope";
import { VALIDATION_FAILED } from "../errors/validation";
import { MODEL_PARAM_DIALECT, type ModelParamSchema } from "../providers/provider.params";
import { NO_METADATA, mergeParamSchema, type MergedParamSchema } from "./params.merge";
import { PARAMS_INVALID_MESSAGE, assertParamsValid } from "./params.validation";
import { REGISTRY_ERRORS } from "./registry.errors";

/**
 * The three refusals CH.2 ([#585](https://github.com/NobuData/ouroboros/issues/585)) names, and
 * the shape they arrive in.
 *
 * > *"Saving `{thinking: max}` against `qwen3-coder:32b` returns 422 — 'model does not support
 * > thinking' — with the field named."*
 *
 * > *"A temperature of 3.0 is rejected with the permitted range in the error."*
 *
 * The schemas below are built by `mergeParamSchema` rather than written out, deliberately: the
 * ticket's whole claim is that the form and the check are one artefact, and a suite that
 * hand-wrote the validating schema would be testing a second description of the rules.
 */

/** An adapter schema with the fields a case wants to send against. */
function adapterSchema(properties: ModelParamSchema["properties"]): ModelParamSchema {
  return {
    $schema: MODEL_PARAM_DIALECT,
    type: "object",
    title: "Test provider model parameters",
    properties,
    additionalProperties: false,
  };
}

/** What `paramSchema("qwen3-coder:32b")` merges to — no thinking anywhere. */
function localModel(): MergedParamSchema {
  return mergeParamSchema(
    adapterSchema({
      max_output: { type: "integer", title: "Max output", minimum: 1 },
      context_clamp: { type: "integer", title: "Context clamp", minimum: 1 },
      temperature: { type: "number", title: "Temperature", minimum: 0, maximum: 2 },
    }),
    NO_METADATA,
    NO_METADATA,
  );
}

/** What `paramSchema("claude-fable-5")` merges to — thinking, and a ceiling of one. */
function thinkingModel(): MergedParamSchema {
  return mergeParamSchema(
    adapterSchema({
      thinking: { type: "string", title: "Thinking", enum: ["off", "std", "max"] },
      token_budget: { type: "integer", title: "Token budget", minimum: 1, maximum: 1_000_000 },
      temperature: { type: "number", title: "Temperature", minimum: 0, maximum: 1 },
    }),
    NO_METADATA,
    NO_METADATA,
  );
}

/** The error a case expects, caught rather than asserted around. */
function refusal(call: () => void): InvalidRequestError {
  try {
    call();
  } catch (error) {
    return error as InvalidRequestError;
  }

  throw new Error("expected the write to be refused, and it was not");
}

describe("assertParamsValid", () => {
  it("accepts an alias nobody has tuned", () => {
    // Seven of mockup 21's eight rows are in this state and every newly created alias is, so a
    // schema that refused it would refuse the ordinary case.
    expect(() => assertParamsValid(localModel(), {}, "qwen3-coder:32b")).not.toThrow();
    expect(() =>
      assertParamsValid(localModel(), { params: {}, restrictions: {} }, "qwen3-coder:32b"),
    ).not.toThrow();
  });

  it("accepts what the model really supports", () => {
    expect(() =>
      assertParamsValid(
        thinkingModel(),
        { params: { thinking: "max", token_budget: 400_000 } },
        "claude-fable-5",
      ),
    ).not.toThrow();
  });

  describe("a param the model does not have", () => {
    it("is a 422 carrying the published code", () => {
      const error = refusal(() =>
        assertParamsValid(localModel(), { params: { thinking: "max" } }, "qwen3-coder:32b"),
      );

      expect(error).toBeInstanceOf(InvalidRequestError);
      expect(error.getStatus()).toBe(422);
      expect(error.code).toBe(REGISTRY_ERRORS.aliasParamsInvalid);
      expect(error.envelope().message).toBe(PARAMS_INVALID_MESSAGE);
    });

    it("names the field the inspector will map it back to", () => {
      // The path is the write body's own shape, exactly as `errors/validation.ts` addresses a
      // nested DTO — so a form maps `details` to inputs the same way for both kinds of failure.
      const error = refusal(() =>
        assertParamsValid(localModel(), { params: { thinking: "max" } }, "qwen3-coder:32b"),
      );

      expect(Object.keys(error.details)).toEqual(["params.thinking"]);
    });

    it("says which model, and what that model does accept", () => {
      // *"model does not support thinking"* alone leaves somebody guessing whether they
      // misspelled a key or picked the wrong model.
      const error = refusal(() =>
        assertParamsValid(localModel(), { params: { thinking: "max" } }, "qwen3-coder:32b"),
      );

      const [message] = (error.details as Record<string, string[]>)["params.thinking"];

      expect(message).toContain("qwen3-coder:32b does not support thinking");
      expect(message).toContain("max_output, context_clamp, temperature");
    });

    it("tells a misspelling apart from a control the model lacks", () => {
      // Two different mistakes: `temprature` is not a parameter this registry stores at all,
      // and telling somebody their model lacks it would send them looking at the wrong thing.
      const error = refusal(() =>
        assertParamsValid(localModel(), { params: { temprature: 0 } }, "qwen3-coder:32b"),
      );

      const [message] = (error.details as Record<string, string[]>)["params.temprature"];

      expect(message).toContain("is not a parameter this registry stores");
      expect(message).not.toContain("does not support");
    });

    it("says the model accepts nothing at all when it accepts nothing at all", () => {
      const fixedCatalog = mergeParamSchema(
        {
          $schema: MODEL_PARAM_DIALECT,
          type: "object",
          title: "GitHub Copilot model parameters",
          description: "Copilot is a fixed catalog and publishes no per-call parameters.",
          properties: {},
          additionalProperties: false,
        },
        NO_METADATA,
        NO_METADATA,
      );

      const error = refusal(() =>
        assertParamsValid(fixedCatalog, { params: { temperature: 0 } }, "gpt-5-codex"),
      );

      expect((error.details as Record<string, string[]>)["params.temperature"][0]).toContain(
        "it accepts no parameters at all",
      );
    });
  });

  describe("a value outside its range", () => {
    it("is refused with the permitted range in the message", () => {
      // The ticket's second criterion, verbatim.
      const error = refusal(() =>
        assertParamsValid(thinkingModel(), { params: { temperature: 3 } }, "claude-fable-5"),
      );

      expect((error.details as Record<string, string[]>)["params.temperature"]).toEqual([
        "temperature (Temperature) must be between 0 and 1",
      ]);
    });

    it("quotes the range as the merge narrowed it, not as the adapter declared it", () => {
      // A bound discovery tightened is the bound a save will actually apply, so it is the one a
      // person has to be told about.
      const clamped = mergeParamSchema(
        adapterSchema({
          context_clamp: { type: "integer", title: "Context clamp", minimum: 1 },
        }),
        { contextTokens: 32_768, maxOutputTokens: null },
        NO_METADATA,
      );

      const error = refusal(() =>
        assertParamsValid(clamped, { params: { context_clamp: 200_000 } }, "qwen3-coder:32b"),
      );

      expect((error.details as Record<string, string[]>)["params.context_clamp"][0]).toContain(
        "between 1 and 32768",
      );
    });

    it("refuses a value below the floor too", () => {
      // Zero is the interesting one: not a small budget, an instruction to produce nothing.
      const error = refusal(() =>
        assertParamsValid(thinkingModel(), { params: { token_budget: 0 } }, "claude-fable-5"),
      );

      expect((error.details as Record<string, string[]>)["params.token_budget"][0]).toContain(
        "between 1 and 1000000",
      );
    });
  });

  describe("a value of the wrong shape", () => {
    it("names the type a person would recognise rather than JSON Schema's word", () => {
      const error = refusal(() =>
        assertParamsValid(
          thinkingModel(),
          { params: { token_budget: 4096.5, temperature: "hot" } },
          "claude-fable-5",
        ),
      );

      expect((error.details as Record<string, string[]>)["params.token_budget"]).toEqual([
        "token_budget (Token budget) must be a whole number",
      ]);
      expect((error.details as Record<string, string[]>)["params.temperature"]).toEqual([
        "temperature (Temperature) must be a number",
      ]);
    });

    it("coerces nothing — a number sent as a string is a mistake, not a formatting choice", () => {
      // A client that sent `"0.2"` meant to, and a form that submitted one has a bug the
      // coercion would hide until a request body carried it to a provider.
      expect(() =>
        assertParamsValid(thinkingModel(), { params: { temperature: "0.2" } }, "claude-fable-5"),
      ).toThrow(InvalidRequestError);
    });

    it("lists the choices when a choice field is sent something else", () => {
      const error = refusal(() =>
        assertParamsValid(thinkingModel(), { params: { thinking: "maximum" } }, "claude-fable-5"),
      );

      expect((error.details as Record<string, string[]>)["params.thinking"]).toEqual([
        "thinking (Thinking) must be one of off, std, max",
      ]);
    });
  });

  describe("the restrictions half", () => {
    it("is checked against this workspace's vocabulary rather than the model's", () => {
      const error = refusal(() =>
        assertParamsValid(
          localModel(),
          { restrictions: { review_vote_only: "yes" } },
          "qwen3-coder:32b",
        ),
      );

      expect((error.details as Record<string, string[]>)["restrictions.review_vote_only"]).toEqual([
        "review_vote_only (Review vote only) must be true or false",
      ]);
    });

    it("names no model when it refuses a flag, because no model is involved", () => {
      const error = refusal(() =>
        assertParamsValid(localModel(), { restrictions: { batch_okay: true } }, "qwen3-coder:32b"),
      );

      const [message] = (error.details as Record<string, string[]>)["restrictions.batch_okay"];

      expect(message).toContain("is not a restriction this registry has");
      expect(message).not.toContain("qwen3-coder:32b");
    });

    it("is offered on an unbound alias, where the params half refuses everything", () => {
      // The point of serving the two apart: an alias with no provider can still be restricted,
      // and a write that set a restriction on one must succeed.
      const unbound = mergeParamSchema(null, NO_METADATA, NO_METADATA);

      expect(() =>
        assertParamsValid(unbound, { restrictions: { batch_ok: true } }, "gpt-5.2-preview"),
      ).not.toThrow();
      expect(() =>
        assertParamsValid(unbound, { params: { temperature: 0 } }, "gpt-5.2-preview"),
      ).toThrow(InvalidRequestError);
    });
  });

  describe("a write wrong in several places", () => {
    it("reports every field at once rather than the first", () => {
      // One answer rather than a client fixing one field per round trip.
      const error = refusal(() =>
        assertParamsValid(
          thinkingModel(),
          { params: { thinking: "ultra", temperature: 3 }, restrictions: { batch_ok: "yes" } },
          "claude-fable-5",
        ),
      );

      expect(Object.keys(error.details).sort()).toEqual([
        "params.temperature",
        "params.thinking",
        "restrictions.batch_ok",
      ]);
    });

    it("keeps two complaints about one field, deduplicated", () => {
      // `allErrors` means a field can be wrong twice, and a form showing one of the two sends
      // somebody back for a second attempt.
      const error = refusal(() =>
        assertParamsValid(thinkingModel(), { params: { token_budget: -1.5 } }, "claude-fable-5"),
      );

      const messages = (error.details as Record<string, string[]>)["params.token_budget"];

      expect(messages.length).toBeGreaterThan(1);
      expect(new Set(messages).size).toBe(messages.length);
    });
  });

  it("carries its own code rather than the DTO pipe's", () => {
    // Both are 422s with the same `details` shape, and they mean different things: one is *the
    // body is malformed* and this is *the body is fine and the model refuses it*. A client that
    // wanted to say so — the inspector does — could not tell them apart from the status.
    const error = refusal(() =>
      assertParamsValid(localModel(), { params: { thinking: "max" } }, "qwen3-coder:32b"),
    );

    expect(error.code).not.toBe(VALIDATION_FAILED);
    expect(error.code).toBe("model_alias_params_invalid");
  });
});
