import {
  MODEL_ALIAS_RESTRICTION_KEYS,
  MODEL_ALIAS_TEMPERATURE_MAX,
  MODEL_ALIAS_TOKENS_MAX,
  MODEL_ALIAS_TOKENS_MIN,
} from "../db/schema";
import {
  MODEL_PARAM_DIALECT,
  RESTRICTIONS_SCHEMA,
  SOURCES_ANNOTATION,
  paramSchemaViolations,
  type ModelParamSchema,
} from "../providers/provider.params";
import {
  NO_METADATA,
  genericParamSchema,
  mergeParamSchema,
  offeredParams,
  readModelMetadata,
  summariseCapabilities,
} from "./params.merge";

/**
 * The precedence rule, and the two acceptance criteria that are about it.
 *
 * > *"Catalog-metadata enrichment is labelled as such and never overrides live adapter or
 * > discovery truth."*
 *
 * > *"An unbound alias returns the generic schema with its reason; no fabricated capabilities
 * > appear."*
 *
 * Every case here is three literals rather than a database, which is what the split between
 * this module and `params.service.ts` buys: the rule can be stated in isolation, and the thing
 * that fetches its inputs is tested separately for fetching them.
 */

/** An adapter schema with the bounds a case wants to watch being narrowed. */
function adapterSchema(properties: ModelParamSchema["properties"]): ModelParamSchema {
  return {
    $schema: MODEL_PARAM_DIALECT,
    type: "object",
    title: "Test provider model parameters",
    properties,
    additionalProperties: false,
  };
}

/** A schema offering a context clamp with no ceiling — the shape the merge has most to do to. */
function unbounded(): ModelParamSchema {
  return adapterSchema({
    context_clamp: {
      type: "integer",
      title: "Context clamp",
      minimum: MODEL_ALIAS_TOKENS_MIN,
    },
  });
}

