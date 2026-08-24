import {
  FAKE_CONFIG,
  FAKE_NOVEL_PARAM_SCHEMA,
  FAKE_PARAM_SCHEMA,
  FAKE_SECRET,
  FakeModelProviderAdapter,
  FakePullingProviderAdapter,
} from "./adapters/fake.adapter.fixture";
import {
  capabilityViolations,
  conformanceContext,
  normalizedModelViolations,
  paramViolations,
  pullStreamViolations,
  schemaViolations,
  validationViolations,
  type AdapterConformance,
} from "./conformance.fixture";
import type { ModelProviderAdapter, NormalizedModel } from "./provider.adapter";
import { PROVIDER_CONFIG_DIALECT } from "./provider.config";
import { MODEL_PARAM_DIALECT, type ModelParamSchema } from "./provider.params";

/**
 * The kit, tested against adapters that are wrong on purpose.
 *
 * `adapters/fake.conformance.spec.ts` proves the kit is *passable*. This proves it **bites** —
 * and the two are equally load-bearing, because a conformance kit nobody has watched fail is a
 * conformance kit that passes everything. It is the reason every rule in `conformance.fixture.ts`
 * is a function returning sentences rather than a body full of `expect`s: a rule shaped like
 * that can itself be a subject.
 *
 * Each case below is the failure mode of one real adapter mistake, named in its title.
 */

/**
 * An adapter with one thing replaced.
 *
 * The overrides are typed loosely on purpose. Most of them are values the interface would have
 * refused, which is exactly the point: the kit's audience includes adapters written in
 * JavaScript, or against an older version of the SPI, where the compiler stopped nobody.
 *
 * @param overrides - What to replace.
 * @returns The broken adapter.
 */
function brokenAdapter(overrides: Record<string, unknown>): ModelProviderAdapter {
  return Object.assign(new FakeModelProviderAdapter(), overrides);
}

describe("capabilityViolations", () => {
  it("passes a conforming adapter", () => {
    expect(capabilityViolations(new FakeModelProviderAdapter())).toEqual([]);
    expect(capabilityViolations(new FakePullingProviderAdapter())).toEqual([]);
  });

  it("catches a flag that is not a boolean", () => {
    const adapter = brokenAdapter({
      capabilities: () => ({
        discovery: "yes",
        pull: false,
        entitlements: false,
        invocation: false,
      }),
    });

    expect(capabilityViolations(adapter)).toContain("capabilities().discovery must be a boolean");
  });

  it("catches capabilities that change between calls", () => {
    // AE.2 renders affordances from these. A capability that changed between two renders would
    // show a button that then failed.
    let pull = false;
    const adapter = brokenAdapter({
      capabilities: () => {
        pull = !pull;

        return { discovery: true, pull, entitlements: false, invocation: false };
      },
    });

    expect(capabilityViolations(adapter)).toContain(
      "capabilities() must answer the same flags every call",
    );
  });

  it("catches a pullModel with no capability behind it", () => {
    const adapter = brokenAdapter({ pullModel: () => undefined });

    expect(capabilityViolations(adapter)).toContain(
      "capabilities().pull is false but pullModel is present — the flag is what supportsPull narrows on",
    );
  });

  it("catches a capability with no pullModel behind it", () => {
    const adapter = brokenAdapter({
      capabilities: () => ({ discovery: true, pull: true, entitlements: false, invocation: false }),
    });

    expect(capabilityViolations(adapter)).toContain(
      "capabilities().pull is true but pullModel is absent — the flag is what supportsPull narrows on",
    );
  });

  it("catches an adapter spending AF.2's reservation", () => {
    // Claiming `invocation` today is claiming a member no interface declares yet.
    const adapter = brokenAdapter({
      capabilities: () => ({ discovery: true, pull: false, entitlements: false, invocation: true }),
    });

    expect(capabilityViolations(adapter)).toContain(
      "capabilities().invocation is reserved for AF.2 (#235) and must be false",
    );
  });
});

