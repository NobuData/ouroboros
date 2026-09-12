# Ticket sources — writing a `TicketSourceProvider`

> **Status:** the SPI, the registry and the sync loop shipped with
> [Q.2 (#139)](https://github.com/NobuData/ouroboros/issues/139). **No provider is registered
> in this build.** [Q.3 (#140)](https://github.com/NobuData/ouroboros/issues/140) is the GitHub
> provider, [Q.4 (#141)](https://github.com/NobuData/ouroboros/issues/141) the management API
> and settings surface, [Q.5 (#142)](https://github.com/NobuData/ouroboros/issues/142) the
> conformance kit. Everything below is true of the code as it stands; where a section describes
> something a later ticket adds, it says so.

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

Three flags, all required. `false` is an answer; a partial record would let a capability be
*unmentioned*, and every consumer would then have to decide what an absent flag means.

| flag | what it says |
|---|---|
| `webhooks` | whether you implement `WebhookCapableProvider`. The registry checks this against the member at boot, in both directions. |
| `labels` | whether the concept of a label exists at your tracker at all — **not** whether a given ticket has any. It is the difference between an empty chip-set because nothing matched and one because there is nothing to match. |
| `bidirectionalWrites` | reserved. `false` today; a v2 ticket adds the member behind it, as an extension. |

They must be **stable**: two calls answer equal values. A capability that changed between two
renders would show an affordance that then failed.

### `validateConfig(config, credentials)`

The **Test connection** button (Q.4). Called *before a row exists*, which is why it takes loose
parts rather than a context: there is no `sourceId` to hand it, and the credential is a string
somebody has just pasted.

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

Four words, and nothing else:

```ts
type TicketSourceErrorClass = "auth" | "rate_limit" | "not_found" | "upstream";
```

| class | what it means | `status` | what the person reads |
|---|---|---|---|
| `auth` | the credential was understood and refused | `error` | `credentials rejected (401)` |
| `rate_limit` | working, and refusing anyway | `error` | `rate limited until 14:20 UTC` |
| `not_found` | the project, repository or site is not there — or the credential cannot see it | `error` | `project or repository not found` |
| `upstream` | the tracker answered with its own failure, or did not answer | `error` | `tracker unavailable (503)` |

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
again. Override the one status your tracker reads differently and call it for the rest.

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

On the loop's side: the sealed column is read by exactly one statement, opened by
`VaultService` immediately before your call, and the reference is dropped in a `finally`. The
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
    return { webhooks: false, labels: true, bidirectionalWrites: false };
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
  useFactory: (yours: YourTrackerProvider) => [yours],
  inject: [YourTrackerProvider],
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
| [`ticket-source.provider.ts`](../ouroboros-rest/src/modules/ticket-sources/ticket-source.provider.ts) | the SPI, `CanonicalTicket`, `TicketPage`, `supportsWebhooks` |
| [`ticket-source.errors.ts`](../ouroboros-rest/src/modules/ticket-sources/ticket-source.errors.ts) | the four classes, the status mapping, `statusReasonFor`, `classifyHttpStatus` |
| [`ticket-source.registry.ts`](../ouroboros-rest/src/modules/ticket-sources/ticket-source.registry.ts) | lookup by kind, and the two misuses refused at boot |
| [`ticket-sources.service.ts`](../ouroboros-rest/src/modules/ticket-sources/ticket-sources.service.ts) | the loop |
| [`ticket-sources.repository.ts`](../ouroboros-rest/src/modules/ticket-sources/ticket-sources.repository.ts) | every statement, including the one that opens a credential |
| [`ticket.intake.ts`](../ouroboros-rest/src/modules/ticket-sources/ticket.intake.ts) | the estimation handoff, as a port |
| [`ticket-sources.module.ts`](../ouroboros-rest/src/modules/ticket-sources/ticket-sources.module.ts) | the registration point |
| [`V030__canonical_tickets.sql`](../ouroboros-db/migrations/V030__canonical_tickets.sql) | `ticket_sources`, `tickets`, `ticket_sources_public` |
| [`V031__ticket_source_status_reason.sql`](../ouroboros-db/migrations/V031__ticket_source_status_reason.sql) | `status_reason` |

Related reading: [`SECURITY_MODEL.md`](SECURITY_MODEL.md) for the vault's guarantees,
[`ARCHITECTURE.md`](ARCHITECTURE.md) decision **D3** for why `ouroboros-rest` writes no DDL, and
[`ROADMAP_MOCKUP_04_WORKFLOW_BUILDER.md`](ROADMAP_MOCKUP_04_WORKFLOW_BUILDER.md) decisions **P5**
and **P6** for why any of this is shaped the way it is.
