# Roadmap — Providers & Keys (Mockup 07)

## Description

> Create a roadmap that covers the features for the mockup page 07. Any additional
> tech infrastructure that is required to implement the functionality in these mockup
> pages should be researched and offered as options for implementing in the roadmap.
> The roamdap should include MVP and v2 options, as well as the labels, milestones,
> and the like, for the tickets to be created. Any ticket sources that are used by
> Ouroboros for ingesting should be pluggable, which includes sources like Jira,
> Linear, GitHub, GitLab, and other bug reporting/issue recording sites. Refer to the
> page so that issues can reference the mockup file when creating the UI/UX design of
> the pages. Be very specific when creating the roadmap, as the options in the
> roadmap for the functionality needs to be complete and very thorough.

## Context & Existing Work (duplicate-avoidance survey)

Surveyed 2026-08-08.

**Design source of truth for every UI ticket in this roadmap:**
[`docs/mockups/07-providers.html`](mockups/07-providers.html) (with
`docs/mockups/assets/ouroboros.css`) — Providers & Keys. Its anatomy:

- **Page head** — eyebrow `Models`, h1 `Providers & keys`, subline: *"Credentials
  live in acme-robotics' encrypted vault, scoped to this tenant. Keys never leave
  the control plane — workers only ever see short-lived tokens."* Actions:
  **Audit log** (ghost), **+ Add provider** (primary).
- **Subnav** — Routing (→ mockup 06) / Model registry (→ 21) / **Providers &
  keys** (active, accent underline) / Spend (stub).
- **Five provider cards** (`c-6 .provider`), each with: monogram (per-provider
  tinted `AN`/`CU`/`GH`/`VL`/`OL`), name + capability line, status pill
  (`connected` ok / `degraded upstream` warn), enable **switch**; masked
  **key row** (`sk-ant-api03-••••••••••••Xq4A` + **Reveal** + **Rotate**; vLLM
  variant has a **Base URL** field + optional key; Ollama variant has a **Host**
  field); **meta row** (`Added by Ken · 2026-06-12 · last used 3m ago`);
  **Models available** chips (Anthropic: four `claude-*` pills + `priority tier`;
  Cursor: `cursor/composer-2`; Copilot: `copilot/gpt-5-codex`; vLLM:
  `local/llama-4-maverick`, `local/deepseek-v3.2`) — Ollama instead shows a
  **Detected models pull-list** (`qwen3-coder:32b · 19 GB`, `llama4:scout ·
  63 GB`, `phi4:14b · 9.1 GB`, each with **Pull latest**); **monthly spend
  meter** (`This month $412.80 of $600 cap` 69%; Copilot warn-meter `$76.00 of
  $95 cap · 4 seats`; locals `$0.00 · no metered spend` / `2.1M tokens on-box`);
  **card foot**: **Test connection** + live result note (`✓ 200 · 38ms` ok /
  `△ 503 upstream · retrying` warn) + **Monthly cap** field (`$600`, `—` for
  locals).
- **Add-provider card** (dashed) — *"Connect OpenAI, Google, Bedrock, or any
  OpenAI-compatible endpoint"* + **Browse catalog**.
- **Security strip** (`c-12`) — shield glyph, copy: *"Keys are sealed per-tenant
  with **envelope encryption** (AES-256-GCM, KMS-backed). Workers receive
  scoped, 15-minute tokens — never your raw key."*, tags `SOC 2 Type II` /
  `ISO 27001`, **Read the security model ↗**.

**Overlapping work and dispositions:**

| Existing work | Disposition under this roadmap |
|---|---|
| Routing roadmap Y.1 (`provider_connections` + `model_aliases` schema foundation, "07/21 build UIs later"); Z.3 passive health | **Built upon** — this roadmap is the promised provider UI + the adapter framework; Y.1's schema is extended (caps, meta, discovery), never forked. Z.3's health service gains adapter-backed test/discovery calls. |
| Routing roadmap AB.1 (invocation-gateway requirements handoff, "the 07 roadmap's ADR") | **Landed here** — AF.1 is that ADR (LiteLLM-under-custom vs pure custom adapters); AF.2 implements the chain executor against it. |
| Routing roadmap Z.5 (spend aggregation), DASH-F.3 `token_usage`, DASH-J.4 pricing | **Consumed** — the cards' monthly meters aggregate calendar-month spend per provider from the same truth; caps stored here feed enforcement (AF.4). |
| WF Epic Q ticket-source SPI (pluggability precedent) | **Pattern reused** — the `ModelProviderAdapter` SPI (AC.1) mirrors Q.2's discipline: core code depends on the interface only, conformance kit gates new adapters. The description's pluggable-ticket-sources requirement itself remains satisfied by WF-Q (Jira/Linear/GitLab as WF-T.2–T.4); nothing source-related is duplicated here. |
| Scaffolding #26 audit log (v2), BA roadmap encryption helper (AES-GCM), #22/BA-B.3 GitHub org data | **Coordinated** — credential operations require an audit trail from day one (AD.4): it early-adopts #26's `audit_events` shape (filing-time coordination). BA's helper is superseded by the AD.1 envelope-encryption service (one migration path for Q.1/K.3 credentials too) — **AD.1 (#222) is 🟢 delivered**, and it ships the migration as a registration seam with **no stores registered**: Q.1 (#138), K.3 (#101) and Y.1 (#189) are all still open, so there is no encrypted column in the schema for a job to convert yet. Each of them registers a `VaultSecretStore` when it lands. |
| Mockup 21 (model registry UI), Spend tab | **Out of scope** — discovery *feeds* the registry data (aliases resolve against discovered models), but the registry management UI stays with mockup 21's roadmap; Spend stays with AB.4. |
| Scaffolding #49 placeholder, #56 e2e, AA.1 subnav ("Providers & keys · soon") | **Superseded/amended** — the Providers tab goes live (AA.1 amendment); #56 gains a providers leg. |

Epic letters continue the sequence (…Y, Z, AA, AB): this roadmap uses
**AC, AD, AE, AF**.

## Infrastructure Options (researched — thorough, pick before filing)

### 1. Secrets encryption backend (the "encrypted vault" of the subline)

| Option | Architecture | Fit | Trade-offs |
|---|---|---|---|
| **A — Application-level envelope encryption, pluggable KEK backend, env-key default** ⭐ recommended MVP | Per-tenant **DEK** (AES-256-GCM) encrypts credentials; DEKs sealed by a **KEK** behind a `KeyWrapper` interface; default wrapper = master key from `OURO_VAULT_MASTER_KEY` (env/file); KMS/Vault wrappers plug in without data migration (re-wrap DEKs only) | Matches the mockup's copy (envelope encryption, AES-256-GCM) while staying self-hostable with zero extra infra; per-tenant DEKs give crypto-shredding (delete tenant = destroy DEK); rotation = re-wrap, not re-encrypt | Master key custody is the operator's problem in the default; documented honestly in the security model (AD.5) |
| B — Cloud KMS as KEK (AWS KMS / GCP KMS / Azure Key Vault) | KEK never leaves the HSM; DEK generation via `GenerateDataKey`-style read-only APIs | The mockup's "KMS-backed" literally; strongest custody for cloud deployments | Cloud dependency violates self-hostable as the *only* path — hence a wrapper, not the core (AF.3 ships these wrappers) |
| C — HashiCorp Vault / OpenBao transit engine | Transit produces DEK/EDK pairs; KEK lives in Vault; client-side AES-256-GCM | Best self-hosted KMS-equivalent; multi-cloud portable; OpenBao keeps it fully OSS | Operating Vault/OpenBao is real work; right as an optional wrapper (AF.3), wrong as a hard dependency |
| D — pgcrypto in PostgreSQL | Encrypt/decrypt in SQL | No app changes | Keys transit the DB process and logs; weakest isolation — **rejected** |

### 2. Worker credential delivery (how the engine gets to providers)

