import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { VALIDATION_FAILED, validationPipe } from "../errors/validation";
import {
  DeletePriceOverrideQuery,
  ListPriceOverridesQuery,
  MAX_MODEL_ID_LENGTH,
  MAX_RATE_CENTS_PER_1M,
  PutPriceOverrideDto,
  isStorableRate,
} from "./pricing.dto";

/**
 * The request grammar, and the four amount rules it restates.
 *
 * The database is still the authority — V012's amount CHECKs are what actually make a seat row
 * incapable of carrying a rate. What is asserted here is that the *client* is told which field
 * was wrong, rather than being handed a `500` from a constraint whose message they may not be
 * shown. Every case below is one of V012's rules seen from the side of the person typing.
 */

/** Validate a body the way the pipe would, and report which fields were refused. */
async function refusalsOf(type: unknown, body: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(type as new () => object, body));

  return errors.map((error) => error.property).sort();
}

/** The refusal messages for one field, for the assertions that are about what was said. */
async function messagesFor(type: unknown, body: unknown, field: string): Promise<string[]> {
  const errors = await validate(plainToInstance(type as new () => object, body));

  return Object.values(errors.find((error) => error.property === field)?.constraints ?? {});
}

/** A well-formed per-token correction, which the cases below vary one field of. */
const TOKEN_BODY = {
  connectionKind: "anthropic",
  modelId: "claude-fable-5",
  billingMode: "token",
  inputCentsPer1m: 1200,
  outputCentsPer1m: 6000,
};