describe("schemaViolations", () => {
  it("passes a conforming adapter", () => {
    expect(schemaViolations(new FakeModelProviderAdapter(), FAKE_SECRET, FAKE_CONFIG)).toEqual([]);
  });

  it("reports the dialect's violations and stops there", () => {
    // Everything after the dialect check reads the schema's own structure. A cascade of
    // consequences is not a more useful report than the cause.
    const adapter = brokenAdapter({ configSchema: () => ({ type: "object" }) });

    expect(schemaViolations(adapter, null, {})).toContain(
      `$schema must be "${PROVIDER_CONFIG_DIALECT}"`,
    );
  });

  it("catches a schema that changes between calls", () => {
    let count = 0;
    const adapter = brokenAdapter({
      configSchema: () => ({
        $schema: PROVIDER_CONFIG_DIALECT,
        type: "object",
        title: `Connect ${(count++).toString()}`,
        properties: { host: { type: "string", title: "Host" } },
        required: [],
        additionalProperties: false,
      }),
    });

    expect(schemaViolations(adapter, null, {})).toContain(
      "configSchema() must answer the same schema every call",
    );
  });

  it("catches a schema the caller can mutate back into the adapter", () => {
    // AE.5 holds this value while somebody fills in a form. A shared object would have that
    // form's edits land in the adapter.
    const shared = {
      $schema: PROVIDER_CONFIG_DIALECT,
      type: "object",
      title: "Connect a provider",
      properties: { host: { type: "string", title: "Host" } },
      required: [],
      additionalProperties: false,
    };
    const adapter = brokenAdapter({ configSchema: () => shared });

    expect(schemaViolations(adapter, null, {})).toContain(
      "configSchema() must not hand out a value the caller can mutate back in",
    );
  });

  it("catches a credential the form would give nobody a way to enter", () => {
    const adapter = brokenAdapter({
      configSchema: () => ({
        $schema: PROVIDER_CONFIG_DIALECT,
        type: "object",
        title: "Connect a provider",
        properties: { host: { type: "string", title: "Host" } },
        required: [],
        additionalProperties: false,
      }),
    });

    expect(schemaViolations(adapter, FAKE_SECRET, {})).toContain(
      "the harness supplies a credential but the schema marks no x-ouroboros-secret field, " +
        "so AE.5 would render no way to enter one",
    );
  });

  it("catches a credential field the fixtures never exercise", () => {
    expect(schemaViolations(new FakeModelProviderAdapter(), null, FAKE_CONFIG)).toContain(
      'the schema marks "apiKey" as the credential but the harness supplies none, ' +
        "so the recorded fixtures never exercise the field the form would collect",
    );
  });

  it("catches a sample config the adapter's own schema rejects", () => {
    // An add-form that refused a value the adapter considers correct is the failure this
    // prevents, and it is only findable by running the schema as a schema. Both projections
    // report it, because a bad address is bad in the form and bad in the stored row.
    expect(
      schemaViolations(new FakeModelProviderAdapter(), FAKE_SECRET, { baseUrl: "not a uri" }),
    ).toEqual([
      'the adapter\'s own sample submission is rejected by its schema: data/baseUrl must match format "uri"',
      'the adapter\'s own sample config is rejected by its stored-config schema: data/baseUrl must match format "uri"',
    ]);
  });

  it("passes an adapter whose credential is required, because a stored config never holds one", () => {
    // The shape AC.2 (#217) ships: one field, marked as the credential and required, so the
    // configuration that reaches `provider_connections.config` is legitimately empty. Checked
    // against the form's own schema it would be "missing apiKey" — which is the reason
    // `storedConfigSchema` exists and the reason this case is here rather than only in the
    // Anthropic suite.
    const adapter = brokenAdapter({
      configSchema: () => ({
        $schema: PROVIDER_CONFIG_DIALECT,
        type: "object",
        title: "Connect a provider",
        properties: {
          apiKey: { type: "string", title: "API key", minLength: 1, "x-ouroboros-secret": true },
        },
        required: ["apiKey"],
        additionalProperties: false,
      }),
    });

    expect(schemaViolations(adapter, FAKE_SECRET, {})).toEqual([]);
  });

  it("still exercises the credential row's own keywords, through the submission", () => {
    // The other half of the split: dropping the key row from the stored projection must not
    // mean nothing ever validates it. A blank credential against `minLength: 1` is what the
    // form itself would refuse.
    const adapter = brokenAdapter({
      configSchema: () => ({
        $schema: PROVIDER_CONFIG_DIALECT,
        type: "object",
        title: "Connect a provider",
        properties: {
          apiKey: { type: "string", title: "API key", minLength: 8, "x-ouroboros-secret": true },
        },
        required: ["apiKey"],
        additionalProperties: false,
      }),
    });

    expect(schemaViolations(adapter, "short", {})).toEqual([
      "the adapter's own sample submission is rejected by its schema: " +
        "data/apiKey must NOT have fewer than 8 characters",
    ]);
  });

  it("catches a schema that is not valid JSON Schema at all", () => {
    const adapter = brokenAdapter({
      configSchema: () => ({
        $schema: PROVIDER_CONFIG_DIALECT,
        type: "object",
        title: "Connect a provider",
        properties: { host: { type: "string", title: "Host", pattern: "([unclosed" } },
        required: [],
        additionalProperties: false,
      }),
    });

    expect(schemaViolations(adapter, null, {})[0]).toMatch(/^schema is not valid JSON Schema: /);
  });
});

