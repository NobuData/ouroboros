# Demonstration — P5 · The Model Plane

> A five-minute walkthrough of what phase **P5** of
> [`ROADMAP_OOE_MVP.md`](ROADMAP_OOE_MVP.md) delivered, and how to show it.
> **Status at the time of writing:** ✅ complete — all 50 issues closed. The largest
> phase in the plan (153 complexity points) and the deepest platform investment.

## Regeneration prompt

Copy this into Claude Code to rebuild this document, or swap the phase token to
generate another phase's script.

```text
Read `docs/ROADMAP_OOE_MVP.md` and produce `docs/DEMONSTRATION_P5.md` — a
walkthrough script for phase **P5** of the order-of-execution plan.

Rules:
1. Ground every claim in this repository. Before writing a step, open the file,
   route, endpoint, migration or fixture it names and confirm it exists at HEAD.
2. Confirm what actually shipped:
   `gh issue list --state closed --limit 1000 --json number --jq '.[].number'`
   (plain `gh issue view` fails on this repo — use `--json`). The roadmap's ✅ marks
   can be stale; GitHub wins. Demonstrate only closed issues, and say plainly what
   the phase still owes.
3. No fabricated numbers. Every figure the presenter reads aloud must come from a
   seed file, a fixture under `tests/e2e/support/`, or a live response.
4. The walkthrough must fit in 5 minutes. Give it timed beats summing to ≤ 4:45.
5. Structure: What shipped · Setup · Walkthrough (timed table of navigation +
   narration) · Prove it · Don't claim.
6. Narration is what the presenter says out loud, in full sentences. Navigation is
   what they click or type.
7. Where a later phase moved or replaced something this phase built, say so rather
   than demonstrating the old shape.

Swap the phase token to regenerate any other phase: P0 … P17.
```

## What shipped