describe("the override body", () => {
  describe("the lookup key", () => {
    it("accepts a well-formed pair", async () => {
      await expect(refusalsOf(PutPriceOverrideDto, TOKEN_BODY)).resolves.toEqual([]);
    });

    it.each([
      ["anthropic"],
      ["openai_compatible"],
      ["azure.openai"],
      ["some-vendor"],
      ["Anthropic"],
      ["*"],
    ])("accepts %s as a provider kind", async (connectionKind) => {
      // Capitals are accepted because the service folds before it writes: `Anthropic` is not a
      // mistake, it is the same kind spelled differently, and refusing it would refuse a
      // request this service knows exactly what to do with.
      await expect(
        refusalsOf(PutPriceOverrideDto, { ...TOKEN_BODY, connectionKind }),
      ).resolves.toEqual([]);
    });

    it.each([[""], ["-anthropic"], ["anthropic-"], ["an..thropic"], ["anthropic/openai"], ["a b"]])(
      "refuses %p as a provider kind",
      async (connectionKind) => {
        await expect(
          refusalsOf(PutPriceOverrideDto, { ...TOKEN_BODY, connectionKind }),
        ).resolves.toEqual(["connectionKind"]);
      },
    );

    it.each([["claude-fable-5"], ["qwen3-coder:32b"], ["openai/gpt-oss-120b"], ["GPT-5"], ["*"]])(
      "accepts %s as a model identifier",
      async (modelId) => {
        // Unfolded and permissive: a model identifier is a name the vendor chose, and some of
        // them carry capitals, colons and slashes.
        await expect(refusalsOf(PutPriceOverrideDto, { ...TOKEN_BODY, modelId })).resolves.toEqual(
          [],
        );
      },
    );

    it.each([[""], [" "], ["gpt-*"], ["*-preview"], [" claude-fable-5"], ["claude-fable-5 "]])(
      "refuses %p as a model identifier",
      async (modelId) => {
        // `*` is the only wildcard there is — `model_prices_match_model_format` — so a `*`
        // inside an identifier is refused rather than treated as a prefix glob nothing
        // implements.
        await expect(refusalsOf(PutPriceOverrideDto, { ...TOKEN_BODY, modelId })).resolves.toEqual([
          "modelId",
        ]);
      },
    );

    it.each([[3], [null], [true], [{}], [["anthropic"]]])(
      "refuses %p, which is not a string, without crashing the pipe",
      async (connectionKind) => {
        // A validator handed a non-string has to *refuse* rather than throw: `@Matches` and
        // `@MaxLength` both do, and a body from a client is exactly where a number turns up in
        // a field that wanted a name.
        await expect(
          refusalsOf(PutPriceOverrideDto, { ...TOKEN_BODY, connectionKind }),
        ).resolves.toEqual(["connectionKind"]);
      },
    );

    it("refuses a model identifier past the column's length", async () => {
      await expect(
        refusalsOf(PutPriceOverrideDto, {
          ...TOKEN_BODY,
          modelId: "m".repeat(MAX_MODEL_ID_LENGTH + 1),
        }),
      ).resolves.toEqual(["modelId"]);
    });
  });

  describe("the billing mode", () => {
    it.each([["token"], ["seat"], ["usage"], ["free"]])("accepts %s", async (billingMode) => {
      const amounts =
        billingMode === "token" ? { inputCentsPer1m: 1200, outputCentsPer1m: 6000 } : {};

      await expect(
        refusalsOf(PutPriceOverrideDto, {
          connectionKind: "anthropic",
          modelId: "claude-fable-5",
          billingMode,
          ...amounts,
        }),
      ).resolves.toEqual([]);
    });

    it.each([["prepaid"], ["TOKEN"], [""], [null], [3]])("refuses %p", async (billingMode) => {
      await expect(
        refusalsOf(PutPriceOverrideDto, { ...TOKEN_BODY, billingMode }),
      ).resolves.toContain("billingMode");
    });
  });

  describe("the amounts, against the billing mode", () => {
    it("requires both rates for a token price", async () => {
      // `model_prices_token_requires_amounts`. Half a price would render half a cell and,
      // worse, would total as if the missing half were free.
      await expect(
        refusalsOf(PutPriceOverrideDto, { ...TOKEN_BODY, inputCentsPer1m: undefined }),
      ).resolves.toEqual(["inputCentsPer1m"]);
      await expect(
        refusalsOf(PutPriceOverrideDto, { ...TOKEN_BODY, outputCentsPer1m: undefined }),
      ).resolves.toEqual(["outputCentsPer1m"]);
    });

    it("refuses a token price of nothing in both directions", async () => {
      // `model_prices_token_amounts_meaningful`. That row is a free model wearing the wrong
      // mode, and it would render `$0` for something somebody is being invoiced for. Reported
      // against `billingMode`, because neither amount is wrong on its own.
      await expect(
        refusalsOf(PutPriceOverrideDto, {
          ...TOKEN_BODY,
          inputCentsPer1m: 0,
          outputCentsPer1m: 0,
        }),
      ).resolves.toEqual(["billingMode"]);
    });

    it("allows one direction of a token price to be free", async () => {
      // A real vendor arrangement, and legal in V012 for that reason.
      await expect(
        refusalsOf(PutPriceOverrideDto, { ...TOKEN_BODY, inputCentsPer1m: 0 }),
      ).resolves.toEqual([]);
    });

    it.each([["seat"], ["usage"]])("refuses a rate on a %s price", async (billingMode) => {
      // `model_prices_metered_amounts_absent`. A per-token amount on one of these rows is a
      // number that would be multiplied by a token count and charged to somebody, and there is
      // no reading of it that is true.
      await expect(
        refusalsOf(PutPriceOverrideDto, {
          connectionKind: "copilot",
          modelId: "*",
          billingMode,
          inputCentsPer1m: 1200,
        }),
      ).resolves.toEqual(["inputCentsPer1m"]);
    });

    it("accepts a free price with no rates, and with zeros", async () => {
      // `model_prices_free_amounts_zero` accepts both spellings, because both are true.
      const free = { connectionKind: "ollama", modelId: "*", billingMode: "free" };

      await expect(refusalsOf(PutPriceOverrideDto, free)).resolves.toEqual([]);
      await expect(
        refusalsOf(PutPriceOverrideDto, {
          ...free,
          inputCentsPer1m: 0,
          outputCentsPer1m: 0,
        }),
      ).resolves.toEqual([]);
    });

    it("refuses a non-zero rate on a free price", async () => {
      await expect(
        refusalsOf(PutPriceOverrideDto, {
          connectionKind: "ollama",
          modelId: "*",
          billingMode: "free",
          inputCentsPer1m: 1,
        }),
      ).resolves.toEqual(["inputCentsPer1m"]);
    });

    it("names the billing mode in what it says about an amount", async () => {
      // The message is what a form renders beside the input, so it has to say why — and the
      // why is always the mode beside it.
      const said = await messagesFor(
        PutPriceOverrideDto,
        { connectionKind: "copilot", modelId: "*", billingMode: "seat", inputCentsPer1m: 1 },
        "inputCentsPer1m",
      );

      expect(said.join(" ")).toContain("seat");
    });
  });

  describe("what a rate may be", () => {
    it.each([[0], [1], [1200], [0.0001], [1200.25], [MAX_RATE_CENTS_PER_1M]])(
      "accepts %p",
      (rate) => {
        expect(isStorableRate(rate)).toBe(true);
      },
    );

    it.each([[-1], [MAX_RATE_CENTS_PER_1M + 1], [Number.NaN], [Number.POSITIVE_INFINITY]])(
      "refuses %p",
      (rate) => {
        expect(isStorableRate(rate)).toBe(false);
      },
    );

    it("refuses a rate finer than the column's four decimal places", () => {
      // `numeric(14, 4)` would round it on the way in, and the workspace would then be shown a
      // rate it did not enter and billed against a number it never agreed to. Refusing is the
      // only answer that does not silently change what somebody typed.
      expect(isStorableRate(0.00005)).toBe(false);
      expect(isStorableRate(1200.12345)).toBe(false);
    });

    it("refuses a rate JavaScript would render in exponent form", () => {
      // Every one of those is finer than four places, which is the answer either way — but it
      // is worth an assertion, because a decimal test that read digits out of `1e-7` would say
      // it has none.
      expect(isStorableRate(1e-7)).toBe(false);
    });

    it.each([["1200"], [null], [true], [{}]])("refuses %p, which is not a number", (rate) => {
      expect(isStorableRate(rate)).toBe(false);
    });
  });

  describe("what a body may not contain", () => {
    it.each([["catalogVersion"], ["source"], ["organizationId"], ["effectiveAt"]])(
      "refuses a body carrying %s",
      async (field) => {
        // Not one of these is a client's to state: an override is not a version of anything,
        // `source` is what the row *is*, the workspace is the session's, and the stamps are the
        // server's. Asserted through the application's own pipe rather than against the class,
        // because it is `forbidNonWhitelisted` that refuses them — mass assignment closed by
        // construction rather than by picking fields off in a service.
        await expect(
          validationPipe().transform(
            { ...TOKEN_BODY, [field]: "anything" },
            { type: "body", metatype: PutPriceOverrideDto },
          ),
        ).rejects.toMatchObject({ code: VALIDATION_FAILED });
      },
    );

    it("accepts the five fields it does declare", async () => {
      await expect(
        validationPipe().transform(TOKEN_BODY, { type: "body", metatype: PutPriceOverrideDto }),
      ).resolves.toMatchObject({ connectionKind: "anthropic", billingMode: "token" });
    });
  });
});