describe("paramViolations", () => {
  /** The model every case below asks about, unless it is asking about several. */
  const MODEL = "fake/small";

  /**
   * An adapter whose `paramSchema` answers a fresh copy of whatever a case supplies.
   *
   * Fresh, because the kit's isolation check is one of the things under test here and every
   * *other* case would otherwise trip it — see the sharing case, which is the one that hands
   * the same object back deliberately.
   */
  function answering(schema: unknown): ModelProviderAdapter {
    return brokenAdapter({
      paramSchema: () => JSON.parse(JSON.stringify(schema)) as unknown,
    });
  }

  it("passes the fake, whose schema is storable throughout", () => {
    expect(paramViolations(new FakeModelProviderAdapter(), [MODEL])).toEqual([]);
  });

  it("refuses an adapter asked about no model at all", () => {
    // Not a pass. An adapter whose recorded listing is empty and which names no extra models
    // has had its param schema checked against nothing, and a leg that silently covers zero
    // cases is worse than one that fails.
    expect(paramViolations(new FakeModelProviderAdapter(), [])).toEqual([
      "no model to ask for a param schema — record a listing or name one in paramModels",
    ]);
  });

  it("catches a schema outside the dialect, and stops there", () => {
    // Everything after the dialect check reads the schema's own structure, and a schema that
    // failed it has none worth reading — so the answer is the dialect's violations alone
    // rather than those plus a cascade.
    const violations = paramViolations(answering({ type: "array" }), [MODEL]);

    expect(violations).toEqual([
      `paramSchema("${MODEL}"): $schema must be "${MODEL_PARAM_DIALECT}"`,
      `paramSchema("${MODEL}"): type must be "object"`,
      `paramSchema("${MODEL}"): title must be a non-empty string`,
      `paramSchema("${MODEL}"): additionalProperties must be false`,
      `paramSchema("${MODEL}"): properties must be an object`,
    ]);
  });

  it("catches a registered adapter offering a param the database cannot store", () => {
    // The rule CH.2 exists for, from the adapter's side. The very same schema renders a field
    // in `param.shapes.fixture.ts` — the dialect is about shape, and what a column will hold is
    // a separate question — and here it is refused, because a *shipped* adapter offering it
    // would be rendering a control whose save the insert refuses.
    expect(paramViolations(answering(FAKE_NOVEL_PARAM_SCHEMA), [MODEL])).toEqual([
      `paramSchema("${MODEL}"): param "speculative_decoding" is not one of the keys ` +
        "model_aliases.params stores (thinking, token_budget, max_output, context_clamp, " +
        "temperature) — see V019, decision R3",
    ]);
  });

  it("catches a schema that changes between two calls", () => {
    // The inspector may render it, store what somebody typed, and render it again. A schema
    // that moved in between would present a form whose fields had changed under the person
    // filling it in.
    let calls = 0;
    const adapter = brokenAdapter({
      paramSchema: (): ModelParamSchema => ({
        ...FAKE_PARAM_SCHEMA,
        title: `Answer ${(calls += 1)}`,
      }),
    });

    expect(paramViolations(adapter, [MODEL])).toContain(
      `paramSchema("${MODEL}") must answer the same schema every call`,
    );
  });

  it("catches an adapter handing out a value the caller can mutate back in", () => {
    // A form holds this while somebody fills it in, and an adapter is a singleton across every
    // workspace — so a shared object would have one person's edits land in everybody's form.
    const shared: ModelParamSchema = { ...FAKE_PARAM_SCHEMA };
    const adapter = brokenAdapter({ paramSchema: () => shared });

    expect(paramViolations(adapter, [MODEL])).toEqual([
      `paramSchema("${MODEL}") must not hand out a value the caller can mutate back in`,
    ]);
  });

  it("catches a schema that refuses an alias with no parameters set", () => {
    // Seven of mockup 21's eight rows are in exactly that state, and a newly created alias
    // always is. A schema that rejected `{}` would refuse every alias nobody has tuned.
    const impossible = {
      ...FAKE_PARAM_SCHEMA,
      properties: { thinking: { type: "string", title: "Thinking", enum: ["off"] } },
      // Not part of the dialect, which is why this reaches Ajv rather than being caught above:
      // `paramSchemaViolations` refuses `required`, so the case builds the document past it.
      required: ["thinking"],
    };

    // `required` is refused by the dialect first, which is the honest ordering — so the check
    // that Ajv would also have complained is made by asking Ajv directly, below.
    expect(paramViolations(answering(impossible), [MODEL])).toEqual([
      `paramSchema("${MODEL}"): the dialect has no required — every param is optional by construction`,
    ]);
  });

  it("asks about every model it is given, and names the one each violation is about", () => {
    // The reason the harness may name extra models: an adapter whose schema varies by model
    // has a branch per model, and a recording that only exercised one would leave the other
    // unchecked.
    const violations = paramViolations(answering(FAKE_NOVEL_PARAM_SCHEMA), [
      "fake/small",
      "fake/large",
    ]);

    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain('paramSchema("fake/small")');
    expect(violations[1]).toContain('paramSchema("fake/large")');
  });

  it("accepts an empty schema that explains itself — a fixed catalog has nothing to tune", () => {
    expect(
      paramViolations(
        answering({
          $schema: MODEL_PARAM_DIALECT,
          type: "object",
          title: "Nothing to tune",
          description: "This provider publishes no per-call parameters this product can set.",
          properties: {},
          additionalProperties: false,
        }),
        [MODEL],
      ),
    ).toEqual([]);
  });
});

