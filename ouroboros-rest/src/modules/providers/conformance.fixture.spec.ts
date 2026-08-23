import {
  FAKE_CONFIG,
  FAKE_SECRET,
  FakeModelProviderAdapter,
  FakePullingProviderAdapter,
} from "./adapters/fake.adapter.fixture";
import {
  capabilityViolations,
  conformanceContext,
  normalizedModelViolations,
  pullStreamViolations,
  schemaViolations,
  validationViolations,
  type AdapterConformance,
} from "./conformance.fixture";
import type { ModelProviderAdapter, NormalizedModel } from "./provider.adapter";
import { PROVIDER_CONFIG_DIALECT } from "./provider.config";

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
    // prevents, and it is only findable by running the schema as a schema.
    expect(
      schemaViolations(new FakeModelProviderAdapter(), FAKE_SECRET, { baseUrl: "not a uri" }),
    ).toEqual([
      'the adapter\'s own sample config is rejected by its schema: data/baseUrl must match format "uri"',
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