describe("the delete query", () => {
  it("accepts a well-formed pair", async () => {
    await expect(
      refusalsOf(DeletePriceOverrideQuery, {
        connectionKind: "anthropic",
        modelId: "claude-fable-5",
      }),
    ).resolves.toEqual([]);
  });

  it("requires both halves of the key", async () => {
    await expect(refusalsOf(DeletePriceOverrideQuery, {})).resolves.toEqual([
      "connectionKind",
      "modelId",
    ]);
  });

  it("carries no amount fields, so a DELETE cannot smuggle a price", async () => {
    // The two fields repeat the write body's rather than extending it, and this is the reason:
    // a class that inherited them would accept a rate on a `DELETE`.
    await expect(
      validationPipe().transform(
        { connectionKind: "anthropic", modelId: "claude-fable-5", inputCentsPer1m: 1 },
        { type: "query", metatype: DeletePriceOverrideQuery },
      ),
    ).rejects.toMatchObject({ code: VALIDATION_FAILED });
  });
});

describe("the listing query", () => {
  it("accepts an empty window", async () => {
    await expect(refusalsOf(ListPriceOverridesQuery, {})).resolves.toEqual([]);
  });

  it("inherits the pagination convention's bounds", async () => {
    // Extended rather than repeated, so `limit` and `offset` keep one definition and one set of
    // messages across every list endpoint in this API.
    await expect(refusalsOf(ListPriceOverridesQuery, { limit: 1000 })).resolves.toEqual(["limit"]);
    await expect(refusalsOf(ListPriceOverridesQuery, { offset: -1 })).resolves.toEqual(["offset"]);
  });
});
