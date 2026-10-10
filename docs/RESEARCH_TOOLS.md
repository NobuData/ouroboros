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
  counts(org, config);        // live values for the template's {slots}: a count, a phrase, or null = unknown ("—")
  configSchema();             // workspace settings, in the ticket-source form dialect
  capabilities();             // {search, fetch, query, watch}
  healthCheck(config, secret, org?) // {state, detail}; config null → not_configured, with no network call
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
| `competitor` | `adapters/competitor/` — the watch scheduler, its snapshots and scoped diffs; `query` ops `changes` / `latest` cite archived diffs | CL.3 #616 |
| `code` | `adapters/code/` over `research/code/` — blame, history, changed-between and dependency graphs read from the engine's clones (`/v0/code/*`), and the bisect primitive over build-farm jobs | CL.4 #617 |
| `tickets` | `adapters/tickets/` over `research/history/` — full-text search, lookup and aggregates over canonical tickets, mirrored PRs and imported document sets (`history_index_entries`, V119) | CL.5 #618 |

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

### `competitor` (CL.3, #616)

- **Registry** (core, `research/competitors/`): rivals and watches, owner/admin CRUD at
  `/api/v1/research/competitors`, and the change feed at `/api/v1/research/competitor-changes`.
  `competitor.kinds.ts`, `competitor.selector.ts` (the CSS subset a watch may carry) and
  `competitor.diff.ts` (normalisation and the `+`/`-` line diff) are shared with the adapter.
- **Scheduler** (`competitor.scheduler.ts`): every `OURO_RESEARCH_WATCH_TICK_MS` (jittered, never at
  boot) claim at most `OURO_RESEARCH_WATCH_BATCH` due watches (`for update skip locked`, a 15-minute
  lease) and check them one at a time.
- **Snapshotter** (`competitor.snapshotter.ts`): page kinds through the shared `PageFetcher`
  (`RESEARCH_PAGE_FETCHER` — one robots cache and host pace for both tools) scoped by the selector
  or the main content; `rss` via `saxes`; `github_releases` via `GithubClientFactory`; `filings` →
  `unsupported` with the v2 note; an empty region on a script-rendered page → `render_required` with
  its note. Same hash → nothing written; a change → snapshot + diff + `competitor_snapshot_contents`
  (V117).
- **Tool** (`competitor.tool.ts`): sub-line `{watched} · {kinds}` from `competitor_tracker_summary`
  (sub-line slots may be phrases since #616); `query` `{op: "changes", rival, windowDays?,
  sourceKind?}` / `{op: "latest", rival, sourceKind}` → `competitor_diff` sources naming the snapshot;
  health ages each readable watch's last read against two cadences (`healthCheck` takes the
  workspace since #616).

### `code` (CL.4, #617)

- **Where git runs.** The engine keeps bare clones per workspace and repository
  (`ouroboros-engine/src/ouroboros_engine/code/`, dulwich — no git binary; `OURO_ENGINE_CLONE_DIR`)
  and answers `POST /v0/code/{blame,history,changed-between,dep-graph,bisect-commits}`. The REST
  side never touches git: `research/code/code.reader.ts` resolves the repository among the
  workspace's **enabled** ones, hands the engine the workspace's GitHub token for that call
  (`code.workspace.ts`), and classifies every refusal (`code_*` → `unsupported` / `auth` /
  `network`). `EngineClient.code()` returns a `code_*` refusal instead of throwing it.
- **Read-only, structurally.** Operations get the engine's `ReadOnlyRepo` (lookups only);
  `tests/test_code_readonly.py` asserts the operation modules import and call nothing that writes,
  and that every operation leaves a clone's bytes — and the remote's — unchanged.
- **Citations.** `code.sources.ts`: `git://owner/name@<40-hex>/path#Lnn` at the exact commit read
  (V108), and a converged bisect as `bisect://owner/name@<culprit>?jobs=<uuid>,…` (V118 widened
  `source_locator_valid()`; the TS mirror is `research-tool.citations.ts`). Blame's
  *unchanged in N months* is measured to the commit read, not the clock, so it re-runs the same.
- **`dep_graph`.** C/C++ includes, Python imports, JS/TS imports, for the stack BB.1's language
  row reports; anything else — or a module with no source of its stack — is `unsupported` with
  the reason, never an empty graph.
- **Bisect** (`code-bisect.service.ts`, `code-bisect.search.ts`). The engine lists the
  first-parent line good..bad; each step is one `FarmJobsService.submit` at the window's middle
  (`succeeded` → good, `failed` → bad, a `retried` job's retry followed, `canceled` → `failed`),
  at most ⌊log₂ n⌋ + 1 steps (a one-commit line is built once to confirm). The checkpoint
  (`code_bisects.lo..hi`, V118) moves in the same transaction as the step's verdict, holding the
  row `for update`; `CodeBisectScheduler` settles on each `JobCompletions` event and resumes every
  `OURO_RESEARCH_BISECT_TICK_MS`. The same question returns the same bisect.
  `CodeModule` exports `CodeBisectService` and `code.sources.ts`'s `bisectSource` for #623.

### `tickets` (CL.5, #618)

- **One corpus, no tracker.** `history_index_entries` (V119) unions canonical tickets (V030),
  mirrored PRs (V052) and imported documents in one shape, and never reads `ticket_sources.kind`
  — so `research/history/history-index.repository.ts` cannot tell a Jira-fed ticket from a
  GitHub-fed one (decision V2; `history-index.integration-spec.ts` ingests one through the
  in-memory provider and asserts it). Every read names the workspace first.
- **Locators.** A ticket is `issue-index://<slug of its source's name>/<external_id>`, a PR
  `…/pull/<number>`, an imported set `issue-index://<collection>/<name>` and a document
  `…/<key>` — all `ticket`-kind sources V108 accepts. A locator is not a key: `get` answers every
  entry it names (two sources whose names slug alike).
- **Search.** `history_index_document(title, body)` — title weight A, body B, English — behind a
  GIN index on each table. An entry matches any term; those matching every term rank first, then
  `ts_rank_cd`, then newest. Excerpts are `ts_headline`'s.
- **`query` ops.** `{op: "search", q, kinds?, labels?, since?, until?, repo?, set?, limit?}`,
  `{op: "get", ref}`, `{op: "aggregate", groupBy: "label" | "period" | "kind" | "repo" | "set",
  period?, q?, windowDays?, …filters}`. An aggregate cites the newest three entries of its
  leading eight buckets; an answer with nothing in it is `null`.
- **Budget.** `SEARCH_BUDGET_MS` (500) is applied as a statement timeout; a cancelled statement
  (`57014`) is `upstream`, naming the budget.
- **Imports** (core, `research/history/`): `document_imports` / `document_import_items`, read by
  every member and written by an owner at `/api/v1/research/document-imports`
  (`document-import.parse.ts` reads CSV and Markdown). Never edited — replace by removing.
- **Sub-line.** `{issues} · {prs} · {imports}`, counted from the view.

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