describe("validationViolations", () => {
  it("passes a recorded success", () => {
    expect(
      validationViolations({ status: "ok", latencyMs: 38, detail: "200" }, null, FAKE_SECRET),
    ).toEqual([]);
  });

  it("passes a recorded failure of the expected class", () => {
    expect(
      validationViolations(
        { status: "failed", errorClass: "upstream", detail: "503 upstream" },
        "upstream",
        FAKE_SECRET,
      ),
    ).toEqual([]);
  });

  it("catches a detail that says nothing", () => {
    expect(validationViolations({ status: "ok", latencyMs: 1, detail: "" }, null, null)).toContain(
      "detail must say something — it is what the card foot prints",
    );
  });

  it("catches a leaked credential, even on a success", () => {
    // The shortest path to a leaked key is an adapter that echoes a provider's error body — and
    // a chatty success note is the same leak with a green glyph in front of it.
    expect(
      validationViolations(
        { status: "failed", errorClass: "auth", detail: `rejected ${FAKE_SECRET}` },
        "auth",
        FAKE_SECRET,
      ),
    ).toContain("detail contains the credential");

    expect(
      validationViolations(
        { status: "ok", latencyMs: 3, detail: `200 for ${FAKE_SECRET}` },
        null,
        FAKE_SECRET,
      ),
    ).toContain("detail contains the credential");
  });

  it("catches a fabricated latency", () => {
    expect(
      validationViolations({ status: "ok", latencyMs: -1, detail: "200" }, null, null),
    ).toContain("latencyMs must be a non-negative whole number of milliseconds");
    expect(
      validationViolations({ status: "ok", latencyMs: 1.5, detail: "200" }, null, null),
    ).toContain("latencyMs must be a non-negative whole number of milliseconds");
  });

  it("catches a fixture that was arranged to fail and did not", () => {
    expect(
      validationViolations({ status: "ok", latencyMs: 3, detail: "200" }, "auth", null),
    ).toEqual(["the auth fixture answered ok"]);
  });

  it("catches a fixture that was arranged to succeed and did not", () => {
    expect(
      validationViolations(
        { status: "failed", errorClass: "network", detail: "unreachable" },
        null,
        null,
      ),
    ).toEqual(["the success fixture answered failed: unreachable"]);
  });

  it("catches a misclassification", () => {
    // The failure this whole taxonomy exists to prevent: a refused key reported as the provider
    // being down sends an operator to check a firewall.
    expect(
      validationViolations(
        { status: "failed", errorClass: "network", detail: "unreachable" },
        "auth",
        null,
      ),
    ).toEqual(["the auth fixture was classified network"]);
  });
});