| Track | Issues | What landed |
|-------|:------:|-------------|
| **Vault & audit** (`AD`) | [#222](https://github.com/NobuData/ouroboros/issues/222)–[#226](https://github.com/NobuData/ouroboros/issues/226) | Envelope encryption with per-tenant DEKs (`V013`), the credential lifecycle API, worker credential delivery, the audit trail, and [`SECURITY_MODEL.md`](SECURITY_MODEL.md) |
| **Adapters** (`AC`) | [#216](https://github.com/NobuData/ouroboros/issues/216)–[#221](https://github.com/NobuData/ouroboros/issues/221) | The `ModelProviderAdapter` SPI and registry, five conforming adapters — Anthropic, OpenAI-compatible, Ollama, Copilot, Cursor — and the discovered-models catalog |
| **Routing** (`Y`/`Z`) | [#189](https://github.com/NobuData/ouroboros/issues/189)–[#199](https://github.com/NobuData/ouroboros/issues/199) | Connections and aliases (`V015`), task kinds/routes/hops (`V016`), escalation rules (`V018`), the resolution engine with explanations, the management API, simulate, route stats and spend |
| **Registry** (`CG`/`CH`) | [#579](https://github.com/NobuData/ouroboros/issues/579)–[#588](https://github.com/NobuData/ouroboros/issues/588) | The pricing catalog, alias lifecycle/binding/params (`V019`), the alias reference index (`V023`), the pricing, param-capability and read-model services, and import-from-provider |
| **The screens** (`AA`/`AE`/`CI`) | [#200](https://github.com/NobuData/ouroboros/issues/200)–[#206](https://github.com/NobuData/ouroboros/issues/206), [#227](https://github.com/NobuData/ouroboros/issues/227)–[#233](https://github.com/NobuData/ouroboros/issues/233), [#591](https://github.com/NobuData/ouroboros/issues/591)–[#594](https://github.com/NobuData/ouroboros/issues/594) | Mockup 06 (`/models`), mockup 07 (`/models/providers`) and mockup 21 (`/models/registry`) |

**The point of the phase.** This is the product's vocabulary. Workflows pin aliases,
the estimator routes through them, runs report cost against their prices, insights
score them, and the copilot proposes them. Building any of those first means
hard-coding model identity and unpicking it later. The vault in particular had to
exist before the first credential was stored anywhere.

## Setup

```bash
cd ouroboros
git switch main && git pull
yarn install && yarn setup
docker compose up -d                 # seeded: connections, aliases, kinds, routes, hops, rules
yarn dev
```

> **Port note.** If something on the machine already holds 5432, publish the
> container elsewhere — `OURO_DB_PORT=45432 docker compose up -d` — and move the
> `psql` URL and `OURO_DATABASE_URL` with it.

Sign in as `ken@acme-robotics.dev` / `ouroboros-dev-password` (an **owner** — the
policy controls in beat 2 are owner/admin only) and choose **Acme Robotics**. Navigate
to **Models** in the sidebar; you land on `/models`, the routing tab.

Optional, for the Ollama pull in beat 3:

```bash
docker compose --profile ollama up -d ollama    # http://localhost:11434
```

**All figures below are the seed's**, asserted by
[`tests/e2e/support/routing.ts`](../tests/e2e/support/routing.ts) and
[`tests/e2e/support/providers.ts`](../tests/e2e/support/providers.ts). If the screen
disagrees, the seed did not apply.

## Walkthrough — 4:45

### Beat 1 · Every model has a name, and every route points at the name — 0:00 → 1:05

**Navigate**

`/models`. Point at the provider health strip, then read down the routing matrix.

**Say**

> Five connected providers across the top with their live health, then the routing
> matrix: eight task kinds, and for each one the alias its primary hop resolves to,
> its fallback, and any escalation rules attached.
>
> `analyze` goes to `coder-std` and falls back to `local-docs`, at four cents and 3.1
> seconds a run. `implement` goes to `coder-max`, falls back to `coder-fallback`, and
> carries an escalation rule — 87 cents and 41 seconds. `commit-msg` costs nothing at
> all, because it runs locally.
>
> Two things about those numbers. They are **computed, never stored** — 87 cents is an
> average over the usage ledger, 41 seconds is a median, and the seed's own header
> forbids writing any of them down. And the cells name **aliases**, not models. A
> route never names a raw model. That indirection is the whole reason this phase comes
> before workflows, planning and execution.

### Beat 2 · Switch a rule off and the answer changes — 1:05 → 2:20

**Navigate**

Open the `implement` row's inspector. Show its three hops — `coder-max`,
`coder-fallback`, then `local-docs` — and the policy fields: **Allow fallback to local
models**, **Floor hop**, **Max cost per run** at `$2.50`. Drag hop 2 above hop 1 and
press **Save routes**, then re-read the matrix row. Undo it.

Then open **Simulate this route**, set task kind `implement` and effort `L`, and run
it. Note the answer. Switch the escalation rule *effort ≥ L → implement uses coder-max
(max thinking)* **off** in the rules card, and simulate again.

**Say**

> The chain is editable and reorderable, and **Save routes** is a real write — the
> matrix redraws its resolution lines from what the server now holds, not from local
> state.
>
> Now the sharpest assertion in the whole suite. Three escalation rules are seeded:
> *effort ≥ L → implement uses coder-max*, *security label → review adds a
> second-opinion vote*, and *docs-only diff → everything routes local*. I switch the
> first one off, and the simulator's answer changes.
>
> If it did not, these switches would be decoration and escalation would not be a
> feature. The rules are a table in one service, the switch is a control in another,
> and the only place the two meet is a running stack — which is exactly why the
> end-to-end suite owns that assertion.
>
> The **Floor hop** is the other half of the same idea: switch a floor on over a route
> whose primary is genuinely unreachable and the run **stops and says so** — a
> designed outcome, not an error.

### Beat 3 · Credentials — a rotation the provider refused — 2:20 → 3:35

**Navigate**

Go to **Providers & keys**. Read the five cards: Anthropic Claude, cap $600, $412.80
this month, 4 models; Cursor, $120 cap, $64.10; GitHub Copilot, $95 cap, $76.00;
OpenAI-compatible vLLM, uncapped, $0.00, 2 models; Ollama workstation, uncapped,
$0.00, 3 models.

Reveal a key: the **Confirm it's you** dialog appears — enter the password and
**Confirm and reveal**. Then open the **Audit log** and point at the row that just
appeared.

**Say**

> Every key here is stored under envelope encryption with a per-tenant data key. The
> card shows a mask, never a key; the *This month* meter is calendar-month spend over
> the usage ledger, not a stored total.
>
> Revealing puts a live credential on a real screen, so it costs a step-up: re-enter
> your password. And the reveal is **recorded** — the audit log says who revealed
> what, and when, and it records refusals too. No entry ever holds a key.
>
> The behaviour I would most like you to remember is the one you cannot see from here:
> **a rotation the provider refuses leaves the old key still working.** Rotation is
> verify-then-retire across four layers — the new key is proven against the live
> provider before the old one is retired — and the end-to-end suite proves the old key
> still works afterwards by testing it. A vault that lost you access on a typo would
> be worse than no vault.

### Beat 4 · The registry — nothing rendered is stored — 3:35 → 4:25

**Navigate**

Go to **Model registry**. Read the **Allowed models** table: eight aliases, including
`gpt5-experiments`, which is bound to no provider. Open the inspector on `coder-max`
and point at its params chips, its price, its health cell and its *used by* count.

**Say**

> Eight aliases. Each row shows where it resolves, the params it pins, what it costs
> per million tokens in and out, its health, and how many routes and rules reference
> it.
>
> Not one of those is a stored string. The chips are *derived* from the alias's params
> document; the health cell is derived from the provider connection's status; the price
> comes from the bundled pricing catalog plus this workspace's one override; and the
> *used by* count is a view over the reference index. The seed's tests assert that
> none of those rendered strings appears anywhere in the seed file — so the page cannot
> be right by having been typed.
>
> `gpt5-experiments` is the deliberate awkward case: an alias with no provider bound,
> so it cannot be switched on, and the page says why rather than showing a dead
> toggle. And deleting an alias is **blocked** while any route or rule still points at
> it — that is the reference index doing its job.

### Beat 5 · What holds it together — 4:25 → 4:45

**Navigate**

Point at the **Security model** strip at the foot of the providers page and its
*self-hosted* tag.

**Say**

> Five providers, one adapter interface, and a conformance kit every adapter passes —
> so adding a sixth is a plugin rather than a fork. Underneath it all, one vault, one
> audit trail, and a security model written down rather than assumed. That is the
> vocabulary the next twelve phases are built in.

## Prove it

```bash
cd ouroboros-rest && yarn test          # routing integration (#199), registry, adapters
scripts/run-tests.sh ouroboros-db/tests # routing (#193) and registry (#583) constraints
cd tests/e2e && scripts/run.sh -- --grep "routing|providers"
```

- [`specs/routing.spec.ts`](../tests/e2e/specs/routing.spec.ts) — mockup 06 against
  four seeded tables and the resolution engine: a chain reordered, saved and re-read;
  a rule switched off changing what the simulator answers; a floor turning a
  degradable run into a designed failure; and the same page served read-only to
  `jorge@acme-robotics.dev`, a member.
- [`specs/providers.spec.ts`](../tests/e2e/specs/providers.spec.ts) — the credential
  lifecycle across four layers: a key the provider refuses connecting no card; a
  failed rotation leaving the old key working; a reveal shown, recorded and masked
  again; a pull whose progress survives a reload; and a provider that really goes
  away.

## Don't claim

- **No model is actually invoked by this demo.** P5 delivers routing *metadata*,
  credentials and resolution. The chain executor that makes a live call is flagged v2
  and is the open decision blocking parts of P16.
- **There is no registry e2e leg yet.** `CI.7`
  ([#597](https://github.com/NobuData/ouroboros/issues/597)) is deliberately held back
  to P7, because the resolution-snapshot contract needs the workflow DSL schema. The
  registry screen is covered by unit tests only.
- **Four registry issues are also held to P7** — `CH.6`, `CH.7`, `CI.5` and `CI.6`.
  The *why-aliases* and *resolution-chain* cards are not built.
- **The Spend tab in the models subnav is a labelled placeholder.** The full spend
  report arrives with [#210](https://github.com/NobuData/ouroboros/issues/210).
- **Provider health is passive-first.** It reflects what real calls reported, not a
  synthetic prober.
