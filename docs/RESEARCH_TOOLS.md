# Research tools — writing an adapter

CL.1 ([#614](https://github.com/NobuData/ouroboros/issues/614)), decisions **V2** (pluggable
tools) and **V3** (every claim cited). This is the third application of the SPI pattern the
ticket-source (#139) and model-provider (#216) interfaces set.

Everything lives in `ouroboros-rest/src/modules/research/tools/`:

| File | What it is |
|---|---|
| `research-tool.adapter.ts` | The interface — the only file core code may import |
| `research-tool.config.ts` | The config-schema dialect (the ticket-source form dialect, reused) |
| `research-tool.health.ts` | Health states → the tools card's dots; the sub-line template |
| `research-tool.errors.ts` | The six-class error taxonomy and the surface's refusals |
| `research-tool.citations.ts` | The citation contract, as code |
| `research-tool.registry.ts` | Lookup by slug (DI token `RESEARCH_TOOL_ADAPTERS`) |
| `research-tools.module.ts` | The single place an adapter is registered |
| `conformance.fixture.ts` | The conformance kit every adapter must pass |
| `adapters/fake.tool.fixture.ts` | The in-memory fake — powers core and loop tests, no network |
| `tools.internal.controller.ts` | `POST /internal/research/tools/:slug/:op` — the engine's only way in |

## The interface

```ts
interface ResearchToolAdapter {
  slug;                       // a research_tools slug: web, competitor, code, tickets, telemetry, docs
  displayMeta();              // {name, glyph, subLine} — subLine is a template: "{rivals} rivals watched · …"
  counts(org, config);        // live numbers for the template's {slots}; null = unknown (renders "—")
  configSchema();             // workspace settings, in the ticket-source form dialect
  capabilities();             // {search, fetch, query, watch}
  healthCheck(config, secret) // {state, detail}; config null → not_configured, with no network call
  operationPriceCents?(config) // optional: cents per operation for #622's estimate; null = unpriced
}
// plus, gated by capabilities() like provider `pull`:
search(ctx, query, {limit}) | fetch(ctx, locator) | query(ctx, structured)
  → { payload, sources: SourceRecord[], usage: {tokens} }
```

An adapter that searches implements `SearchCapableTool` (and so on); callers reach an operation
only through `supportsSearch()` / `supportsFetch()` / `supportsQuery()`. The registry refuses to
boot if a flag and its member disagree.

## The citation contract

Every operation returns the sources it read, in the citation ledger's shape (V108,
`source_records`): `kind`, `title` (≤ 300 chars), `locator` (validated per kind exactly as
`source_locator_valid()` does), `retrievedAt`, `contentHash` (`sha256:<hex>`), `excerpt`
(non-blank, ≤ 4 KiB) and `meta` (an object, ≤ 8 KiB as jsonb text). A `competitor_diff` source
also names the archived snapshot it cites (`snapshotId`, V112).

**A payload with no sources fails** — in the conformance kit, and at run time, where the
internal surface answers `502 research_tool_contract_violation` and archives nothing. The one
exception is the empty answer: a `null` payload (a search with no hits) has nothing to cite.

Accepted sources are archived in the investigation's ledger as they arrive (an identical
locator + content hash is not written twice) and the answer carries their cite numbers.

## Failures

Throw `ResearchToolError(errorClass, detail, retryAfterSeconds?)` — nothing else:

| Class | Surface state | Retry |
|---|---|---|
| `auth` | `reconnect` | no |
| `network` | `retrying` | yes |
| `robots_denied` | `skipped_source` | no |
| `rate_limited` | `backing_off` | yes |
| `upstream` | `retrying` | yes |
| `unsupported` | `not_supported` | no |

`detail` must never contain the credential. An unclassified exception is a contract violation.

## Health and the tools card

`healthy → ok`, `degraded → warn`, `down → err`, `not_configured → idle` — one state per dot.
`healthCheck()` never rejects.

