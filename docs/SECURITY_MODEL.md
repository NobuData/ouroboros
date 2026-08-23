# The security model

> **Issue:** [#226](https://github.com/NobuData/ouroboros/issues/226) — *[AD.5] Security
> model documentation* · **Roadmap:**
> [`ROADMAP_MOCKUP_07_PROVIDERS_KEYS.md`](ROADMAP_MOCKUP_07_PROVIDERS_KEYS.md), decisions
> **P2**–**P5** · **Written:** 2026-08-22

A security claim in a user interface is a promise, and the only thing that separates a
promise from a marketing line is a document somebody can check it against. The Providers &
keys page makes four such claims in a single strip across the bottom of the screen. This
is the document that strip links to.

It has two jobs, and they pull in the same direction:

1. **It describes how Ouroboros handles credentials** — the cryptography, who holds the
   key that opens it, what a build worker is and is not given, and what is written down
   when somebody touches a key. An operator deciding whether to trust this software with
   an Anthropic key should be able to answer *who can read it* from this document alone.
2. **It is the single source for the wording that ships.** The strip's copy is not written
   in a component; it is written in [§7](#7-approved-copy-and-the-badge-policy) and
   rendered verbatim by AE.6 ([#232](https://github.com/NobuData/ouroboros/issues/232)). A
   claim that is not in this document does not appear on the page, which is the mechanism
   that keeps the two from drifting apart.

Of the strip's four claims, **one was true, one was true only of deployments that pay for
it, one was wrong in the safe direction, and one should never have been rendered at all.**
[§1](#1-every-claim-in-the-strip-traced) is that reckoning as a list.

## How to read the status marks

This system is being built, and a security document that described the finished thing
would be worse than useless — it would be the same class of error as the compliance
badges. So every section carries one of three marks, and they mean exactly this:

| Mark | Means | What you may rely on |
|---|---|---|
| **Shipped** | Merged into `main`. The code and the tests that hold it are named. | The behaviour described is the behaviour you get. |
| **Specified** | The contract exists — a committed interface, an OpenAPI document, or a filed issue's agreed scope — and the implementation does not. | The shape will not change under you. The behaviour is not there yet. |
| **Planned** | Decided, and not written. | Only that this is the direction. |

Where a section is **Specified** or **Planned**, the issue that will ship it is named. If
you are evaluating this deployment for production use, read only the **Shipped** sections
and treat everything else as absent.

---

## 1. Every claim in the strip, traced

The strip renders, today, in
[`docs/mockups/07-providers.html`](mockups/07-providers.html):

> ◈ Keys are sealed per-tenant with **envelope encryption** (AES-256-GCM, KMS-backed).
> Workers receive scoped, 15-minute tokens — never your raw key.
> `SOC 2 Type II` `ISO 27001` · **Read the security model ↗**

Claim by claim:

| The strip says | Verdict | Answered in |
|---|---|---|
| *"sealed per-tenant"* | **True** — one data-encryption key per workspace, and nothing shares one | [§2.1](#21-the-shape), [§2.6](#26-deleting-a-workspace-destroys-its-credentials) |
| *"envelope encryption (AES-256-GCM)"* | **True** — a per-workspace DEK under AES-256-GCM, itself sealed by a KEK | [§2](#2-envelope-encryption) |
| *"KMS-backed"* | **Qualified.** False of the default deployment, where the key-encryption key is an environment variable and custody is the operator's problem. True of deployments that configure a KMS or Vault wrapper, which is not yet built. | [§3](#3-key-custody-per-deployment-mode) |
| *"Workers receive scoped, 15-minute tokens — never your raw key"* | **Corrected — the truth is stronger.** Workers receive no cloud credential of any kind, not a short-lived one. The control plane makes the provider call. | [§4](#4-what-a-worker-is-given) |
| `SOC 2 Type II` | **Withdrawn.** No audit has been performed. | [§7.3](#73-the-badge-policy) |
| `ISO 27001` | **Withdrawn.** No certification exists. | [§7.3](#73-the-badge-policy) |

The page head above the cards makes four more, in its subline:

| The subline says | Verdict | Answered in |
|---|---|---|
| *"Credentials live in … an encrypted vault"* | **True** | [§2](#2-envelope-encryption) |
| *"scoped to this tenant"* | **True** — the binding is cryptographic, not a `where` clause | [§2.3](#23-the-binding-is-what-makes-per-tenant-mean-anything) |
| *"Keys never leave the control plane"* | **True**, with one exception that involves no key: a worker may be told the *address* of a local model server on its own network | [§4.3](#43-the-one-exception-and-why-it-is-not-one) |
| *"workers only ever see short-lived tokens"* | **Corrected** — no token is minted anywhere in this product | [§4.1](#41-what-was-claimed-and-what-is-true) |

Ten rows, and every one of them names the section that answers it — which is what the
acceptance criterion *checked as a list, not asserted* asks for.
[§7](#7-approved-copy-and-the-badge-policy) is the corrected wording that replaces both
pieces of copy.

---

## 2. Envelope encryption

> **Status: Shipped** — AD.1 ([#222](https://github.com/NobuData/ouroboros/issues/222)),
> roadmap decision **P2**.
> [`ouroboros-rest/src/modules/vault/`](../ouroboros-rest/src/modules/vault) ·
> [`V013__tenant_keys.sql`](../ouroboros-db/migrations/V013__tenant_keys.sql)

### 2.1 The shape

Every secret Ouroboros stores — a provider API key, a ticket-source token, a GitHub
credential — is encrypted with a **data-encryption key (DEK)** belonging to one workspace
and to no other. That DEK is never stored in the clear either: it is itself encrypted by a
**key-encryption key (KEK)** that lives outside the database.

```mermaid
flowchart LR
    S["a provider API key"]
    CT["envelope string<br/>stored in the consumer's column"]
    DEK["the workspace's DEK<br/>AES-256, one per workspace"]
    W["KeyWrapper"]
    KEK["the KEK<br/>env master key · KMS · Vault"]
    TK[("ouroboros.tenant_keys<br/>sealed DEK · version · wrapper")]

    S -->|"AES-256-GCM · 96-bit nonce<br/>AAD = workspace + record"| CT
    DEK --> CT
    DEK -->|"wrap"| W
    W --> KEK
    W -->|"sealed"| TK
```

That indirection — a key that encrypts data, and a second key that encrypts the first — is
what the word *envelope* means, and it buys exactly one thing that matters here: **the KEK
seals `tenant_keys` and nothing else.** Changing where the KEK lives rewrites one small
table and leaves every credential ciphertext in the database byte-for-byte identical. That
is [§3](#3-key-custody-per-deployment-mode)'s entire subject, and it is the difference
between "we added KMS support" being a configuration change and being a migration that has
to hold every plaintext secret in the product in memory at once.

### 2.2 The envelope is a string, and it says what it is

A sealed value is stored as five dot-separated fields:

```
ouro.v1.<dek version>.<base64url nonce>.<base64url ciphertext‖tag>
```

- `ouro` — a magic prefix, so a column holding these can be told from a column holding
  something else. The migration path in [§2.5](#25-rotating-a-key-is-additive) is the
  caller that needs it.
- `v1` — the **format** version, which is not the key version. It is what makes a later
  change to this framing detectable rather than silently misparsed.
- the **DEK version** — which of the workspace's keys sealed this value. This is what
  makes rotation additive: a value sealed under version 3 still says so after version 4
  becomes active, so opening it is a lookup rather than a guess.

The cipher is `aes-256-gcm` with a **96-bit nonce**, drawn fresh from the CSPRNG for every
single message and never from a counter, and the **full 128-bit** authentication tag —
nothing here truncates it.

### 2.3 The binding is what makes "per-tenant" mean anything

GCM authenticates *additional data* alongside the ciphertext without storing it: both
sides must derive the same bytes independently, or the tag fails. Ouroboros binds two
things into it — **the workspace id and the record id** — which is what makes the
following true rather than aspirational:

> A ciphertext lifted out of one workspace's row and pasted into another's does not
> decrypt into the second workspace's session. It fails authentication.

The encoding matters more than it looks. Joining two identifiers with a separator is the
obvious approach and it is broken: `("acme:1", "2")` and `("acme", "1:2")` produce the
same bytes, so a record id an attacker chose could be made to collide with another
workspace's binding. `canonicalAad` writes **each part's byte length before the part**,
which no choice of contents can forge. The swap-prevention criterion is satisfied for
every pair of identifiers, not for the ones that happen to contain no colon.

The same discipline applies one level up: a *sealed DEK* is bound to its workspace and
version, so a `tenant_keys` row copied between workspaces fails to unwrap rather than
handing the second workspace the first one's key. The two bindings use different domain
separators (`ouro-vault:v1` and `ouro-vault-kek:v1`) so that a future encoding mistake
cannot produce the same bytes for both.

### 2.4 What tampering produces

A flipped bit, a truncated column, the wrong key, and a ciphertext moved between
workspaces all produce the same thing: an authentication failure, and **no plaintext at
all**. GCM does not distinguish these cases and neither does this service. The tag is
verified by `final()`, so "returned a partial result" is not a state the decrypt path can
be in.

The error message names no part of the value, and does not wrap Node's own — some versions
of which have quoted a buffer into the message.

### 2.5 Rotating a key is additive

A rotation does not replace a key. It **adds a version**: the new version becomes the one
new writes are sealed under, the old one stays readable, and every stored envelope names
the version that sealed it. So re-encrypting the existing data can take as long as it
takes without anything being unreadable in the meantime.

```mermaid
flowchart LR
    A["v3 active"] -->|"rotate"| B["v4 active<br/>v3 retired, still readable"]
    B -->|"lazy: consumer writes a record"| C["that record now on v4"]
    B -->|"sweep: everything nobody touched"| C
    C --> D["v3 has no readers left"]
```

Two things move data across, and they are one code path:

- **Lazily, on write.** A consumer updating a record anyway re-seals it. This costs
  nothing.
- **By sweep**, for everything the product does not touch — because a credential that
  works is a credential nobody edits, and without a sweep "rotate the key" would be an
  operation that never finishes.

**At most one version per workspace may be active, and that is a partial unique index in
PostgreSQL rather than a check in the service.** Two active rows would split a workspace's
ciphertext across two DEKs with nothing recording which, and that is not a visible
failure. Two concurrent rotations meet at the index; the loser is told it lost.

**One honest limitation.** There is no scheduler. `rotate` returns as soon as the new
version is active and starts the sweep detached; `sweep` is public and awaitable for a
caller that wants to know when it finished. Nothing runs it periodically today.

**A second, and it is stated rather than implied.** The sweep's registry of secret stores
is **empty**. Q.1 ([#138](https://github.com/NobuData/ouroboros/issues/138)), K.3
([#101](https://github.com/NobuData/ouroboros/issues/101)) and Y.1
([#189](https://github.com/NobuData/ouroboros/issues/189)) are all still open and no
migration declares an encrypted column, so there is nothing in any database for a sweep to
convert, and a sweep run today honestly reports zeros. Each of those tickets registers a
store when it lands, and the same pass both re-seals what this service already sealed and
**adopts** what it never did — the one-time migration and the rotation sweep are the same
operation, so the migration is not a second implementation exercised once.

### 2.6 Deleting a workspace destroys its credentials

`tenant_keys` cascades from `organization`. Deleting a workspace destroys its DEK, and
every ciphertext that DEK sealed becomes unopenable — **including the copies in every
backup taken while it existed**, because a backup holds the rows and does not hold the
key. That is a stronger deletion guarantee than deleting rows can give.

It holds only because the key lives in one place. **The vault keeps no key cache**, and
that is a decision rather than an omission: a DEK held in a process after its row was
deleted is a window in which the shred has not happened. The visible cost is that every
encrypt and every decrypt unwraps the workspace's key — one in-memory AES operation under
the default wrapper, and a network call per operation under a future KMS wrapper. That
price is left for AF.3 ([#236](https://github.com/NobuData/ouroboros/issues/236)) to pay
deliberately, with a bounded cache it can argue about, rather than inherited from a
decision made here for a backend that did not need it.

### 2.7 What this does not protect against

Stated plainly, because a threat model that lists only what it stops is an advertisement:

- **An attacker who can read the KEK and the database reads every credential.** That is
  [§3](#3-key-custody-per-deployment-mode), and it is the whole of why custody has a
  section of its own.
- **An attacker who can execute code in the `ouroboros-rest` process** can ask the vault
  to decrypt, because that is what the vault is for. Encryption at rest defends the
  database, the backups and the replica — not the process holding the key.
- **A workspace administrator can reveal their own workspace's credentials.** That is a
  product feature ([§6.2](#62-reveal-is-privileged-audited-and-rate-limited)), bounded by
  step-up authentication and an audit trail rather than by the cryptography.
- **Plaintext in a `string` cannot be zeroized.** Buffers holding key material are
  overwritten in a `finally`; JavaScript strings are immutable and the runtime may have
  copied one anywhere. The convenience methods that take and return strings document the
  weaker guarantee rather than implying the stronger one.

---

## 3. Key custody, per deployment mode

> **Status: Mode A Shipped** (AD.1, [#222](https://github.com/NobuData/ouroboros/issues/222)).
> **Modes B and C Planned** — AF.3 ([#236](https://github.com/NobuData/ouroboros/issues/236)).

### 3.1 The question custody answers

[§2](#2-envelope-encryption) establishes that credentials are encrypted and that the key
is not in the database. Custody is the next question, and it is the one the strip's
*"KMS-backed"* glossed over: **where is the KEK, and who can read it?**

There is exactly one answer today, and it is not KMS.

### 3.2 Mode A — the environment master key (the default, and what it costs)

The KEK is read from `OURO_VAULT_MASTER_KEY` at boot: exactly 32 bytes, base64-encoded.

> **Key custody is the operator's problem in this mode.** The KEK is an environment
> variable. It is as safe as the process environment, the orchestrator's secret store
> and the deployment's logging discipline make it — and **anyone who can read all
> three can read every credential in the product.**

That is a materially different claim from "KMS-backed", and it is stated here in those
words rather than in a footnote because it is the sentence an operator needs before they
decide where to run this.

What the mode is good for is the reason it is the default: a self-hosted Ouroboros gets
real envelope encryption, per-workspace sealing and crypto-shredding **with no additional
infrastructure at all**, and upgrading custody later costs a re-wrap rather than a
migration ([§3.5](#35-upgrading-custody-is-a-re-wrap)).

Three properties of the mode worth knowing:

- **The key is validated to exactly 32 bytes, not to a minimum, and a bad value stops the
  process.** A signing key that is wrong is fixed by correcting it; a KEK that is wrong
  produces ciphertext nobody can ever open. The boot failure names the variable and prints
  no part of the value.
- **Losing this value loses every stored credential, and there is no recovery path.** That
  is what per-workspace sealing means. It belongs in whatever the deployment uses for
  disaster recovery, and it belongs there under the same handling as any other production
  secret.
- **Rotating it is a re-wrap of `tenant_keys` and rewrites no credential.** An operator
  who believes the master key has been exposed generates a new one and re-wraps; nothing
  else in the database changes.

### 3.3 Mode B — cloud KMS (AWS KMS · GCP KMS · Azure Key Vault)

> **Status: Planned** — AF.3 ([#236](https://github.com/NobuData/ouroboros/issues/236)).

The KEK never leaves the provider's HSM. `ouroboros-rest` calls the KMS to wrap and unwrap
data-encryption keys, and the material that opens them is never in the process, the
environment, or a backup.

This is what the strip's *"KMS-backed"* would mean if it were true of your deployment. It
buys custody the application cannot lose and an audit trail on the KEK itself, in the
cloud provider's own logs. It costs a hard dependency on that cloud, which is why it is a
wrapper and not the core: making it the only path would break self-hostability, which is
the product's own promise on this page.

### 3.4 Mode C — HashiCorp Vault or OpenBao

> **Status: Planned** — AF.3 ([#236](https://github.com/NobuData/ouroboros/issues/236)).

The transit engine holds the KEK; wrapping and unwrapping are Vault operations. This is
the best self-hosted equivalent of Mode B — multi-cloud portable, and OpenBao keeps it
fully open-source — at the cost of operating Vault, which is real work. Right as an
optional backend, wrong as a hard dependency.

### 3.5 Upgrading custody is a re-wrap

```mermaid
flowchart LR
    subgraph before["before"]
        T1[("tenant_keys<br/>wrapper = env-master")]
        C1[("credential ciphertext")]
    end
    subgraph after["after"]
        T2[("tenant_keys<br/>wrapper = aws-kms")]
        C2[("credential ciphertext<br/>byte-for-byte identical")]
    end
    T1 -->|"unwrap with the old KEK<br/>wrap with the new one"| T2
    C1 -->|"untouched"| C2
```

`VaultService.rewrap` rewrites `sealed_dek` and `wrapper` and nothing else. Its test
asserts that **byte-for-byte** against ciphertext that has been through PostgreSQL,
deliberately rather than by a round trip — a round-trip assertion would also pass if
everything had quietly been re-encrypted, which is the failure the property exists to
exclude.

Two consequences worth stating: the migration can run a workspace at a time rather than in
one transaction, because the `wrapper` column tells the service which rows it has already
converted; and it is safe to run twice.

### 3.6 Who can read a credential, by mode

| Can read every credential | Mode A · env master | Mode B · KMS | Mode C · Vault |
|---|:--:|:--:|:--:|
| Someone with the database only | no | no | no |
| Someone with a database backup or a replica | no | no | no |
| Someone with the deployment's environment **and** the database | **yes** | no | no |
| Someone who can call the KMS/Vault as this service **and** has the database | n/a | yes | yes |
| Someone who can execute code in the `ouroboros-rest` process | yes | yes | yes |
| A workspace admin, for their own workspace, through Reveal | yes — audited, step-up | yes — audited, step-up | yes — audited, step-up |

Only one adversary moves, and rows three and four are the two halves of that move:
upgrading custody replaces *someone who can read the environment* with *someone who can
call the KMS as this service*. Everything above and below stays where it was. That is the
honest summary of what a KMS buys — a harder secret to steal, not a different set of
people who can reach the plaintext.

---

## 4. What a worker is given

> **Status: Shipped** — AD.3 ([#224](https://github.com/NobuData/ouroboros/issues/224)),
> roadmap decision **P3**.
> [`ouroboros-rest/src/modules/internal/`](../ouroboros-rest/src/modules/internal) ·
> [`openapi.internal.yaml`](../ouroboros-rest/openapi.internal.yaml) ·
> [`control_plane/`](../ouroboros-engine/src/ouroboros_engine/control_plane)
>
> The invocation path itself is **Specified** — the route answers `501` naming AF.2
> ([#235](https://github.com/NobuData/ouroboros/issues/235)); see
> [§4.2](#42-proxied-invocation).

### 4.1 What was claimed, and what is true

The strip claims workers receive *"scoped, 15-minute tokens"*, and the page head claims
they *"only ever see short-lived tokens"*. **Neither is what happens, and the difference
is in the product's favour: no token is minted anywhere in Ouroboros, and a worker never
holds a cloud provider credential at all.**

The corrected claim is not a smaller one, so it is worth saying why the original was
worse:

- **A fifteen-minute credential is still a credential.** It genuinely reaches the worker
  process. Revocation is bounded only by its TTL — there is no way to take it back early.
  And the audit surface widens to every process that ever held one.
- **For LLM providers it is fiction.** Almost none support deriving short-lived scoped
  keys from a long-lived one. A "15-minute token" would in practice be a full API key with
  a timer bolted on by us, which is a description of a UI countdown rather than of a
  security property.

So the division is by **what a provider needs in order to be reached**:

| Provider kind | Reached by | What a worker is given |
|---|---|---|
| `anthropic`, `copilot`, `cursor` | the control plane, which holds the key for one request scope | **nothing** — a lease request is refused `403 provider_not_leasable` |
| `ollama`, `openai_compatible` | the worker, directly | a **base URL** — no key, no token — TTL-bounded and audited |

### 4.2 Proxied invocation

> **Status: Specified.** The shapes are committed and the route answers
> `501 invocation_not_implemented` naming AF.2
> ([#235](https://github.com/NobuData/ouroboros/issues/235)) — deliberately rather than
> `404`, so an executor being written against it can tell *the path is right and the other
> half is not built* from *I have the URL wrong*.

```mermaid
flowchart LR
    ENG["ouroboros-engine worker"]
    REST["ouroboros-rest<br/>POST /internal/llm/invoke"]
    V["vault: unwrap in request scope"]
    P["Anthropic · Copilot · Cursor"]

    ENG -->|"connection or alias · payload · run context<br/>no credential, because it has none"| REST
    REST --> V
    V --> P
    P -->|"NDJSON: delta · usage · hop · done"| ENG
```

A worker sends **the call it wants made** and **the run it is making it for**. It never
sends a credential, because it never has one. The control plane resolves the target,
unwraps the credential inside one request scope, walks the resolved chain, and streams
back what the provider said.

Three properties of the contract that are security properties rather than ergonomics:

- **A worker cannot choose a routing chain.** The target is a connection or an alias,
  never a resolution. A worker that could send a resolution could send a different chain
  than the one routing chose.
- **The payload is opaque and is never parsed.** This service brokers the call; it does
  not read the prompt. It is also the field most likely to carry a customer's data, and a
  control plane that parsed it would be a control plane that could log it.
- **The answer is always a stream**, never sometimes one — because two response shapes
  would be two code paths, and the non-streaming one would be the one that quietly stopped
  emitting usage.

### 4.3 The one exception, and why it is not one

An engine worker calling an Ollama daemon **on the same box** gains nothing from proxying
its traffic through the control plane, because there is no key on that path to protect. So
it is told the address, and nothing else:

```console
$ curl -s -X POST localhost:4000/internal/credentials/lease \
    -H "X-Ouro-Internal-Key: $OURO_ENGINE_SHARED_SECRET" \
    -H 'Content-Type: application/json' \
    -d '{"provider":"ollama","run":"4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94"}'
{"id":"7c9e…","provider":"ollama","run":"4d2a…","organizationId":"aBcD…",
 "baseUrl":"http://localhost:11434","grantedAt":"…","expiresAt":"…","ttlSeconds":900}

$ curl -s -X POST localhost:4000/internal/credentials/lease … -d '{"provider":"anthropic",…}'
{"code":"provider_not_leasable","message":"This provider is reached through the invocation
 proxy; its credentials never leave the control plane. …","details":{"provider":"anthropic"}}
```

**No secret can be returned, structurally.** Every field of that answer is an identifier,
an address or a timestamp. A field that could carry key material would have to be added to
the interface, and `no-secret-responses.mjs` — a lint rule over the whole internal surface
— refuses a field named for credential material in anything it returns, in a declared
shape or a returned literal. *No secret in the payload* is therefore a property of the
type rather than of a test that happens to look.

**The scope is a run, and the run is real.** The workspace a grant is attributed to is
resolved *from* the run, never taken from the request — a worker naming its own workspace
would be a worker choosing which workspace to be audited against. A run that does not
exist is a `404`.

**`openai_compatible` is leasable, with a caveat.** The same adapter fronts a vLLM on
somebody's own GPU *and* `api.openai.com`, so local-ness is a property of the connection
rather than of the kind — which is why a lease for it still fails unless the deployment
has declared an address for it in `OURO_LOCAL_PROVIDER_URLS`. Y.1
([#189](https://github.com/NobuData/ouroboros/issues/189)) replaces that variable with a
row.

### 4.4 The policy is enforced twice, and both halves are needed

- **`lease.ts` refuses a cloud kind before it consults configuration or the database**, so
  no state and no configuration can produce a grant.
- **`configuration.ts` refuses to start a process** whose `OURO_LOCAL_PROVIDER_URLS` names
  one, so an operator cannot configure their way past the first check.

A policy that lived only in the service could be walked around by an operator; one that
lived only in configuration would miss a kind added to that variable by a later ticket.
Both halves are tested per cloud adapter kind rather than on a representative one.

### 4.5 A lease is not a bearer token

Nothing stores a lease and there is no way to revoke one, because there is nothing to
revoke: holding it grants nothing that knowing the address would not. **What the fifteen
minutes bound is staleness, not exposure** — how long a worker should keep believing the
answer before asking again, which starts to matter when Y.1's connections arrive and an
address can change under a long-running run.

Calling that a security control would be theatre, and this document exists to keep that
kind of claim out of the product.

### 4.6 How the internal surface authenticates

Every route on it requires `X-Ouro-Internal-Key` carrying `OURO_ENGINE_SHARED_SECRET` —
the same header and variable `ouroboros-rest` sends when *it* calls the engine
([#51](https://github.com/NobuData/ouroboros/issues/51)). The comparison is constant time
over digests, a missing header takes the same path as a wrong one, and the rejection is
one constant body. **A session cookie is not accepted here, whoever it belongs to**: a
test enumerates all three categories of route — *needs a session*, *needs nothing*, *needs
the key* — and asserts each one in both directions.

These paths sit outside `/api` and are unversioned, because `/api` is the browser's
boundary: CORS-configured, session-authenticated and published in the document
`ouroboros-ui` generates a client from. The only caller of these two is deployed alongside
this service and upgraded with it.

---

## 5. What is written down when somebody touches a key

> **Status: Specified** — AD.4 ([#225](https://github.com/NobuData/ouroboros/issues/225)),
> roadmap decision **P5**, coordinating with
> [#26](https://github.com/NobuData/ouroboros/issues/26)'s `audit_events` shape.
> One event, `credential.lease_granted`, is **Shipped** with an interim sink — see
> [§5.4](#54-where-the-events-go-today).

### 5.1 What is recorded

Every credential operation writes exactly one event, carrying the actor, the connection,
the source IP and a detail object:

```
provider.added        provider.revealed     provider.rotated
provider.enabled      provider.disabled     provider.cap_changed
provider.deleted      provider.tested       credential.lease_granted
```

Key custody without a trail would fail the page's own security posture, which is why this
is day-one scope rather than a later hardening ticket.

### 5.2 No event carries secret material

This is the guarantee that makes an audit trail safe to keep, and it is held by three
things rather than by review:

- **`no-secret-logging.mjs`** — a lint rule, tested through ESLint's own `RuleTester`,
  that fails the build on an identifier naming secret material inside a call to a log
  sink.
- **`no-secret-responses.mjs`** — the same discipline over what the internal surface
  returns. Its word list differs from the logging rule's on exactly two entries, and the
  difference is argued in the file: `key` is denied there and not here, and `token` is
  denied while `tokens` is not — in this product the plural is a unit of text
  (`inputTokens`, `token_usage`) and the singular is a credential.
- **`redaction.spec.ts`** — a suite that captures every log sink while driving the vault
  through every operation and every failure path.

On the lease path there is a fourth reason, which is the strongest: there is **no secret
on that path at all** ([§4.3](#43-the-one-exception-and-why-it-is-not-one)).

### 5.3 Append-only

The trail is append-only by grant posture — the application role may insert and select,
and may not update or delete. An audit trail the audited party can edit is not one.

### 5.4 Where the events go today

**`credential.lease_granted` is real and its sink is interim.** The record is assembled at
the one point a grant is known to have happened and emitted to the service log — a
durable, timestamped, in-cluster record carrying every field the eventual row will carry.
AD.4 has not landed, so there is no `audit_events` table to insert into. When #225 lands,
one method body becomes an insert and every caller, every field and the event's name stay
as they are.

That is said here rather than glossed because "every operation is audited" and "every
operation is audited into a queryable table" are different claims, and only the first is
true today.

---

## 6. Threat notes

### 6.1 SSRF: private ranges are deliberately allowed

> **Status: Shipped** for AC.3 ([#218](https://github.com/NobuData/ouroboros/issues/218)) and
> AC.4 ([#219](https://github.com/NobuData/ouroboros/issues/219)) —
> `ouroboros-rest/src/modules/providers/provider.address.ts`, tested by
> `provider.address.spec.ts` and, from the outside, by
> `adapters/openai-compatible.adapter.spec.ts` and `adapters/ollama.adapter.spec.ts`. Both
> adapters share the one module rather than each holding a copy, and each suite asserts the
> four rules against its own card's addresses — including the deliberate allow, so a reflexive
> private-range check added later is a red test rather than a support ticket. The same policy
> already governs `OURO_LOCAL_PROVIDER_URLS`, which is **Shipped**.

Two provider adapters take an address from the user: the OpenAI-compatible adapter takes a
`base_url` and the Ollama adapter takes a `host`. The reflexive security rule for
user-supplied URLs is to reject private address ranges, and **Ouroboros deliberately does
not apply it here.**

The reason is that the rule and the feature are the same thing. These two adapters exist
to reach a model server the customer runs themselves — a vLLM on `10.0.4.20:8000`, an
Ollama on `localhost:11434`. An adapter that refused RFC-1918 would be an adapter that
could not do the only job it has. "Self-hosted models" and "no private addresses" cannot
both be true, and the product's answer is stated rather than left to a surprising
rejection at connect time.

What is enforced instead:

- **A scheme allow-list.** `http` and `https` and nothing else — no `file:`, `gopher:`,
  `ftp:`, or anything else a URL parser will accept. `resolveProviderAddress` is the one
  door; an adapter must not `fetch` a configured address it did not receive back from it.
- **No redirect following.** A redirect is the mechanism by which an allowed address
  becomes a disallowed one after the check has passed, so the check is not asked to be
  clever; the redirect is simply not followed. Every request sets `redirect: "manual"`,
  which makes a `3xx` an ordinary refusal classified as the connection's own settings —
  and the `Location` it carried is never printed, because that would report where an
  endpoint tried to steer the service.
- **A response size cap.** One mebibyte, counted as the bytes arrive rather than trusted
  from a `content-length`. A `GET` against a stranger's endpoint that answers with a
  hundred megabytes is a denial of service on the control plane.
- **No credential in the address.** A `http://key:secret@host/v1` is refused, because
  `provider_connections.config` is the one column designed to be readable and the sealed
  one is `credentials_encrypted`. The supported way to supply a key is the schema's
  `x-ouroboros-secret` field.
- **Kind scoping.** Only these two adapter kinds accept an operator-supplied address at
  all. Cloud adapters have fixed hosts and no address field to point anywhere — as of AC.5
  ([#220](https://github.com/NobuData/ouroboros/issues/220)) that is all three of them:
  `anthropic` builds every URL from its own constant, and `copilot` and `cursor` do the same
  against `api.github.com` and `api.cursor.com`. The one operator-supplied value either of
  those interpolates is Copilot's billing organization, and it is a GitHub login re-checked
  against a strict pattern server-side — not just in the schema — and URL-encoded on the way
  into the path.
- **Role scoping.** Configuring a connection is an owner/admin action, not a member one.
- **Response bodies are not echoed.** A test connection reports a status code and a
  latency; a discovery call parses a model list into a known shape. Neither returns the
  response body to the caller, which is what turns a reachability probe into a
  data-exfiltration primitive.

**What remains, said plainly:** a workspace administrator can point their own deployment
at an internal address and learn whether something answers there. That is a capability an
administrator of a self-hosted service already has by other means, and the boundary this
policy defends is *who may configure a connection*, not *which addresses exist*. A
deployment that needs a harder boundary should place `ouroboros-rest` on a network segment
that cannot reach what it must not reach — which is a control the network can enforce and
an allow-list in an application cannot.

The shipped instance of the same policy is `OURO_LOCAL_PROVIDER_URLS`: a map of provider
kind to base URL, validated at boot, refusing any kind that is not leasable
([§4.4](#44-the-policy-is-enforced-twice-and-both-halves-are-needed)). It holds no secret
— every value is an address.

### 6.2 Reveal is privileged, audited and rate-limited

> **Status: Specified** — AD.2 ([#223](https://github.com/NobuData/ouroboros/issues/223)),
> roadmap decision **P4**.

The key row on the Providers page shows a masked suffix — `••••Xq4A` — and offers a
**Reveal** button. The masking is server-computed: **no list payload ever contains secret
material**, so "masked" is a property of the response rather than of the input element
rendering it, and a contract test greps for it.

Reveal itself is deliberately expensive:

- **Step-up re-authentication.** A live session is not sufficient; the actor
  re-authenticates immediately before the value is returned. Without it the request is a
  `401` challenge, not a refusal.
- **Owner/admin only.** A member session sees none of these affordances, and the API
  agrees with the UI rather than relying on it.
- **Audited.** `provider.revealed` records who, which connection, from where, and when.
- **Rate-limited.** Repeated reveal attempts are throttled, because the affordance's
  failure mode is not one dramatic breach but a slow enumeration.
- **Time-boxed in the UI.** The revealed value auto-masks on a timer and on navigation,
  and the interface makes no claim about the clipboard, because it cannot keep one.

**There is no route that decrypts a credential anywhere else.** The vault module declares
no controller at all: a route that decrypted a credential would be a route that returned
one, and which of those exist is AD.2's decision, behind exactly this step-up.

### 6.3 Rotation: verify before retire

> **Status: Specified** — AD.2 ([#223](https://github.com/NobuData/ouroboros/issues/223)).

Two different things in this document are called rotation, and conflating them is the
easiest mistake to make here:

| | What rotates | Status |
|---|---|---|
| **Credential rotation** | the provider's API key, replaced by the customer | Specified — AD.2 |
| **DEK rotation** | the workspace's data-encryption key ([§2.5](#25-rotating-a-key-is-additive)) | Shipped — AD.1 |
| **KEK re-wrap** | where the key-encryption key lives ([§3.5](#35-upgrading-custody-is-a-re-wrap)) | Shipped — AD.1 |

Credential rotation is **verify-then-retire**, and the ordering is the whole of it: the
new secret is validated against the provider with a live call, and only then does it
replace the old one atomically. **A failed validation leaves the old key active** — the
error explains what happened and the connection keeps working. The opposite ordering would
make a typo an outage, and a rotation flow that can cause an outage is a rotation flow
nobody runs.

The same ordering governs adding a connection: a secret is **validated before it is
persisted**, so a bad key is never stored silently.

Deleting a connection is blocked while routing aliases depend on it — a `409` naming them
rather than a cascade that silently breaks a routing chain.

### 6.4 Secrets and logs

Decrypted material lives only in request scope. Buffers are zeroized best-effort in a
`finally`; strings cannot be ([§2.7](#27-what-this-does-not-protect-against)). That none
of it reaches a log is held by the lint rules and the redaction suite in
[§5.2](#52-no-event-carries-secret-material), not by reviewer vigilance.

### 6.5 The browser boundary

> **Status: Shipped** — [#31](https://github.com/NobuData/ouroboros/issues/31),
> [#32](https://github.com/NobuData/ouroboros/issues/32).

`/api` is CORS-configured against an explicit origin list — a wildcard is not accepted,
because a credentialed cross-origin request may not be answered with one — and
session-authenticated. Every credential operation runs under a resolved workspace context,
and the guard's refusals are shaped to leak nothing:

- **A workspace you are not a member of and a workspace that does not exist are the
  same `404`** — same code, same message, same details. A `403` would confirm that an
  identifier names something real, which is the whole of what somebody enumerating
  identifiers is trying to learn.
- **The one `403` is a role that is too low**, and only after the caller has already
  proved the workspace is no secret from them. Credential operations declare
  owner-or-admin; a member session is refused by the API and not merely by a hidden
  button.

---

## 7. Approved copy, and the badge policy

> **Status: Shipped as copy** — this section is the source AE.6
> ([#232](https://github.com/NobuData/ouroboros/issues/232)) and AE.1
> ([#227](https://github.com/NobuData/ouroboros/issues/227)) render **verbatim**. A change
> here is a change to the product's claims and is reviewed as one.

### 7.1 The security strip

Rendered by AE.6 ([#232](https://github.com/NobuData/ouroboros/issues/232)) in the `c-12`
strip. The shield glyph `◈` is unchanged.

The blocks below are wrapped to this document's line width; **the line breaks in them are
not part of the string.** Each is one paragraph.

**Copy — one paragraph, verbatim:**

```text
Keys are sealed per-tenant with envelope encryption (AES-256-GCM). Workers never see your
keys — every provider call is made by the control plane, and your keys never leave your
deployment.
```

`envelope encryption` is the only emphasised span, as in the mockup.

**Tag row — exactly one tag, verbatim:**

```text
self-hosted
```

**Link, verbatim:** `Read the security model ↗`, targeting this document at
`https://github.com/NobuData/ouroboros/blob/main/docs/SECURITY_MODEL.md` — or
whatever path a deployment serves it from, if it serves its own copy. The label
keeps its trailing `↗` because the destination leaves the application.

Each clause traces: *sealed per-tenant* →
[§2.3](#23-the-binding-is-what-makes-per-tenant-mean-anything); *envelope encryption
(AES-256-GCM)* → [§2](#2-envelope-encryption); *workers never see your keys* →
[§4](#4-what-a-worker-is-given); *every provider call is made by the control plane* →
[§4.2](#42-proxied-invocation); *your keys never leave your deployment* →
[§3](#3-key-custody-per-deployment-mode).

**What was removed and why:** `KMS-backed`, because
[§3.2](#32-mode-a--the-environment-master-key-the-default-and-what-it-costs) is what the
default deployment actually has; `scoped, 15-minute tokens`, because
[§4.1](#41-what-was-claimed-and-what-is-true) is stronger and true; and both compliance
badges, per [§7.3](#73-the-badge-policy).

**When AF.3 lands**, a deployment configured with a KMS or Vault wrapper may append one
sentence, and only that deployment may:

```text
This deployment's keys are held in <KMS name>.
```

Rendered from the configured wrapper's identity, never from a setting an operator can
type, and rendered as nothing at all under the environment-master wrapper. Silence is the
honest default; a euphemism is not.

### 7.2 The page-head subline

Rendered by AE.1 ([#227](https://github.com/NobuData/ouroboros/issues/227)).

**Verbatim, with `{workspace}` substituted for the workspace's display name:**

```text
Credentials live in {workspace}'s encrypted vault, scoped to this workspace. Keys never
leave the control plane — workers never receive them at all.
```

Two deliberate departures from the mockup. *"workers only ever see short-lived tokens"*
becomes *"workers never receive them at all"*, per
[§4.1](#41-what-was-claimed-and-what-is-true). And *"tenant"* becomes *"workspace"*,
because that is the word the rest of the product uses to a user — `tenant` is an internal
term and appears in no other user-facing string.

### 7.3 The badge policy

`SOC 2 Type II` and `ISO 27001` are **certifications, not features**. Displaying one
before an audit has happened is a false compliance claim — a materially different kind of
wrong from an optimistic UI label, because it is the sort of statement a customer's own
procurement process relies on. They are removed.

The rule that replaces them, and that governs any badge added later:

1. **A certification badge renders only when the certification exists** — an audit
   completed by a named auditor, with a report available on request.
2. **It carries its date.** `SOC 2 Type II · 2027-03` and not `SOC 2 Type II`, because
   these lapse, and a badge without a date cannot be read as stale.
3. **It comes down when it lapses**, by the same rule that put it up.
4. **It is never rendered from a configuration flag.** A badge an operator can switch on
   is a badge that says nothing about whether the audit happened.
5. **Until then the slot renders nothing.** Not a "certification in progress" placeholder,
   which is a compliance claim wearing a hedge.

What the product *has* earned is the framing that replaces them: **self-hosted — your keys
never leave your deployment.** That one is true of every installation today, and
[§3](#3-key-custody-per-deployment-mode) is where a reader can check it.

---

## 8. Not covered yet

Later roadmaps have filed four additions against this document — three amendment comments
on [#226](https://github.com/NobuData/ouroboros/issues/226), carrying four items between
them. Each is **Planned**; each becomes a section of its own when the work it describes
lands. They are listed rather than written up as though they were true, which is the same
rule the rest of this document follows.

| Coming | From | What this document will gain |
|---|---|---|
| **The build-farm CA** | AH.2 ([#250](https://github.com/NobuData/ouroboros/issues/250)), roadmap decision **B3** | The farm CA's private key is sealed by the vault exactly as a credential is. The enrollment chain — scoped, TTL'd, use-limited token → registration → signed per-runner certificate → mTLS thereafter, with renewal over the already-authenticated channel. Revocation checked at the gateway handshake rather than merely recorded. **The deployment requirement that silently breaks mTLS**: a reverse proxy terminating TLS must pass the client certificate through, and if it does not the connection still succeeds as ordinary TLS with the security property lost and nothing failing visibly. And the bearer fallback for proxies that strip client certificates — gated by an org setting, recorded in `security_mode`, and surfaced in the runners table so a degraded runner is visible rather than quietly weaker. |
| **Crypto-shredding as the deletion guarantee** | BR.5 ([#489](https://github.com/NobuData/ouroboros/issues/489)) | Workspace deletion — typed confirmation and step-up, then `pending_delete`, then a 30-day recovery window, then a scheduled purge that deletes tenant data across planes **and destroys the tenant DEK**. That last clause is what makes residual ciphertext in backups permanently unreadable; row deletion alone cannot reach a backup. [§2.6](#26-deleting-a-workspace-destroys-its-credentials) is the mechanism, and #489 is the lifecycle that invokes it. |
| **Deployment truth in Settings** | BQ.4 ([#483](https://github.com/NobuData/ouroboros/issues/483)), roadmap decision **S6** | The settings page renders what is true of *this* deployment: a self-hosted install shows its region read-only rather than offering a chooser it cannot honour, and states plainly that this deployment never trains on your data. The residency documentation that card links to is this document. |
| **Analyzer tenant locality** | BV.1 ([#510](https://github.com/NobuData/ouroboros/issues/510)), BV.2 ([#511](https://github.com/NobuData/ouroboros/issues/511)) | The Build Analyzer's claim that nothing leaves the tenant: corpus assembly dispatches to the tenant's own engine, and analyzer code cannot reach the network — enforced by the execution harness, not by convention. When the v2 LLM synthesis pass ([#522](https://github.com/NobuData/ouroboros/issues/522)) is enabled, data *does* reach the configured provider, so both this document and the page must say so, and a tenant that has not enabled it keeps the stronger claim. |

---

## 9. Changing this document

The rule that makes [§1](#1-every-claim-in-the-strip-traced) worth keeping:

**A security claim ships only after it appears here.** New copy on a security surface is a
change to this document first and a change to a component second, and the component
renders what this document says rather than paraphrasing it. A claim that cannot be
written down with a section behind it is a claim the product is not entitled to make.

Two corollaries:

- **When a section moves from Specified to Shipped**, its status line changes and the code
  that holds it is named. When something is descoped, the section says so rather than
  quietly disappearing.
- **When something turns out to be weaker than described**, the description changes. That
  is what happened to *"KMS-backed"* and to *"15-minute tokens"*, and it is the reason
  this document exists rather than a page of assurances.

## Related

- [`ROADMAP_MOCKUP_07_PROVIDERS_KEYS.md`](ROADMAP_MOCKUP_07_PROVIDERS_KEYS.md) — decisions
  **P2**–**P5**, the researched options behind each, and the issue breakdown
- [`ouroboros-rest/README.md § The vault`](../ouroboros-rest/README.md#the-vault) — the
  implementation's own account of the cryptography
- [`ouroboros-rest/README.md § The internal surface`](../ouroboros-rest/README.md#the-internal-surface)
  — the two paths a worker calls
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — module contracts, request paths and the `OURO_*`
  registry
- [`.env.example`](../.env.example) — `OURO_VAULT_MASTER_KEY`, `OURO_LOCAL_PROVIDER_URLS`
  and `OURO_ENGINE_SHARED_SECRET`, each with its handling note