| Option | Architecture | Fit | Trade-offs |
|---|---|---|---|
| **A — Control-plane proxied invocation** ⭐ recommended · 🟢 contract delivered (AD.3, #224) | Workers never hold provider keys: the engine calls the invocation gateway in `ouroboros-rest`; REST decrypts, calls the provider, streams back; per-run scoping + cost caps enforced at the single choke point | The subline's "keys never leave the control plane" made literal — stronger than the mockup's own 15-minute-token claim; one place for AB.1's per-hop errors, usage capture, cap enforcement | REST is on the token hot path (streaming throughput engineering); acceptable at MVP scale, measured before AF.2 finalizes |
| B — Short-lived credential leases | Engine requests a lease (`POST /internal/credentials/lease {provider, run}` → decrypted key material, 15-min TTL, scoped, audited); engine calls providers directly | Matches the mockup copy exactly; keeps REST off the streaming path | Raw keys do reach workers (briefly); revocation is TTL-bounded, not immediate; more audit surface |
| C — Vault dynamic secrets / STS-style broker | Vault issues true short-lived provider tokens where providers support them | Ideal custody | Almost no LLM providers support derived short-lived keys today; only workable generically via option C's own proxy — collapses into A |

**Recommendation:** A as the default path (honest copy adjustment: "workers never
see keys at all"), with B's lease API specified as the documented escape hatch
for future high-throughput local-provider paths (engine→Ollama on the same box
gains nothing from proxying — lease scoped to local providers only).

### 3. Provider adapter framework (the pluggability of *model* providers)

One `ModelProviderAdapter` SPI, mirroring the ticket-source SPI (WF-Q.2):

| Adapter | Auth | Discovery | Test | Extras | Status |
|---|---|---|---|---|---|
| Anthropic | API key | `/v1/models` | models-list + latency | priority-tier detection | **MVP (AC.2)** |
| OpenAI-compatible (vLLM, LM Studio, llama.cpp, TGI…) | base URL + optional key | `/v1/models` | same | self-hosted base-URL validation | **MVP (AC.3)** |
| Ollama | host URL | `/api/tags` (names + sizes) | version ping | **`/api/pull` model pulls**, on-box token counting | **MVP (AC.4)** |
| GitHub Copilot | GitHub token (org-billed) | fixed catalog | token + entitlement check (seats) | upstream-degraded detection | **MVP (AC.5)** |
| Cursor | API key | fixed catalog | key check | — | **MVP (AC.5)** |
| OpenAI · Google Gemini · AWS Bedrock | key / cloud creds | per-API | per-API | Bedrock = SigV4 + region | v2 (AF.3) — the add-card's catalog promise |

### 4. Invocation gateway (executes routing's resolved chains — the AB.1 ADR)

| Option | What it is | Fit | Trade-offs |
|---|---|---|---|
| **A — Custom executor over the adapter SPI** ⭐ ADR-favored | Chain executor in REST (per option 2-A): walks the Z.1 resolution hop-by-hop, per-hop error taxonomy (5xx/timeout→next, 4xx-auth→mark provider error, floor abort), streams, captures `token_usage` per hop, enforces caps | Adapters already exist for discovery/test — invocation completes them; our semantics (floor, votes, caps) implemented exactly; no infra | We own retries/streaming plumbing; SSE/stream pass-through engineering |
| B — LiteLLM proxy as executor under our resolution | Self-hosted LiteLLM given the *already-resolved* concrete chain (its router/alias logic unused) | 100+ providers for free; battle-tested streaming | Second service to operate; our per-hop semantics must map onto its fallback config (known alias/fallback mismatch class); usage capture via callbacks — indirection |
| C — Hosted gateway (OpenRouter/Portkey) | Hosted aggregation | Zero setup | Keys and traffic leave the tenant; breaks the page's core privacy promise as default — optional *adapter* at most |

The ADR (AF.1) decides A vs B with the AB.1 requirements doc as input; both
preserve the adapter SPI as the provider boundary.

## Decisions proposed by this roadmap (validate before issue creation)

| # | Decision | Rationale |
|---|----------|-----------|
| P1 | **`ModelProviderAdapter` SPI with per-kind adapters** (capabilities: auth mode, discovery, test, pull, invocation-later); core code imports the interface only (lint-guarded, conformance kit like Q.5) | The add-card promises a growing catalog; pluggability must be structural, mirroring the proven ticket-source pattern. |
| P2 | **Secrets = option 1-A**: per-tenant DEKs (AES-256-GCM) + pluggable KEK wrapper, env-master default; KMS/Vault wrappers v2 (AF.3) | Envelope encryption per the mockup, self-hostable by default, upgradeable without re-encrypting data. |
| P3 | **Workers get proxied invocation, not keys** (option 2-A), with a scoped lease API specified for local providers only | Stronger than the mockup's copy; the security-strip text is updated to the truth (honesty rule — AD.5 owns the wording). |
| P4 | **Reveal is a privileged, audited, re-authenticated action**; keys render masked-suffix only (`••••Xq4A`), never full in list payloads; Rotate = new secret verified by a live test before the old is retired | The key row's affordances must not become an exfiltration UI. |
| P5 | **Every credential operation is audited from day one** (add/reveal/rotate/enable/disable/cap-change/test), early-adopting #26's `audit_events` shape; the head's Audit log button shows this trail | Key custody without an audit trail fails the page's own security posture; filing-time coordination with #26. |
| P6 | **Discovery feeds the registry**: adapter discovery upserts a `provider_models` catalog (available models per connection — the chips and pull-list); mockup 21's registry UI consumes it; aliases (Y.1) validate against it | "Models available" must be discovered truth, not typed strings; the routing footnote "aliases resolve in the registry" gets its data layer. |
| P7 | **Caps are calendar-month, stored per connection, warning-first**: meters + threshold warnings in MVP; hard enforcement lands with invocation (AF.4) and is labeled "warning only" until then | The mockup shows caps today; enforcement without an invocation path would be fiction — label the truth. |
| P8 | **Spend meters follow the established honesty rules** (M7/DASH-J.4): priced spend only, `no metered spend`/`tokens on-box` for locals, em-dash for unknowns; Copilot seat count from adapter entitlement data, omitted if unavailable | No fabricated dollars. |
| P9 | **Test connection is user-initiated and cheap** (models-list/ping per adapter — no completions); result note shows real status + latency and updates Z.3 health snapshots | Live-feeling without synthetic spend; the `△ 503 upstream · retrying` state comes from real responses. |
| P10 | **Labels**: new `providers`, reusing `routing`/`security`-adjacent existing labels; **Milestones**: `Providers & Keys MVP` / `Providers & Keys v2` created at filing | Description requires labels + milestones for the filing pass. |

## Architecture Overview

```mermaid
flowchart LR
    subgraph Browser
        UI7["ouroboros-ui /models/providers<br/>cards · keys · test · caps · catalog"]
    end
    subgraph "ouroboros-rest (NestJS)"
        PAPI["/api/v1/providers<br/>CRUD · reveal · rotate · test · caps"]
        SPI["ModelProviderAdapter SPI (AC.1)<br/>anthropic · openai-compat · ollama · copilot · cursor"]
        VAULT["Envelope-encryption service (AD.1)<br/>tenant DEKs · KeyWrapper (env→KMS/Vault)"]
        AUD["credential audit trail (AD.4)"]
        INV["v2: invocation gateway (AF.2)<br/>executes Z.1 chains · caps · usage"]
    end
    subgraph "ouroboros-db"
        PC[("provider_connections (Y.1 + AC extensions)")]
        PM[("provider_models (discovered catalog)")]
        AE[("audit_events (P5)")]
        TU[("token_usage (DASH-F.3)")]
    end
    EXT["Anthropic · Cursor · Copilot<br/>vLLM · Ollama · (v2: OpenAI/Google/Bedrock)"]
    ENG["ouroboros-engine workers"]
    UI7 --> PAPI --> SPI --> EXT
    PAPI --> VAULT --> PC
    PAPI --> AUD --> AE
    SPI --> PM
    ENG -.->|"proxied invocation (P3)"| INV -.-> SPI
    PAPI -->|"monthly meters"| TU
```

## MVP Definition

The MVP is **mockup 07 as the real credential and provider control plane**. It is
done when, against the compose stack:

1. `/models/providers` reproduces
   [`docs/mockups/07-providers.html`](mockups/07-providers.html) pixel-faithfully
   in **both themes**: subnav with Providers active, the five seeded provider
   cards with every element (monograms, status pills, switches, key rows,
   meta rows, model chips / Ollama pull-list, spend meters, card feet), the
   dashed add-provider card, and the security strip (with P3-truthful copy).
2. **The adapter framework is real**: five conforming adapters (Anthropic,
   OpenAI-compatible, Ollama, Copilot, Cursor) behind the SPI, each passing the
   conformance kit; adding a connection renders a schema-driven form from the
   adapter's declared config.
3. **Credential lifecycle works end to end**: add (validated by a live test) →
   masked display → Reveal (re-auth + audit) → Rotate (verify-then-retire) →
   disable/enable switch → delete (blocked while aliases depend on it); all
   sealed by the AD.1 envelope-encryption service; every operation lands in the
   audit trail visible behind the head's Audit log button.
4. **Discovery is live**: Anthropic/vLLM model lists and Ollama tags (with
   sizes) populate `provider_models` and render as the cards' chips/pull-list;
   **Pull latest** triggers a real Ollama pull with honest progress; discovered
   models are what mockup 21's registry and Y.1 aliases validate against.
5. **Test connection** returns real status + latency per adapter (`✓ 200 ·
   38ms` / `△ 503 upstream · retrying`) and feeds the Z.3 health snapshots the
   routing strip shows.
6. **Caps & meters**: monthly caps stored per connection; calendar-month spend
   meters from `token_usage` (P8 honesty); threshold warnings (the Copilot
   warn-meter) — labeled warning-only until AF.4.
7. Integration tests cover the crypto service (round-trip, re-wrap, tamper),
   lifecycle + audit, adapter conformance (recorded fixtures), discovery
   upserts, cap math, isolation; the e2e suite gains a providers leg.

**Explicitly v2 (milestone `Providers & Keys v2`):** the invocation-gateway ADR
+ chain executor (AF.1/AF.2 — the unlock for the LLM estimator INTAKE-O.2 and
execution WF-T.6), OpenAI/Google/Bedrock adapters + KMS/Vault KEK wrappers
(AF.3), hard cap enforcement + alerts (AF.4), Ollama pull queue/progress
management (AF.5).

## Epics, Labels & Milestones

Each epic is a parent tracking issue on GitHub; every roadmap issue below is filed as
one of its sub-issues (GitHub Relationships).

| Epic | GitHub | Status | Name | Goal | Modules | Milestone |
|------|:------:|:------:|------|------|---------|-----------|
| AC | #212 | 🟡 Open | Provider Adapter Framework | SPI, five adapters, discovery catalog, schema extensions, seeds, CI | ouroboros-rest, ouroboros-db | Providers & Keys MVP |
| AD | #213 | 🟡 Open | Vault, Secrets & Audit | Envelope encryption, key lifecycle, worker credential model, audit, security doc | ouroboros-rest, ouroboros-db, docs | Providers & Keys MVP |
| AE | #214 | 🟡 Open | Providers UI | Cards, key flows, test/discovery UX, caps, add-provider catalog, states, e2e | ouroboros-ui | Providers & Keys MVP |
| AF | #215 | 🟡 Open | Invocation & Extended Providers (v2) | Gateway ADR + executor, cloud adapters, KMS/Vault wrappers, cap enforcement | all | Providers & Keys v2 |

Issue naming: `<project>: [<epic>.<issue>] <title>`. Labels: existing set (`mvp`,
`v2`, `rest`, `db`, `ui`, `ci`, `design`, `routing`) **plus new `providers`**
(decision P10). Milestones **`Providers & Keys MVP`** / **`Providers & Keys v2`**
created at filing; every issue assigned. Complexity chips: **XS · S · M · L**.

---

## Epic AC (#212) — Provider Adapter Framework (`ouroboros-rest` + `ouroboros-db`)

| Ref | GitHub | Status | Title | Summary | Labels | Parallel | MVP | Complexity | Affected Modules |
|-----|:------:|:------:|-------|---------|--------|:--------:|:---:|:----------:|------------------|
| AC.1 | #216 | 🟢 Done | ouroboros-rest: [AC.1] ModelProviderAdapter SPI & registry | Interface, capability flags, config schemas, lint boundary | mvp, providers, rest | N (after Y.1) | Y | L | ouroboros-rest |
| AC.2 | #217 | 🟢 Done | ouroboros-rest: [AC.2] Anthropic adapter | Key auth, models discovery, test, priority-tier detection | mvp, providers, rest | N (after AC.1, AD.1) | Y | S | ouroboros-rest |
| AC.3 | #218 | 🟢 Done | ouroboros-rest: [AC.3] OpenAI-compatible adapter (vLLM et al.) | Base-URL + optional key, `/v1/models` discovery, test | mvp, providers, rest | N (after AC.1, AD.1) | Y | S | ouroboros-rest |
| AC.4 | #219 | 🟢 Done | ouroboros-rest: [AC.4] Ollama adapter with model pulls | Host config, `/api/tags` discovery with sizes, `/api/pull` | mvp, providers, rest | N (after AC.1) | Y | M | ouroboros-rest |
| AC.5 | #220 | 🟢 Done | ouroboros-rest: [AC.5] Copilot & Cursor adapters | Token/key auth, fixed catalogs, entitlement checks | mvp, providers, rest | N (after AC.1, AD.1) | Y | M | ouroboros-rest |
| AC.6 | #221 | 🟢 Done | ouroboros-db: [AC.6] Schema extensions, discovered-models catalog & seeds | Y.1 extensions (caps, meta), `provider_models`, mockup-parity seeds, CI | mvp, providers, db, ci | N (after Y.1) | Y | M | ouroboros-db, .github |

### Issue AC.1 — ouroboros-rest: [AC.1] ModelProviderAdapter SPI & registry

> **GitHub issue:** #216 · **Status:** 🟢 Done · **Parent epic:** #212

> **Shipped 2026-08-23.**
> [`ouroboros-rest/src/modules/providers/`](../ouroboros-rest/src/modules/providers/),
> [`ouroboros-rest/.dependency-cruiser.cjs`](../ouroboros-rest/.dependency-cruiser.cjs), and
> the walkthrough at [`docs/MODEL_PROVIDERS.md`](MODEL_PROVIDERS.md).
>
> **The error taxonomy is the load-bearing half, and it is 1:1 by test rather than by
> table.** Five provider-neutral classes — `auth`, `network`, `upstream`, `rate_limit`,
> `config` — each render as one distinct pill, and `provider.errors.spec.ts` asserts the
> injectivity rather than trusting the documented table to stay true. `connected` and
> `degraded upstream` are lifted verbatim from the page, so the two cannot drift. What the
> table *also* records is a deliberate flattening: every failure coarsens to
> `provider_connections.status = 'error'`, because V015 has no status meaning *working, but
> throttled*, and letting a rate limit read as `active` would keep Z.1 routing to a provider
> that is currently refusing. The pill answers *why*; the column answers *may I use this*.
>
> **The capability gate is a compile error, not a runtime one.** `ModelProviderAdapter` has
> no `pullModel` at all — an adapter that pulls implements `PullCapableAdapter`, and the only
> doors to the member are `supportsPull` and `ModelProviderRegistry.pullCapable`. So
> `registry.get("copilot").pullModel(…)` does not compile, which is the acceptance criterion
> as a type; `provider.adapter.spec.ts` holds it with a `@ts-expect-error`, so the day
> somebody adds an optional member to the interface that suite stops compiling. `supportsPull`
> narrows on the *flag* rather than on the member being present, and the registry refuses at
> boot any adapter whose flag and member disagree — an adapter is entitled to say what it can
> do, and a half-finished `pullModel` must not become callable because it happens to exist.
>
> **`invocation` is reserved and documented, and the reservation is spendable exactly once.**
> AF.2 (#235) adds an `InvocationCapableAdapter` in the shape `PullCapableAdapter` already
> demonstrates — extend the interface, narrow `capabilities()`, declare the member, add a
> guard beside it — against request and event shapes that already exist in
> `internal/invoke.contract.ts` (AD.3). Nothing in the SPI has to move, which is the point of
> declaring the flag now, and the kit fails any adapter that sets it today.
>
> **"Zero UI special-casing" is proven with a fixture rather than asserted.**
> `card.shapes.fixture.ts` is mockup 07's five cards written as config schemas — Anthropic's
> masked key row, the vLLM card's address field *plus* optional key, Ollama's host field and
> no key at all — and all five render through the one `toFormFields`. The proof that no
> branch is hiding in it is `provider.forms.spec.ts` reading the renderer's own source with
> its comments stripped and failing if any of V015's six kinds appears in the code. The trick
> that makes it work is one reserved name: the field carrying an address is always `baseUrl`,
> and *Host* versus *Base URL* is its `title`. If each adapter had named the field after its
> own vendor's word, a card looking for the address would have to know which vendor it was
> drawing.
>
> **The config dialect is deliberately narrow** — one flat object of string fields,
> `additionalProperties: false`, no `$ref`, no composition. A renderer that handles
> composition keywords has the same special cases, moved from *per provider* to *per keyword*,
> and the second list has no end. The gate is `configSchemaViolations`, the kit also compiles
> each schema with Ajv and validates the adapter's own sample config through it, and
> `partitionSubmission` is the one place a submitted form is split — because a consumer that
> gets that split wrong writes a plaintext credential into a column V015's CHECK does not
> guard.
>
> **The conformance kit is green for the fake, and it has been watched failing.** Every check
> is a function returning sentences with an `it` wrapped round it, so
> `conformance.fixture.spec.ts` can run each one against an adapter that is wrong on purpose:
> a schema the caller can mutate back in, capabilities that change between calls, a detail
> that quotes the credential, a fabricated latency, a duplicate model id, a pull stream that
> just stops. A conformance kit nobody has watched fail is a conformance kit that passes
> everything. Every adapter must record a fixture for **all five** error classes — there is no
> *"this cannot happen for my provider"* escape hatch, because all five are arrangeable for
> anything that talks HTTP and an author who cannot produce one has not decided what their
> adapter does about it.
>
> **The lint boundary fails the build, spot-verified by adding one.** Three rules in
> `.dependency-cruiser.cjs`, run by `yarn lint`: a provider SDK imported outside `adapters/`,
> a core service importing an adapter directly, and any cycle. `boundary.spec.ts` builds a
> tree containing exactly each violation, cruises it with the *real* configuration, and
> asserts the named rule fires and the process exits non-zero — a rule whose regular
> expression has quietly stopped matching looks identical to a codebase with no violations.
> Tests are exempt from the second rule, because the in-memory fake exists to power them.
>
> **`REGISTERED_ADAPTERS` ships empty, which is accurate rather than a stub** — AD.1's
> `VAULT_SECRET_STORES` did the same and grew the same way. Until AC.2–AC.5 each add their
> line, every kind is a `501 provider_kind_unsupported`, which is exactly what this build can
> honestly say about `anthropic`: V015 accepts the row, and nothing here knows how to reach
> it yet.
>
> Deliberately **not** here: any real adapter (AC.2–AC.5), any route or controller — AD.2
> (#223) owns add/reveal/rotate, AE.4 (#230) owns test and discovery, AE.5 (#231) owns the
> add-form — and any import of `DbModule` or `VaultModule`, because an adapter is handed an
> already-opened connection context by its caller and a plaintext's lifetime stays in that
> caller's request scope.


- **Problem Statement:** Five provider kinds ship in MVP and the add-card
  promises more (OpenAI, Google, Bedrock, any OpenAI-compatible endpoint); a
  hard-coded provider switch would calcify immediately (decision P1).
- **Solution/Scope:** Define the SPI (TypeScript interface + docs):
  `kind`, `configSchema()` (JSON Schema driving AE.5's forms — base URL? key?
  host? region?), `capabilities()` (`discovery`, `pull`, `entitlements`,
  `invocation` — reserved for AF.2), `validate(config, secret)` (live check →
  status + latency + detail), `discoverModels(conn)` → normalized model list
  (id, display, context, size where known), `pullModel?(conn, id)` (Ollama-class),
  error taxonomy (auth/network/upstream/rate → provider-neutral codes feeding
  status pills and Z.3 health). Registry by `kind` with DI tokens;
  dependency-cruiser rule: core services import the SPI only. Conformance kit
  (mirroring Q.5): recorded-fixture suites every adapter must pass + an
  in-memory fake adapter powering core tests. `docs/MODEL_PROVIDERS.md` with a
  "write an adapter" walkthrough.
- **Acceptance Criteria:**
  - Kit green for the fake adapter; lint boundary fails on a direct provider
    import outside adapters.
  - Config schemas render AE.5's forms with zero UI special-casing (fixture
    proof).
  - Error taxonomy mapped to the card status pills 1:1.
- **Parallelism/Dependencies:** Needs Y.1. Blocks AC.2–AC.6, AD.2, AF.
- **Technical Stack:** NestJS DI, JSON Schema, dependency-cruiser.
- **Epic:** AC

```
interface ModelProviderAdapter {
  kind · configSchema() · capabilities() · validate() → {status, latencyMs, detail}
  discoverModels() → NormalizedModel[] · pullModel?() · (invoke? — reserved AF.2)
}
core ──imports──▶ SPI only   adapters/{anthropic,openai_compat,ollama,copilot,cursor}
```

### Issue AC.2 — ouroboros-rest: [AC.2] Anthropic adapter

> **GitHub issue:** #217 · **Status:** 🟢 Done · **Parent epic:** #212

> **Shipped 2026-08-23.**
> [`ouroboros-rest/src/modules/providers/adapters/anthropic.adapter.ts`](../ouroboros-rest/src/modules/providers/adapters/anthropic.adapter.ts),
> its recorded fixtures beside it, and the walkthrough at
> [`docs/MODEL_PROVIDERS.md`](MODEL_PROVIDERS.md).
>
> **The `priority tier` pill is the one genuinely tricky element, and decision P8 settles
> it.** Anthropic exposes the entitlement as *response headers* — an organization with
> priority-tier capacity is told its allowances under `anthropic-priority-…-limit`, and one
> without is told nothing — so the adapter reads them from the listing it already had to
> make, reports `priority` when an allowance is a positive number, and reports `null`
> otherwise. There is no fallback, no default and no inference from the models a key can see.
> The signal reaches the card as `NormalizedModel.tier` → `provider_models.meta.tier`, which
> is the key `R__dev_seed_providers.sql` already writes on the four Anthropic rows, so the
> seeded stack and a real discovery produce one catalog rather than two that look alike. Both
> branches are recorded: a listing with the headers and a listing with only the standard
> `anthropic-ratelimit-…` family, which is the near-miss a careless prefix match would report
> as an entitlement.
>
> **`entitlements` stays `false`, and the pill is not a counter-example.** That flag is a
> promise about `validate`'s `detail` — the Copilot card's *org-billed · 4 seats* — and AC.1
> names AC.5 (#220) as the adapter that sets it. This card's capability line is prose an
> operator wrote (`capability_note`); its entitlement travels the other road entirely, per
> model, through discovery. Setting the flag would put an entitlement on the card foot where
> the mockup prints `✓ 200 · 38ms`.
>
> **The card has no Base URL field**, because the endpoint is fixed and the capability line is
> where `api.anthropic.com` is shown. `card.shapes.fixture.ts` recorded that shape before the
> adapter existed and the suite asserts the two still agree — which is what gives that fixture
> a job after AC.1 rather than leaving it as a copy of something that has moved on.
>
> **Being the first real adapter surfaced one hole in the kit.** A schema whose credential is
> *required* could not pass it: the kit validated the stored configuration against the form's
> own schema, and the value that schema demands is by design in the vault rather than in
> `provider_connections.config`. `storedConfigSchema()` is the projection that fixes it — the
> schema minus the credential — and the submission is still validated against the schema
> itself, so the key row's own `minLength` is exercised rather than dropped.
>
> **It logs nothing at all.** There is no logger in the file, which is the only version of
> *never logged* that survives somebody adding a debug line in a hurry, and the suite reads
> the source to keep it that way. Every refusal's body is cancelled unread, so a vendor error
> object — which quotes request headers — never reaches a `detail`.
>
> **What this ticket could not finish, and why.** The acceptance criterion *"discovery upserts
> the four models into `provider_models`"* has two halves, and only one of them is an
> adapter's. This module holds no database — that is the design AC.1 argues for, and
> `providers.module.ts` imports neither `DbModule` nor `VaultModule` — so the `insert … on
> conflict` V017 writes is AE.4's (#230), which owns the test-and-discovery routes. What the
> adapter owes that upsert is delivered and asserted: ids are the provider's own spellings,
> unchanged, unique within an answer and identical across repeated runs, which is exactly what
> makes `(provider_connection_id, model_id)` an upsert rather than a doubled row of chips.

- **Problem Statement:** The primary coding lane: key-authed, discoverable,
  testable — the first real conforming adapter.
- **Solution/Scope:** `validate`: models-list call with the sealed key (via
  AD.1), returning status + latency (the `✓ 200 · 38ms` note); `discoverModels`:
  `/v1/models` normalized (the four seeded `claude-*` chips); priority-tier
  detection from response headers/entitlement where exposed (the `priority
  tier` pill; omitted when unknown — P8); error mapping (401 → auth-error pill,
  429 → rate-limited, 5xx → upstream). Recorded fixtures for the kit.
- **Acceptance Criteria:** Kit green; discovery upserts the four models into
  `provider_models`; invalid key → designed auth-error state, never a stack
  trace; tier pill only on real signal.
- **Parallelism/Dependencies:** Needs AC.1, AD.1. Parallel with AC.3–AC.5.
- **Technical Stack:** Anthropic API, undici.
- **Epic:** AC

```
validate(key) ─▶ GET /v1/models ─▶ {200, 38ms} ─▶ "✓ 200 · 38ms" · discover ─▶ 4 chips
```

### Issue AC.3 — ouroboros-rest: [AC.3] OpenAI-compatible adapter (vLLM et al.)

> **GitHub issue:** #218 · **Status:** 🟢 Done · **Parent epic:** #212

> **Shipped 2026-08-23.**
> [`ouroboros-rest/src/modules/providers/adapters/openai-compatible.adapter.ts`](../ouroboros-rest/src/modules/providers/adapters/openai-compatible.adapter.ts),
> the SSRF policy at
> [`provider.address.ts`](../ouroboros-rest/src/modules/providers/provider.address.ts), and
> the walkthrough's new section in [`docs/MODEL_PROVIDERS.md`](MODEL_PROVIDERS.md).
>
> **The SSRF policy is a module rather than a paragraph, because AC.4 shares it.** Every other
> adapter talks to a fixed host; this one accepts an address somebody typed and then fetches it
> from inside the control plane. `provider.address.ts` is the one door — a scheme allow-list, a
> `redirect: "manual"` on every request, a one-mebibyte response cap counted as the bytes
> arrive, and a refusal of any address carrying userinfo, because `http://key:secret@host/v1`
> would write a credential into the one column V015 designed to be readable.
>
> **And private ranges are deliberately allowed**, which is the decision the whole module
> exists to state. These adapters exist to reach `10.0.4.20:8000`; one that rejected RFC-1918
> could not do the only job it has. There is no branch anywhere that inspects an address range,
> and `provider.address.spec.ts` asserts the allow explicitly — so the way it breaks, somebody
> adding a reflexive check months from now and every self-hosted card going dark, is a red test
> rather than a support ticket. [`SECURITY_MODEL.md` §6.1](SECURITY_MODEL.md#61-ssrf-private-ranges-are-deliberately-allowed)
> is the same decision for a reader auditing rather than editing, and it now says **Shipped**.
>
> `manual` rather than `error` for the redirect is the one subtle choice: Node's `fetch` hands
> a `3xx` back intact, so it arrives as an ordinary refusal that `classifyHttpStatus` already
> reads as `config` — an address one level above the API. With `error` it would arrive as a
> `TypeError` indistinguishable from a closed socket, and a redirect would render *unreachable*.
> The `Location` is never printed, because that would report where an endpoint tried to steer
> this service.
>
> **Both spellings of the base URL work.** The ticket writes the call as `{base}/v1/models` and
> mockup 07's field holds `http://10.0.4.20:8000/v1` — an OpenAI-style root, which by that
> ecosystem's convention already ends in `/v1`. Appending unconditionally would have made the
> card's own placeholder request `/v1/v1/models`, so the segment is appended only when it is not
> already there, and the two conformance runs use one spelling each.
>
> **The kit runs twice, which is the acceptance criterion.** A kit green against one vendor's
> capture proves the claim about one vendor, and this adapter's claim is *"any OpenAI-compatible
> endpoint"*. The vLLM capture is rich — `max_model_len`, a `root` naming the checkpoint — and
> the generic one is bare, so its expected models carry `contextLength: null`, which is the
> assertion that the adapter does not invent one. The recorded `401` really contains the
> credential, the way these servers really answer, so *the detail never quotes the provider's
> body* is asserted against a body that would genuinely leak.
>
> **The chips carry `local/` and the ids do not.** The prefix is a display decision:
> `model_aliases.model` and `model_prices.match_model` are written against the server's own
> spelling, so an adapter that prefixed the id would break the join that makes a chip's price
> real. And there is no tier on anything — the OpenAI wire format carries no entitlement signal,
> and decision **P8** is that a plausible-looking default would make Anthropic's earned pill
> unreadable too.
>
> **The capability note is the second reserved field name.** `capabilityNote` →
> `provider_connections.capability_note` (V017), bounded at that column's 160 characters, for
> `baseUrl`'s reason: the card's second line is a whole-connection fact, and a consumer should
> not have to learn each adapter's word for it.
>
> **What this ticket could not finish, and why.** As with AC.2, the acceptance criterion about
> upserting into `provider_models` has two halves and only one is an adapter's — this module
> holds no database, which is the design AC.1 argues for. The `insert … on conflict` is AE.4's
> (#230). What the adapter owes it is delivered and asserted: ids are the server's own
> spellings, unique within an answer and identical across repeated runs.

- **Problem Statement:** The self-hosted lane (vLLM, and by extension LM
  Studio, llama.cpp servers, TGI): base-URL-configured, key-optional — the
  adapter that makes "any OpenAI-compatible endpoint" true.
- **Solution/Scope:** Config schema: `base_url` (validated http(s), private
  ranges allowed — SSRF policy: explicit allow of RFC-1918 for this adapter
  kind with documented reasoning, deny-by-default redirects), optional
  `api_key`; `validate`: `GET {base}/v1/models`; `discoverModels`: same call
  normalized with `local/` display prefix (the mockup's
  `local/llama-4-maverick` chips); capability line free-text (`self-hosted ·
  A100 ×2`) stored as connection metadata.
- **Acceptance Criteria:** Kit green against a vLLM fixture and a generic
  OpenAI-compatible fixture; unreachable base URL → designed network-error
  state; SSRF policy tested (no redirect following, scheme allow-list).
- **Parallelism/Dependencies:** Needs AC.1, AD.1. Parallel with siblings.
- **Technical Stack:** OpenAI-compatible REST, undici.
- **Epic:** AC

```
{base_url: http://10.0.4.20:8000/v1, key?} ─▶ /v1/models ─▶ local/llama-4-maverick · local/deepseek-v3.2
```

### Issue AC.4 — ouroboros-rest: [AC.4] Ollama adapter with model pulls

> **GitHub issue:** #219 · **Status:** 🟢 Done · **Parent epic:** #212

> **Shipped 2026-08-23.**
> [`ouroboros-rest/src/modules/providers/adapters/ollama.adapter.ts`](../ouroboros-rest/src/modules/providers/adapters/ollama.adapter.ts),
> the server-side tracker at
> [`provider.pulls.ts`](../ouroboros-rest/src/modules/providers/provider.pulls.ts), an
> `--profile ollama` container in [`docker-compose.yml`](../docker-compose.yml), and a new
> section in [`docs/MODEL_PROVIDERS.md`](MODEL_PROVIDERS.md).
>
> **The adapter declares no credential field at all** — not an optional one, which is a shape
> none of the other four have. A local daemon authenticates nobody, so a blank row somebody has
> to leave blank is a question the product should not be asking, and `secretFieldName()` answers
> `null`. The conformance kit checks the agreement in both directions: a harness with a
> credential against a schema with no secret row fails, and so does the reverse.
>
> **It shares AC.3's address policy verbatim rather than restating it.** `provider.address.ts`
> is the one door — scheme allow-list, `redirect: "manual"`, a response cap, no userinfo — and
> `http://localhost:11434` passing it is the deliberate allow, not an oversight. `401` and `429`
> are still classified and still recorded as fixtures, because putting a daemon behind a reverse
> proxy with basic auth is the ordinary way an operator exposes one and that proxy is what
> answers them. The kit has no *"this class cannot happen for my provider"* escape hatch, and
> this is the ticket where that rule earned its keep.
>
> **A pull is bounded by silence, not by elapsed time.** Every other call in the module carries
> a ten-second deadline, which is right for a question somebody is watching a spinner for and
> catastrophic for a transfer that is *supposed* to take twenty minutes: `llama4:scout` is 63 GB.
> So each read of the NDJSON stream gets its own deadline, and the abort lives in a `finally` —
> a consumer that stops iterating closes the socket rather than leaving the transfer running
> with nobody reading it.
>
> **Progress is tracked by the process, and that is the whole of the third criterion.**
> `ModelPullTracker` consumes the stream server-side, writes it to a record, and answers *where
> did it get to* to the next request — so a page reload, a browser restart or a second person
> looking all see the same 61%, because none of them is where the progress lives. One active
> pull per connection; a second request is **queued** and the daemon has not been asked for it
> yet, which is the assertion that matters. Ordering, cancellation and disk awareness stay
> AF.5's (#238).
>
> It takes a thunk — `() => registry.pullCapable(kind).pullModel(connection, modelId)` — rather
> than an adapter and a connection, so **no credential reaches a component that lives for
> minutes**. Ollama has none to hold today, which is exactly why the constraint was cheap to
> adopt now and would be expensive to retrofit.
>
> **Sizes are the one field no cloud adapter can fill in.** `/api/tags` publishes an on-disk
> size and it reaches `NormalizedModel.sizeBytes` unchanged, with a floor of one byte because
> V017's `provider_models_size_bytes_positive` refuses a zero. `19 GB` is a rendering decision
> and it belongs to AE.4. There is no context length and no tier: `/api/tags` publishes neither,
> and decision **P8** says report what was said or say nothing.
>
> **The `2.1M tokens on-box` line was verified rather than implemented.** It comes from
> `token_usage` (#66) and the adapter synthesizes nothing — there is no usage in an Ollama
> response to read, and inventing one would break the same honesty rule that keeps the meter
> from showing a fabricated `$0.00`.
>
> **What this ticket could not finish, and why.** The status endpoint AE.4 polls is a handler
> over `ModelPullTracker.find` and `list`, and it needs a connection resolved from
> `/api/v1/providers` — a surface AD.2 (#223) owns and had not shipped at the time. Writing a
> slice of it here would have been something that ticket then had to negotiate with rather than
> write, which is the same reason `providers/` still declares no controller. AD.2 has since
> landed that surface; the status endpoint remains AE.4's. The tracker is the half that had to
> exist first, and it is complete and asserted.
>
> The *pull of a small model against the compose Ollama* criterion is a manual check: the
> container is in `docker-compose.yml` under `--profile ollama`, and no CI job can pull a model.
> Everything about the stream — chunk boundaries mid-object, a multi-byte character split across
> two reads, a resumed transfer starting at 61%, a failure announced mid-stream, a daemon that
> goes quiet — is covered by recorded fixtures that open no socket.


- **Problem Statement:** The zero-cost lane is also the most interactive card:
  detected models with sizes and a real **Pull latest** action.
- **Solution/Scope:** Config schema: `host` (same SSRF policy as AC.3);
  `validate`: `/api/version` ping (the `✓ 200 · 4ms` note); `discoverModels`:
  `/api/tags` with size normalization (`19 GB` tags); `pullModel`: `/api/pull`
  with **streamed progress** surfaced through a pull-status endpoint
  (AE.4 renders it; long pulls survive page reloads via server-side tracking);
  concurrent-pull limit (one per connection, queued — full queue mgmt is
  AF.5); on-box token counting noted from usage rows (the `2.1M tokens
  on-box` line comes from `token_usage`, not the adapter).
- **Acceptance Criteria:** Kit green (fixtures incl. streamed pull chunks);
  pull of a small model against a real Ollama in compose completes with
  progress states; second pull while one runs → queued state; sizes match
  `/api/tags` truth.
- **Parallelism/Dependencies:** Needs AC.1 (no secret required — host only).
  Parallel with siblings.
- **Technical Stack:** Ollama REST API, streamed responses.
- **Epic:** AC

```
/api/tags ─▶ [qwen3-coder:32b · 19 GB]…   Pull latest ─▶ /api/pull (stream) ─▶ progress → done
```

### Issue AC.5 — ouroboros-rest: [AC.5] Copilot & Cursor adapters

> **GitHub issue:** #220 · **Status:** 🟢 Done · **Parent epic:** #212

> **Shipped 2026-08-23.**
> [`ouroboros-rest/src/modules/providers/adapters/copilot.adapter.ts`](../ouroboros-rest/src/modules/providers/adapters/copilot.adapter.ts),
> [`cursor.adapter.ts`](../ouroboros-rest/src/modules/providers/adapters/cursor.adapter.ts),
> the entitlement vocabulary at
> [`provider.entitlements.ts`](../ouroboros-rest/src/modules/providers/provider.entitlements.ts),
> and two new sections in [`docs/MODEL_PROVIDERS.md`](MODEL_PROVIDERS.md).
> `REGISTERED_ADAPTERS` now holds five, so every kind mockup 07 draws resolves and only
> `custom` is a `501`.
>
> **A fixed catalog is a real answer rather than a stub, and the point is that
> `provider_models` cannot tell.** Neither provider publishes a models list worth discovering
> against, so both catalogs are declared in the adapter with a source for every field — and
> they are the same `model_id`, `display` and `meta.context_tokens` that
> `R__dev_seed_providers.sql` writes for the seeded connections, so a seeded stack and a real
> one produce one catalog rather than two that look alike. `capabilities().discovery` is
> `false` because *refreshing* means nothing over a constant, not because the member is
> missing; AE.4 (#230) hides the affordance on that flag. What the adapters owe the upsert is
> delivered and asserted: the providers' own ids, unique within an answer and identical across
> repeated runs.
>
> **Seats are the interesting half, and decision P8 is one function.** The count is read from
> GitHub's `seat_breakdown.total` and travels in `validate`'s `detail`, which is what
> `ProviderCapabilities.entitlements` promises and the only channel AC.1's SPI has for one. The
> spelling therefore had to live somewhere a card can reach: `provider.entitlements.ts` holds
> the writer and the reader together, because AE.6 (#232) cannot import an adapter —
> `core-imports-the-spi-only` fails the build for exactly that — and the alternative is a
> regular expression over prose invented at the reading end. `null` appends nothing at all,
> and `null` and `0` are deliberately different answers: an org can genuinely have zero seats,
> and the conformance kit runs three times so the org that reports none is not an untested
> path.
>
> **The entitlement lookup cannot fail a validation**, which is the subtlety that would have
> been easy to get wrong. It is a second request made only after the token was accepted, and a
> `403` (no `manage_billing:copilot`), a `404` (an org the token cannot see) and a `500` all
> mean *no seat count* rather than *bad credential*. Reporting a good token as broken because
> a supplementary endpoint was unavailable would be the adapter's curiosity rendered as an
> operator's outage.
>
> **The degraded state is earned by a response and drawn by the taxonomy.** `△ 503 upstream ·
> retrying` is now composed by `validationNote()` beside `validationPill()` in the SPI — the
> detail is the adapter's, the `· retrying` is `PROVIDER_ERROR_RETRYABLE`'s, and the glyph and
> the latency stay the card's. Nothing on the path from the recorded `503` to that sentence
> names Copilot, which is the acceptance criterion's *through the taxonomy rather than by
> special-casing* made mechanical. A **latency outlier** takes the same road, and *outlier*
> means past a stated threshold rather than unusual for this connection: a rolling baseline
> would be state, and one instance of the adapter serves every workspace.
>
> **The retry is bounded twice, and the two bounds interact on purpose.** At most two
> attempts, *and* the whole call must fit a fifteen-second budget with the next attempt
> charged at its full deadline. So a failure that came back fast leaves room for a second —
> the transient `503` a load balancer answers while a node rotates, which is the case a retry
> can convert — and one that came back slowly has already spent the budget. Unbounded retry
> against a struggling upstream is how a status indicator becomes a denial-of-service
> contribution, and both bounds have their own tests.
>
> **The organization is a new field, because a seat count needs one.** It is optional — the
> seat suffix is what is lost by leaving it blank, never the connection — and it is
> interpolated into a URL path, so the strict GitHub-login pattern is re-checked server-side
> rather than trusted from the schema. The form's pattern admits a blank as well, because an
> untouched optional row submits an empty string and a form that failed on it would be failing
> on a field nobody filled in.
>
> **Cursor is the plainest adapter in the module and that is why it is in this ticket.** One
> credential, one status check, one chip. Everything the other four have that it does not — an
> address policy, a pull stream, an entitlement lookup, a retry — is a *provider's* complexity
> rather than the framework's, and a fifth adapter needing none of it is the evidence for
> AC.1's claim. Its key goes out as HTTP Basic with an empty password, which is what Cursor's
> Admin API documents.
>
> **The `ghu_…` placeholder in `card.shapes.fixture.ts` was corrected rather than diverged
> from.** The mockup's own row holds `ghu_••••••••••••7Kd2` — a GitHub App user-to-server
> token — and the fixture said `ghp_`. A fixture that claims to be the page's shapes has to be
> them.
>
> **What this ticket could not finish, and why.** As with AC.2–AC.4, the acceptance criterion
> about `provider_models` has two halves and only one is an adapter's: this module holds no
> database, which is the design AC.1 argues for, so the `insert … on conflict` is AE.4's
> (#230). The seat count reaching mockup 07's cap line is AE.6's (#232) — what this ticket
> owed it is `seatsIn(detail)`, which is delivered, exported and round-trip tested.

- **Problem Statement:** The org-billed (Copilot) and key-authed (Cursor)
  lanes: fixed model catalogs, entitlement-aware, degraded-state honest.
- **Solution/Scope:** Copilot: GitHub token auth (`ghu_…`), entitlement check
  (seat count for the `· 4 seats` cap note — omitted when the API doesn't
  expose it, P8), fixed catalog (`copilot/gpt-5-codex`), upstream-degraded
  detection (5xx/latency from validate → the warn pill + `△ 503 upstream ·
  retrying` note with bounded auto-retry); Cursor: API key validate, fixed
  catalog (`cursor/composer-2`). Both: recorded fixtures for the kit;
  capability lines (`billed through GitHub org acme-robotics`) as metadata.
- **Acceptance Criteria:** Kit green; Copilot degraded fixture drives the warn
  pill end to end; seats rendered only from real entitlement data; fixed
  catalogs land in `provider_models` like discovered ones.
- **Parallelism/Dependencies:** Needs AC.1, AD.1. Parallel with siblings.
- **Technical Stack:** GitHub/Cursor APIs, undici.
- **Epic:** AC

```
copilot: token → entitlement {seats: 4} · validate 503 ─▶ (degraded upstream) + "△ 503 · retrying"
cursor:  key → ok · catalog [cursor/composer-2]
```

### Issue AC.6 — ouroboros-db: [AC.6] Schema extensions, discovered-models catalog & seeds

> **GitHub issue:** #221 · **Status:** 🟢 Done · **Parent epic:** #212


- **Problem Statement:** Y.1's foundation lacks what the cards show: caps, meta
  (added-by, last-used), capability lines — and discovery needs a catalog
  table the registry (21) will consume (decision P6).
- **Solution/Scope:** Migration extending Y.1: `provider_connections` +=
  `monthly_cap_cents` (nullable), `added_by` → `"user".id`, `last_used_at`
  (maintained by invocation later; seeded now), `capability_note`,
  `enabled` bool (the card switch — distinct from health `status`);
  `provider_models` — id, `provider_connection_id` FK, `model_id`, `display`,
  `size_bytes` (nullable), `meta` jsonb (context length, tier), `discovered_at`,
  unique (connection, model_id); alias validation hook: Y.1 aliases FK-check
  against `provider_models` (soft in MVP — warn on unknown, enforce once
  discovery is universal). Seeds: the five mockup connections with masked-real
  secrets (dev values), caps ($600/$120/$95/—/—), meta rows, discovered models
  incl. Ollama sizes, spend rows shaped for the calendar-month meters
  ($412.80/$64.10/$76.00/$0/$0 — coordinated with Y.4/DASH seeds); ci/db
  constraint probes (cap non-negative, unique models, enabled/status vocab).
- **Acceptance Criteria:** Cards render entirely from seeds; alias-to-unknown-
  model warning fires on a fixture; constraints red/green verified; personal
  org empty (guidance fixture).
- **Parallelism/Dependencies:** Needs Y.1 (+Y.4/DASH-F.5 coordination). Feeds
  everything.
- **Technical Stack:** PostgreSQL 17, Flyway.
- **Epic:** AC

```mermaid
erDiagram
    provider_connections ||--o{ provider_models : "discovers"
    provider_connections {
        int monthly_cap_cents "null = uncapped (—)"
        text added_by FK
        timestamptz last_used_at
        text capability_note "primary coding lane…"
        bool enabled "card switch"
    }
    provider_models {
        uuid id PK
        uuid provider_connection_id FK
        text model_id "UK per connection"
        text display "local/llama-4-maverick"
        bigint size_bytes "ollama sizes"
        jsonb meta "tier, context"
    }
```

---

## Epic AD (#213) — Vault, Secrets & Audit (`ouroboros-rest` + `ouroboros-db` + docs)

| Ref | GitHub | Status | Title | Summary | Labels | Parallel | MVP | Complexity | Affected Modules |
|-----|:------:|:------:|-------|---------|--------|:--------:|:---:|:----------:|------------------|
| AD.1 | #222 | 🟢 Done | ouroboros-rest: [AD.1] Envelope-encryption service (tenant DEKs + KeyWrapper) | AES-256-GCM DEK per tenant, pluggable KEK, migration of existing secrets | mvp, providers, rest, db | N (after #28) | Y | L | ouroboros-rest, ouroboros-db |
| AD.2 | #223 | 🟢 Done | ouroboros-rest: [AD.2] Credential lifecycle API | Add/reveal/rotate/enable/delete with re-auth, verify-then-retire | mvp, providers, rest | N (after AD.1, AC.1) | Y | M | ouroboros-rest |
| AD.3 | #224 | 🟢 Done | ouroboros-rest: [AD.3] Worker credential delivery (proxied + scoped lease spec) | P3: proxy contract for AF.2; lease API for local providers | mvp, providers, rest | N (after AD.1) | Y | M | ouroboros-rest, ouroboros-engine |
| AD.4 | #225 | 🟡 Open | ouroboros-rest: [AD.4] Credential audit trail & Audit log surface | Every operation audited (#26-shaped); head-button trail view | mvp, providers, rest, ui | N (after AD.2) | Y | M | ouroboros-rest, ouroboros-ui |
| AD.5 | #226 | 🟢 Done | ouroboros: [AD.5] Security model documentation | `docs/SECURITY_MODEL.md`: crypto, custody, honest claims; strip copy | mvp, providers, documentation | N (after AD.1–AD.3) | Y | S | docs |

### Issue AD.1 — ouroboros-rest: [AD.1] Envelope-encryption service (tenant DEKs + KeyWrapper)

> **GitHub issue:** #222 · **Status:** 🟢 Done · **Parent epic:** #213

> **Shipped 2026-08-14.** `V013__tenant_keys.sql` and
> [`ouroboros-rest/src/modules/vault/`](../ouroboros-rest/src/modules/vault) — the cipher, the
> `KeyWrapper` seam, the env-master implementation, the statements against `tenant_keys`, and
> the rotation job. See [The vault](../ouroboros-rest/README.md#the-vault).
>
> **The three properties, and where each one actually comes from.** *A ciphertext cannot be
> moved*: the AAD binds the workspace id and the record id, **length-prefixed**, so no pair of
> identifiers can forge another pair's binding — the obvious `a:b` join makes `("acme:1","2")`
> and `("acme","1:2")` identical bytes, which would satisfy the swap-prevention criterion on
> paper and not in fact. *Deleting a workspace destroys its secrets*: `tenant_keys` cascades
> from `organization`, and the service holds **no key cache**, which is the condition that
> guarantee depends on rather than an omission. *Custody upgrades without a data migration*:
> `VaultService.rewrap` rewrites `sealed_dek` and `wrapper` and nothing else, asserted
> **byte-for-byte** against ciphertext that went through PostgreSQL — a round-trip assertion
> would also pass if everything had quietly been re-encrypted.
>
> **Rotation is additive.** A new version becomes active, the old one stays readable, and every
> envelope names the version that sealed it — so re-encryption can take as long as it takes.
> One active version per workspace is a **partial unique index**, not a service check: two
> active rows would split a workspace's ciphertext across two keys with nothing recording
> which, and two concurrent rotations meet at that index instead. The loser is told it lost.
>
> **The migration job ships as a seam with no stores registered, and that is the honest
> statement.** Q.1 (#138), K.3 (#101) and Y.1 (#189) are all still open and no migration
> declares an encrypted column, so there is nothing in any database to convert. A
> `VaultSecretStore` registration is what each of them adds, and one code path serves both
> jobs: a record already sealed on an older version is re-sealed, and a record this service
> has never sealed is **adopted**. `vault.module.spec.ts` asserts the registry is empty, so the
> claim fails the day it stops being true rather than going stale quietly.
>
> **There is no scheduler**, and none was added: `rotate` returns as soon as the new version is
> active and starts the sweep detached; `sweep` is public and awaitable for a caller that wants
> to know when it finished. AD.2 (#223) is the endpoint over it.
>
> **No route.** `VaultModule` declares no controller — a route that decrypted a credential
> would be a route that returned one, and that is AD.2's decision behind a re-authentication
> step. `OURO_VAULT_MASTER_KEY` is validated at boot to **exactly** 32 bytes rather than a
> minimum, because a signing key that is wrong is fixed by correcting it and a KEK that is
> wrong produces ciphertext nobody can ever open. "Never logged" is held by a lint rule
> (`no-secret-logging.mjs`, tested through ESLint's `RuleTester`) plus a redaction suite that
> captures every sink across every failure path — not by reviewer vigilance.

- **Problem Statement:** Three roadmaps now store encrypted credentials
  (BA helper, Q.1 sources, Y.1 providers) with a shared ad-hoc AES-GCM helper;
  the mockup promises real envelope encryption with per-tenant sealing
  (decision P2) — one service must own it.
- **Solution/Scope:** `VaultService` (option 1-A): per-tenant DEK (AES-256-GCM,
  96-bit nonces, AAD = tenant + record id — swap-prevention), DEKs stored
  sealed by the `KeyWrapper` interface (`wrap/unwrap/rewrap`); default wrapper:
  master key from `OURO_VAULT_MASTER_KEY` (32-byte, boot-validated);
  `tenant_keys` table (org FK, sealed DEK, version, rotated_at); DEK rotation
  (new version, lazy re-encrypt on write, background sweep) and KEK re-wrap
  (AF.3 path) supported from day one; migration: existing Q.1/K.3/Y.1
  ciphertexts re-sealed through the service (one-time job); decrypted material
  lives only in request scope, zeroized best-effort, never logged (lint +
  redaction tests).
- **Acceptance Criteria:**
  - Round-trip + tamper tests (bit-flip → auth failure); AAD binding verified
    (cross-tenant ciphertext swap fails).
  - DEK rotation leaves old data readable, new writes on the new version;
    re-wrap changes no data ciphertexts.
  - Migration job converts existing dev-seed secrets; boot fails cleanly on a
    bad master key.
- **Parallelism/Dependencies:** Needs #28. Blocks AC.2/3/5, AD.2, AD.3;
  supersedes the BA/Q ad-hoc helper (amendment).
- **Technical Stack:** Node crypto (AES-256-GCM), Flyway, NestJS.
- **Epic:** AD

```mermaid
flowchart LR
    SECRET["provider secret"] --enc AES-256-GCM--> CT["ciphertext + nonce + AAD(tenant,record)"]
    DEK["tenant DEK"] --> SECRET
    KEK["KeyWrapper: env-master (MVP) → KMS | Vault/OpenBao (AF.3)"] --wrap--> SDEK["sealed DEK (tenant_keys)"]
    SDEK -.rewrap only.-> KEK
```

### Issue AD.2 — ouroboros-rest: [AD.2] Credential lifecycle API

> **GitHub issue:** #223 · **Status:** 🟢 Done · **Parent epic:** #213

> **Shipped 2026-08-23.**
> [`ouroboros-rest/src/modules/provider-connections/`](../ouroboros-rest/src/modules/provider-connections)
> — seven operations over four paths, published in
> [`openapi.yaml`](../ouroboros-rest/openapi.yaml) under a new `providers` tag. Decision
> **P4**, one file per rule: `masking.ts`, `step-up.ts`, `reveal.limiter.ts`,
> `config.validation.ts`, `config.mapping.ts` and `connection.audit.ts` beside the usual
> controller/service/repository three.
>
> **The order of operations *is* the ticket, and every acceptance criterion is a claim about
> it.** `add` calls the adapter before it seals and before it inserts, so *a bad key is never
> stored* is a property of the control flow rather than of a rollback — there is no row to
> clean up because there was never a row. `rotate` validates the new credential and only then
> issues one conditional `UPDATE`, so a refusal leaves the old key live and a success has no
> window in which neither works. `reveal` counts the attempt **before** it checks the
> step-up, which is the one ordering here that is a security property rather than a
> preference: a limiter behind the step-up would leave the password comparison unlimited.
>
> **Masking is computed from bytes, not from a string.** `VaultService.decrypt` hands over a
> `Buffer` the caller owns; `masking.ts` decodes only its last sixteen bytes and answers
> `••••Xq4A`, so the plaintext never becomes an immutable string on the list path and the
> visible half is four characters every vendor console already shows. The contract test the
> criteria ask for lives twice — over the built payloads in `payloads.spec.ts` and over the
> bytes that crossed a socket in the integration suite — and it is *demonstrated to be
> capable of failing* by being pointed at the one payload that does carry a credential.
>
> **The step-up is the two capabilities BetterAuth actually gives this build**, which is
> narrower than the ticket's "fresh session / password / provider re-confirm" and is written
> down as such. `session` is a session created inside the window — the only method a
> GitHub-only account has, and the reason `SessionRecord` gained `createdAt` (never
> `updatedAt`, which slides on every renewal). `password` is `auth.api.verifyPassword`, a
> server-scope endpoint that works in production too, because `emailAndPassword.enabled`
> gates the sign-in *routes* and verification reads the credential account directly. A
> provider re-confirm is deliberately absent: it is a redirect, a callback and a new session,
> which is the `session` method with extra steps. **A wrong password answers exactly as an
> absent one does**, or this endpoint would be a password oracle for whoever holds a stolen
> session.
>
> **Two singletons hold state, and what that costs is stated rather than discovered.** The
> reveal limiter and the step-up registry are in-memory, so a second replica has its own
> counters and its own confirmations: a limit of ten becomes twenty across two processes, and
> a person behind a round-robin balancer may be asked to confirm again. The second is a
> re-prompt, which is the safe direction to fail in; the first is bounded and honest, and the
> alternative — Redis, or a table written on every attempt — is not something this ticket
> gets to add to a deployment. `ModelPullTracker` is the precedent.
>
> **The delete guard is Y.1's foreign key, thrown at last.**
> `registry.errors.ts`'s `providerConnectionInUse` was written under #189 *for* this ticket
> and had no caller; both of its directions are now used — the pre-flight that can name the
> aliases, and the recogniser for the race the pre-flight cannot close.
>
> **One gap is refused rather than papered over, and it is worth knowing about.**
> `provider_connections` keeps a connection's settings in *columns* — `base_url` and
> `capability_note`, which is why `provider.config.ts` reserves those two field names — and
> has no general column for anything else. AC.5's Copilot schema declares one field that is
> neither: an optional billing `organization`. Dropping it would store a connection that
> quietly disagrees with what somebody typed, and the disagreement would surface much later
> as an entitlement line reading *personal plan* for an org-billed seat; adding a column is a
> migration, and AD.2's scope is `ouroboros-rest`. So a submitted setting with nowhere to go
> is a designed **`501 provider_config_not_storable`** naming the field — the same shape
> `provider_kind_unsupported` has, and for the same reason. Copilot connects perfectly well
> without one, which its own schema calls the ordinary case. **A `provider_connections.config`
> column is the fix**, and whichever ticket adds it deletes `config.mapping.ts`'s
> `unstorableFields` and that error together.
>
> **Every operation is audited on AD.3's interim seam.** `connection.audit.ts` emits
> `provider.added|revealed|rotated|updated|deleted` — AD.4's (#225) own vocabulary, agreed
> before the trail exists — to the service log, with every field that issue's row will carry;
> a reveal records *how* the step-up was satisfied, which is the difference between somebody
> with this session and somebody who proved they are this person. When #225 lands, five method
> bodies become an insert and no caller, field or event name changes.


- **Problem Statement:** The key row's affordances — masked display, Reveal,
  Rotate — plus add/enable/delete must be safe by construction (decision P4).
- **Solution/Scope:** Under tenant context, owner/admin gated: `POST
  /api/v1/providers` (adapter-schema-validated config + secret; **live
  validate before persist** — a bad key is never stored silently); list/read
  return masked suffix only (`••••Xq4A`, server-computed); `POST
  /:id/reveal` — **step-up re-auth** (fresh session check / password or
  provider re-confirm per BA capabilities), short-lived response, audited;
  `POST /:id/rotate` — accept new secret → adapter validate → swap atomically
  → old retired (verify-then-retire; failed validation leaves the old active);
  `PATCH /:id` (enable/disable switch, cap, capability note); `DELETE` blocked
  while Y.1 aliases reference the connection (409 naming them). Rate limits on
  reveal attempts.
- **Acceptance Criteria:**
  - Full lifecycle in the harness; masked-only in every list payload (contract
    test greps for secret material).
  - Rotate with an invalid new key → old key still live, error designed.
  - Reveal without step-up → 401 challenge; with → audited value; delete-with-
    dependents → 409 listing aliases.
- **Parallelism/Dependencies:** Needs AD.1, AC.1. Feeds AE.2/AE.3.
- **Technical Stack:** NestJS, class-validator, BA step-up.
- **Epic:** AD

```
add ─▶ validate live ─▶ seal ─▶ store        reveal ─▶ step-up ─▶ audited value (TTL display)
rotate ─▶ validate new ─▶ atomic swap ─▶ retire old     delete ─▶ 409 while aliases depend
```

### Issue AD.3 — ouroboros-rest: [AD.3] Worker credential delivery (proxied + scoped lease spec)

> **GitHub issue:** #224 · **Status:** 🟢 Done · **Parent epic:** #213

> **Shipped.** [`src/modules/internal/`](../ouroboros-rest/src/modules/internal) in
> `ouroboros-rest`, [`openapi.internal.yaml`](../ouroboros-rest/openapi.internal.yaml) beside
> it, and
> [`control_plane/`](../ouroboros-engine/src/ouroboros_engine/control_plane) in
> `ouroboros-engine`. Two paths, and the asymmetry between them *is* decision **P3**:
> `POST /internal/llm/invoke` is specified and answers `501` naming AF.2 (#235);
> `POST /internal/credentials/lease` is implemented and returns a **local** provider's base
> URL — TTL'd at fifteen minutes, audited, and behind the #51 shared secret.
>
> **The mockup's own copy was improved on rather than implemented.** The page subline
> promises *"workers only ever see short-lived tokens"*, and no token is minted anywhere in
> this ticket. A fifteen-minute credential is still a credential: it reaches the worker,
> revocation is bounded only by its TTL, and the audit surface widens to every process that
> ever held one — and for most LLM providers it is fiction, because almost none support
> deriving short-lived scoped keys, so such a token would be a full API key with a timer
> bolted on by us. AD.5 (#226) owns the wording; this is the behaviour it will describe.
>
> **No secret can be returned, structurally.** `LeaseResource` has nowhere to put one —
> every field is an identifier, an address or a timestamp — and
> [`no-secret-responses.mjs`](../ouroboros-rest/src/modules/internal/no-secret-responses.mjs)
> is the lint rule that refuses a field named for credential material in anything the
> internal surface returns, in a declared shape or a returned literal. Its word list differs
> from the vault's `no-secret-logging` on exactly two entries and the difference is argued in
> the file: `key` is denied here and not there, and `token` is denied while `tokens` is not —
> in this product the plural is a unit of text (`inputTokens`, `token_usage`) and the singular
> is a credential.
>
> **The policy is enforced twice, and both are needed.** `lease.ts` refuses a cloud kind
> before it consults configuration or the database, so no state can produce a grant; and
> `configuration.ts` refuses to *start* a process whose `OURO_LOCAL_PROVIDER_URLS` names one.
> A policy that lived only in the service could be walked around by an operator, and one that
> lived only in configuration would miss a kind added to that variable by a later ticket. Both
> halves are tested per cloud adapter kind rather than on a representative one.
>
> **`openai_compatible` is leasable, with the caveat V012 already wrote down.** The same
> adapter fronts a vLLM on somebody's own GPU *and* `api.openai.com`, so local-ness is a
> property of the connection rather than of the kind — which is why a lease for it still fails
> unless the deployment declared an address. `OURO_LOCAL_PROVIDER_URLS` is the operator making
> that connection-level statement once at deployment level; Y.1 (#189) replaces it with a row,
> and `LocalProviders` is the seam that changes when it does.
>
> **The scope is a run, and the run is real.** The workspace a grant is attributed to is
> resolved *from* the run rather than named by the caller — a worker naming its own workspace
> would be a worker choosing which one to be audited against — and a run that does not exist
> is a `404`. Every grant writes `credential.lease_granted` carrying the lease, the run, the
> workspace, the provider and the address; the sink is the service log until AD.4 (#225)
> brings `audit_events`, and `LeaseAudit` is where that becomes an insert with no caller
> changing.
>
> **The internal surface is a second OpenAPI document, not a section of the first.** Folding
> it into `openapi.yaml` would publish engine-facing operations into the client `ouroboros-ui`
> generates. `yarn openapi` renders both pairs and `yarn test` holds both to the router in
> both directions — which is what keeps *specified* from quietly meaning *described but
> unreachable*: the proxy answers `501` today, so it is a route, and when AF.2 replaces that
> method body nothing about the path, the guard, the document or the engine's client moves.
>
> **A third category of route now exists, and the guard suites say so.** An internal route
> carries `@AllowAnonymous()` — its caller holds no session and could not be given one — so
> `route.table.fixture.ts` gained an `internal` flag and `INTERNAL_SURFACE` beside
> `SHIPPED_PUBLIC_SURFACE`. Calling those routes *public* would have put them in the list both
> guard suites assert a stranger can reach; they are the opposite, and each suite now asserts
> all three categories in both directions. `InternalKeyGuard` is registered as an `APP_GUARD`
> keyed on `@InternalOnly()` rather than applied per controller, and
> `internal.module.spec.ts` asserts the complement — every route whose *path* is under
> `/internal` carries the decorator.
>
> **The engine's stub opens no socket, and that is a decision.** There is no executor yet, so
> adding an HTTP library to that service's runtime dependencies would be shipping a dependency
> on speculation and choosing sync or async on AF.2's behalf. `ControlPlaneClient` builds a
> complete request — absolute URL, the key, the body in the control plane's `camelCase` — and
> reads what comes back, including the NDJSON stream one event at a time;
> `tests/test_control_plane_contract.py` reads the committed internal document and compares
> the paths, the header, the provider kinds and AB.1's error taxonomy against the mirror.
>
> Also landed: `NotImplementedError` in `error.envelope.ts` — the one 5xx whose message a
> caller is allowed to read, which is what makes a `501` a pointer rather than a dead end —
> and `OURO_LOCAL_PROVIDER_URLS` in the environment registry, refused at boot when it names a
> provider whose credentials never leave the control plane.


- **Problem Statement:** The engine will need provider access (estimator O.2,
  execution WF-T.6); decision P3 says workers get a proxy, not keys — the
  contract must exist before AF.2 builds the executor on it.
- **Solution/Scope:** Contract-first: internal proxied-invocation surface spec
  (`POST /internal/llm/invoke {connection|alias, payload, run_ctx}` — request/
  stream shapes, per-run scoping, error taxonomy hooks for AB.1 semantics;
  implementation lands with AF.2); implemented now: the **scoped lease API**
  for local-provider exceptions (`POST /internal/credentials/lease {provider,
  run}` → local-provider connection details only — base URL/host, never cloud
  keys; TTL'd, audited, shared-secret path per #51); engine client stubs for
  both; lint rule: no other internal path returns secret material.
- **Acceptance Criteria:** Lease returns local connections only (cloud-provider
  lease → 403 by policy, tested); lease events audited; proxy contract
  committed to OpenAPI (internal) and referenced by AF.1/AF.2; engine stub
  compiles against both.
- **Parallelism/Dependencies:** Needs AD.1 (+#51 pattern). Feeds AF.2; spec
  input to AF.1.
- **Technical Stack:** NestJS, FastAPI client stub.
- **Epic:** AD

```
engine ──POST /internal/llm/invoke (contract now, impl AF.2)──▶ REST ─▶ provider  (keys never leave)
engine ──lease {ollama, run}──▶ {host, ttl 15m} ✓ audited      lease {anthropic} ─▶ 403 policy
```

### Issue AD.4 — ouroboros-rest: [AD.4] Credential audit trail & Audit log surface

> **GitHub issue:** #225 · **Status:** 🟡 Open · **Parent epic:** #213


- **Problem Statement:** Reveal/rotate/cap changes without an audit trail
  would fail the page's own security posture (decision P5); the head button
  needs a real destination.
- **Solution/Scope:** Audit events (early-adopting #26's `audit_events` shape;
  filing-time coordination — if #26 is unbuilt this lands its table):
  `provider.added|revealed|rotated|enabled|disabled|cap_changed|deleted|
  tested`, `credential.lease_granted` — actor, connection, IP, detail (never
  secret material); append-only grant posture; `GET /api/v1/providers/audit`
  (filterable, org-scoped); minimal trail UI (sheet from the Audit log
  button: timestamped rows, actor, action — full audit UI remains mockup 17
  territory).
- **Acceptance Criteria:** Every AD.2 operation writes exactly one event
  (harness-verified); events carry no secret material (grep test); trail
  sheet renders seeded history; append-only enforced.
- **Parallelism/Dependencies:** Needs AD.2 (+#26 coordination). Feeds AE.1.
- **Technical Stack:** NestJS interceptor, PostgreSQL.
- **Epic:** AD

```
rotate by Ken ─▶ audit_events {provider.rotated, actor, conn, ip, at}  (no secrets)
[Audit log] ─▶ sheet: "2026-08-08 14:02 · Ken · rotated Anthropic key"
```

### Issue AD.5 — ouroboros: [AD.5] Security model documentation

> **GitHub issue:** #226 · **Status:** 🟢 Done · **Parent epic:** #213

> **Shipped 2026-08-22.** [`docs/SECURITY_MODEL.md`](SECURITY_MODEL.md), linked from the
> README's documentation table. Nine sections, four Mermaid diagrams, and a status mark on
> every one of them — **Shipped**, **Specified** or **Planned** — because a security document
> that described the finished system would be the same class of error as the compliance
> badges it removes.
>
> **The traceability is a list, not an assertion.** §1 puts all ten claims the page makes —
> six in the strip, four in the head subline — in two tables against the section that answers
> each. Four verdicts: *true* (sealing, envelope encryption, "keys never leave the control
> plane"), *qualified* ("KMS-backed" — false of the default deployment, and §3.2 says so in
> the words an operator needs), *corrected* ("15-minute tokens" — AD.3 does something
> stronger), and *withdrawn* (both badges).
>
> **The badge policy is the part that outlives this ticket.** `SOC 2 Type II` and
> `ISO 27001` come out, and §7.3 writes down the five rules that govern any badge added
> later — a completed audit by a named auditor, a **date rendered beside the name** because
> these lapse, removal when it does, never from a configuration flag an operator can set, and
> **an empty slot until then** rather than a "certification in progress" placeholder, which is
> a compliance claim wearing a hedge. What replaces them is what the product has earned:
> *self-hosted — your keys never leave your deployment*.
>
> **§7 is the single source AE.6 (#232) and AE.1 (#227) render verbatim**, and it carries the
> clause-by-clause trace so the review that ticket owes is a check rather than a judgement.
> It also writes the rule for AF.3 (#236): a deployment with a KMS wrapper may append *"This
> deployment's keys are held in &lt;KMS name&gt;"*, rendered from the configured wrapper's
> identity rather than from a setting, and **rendered as nothing at all under the
> environment-master wrapper** — silence is the honest default and a euphemism is not.
>
> **The SSRF section explains a deliberate allow rather than defending an omission.** AC.3 and
> AC.4 take an address from the user and RFC-1918 is permitted, because the rule and the
> feature are the same thing: an adapter that refused private ranges could not reach the vLLM
> or the Ollama it exists to reach. What is enforced instead is enumerated — scheme
> allow-list, no redirect following, kind scoping, role scoping, no response body echoed —
> and so is what remains, which is that an admin can learn whether something answers on their
> own network. That is a capability they already have, and the boundary is *who may configure
> a connection*.
>
> **Two claims are shipped-with-an-interim-sink and neither is rounded up.** Every credential
> operation is audited (§5.1), but AD.4 (#225) has not landed, so `credential.lease_granted`
> goes to the service log rather than to `audit_events` — §5.4 says that in those words,
> because "audited" and "audited into a queryable table" are different claims. And the strip's
> link target is specified here rather than wired, because the strip itself is AE.6's to build
> and AE.6 is blocked on this document.
>
> **Four filed amendments are listed as Planned rather than written up as true** — the
> build-farm CA (#250, including the reverse proxy that silently breaks mTLS by not passing
> the client certificate through), workspace deletion as crypto-shredding (#489), deployment
> truth in Settings (#483), and analyzer tenant locality (#510, which loses its stronger claim
> when the v2 synthesis pass is enabled). §9 is the rule that keeps the document honest as
> they land: **a security claim ships only after it appears here.**

- **Problem Statement:** The strip links "Read the security model ↗" and makes
  compliance-flavored claims (SOC 2, ISO 27001); the document must exist and
  the claims must be honest.
- **Solution/Scope:** `docs/SECURITY_MODEL.md`: envelope-encryption design
  (AD.1 diagrams), custody model per deployment (env-master vs KMS/Vault
  AF.3), worker delivery truth (P3 — proxied; lease scope), audit guarantees,
  threat notes (SSRF policy, reveal step-up, rotation); **strip copy
  corrected to truth**: compliance badges rendered only when certifications
  exist — replaced in MVP with "self-hosted: your keys never leave your
  deployment" framing (product decision recorded); linked from the strip and
  README.
- **Acceptance Criteria:** Doc renders with diagrams; every claim in the UI
  strip traces to a doc section; no unearned compliance badges (honesty
  verified in AE.6 review).
- **Parallelism/Dependencies:** Needs AD.1–AD.3.
- **Technical Stack:** Markdown, Mermaid.
- **Epic:** AD

```
strip claim ──traces to──▶ SECURITY_MODEL.md section   badges: only what is certified (none faked)
```

---

## Epic AE (#214) — Providers UI (`ouroboros-ui`)

Every issue references
[`docs/mockups/07-providers.html`](mockups/07-providers.html) as the design
source — provider-card anatomy, monogram tints, key-row/pull-list/security-strip
treatments — via the #16 tokens (both themes; the mockup is dark-only).

| Ref | GitHub | Status | Title | Summary | Labels | Parallel | MVP | Complexity | Affected Modules |
|-----|:------:|:------:|-------|---------|--------|:--------:|:---:|:----------:|------------------|
| AE.1 | #227 | 🟡 Open | ouroboros-ui: [AE.1] Providers route, subnav & page frame | `/models/providers`, head + Audit log sheet, subnav live | mvp, providers, ui, design | N (after AA.1, AD.4, BA-D.5) | Y | S | ouroboros-ui |
| AE.2 | #228 | 🟡 Open | ouroboros-ui: [AE.2] Provider cards | Card grid: monograms, pills, switches, meta, chips, meters, feet | mvp, providers, ui, design | N (after AE.1, AC.6) | Y | L | ouroboros-ui |
| AE.3 | #229 | 🟡 Open | ouroboros-ui: [AE.3] Key management flows | Masked row, Reveal step-up, Rotate verify-then-retire, delete guard | mvp, providers, ui | N (after AE.2, AD.2) | Y | M | ouroboros-ui |
| AE.4 | #230 | 🟡 Open | ouroboros-ui: [AE.4] Test, discovery & Ollama pulls UX | Live test notes, chip refresh, pull-list with streamed progress | mvp, providers, ui | N (after AE.2, AC.4) | Y | M | ouroboros-ui |
| AE.5 | #231 | 🟡 Open | ouroboros-ui: [AE.5] Add-provider flow & catalog | Dashed card → kind catalog → schema-driven form → validated add | mvp, providers, ui, design | N (after AE.1, AC.1, AD.2) | Y | M | ouroboros-ui |
| AE.6 | #232 | 🟡 Open | ouroboros-ui: [AE.6] Caps, security strip & states | Cap fields + warn meters, truthful strip, empty/read-only/error states | mvp, providers, ui, design | N (after AE.2–AE.5, AD.5) | Y | M | ouroboros-ui |
| AE.7 | #233 | 🟡 Open | ouroboros-ui: [AE.7] Providers e2e leg | Parity, add→test→rotate→audit flow, pull progress, themes | mvp, providers, ui, ci | N (after AE.1–AE.6) | Y | S | ouroboros-ui, .github |

### Issue AE.1 — ouroboros-ui: [AE.1] Providers route, subnav & page frame

> **GitHub issue:** #227 · **Status:** 🟡 Open · **Parent epic:** #214


- **Problem Statement:** The page frame: head with the vault subline (AD.5
  truth), Audit log and + Add provider actions, and the shared Models subnav
  with the Providers tab going live.
- **Solution/Scope:** `/models/providers` route in the Models section; head per
  the mockup (subline text from the AD.5-approved copy); **Audit log** →
  AD.4's trail sheet; **+ Add provider** → AE.5 flow; subnav amendment (AA.1):
  Providers active with accent underline, Registry/Spend still honest stubs.
- **Acceptance Criteria:** Route + head + working actions; subnav states
  correct from both directions (06 ⇄ 07); both themes; AA.1 amendment posted.
- **Parallelism/Dependencies:** Needs AA.1, AD.4, BA-D.5. Blocks AE.2–AE.6.
- **Technical Stack:** Next.js, #46 primitives.
- **Epic:** AE

```
[Models] Providers & keys                    [Audit log] [+ Add provider]
Routing | Model registry·soon | ●Providers & keys | Spend·soon
```

### Issue AE.2 — ouroboros-ui: [AE.2] Provider cards

> **GitHub issue:** #228 · **Status:** 🟡 Open · **Parent epic:** #214


- **Problem Statement:** The five cards are the page: dense, per-adapter
  composition (key-auth vs base-URL vs host layouts) with live status, spend,
  and models — schema-driven so AF.3's new adapters get cards for free.
- **Solution/Scope:** `ProviderCard` composition from adapter config schemas +
  connection data: monogram (kind-tinted per the mockup's five), name +
  capability line, status pill (ok/warn/error from adapter taxonomy), enable
  switch (persists; disabled connections dim and drop from routing health),
  key row variant by auth mode (masked input / base-URL field / host field),
  meta row (added-by from `"user"`, relative last-used, em-dash before first
  use), models chips from `provider_models` (+ tier pill on real signal) or
  Ollama pull-list slot (AE.4), monthly meter (calendar-month spend of cap,
  warn variant ≥ 80%, locals' `no metered spend` / `on-box tokens` lines per
  P8), card foot (Test connection + note slot + cap field). Responsive two-
  column → single.
- **Acceptance Criteria:** Seeded grid reproduces all five mockup cards
  element-for-element in both themes (screenshot test); switch/enable
  round-trips; meter math matches seeds; a sixth fake-adapter connection
  renders correctly with zero card-code changes (schema-driven proof).
- **Parallelism/Dependencies:** Needs AE.1, AC.6. Blocks AE.3, AE.4, AE.6.
- **Technical Stack:** React, #46 primitives, schema-driven composition.
- **Epic:** AE

```
[AN] Anthropic Claude · api.anthropic.com · primary coding lane   (connected) [switch]
[sk-ant-••••Xq4A][Reveal][Rotate]   Added by Ken · 2026-06-12 · last used 3m ago
MODELS: (claude-fable-5)(claude-opus-5)(claude-sonnet-5)(claude-haiku-4-5)(priority tier)
This month $412.80 of $600 ▓▓▓▓▓▓▓░░░   [Test connection] ✓ 200 · 38ms   cap [$600]
```

### Issue AE.3 — ouroboros-ui: [AE.3] Key management flows

> **GitHub issue:** #229 · **Status:** 🟡 Open · **Parent epic:** #214


- **Problem Statement:** Reveal and Rotate are security-critical UX: step-up
  re-auth, time-boxed display, verify-then-retire — with the safety rails of
  AD.2 made visible.
- **Solution/Scope:** **Reveal**: click → step-up dialog (BA re-auth) → value
  shown in-place with countdown auto-mask (copy button, no clipboard
  persistence claims), audited-notice line; **Rotate**: dialog (new secret
  input → live validate with spinner → success swaps atomically; failure
  explains and leaves the old key active — state machine rendered honestly);
  base-URL/host edits validate-on-save the same way; **delete** (card
  overflow menu) with the dependency guard (409 → dialog listing dependent
  aliases, link to routing); disable-switch confirm when aliases depend.
- **Acceptance Criteria:** Reveal without recent auth → challenge; revealed
  value auto-masks on timer/navigation; rotate-fail path leaves old key
  working (e2e-verified); delete guard renders alias names; member role sees
  none of these affordances.
- **Parallelism/Dependencies:** Needs AE.2, AD.2.
- **Technical Stack:** React, #46 primitives, BA step-up client.
- **Epic:** AE

```
[Reveal] ─▶ step-up ─▶ sk-ant-api03-… (auto-mask 30s · audited)
[Rotate] ─▶ new key ─▶ validating… ─▶ ✓ swapped │ ✗ "old key still active" (explained)
```

### Issue AE.4 — ouroboros-ui: [AE.4] Test, discovery & Ollama pulls UX

> **GitHub issue:** #230 · **Status:** 🟡 Open · **Parent epic:** #214


- **Problem Statement:** Test connection, model-chip refresh, and the Ollama
  pull-list with real streamed progress are the page's live surfaces.
- **Solution/Scope:** **Test connection**: button → adapter validate → note
  renders real result (`✓ 200 · 38ms` ok / `△ 503 upstream · retrying` warn
  with bounded auto-retry indicator / `✗ auth failed` err), updates the
  status pill + Z.3 snapshot; **discovery refresh**: chips re-fetch on demand
  + after test (new/removed models animate in/out; removed-but-aliased models
  flagged); **Ollama pull-list**: rows per detected model (mono name, size
  tag, Pull latest) with streamed progress bar during pulls (survives reload
  via AC.4 status endpoint), queued state for concurrent requests, completion
  refreshes the list.
- **Acceptance Criteria:** Stopping the compose Ollama flips test note +
  pill honestly; pull of a small model shows progress → done in e2e;
  removed-model-with-alias warning renders; all states themed.
- **Parallelism/Dependencies:** Needs AE.2, AC.4 (+Z.3).
- **Technical Stack:** React, streamed status polling.
- **Epic:** AE

```
[Test connection] ─▶ ✓ 200 · 4ms       qwen3-coder:32b [19 GB][Pull latest ▶ ▓▓▓░ 61%]
                                        llama4:scout   [63 GB][queued…]
```

### Issue AE.5 — ouroboros-ui: [AE.5] Add-provider flow & catalog

> **GitHub issue:** #231 · **Status:** 🟡 Open · **Parent epic:** #214


- **Problem Statement:** The dashed card promises a catalog ("OpenAI, Google,
  Bedrock, or any OpenAI-compatible endpoint"); adding must be schema-driven
  so new adapters appear without UI work (decision P1).
- **Solution/Scope:** Flow: dashed card / head button → catalog dialog (kind
  tiles from the adapter registry: five live + honest `coming soon` tiles for
  AF.3 kinds), pick → form rendered from `configSchema()` (key/base-URL/host
  fields, capability note), submit → AD.2 add (live validation inline;
  failure keeps the form with the adapter's designed error) → card appears;
  duplicate-connection warning (same kind + endpoint).
- **Acceptance Criteria:** Add-vLLM and add-Anthropic paths e2e; bad key never
  creates a card; catalog tiles derive from the registry (fake adapter shows
  up unbidden — proof); soon-tiles clearly non-interactive.
- **Parallelism/Dependencies:** Needs AE.1, AC.1, AD.2.
- **Technical Stack:** React, schema-driven forms (shared with WF-S.4
  machinery).
- **Epic:** AE

```
[+] ─▶ catalog: (Anthropic)(OpenAI-compat)(Ollama)(Copilot)(Cursor)(OpenAI·soon)(Google·soon)(Bedrock·soon)
  ─▶ schema form ─▶ live validate ─▶ card appears (never an untested key)
```

### Issue AE.6 — ouroboros-ui: [AE.6] Caps, security strip & states

> **GitHub issue:** #232 · **Status:** 🟡 Open · **Parent epic:** #214


- **Problem Statement:** Cap editing with warning semantics (P7), the
  truth-corrected security strip (AD.5), and the page's empty/read-only/error
  states complete the surface.
- **Solution/Scope:** Cap field: currency parsing, `—` = uncapped, save via
  AD.2 PATCH; meter warn state ≥ 80% (the Copilot card), "warning only —
  enforcement arrives with invocation" tooltip (P7 honesty); security strip
  per AD.5's approved copy + doc link (badges only as earned); states: empty
  org guidance ("Connect your first provider" with role-aware CTA), member
  read-only (cards visible, all controls disabled with explanation), load
  skeletons, error banner (DASH-I.7 pattern), disabled-connection dimming.
- **Acceptance Criteria:** Cap edit round-trips and re-renders meters;
  strip copy matches AD.5 verbatim (no unearned badges — reviewed); personal
  org shows guidance; member session verified read-only; all themed.
- **Parallelism/Dependencies:** Needs AE.2–AE.5, AD.5.
- **Technical Stack:** React, #46 primitives.
- **Epic:** AE

```
cap [$95] ─▶ meter warn ▓▓▓▓▓▓▓▓░ 80% · ⓘ "warning only until invocation lands"
◈ "Keys sealed per-tenant with envelope encryption (AES-256-GCM). Workers never see keys."
```

### Issue AE.7 — ouroboros-ui: [AE.7] Providers e2e leg

> **GitHub issue:** #233 · **Status:** 🟡 Open · **Parent epic:** #214


- **Problem Statement:** The credential lifecycle spans UI, REST, crypto, and
  adapters — only e2e certifies the whole chain.
- **Solution/Scope:** Extend #56: seeded parity (five cards, strip), add-vLLM
  flow (catalog → form → validate → card), test-connection truth (stop a
  compose provider → warn/err note), reveal step-up + auto-mask, rotate
  verify-then-retire (fail + success paths), Ollama pull progress, cap edit +
  warn meter, audit sheet shows the session's operations, member read-only,
  both themes screenshot-diffed.
- **Acceptance Criteria:** Green from cold compose; each leg fails
  meaningfully when its layer breaks (spot-verified); ≤ 2.5 min added.
- **Parallelism/Dependencies:** Needs AE.1–AE.6, AC.6 seeds; amends #56.
- **Technical Stack:** Playwright.
- **Epic:** AE

```
e2e: parity ✓ · add ✓ · test truth ✓ · reveal/rotate ✓ · pull ✓ · caps ✓ · audit ✓ · themes ✓
```

---

## Epic AF (#215) — Invocation & Extended Providers (v2 · milestone `Providers & Keys v2`)

| Ref | GitHub | Status | Title | Summary | Labels | Parallel | MVP | Complexity | Affected Modules |
|-----|:------:|:------:|-------|---------|--------|:--------:|:---:|:----------:|------------------|
| AF.1 | #234 | 🟡 Open | ouroboros-rest: [AF.1] Invocation gateway ADR | Decide custom-executor vs LiteLLM-under-custom (AB.1 input) | v2, providers, routing, rest | Y | N | M | docs |
| AF.2 | #235 | 🟡 Open | ouroboros-rest: [AF.2] Chain executor implementation | Execute Z.1 resolutions: per-hop errors, streaming, usage, caps | v2, providers, routing, rest, engine | N (after AF.1, AD.3) | N | L | ouroboros-rest, ouroboros-engine |
| AF.3 | #236 | 🟡 Open | ouroboros-rest: [AF.3] Cloud adapters & KEK wrappers | OpenAI/Google/Bedrock adapters; KMS + Vault/OpenBao wrappers | v2, providers, rest | N (after AC.1, AD.1) | N | L | ouroboros-rest |
| AF.4 | #237 | 🟡 Open | ouroboros-rest: [AF.4] Cap enforcement & spend alerts | Hard caps at invocation, threshold alerts, needs-you surfacing | v2, providers, rest, ui | N (after AF.2) | N | M | ouroboros-rest, ouroboros-ui |
| AF.5 | #238 | 🟡 Open | ouroboros-ui: [AF.5] Ollama pull queue & model management | Pull queue, disk awareness, remove models, schedule refresh | v2, providers, ui | N (after AC.4) | N | M | ouroboros-ui, ouroboros-rest |

### Issue AF.1 — ouroboros-rest: [AF.1] Invocation gateway ADR

> **GitHub issue:** #234 · **Status:** 🟡 Open · **Parent epic:** #215


- **Problem Statement:** Everything AI-real (LLM estimator INTAKE-O.2,
  execution WF-T.6, traffic health AB.2) waits on invocation; the AB.1
  requirements doc + AD.3 contract need a decided architecture
  (infrastructure option 4).
- **Solution/Scope:** ADR: custom executor over the adapter SPI (4-A) vs
  self-hosted LiteLLM under our resolution (4-B); evaluate against AB.1's
  requirements (per-hop taxonomy, floor abort, cost caps, vote execution,
  streaming, local parity, usage capture) + P3 proxying + throughput
  measurements; prototype the riskiest path (streaming pass-through under
  load); decision with graduation triggers.
- **Acceptance Criteria:** ADR merged referencing AB.1 + AD.3; prototype
  results recorded; AF.2 scoped to the decision.
- **Parallelism/Dependencies:** Independent (AB.1, AD.3 as inputs). Blocks
  AF.2.
- **Technical Stack:** ADR, streaming prototype.
- **Epic:** AF

### Issue AF.2 — ouroboros-rest: [AF.2] Chain executor implementation

> **GitHub issue:** #235 · **Status:** 🟡 Open · **Parent epic:** #215


- **Problem Statement:** The AD.3 proxy contract must become a working
  executor of Z.1 resolutions — the single choke point where keys stay
  sealed, hops fail over, caps enforce, and usage lands.
- **Solution/Scope:** Per the ADR: implement `POST /internal/llm/invoke`
  (chain from resolution, streaming responses to the engine, per-hop error
  taxonomy driving failover exactly as routing explanations promised, floor
  abort → run failure with reason, per-run + per-provider cap checks
  pre-flight and running, `token_usage` rows per hop with model/provider
  attribution, `last_used_at` maintenance); adapter SPI gains `invoke()`
  implementations for the five MVP adapters; AB.2's telemetry emitted.
- **Acceptance Criteria:** Chain with a dead primary fails over per
  resolution; floor abort verified; cap breach blocks pre-flight with a
  designed error; usage rows reconcile with provider-reported counts on
  fixtures; streaming latency overhead measured & documented.
- **Parallelism/Dependencies:** Needs AF.1, AD.3, Z.1. Unlocks INTAKE-O.2,
  WF-T.6, AB.2.
- **Technical Stack:** Per ADR (NestJS streaming or LiteLLM), adapter SPI.
- **Epic:** AF

```
engine ─▶ /internal/llm/invoke {resolution r1, payload}
  hop1 Anthropic ✗ timeout ─▶ hop2 Copilot ✓ stream ─▶ usage rows/hop ─▶ engine
  floor breach │ cap breach ─▶ designed failure (reason from resolution/caps)
```

### Issue AF.3 — ouroboros-rest: [AF.3] Cloud adapters & KEK wrappers

> **GitHub issue:** #236 · **Status:** 🟡 Open · **Parent epic:** #215


- **Problem Statement:** The add-card's catalog promise (OpenAI, Google,
  Bedrock) and the security strip's "KMS-backed" option need their v2
  implementations on the frames built for them.
- **Solution/Scope:** Adapters: OpenAI (key, `/v1/models`), Google Gemini
  (key, models API), AWS Bedrock (SigV4 + region config schema, model list
  per region) — each passing the conformance kit, catalog tiles activating
  automatically; KEK wrappers: AWS KMS, GCP KMS, and Vault/OpenBao transit
  implementations of `KeyWrapper` with re-wrap migration runbooks
  (`docs/SECURITY_MODEL.md` updated per deployment mode).
- **Acceptance Criteria:** Kit green for all three adapters (recorded
  fixtures); KEK re-wrap from env-master to each backend leaves all
  ciphertexts readable (migration test); catalog tiles flip from soon → live
  without UI changes.
- **Parallelism/Dependencies:** Needs AC.1, AD.1.
- **Technical Stack:** Provider APIs, AWS SDK (SigV4), Vault/OpenBao transit.
- **Epic:** AF

### Issue AF.4 — ouroboros-rest: [AF.4] Cap enforcement & spend alerts

> **GitHub issue:** #237 · **Status:** 🟡 Open · **Parent epic:** #215


- **Problem Statement:** P7 shipped caps as warnings; with invocation live,
  caps must actually stop spend — and people must hear about it before it
  happens.
- **Solution/Scope:** Enforcement in AF.2's pre-flight (monthly cap reached →
  provider excluded from chains with a resolution explanation; org-wide
  behavior per route floor semantics), threshold alerts (80/95/100% →
  needs-you/inbox surfacing + audit events), meter states upgraded (blocked
  state on the card), cap-change audit already in place (AD.4).
- **Acceptance Criteria:** Fixture spend at 100% blocks invocation with a
  designed failure naming the cap; alert events at thresholds fire once each;
  card shows blocked state; warning-only tooltip removed (truth updated).
- **Parallelism/Dependencies:** Needs AF.2.
- **Technical Stack:** NestJS, alert events.
- **Epic:** AF

### Issue AF.5 — ouroboros-ui: [AF.5] Ollama pull queue & model management

> **GitHub issue:** #238 · **Status:** 🟡 Open · **Parent epic:** #215


- **Problem Statement:** One-at-a-time pulls (AC.4) suffice for MVP; real
  local-model management wants queues, disk awareness, and removal.
- **Solution/Scope:** Pull queue UI (ordered, cancellable), disk-usage
  awareness from the host (total model footprint vs available where the API
  exposes it), model removal (`/api/delete` with alias-dependency guard),
  scheduled discovery refresh, multi-host support notes (several Ollama
  connections).
- **Acceptance Criteria:** Queue processes sequentially with cancel; removal
  guarded like connection deletion; disk figures only when real (honesty).
- **Parallelism/Dependencies:** Needs AC.4.
- **Technical Stack:** React, Ollama API.
- **Epic:** AF

---

## Work Order (dependency-ordered execution plan)

```mermaid
flowchart TB
    subgraph P0["Phase 0 — Prerequisites"]
        PRE["Routing roadmap: Y.1 schema · Z.3 health · (Z.1/AB.1 for AF)<br/>BetterAuth: BA-C.3 · BA-D.5 · step-up capability<br/>Scaffolding: #28 · #41 · #46 · #51<br/>DASH-F.3 token_usage · #26 coordination (audit shape)"]
    end
    subgraph P1["Phase 1 — Crypto & SPI"]
        AD1["AD.1 envelope encryption"] --> AD2["AD.2 credential lifecycle"]
        AC1["AC.1 adapter SPI + kit"]
        AD1 --> AD3["AD.3 worker delivery"]
    end
    subgraph P2["Phase 2 — Adapters & data"]
        AC1 & AD1 --> AC2["AC.2 anthropic"] & AC3["AC.3 openai-compat"] & AC5["AC.5 copilot+cursor"]
        AC1 --> AC4["AC.4 ollama + pulls"]
        AC6["AC.6 schema + seeds + ci"]
        AD2 --> AD4["AD.4 audit trail"]
        AD1 & AD2 & AD3 --> AD5["AD.5 security doc"]
    end
    subgraph P3["Phase 3 — UI"]
        AD4 --> AE1["AE.1 route + frame"]
        AC6 --> AE2["AE.2 provider cards"]
        AE1 --> AE2
        AE2 --> AE3["AE.3 key flows"] & AE4["AE.4 test/discovery/pulls"]
        AC1 & AD2 --> AE5["AE.5 add-provider catalog"]
        AE3 & AE4 & AE5 & AD5 --> AE6["AE.6 caps + strip + states"]
        AE6 --> AE7["AE.7 e2e = MVP gate"]
    end
    subgraph V2["v2 — Providers & Keys v2"]
        AF1["AF.1 invocation ADR"] --> AF2["AF.2 chain executor"] --> AF4["AF.4 cap enforcement"]
        AF3["AF.3 cloud adapters + KEK wrappers"]
        AF5["AF.5 ollama management"]
        AF2 -.-> UNLOCK["unlocks: INTAKE-O.2 · WF-T.6 · AB.2"]
    end
    P0 --> P1
    AE7 -.-> V2
```

Ordered checklist (⊕ = parallelizable within its phase):

1. **Phase 0 — Prerequisites:** routing Y.1/Z.3 (Z.1 + AB.1 before AF);
   BA-C.3/D.5 + step-up; #28/#41/#46/#51; DASH-F.3; #26 audit-shape
   coordination.
2. **Phase 1 — Crypto & SPI:** { AD.1 ⊕ AC.1 } → { AD.2 ⊕ AD.3 }
3. **Phase 2 — Adapters & data:** { AC.2 ⊕ AC.3 ⊕ AC.4 ⊕ AC.5 ⊕ AC.6 } →
   { AD.4 ⊕ AD.5 }
4. **Phase 3 — UI:** AE.1 → AE.2 → { AE.3 ⊕ AE.4 ⊕ AE.5 } → AE.6 →
   **AE.7 ✅** *(MVP gate, amending #56)*
5. **v2:** AF.1 → AF.2 → AF.4; AF.3 ⊕ AF.5 in parallel. AF.2 is the unlock
   for the LLM estimator (INTAKE-O.2), workflow execution (WF-T.6), and
   traffic health (AB.2).

## Totals

| | Issues | MVP | v2 |
|---|:---:|:---:|:---:|
| Epic AC — Provider Adapter Framework | 6 | 6 | 0 |
| Epic AD — Vault, Secrets & Audit | 5 | 5 | 0 |
| Epic AE — Providers UI | 7 | 7 | 0 |
| Epic AF — Invocation & Extended | 5 | 0 | 5 |
| **Total** | **23** | **18** | **5** |

Filed as **#212–#215** (epic parents) and **#216–#238** (23 work issues).

Plus **7 amendments** — comments posted and the `providers` label applied on
2026-08-09; no new work created:

| Issue | Amendment |
|---|---|
| #200 | AA.1's **Providers & keys** tab goes live via AE.1 (#227); registry and Spend stay honest stubs |
| #56 | The e2e suite gains the providers leg AE.7 (#233), composing with the routing leg (#206) |
| #26 | AD.4 (#225) early-adopts the `audit_events` shape — and lands the table if #26 is still unbuilt. AD.3 (#224) is the first emitter: `credential.lease_granted` is assembled at the one point a grant is known to have happened and written to the service log, and #225 changes that method body to an insert |
| #138 | WF-Q.1's ad-hoc AES-GCM helper superseded by the AD.1 (#222) vault service, with a migration |
| #101 | INTAKE-K.3's GitHub credential encryption likewise moves to AD.1 (#222) |
| #189 | Routing Y.1's schema is **extended** by AC.6 (#221) — caps, meta, `enabled`, and `provider_models`; aliases gain soft validation against discovered models (P6) |
| #207 | Routing AB.1's deferred gateway decision now has its ADR issue: AF.1 (#234), implemented by AF.2 (#235) |

## References

- Design source: [`docs/mockups/07-providers.html`](mockups/07-providers.html),
  `docs/mockups/assets/ouroboros.css`; sibling mockups 06/21
- Upstream roadmaps: scaffolding (filed); BetterAuth, dashboard, intake,
  workflow-builder, workflow-code, model-routing (validation gates —
  especially `ROADMAP_MOCKUP_06_MODEL_ROUTING.md` Y.1/Z.3/AB.1)
- Secrets research: [Vault transit envelope encryption](https://developer.hashicorp.com/vault/docs/secrets/transit/envelope-encryption) ·
  [transit secrets engine](https://developer.hashicorp.com/vault/docs/secrets/transit) ·
  [AWS KMS vs Vault introduction](https://blog.gitguardian.com/talking-about-data-security-an-introduction-to-aws-kms-and-hashicorp-vault/) ·
  [go-kms-wrapping (pluggable KEK pattern)](https://github.com/hashicorp/go-kms-wrapping) ·
  [key-management practices 2026](https://oneuptime.com/blog/post/2026-01-30-key-management-practices/view) ·
  [credential injection for AI agents (token vault + KMS)](https://agentgateway.dev/blog/2026-08-03-protecting-token-vault-kms-credential-injection/)
- Gateway research: carried from the routing roadmap (LiteLLM router docs,
  gateway comparisons — see `ROADMAP_MOCKUP_06_MODEL_ROUTING.md` references)

## UI/UX Shell Compliance (addendum 2026-08-09)

The application shell defined in
[`docs/DESIGN_SYSTEM_APP_SHELL.md`](DESIGN_SYSTEM_APP_SHELL.md) (implementing
roadmap: [`ROADMAP_UIUX_APP_SHELL.md`](ROADMAP_UIUX_APP_SHELL.md)) supersedes
the mockup's top-bar navigation chrome for every UI issue in this roadmap:

1. **Header** — application name/brand upper-left (with the tenant chip),
   profile & session controls upper-right; no navigation links in the header.
2. **Sidebar navigation** — fixed left rail of icon + name entries
   (registry-driven); this surface is reached via the **Models** entry.
   The Models tab set (Routing / Model registry / Providers & keys / Spend)
   stays at the top of the content pane.
3. **Content-only scrolling** — the content pane is the sole scroll
   container; header and sidebar never scroll; wide content (tables, gantts,
   matrices) scrolls inside its own wrappers, never the pane.
4. **Type scale** — all type and spacing rem-based against the #16 tokens so
   the five-step font-size preference (App Shell CQ.2) scales every surface;
   no hard-coded px text (lint-enforced by CQ.1).
5. **Mockup interpretation** —
   [`docs/mockups/07-providers.html`](mockups/07-providers.html) remains the
   design source for page content and card anatomy; its `.topbar`/`.nav`
   chrome is superseded by the shell spec.

Issue-level impact:

| Issue | Amendment |
|---|---|
| AE.1 (#227) | Mounts in the shell content pane; navigation via the sidebar **Models** entry (CP.2 registry), not a topbar link; the in-page subnav (if any) renders via the CP.4 PageSubnav primitive (sticky within the pane scroll) |
| AE.2–AE.6 (#228–#232) | rem-based type (CQ.1 tokens); sticky elements (table headers, dirty-state bars) stick within the content pane (CP.4); component/state/a11y standards per spec §3 |
| AE.7 (#233) | Gains shell assertions: header/sidebar fixed while this page scrolls, correct sidebar active state (**Models** stays active on sub-routes), and a font-scale (125%) render check |

## Next Step

**Issues filed 2026-08-09.** The validation gate is closed. Created during filing:
the `providers` label, the **`Providers & Keys MVP`** and **`Providers & Keys v2`**
milestones, the four epic parents (#212–#215) and twenty-three work issues
(#216–#238) with epic relationships, issue types and milestone assignments, plus
the seven amendment comments on #200, #56, #26, #138, #101, #189 and #207.

The decisions worth re-reading before work starts, all now recorded in the filed
issues:

- **P1 — pluggability is structural** (#216). Core code imports the SPI only, a
  lint boundary enforces it, and the claim is testable: the fake adapter must
  render its card (#228) and its add-form (#231) with zero UI changes. That test
  is what makes AF.3's (#236) three cloud adapters cheap rather than a UI project.
- **P2 — envelope encryption with a pluggable KEK** (#222). The env-master default
  keeps the product self-hostable with no extra infrastructure; the design's value
  is that moving to KMS or Vault (#236) re-wraps sealed DEKs and leaves every data
  ciphertext byte-identical — verified there, not assumed here.
- **P3 — workers never hold keys** (#224, 🟢 delivered). Proxied invocation rather than the
  mockup's 15-minute tokens, with a scoped lease for local providers only and a
  cloud lease refused by server-side policy.
- **P4/P5 — the key row is not an exfiltration UI** (#223, #225, #229). Masked
  server-side, Reveal behind step-up and always audited, Rotate verifying before
  it retires, and every operation on the trail from the first commit.

Three honesty stances are carried into the issues and should survive review: caps
are **warning-only** until #237, and the tooltip says so (#232); local providers
show `no metered spend` rather than a fabricated `$0.00` (#228); and the security
strip loses its **unearned SOC 2 / ISO 27001 badges** and its inaccurate
15-minute-token line, replaced by AD.5's (#226) approved copy — which #232 renders
verbatim rather than paraphrasing.

**Prerequisites:** routing **Y.1** (#189) and **Z.3** (#196) are filed, as are
#26/#28/#41/#46/#51 and DASH-F.3 (#66). The **BetterAuth roadmap is still unfiled**
and gates AD.2's step-up (#223) and AE.1's session context (#227). AF.2 (#235)
additionally needs **Z.1** (#194) and **AB.1** (#207), both filed.

Once those are in place, begin with **#222** ([AD.1] envelope encryption) and
**#216** ([AC.1] the adapter SPI) — the two independent foundations everything
else in this roadmap sits on. Then **#235** ([AF.2] chain executor) is the single
highest-leverage issue in the v2 backlog: it unlocks the LLM estimator (#123),
workflow execution (#160) and traffic-derived health (#208).