describe("mergeParamSchema", () => {
  describe("with no adapter behind it", () => {
    it("answers the generic schema and says the alias is unbound", () => {
      // Mockup 21's `gpt5-experiments`: a name created ahead of its key. With no connection
      // there is no adapter, no discovery row and — since the catalog is keyed by provider
      // kind — no catalog row either.
      const merged = mergeParamSchema(null, NO_METADATA, NO_METADATA);

      expect(merged.reason).toBe("alias_unbound");
      expect(merged.params.properties).toEqual({});
      expect(merged.params.description).toContain("no provider bound");
    });

    it("fabricates no capability, even when the catalog knows the model", () => {
      // The ticket's *no fabricated capabilities appear*, as a property. A catalogued context
      // length is a fact about a published model and not about *this alias*, and inventing a
      // field out of it would be exactly the dishonesty the unbound answer exists to avoid.
      const merged = mergeParamSchema(
        null,
        { contextTokens: 200_000, maxOutputTokens: 64_000 },
        { contextTokens: 200_000, maxOutputTokens: 64_000 },
      );

      expect(merged.params.properties).toEqual({});
      expect(merged.sources).toEqual(["registry"]);
    });

    it("still offers the registry's restrictions in full", () => {
      // A restriction is what *this workspace* allows the alias to be used for, which is true
      // whether or not anything is on the other end of it.
      const merged = mergeParamSchema(null, NO_METADATA, NO_METADATA);

      expect(Object.keys(merged.restrictions.properties)).toEqual([
        ...MODEL_ALIAS_RESTRICTION_KEYS,
      ]);
    });

    it("tells an unbound alias apart from a provider this build cannot reach", () => {
      // Two absences with two different fixes: bind a provider, or wait for an adapter. A
      // client that could only tell *no fields* from *fields* would have to invent the
      // sentence.
      expect(mergeParamSchema(null, NO_METADATA, NO_METADATA, "custom").reason).toBe(
        "provider_unsupported",
      );
      expect(mergeParamSchema(null, NO_METADATA, NO_METADATA).reason).toBe("alias_unbound");
    });
  });

  describe("with an adapter that offers nothing", () => {
    it("says so rather than leaving the reason null", () => {
      // Mockup 07's Copilot and Cursor cards: fixed catalogs with nothing this product can set.
      const merged = mergeParamSchema(
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

      expect(merged.reason).toBe("provider_has_no_parameters");
      expect(merged.params.description).toContain("fixed catalog");
    });
  });

  describe("discovery", () => {
    it("tightens a bound the adapter left open, and says it did", () => {
      const merged = mergeParamSchema(
        unbounded(),
        { contextTokens: 32_768, maxOutputTokens: null },
        NO_METADATA,
      );

      expect(merged.params.properties.context_clamp.maximum).toBe(32_768);
      expect(merged.params.properties.context_clamp[SOURCES_ANNOTATION]).toEqual([
        "adapter",
        "discovery",
      ]);
    });

    it("tightens a bound the adapter set wider", () => {
      // The adapter's bound is about the model family and discovery's is about the deployment
      // in front of us, so the smaller wins.
      const merged = mergeParamSchema(
        adapterSchema({
          context_clamp: { type: "integer", title: "Context clamp", maximum: 200_000 },
        }),
        { contextTokens: 32_768, maxOutputTokens: null },
        NO_METADATA,
      );

      expect(merged.params.properties.context_clamp.maximum).toBe(32_768);
    });

    it("does not raise a bound the adapter set tighter", () => {
      // A provider reporting a context above what the adapter will accept does not raise the
      // adapter's ceiling: the adapter's is a statement about what it will send.
      const merged = mergeParamSchema(
        adapterSchema({
          context_clamp: {
            type: "integer",
            title: "Context clamp",
            minimum: MODEL_ALIAS_TOKENS_MIN,
            maximum: 8192,
          },
        }),
        { contextTokens: 200_000, maxOutputTokens: null },
        NO_METADATA,
      );

      expect(merged.params.properties.context_clamp.maximum).toBe(8192);
      expect(merged.params.properties.context_clamp[SOURCES_ANNOTATION]).toEqual(["adapter"]);
    });

    it("bounds a thinking budget by the context it has to be spent inside", () => {
      // A real rule rather than a convenience: thinking tokens are spent inside the context, so
      // a budget above it is a budget no request can honour.
      const merged = mergeParamSchema(
        adapterSchema({
          token_budget: { type: "integer", title: "Token budget", maximum: 1_000_000 },
        }),
        { contextTokens: 200_000, maxOutputTokens: null },
        NO_METADATA,
      );

      expect(merged.params.properties.token_budget.maximum).toBe(200_000);
    });
  });

  describe("the catalog", () => {
    it("fills a bound nothing else knows, and is labelled for it", () => {
      // The ticket's option 2-B. Anthropic's maximum output differs per model and no adapter
      // can ask offline, so this is the enrichment doing real work.
      const merged = mergeParamSchema(
        adapterSchema({ max_output: { type: "integer", title: "Max output", minimum: 1 } }),
        NO_METADATA,
        { contextTokens: null, maxOutputTokens: 64_000 },
      );

      expect(merged.params.properties.max_output.maximum).toBe(64_000);
      expect(merged.params.properties.max_output[SOURCES_ANNOTATION]).toEqual([
        "adapter",
        "catalog",
      ]);
    });

    it("never overrides a bound the adapter stated", () => {
      // The acceptance criterion, as an asymmetry rather than as a comment asking the next
      // reader to be careful: the catalog is a vendored snapshot of somebody else's file and
      // goes stale without anybody noticing.
      const merged = mergeParamSchema(
        adapterSchema({
          max_output: {
            type: "integer",
            title: "Max output",
            minimum: MODEL_ALIAS_TOKENS_MIN,
            maximum: 8192,
          },
        }),
        NO_METADATA,
        { contextTokens: null, maxOutputTokens: 128_000 },
      );

      expect(merged.params.properties.max_output.maximum).toBe(8192);
      expect(merged.params.properties.max_output[SOURCES_ANNOTATION]).toEqual(["adapter"]);
    });

    it("never overrides a bound discovery tightened either", () => {
      // Discovery is live and the catalog is a snapshot, so the ordering holds all the way
      // down. A catalogued context of 200k must not widen a deployment's 32k.
      const merged = mergeParamSchema(
        unbounded(),
        { contextTokens: 32_768, maxOutputTokens: null },
        { contextTokens: 200_000, maxOutputTokens: null },
      );

      expect(merged.params.properties.context_clamp.maximum).toBe(32_768);
      expect(merged.params.properties.context_clamp[SOURCES_ANNOTATION]).toEqual([
        "adapter",
        "discovery",
      ]);
    });
  });

  describe("the registry's own domain", () => {
    it("clamps a bound nothing else set, so a form cannot offer what a save refuses", () => {
      const merged = mergeParamSchema(unbounded(), NO_METADATA, NO_METADATA);

      expect(merged.params.properties.context_clamp.maximum).toBe(MODEL_ALIAS_TOKENS_MAX);
      expect(merged.params.properties.context_clamp[SOURCES_ANNOTATION]).toEqual([
        "adapter",
        "registry",
      ]);
    });

    it("supplies a floor the adapter left off", () => {
      const merged = mergeParamSchema(
        adapterSchema({ temperature: { type: "number", title: "Temperature", maximum: 1 } }),
        NO_METADATA,
        NO_METADATA,
      );

      expect(merged.params.properties.temperature.minimum).toBe(0);
    });

    it("leaves a bound already inside the column's domain alone", () => {
      const merged = mergeParamSchema(
        adapterSchema({
          temperature: { type: "number", title: "Temperature", minimum: 0, maximum: 1 },
        }),
        NO_METADATA,
        NO_METADATA,
      );

      expect(merged.params.properties.temperature.maximum).toBe(1);
      expect(merged.params.properties.temperature[SOURCES_ANNOTATION]).toEqual(["adapter"]);
    });

    it("is applied last, so a catalogued bound cannot escape it", () => {
      // A stale catalog claiming a context of a hundred million must not reach a form: what a
      // save will accept is the final word.
      const merged = mergeParamSchema(unbounded(), NO_METADATA, {
        contextTokens: 100_000_000,
        maxOutputTokens: null,
      });

      expect(merged.params.properties.context_clamp.maximum).toBe(MODEL_ALIAS_TOKENS_MAX);
      expect(merged.params.properties.context_clamp[SOURCES_ANNOTATION]).toEqual([
        "adapter",
        "catalog",
        "registry",
      ]);
    });

    it("leaves a param outside the column's vocabulary exactly as its adapter declared it", () => {
      // A shipped adapter cannot offer one — the conformance kit refuses it — so this reaches
      // the merge only from a fixture. Answering it unchanged is the honest thing: there is no
      // column domain to intersect with.
      const merged = mergeParamSchema(
        adapterSchema({
          speculative_decoding: { type: "boolean", title: "Speculative decoding" },
        }),
        { contextTokens: 32_768, maxOutputTokens: 8192 },
        { contextTokens: 32_768, maxOutputTokens: 8192 },
      );

      expect(merged.params.properties.speculative_decoding).toEqual({
        type: "boolean",
        title: "Speculative decoding",
        [SOURCES_ANNOTATION]: ["adapter"],
      });
    });
  });

  describe("the answer as a whole", () => {
    it("is deterministic — two merges of the same inputs are equal", () => {
      const merge = () =>
        mergeParamSchema(
          unbounded(),
          { contextTokens: 32_768, maxOutputTokens: null },
          { contextTokens: 200_000, maxOutputTokens: 8192 },
        );

      expect(merge()).toEqual(merge());
    });

    it("keeps the adapter's field order", () => {
      // The inspector draws the fields in the order their author wrote them, and the merge is
      // in the middle of that promise.
      const merged = mergeParamSchema(
        adapterSchema({
          zebra: { type: "boolean", title: "Zebra" },
          apple: { type: "boolean", title: "Apple" },
        }),
        NO_METADATA,
        NO_METADATA,
      );

      expect(Object.keys(merged.params.properties)).toEqual(["zebra", "apple"]);
    });

    it("answers a schema still in the dialect", () => {
      // The merge produces the document the inspector renders and Ajv compiles, so a merge that
      // stepped outside the dialect would take both down at once.
      const merged = mergeParamSchema(
        unbounded(),
        { contextTokens: 32_768, maxOutputTokens: null },
        NO_METADATA,
      );

      expect(paramSchemaViolations(merged.params)).toEqual([]);
      expect(paramSchemaViolations(merged.restrictions)).toEqual([]);
    });

    it("summarises the sources in precedence order rather than in the order they applied", () => {
      const merged = mergeParamSchema(
        adapterSchema({
          max_output: { type: "integer", title: "Max output", minimum: 1 },
          context_clamp: { type: "integer", title: "Context clamp" },
        }),
        { contextTokens: 32_768, maxOutputTokens: null },
        { contextTokens: null, maxOutputTokens: 8192 },
      );

      expect(merged.sources).toEqual(["adapter", "discovery", "catalog", "registry"]);
    });

    it("names the registry among the sources even when no bound came from it", () => {
      // The restrictions are always offered, so the registry always contributed something to
      // the answer as a whole.
      const merged = mergeParamSchema(
        adapterSchema({
          temperature: { type: "number", title: "Temperature", minimum: 0, maximum: 1 },
        }),
        NO_METADATA,
        NO_METADATA,
      );

      expect(merged.sources).toEqual(["adapter", "registry"]);
    });

    it("hands out restrictions the caller cannot mutate back into the constant", () => {
      const merged = mergeParamSchema(null, NO_METADATA, NO_METADATA);
      (merged.restrictions as { title: string }).title = "tampered";

      expect(RESTRICTIONS_SCHEMA.title).toBe("Registry restrictions");
    });

    it("does not mutate the adapter's schema", () => {
      // The adapter is a singleton across every workspace, so a merge that edited its answer in
      // place would narrow one deployment's bounds into everybody's form.
      const schema = unbounded();
      mergeParamSchema(schema, { contextTokens: 32_768, maxOutputTokens: null }, NO_METADATA);

      expect(schema.properties.context_clamp.maximum).toBeUndefined();
    });
  });
});

describe("genericParamSchema", () => {
  it.each(["alias_unbound", "provider_unsupported", "provider_has_no_parameters"] as const)(
    "answers a dialect-valid schema that explains %s",
    (reason) => {
      const schema = genericParamSchema(reason);

      expect(paramSchemaViolations(schema)).toEqual([]);
      expect(schema.properties).toEqual({});
      expect(schema.description).not.toBe("");
    },
  );

  it("says something different for each reason", () => {
    // A client that rendered one sentence for all three would be telling somebody to bind a
    // provider when what they need is an adapter.
    const sentences = ["alias_unbound", "provider_unsupported", "provider_has_no_parameters"].map(
      (reason) => genericParamSchema(reason as "alias_unbound").description,
    );

    expect(new Set(sentences).size).toBe(3);
  });
});

describe("readModelMetadata", () => {
  it("reads the two keys both meta columns spell the same way", () => {
    expect(readModelMetadata({ context_tokens: 200_000, max_output_tokens: 64_000 })).toEqual({
      contextTokens: 200_000,
      maxOutputTokens: 64_000,
    });
  });

  it("answers nothing known for an absent or empty column", () => {
    expect(readModelMetadata(undefined)).toEqual(NO_METADATA);
    expect(readModelMetadata({})).toEqual(NO_METADATA);
  });

  it("ignores what it cannot read as a token count", () => {
    // Both columns are opaque jsonb — one is a vendor's own vocabulary — so every value is
    // checked rather than cast. A context window of `"200k"` is not a number a form can be
    // bounded with, and treating it as one would produce a ceiling nobody can explain.
    for (const value of ["200k", 0, -1, 1.5, null, {}, []]) {
      expect(readModelMetadata({ context_tokens: value }).contextTokens).toBeNull();
    }
  });

  it("reads the keys it knows and ignores everything else the catalog carries", () => {
    // `model_prices.meta` also holds an upstream key, a mode, a deprecation date and a
    // capability map. None of them bounds a param, and reading one would be this service
    // inventing a rule out of a vendor's file.
    expect(
      readModelMetadata({
        catalog_source: "litellm",
        upstream_key: "claude-fable-5",
        mode: "chat",
        capabilities: { reasoning: true },
        context_tokens: 1_000_000,
      }),
    ).toEqual({ contextTokens: 1_000_000, maxOutputTokens: null });
  });
});

describe("offeredParams", () => {
  it("lists what a schema offers, in its own order", () => {
    expect(
      offeredParams(
        adapterSchema({
          thinking: { type: "string", title: "Thinking", enum: ["off"] },
          temperature: { type: "number", title: "Temperature" },
        }),
      ),
    ).toEqual(["thinking", "temperature"]);
  });

  it("answers nothing for a provider with nothing to tune", () => {
    expect(offeredParams(genericParamSchema("alias_unbound"))).toEqual([]);
  });
});

describe("the merge's own bounds", () => {
  it("clamps to exactly what V019 declares, not to a number written down twice", () => {
    // The bounds come from `STORABLE_PARAM_FIELDS`, which mirrors the column — so a change to
    // V019's domain moves the merge with it rather than leaving a second copy behind.
    const merged = mergeParamSchema(
      adapterSchema({
        temperature: { type: "number", title: "Temperature" },
        context_clamp: { type: "integer", title: "Context clamp" },
      }),
      NO_METADATA,
      NO_METADATA,
    );

    expect(merged.params.properties.temperature.maximum).toBe(MODEL_ALIAS_TEMPERATURE_MAX);
    expect(merged.params.properties.context_clamp.minimum).toBe(MODEL_ALIAS_TOKENS_MIN);
  });
});

describe("summariseCapabilities", () => {
  /**
   * The headline CH.4's ([#587](https://github.com/NobuData/ouroboros/issues/587)) candidate
   * rows print. It adds no knowledge — it is a projection of the merge above — so what is
   * asserted here is that it projects the *right* fields, and in particular that the two token
   * counts come from the metadata rather than from the merged bounds.
   */
  it("names what the model offers, and says whether thinking is among it", () => {
    const summary = summariseCapabilities(
      mergeParamSchema(
        adapterSchema({
          thinking: { type: "string", title: "Thinking", enum: ["off", "std", "max"] },
          temperature: { type: "number", title: "Temperature" },
        }),
        NO_METADATA,
        NO_METADATA,
      ),
      NO_METADATA,
      NO_METADATA,
    );

    expect(summary.params).toEqual(["thinking", "temperature"]);
    expect(summary.thinking).toBe(true);
    expect(summary.reason).toBeNull();
  });

  it("says thinking is absent when the adapter does not offer it", () => {
    const summary = summariseCapabilities(
      mergeParamSchema(
        adapterSchema({ temperature: { type: "number", title: "Temperature" } }),
        NO_METADATA,
        NO_METADATA,
      ),
      NO_METADATA,
      NO_METADATA,
    );

    expect(summary.thinking).toBe(false);
  });

  it("carries the reason an unbound or unsupported model has no params", () => {
    const summary = summariseCapabilities(
      mergeParamSchema(null, NO_METADATA, NO_METADATA, "custom"),
      NO_METADATA,
      NO_METADATA,
    );

    expect(summary.params).toEqual([]);
    expect(summary.reason).toBe("provider_unsupported");
  });

  it("takes the context window from discovery, not from the clamped form bound", () => {
    // The one place a summary could quietly lie. `context_clamp.maximum` has been through the
    // clamp to V019's domain, so for a model whose window is above `MODEL_ALIAS_TOKENS_MAX` it
    // is *what this product will store* rather than what the model holds. The seeded
    // `llama4:scout` is exactly that model.
    const window = MODEL_ALIAS_TOKENS_MAX + 485_760;
    const merged = mergeParamSchema(
      unbounded(),
      { contextTokens: window, maxOutputTokens: null },
      NO_METADATA,
    );

    expect(merged.params.properties.context_clamp.maximum).toBe(MODEL_ALIAS_TOKENS_MAX);
    expect(
      summariseCapabilities(merged, { contextTokens: window, maxOutputTokens: null }, NO_METADATA)
        .contextTokens,
    ).toBe(window);
  });

  it("falls back to the catalog only where discovery said nothing", () => {
    // The same asymmetry the field merge keeps, stated for a scalar: the catalog fills an
    // absence and never overrides a live answer.
    const summary = summariseCapabilities(
      mergeParamSchema(unbounded(), NO_METADATA, NO_METADATA),
      { contextTokens: 200_000, maxOutputTokens: null },
      { contextTokens: 1_000_000, maxOutputTokens: 64_000 },
    );

    expect(summary.contextTokens).toBe(200_000);
    expect(summary.maxOutputTokens).toBe(64_000);
  });

  it("says null rather than zero when no source published a size", () => {
    const summary = summariseCapabilities(
      mergeParamSchema(unbounded(), NO_METADATA, NO_METADATA),
      NO_METADATA,
      NO_METADATA,
    );

    expect(summary.contextTokens).toBeNull();
    expect(summary.maxOutputTokens).toBeNull();
  });
});
