# Ticket sources — writing a `TicketSourceProvider`

> **Status:** the SPI, the registry and the sync loop shipped with
> [Q.2 (#139)](https://github.com/NobuData/ouroboros/issues/139), and
> [Q.3 (#140)](https://github.com/NobuData/ouroboros/issues/140) registered the **first
> provider**: `github`, in
> [`ticket-sources/providers/`](../ouroboros-rest/src/modules/ticket-sources/providers/). It is
> the worked example for everything below — where a section describes a decision, that provider
> is where you can read the decision being made.
> [Q.4 (#141)](https://github.com/NobuData/ouroboros/issues/141) added the **management API**
> — `/api/v1/sources`, in `sources.*.ts` beside the loop — and the settings surface that
> draws a provider's form from its own `configSchema()`.
> [Q.5 (#142)](https://github.com/NobuData/ouroboros/issues/142) added the **conformance kit**,
> [`conformance.fixture.ts`](../ouroboros-rest/src/modules/ticket-sources/conformance.fixture.ts),
> and the in-memory provider that passes it beside GitHub's — see §8, *The conformance kit*.
> Everything below is true of the code as it stands; where a section describes something a
> later ticket adds, it says so.

Ouroboros ingests tickets from a tracker. Which tracker is a plug-in decision — roadmap
decision **P5** — and this document is the contract that decision rests on. If you can
implement the interface in
[`ouroboros-rest/src/modules/ticket-sources/ticket-source.provider.ts`](../ouroboros-rest/src/modules/ticket-sources/ticket-source.provider.ts),
your tracker's tickets appear in the intake screen, get estimated, and trigger workflows,
without a line of code changing anywhere else.

That last clause is the whole point, and it is the reason this file exists: the SPI is only
worth having if somebody outside this codebase can implement it.

---

## 1. The shape of the thing

```
                     ┌──────────────────────────────────────────────┐
   scheduler ───────▶│  TicketSourcesService — the sync loop        │
   (jittered)        │  zero provider-specific branches, enforced   │
                     │  by .dependency-cruiser.cjs                  │
                     └───────┬──────────────────────────────────────┘
                             │  registry.find(source.kind)
                     ┌───────▼──────────────────────────────────────┐
                     │  TicketSourceRegistry — providers by kind    │
                     └───────┬──────────────────────────────────────┘
                             │
   ┌─────────────────────────┼─────────────────────────┐
   ▼                         ▼                         ▼
 GithubProvider        JiraProvider              your provider
 (Q.3, #140)           (T.2, #156)               (kind: "custom")
   │                         │                         │
   └──────────── CanonicalTicket[] ────────────────────┘
                             │
                     ┌───────▼──────────────────────────────────────┐
                     │  upsert into `tickets` (V030)                │
                     │  stamp `ticket_sources` (V030 + V031)        │
                     │  hand new/reopened rows to estimation        │
                     └──────────────────────────────────────────────┘
```

Two database tables underpin it, both created by
[`V030__canonical_tickets.sql`](../ouroboros-db/migrations/V030__canonical_tickets.sql):

| table | what it holds |
|---|---|
| `ticket_sources` | one row per configured tracker per workspace: `kind`, `display_name`, `config`, a sealed credential, `status`, `status_reason` (V031), `sync_cursor`, `synced_at` |
| `tickets` | the canonical intake row — one per ticket per source, with **no** repository, **no** issue number and **no** `gh_` prefix |

Read paths select `ticket_sources_public`, which is every column except the sealed credential.
The view is the mechanism, not a convention: the secret is *absent* rather than merely
unselected.

---

## 2. The interface

```ts
interface TicketSourceProvider {
  readonly kind: TicketSourceKind;

  capabilities(): TicketSourceCapabilities;
  configSchema(): TicketSourceConfigSchema;

  validateConfig(config: unknown, credentials: string | null): Promise<TicketSourceValidation>;

  fullSync(context: TicketSyncContext): Promise<TicketPage>;
  incrementalSync(context: TicketSyncContext, cursor: string): Promise<TicketPage>;

  mapTicket(raw: unknown): CanonicalTicket;
}

interface WebhookCapableProvider extends TicketSourceProvider {
  capabilities(): TicketSourceCapabilities & { readonly webhooks: true };
  webhookHandler(payload: unknown, signature: string | null): Promise<WebhookOutcome>;
}
```

### `kind`

One of the five values `ticket_sources_kind` accepts: `github`, `gitlab`, `jira`, `linear`,
`custom`. It is how the registry finds you, and it is the same spelling the column stores, so a
row and a provider agree about what they are describing without either translating.

**A provider written outside this repository registers as `custom`.** That value is in the
CHECK from the start precisely so the first such provider needs no migration before it can
store a row.

### `capabilities()`

Three flags and a write declaration, all required. `false` is an answer; a partial record would
let a capability be *unmentioned*, and every consumer would then have to decide what an absent
flag means.

| flag | what it says |
|---|---|
| `webhooks` | whether you implement `WebhookCapableProvider`. The registry checks this against the member at boot, in both directions. |
| `labels` | whether the concept of a label exists at your tracker at all — **not** whether a given ticket has any. It is the difference between an empty chip-set because nothing matched and one because there is nothing to match. |
| `bidirectionalWrites` | whether you implement `WriteCapableProvider`. Always equal to `write.createTicket`; the registry refuses a disagreement at boot. |
| `write` | which writes — `{ createTicket, nativeDependencies, epicMapping, milestones }`. A read-only provider answers `READ_ONLY_WRITE_CAPABILITIES`. See [§ 7a](#7a-writing-back-optional). |

They must be **stable**: two calls answer equal values. A capability that changed between two
renders would show an affordance that then failed.

### `configSchema()`

The settings your provider takes, **as a form** (Q.4). `GET /api/v1/sources/catalog` turns it
into an ordered list of fields, and the settings surface draws that list without knowing which
tracker it is drawing — which is the whole reason the member exists: the acceptance criterion
is *"no hardcoded GitHub form"*, and the proof is that the same form component, pointed at the
test fixture's schema, draws the fixture's form.

The dialect is
[`ticket-source.config.ts`](../ouroboros-rest/src/modules/ticket-sources/ticket-source.config.ts):
the flat object of string fields `providers/provider.config.ts` settled on for model providers
— `text`, `select` (an `enum`), `secret` (the `x-ouroboros-secret` annotation), `minLength`,
`maxLength`, `pattern`, `default` — plus **one addition**, a list of strings, because a tracker
source is scoped to repositories or projects and a model provider never was:

```ts
configSchema(): TicketSourceConfigSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      site:     { type: "string", format: "uri", title: "Site" },
      project:  { type: "string", pattern: "^[A-Z][A-Z0-9]*$", title: "Project key" },
      boards:   { type: "array", items: { type: "string", maxLength: 32 }, minItems: 1, title: "Boards" },
      apiToken: { type: "string", minLength: 8, "x-ouroboros-secret": true, title: "API token" },
    },
    required: ["site", "project", "boards", "apiToken"],
  };
}
```

A list's `minLength`, `maxLength` and `pattern` describe **each entry**; `minItems` and
`maxItems` bound the list. The surface draws it as one entry per line.

Three rules:

* **Exactly one field is the secret**, and it is your credential. It is submitted with the rest
  on `POST /api/v1/sources` and split off for the vault before anything is stored; what lands
  in `config` — and what `validateConfig` and `TicketSyncContext.config` read — is everything
  else. A provider that takes no credential declares no secret field, and
  `POST …/credentials` answers `409 ticket_source_credentials_unsupported` for it.
* **It must be stable.** The registry judges it once, at boot, and refuses a provider whose
  schema is outside the dialect — a keyword the form cannot draw, a `required` naming no
  property, a list whose items are not strings — with the same error class it uses for a
  capabilities mismatch.
* **A submission is checked against it before you are asked anything.** A `POST` or `PATCH`
  whose settings violate the schema is `422 ticket_source_config_invalid`, with a sentence per
  field under `details.fields`, and `validateConfig` is not called. Your validation is about
  the tracker; the schema's is about the form.

### `validateConfig(config, credentials)`

The **Test connection** button (Q.4). It takes loose parts rather than a context because the
SPI lets it run before a row exists; what `POST /api/v1/sources/{id}/test` actually hands it
is a stored row's settings and its opened credential, and it writes nothing back — `status` and
`status_reason` are the loop's to set, and a probe pressed while the tracker was down must not
stop the loop polling.

It **never rejects for anything a tracker did**. A refusal, a timeout, a closed socket and a
nonsense body are all *results*:

```ts
type TicketSourceValidation =
  | { status: "ok"; detail: string }
  | { status: "failed"; errorClass: TicketSourceErrorClass; detail: string };
```

Make `detail` say something. `4 repositories` or `PROJ · 212 issues` tells somebody they
configured the thing they meant to; a bare tick cannot say they pointed it at the wrong
project.

**`detail` must never contain the credential.** The shortest path to a leaked token is a
provider that echoes a tracker's error body, and tracker error bodies quote request headers.

### `fullSync(context)` and `incrementalSync(context, cursor)`

The difference is **one thing**: whether a cursor is stored.

```ts
source.cursor === null
  ? provider.fullSync(context)
  : provider.incrementalSync(context, source.cursor);
```

That is the entire dispatch. The loop has no other opinion about which call to make, and the
column is nullable for exactly this reason.

Both answer a page:

```ts
interface TicketPage {
  readonly tickets: readonly CanonicalTicket[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}
```

Both throw `TicketSourceError` when the tracker could not be asked or refused — see §4.

**What `fullSync` should return.** Not necessarily every ticket your tracker holds. A provider
is entitled to decide that a backlog means *open tickets*, and a cold import that dragged in a
decade of closed issues is a first sync nobody wants.

**What `incrementalSync` must return.** Tickets that *left* the open set, where the canonical
model can express the departure. A close is a `state` change, not an absence; a ticket that
simply stops being listed sits in the mirror as open forever.

### `mapTicket(raw)`

Your tracker's payload → a `CanonicalTicket`. A member of the SPI rather than a private helper,
because it is the half of a provider a recorded fixture can exercise with no network at all —
and Q.5's conformance kit asserts mapping completeness through it.

Throw `TicketSourceError("upstream", …)` when a payload cannot be represented. A half-filled
row is worse than none: V030 refuses most of them at the column, and one that made it through
would be a ticket rendered with your placeholder in it.

---

## 3. The canonical ticket

```ts
interface CanonicalTicket {
  readonly externalId: string;
  readonly externalKey: string;
  readonly externalUrl: string;
  readonly title: string;
  readonly body: string | null;
  readonly state: "open" | "closed";
  readonly labels: readonly string[];
  readonly author: string | null;
  readonly sourceCreatedAt: Date;
  readonly sourceUpdatedAt: Date;
  readonly meta: Readonly<Record<string, unknown>>;
}
```

### `externalId` and `externalKey` are two fields, and this is the part people get wrong

`externalId` is **identity**: what the upsert keys on, what your API takes, and what must be
stable for the life of the ticket. `externalKey` is the **display form**: what a table cell, a
panel heading and a search box render.

| tracker | `externalId` | `externalKey` |
|---|---|---|
| GitHub | `485` | `#485` |
| Jira | `10042` (the issue id) | `PROJ-142` |
| Linear | a uuid | `ENG-123` |
| GitLab | the project-scoped iid | `#42` |

GitHub is the case that *hides* the distinction, because `485` and `#485` differ by one
character. Everywhere else they come apart, and a single column would have had to be either
the thing the API takes or the thing a person reads.

Where your tracker offers both a mutable key and an immutable id — Jira and Linear both do —
**`externalId` is the immutable one.** A value that changes when a ticket is moved between
projects imports the same ticket twice and leaves the first copy behind forever.

### `state` has two values, and collapsing onto them is your job

Jira's workflow states and Linear's are richer than two. A wider vocabulary here would be a
filter whose options changed depending on which tracker a workspace happens to use, so the
mapping decision is pushed to you rather than to the person reading the screen.

### `meta` is where everything else goes

Namespace it by your own kind — `{ "github": { "repo_id": … } }`, `{ "jira": { "project_key":
"PROJ" } }`. Nothing enforces that (V030 checks only that it is an object) and the convention
is what keeps a later per-kind filter from colliding with another provider's key of the same
name. It is indexed with GIN, so a containment query over it is an index scan.

### `null` means *the tracker did not say*

Never `""`, never a placeholder. A ticket opened with no description and one whose description
is the empty string are different facts, and only one of them is possible. The same for
`author`: a deleted account comes back with no user at all, and the panel renders that as no
attribution rather than as a name nobody holds.

### What the schema will refuse

The loop writes straight into V030's columns, so these are your constraints too:

| rule | constraint |
|---|---|
| `externalUrl` is `https://` with a host, ≤ 2048 characters | `tickets_external_url_https` |
| `externalId` non-blank, ≤ 255; `externalKey` non-blank, ≤ 128 | `tickets_external_id_present`, `tickets_external_key_present` |
| `title` non-blank, ≤ 512; `body` ≤ 262 144 | `tickets_title_present`, `tickets_body_bounded` |
| `author` non-blank when present, ≤ 255 — **no login grammar** | `tickets_author_present` |
| at most 100 labels, each ≤ 255 characters | `tickets_labels_shape` |
| `sourceUpdatedAt >= sourceCreatedAt` | `tickets_updated_after_created` |

The URL rule is a safety rule rather than a tidy one: an `href` is a place a scheme like
`javascript:` executes rather than navigates, and a provider is an HTTP client parsing somebody
else's JSON.

---

## 4. Failing

Four words for a read, two more for a write, and nothing else:

```ts
type TicketSourceErrorClass =
  | "auth" | "rate_limit" | "not_found" | "upstream"   // a read — and a write
  | "permission" | "validation";                      // a write only (AL.2, #278)
```

| class | what it means | `status` | what the person reads |
|---|---|---|---|
| `auth` | the credential was understood and refused | `error` | `credentials rejected (401)` |
| `rate_limit` | working, and refusing anyway | `error` | `rate limited until 14:20 UTC` |
| `not_found` | the project, repository or site is not there — or the credential cannot see it | `error` | `project or repository not found` |
| `upstream` | the tracker answered with its own failure, or did not answer | `error` | `tracker unavailable (503)` |
| `permission` | *write only* — a valid credential without the scope to write | `error` | `permission denied (403)` |
| `validation` | *write only* — the tracker refused a write's content | `error` | `tracker rejected the write (422)` |

Throw one:

```ts
throw new TicketSourceError(
  "rate_limit",
  "429 with Retry-After: 900",   // your words, for the log
  new Date(resetAt * 1000),      // when the window lifts, or null
  429,                           // the status, or null
);
```

`detail` is yours and reaches the **log**. What reaches the **column** a settings page renders
is composed from the class by `statusReasonFor`, so the four classes read the same whichever
tracker produced them — and so a `detail` that quoted a request header cannot end up on a
screen. That is a property of the function, not of your care.

`retryAt` is the one piece of provider knowledge that reaches a person unchanged, because there
is no neutral way to say *when* and no reason to hide it.

**Two classes deliberately do not exist.** There is no `network` — a tracker you cannot reach
is `upstream`, because every tracker in this set is somebody else's service across the internet
and *"we could not reach it"* and *"it answered 503"* are the same sentence to the reader. And
there is no `config` — a base URL pointing at a web page produces the same `404` as a mistyped
project key, and the row cannot tell them apart. What can is `validateConfig`, which runs while
somebody is looking at the form.

`classifyHttpStatus(status)` maps a refusal onto a class, so you do not write that `switch`
again. Override the one status your tracker reads differently and call it for the rest. A write
uses `classifyWriteHttpStatus(status)` instead, which differs in exactly two places: `403` is
`permission` rather than `auth`, and a content-refusing `4xx` (`400`, `409`, `422`, …) is
`validation` rather than `not_found`.

---

## 5. Cursors

**The loop stores what you return and never interprets it.** GitHub's is a `since` timestamp,
GitLab's an `updated_after`, Jira's a JQL bound, Linear's an `updatedAt` filter — and a loop
that parsed any of them would be a second implementation of somebody else's format, with its
own opinion about time zones. `ticket_sources.sync_cursor` is `text`.

Three rules:

1. **You must be able to resume from what you returned.** It comes straight back to
   `incrementalSync` next cycle, unread.
2. **`null` leaves the stored cursor alone.** It is *"no watermark to record"* — a legitimate
   state for a sync that saw nothing. It is **not** a way to clear one, and `""` is refused by
   `ticket_sources_sync_cursor_present`, because a cursor of `''` is a poller that re-imports
   the whole backlog every pass.
3. **`hasMore` is how you ask for another cycle.** `true` books the next one in a second
   instead of a full interval, which turns a cold import of a large backlog into several quick
   cycles rather than an afternoon. It is your answer rather than something the loop infers,
   because the only thing the loop could infer it from is page size, which is your business.

**Order your page ascending by `sourceUpdatedAt`.** Nothing enforces it — only you can arrange
it — but resumability depends on it: with ascending order, the tickets a page stored are
exactly the ones at or before the cursor it returned, so the next page continues rather than
starting again.

A derived rule: the watermark should be *what the page saw*, not your process's clock. A
clock-derived cursor is wrong by however far your host has drifted from the tracker's, and it
is wrong in the direction that loses tickets.

---

## 6. Credentials

You receive an opened credential in `context.credentials`, or `null`.

```ts
interface TicketSyncContext {
  readonly sourceId: string;
  readonly organizationId: string;
  readonly config: unknown;
  readonly credentials: string | null;
}
```

`null` is a real state rather than an unfinished one: a source may be configured before anybody
has pasted a token in, and a tracker serving public projects needs none. If you require one and
are handed `null`, fail `auth` — the credential is the thing that is wrong.

Three rules on your side:

* **Do not store it.** A provider is a singleton; one that kept a credential in a field would
  hold a plaintext token across requests. It is live for the duration of one call.
* **Do not log it**, and do not log anything derived from it.
* **Do not put it in a `detail`.** See §4.

On the loop's side: the sealed column's **value** is read by exactly one statement — the
management API's list asks only whether it is null, and selects nothing else — opened by
`VaultService` immediately before your call, and the reference is dropped in a `finally`.
`GET /api/v1/sources` answers a mask, `••••`, and the response to storing a credential echoes
that mask with the last four characters; no response ever carries the value. The
envelope is AES-256-GCM under a per-tenant key, with the workspace id and the **source id**
bound into the AAD — so a credential lifted from one source's row and pasted into another's
fails to open rather than decrypting into somebody else's tracker.

`ticket_sources_credentials_sealed` refuses any value that is not one of those envelopes, for
every writer. A plaintext token cannot be stored in that column by a migration, a fixture or a
hand-written `update`.

---

## 7. Webhooks (optional)

`webhookHandler` is **not** on `TicketSourceProvider`. A provider that handles deliveries
implements `WebhookCapableProvider`, and a caller reaches the member through `supportsWebhooks`
or `TicketSourceRegistry.webhookCapable`. So `registry.get("jira").webhookHandler(…)` does not
compile, rather than throwing at run time behind an endpoint somebody has already pointed a
tracker at.

```ts
webhookHandler(payload: unknown, signature: string | null): Promise<WebhookOutcome>;
```

It answers **canonical tickets**, so a delivery and a poll write through the same upsert — which
is what stops a webhook path from becoming a second, subtly different intake with its own bugs.
An empty list is an ordinary outcome: a ping, a comment, an event you do not act on.

**You verify the signature yourself**, and you throw `auth` when it is absent, malformed or
wrong. A shared "verify the signature" helper would be five schemes in one function with a
`switch` on the kind — the exact branch this SPI exists to remove.

The registry refuses a provider whose `webhooks` flag disagrees with its member, at boot, in
both directions. A flag that lies is a member that is either unreachable or missing.

---

## 7a. Writing back (optional)

AL.2 ([#278](https://github.com/NobuData/ouroboros/issues/278)) — *the pluggability requirement
made bidirectional*. The same recipe as webhooks: the members are on `WriteCapableProvider`, a
caller reaches them through `supportsWrites`, and the push service (AL.3, #279) asks what a
provider can do rather than which provider it is. It imports the SPI only; the lint boundary is
the same one the sync loop is held to.

```ts
capabilities().write = {
  createTicket: boolean;          // the gate: every flag below is off when this is
  nativeDependencies: boolean;    // else the documented fallback below
  epicMapping: "parent_issue" | "epic" | "project" | "none";
  milestones: boolean;
};

createTicket(context, draft)              → { externalId, externalKey, url }
linkDependency(context, blocker, blocked) → { mode: "native" | "fallback" }
ensureMilestone(context, name)            → { externalRef, name } | null
ensureEpicContainer(context, epic)        → { mapping, externalRef } | null
attachToEpic(context, ticket, mirror)     → void
```

**Every member is idempotent.** `createTicket` dedupes by `draft.idempotencyKey` — search before
you create — and `ensureMilestone`, `ensureEpicContainer`, `linkDependency` and `attachToEpic`
answer what already exists rather than making a second one. The push service is written to be
killed mid-batch and resumed; a crash between your tracker's `201` and its database commit is
exactly the case your search is for.

**An absent capability answers `null`, not an exception.** `ensureMilestone` with
`milestones: false` and `ensureEpicContainer` under `epicMapping: "none"` are ordinary
configurations. `attachToEpic` handed a mirror your mapping could not have produced refuses as
`validation`.

**A refused write leaves nothing behind.** Check your arguments before you send anything, and
never report a failure for a write the tracker kept — the retry after recovery must create
exactly one.

**Every refusal is a `TicketSourceError`**, classified through `classifyWriteHttpStatus`, so the
push service can tell *widen the token's scope* (`permission`) from *fix the draft*
(`validation`) from *wait* (`rate_limit`).

### The `linkDependency` fallback

A tracker with no native `blocks` relation still links. Declare `nativeDependencies: false` and
record the relation **in the blocked ticket's body**, one line per blocker, below everything a
person wrote:

```
<!-- ouroboros:blocked-by <blocker externalId> -->
```

Use `withDependencyMarker(body, blockerId)` to add it (idempotent — a line already there is not
added twice), `hasDependencyMarker` to test for it and `dependencyMarkersIn` to read them back, so
every fallback provider writes and reads the same grammar. Answer `{ mode: "fallback" }`, so the
UI can say which mode ran rather than silently degrading. The in-memory writer declared with
`nativeDependencies: false` is the worked example.

**A native declaration may still fall back.** `nativeDependencies` says what your tracker *kind*
supports; one self-hosted instance of it may predate the relation. If a capability probe finds it
absent, write the marker and answer `{ mode: "fallback" }` — the kit refuses only the opposite lie,
a fallback declaration answering `native`. GitHub (below) is the worked example.

### GitHub, the first writer (AL.3)

AL.3 ([#279](https://github.com/NobuData/ouroboros/issues/279)) implements every member for
GitHub (`providers/github.write.ts`) and declares every feature:
`{ createTicket: true, nativeDependencies: true, epicMapping: "parent_issue", milestones: true }`.

| Member | GitHub |
|---|---|
| `createTicket` | `POST /repos/{o}/{r}/issues` in the source's **first enabled repository**. The body is the draft's, verbatim, then `---`, a `<sub>Filed by Ouroboros</sub>` footer, and `<!-- ouroboros:push-key <key> -->`. Before creating, the probe reads the 100 newest issues (search lags a write) and then searches for the marker (the newest page misses an old issue) |
| `linkDependency` | Reads both issues, then `GET …/issues/{n}/dependencies/blocked_by`: `POST {issue_id}` when the blocker is not listed (**native**). A `404` from that route for an issue just read means an older GHES without the API — the body marker is written instead (**fallback**) |
| `ensureMilestone` | Lists every milestone (`state=all`) by title, else `POST …/milestones`. The reference is the milestone number |
| `ensureEpicContainer` | A parent tracking issue carrying `<!-- ouroboros:epic <epicId> -->`, found by the same probe before it is created |
| `attachToEpic` | `GET …/issues/{parent}/sub_issues`, then `POST {sub_issue_id}` when absent |

Refusals are read the write-side way: K.3's client now carries the HTTP status on
`GithubApiError.httpStatus`, so a `403` with budget left is `permission` and a `422` is
`validation`; a spent budget is `rate_limit` with its resume time. REST rather than GraphQL's
`addBlockedBy` keeps every call on the one rate-guarded client.

### The push service (AL.3)

`src/modules/planning/push.service.ts` is the SPI's first write consumer, and imports no provider.
`push(org, batch)` and `resume(org, batch)` walk a batch's selected drafts **blockers first**
(`push.order.ts`; a cycle is a `422` naming it), key each create `<batchId>:<draftId>`, link each
draft to the blockers that already exist, attach it to the batch epic's container
(`epic_mirrors` first), and record it in **one transaction** — canonical ticket (adopting a row a
sync already imported), `push_state = pushed`, every `ticket_dependencies` draft end rewritten to
the ticket, and the epic's `epic_tickets` row.

- A crash before that commit leaves the draft `pending`; the resume's `createTicket` finds the
  issue by its key. A resume touches only `pending|failed` drafts.
- A `rate_limit` stops the walk with the rest still `pending` and `outcome: "throttled"`,
  `retryAt` — the batch resumes rather than fails.
- Any other refusal records `push_error = { code: <error class>, message, detail: { step,
  retryable, httpStatus?, retryAt? } }` and the walk continues; a draft whose blocker was not
  pushed records `blocker_not_pushed` and is not created.
- The report's `links: { native, fallback }` is how the UI is told which mode ran.
- A batch is read inside the asking workspace only, joined to a source of the same workspace.

### What the UI does with the flags

`GET /api/v1/sources/catalog` carries `push: { enabled, reason }` on every entry, composed by
`pushAffordance` from `capabilities.write`. A read-only kind renders its push control
**disabled with `reason` as the tooltip** — never a push that fails on click.

---

## 8. Writing one

### Where it goes

```
ouroboros-rest/src/modules/ticket-sources/
  providers/
    yourtracker.provider.ts          ← your provider
    yourtracker.client.ts            ← your HTTP client, if you want one
    yourtracker.mapping.ts           ← raw → canonical, testable alone
    yourtracker.provider.spec.ts
```

`providers/` is a lint boundary. `.dependency-cruiser.cjs` forbids anything outside it — except
`ticket-sources.module.ts`, and tests and fixtures — from importing a file under it, and
forbids a tracker's SDK from being imported anywhere else. `yarn lint` runs both, so crossing
the boundary is a red check rather than something a reviewer has to notice.

### The skeleton

```ts
@Injectable()
export class YourTrackerProvider implements TicketSourceProvider {
  readonly kind = "custom" as const;

  capabilities(): TicketSourceCapabilities {
    return {
      webhooks: false,
      labels: true,
      bidirectionalWrites: false,
      write: READ_ONLY_WRITE_CAPABILITIES,
    };
  }

  async validateConfig(config: unknown, credentials: string | null): Promise<TicketSourceValidation> {
    const settings = this.settings(config);           // your own parse; throw `not_found` if wrong

    try {
      const projects = await this.client.projects(settings, credentials);

      return { status: "ok", detail: `${projects.length} projects` };
    } catch (error) {
      // Never rethrow here: a failed test is what the form exists to render.
      return { status: "failed", errorClass: classOf(error), detail: describe(error) };
    }
  }

  async fullSync(context: TicketSyncContext): Promise<TicketPage> {
    return this.walk(context, undefined);
  }

  async incrementalSync(context: TicketSyncContext, cursor: string): Promise<TicketPage> {
    return this.walk(context, cursor);
  }

  mapTicket(raw: unknown): CanonicalTicket {
    // Parse defensively. This is somebody else's JSON.
    // Throw `new TicketSourceError("upstream", …)` rather than returning a half-filled row.
  }
}
```

### Registering it

One line, in
[`ticket-sources.module.ts`](../ouroboros-rest/src/modules/ticket-sources/ticket-sources.module.ts):

```ts
{
  provide: TICKET_SOURCE_PROVIDERS,
  useFactory: (github: GithubTicketSourceProvider, yours: YourTrackerProvider) => [github, yours],
  inject: [GithubTicketSourceProvider, YourTrackerProvider],
}
```

Nothing else in the module changes, and nothing outside it changes at all.

### Testing it

Three levels, and the first two are yours:

1. **`mapTicket` against recorded payloads.** No network, no database. This is why it is on the
   interface.
2. **The provider against a stubbed HTTP layer** — pagination, the cursor round trip, each of
   the four error classes.
3. **The conformance kit** ([Q.5, #142](https://github.com/NobuData/ouroboros/issues/142)),
   which runs the same suite against every provider: config validation, full and incremental
   sync semantics, cursor monotonicity, idempotent re-sync, mapping completeness, the error
   taxonomy, and the webhook shape if you declare one. *Pluggable* is a claim until a second
   implementation passes the same tests.

### The conformance kit

One spec file beside your provider, supplying the provider and its recordings — no database, no
Nest module, and no reading of the loop:

```ts
// providers/yourtracker.conformance.spec.ts
describeTicketSourceConformance("YourTrackerProvider", () => {
  const tracker = recordedTracker(PAYLOADS);        // your stand-in transport, fresh for every case
  const provider = new YourTrackerProvider(tracker.client);

  return {
    provider,
    context: { sourceId, organizationId, config: { project: "PROJ" }, credentials: TOKEN },
    rejectedConfigs: [{ name: "a lower-case key", config: { project: "proj" } }],
    mappings: [{ name: "an open ticket", raw: PAYLOADS[0], expected: OPEN_TICKET }],
    unmappable: [{ name: "no title", raw: { id: "1" } }],
    backlog: [OPEN_TICKET],                         // what a cold import leaves in the mirror
    changeUpstream: () => tracker.record(EDIT, CLOSE, NEW_TICKET),
    changedBacklog: [EDITED, CLOSED, NEW],          // what the mirror holds after syncing that
    refuse: { auth: …, rate_limit: …, not_found: …, upstream: … },
    webhook: null,                                  // or a signed delivery, its tickets, a forged one
  };
});
```

| leg | what it asserts |
|---|---|
| kind and capabilities | a V030 kind; three stable boolean flags and a coherent write declaration; `webhooks` agrees with the member; `bidirectionalWrites` and `write.createTicket` agree with each other and with the five write members |
| config | the schema is in the dialect, stable, and accepted by the registry; the form renders one labelled field per property; your sample settings and credential pass your own form; each rejected configuration is a *failed result* from `validateConfig` and `not_found` from a sync |
| error taxonomy | one recorded refusal per class — no exemptions — classified the same by **Test connection** and by a sync, with the credential in no `detail` and no status reason |
| mapping | every recorded payload maps to exactly the ticket you wrote out; all eleven fields present, `null` rather than missing; at least one recording with no body and one with no author; unreadable payloads refused as `upstream` |
| sync | a cold import mirrors your backlog and leaves a cursor; syncing the same cursor again **writes nothing** and moves nothing; your recorded change — which must close a ticket — arrives through `incrementalSync`, advances the cursor, and never carries a ticket older than the copy the mirror holds |
| credentials | nothing reachable from the provider's fields contains the credential after a sync |
| webhooks | when declared: a signed delivery maps exactly, and unsigned and forged ones are refused as `auth` |

**Write the expected tickets out in full.** The only way to check a mapping is to state its answer;
a derived expectation agrees with whatever the mapping did.

**The sync legs replay into a mirror that applies the loop's own rules.** A closed ticket the mirror
has never seen is not stored, and `ticket-sources.repository.ts`'s `differs` decides what counts as
a write — so *idempotent* is counted rather than trusted. The kit never reads your cursor: a cursor
that moved backwards shows up as a ticket older than the one the mirror already holds.

Two harnesses are already written to copy from:

* [`providers/in-memory.provider.fixture.ts`](../ouroboros-rest/src/modules/ticket-sources/providers/in-memory.provider.fixture.ts)
  — `InMemoryTicketSourceProvider`, a fixture-driven fake over an in-memory tracker, and a
  webhook-capable twin. It passes the kit, and it is what the loop's integration suite runs on:
  no Octokit in the core intake tests, which `.dependency-cruiser.cjs`'s
  `ticket-source-core-tests-run-on-the-fake` enforces.
* [`providers/github.conformance.spec.ts`](../ouroboros-rest/src/modules/ticket-sources/providers/github.conformance.spec.ts)
  — the kit over recorded GitHub payloads, through a stand-in that honours `state` and `since`.

### The write suites

A provider that declares `write.createTicket` also takes
`describeTicketSourceWriteConformance` from
[`conformance.write.fixture.ts`](../ouroboros-rest/src/modules/ticket-sources/conformance.write.fixture.ts):

```ts
describeTicketSourceWriteConformance("YourTrackerProvider", () => ({
  provider, context,
  drafts: [DRAFT_A, DRAFT_B],             // two drafts, different idempotency keys
  milestoneName: "Helios 2.1",
  epic: { epicId, title, description: null },
  ledger: () => stub.ledger(),            // what the recording holds: tickets, dependencies, …
  refuse: { auth: …, permission: …, validation: …, rate_limit: …, not_found: …, upstream: … },
  recover: () => stub.recover(),
}));
```

| leg | what it asserts |
|---|---|
| declaration | coherent, and agrees with the five members |
| create | a reference a sync could adopt; the tracker holds exactly one more ticket |
| dedupe | the same idempotency key twice is one ticket and one reference |
| link | the declared mode — native or fallback — and one relation however often it is asked; a ticket linked to itself is `validation` |
| milestones | one milestone however often it is asked, or `null` when not declared |
| epics | one container and one membership however often asked, or `null` under `none` — and `attachToEpic` there is `validation`, not a crash |
| error taxonomy | one recorded refusal per class — all six — classified as that class |
| rollback | a refused write leaves the ledger unchanged; the retry after recovery creates exactly one |
| credentials | nothing reachable from the provider holds the credential after its writes |

**The ledger is the tracker's count, not the provider's answers.** A provider that created a second
milestone and returned the first one's id would pass a check on answers alone.
`providers/in-memory.write-conformance.spec.ts` runs the suites against three declarations of the
in-memory writer — every feature; fallback links with no milestones and `epicMapping: "none"`; and
native epics.

**Registering a provider without taking the kit fails the build.** `conformance.fixture.spec.ts`
reads `ticket-sources.module.ts` and requires `providers/<name>.conformance.spec.ts` for every
provider it imports.

---

## 9. What the loop guarantees you

So that you do not reimplement any of it:

* **One call per source per cycle.** At most `SOURCE_CONCURRENCY` sources in flight, and a
  cycle never overlaps itself.
* **One transaction per sync.** Your page's rows, the cursor, the freshness stamp and the
  status land together or not at all — so a sync that failed part way leaves the mirror and the
  freshness tag exactly as they were.
* **An unchanged ticket is not written.** The loop compares field by field and issues no
  statement when nothing differs, so `tickets.updated_at` means *the tracker changed this* and
  a re-sync is genuinely idempotent. Most cursors are inclusive, so this matters on every poll.
* **A closed ticket the mirror has never seen is not stored.** The one policy the loop applies
  to your page, and it is the same for every tracker: a backlog holds what was open at least
  once. You could not apply it yourself — it needs the mirror's state.
* **A failure is recorded, never silent.** `status` and `status_reason` are written, `synced_at`
  is not, and the next successful sync clears both.
* **New and reopened tickets are handed on after the commit.** Never inside it: a ticket
  announced to a queue and then rolled back is a queue holding a row that does not exist.

## 10. What the loop does *not* do for you

* **Pagination.** One call, one page. Walk your own pages inside it and set `hasMore`.
* **Rate limiting.** Your budget, your backoff. Throw `rate_limit` with a `retryAt` and the
  source says so honestly until the window lifts.
* **Retries.** A cycle is the retry. `TICKET_SOURCE_ERROR_RETRYABLE` says which classes are
  worth one, and it is read for the log rather than for the schedule.
* **Parsing your `config`.** It arrives as `unknown`, deliberately: the per-kind grammar is
  yours, and a type spelled in the core would be one tracker's grammar under a neutral name.

---

## 11. Where the pieces live

| file | what it is |
|---|---|
| [`ticket-source.provider.ts`](../ouroboros-rest/src/modules/ticket-sources/ticket-source.provider.ts) | the SPI, `CanonicalTicket`, `TicketPage`, `supportsWebhooks`, `WriteCapableProvider`, `supportsWrites` |
| [`ticket-source.write.ts`](../ouroboros-rest/src/modules/ticket-sources/ticket-source.write.ts) | the write declaration and the values write members take and answer; `pushAffordance`; the dependency fallback marker |
| [`ticket-source.errors.ts`](../ouroboros-rest/src/modules/ticket-sources/ticket-source.errors.ts) | the six classes, the status mapping, `statusReasonFor`, `classifyHttpStatus`, `classifyWriteHttpStatus` |
| [`ticket-source.registry.ts`](../ouroboros-rest/src/modules/ticket-sources/ticket-source.registry.ts) | lookup by kind, and the two misuses refused at boot |
| [`ticket-sources.service.ts`](../ouroboros-rest/src/modules/ticket-sources/ticket-sources.service.ts) | the loop |
| [`ticket-sources.repository.ts`](../ouroboros-rest/src/modules/ticket-sources/ticket-sources.repository.ts) | the loop's statements, including the one that reads a sealed credential |
| [`ticket-source.config.ts`](../ouroboros-rest/src/modules/ticket-sources/ticket-source.config.ts) | the `configSchema()` dialect — the model-provider form dialect plus a list of strings — and the submission rules over it |
| [`sources.controller.ts`](../ouroboros-rest/src/modules/ticket-sources/sources.controller.ts) | `/api/v1/sources` (Q.4): members read, `owner`/`admin` write |
| [`sources.service.ts`](../ouroboros-rest/src/modules/ticket-sources/sources.service.ts) | add · update · credentials · test · sync · status, with no `kind` in it |
| [`sources.repository.ts`](../ouroboros-rest/src/modules/ticket-sources/sources.repository.ts) | the request's statements — workspace-scoped, over the view, plus the one presence bit |
| [`sources.catalog.ts`](../ouroboros-rest/src/modules/ticket-sources/sources.catalog.ts) | `GET /sources/catalog`: every registered kind as form fields and capabilities |
| [`sources.errors.ts`](../ouroboros-rest/src/modules/ticket-sources/sources.errors.ts) | the seven `ticket_source_*` codes the API answers |
| [`ticket.intake.ts`](../ouroboros-rest/src/modules/ticket-sources/ticket.intake.ts) | the estimation handoff, as a port |
| [`ticket-sources.module.ts`](../ouroboros-rest/src/modules/ticket-sources/ticket-sources.module.ts) | the registration point |
| [`providers/github.provider.ts`](../ouroboros-rest/src/modules/ticket-sources/providers/github.provider.ts) | the GitHub provider (Q.3) — the worked example of every section above |
| [`providers/github.config.ts`](../ouroboros-rest/src/modules/ticket-sources/providers/github.config.ts) | its `config` grammar: `{ login, repos[] }` |
| [`providers/github.mapping.ts`](../ouroboros-rest/src/modules/ticket-sources/providers/github.mapping.ts) | its `mapTicket`, testable with no network |
| [`conformance.fixture.ts`](../ouroboros-rest/src/modules/ticket-sources/conformance.fixture.ts) | the conformance kit (Q.5) — `describeTicketSourceConformance` and the checks it is built from |
| [`conformance.write.fixture.ts`](../ouroboros-rest/src/modules/ticket-sources/conformance.write.fixture.ts) | the write suites (AL.2) — `describeTicketSourceWriteConformance` |
| [`providers/in-memory.provider.fixture.ts`](../ouroboros-rest/src/modules/ticket-sources/providers/in-memory.provider.fixture.ts) | the in-memory tracker and provider the kit and the core intake harness run on |
| [`V030__canonical_tickets.sql`](../ouroboros-db/migrations/V030__canonical_tickets.sql) | `ticket_sources`, `tickets`, `ticket_sources_public` |
| [`V031__ticket_source_status_reason.sql`](../ouroboros-db/migrations/V031__ticket_source_status_reason.sql) | `status_reason` |

Related reading: [`SECURITY_MODEL.md`](SECURITY_MODEL.md) for the vault's guarantees,
[`ARCHITECTURE.md`](ARCHITECTURE.md) decision **D3** for why `ouroboros-rest` writes no DDL, and
[`ROADMAP_MOCKUP_04_WORKFLOW_BUILDER.md`](ROADMAP_MOCKUP_04_WORKFLOW_BUILDER.md) decisions **P5**
and **P6** for why any of this is shaped the way it is.