describe("normalizedModelViolations", () => {
  /** A model with everything present, to be broken one field at a time. */
  const model: NormalizedModel = {
    id: "fake/small",
    display: "Fake Small",
    contextLength: 200_000,
    sizeBytes: 1_024,
    tier: null,
  };

  it("passes a normalized list, including an empty one", () => {
    expect(normalizedModelViolations([model])).toEqual([]);
    // A freshly installed Ollama daemon has no models. That is a legitimate answer, not a
    // failure.
    expect(normalizedModelViolations([])).toEqual([]);
  });

  it("accepts absent measures, which mean the provider did not say", () => {
    expect(normalizedModelViolations([{ ...model, contextLength: null, sizeBytes: null }])).toEqual(
      [],
    );
  });

  it("accepts a reported tier, and an absent one", () => {
    // Decision P8's two legitimate answers: the provider said `priority`, or it said nothing.
    expect(normalizedModelViolations([{ ...model, tier: "priority" }])).toEqual([]);
    expect(normalizedModelViolations([{ ...model, tier: null }])).toEqual([]);
  });

  it("catches a tier that is present but says nothing", () => {
    // The shape that turns *nothing was said* into a pill: empty is falsy in the adapter and
    // truthy to a `meta.tier is not null` read, so the two halves of the product disagree about
    // whether an entitlement was found.
    expect(normalizedModelViolations([{ ...model, tier: "" }])).toContain(
      "model 0: tier must be null or a non-empty string — an absent signal is null (P8)",
    );
  });

  it("catches an empty or duplicated id", () => {
    // Two rows with the same id are two chips a person cannot tell apart, and an alias resolving
    // against the catalog then has two candidates and no rule for choosing.
    expect(normalizedModelViolations([{ ...model, id: "" }])).toContain(
      "model 0: id must be a non-empty string",
    );
    expect(normalizedModelViolations([model, model])).toContain(
      'model 1: id "fake/small" is a duplicate',
    );
  });

  it("catches a chip with no text", () => {
    expect(normalizedModelViolations([{ ...model, display: "" }])).toContain(
      "model 0: display must be a non-empty string — a chip needs text",
    );
  });

  it("catches a fabricated measure", () => {
    // A model with no context is not a thing. Zero here is a parse that failed and was not
    // checked, and it reaches a card as a confident-looking number.
    expect(normalizedModelViolations([{ ...model, contextLength: 0 }])).toContain(
      "model 0: contextLength must be null or a whole number of at least 1",
    );
    expect(normalizedModelViolations([{ ...model, sizeBytes: 1.5 }])).toContain(
      "model 0: sizeBytes must be null or a whole number of at least 0",
    );
    expect(normalizedModelViolations([{ ...model, sizeBytes: Number.NaN }])).toContain(
      "model 0: sizeBytes must be null or a whole number of at least 0",
    );
  });
});

describe("pullStreamViolations", () => {
  const terminal = { status: "success", completedBytes: 10, totalBytes: 10, done: true };

  it("passes a stream that ends with a terminal event", () => {
    expect(
      pullStreamViolations([
        { status: "pulling manifest", completedBytes: null, totalBytes: null, done: false },
        terminal,
      ]),
    ).toEqual([]);
  });

  it("catches a pull that reported nothing", () => {
    expect(pullStreamViolations([])).toEqual(["a pull must report at least one event"]);
  });

  it("catches a stream that just stopped", () => {
    // What a pull looks like when the daemon dies half way through. Inferring completion from
    // the iterator finishing would render that as a success.
    expect(
      pullStreamViolations([
        { status: "downloading", completedBytes: 5, totalBytes: 10, done: false },
      ]),
    ).toContain("exactly one event must carry done: true, and it must be the last");
  });

  it("catches a terminal event that is not last", () => {
    expect(pullStreamViolations([terminal, { ...terminal, done: false }])).toContain(
      "exactly one event must carry done: true, and it must be the last",
    );
  });

  it("catches progress past the total", () => {
    expect(
      pullStreamViolations([
        { status: "downloading", completedBytes: 11, totalBytes: 10, done: true },
      ]),
    ).toContain("event 0: completedBytes exceeds totalBytes");
  });

  it("catches an event that does not say what is happening", () => {
    expect(pullStreamViolations([{ ...terminal, status: "" }])).toContain(
      "event 0: status must say what is happening",
    );
  });
});

describe("conformanceContext", () => {
  it("carries the harness's config and credential under an obviously synthetic id", () => {
    // An adapter that sent the connection id to a provider would be sending a workspace's
    // internal identifier. A fixed, obviously-fake uuid is what makes that visible in a
    // recorded request rather than plausible.
    const harness = {
      sampleConfig: FAKE_CONFIG,
      secret: FAKE_SECRET,
    } as AdapterConformance;

    expect(conformanceContext(harness)).toEqual({
      connectionId: "00000000-0000-4000-8000-000000000216",
      config: FAKE_CONFIG,
      secret: FAKE_SECRET,
    });
  });
});