## Configuration and credentials

`configSchema()` uses the ticket-source dialect (flat strings, one `x-ouroboros-secret` field, and
string lists), so the enable flow (#629) renders it with the same components as a source form.
The credential is split off for the vault and handed to an operation only as
`ToolCallContext.secret`, for one call. Settings are read through `ResearchToolSettings`, which
answers "nothing configured" until #629 binds the real store.

## Budgets

The engine loop owns an investigation's remaining operations and tokens and sends them with each
call. The surface refuses a call with nothing left (`409 research_budget_exhausted`), hands the
adapter the remaining tokens as `ToolCallContext.tokenCeiling`, and answers what remains after the
adapter's reported `usage.tokens`. Reporting more than the ceiling is a contract violation.

## The internal surface

`POST /internal/research/tools/:slug/:op` with `{investigation, input, budget}`, behind
`X-Ouro-Internal-Key`. The workspace is resolved from the investigation, never named by the
caller. Refusals in order: `404 investigation_not_found`, `409 investigation_not_running`,
`403 research_tool_not_enabled`, `501 research_tool_not_registered`,
`422 research_tool_operation_unsupported`, `409 research_budget_exhausted`,
`409 research_tool_not_configured`. See `ouroboros-rest/openapi.internal.yaml`.

## Hosted prices

A tool that can be pointed at a paid API declares `operationPriceCents(config)`.
`research-tool.pricing.ts` (`RegistryToolPricing`, bound in `ResearchModule` in place of
`ResearchToolPricing`) asks each tool an estimate names, with the workspace's stored
configuration, and the estimator (#622) prices those operations. Absent, `null` or `0` leaves the
tool out — the estimate never guesses.

## Registered tools

| Slug | Adapter | Since |
|---|---|---|
| `web` | `adapters/web/` — search through SearXNG (default), Brave, Tavily or Firecrawl; our own robots-aware page reader | CL.2 #615 |

### `web` (CL.2, #615)

- `web.providers.ts` — the four providers as configuration: how to ask, how to read the answer,
  the list price per search. Switching provider changes nothing else (`web.conformance.spec.ts`
  runs the kit once per provider over recorded answers).
- `web.fetcher.ts` — robots.txt (RFC 9309, `web.robots.ts`, cached per origin a day; 4xx = allow
  all, 5xx/unreachable = disallow all), per-host pacing (`OURO_RESEARCH_HOST_INTERVAL_MS` or the
  site's crawl-delay up to 30 s), manual redirects re-checked hop by hop, a byte cap, a timeout,
  content-type routing (HTML → `web.extract.ts`, text/JSON/XML as is, PDF → the *papers tool
  arrives in v2* skip, anything else → unsupported).
- `web.transport.ts` — node http(s) pinned to the address the webhook SSRF policy approved
  (`OURO_RESEARCH_FETCH_INTERNAL_ALLOWLIST` for exceptions); address literals checked too.
- **Skips.** A fetch failing `robots_denied` or `unsupported` is not a 502: the invoker records it
  in `source_skips` (V116) with its note and answers `200` with `skipped`, so the investigation's
  record says honestly what was not read.

## Writing an adapter

1. Put it in `adapters/<slug>.tool.ts`. Import any SDK there and nowhere else.
2. Register it in `research-tools.module.ts`'s `registeredAdapters()`. Nothing else may import
   it — `.dependency-cruiser.cjs` (`research-tool-core-imports-the-spi-only`) fails the build.
3. Record fixtures (a stand-in `fetch` over captured responses — never a live socket) and write
   one spec:

   ```ts
   describeToolConformance("web", () => ({
     adapter, config, secret,
     operations: { search: () => …, fetch: () => … },   // one per declared operation
     failures: { network: () => …, upstream: () => …, robots_denied: () => … },
     health: { healthy: () => …, down: () => … },
   }));
   ```

   Every adapter must record `network` and `upstream` failures; record every other class it can
   produce.
