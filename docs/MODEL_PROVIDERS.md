# Writing a model provider adapter

> **Issue:** [#216](https://github.com/NobuData/ouroboros/issues/216) — *[AC.1]
> ModelProviderAdapter SPI & registry* · **Roadmap:**
> [`ROADMAP_MOCKUP_07_PROVIDERS_KEYS.md`](ROADMAP_MOCKUP_07_PROVIDERS_KEYS.md), decision
> **P1** · **Written:** 2026-08-23

Ouroboros reaches five model providers today and its Providers & keys page promises more:
the dashed add-card reads *"Connect OpenAI, Google, Bedrock, or any OpenAI-compatible
endpoint."* This document is how that promise is kept cheaply — it describes the
`ModelProviderAdapter` interface, the vocabulary every adapter fails in, and the
conformance kit a new adapter has to pass before it can be registered.

**Adding a provider should be one directory and one line.** The directory is
`ouroboros-rest/src/modules/providers/adapters/`; the line is in
`providers.module.ts`. If you find yourself editing a card component, a form renderer or a
`switch` in a service to add a provider, something described here has been worked around
rather than used, and that is worth raising rather than shipping.

## Why an SPI at all

Five kinds ship in the MVP — Anthropic, any OpenAI-compatible endpoint, Ollama, GitHub
Copilot, Cursor — and each one looks different on the page. Anthropic has a masked key row
and nothing else; the vLLM card has a **Base URL** field *and* an optional key row; Ollama
has a **Host** field, no key at all, and a pull-list; Copilot's capability line mentions
seats.

Written as a `switch (kind)` across REST, the add-form and the card component, each new
provider is a three-file change in three modules, and the catalog promise becomes something
the team dreads rather than something that just happens.

This project already solved that problem once, for ticket sources
([#139](https://github.com/NobuData/ouroboros/issues/139),
[#142](https://github.com/NobuData/ouroboros/issues/142)): core code depends on an interface
only, implementations live behind a registry, and a conformance kit gates every new one so
*"it works against my provider"* is a test result rather than a claim. Decision **P1**
applies the same discipline to model providers.

## The shape of it

Everything lives in `ouroboros-rest/src/modules/providers/`:

| File | What it is |
|---|---|
| `provider.adapter.ts` | The SPI. `ModelProviderAdapter`, `PullCapableAdapter`, `supportsPull`. |
| `provider.errors.ts` | The five error classes, the pills they render as, and the HTTP classifier. |
| `provider.config.ts` | The JSON Schema dialect `configSchema()` answers in, and its gate. |
| `provider.forms.ts` | Schema → form fields. Contains no provider kind, by test. |
| `provider.registry.ts` | Lookup by `kind`, the `MODEL_PROVIDER_ADAPTERS` token, two refusals. |
| `providers.module.ts` | The Nest module. `REGISTERED_ADAPTERS` is the line you add. |
| `conformance.fixture.ts` | The kit. |
| `adapters/fake.adapter.fixture.ts` | The in-memory adapter — this document's worked example. |
| `card.shapes.fixture.ts` | Mockup 07's five cards, as schemas. |
| `.dependency-cruiser.cjs` | The boundary, at the module root. Run by `yarn lint`. |

```
core services ──imports──▶ ModelProviderAdapter ◀──implements── adapters/*
     (AD.2 · Z.3 · discovery)         ▲
                                      └── ModelProviderRegistry.get(kind)
```

## The interface

```ts
interface ModelProviderAdapter {
  readonly kind: ProviderConnectionKind;
  configSchema(): ProviderConfigSchema;
  capabilities(): ProviderCapabilities;
  validate(config, secret): Promise<ProviderValidation>;
  discoverModels(connection): Promise<NormalizedModel[]>;
}

interface PullCapableAdapter extends ModelProviderAdapter {
  capabilities(): ProviderCapabilities & { pull: true };
  pullModel(connection, modelId): AsyncIterable<ModelPullProgress>;
}
```

Five members, and every one of them is something the page does: the add-form is
`configSchema()`, the **Test connection** button is `validate()`, the **Models available**
chips are `discoverModels()`, and which affordances a card shows at all is
`capabilities()`.

Two details are worth reading twice.

**`validate` takes loose parts; `discoverModels` takes a connection.** That asymmetry is
the lifecycle. `validate` is called from the add-form *before a row exists* — there is no
connection id yet, and the credential is a string somebody has just typed. The other two
run against a saved connection whose credential AD.2
([#223](https://github.com/NobuData/ouroboros/issues/223)) has opened for the length of one
call.

**`validate` returns its failure; the others throw.** A provider being down is the state
the card foot exists to render, so it is a value — an exception would put a pill's colour
at the mercy of somebody's control flow. `discoverModels` answers a list and `pullModel`
answers a stream, and neither has room for a failure, so both throw
`ProviderAdapterError`, which carries the same taxonomy.

## The error taxonomy

Every adapter fails differently and three consumers have to say something about it: the
card's status pill, the card foot's test note, and Z.3's
([#196](https://github.com/NobuData/ouroboros/issues/196)) health snapshots. If each adapter
invents its own error strings, the UI ends up pattern-matching on prose.

So there are five words, and no more:

| Class | Pill | Tone | Retryable | `provider_connections.status` | Typical cause |
|---|---|---|:---:|---|---|
| *(none — passed)* | `connected` | ok | — | `active` | — |
| `auth` | `key rejected` | err | no | `error` | `401`, `403`, `407` |
| `network` | `unreachable` | err | yes | `error` | refused socket, DNS, timeout, `408` |
| `upstream` | `degraded upstream` | warn | yes | `error` | any `5xx` |
| `rate_limit` | `rate limited` | warn | yes | `error` | `429` |
| `config` | `needs configuration` | err | no | `error` | `3xx`, and every other `4xx` |

The mapping is **1:1** in both directions — five classes, five distinct pills — and
`provider.errors.spec.ts` asserts the injectivity rather than trusting this table to stay
true. `connected` and `degraded upstream` are lifted verbatim from
[`docs/mockups/07-providers.html`](mockups/07-providers.html); the tones are the three
`.pill` modifiers in `mockups/assets/ouroboros.css`.

**The last column is deliberately constant.** V015 gives a connection four statuses and
none of them means *working, but throttled*, so every failure coarsens to `error`. The pill
is the finer instrument and answers *why*; the column is the coarse routing signal and
answers *may Z.1 use this*. Pretending a rate limit was `active` would route to a provider
that is currently refusing.

**Do not invent a sixth class in an adapter.** If your provider genuinely fails in a way
none of the five describes, add the class here — with a pill, a tone and a spec — because
every consumer downstream switches on exactly these.

### The helpers you should use rather than re-derive

```ts
classifyHttpStatus(503)       // "upstream"
describeHttpRefusal(401)      // "key rejected (401)"
describeTransportFailure(e, timeoutMs)  // "unreachable (ECONNREFUSED)" | "timed out after 5000 ms"
```

`describeHttpRefusal` shares its vocabulary with `provider-health/probe.client.ts` on
purpose: `key rejected (401)` already appears on mockup 06's health strip, and somebody
moving between the two pages should not have to learn that they mean the same thing.

If your provider needs a different reading of one status — a vendor that answers `403` for
a quota rather than for a credential — override *that status* and call `classifyHttpStatus`
for the rest. Do not fork the table.

## The config schema

`configSchema()` answers a **narrow subset of JSON Schema**: one flat object of
string-valued fields, `additionalProperties: false`, and nothing else. No `$ref`, no
`oneOf`, no nesting.

That narrowness is the whole of the *"zero UI special-casing"* claim. A renderer that has
to handle composition keywords is a renderer full of special cases — it just moves them from
*per provider* to *per keyword*, which is worse, because the second list has no end.
`configSchemaViolations()` is the gate, the conformance kit runs it, and `toFormFields()` is
total over what survives.

Two annotations exist, both `x-` prefixed so a generic validator ignores them:

| Annotation | Means |
|---|---|
| `x-ouroboros-secret: true` | This field's value goes to the **vault**, never into the config object. At most one per schema. Renders as the masked key row. |
| `x-ouroboros-placeholder` | The input's placeholder. Prose, not an example — mockup 07's is *"API key — optional, no auth configured"*. |

### The one reserved field name

**A field that takes an address is called `baseUrl`, whatever your vendor calls it.** Its
value lands in `provider_connections.base_url`.

Ollama's card says **Host** and the vLLM card says **Base URL**; they are the same field
with different `title`s. If two adapters each named the field after their own vendor's word
for it, the card would need to know which vendor it was rendering in order to find the
address — which is exactly the `switch (kind)` decision P1 refuses.

### Splitting a submitted form

Never split it by hand. `partitionSubmission(schema, values)` returns
`{ config, secret }`, derived from the same annotation the renderer used to mask the input.
A consumer that gets that split wrong once writes a plaintext credential into
`provider_connections` — and V015's CHECK will not catch it, because that constraint guards
the *encrypted* column.

## Capabilities

```ts
interface ProviderCapabilities {
  discovery: boolean;      // does discoverModels() ask the provider, or answer a fixed catalog?
  pull: boolean;           // does this adapter implement PullCapableAdapter?
  entitlements: boolean;   // does validate()'s detail carry seat/entitlement information?
  invocation: boolean;     // reserved for AF.2 (#235) — false on everything today
}
```

**`discovery: false` does not mean the member is absent.** Copilot and Cursor each show a
single model chip that this product knows about because somebody wrote it down, and a
`discoverModels` returning that list is telling the truth. What the flag says is whether
*refreshing* means anything — AE.4 ([#230](https://github.com/NobuData/ouroboros/issues/230))
hides the refresh affordance where it is `false`, because a spinner over a constant is a lie
about where data comes from.

**`pull` is gated at compile time.** `ModelProviderAdapter` has no `pullModel` at all, so:

```ts
registry.get("copilot").pullModel(conn, id);   // ✗ Property 'pullModel' does not exist
registry.pullCapable("ollama").pullModel(conn, id);   // ✓
```

A caller holding an adapter uses the guard instead:

```ts
if (supportsPull(adapter)) {
  for await (const progress of adapter.pullModel(conn, id)) { /* … */ }
}
```

`supportsPull` narrows on the **flag**, not on the member being present — an adapter is
entitled to say what it can do, and a half-finished `pullModel` must not become callable
because it happens to exist. The registry refuses at boot any adapter whose flag and member
disagree, so the two cannot drift.

**`invocation` is reserved and must stay `false`.** AF.2
([#235](https://github.com/NobuData/ouroboros/issues/235)) adds an
`InvocationCapableAdapter` in exactly the shape of `PullCapableAdapter` — an interface
extending the SPI, narrowing `capabilities()`, declaring `invoke`, with a
`supportsInvocation` guard beside it. The request and event shapes it will use are already
written, in `internal/invoke.contract.ts`. Nothing in the SPI has to move for that to
happen, which is the point of reserving the flag now: AF.2 *extends* the interface rather
than reshaping it, and every adapter that already ships keeps compiling.

## Write one — the walkthrough

The worked example is `adapters/fake.adapter.fixture.ts`. It is the in-memory adapter that
powers core tests, and it is written to be copied.

### 1. Declare the kind

```ts
export class OllamaAdapter implements ModelProviderAdapter {
  readonly kind = "ollama" as const;
```

`kind` must be one of V015's six `provider_connections.kind` values — the same spellings
`model_prices.match_provider_kind` carries, so a connection and a price agree about what
they are describing without either translating. A genuinely new provider needs a migration
in `ouroboros-db` first.

### 2. Write the config schema

```ts
configSchema(): ProviderConfigSchema {
  return {
    $schema: PROVIDER_CONFIG_DIALECT,
    type: "object",
    title: "Connect an Ollama host",
    properties: {
      [BASE_URL_FIELD]: {
        type: "string",
        title: "Host",
        format: "uri",
        minLength: 1,
        "x-ouroboros-placeholder": "http://ken-station.local:11434",
      },
    },
    required: [BASE_URL_FIELD],
    additionalProperties: false,
  };
}
```

Return a **fresh value every call**. AE.5 holds this while somebody fills in a form; an
adapter handing out its own object would have that form's edits land in the adapter. The
kit tries exactly that and fails you if it sticks.

Field order is the insertion order of `properties`, and it is the order the form renders
in. Address first, credential second, the way mockup 07 draws the vLLM card.

### 3. Declare capabilities

```ts
capabilities(): ProviderCapabilities {
  return { discovery: true, pull: false, entitlements: false, invocation: false };
}
```

All four, every time. `false` is an answer; an absent flag is four consumers each deciding
what `undefined` means.

### 4. Implement `validate`

**Check the configuration before you open anything.** A missing address is something you
know about without a socket, and reporting it as `network` because the socket failed sends
somebody to check a firewall:

```ts
async validate(config, secret): Promise<ProviderValidation> {
  const host = config[BASE_URL_FIELD];

  if (host === undefined || host.length === 0) {
    return { status: "failed", errorClass: "config", detail: "baseUrl required" };
  }

  const started = performance.now();

  try {
    const response = await fetch(`${host}/api/tags`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: authorize(secret),
    });

    if (!response.ok) {
      await response.body?.cancel();

      return {
        status: "failed",
        errorClass: classifyHttpStatus(response.status),
        detail: describeHttpRefusal(response.status),
      };
    }

    await response.body?.cancel();

    return {
      status: "ok",
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
      detail: response.status.toString(),
    };
  } catch (error) {
    return {
      status: "failed",
      errorClass: "network",
      detail: describeTransportFailure(error, TIMEOUT_MS),
    };
  }
}
```

Four rules this obeys, and the kit checks all four:

- **It never rejects.** Every failure a provider can cause is a return value.
- **A latency only appears on success.** A timeout's "latency" is the deadline and a
  refusal's is how fast the refusal came; neither is what the word means on a card.
- **`detail` never contains the credential.** The shortest path to a leaked key is echoing a
  provider's error body, and provider error bodies quote request headers. Never put a
  response body in `detail`.
- **The body of a refusal is cancelled unread.** An unread body keeps its connection checked
  out of undici's pool until the collector gets to it.

### 5. Implement `discoverModels`

```ts
async discoverModels(connection): Promise<NormalizedModel[]> {
  // …fetch, then map into this product's vocabulary:
  return listing.models.map((model) => ({
    id: model.name,                     // the provider's own id, unchanged
    display: prettify(model.name) ?? model.name,
    contextLength: model.context_length ?? null,
    sizeBytes: model.size ?? null,
  }));
}
```

**`id` is the provider's own identifier, unchanged.** It is what a later call sends back,
and `model_aliases.model` and `model_prices.match_model` are written against these
spellings. An adapter that prettified an id here would break the join that makes a chip's
price real.

**`null` means the provider did not say.** Never zero, never a guess: a model whose context
length is unknown and a model with no context are different facts, and only one of them is
possible.

Throw `ProviderAdapterError` if the provider could not be asked. An empty list is a
legitimate answer — a freshly installed Ollama daemon has no models — and must not be
confused with a failure.

### 6. Implement `pullModel`, if your provider pulls

Implement `PullCapableAdapter`, declare `pull: true`, and stream:

```ts
async *pullModel(connection, modelId): AsyncIterable<ModelPullProgress> {
  yield { status: "pulling manifest", completedBytes: null, totalBytes: null, done: false };
  // …
  yield { status: "success", completedBytes: total, totalBytes: total, done: true };
}
```

Exactly one event carries `done: true` and it is the last. Completion is a statement the
stream makes, not something inferred from an iterator finishing — a stream that just stops
is what a pull looks like when the daemon dies half way through.

### 7. Register it

One line, in `providers.module.ts`:

```ts
export const REGISTERED_ADAPTERS = [OllamaAdapter] as const;
```

That is the whole of what adding a provider costs on the wiring side. Nothing else in the
service learns your provider's name.

## The conformance kit

Write one spec file:

```ts
describeAdapterConformance("OllamaAdapter", () => {
  const adapter = new OllamaAdapter();

  return {
    adapter,
    secret: null,
    sampleConfig: { baseUrl: "http://ken-station.local:11434" },
    validateSuccess: () => withRecorded("tags-200", () => adapter.validate(CONFIG, null)),
    validateFailures: {
      auth: () => withRecorded("401", () => adapter.validate(CONFIG, null)),
      network: () => withRefusedSocket(() => adapter.validate(CONFIG, null)),
      upstream: () => withRecorded("503", () => adapter.validate(CONFIG, null)),
      rate_limit: () => withRecorded("429", () => adapter.validate(CONFIG, null)),
      config: () => adapter.validate({}, null),
    },
    discover: () => withRecorded("tags-200", () => adapter.discoverModels(CONNECTION)),
    expectedModels: EXPECTED,
    pull: () => withRecorded("pull-stream", () => adapter.pullModel(CONNECTION, "phi4:14b")),
  };
});
```

You get roughly thirty assertions about things that are otherwise discovered by a person in
a browser: that failures are values, that a detail never quotes the credential, that the
schema is one AE.5 can render and one Ajv accepts, that the `pull` flag and the `pullModel`
member agree, that ids are unique and measures are never fabricated.

Three things about the harness are deliberate:

- **It is a function.** It is called once per case, so no test can be affected by a previous
  one's recording.
- **Every one of the five error classes is required.** There is no *"this cannot happen for
  my provider"* escape hatch. All five are arrangeable for anything that talks HTTP, and an
  author who cannot produce one has not decided what their adapter does about it.
- **The fixtures are recorded, not live.** Arrange a stand-in `fetch` over a captured
  response. The kit never opens a socket, which is what lets it run in `yarn test` rather
  than in the integration suite where a slow provider would make it flaky.

`adapters/fake.conformance.spec.ts` is the kit passing; `conformance.fixture.spec.ts` is the
kit *failing*, run against adapters that are wrong on purpose. Both matter — a conformance
kit nobody has watched fail is a conformance kit that passes everything.

## The boundary

`.dependency-cruiser.cjs` at the module root, run by `yarn lint`:

| Rule | Refuses |
|---|---|
| `no-provider-sdk-outside-adapters` | A provider SDK imported from anywhere but `providers/adapters/`. |
| `core-imports-the-spi-only` | Any file but `providers.module.ts` (and tests) importing an adapter. |
| `no-circular` | A dependency cycle anywhere in `src/`. |

The SDK list is explicit — there is no property of a module name that means *this is a
provider SDK* — and it covers the five kinds that ship plus OpenAI, Google and Bedrock.
**Adding a provider means adding its package to that list.** That is the intended cost: an
adapter's dependency is a decision, and this is where the decision is recorded.

Tests are exempt from the second rule, because the in-memory fake exists to power them.
`providers/boundary.spec.ts` builds a tree containing each violation and asserts the build
really fails.

## What is not here yet

| | |
|---|---|
| The five real adapters | AC.2 ([#217](https://github.com/NobuData/ouroboros/issues/217)), AC.3 ([#218](https://github.com/NobuData/ouroboros/issues/218)), AC.4 ([#219](https://github.com/NobuData/ouroboros/issues/219)), AC.5 ([#220](https://github.com/NobuData/ouroboros/issues/220)) |
| Credential add / reveal / rotate | AD.2 ([#223](https://github.com/NobuData/ouroboros/issues/223)) |
| The add-form and catalog | AE.5 ([#231](https://github.com/NobuData/ouroboros/issues/231)) |
| Invocation through an adapter | AF.1 ([#234](https://github.com/NobuData/ouroboros/issues/234)), AF.2 ([#235](https://github.com/NobuData/ouroboros/issues/235)) |
| Cloud adapters — OpenAI, Google, Bedrock | AF.3 ([#236](https://github.com/NobuData/ouroboros/issues/236)) |

`REGISTERED_ADAPTERS` is empty, so `ModelProviderRegistry.get` answers `501
provider_kind_unsupported` for every kind. That is the accurate thing for this build to say
about `anthropic`: V015 accepts the row, and nothing here knows how to reach it yet.
