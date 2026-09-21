# ouroboros-db

> **Status:** the Flyway project is complete.
> [#10](https://github.com/NobuData/ouroboros/issues/10) added `migrations/` and the
> repo-root compose stack that applies it;
> [#19](https://github.com/NobuData/ouroboros/issues/19) added
> [`flyway.toml`](flyway.toml) — where every setting now lives, for the stack and for a
> hand-run migration alike — the [`scripts/`](scripts) commands, and
> [`tests/`](tests). The tenancy tables themselves start at `V001`
> ([#20](https://github.com/NobuData/ouroboros/issues/20) onwards) — `V001` (tenants and
> domains), `V002` (users, identities and membership) and `V003` (GitHub enablement) have
> all landed, and [`tests/constraints.sql`](tests/constraints.sql) asserts what they
> enforce. `V004` ([#706](https://github.com/NobuData/ouroboros/issues/706)) adds
> BetterAuth's four core tables and back-fills them from `V002` — see
> [The two generations of user table](#the-two-generations-of-user-table), and note that
> `"user"` is quoted everywhere because it is a reserved word. `V005`
> ([#707](https://github.com/NobuData/ouroboros/issues/707)) adds the organization
> plugin's `organization`, `member` and `invitation`, and the column that makes tenancy
> server state — see [The tenant pointer](#the-tenant-pointer). `V006`
> ([#708](https://github.com/NobuData/ouroboros/issues/708)) is the cut-over: it moves
> the tenancy rows into those tables, re-parents `tenant_domains` and `github_orgs`
> onto `organization_id`, and **drops `tenants`, `tenant_members`, `users` and
> `user_identities`** — see
> [The two generations of user table](#the-two-generations-of-user-table) for why that
> chapter is closed, and [`tests/rehearsal/`](tests/rehearsal) for the standing
> rehearsal `ci/db` runs it through.
> [#23](https://github.com/NobuData/ouroboros/issues/23) added the dev seed —
> [`migrations/R__dev_seed.sql`](migrations/R__dev_seed.sql), the demo workspace every
> mockup is drawn around, in a development database and nowhere else. And
> [#24](https://github.com/NobuData/ouroboros/issues/24) turned all of that into a gate:
> `ci/db` now starts a throwaway PostgreSQL on every pull request, migrates it from
> empty, validates it, and runs both `.sql` suites against the result — see
> [Continuous integration](#continuous-integration). What that pass proves is now also
> what ships: [`Dockerfile`](Dockerfile) is this module as a one-shot migration task, and
> `publish/db` pushes it once `ci/db` is green on `main` — see [The image](#the-image).
> Five product tables have landed on that base since the cut-over: `V007`
> ([#649](https://github.com/NobuData/ouroboros/issues/649)) adds `user_preferences`, the
> per-person font scale, and `V008`
> ([#64](https://github.com/NobuData/ouroboros/issues/64)), `V009`
> ([#65](https://github.com/NobuData/ouroboros/issues/65)), `V010`
> ([#66](https://github.com/NobuData/ouroboros/issues/66)) and `V011`
> ([#67](https://github.com/NobuData/ouroboros/issues/67)) add the whole of the
> **dashboard read-model** — `runs`, the entity mockup 02's stat row, *Active loops*
> and *Recently closed* cards are all views over, `queue_items`, the ordered queue behind
> *Up next in queue* and the *Queued issues* estimate, `token_usage`, the append-only
> spend ledger behind *Token spend · today* (with `token_usage_daily`, this schema's first
> view), and `workspace_settings`, the org-scoped home of the **Auto-merge when checks
> pass** switch — the page's only *write*, read through
> `workspace_settings_effective`. Each carries its own section in
> [`tests/constraints.sql`](tests/constraints.sql). With all four in place,
> [#68](https://github.com/NobuData/ouroboros/issues/68) fills them:
> [`migrations/R__dev_seed_dashboard.sql`](migrations/R__dev_seed_dashboard.sql) is
> **mockup 02 as rows** — every figure that screen renders, reproduced from data rather
> than asserted by a mock — and the personal workspace deliberately left empty as the
> zero-state fixture. See [The development seed](#the-development-seed).
> `V012` ([#580](https://github.com/NobuData/ouroboros/issues/580)) opens the **model
> registry** with `model_prices`, the pricing catalog mockup 21's `$ per 1M in·out`
> column is rendered from — and the first migration that ships *product* rows rather than
> dev-only ones:
> [`migrations/R__model_price_catalog.sql`](migrations/R__model_price_catalog.sql) applies
> a vendored, pinned snapshot of upstream prices in every environment, development and
> production alike. See [The bundled price catalog](#the-bundled-price-catalog).
> `V014` ([#99](https://github.com/NobuData/ouroboros/issues/99)) opens the **intake**
> read-model with `github_issues`, the mirror mockup 03's backlog table and detail panel
> are rendered from, and the per-repo sync cursor the incremental poller writes onto
> `github_repos`. It is the one migration that reads as a table you could let somebody
> edit and is not: decision **K3** makes it a *cache* whose source of truth is GitHub, and
> its header says so at the top for the reader who arrives with an `update` in mind. It is
> also the one migration that takes an extension — `pg_trgm`, so the backlog's search box
> is an index scan rather than a scan of every title; the header argues why `V001`'s
> no-extensions posture does not reach it.
> `V015` ([#189](https://github.com/NobuData/ouroboros/issues/189)) opens the **routing**
> domain with `provider_connections` and `model_aliases` — where a workspace's model
> providers are, and the names its routes are allowed to use. It is the one migration
> written for two roadmaps that have not started: decision **M2** makes it the shared
> foundation mockup 07 (*Providers & keys*) and mockup 21 (*Model registry*) will build
> their management UIs on, so the schema, its constraints and `ouroboros-rest`'s
> resolution accessors land here and every CRUD surface stays with them. Two of its
> rules are worth knowing before reading it: `model_aliases.model_id` is the **only**
> column in this schema where a raw provider model string may live (decision **M1**), and
> `provider_connections.credentials_encrypted` accepts an `ouro.v1.…` envelope and
> nothing else — so a plaintext API key cannot be stored in it by any writer.
> `V016` ([#190](https://github.com/NobuData/ouroboros/issues/190)) builds the routing
> matrix on top of it: `task_kinds`, `routes` and ordered `route_hops`. It is the one
> migration where **ordering is a correctness rule rather than a convention** — hop
> positions are unique *and* dense from 1, because `floor_hop_index` is a rule about a hop
> *number* and a chain that numbers itself 1, 2, 5 makes *"fail instead of degrading below
> fallback 2"* mean nothing. Both ordering rules are deferred to `commit`, so a drag-reorder
> is plain SQL with no ceremony in it; the header carries the transaction Z.2 is meant to
> inherit rather than reinvent. It is also where decision **M1** stops being a statement and
> becomes structural: a hop names a `model_aliases` row, and there is no column in any of
> the three tables a raw provider model string could be put in.
> `V018` ([#191](https://github.com/NobuData/ouroboros/issues/191)) finishes the routing
> foundation with `escalation_rules` — mockup 06's *"effort ≥ L → implement uses coder-max
> (max thinking)"* stored as a **structured predicate**, not as that sentence. `"when"` is
> the WF-P8 predicate grammar scoped to routing, `"then"` is one of exactly three route
> modifications, and `display` — the sentence the card prints — is a **stored generated
> column** derived from the pair, so a hand-written one is refused by PostgreSQL itself and
> the text can never drift from what the rule does. Both predicate columns are **domains**
> rather than table CHECKs, which is what puts the grammar's refusal *before* the
> derivation runs.
> `V019` ([#579](https://github.com/NobuData/ouroboros/issues/579)) opens the **model
> registry's management surface** by growing `V015`'s `model_aliases` rather than forking it
> — the enable switch, the **unbound** binding, and params that cannot lie. Three things
> arrive together and each is a rule the schema now holds rather than a service promising
> it: `enabled` is mockup 21's `On` switch and is neither provider health nor a delete;
> `provider_connection_id` becomes **nullable**, where null is an alias created ahead of its
> key; and a CHECK makes those two inseparable — `provider_connection_id is not null or
> enabled = false`, so an unbound alias can never be switched on and no service path can
> race past it. `params` stops being free-form and becomes a **closed vocabulary**
> (`thinking`, `token_budget`, `temperature`, `max_output`, `context_clamp`), joined by a
> `restrictions` document carrying the two registry-policy flags, because mockup 21's chips
> are *derived from* those documents and a derivation over free-form jsonb either drops what
> it cannot read or prints it raw. What this layer deliberately does **not** do is decide
> whether a well-formed param means anything for the bound model: that reads the adapter's
> schema and `provider_models`, neither of which a CHECK may look at, and it is CH.2's
> ([#585](https://github.com/NobuData/ouroboros/issues/585)).
> `V020` ([#192](https://github.com/NobuData/ouroboros/issues/192)) closes the routing
> foundation with the two facts a spend event had to carry before mockup 06's `$/run avg`
> and `p50 latency` columns could be *computed* rather than stored: `token_usage.task_kind`
> and `token_usage.latency_ms`. It is the smallest migration in the schema and the one that
> makes decision **M7** reachable — a ledger row already knew which *model* it paid for and
> never which *kind of work* it was doing, so a per-kind average had nothing to group by and
> a per-kind median had nothing to take the median of. Both columns are nullable and null is
> the load-bearing state: an aggregate over no rows is null, which renders the em-dash the
> rule requires rather than a `$0.00` and a `0.0s` nobody measured. `task_kind` is
> deliberately **text with no foreign key**, on `V008`'s decision **F8** precedent — a ledger
> records what happened, and retiring a task kind must not block, delete or rewrite the
> history routed under it. With it in place
> [`migrations/R__dev_seed_routing.sql`](migrations/R__dev_seed_routing.sql) is **mockup 06
> as rows** — seven aliases (eight since `V024`'s #582 drew mockup 21 over the same rows),
> eight kinds, their chains, three rules and the 370 routed calls every number on the screen
> is aggregated out of, with not one of those numbers stored anywhere. See
> [The development seed](#the-development-seed).
> `V021` ([#195](https://github.com/NobuData/ouroboros/issues/195)) adds the table `V016`
> anticipated in as many words — *"when versioned route configuration arrives it is history in
> a table of its own"*. Mockup 06's editing model is **staged**: edits accumulate in the
> browser and commit when somebody presses **Save routes**, and that press deserves a record,
> because *"somebody saved the routes at some point"* is not an answer to *"why did last
> Tuesday's runs go to the fallback provider"* — and it is the only answer `routes.updated_by`
> and `updated_at` can give, since both are overwritten by the next save. `route_revisions` is
> three facts and no more: an **actor** (`on delete set null`, so deleting the person does not
> delete the record of what they changed), a **stamp**, and a **diff** —
> `{routes: [{task_kind, changes: {<column>: {from, to}}}]}`, whose shape is CHECKed by
> `ouroboros.route_revision_diff_valid()` so that the audit log
> ([#26](https://github.com/NobuData/ouroboros/issues/26)) is not left reading a union of
> whatever four services happened to write. It is **history, not versions**: a revision records
> what changed rather than a copy of the route as it then stood, which is smaller, is the
> question anybody actually asks, and is why it names its routes by `task_kinds.name` and its
> hops by `model_aliases.alias` rather than by ids that may since have been repointed. Two
> consequences are structural rather than conventional: there is **no `updated_at`** and no
> touch trigger, because an event that can be edited is not one; and a save that changed
> nothing is **unstorable**, because `routes` and every `changes` must be non-empty — an audit
> trail whose rows mostly say *somebody pressed Save and nothing moved* is one nobody reads to
> the end.
> `V022` ([#225](https://github.com/NobuData/ouroboros/issues/225)) adds `audit_events` — and
> it is the one migration in this project that **lands somebody else's table**. Scaffolding
> [#26](https://github.com/NobuData/ouroboros/issues/26) specified it for the platform's audit
> log and is v2; AD.4 is MVP, because a page that reveals and rotates credentials while keeping
> no record of who did it fails its own stated security posture, and *"we'll add audit later"*
> means the first months of a credential store's history are simply gone. Two tables would have
> been the cheap way out of that ordering, so the coordination was made at filing time and is
> recorded in the migration's header: the shape is #26's column for column — tenant fk, nullable
> actor fk, action, subject type/id, jsonb detail, `occurred_at` — with one addition that issue
> did not name, `ip`, and #26 will inherit the table rather than create a second one.
> It is the schema's first **append-only** table in the database rather than by convention, and
> that takes two mechanisms because neither covers the other's case: `ouroboros_app` — a role
> this migration creates, `nologin` and unprivileged — is granted `select` and `insert` and
> nothing else, and `audit_events_no_update` refuses a revision from **any** role including the
> owner this stack connects as, since a superuser bypasses every grant in the catalogue and a
> rule that is true in production and false on a developer's machine is a rule nobody can test.
> Both of its foreign keys shape that trigger: `organization_id` cascades, which is why the
> trigger covers `update` and not `delete` — a delete-refusing trigger would not protect the
> trail, it would make removing a workspace impossible — and `actor_id`'s `on delete set null`
> *is* an update, so exactly that one statement is permitted and nothing beside it. The
> guarantee is therefore stated precisely rather than approximately: **what happened cannot be
> rewritten; who did it can be forgotten.** The invariant that matters most is enforced outside
> the schema, and the header says why: a CHECK against secret material could only pattern-match
> the credential shapes somebody thought of, so `detail` is built from a closed field set by
> `ouroboros-rest`'s audit module and grep-tested — here too, in `tests/seed.sql`, over the rows
> the seed writes.
> [`migrations/R__dev_seed_audit.sql`](migrations/R__dev_seed_audit.sql) is the fifth seed and
> the fixture mockup 07's **Audit log** sheet is drawn against: fourteen events covering every
> action in the vocabulary, including the three a renderer would otherwise meet for the first
> time in production — a failed rotation, a lease grant with **no actor**, and a worker's
> cluster address rather than a person's.
> `V023` ([#581](https://github.com/NobuData/ouroboros/issues/581)) adds
> [`alias_references`](migrations/V023__alias_reference_index.sql), the schema's third view
> and the one answer to *"what references this alias?"* that mockup 21 asks four times on one
> screen — the `USED BY` column, the inspector's chip list, the blocked **Remove** button and
> the rename beside it. The reference lives in four incompatible shapes: a `route_hops`
> **foreign key** (`V016`), an escalation rule's target **inside a jsonb document** (`V018`),
> a workflow `llm` node's alias **by name inside a versioned document**, and a chat route pin
> that does not exist yet — so decision **R5** refuses a stored counter, because four writers
> two of which write jsonb is exactly where a trigger-maintained count goes quietly wrong,
> and a wrong count here is a delete guard that lets a referenced alias vanish. `Used by` is
> therefore `count(*)` over this view and the mockup's `0 routes` is a **left join**, not a
> zero anybody stores. Two of the four legs are live and two are **declared and unbuilt**:
> `workflow` needs WF-P.1 ([#132](https://github.com/NobuData/ouroboros/issues/132)) and the
> P.2 amendment CH.6 ([#589](https://github.com/NobuData/ouroboros/issues/589)) carries, and
> `chat_pin` needs BZ.3 ([#537](https://github.com/NobuData/ouroboros/issues/537)) — while
> absent each contributes zero rows and never errors, the `alias_reference_kind` domain names
> all four so the output shape does not change when they arrive, and the migration's header
> carries the `create or replace view` that adds each. The other half is
> `alias_reference_guard()`, and it is a **lock before a count** rather than a count: check
> then delete is two statements, and between them a concurrent route save adds the hop the
> check did not see. It takes `for update` on the alias — not `for share`, because a hop
> insert takes `for key share` to satisfy its own foreign key and `for key share` does not
> conflict with `for share` — so the referrer list CH.1
> ([#584](https://github.com/NobuData/ouroboros/issues/584)) renders into a 409 is still true
> when the statement after it runs. A race needs two sessions, which `constraints.sql` does
> not have, so that half is proven by
> [`tests/verify-alias-reference-guard.sh`](tests/verify-alias-reference-guard.sh) — see
> [Proving the guard is a guard](#proving-the-guard-is-a-guard).
> `V024` ([#582](https://github.com/NobuData/ouroboros/issues/582)) adds
> [`resolution_snapshots`](migrations/V024__resolution_snapshots.sql) — what a run's routing
> resolution decided, **kept**. Mockup 21's *RESOLUTION CHAIN* card promises that every hop
> is inspectable in the run console, and decision **R9** says that promise is only honest
> over stored truth: a card that re-resolved on every render would show today's health beside
> last week's run number. So the card renders persisted snapshots, and until execution
> exists it renders one seeded run — #482 — as fixture data. It is the second migration here
> that **lands somebody else's table**, on `V022`'s reasoning: CH.6
> ([#589](https://github.com/NobuData/ouroboros/issues/589)) owns the snapshot contract, the
> executor that writes it (AF.2, [#235](https://github.com/NobuData/ouroboros/issues/235))
> and the endpoint that reads it, but a fixture needs a table to be persisted in, so the
> schema arrives with the migration that first needs a row and #589 inherits it — columns
> that are its own contract's nouns, a `shape_version` it may bump, and **no read path**.
> The chain names its alias, route, task kind and provider **by name**, never by id
> (`V021`'s argument: a transcript is read after the alias has been repointed), and the run
> is the one foreign key — **cascading**, because a transcript of a deleted run is a
> transcript of nothing, and held to the snapshot's own workspace by a trigger on `V008`'s
> precedent rather than by a composite key, because the composite key would be a second
> index on `runs` and `tests/constraints.sql` showed the planner taking it over `V008`'s
> own the moment it existed. Three
> `immutable` validators CHECK the jsonb clause by clause: every hop with its alias, model,
> params, the provider *as the health snapshot then saw it*, the masked `key_suffix` — at
> most sixteen alphanumerics, a shape no credential fits — `kept`/`dropped`, Z.1's `code`
> and sentence, and a timing only on a hop that was tried; `outcome` is held to the chain
> (resolved exactly when a hop was kept, which is the rule `resolve()` decides it by). It is
> **append-only** like `audit_events`, and simpler about it: both foreign keys cascade, so
> the refusing trigger has no exception to carve out. With it,
> [`migrations/R__dev_seed_routing.sql`](migrations/R__dev_seed_routing.sql) is **extended,
> not forked**, into mockup 21's registry over the same rows: an eighth alias — the unbound
> `gpt5-experiments`, disabled as `V019` requires — `params` and `restrictions` on all eight
> as the *structure* CH.2 derives the chips from, the one `model_prices` override `V012`'s
> header left to this seed (the local vLLM's `llama-4-maverick` at `$0`), and run #482's
> snapshot, derived hop by hop from the seeded route, aliases and connections rather than
> typed. `Used by` is computed by `V023`'s view over mockup 06's chains, and four of mockup
> 21's drawn counts are not what those chains yield — the seed's header and
> [`tests/seed.sql`](tests/seed.sql) say which, and why the routing matrix wins.
> `V025` ([#584](https://github.com/NobuData/ouroboros/issues/584)) adds
> [`alias_revisions`](migrations/V025__alias_revisions.sql) — who changed a model alias, when,
> and what moved: the lightweight revision record every write the registry's lifecycle API
> makes leaves behind. `V021`'s table again, for the registry, and for `V021`'s reason —
> `model_aliases.updated_by` and `updated_at` say who wrote the state an alias is *in*, both
> are overwritten by the next edit, and *who rebound `coder-max` to what, when* lives in the
> transitions between them. An `actor` that **sets null**, an `alias_id` that **sets null** so
> a `deleted` revision outlives the row it describes, the name kept beside it as text for
> exactly that case, an `action` from a closed vocabulary of eight, and a
> `{<column>: {from, to}}` diff whose grammar `ouroboros.alias_revision_diff_valid()`
> CHECKs — so a write that changed nothing is unstorable rather than merely not written. It is
> deliberately **not** `audit_events`: CJ.2 ([#599](https://github.com/NobuData/ouroboros/issues/599))
> promotes these rows into that table with its own vocabulary and History tab, and what this
> migration owes it is a shape the promotion can copy — which is why the columns are
> `audit_events`' nouns. Append-only by construction, as `route_revisions` is: no `updated_at`,
> no touch trigger, and nothing updates it.
> `V026` ([#100](https://github.com/NobuData/ouroboros/issues/100)) adds
> [`issue_estimates`](migrations/V026__issue_estimates.sql) — everything mockup 03 calls
> *AI Work Breakdown*, as **versioned latest-wins rows**: effort, confidence, the workflow
> tag and routed model, the breakdown and trace jsonb, and the regression risk with the
> sentence under it. `V014` mirrors the issues; this is what sizing says about them, and
> decision **K4** is why it is a table of versions rather than columns on the issue — the
> mockup offers three separate ways to re-estimate, and an estimate that overwrote its
> predecessor would take the trace's meaning and O.2's audit trail with it. Three things in
> it are worth knowing before reading it. **Latest-wins needs no index of its own**: the
> unique key `(github_issue_id, version)` read *backwards* is the descending index the
> ticket asks for, so the second one was measured and not created — and
> [`tests/constraints.sql`](tests/constraints.sql) asserts that plan, and that it sorts
> nothing. **Versions ascend by trigger**, because unique alone accepts 3 then 2 and
> *latest* would then be the older answer. And it is **append-only** — `V024`'s posture,
> for `V024`'s reason and one of its own: BI.4 ([#435](https://github.com/NobuData/ouroboros/issues/435))
> grades a merged loop against the estimate that was in force when the work was queued, a
> join that only means anything while that row cannot change underneath it. Decision **K10**
> gets a constraint of its own — `trace->>'estimator'` is a non-blank string, always — so a
> rejected write names the decision rather than a document rule.
> `V027` ([#101](https://github.com/NobuData/ouroboros/issues/101)) adds
> [`github_credentials`](migrations/V027__github_credentials.sql) — the **per-workspace GitHub
> token** the backlog sync authenticates with (decision **K1**: the MVP's credential is a
> personal access token an administrator pastes in; the GitHub App flow is O.1,
> [#122](https://github.com/NobuData/ouroboros/issues/122)). One row per workspace, and **no
> row is the ordinary state** — clearing a token deletes the row rather than nulling a column,
> so *"this workspace has no token"* is one state to read instead of two that mean the same
> thing. `token_encrypted` holds one of the vault's envelopes (AD.1,
> [#222](https://github.com/NobuData/ouroboros/issues/222)) and
> `github_credentials_token_sealed` refuses anything else — `V015`'s posture, for its reason:
> the service is one writer and a CHECK is *every* writer, so a `ghp_…` pasted in by a seed, a
> fixture or a support script is rejected by the server rather than stored. There is
> deliberately **no mask column and no `rotated_at`**: a suffix stored beside the ciphertext is
> a second source of truth that a rotation can leave disagreeing with the first, and *who*
> rotated a token is `audit_events` (`V022`) rather than a timestamp that cannot say.
> `V028` ([#102](https://github.com/NobuData/ouroboros/issues/102)) widens
> [`github_issues.author_login`](migrations/V028__github_issue_bot_authors.sql) to accept the
> logins **GitHub Apps actually open issues under** — `dependabot[bot]`,
> `github-actions[bot]`, `renovate[bot]`. `V014` gave the column V003's *organisation* login
> rule, which is the right rule for `github_orgs.login` and the wrong one here, and nothing had
> noticed because nothing had written a row: the backlog sync is the table's first writer, and
> the behaviour would have been Renovate's dependency dashboard and every issue a workflow
> files silently missing from the backlog, refused one row at a time by a CHECK. Widened to the
> documented suffix and no further — a pattern that accepted brackets anywhere would accept the
> mapping bug the constraint exists to catch — with the bound raised from 39 to 44, which is
> GitHub's login cap plus the five characters of `[bot]`. `github_orgs.login` is deliberately
> left alone: an organisation is never a bot.
> [#103](https://github.com/NobuData/ouroboros/issues/103) added the **sixth seed** —
> [`migrations/R__dev_seed_intake.sql`](migrations/R__dev_seed_intake.sql), mockup 03's
> backlog as rows: the nine issues `#483`–`#491` in `acme-robotics / helios-firmware` and
> the estimates behind their effort chips, so design review, the intake screens and the e2e
> leg have the mockup's table without a live GitHub token. Four of its decisions are worth
> knowing before reading it, and each is the seed declining to make the product remember
> something it should compute. **The head counts are nine and seven**, not the mockup's
> 42/38 — *"9 open issues. 7 already sized."* is two aggregates over these rows, and padding
> the mirror with thirty-three issues nothing draws would buy the mockup's arithmetic at the
> price of a backlog no test can name. **Every trace says `heuristic-v0`** (decision
> **K10**), spent `0` tokens and names **no signals**: the mockup's *"sized by
> claude-sonnet-5 · 41k tokens"* over three retrieved signals describes a knowledge layer
> that does not exist yet, and seeding it would be a screen showing a provenance nothing
> produced — those lines are O.4's to supply. **The queue rows stay DASH-F.5's**: `queued`
> is a presentation over `queue_items` rather than a `sizing_status`, the twelve already
> seeded include six in this repository, and a thirteenth written from here would break
> mockup 02's *Queued issues* stat to decorate mockup 03 — so the two mockups' disagreement
> about which issues are queued is recorded in the header rather than resolved by inventing
> a row. And **the estimates carry a second guard**, a `not exists` mirroring
> `issue_estimate_version_monotonic`, because that trigger fires *before* `on conflict do
> nothing` can skip a row: without it a second application would fail the migration instead
> of writing nothing.
> `V029` ([#132](https://github.com/NobuData/ouroboros/issues/132)) opens the **workflow**
> domain with [`workflows`](migrations/V029__workflows_versions.sql) and
> `workflow_versions` — the entities mockup 04's rail lists, and the version history its
> `v14` chip and **Publish v15** button are two views of. It is decision **P1** made
> structural: *drafts are mutable, published versions never change*, because a run pins the
> version it executed and silently editing that definition would rewrite what every such run
> did. Three of its choices are worth knowing before reading it. **The draft is the row with
> `version is null`** rather than a row carrying an `is_draft` flag: a draft has no number
> because publishing is what confers one, and one column cannot disagree with itself the way
> a flag and a number can — *at most one draft* is then a partial unique index rather than a
> count somebody remembered to take. **Publishing promotes that row in place** to the next
> number, which makes the mockup's button literal and makes *a draft exists* mean *there are
> unpublished changes*, a signal a copy-on-publish model could only recover by comparing two
> jsonb documents. And **`current_version` is a pointer, not a cache** of `max(version)`:
> it records which published version is *in force*, held to a real version of its own
> workflow by a composite key, so rolling back to v12 after a bad publish is one column
> moving and no history changing. The opaque `workflow_tag` strings on `runs` and
> `queue_items` are deliberately **not** turned into foreign keys — decision **F8** has not
> weakened, and a closed run must still render under a workflow that has since been renamed —
> so the bridge is `slug`, bounded at the 64 characters those columns already allow and
> unique per workspace, which makes resolving a tag one indexed lookup with one answer.
> [`R__dev_seed_workflows.sql`](migrations/R__dev_seed_workflows.sql)
> ([#136](https://github.com/NobuData/ouroboros/issues/136)) is what finally writes both
> tables — see [The development seed](#what-it-does-with-the-work).

> `V030` ([#138](https://github.com/NobuData/ouroboros/issues/138)) opens the **sources**
> domain with [`ticket_sources` and
> `tickets`](migrations/V030__canonical_tickets.sql) — the source-agnostic intake
> read-model in which a Jira ticket and a GitHub issue are the same kind of row. It is
> decision **P6** made structural, and the reason mockup 04's trigger node reads *`Issue
> queued`* rather than *GitHub issue queued*: ingestion sources are pluggable from day one,
> so the model intake reads has to be the one every tracker can be mapped into. `V014`'s
> `github_issues` is GitHub-shaped in four ways that each become a special case the moment a
> second provider arrives — a repository foreign key, an integer `number`, and the two `gh_`
> timestamps and `gh_url` — and the canonical answers are `external_id` (identity, unique
> within its source), `external_key` (the display form), `external_url`, `source_created_at`
> / `source_updated_at`, and `meta` for the rest. **The repository linkage does not
> disappear, it moves** into the source's `config` and the ticket's `meta`, where
> `tickets_meta_idx` keeps the *Repository* filter an index scan without making it a column
> four of the five kinds hold null.
>
> **It is additive, and that is the whole of its relationship with `github_issues`.** The
> issue was filed recording that intake epic K was unbuilt and concluding that this
> migration replaces `V014`; the repository has since said otherwise — `V014`, `V026`,
> `V027` and `V028` all landed, and three `ouroboros-rest` modules read them — so this is
> the generalizing migration the issue's own scope anticipated for that case. No row is
> copied, no foreign key is re-pointed, and nothing outside this module changes. The
> cut-over belongs to the ticket that changes the *writer*: Q.2
> ([#139](https://github.com/NobuData/ouroboros/issues/139)) is the `TicketSourceProvider`
> SPI and the sync loop, Q.3 ([#140](https://github.com/NobuData/ouroboros/issues/140)) the
> GitHub provider that maps into these columns. A migration that copied nine rows here while
> the shipped sync kept writing `github_issues` would not have delivered the canonical model;
> it would have delivered two records of one backlog, diverging from the first poll.
>
> Three of its choices are worth knowing before reading it. **`external_id` and
> `external_key` are two columns, not one** — Linear identifies an issue by a uuid and
> *shows* `ENG-123`, so a single column would have to be either the thing the API takes or
> the thing a person reads; GitHub is the case that hides this, because `485` and `#485`
> differ by one character. **The backlog's `number desc` sort becomes `source_created_at
> desc`**, because over a text identifier `'9'` sorts above `'485'` and a uuid has no order
> at all — what a reader wants from that sort is *most recently opened first*, which is
> exactly what a GitHub number happens to encode, and `tests/constraints.sql` asserts the
> two orderings genuinely differ over a mixed backlog. And **the sealed credential is kept
> out of read paths by a view rather than by a convention**: `ticket_sources_public` is every
> column but `credentials_encrypted`, so the secret is absent rather than merely unselected,
> and a later migration that widened it back fails the build.

> `V031` ([#139](https://github.com/NobuData/ouroboros/issues/139)) adds
> [`ticket_sources.status_reason`](migrations/V031__ticket_source_status_reason.sql) — the
> sentence behind the status dot. `V030` left it out on purpose and named this ticket as the
> one that would add it, because *"a reason has to be stored somewhere"* and the ticket that
> writes that read is the ticket that adds the column.
>
> Q.2's sync loop is the first thing that has ever had an opinion about why a source is not
> working, and its criterion is that the opinion is *"rate limited until 14:20"* rather than
> *"error"*. It has to be a second column because `status` is the right width for what reads
> it — the loop's own filter, and the colour of a dot — and the wrong width for a person: all
> four of the provider-neutral failure classes (`auth`, `rate_limit`, `not_found`, `upstream`)
> coarsen into `error`, and only the reason separates *rotate a token* from *wait* from *fix a
> project key*. Widening `status` instead would make every reader re-derive *may the loop poll
> this* from a longer list.
>
> A **sentence** rather than a code, because `ticket_sources_kind` admits `custom` and the set
> of ways a provider can fail is therefore open — a coded vocabulary would need a migration per
> new failure. Null exactly when there is nothing to say, non-blank when there is, and bounded
> at 200 characters: it is a rendered line, not a place to paste a stack trace.
> `ouroboros-rest/src/modules/ticket-sources/ticket-source.errors.ts` composes every value the
> column can hold from a closed set of phrases and never from a tracker's error body.
>
> Deliberately **not** constrained to accompany `status = 'error'`: a paused source may keep
> the reason its last poll produced, and a status set by hand has none. The loop writes the
> pair in one statement, which is a property of one writer rather than of every writer, and a
> CHECK is for the second. `ticket_sources_public` gains the column — it is the opposite of a
> secret — appended last, so `V030`'s ten keep their ordinals.

> `V032` ([#143](https://github.com/NobuData/ouroboros/issues/143)) adds
> [`queue_items.workflow_version` and `queue_items.workflow_pin_reason`](migrations/V032__queue_items_workflow_pin.sql)
> — the pin R.1's trigger service stores on every queued issue: which version of the workflow
> in `workflow_tag` was in force at the moment of queueing, and which rung of the resolution
> order chose it (`explicit`, `predicate`, `most_specific`, `alphabetical`, `suggested`).
>
> There is **no `workflow_slug` column**: `workflow_tag` already holds the slug, and a second
> column a CHECK held equal to it would store nothing new. The version is nullable because a
> workflow with nothing published has nothing to pin, and every row queued before R.1 reads with
> both columns null. A version without a reason is refused; a reason without a version is allowed
> on purpose. Neither half is a foreign key (decision F8), and nothing ties the pin to
> `workflows.current_version` — a later publish moves the pointer and must not move the pin.

> `V033` ([#167](https://github.com/NobuData/ouroboros/issues/167)) adds
> [`workflow_versions.edited_in`](migrations/V033__workflow_draft_editor.sql) — which editor last
> wrote a workflow's draft, `visual` or `code`. Decision **C3** gives a workflow one draft and two
> editors, and a stale save's `409` names the editor whose change it lost to; the etag records
> that the draft moved, and this column records what moved it.
>
> Null is a draft neither editor has written — one `POST /api/v1/workflows` created, a seeded one,
> and every draft from before `V033`. **Only a draft records its editor**
> (`workflow_versions_edited_in_draft_only`): publishing writes a row of its own, and the
> constraint also stops the one update `V029` lets a published version take — the publisher's
> set-null, which its trigger recognises by `V029`'s own column list — from writing an editor
> onto a frozen row.

> `V034` ([#272](https://github.com/NobuData/ouroboros/issues/272)) opens the **planning**
> domain with
> [`draft_batches` and `ticket_drafts`](migrations/V034__draft_batches_ticket_drafts.sql) —
> mockup 09's *Generate Tickets* card as rows: the prompt, the optional outline, which planner
> answered, the target tracker and milestone, and the six `OTA-1`…`OTA-6` drafts under it.
> Decision **N1** is the whole reason they are rows — the page's safety promise is a review
> step, and a response held open in a browser tab cannot be re-opened tomorrow, reviewed by
> somebody else, or asked what happened to each draft when a push half succeeded.
>
> `planner` is **shaped rather than enumerated** (decision **N2**): `outline-v0` today,
> `llm-v1` with AN.1 ([#289](https://github.com/NobuData/ouroboros/issues/289)), and
> `analyzer-vN` for the Build Analyzer's batches
> ([#514](https://github.com/NobuData/ouroboros/issues/514)) — a family parameterised by a
> number no CHECK here can enumerate, so the rule is a name and a version rather than a list.
> Each draft records what happened to **it**: `pushed` with its ticket, or `failed` with a
> structured `push_error` — a `code` the card can branch on, never a stringified exception —
> and **`pushed` is terminal**, because a tracker will not un-create an issue.
>
> It also amends `V026` ([#100](https://github.com/NobuData/ouroboros/issues/100)) with a
> nullable **`draft_id`**, which is decision **N3**: there is one sizer in the product, so a
> draft is sized by the same table and the same orchestrator a mirrored issue is. An estimate
> now has exactly one subject, and because the column cascades from the *draft*, regeneration
> replaces the unselected drafts without orphaning the estimates of the ones that remain.
> `epic_id` is deliberately absent — AK.3
> ([#274](https://github.com/NobuData/ouroboros/issues/274)) adds it in the migration that
> creates the epics it would reference.

> `V035` ([#273](https://github.com/NobuData/ouroboros/issues/273)) adds
> [`ticket_dependencies`](migrations/V035__ticket_dependencies.sql) — the **`blocks` relation
> over drafts and live tickets alike**, which is decision **N4**. Mockup 09 draws it twice
> without saying so: the draft rows' `blocks OTA-3` note in the *Generate Tickets* card, and the
> **Backlog Health** card's `Blocked 4` meter over the live backlog. Those are the same relation
> at two moments in its life, so each end of an edge is **either a draft or a ticket** — a pair of
> nullable references with a CHECK admitting exactly one — and AL.3
> ([#279](https://github.com/NobuData/ouroboros/issues/279)) rewrites draft references to ticket
> references in the same transaction that creates the tickets. A batch caught half way through a
> push therefore has a *coherent* graph rather than an inconsistent one: some edges
> draft-to-draft, some ticket-to-ticket, some spanning.
>
> Three rules are worth knowing before reading it. `ticket_dependencies_pair_key` is `unique
> nulls not distinct`, because three of its four columns are null in any row and under the
> default rule the same edge would be unique against its own twin every time — `V012`'s
> argument, a second table on; `origin` (`planned` authored here, `synced` mirrored back from a
> tracker's native relations) is deliberately **outside** that key, so a sync adopts an edge
> Ouroboros authored instead of doubling it in the Blocked meter, which counts **both**
> provenances. And there is **no acyclicity constraint**: detecting a cycle means walking the
> graph, so AL.4 ([#280](https://github.com/NobuData/ouroboros/issues/280)) enforces it on every
> write and this schema's job is to keep a stored cycle *findable* — which AK.5's
> ([#276](https://github.com/NobuData/ouroboros/issues/276)) recursive-CTE probe does, over
> `coalesce(draft_id, ticket_id)` as node identity. A cycle is not an error anybody sees; it is a
> batch that can never be pushed, because a push runs in dependency order and a cycle has none.

> `V036` ([#274](https://github.com/NobuData/ouroboros/issues/274)) adds
> [`planning_epics`, `epic_tickets` and `epic_mirrors`](migrations/V036__planning_epics_mirrors.sql)
> — mockup 09's **Roadmap** card, whose five lanes become rows, and with them the
> `draft_batches.epic_id` column `V034` deferred to the migration that could create the epics it
> references. It is decision **N5** (option 4-A), the **ownership split**: Ouroboros owns a lane's
> dates, tint, status and order — planning *intent*, which no tracker stores — while the tracker
> owns ticket content. There is no field both sides can edit, so there is nothing to merge, and
> that is what makes two-way sync tractable rather than a merge problem nobody wins.
>
> The consequence worth knowing is a number that is deliberately **not** a column.
> `12 issues · 8 done` is tracker truth, so storing it would guarantee it goes stale — the chip
> would read `8 done` while GitHub said nine, and nobody could tell which to believe. There is no
> counter anywhere on these tables; `planning_epic_progress` computes it from joined ticket states
> on every read, as a view rather than an expression each caller re-types, for
> `ticket_sources_public`'s reason: AL.4 ([#280](https://github.com/NobuData/ouroboros/issues/280))
> and AM.4 ([#286](https://github.com/NobuData/ouroboros/issues/286)) both need it, and two
> hand-written counts would eventually disagree about which states are done.
>
> Three rules are worth knowing before reading it. The month columns are nullable **as a pair**
> and held to the first of the month, because the gantt's axis is months and half a range is a bar
> with one end — which is what makes `Zephyr 4.2 migration`, the dashed lane with no dates at all,
> a first-class row rather than one carrying placeholders and a flag saying to ignore them.
> `sort_order` is unique per workspace and **deferrable**, because two lanes sharing a number have
> no deterministic order and a reorder should be plain SQL inside one transaction
> (`task_kinds.sort_order`'s arrangement). And `epic_mirrors_epic_source_kind_key` is an
> **idempotency key** rather than decoration: it is what makes a second push adopt the parent issue
> it already created instead of creating a second one and splitting the epic across two containers
> — with `kind` inside the key, because a parent issue and a milestone in one source are two
> containers for one epic.

> `V037` ([#280](https://github.com/NobuData/ouroboros/issues/280)) adds
> [`ticket_drafts.provenance`](migrations/V037__ticket_draft_provenance.sql) — `planned` or
> `edited`. AL.4's planning API lets a reviewer rewrite a draft before it is pushed, and a draft a
> person rewrote must not be credited to the planner that produced the original. Closed, default
> `planned`, and never reset: regeneration replaces unpushed drafts with new rows rather than
> updating them. The research-provenance fields #624's amendment asks for wait for #624, whose
> tables they would reference.

> `V038` and `V039` ([#281](https://github.com/NobuData/ouroboros/issues/281)) are AL.5's — mockup
> 09's *Backlog Health* footnote, *"Estimator re-runs nightly on unsized issues"*, made a real job.
> [`V038`](migrations/V038__ticket_estimates.sql) adds `issue_estimates.ticket_id`, a **third
> subject** by `V034`'s pattern, so the one estimation pipeline can size canonical tickets:
> `issue_estimates_one_subject` now counts three columns, and a ticket gets its own version key and
> monotonic trigger. [`V039`](migrations/V039__reestimation_runs.sql) adds `reestimation_runs` —
> one row per night, **unique by night** so only the first replica to start runs it — and
> `reestimation_run_counts`, the per-workspace counts kept apart because a count of somebody's
> backlog is tenant data. Together they are what the card's last-run tooltip reads.

> `V040` ([#249](https://github.com/NobuData/ouroboros/issues/249)) opens the **build farm** —
> `runner_pools`, `runners`, `enrollment_tokens`, `runner_pool_windows`, `build_jobs` and
> `build_log_chunks`, which mockup 08 is a projection of. Three of its rules are worth knowing
> before reading it. `runners` is the one table in this schema that holds **live state**: a
> heartbeat every ten seconds writes `status`, `last_seen_at` and a telemetry snapshot, and every
> page load reads them back — so `runners_presence_idx` is shaped by a background sweep rather
> than by a page, and **observation and intent are two columns**: `status` is what the fleet last
> saw (`offline` is a measurement) and `desired_state` is what an operator decided (`draining` is
> a choice), with constraints that stop either from contradicting the other.
> `build_jobs.run_id` is **nullable on purpose** (decision **B6**): MVP builds are API- and
> UI-submitted, workflow execution is v2, and the column exists now so
> [AJ.3](https://github.com/NobuData/ouroboros/issues/265) fills it in rather than migrating a
> live table later. And the per-job **log cap is a trigger** — `build_log_chunk_cap()` clamps a
> job's stream at `build_jobs.log_cap_bytes`, assigns `byte_start` from the job's own running
> total, and writes an **elision marker** on the chunk it clamps, so the UI renders *"4.2 MB
> elided"* rather than a log that stops mid-line. Tenancy is held by **composite foreign keys**
> throughout: every reference between these tables carries `organization_id`, so a job on another
> workspace's runner is a row PostgreSQL refuses rather than a filter a service has to remember.

> `V041` ([#250](https://github.com/NobuData/ouroboros/issues/250)) gives that farm a **certificate
> authority**: `farm_authorities`, one per workspace with its private key as an AD.1 envelope, and
> `runner_certificates`, every certificate that authority has issued — which is also the
> **revocation list** the gateway ([AH.3](https://github.com/NobuData/ouroboros/issues/251)) checks
> at each handshake. Three rules carry the weight. `farm_authorities_key_sealed` means a row
> holding a plaintext CA key **cannot exist**, whoever the writer is; `runner_certificates_live_idx`
> is a partial unique index that gives a runner **at most one live certificate**, so *revoke this
> runner* is an unambiguous instruction rather than one a service has to get right; and the
> **bearer fallback carries its own evidence** — `workspace_settings.runner_bearer_fallback` is the
> switch, off by default, and `runners_bearer_sealed`/`runners_bearer_with_fallback` are the exact
> mirror of `V040`'s `runners_cert_serial_with_mtls`, so neither security mode can exist without
> the thing it authenticates with and neither can carry the other's. Rows in
> `runner_certificates` are **never deleted**: a revocation that vanished would be a serial the
> handshake check cannot find, and *not found* has to mean *refuse*.

> `V042` ([#251](https://github.com/NobuData/ouroboros/issues/251)) is what the farm's **agent
> gateway** has to remember. `runner_terminal_frames` is the receiver's half of the runner
> protocol's resume rule: every `job.finish` an agent delivers is recorded by its envelope id in
> the same transaction that applies it to its build, **before** the receipt is written, so a
> re-send after a dropped socket finds its row and is answered as a duplicate instead of
> finishing the build twice. The primary key `(runner_id, frame_id)` is the exactly-once rule —
> two copies racing each other lose to it rather than to a check — and it is keyed per runner
> rather than per session, because a reconnect that could not resume still delivers the frame
> it was holding. The ledger is **append-only** (`runner_terminal_frames_no_update`), a frame
> that finished a build names it (`runner_terminal_frames_applied_names_job`), and one that
> finished nothing is still recorded, so the agent can stop re-sending. `runners.hostname` is
> what `hello` reports — for recognition, never identity.

> `V043` ([#252](https://github.com/NobuData/ouroboros/issues/252)) gives a pool the command its
> builds usually run: `runner_pools.default_command`, which build dispatch copies onto a
> submission that names none and AI.5's submit dialog prefills. It is stored in the form
> `build_jobs.command` already holds — the canonical rendering of an argv, plain words bare and
> others single-quoted — so a fallback copies it unchanged, and `ouroboros-rest` reads it back as
> argv without ever splitting free text. Nullable, because a pool with no usual command is
> ordinary; `runner_pools_default_command_shape` refuses a blank one, which would dispatch
> builds with nothing to run.

> `V044` ([#253](https://github.com/NobuData/ouroboros/issues/253)) is what build-log ingest has to
> remember so a log says, once and truthfully, where its holes are. A log loses bytes in four
> places — the agent's throttle, the ingest rate guard, a frame lost with a socket, the per-job
> cap — and the columns keep them by *position*: before a chunk (`build_log_chunks.elided_bytes`,
> `missing_chunks`) or after the last stored byte (`build_jobs.log_dropped_bytes`, widened to carry
> the agent's own tail drops beside the cap's, and `log_missing_chunks`). The agent's cap and the
> control plane's describe the same end of the same log, so they are one figure and the console
> draws one marker. `build_jobs.log_agent_dropped_bytes` is the agent's running total, which is how
> a `job.finish` is split into drops already placed and its tail. `log_swept_at` is the retention
> sweep's tombstone — logs are removed whole, and only a finished job's
> (`build_jobs_log_swept_when_finished`).

> `V045` ([#298](https://github.com/NobuData/ouroboros/issues/298)) opens the **Run Console**
> domain with `run_stages` — one row per stage × attempt — and the three facts mockup 10's page
> head is rendered from: `runs.loop_seq`, `branch_name` and `workflow_version_pin`. Three of the
> stepper's facts are history rather than state, and `runs`' current-stage columns can hold none
> of them: a duration needs two timestamps, `attempt 2/3` needs a row that knows attempt 1
> happened and a snapshot of what the pinned workflow allowed, and the warn note
> — *"attempt 1 failed tests — loop returned from gate ↺"* — is the record of a gate sending the
> loop backwards. Roadmap decision **R1** says that note must be composed from the transition and
> never typed, so `note` is `generated always … stored` over three structured columns held to the
> workflow DSL's own vocabulary: **PostgreSQL refuses any statement that supplies one**, from any
> client in any role, which is `V018`'s answer to the same problem at `escalation_rules.display`.
> `loop_seq` — the `Loop #1847` counter — is allocated per workspace under a transaction-scoped
> advisory lock, so two runs starting in the same millisecond serialise rather than collide on
> `runs_organization_loop_seq_key`; a rolled-back transaction still takes its number with it,
> which is the one gap a display counter can afford. `V008`'s three stage columns are **kept**:
> `runs_with_stage` answers them from stage history where a run has any and from those columns
> where it has none, so a dashboard read moves onto the derivation one at a time and their
> removal is a later migration.

> `V046` ([#299](https://github.com/NobuData/ouroboros/issues/299)) adds `run_events` — mockup
> 10's **agent transcript**, which is the product's flight recorder: the artifact somebody reads
> when a run goes wrong at 3 a.m., and the thing every other card on the run page summarises.
> Roadmap decision **R3** is that it is *typed rather than logged*, so the chip, the tool tag,
> the stage and attempt the stepper filters by and the diff's `{kind, text}` hunks are columns
> and a checked `payload` instead of text somebody has to parse. Decision **R4** is that it never
> fabricates model reasoning, and two rules make that checkable: a `model` entry cannot exist
> without naming its model, stage and attempt, and `simulated` is **raised to the run's own** by
> the append trigger — `runs.simulated`, which the ingestion contract sets from the principal
> that opened the run and which is fixed from the run's first entry onwards — so no client can
> report an unwatermarked entry into a simulated run. `seq` is dense from 1 and the database's to
> assign, which is what makes the `?after=` cursor exact. The caps are `#247`'s honesty pattern
> carried from bytes onto rows, with the one difference the medium forces: a log can be clamped
> mid-line, but half an event is not an event, so an entry past `runs.event_cap` or
> `runs.event_byte_cap` is refused **whole** and the first refusal becomes a `system` **elision
> marker** in the transcript that records how many entries and bytes were dropped and over what
> span — a hole the console draws rather than a transcript that stops without saying so. The
> table is append-only by trigger and by grant, with exactly one permitted update: that marker's
> own figures, growing. And the JSONL projection is specified to the byte —
> `ouroboros.run_events_jsonl`, one row to one line, with
> [`tests/lib/run-events-jsonl.sql`](tests/lib/run-events-jsonl.sql) holding it to its word.

> **If you have a database from before `V002` landed, reset it.** `V002` filled a version
> number `V003` had already passed, so a database carrying `V003` sees a pending
> migration *below* its current version — which `validate` rejects, and `migrate`
> therefore refuses before applying anything:
>
> ```
> ERROR: Validate failed: Migrations have failed validation
> Detected resolved migration not applied to database: 002.
> ```
>
> `docker compose down -v && docker compose up` from the repo root, or
> `ouroboros-db/scripts/clean-dev` followed by `ouroboros-db/scripts/migrate` for a
> database the stack does not own. Nothing is lost that a dev seed will not put back.
> `outOfOrder` stays off in [`flyway.toml`](flyway.toml) rather than being loosened for
> one gap that cannot recur — every version through `V003` is now taken, and a database
> created from empty applies them in order and never meets this.

## Purpose

The **tenancy database** — the PostgreSQL schema every other module hangs off, and the
Flyway migrations that own it. Organizations and their sign-in domains, people and the
accounts they authenticate with, per-organization membership roles, sessions, and GitHub
org/repo enablement live here — and, since `V008`, the **read-model** the product renders
over that boundary: what the loop has been doing, one row per run, since `V009` what
it will do next, one row per queued issue, since `V010` what it has spent doing so,
one row per call, and since `V011` what each workspace has told the loop it may do
unattended, one row per organization. Since `V014` it also holds the **backlog those runs
are drawn from** — one row per mirrored GitHub issue, which is a cache and not a fork
(decision **K3**). Since `V015` it also holds the **model providers a workspace has
configured and the aliases its routes name** — the foundation mockups 06, 07 and 21 all
read, and the only place a raw provider model string lives (decision **M1**) — and since
`V016` the **routing matrix over them**: which kinds of work exist, the one route each has,
and the ordered chain of aliases that route falls back through — with `V018` adding the
**escalation rules that modify a route** when an issue is large, labelled or docs-only.

Flyway is the **sole owner of DDL**. No application module creates or alters tables;
`ouroboros-rest` reads and writes through Kysely against a schema this module defines.

## Stack

| Concern | Choice |
|---|---|
| Database | PostgreSQL 17 |
| Migrations | Flyway 13, run from its container — no local Java required |
| Language | Plain SQL (no templating, no ORM DSL) |
| Schema | `ouroboros` |
| Configuration | [`flyway.toml`](flyway.toml) — one file, read by every path |
| CI | `flyway migrate` + `validate` against a throwaway PostgreSQL |
| Image | [`Dockerfile`](Dockerfile) — the migrations as a one-shot task, published by `publish/db` |

## Run

### The database

The short way, from the **repo root**, is the same command that starts everything else:

```bash
yarn dev                      # this database, migrated, plus the application services
```

That runs [`scripts/dev`](scripts/dev) first and waits for it: PostgreSQL up, healthcheck
passed, migrations applied. Run it directly — `ouroboros-db/scripts/dev` — for the data
tier alone. It goes through the compose file for both halves, which is what guarantees
the migration lands in the database it just started; `run.sh` below is the tool for
migrating a database that is already running somewhere else.

The stack it drives comes from the repo-root compose file
([#10](https://github.com/NobuData/ouroboros/issues/10)), and is equally usable by hand.
Run these from the **repo root**, not from this directory:

```bash
docker compose up             # PostgreSQL 17 on :5432, migrations applied
docker compose up db          # the database alone, without a migration pass
docker compose down           # stop; the data survives
docker compose down -v        # reset — drops the volume and all data
```

`up` starts PostgreSQL, waits for its healthcheck, then runs `flyway migrate` and exits;
the database stays up. It is safe to repeat — Flyway applies only what is pending, so a
second `up` reports "no migration necessary". The stack is the one place the development
seed is switched on, so what it leaves behind is a database with the demo tenant in it —
see [The development seed](#the-development-seed). No `.env` file is needed: every value
has a development default. Copy the repo-root `.env.example` to `.env` to change any of
them.

Confirm what was applied by reading Flyway's own history table:

```bash
docker compose exec db psql -U ouroboros -d ouroboros \
  -c 'select version, description, success from ouroboros.flyway_schema_history
      order by installed_rank;'
```

Or connect from the host with the development credentials — user `ouroboros`, password
`ouroboros`, database `ouroboros` on port 5432:

```bash
PGPASSWORD=ouroboros psql -h localhost -p 5432 -U ouroboros -d ouroboros
```

A reset is `docker compose down -v` followed by `docker compose up`: the named volume is
dropped, PostgreSQL initialises an empty cluster, and every migration is applied again
from scratch.

If `up` fails with `bind: address already in use`, something else on the machine already
holds 5432 — a system PostgreSQL, or another project's stack. Publish this one somewhere
else instead of stopping that:

```bash
OURO_DB_PORT=45432 docker compose up
```

The port only changes where the database is published on the host; inside the compose
network it is always `db:5432`, and it is only ever published on `127.0.0.1`.

### The four commands

`docker compose up` migrates on the way up, which covers most days. These are for
everything else — a migration you just wrote against a database already running, a
PostgreSQL installed on your machine, a server across the network:

```bash
ouroboros-db/scripts/migrate     # apply what is pending
ouroboros-db/scripts/info        # applied and pending versions
ouroboros-db/scripts/validate    # checksums and naming rules
ouroboros-db/scripts/clean-dev   # drop everything — development databases only
```

They connect by host and port like any other client, so **nothing has to be
containerised**. Out of the box they point at `localhost:5432`, which is both a default
PostgreSQL install and — with the port the compose stack publishes — the compose
database. Point them anywhere else with the `OURO_*` variables below:

```bash
OURO_DB_PORT=45432 OURO_DB_SCHEMA=scratch ouroboros-db/scripts/info
```

`clean-dev` drops **every object in the schema**, which is the reset for a migration you
have edited after it was applied — `validate` will refuse that database until you do.
Three things stand in its way, and all three have to be got past deliberately:
`flyway.toml` disables `clean` outright, only [`flyway.dev.toml`](flyway.dev.toml)
re-enables it and only `clean-dev` loads that file, and `clean-dev` itself refuses any
host that is not this machine and asks for the database name back before it drops
anything:

```bash
ouroboros-db/scripts/clean-dev          # names the database, waits for you to type it
ouroboros-db/scripts/clean-dev --yes    # no prompt — scripted resets and CI
```

There is deliberately no `scripts/clean`.

### The development seed

`docker compose up` leaves a database with data in it: the demo content every screen in
[`../docs/mockups`](../docs/mockups) is drawn around — mockup 01 Step 2's three
organizations and mockup 02's dashboard, number for number — so a UI has something to
render and an e2e test has something to assert against by name.

It is **ten migrations**, because they answer ten questions and change on different
days:

| File | Holds | Issue |
|---|---|---|
| [`R__dev_seed.sql`](migrations/R__dev_seed.sql) | *Who exists* — the workspaces, the people, and where the loop may run | [#23](https://github.com/NobuData/ouroboros/issues/23) |
| [`R__dev_seed_dashboard.sql`](migrations/R__dev_seed_dashboard.sql) | *What the loop has done* — runs, queue, spend, and the auto-merge switch | [#68](https://github.com/NobuData/ouroboros/issues/68) |
| [`R__dev_seed_intake.sql`](migrations/R__dev_seed_intake.sql) | *What it has an opinion about next* — mockup 03's nine mirrored issues and the estimates behind their effort chips | [#103](https://github.com/NobuData/ouroboros/issues/103) |
| [`R__dev_seed_providers.sql`](migrations/R__dev_seed_providers.sql) | *What it is allowed to call* — mockup 07's five provider cards, their discovered models, and the spend behind their meters | [#221](https://github.com/NobuData/ouroboros/issues/221) |
| [`R__dev_seed_routing.sql`](migrations/R__dev_seed_routing.sql) | *How it decides which one to call* — mockup 06's aliases, task kinds, chains, escalation rules, and the routed calls its numbers are computed from — and, since [#582](https://github.com/NobuData/ouroboros/issues/582), *what the registry says about the same names*: mockup 21's eighth (unbound) alias, the params behind every chip, the one price override, and run #482's resolution snapshot | [#192](https://github.com/NobuData/ouroboros/issues/192), [#582](https://github.com/NobuData/ouroboros/issues/582) |
| [`R__dev_seed_audit.sql`](migrations/R__dev_seed_audit.sql) | *Who touched the keys* — the credential trail mockup 07's **Audit log** sheet opens, including a failed rotation and a lease grant with no actor | [#225](https://github.com/NobuData/ouroboros/issues/225) |
| [`R__dev_seed_sources.sql`](migrations/R__dev_seed_sources.sql) | *Where the work comes from* — the two trackers `acme-robotics` ingests from: a `github` source over its four enabled repositories, and a `jira` source with no repository in it at all, both connected (sealed development credentials, `active`) since [#275](https://github.com/NobuData/ouroboros/issues/275) | [#138](https://github.com/NobuData/ouroboros/issues/138), [#275](https://github.com/NobuData/ouroboros/issues/275) |
| [`R__dev_seed_ticket_planning.sql`](migrations/R__dev_seed_ticket_planning.sql) | *The work and the plan over it* — mockup 09's planning page: a canonical backlog of fifty-two GitHub tickets whose aggregates are the *Tracker Sync* and *Backlog Health* cards, the five gantt lanes with months relative to `now()`, and the six-draft OTA batch sized through `issue_estimates.draft_id` | [#275](https://github.com/NobuData/ouroboros/issues/275) |
| [`R__dev_seed_farm.sql`](migrations/R__dev_seed_farm.sql) | *The machines that build it* — mockup 08's build farm: two pools with their executor configuration, six runners of which one is `removed` and one fell back to a bearer token, forty-eight builds whose aggregates are the whole stat row (`23` today, `19 clean · 3 retried · 1 failed`, `4m 12s ▼ 38s`, `78%`), and the five chunks of the LIVE card's log. **Dev-only matters more here than anywhere else in the directory: a `runners` row claims a machine somewhere is heartbeating** | [#249](https://github.com/NobuData/ouroboros/issues/249) |
| [`R__dev_seed_workflows.sql`](migrations/R__dev_seed_workflows.sql) | *What it does with it* — mockup 04's studio: the rail's five workflows, `standard-fix`'s twelve-node canvas at v14 with the fourteen versions that number implies, the draft the page head's *Last edited 2h ago* is read from, and the paused `hotfix-p0` behind the rail's err-dot | [#136](https://github.com/NobuData/ouroboros/issues/136) |

> **The names are load-bearing.** Flyway applies repeatable migrations in the order of
> their *descriptions*, and every row the later seeds write finds its parent by natural key —
> so `dev_seed_audit`, `dev_seed_dashboard`, `dev_seed_farm`, `dev_seed_intake`,
> `dev_seed_providers`, `dev_seed_routing`, `dev_seed_sources`, `dev_seed_ticket_planning` and
> `dev_seed_workflows` all have to sort after `dev_seed`, `dev_seed_routing` after `dev_seed_providers` besides,
> since every alias binds to a connection by kind and name, and `dev_seed_ticket_planning`
> after `dev_seed_sources`, since every ticket hangs off the GitHub source — which is why it
> is not called `dev_seed_planning`. They do. `tests/seed.test.sh`
> asserts the whole order, because the failure mode is silent: applied in the wrong order,
> every join finds nothing, every insert inserts nothing, and a second `migrate` does not put
> it right (Flyway re-applies a repeatable migration only when its checksum changes).
>
> **`dev_seed_audit` sorts *before* `dev_seed_providers`, and is the one seed that does not
> care.** Its events name their connections by literal uuid rather than by join, because
> `audit_events.subject_id` is deliberately non-referential — an event about a connection has
> to outlive the connection — so there is nothing to join to and nothing for the ordering to
> break. The alternative would have been a seed that finds nothing on the first pass and
> inserts on the second, which is exactly the non-convergence the rule above exists to
> prevent.

#### Who exists

| Row | Value |
|---|---|
| Organizations | `acme-robotics` — *Acme Robotics*, shared · `acme-labs` — *Acme Labs*, shared · `kensuenobu` — Ken's personal workspace (`metadata.personal = true`) |
| Domain | `acme-robotics.dev`, primary — the address domain mockup 01 resolves acme-robotics from |
| People | `ken@acme-robotics.dev` · `maya@acme-robotics.dev` · `jorge@acme-robotics.dev` |
| Roles | acme-robotics: Ken owner, Maya admin, Jorge member · acme-labs: Maya owner, Ken member · kensuenobu: Ken owner |
| Passwords | every person signs in with `ouroboros-dev-password` — a `credential` account holding a real scrypt hash BetterAuth's verifier accepts; the form only exists on a non-production stack |
| GitHub | one GitHub-shaped account, Ken's, so "Continue with GitHub" has someone deterministic to resolve to |
| Orgs | `acme-robotics` enabled · `acme-labs` disabled · `kensuenobu` enabled |
| Repos | acme-robotics: 4 enabled, incl. `helios-firmware` · acme-labs: none · kensuenobu: 2 enabled — all default branch `main` |

#### What the loop has done

All of it belongs to `acme-robotics`, and every window is relative to `now()`, so the
"today" and "seven day" arithmetic holds however long after the seed was written the stack
is brought up.

| Table | Rows | What mockup 02 renders from them |
|---|---|---|
| `runs` | 53 | 3 live (`#482` coding · `#479` building · `#476` in review), 50 closed — of which the four newest are the *Recently closed* card, `#474 → PR #512` … `#465 → PR #504` |
| `queue_items` | 12 | *Queued issues* `12`, `est. 9h 40m`, and the five the *Up next in queue* card draws — `#485` M, `#486` L, `#488` XS, `#490` XL, `#491` S |
| `run_stages` | 20 | the three live loops' stage timelines ([#298](https://github.com/NobuData/ouroboros/issues/298)) — `#482` on `Implementing` attempt 2 of 3 with attempt 1 failed and the gate-return note composed from the transition, which is mockup 10's stepper. The fifty closed runs keep `V008`'s columns and no history, so both sides of the `runs_with_stage` fallback are exercised by one database |
| `token_usage` | 12 | *Token spend · today* — `4.2M` tokens, `≈ $18.60 across 4 providers`; the `≈` is the three unpriced local-inference events |
| `workspace_settings` | 1 | *Auto-merge when checks pass*, on |

The *Loop pulse* metrics are aggregates over the same runs: **92%** autonomous merge rate
(46 merged of the 50 closed), **14m 20s** average cycle time (over the 29 that closed in
the trailing seven days), **2** human interventions this week, and **27** merged in seven
days against **19** the week before — the `▲ 8`.

> **One of the card's numbers cannot be true of one seven-day window**, and the migration
> header says so at length rather than leaving #70 to find out: 27 merged and 2
> interventions make the trailing week's merge rate 93.1%, and no integer count of closed
> runs divides 27 into 92%. The seed makes 92% exact over the population it can — the whole
> fourteen days it spans, 46 of 50 — and states both figures.

#### What it has an opinion about next

Mockup 03's backlog, all of it in one repository — `acme-robotics / helios-firmware`,
which is the repository that page's breadcrumb names. Every instant is relative to
`now()`, so *opened 2d ago* and the trace's *2m ago* stay true however long after the seed
was written the stack is brought up.

| Table | Rows | What mockup 03 renders from them |
|---|---|---|
| `github_issues` | 9 | The table's nine rows, `#483`–`#491` — titles, GitHub's own labels, authors, and the `#485` body the detail panel excerpts. Seven `sized`, `#483` `estimating`, `#490` `needs_human`; all nine `open` |
| `issue_estimates` | 9 | The *Effort* chip and its confidence, the *Suggested workflow* tag and the *Routed model* pill for eight of them — and `#485`'s *AI Work Breakdown* field for field: three files, `~180k` tokens, a `12–18 min` cycle, `low` risk and the sentence under the meter |

The page head is an aggregate over those rows and computes to **"9 open issues. 7 already
sized."** The mockup prints 42/38, which is design copy over a backlog forty-two issues
deep; the seed's truth is nine, and the migration's header says why at length.

> **Three things on that page are deliberately not in the database**, because writing them
> down would make the product remember what it is supposed to compute — or claim a
> provenance nothing produced:
>
> * **the trace line.** `trace.estimator` is `heuristic-v0` on every row (decision **K10**),
>   `tokens_used` is `0` — a rule engine called no model — and `signals` is `[]`. The
>   mockup's *"sized by claude-sonnet-5 · 2m ago · 41k tokens"* over three retrieved signals
>   describes a knowledge layer that does not exist yet; those lines are **O.4**'s seeds to
>   supply honestly.
> * **the queue rows.** `queued` is not a `sizing_status` — it is a presentation over
>   `queue_items`, which DASH-F.5 already seeds. Six of its twelve are in this repository,
>   so the seeded backlog presents `#485`, `#490` and `#491` as queued where mockup 03 draws
>   `#486`, `#488` and `#489`. The two mockups disagree — mockup 02's queue card draws
>   `#485` at position 1 while mockup 03 calls it `sized` — and a thirteenth queue row
>   written from the intake seed would break *Queued issues* to decorate the backlog.
> * **the sync watermark.** `github_repos.issues_synced_at` and `issues_sync_cursor` stay
>   null: they are K.4's record of its own poll, and a seeded cursor would hand the first
>   real poll a watermark no poll produced. What the fixture can honestly say is per-row,
>   and `max(github_issues.synced_at)` is the freshness tag computed from it.
>
> Two rows are there for coverage rather than for the mockup, and both are the argument
> DASH-F.5 made for its one unestimated queue item. **`#487` is estimated twice** — a
> superseded `s`/55% under the mockup's `l`/71% — because against a fixture where every
> issue has one estimate, a latest-wins join and a `min(version)` join both pass.
> **`#488`'s breakdown names no files**, which `V026` makes valid on purpose: an estimator
> that cannot say which paths a change touches says so, and the panel renders the absence.

#### What it may call

Mockup 07's five cards, and everything on one of them that is not a live API call. All of
it belongs to `acme-robotics`, and it is drawn from three tables:

| Table | Rows | What mockup 07 renders from them |
|---|---|---|
| `provider_connections` | 5 | The five cards — *Anthropic Claude* `$600` cap, *Cursor* `$120`, *GitHub Copilot* `$95` and *degraded upstream*, *OpenAI-compatible · local vLLM* and *Ollama · workstation* with no cap at all. Every switch is on; every meta row reads *Added by Ken · <date> · last used <minutes> ago* |
| `provider_models` | 11 | The chips — four Anthropic models carrying `"tier": "priority"`, one apiece for Cursor and Copilot, two `local/…` from vLLM — and the workstation's pull-list, `qwen3-coder:32b` `19 GB`, `llama4:scout` `63 GB`, `phi4:14b` `9.1 GB` |
| `token_usage` | 11 | The month's spend behind the meters, *earlier this month* |

> **The meters are three seeds added together.** A card's *This month* figure is calendar-
> month spend over `token_usage`; the dashboard seed writes twelve events dated *today* and
> the routing seed writes the month's routed calls. So the providers seed writes the
> remainder — `$379.15` of Anthropic, `$62.30` of Cursor, `$68.80` of Copilot and 1.0M
> unpriced Ollama tokens — and the three together are the mockup's `$412.80`, `$64.10`,
> `$76.00` and *2.1M tokens on-box*. Nothing the providers seed
> writes lands on *today*, which is what keeps mockup 02's *Token spend · today* card
> exactly the dashboard seed's twelve events; `tests/seed.sql` asserts both totals and the
> rule that keeps them apart. On the first of a month there is no *earlier this month*: the
> rows fall on the last day of the previous one and the meters read the day's spend alone,
> which is the one day in thirty the cards are not the mockup's figures — asserted as such
> rather than left to be discovered.

The three cloud connections carry a sealed `ouro.v1.…` credential whose body decodes to
*dev-seed-value-not-a-real-credential-…*: it is a well-formed envelope, so the card renders
its masked key row and V015's envelope-only rule is exercised by the data a developer
actually has, and it is **not decryptable** — a real one is AES-256-GCM under a workspace
DEK bound to the row's id, which no SQL file can produce. *Reveal* against a seeded
connection therefore fails in the designed way rather than showing a key. The two local
connections carry none, because a local provider needs none.

#### How it decides which one to call

Mockup 06's routing screen, and everything on it. All of it belongs to `acme-robotics`, and
it is drawn from six tables plus the connections above:

| Table | Rows | What mockup 06 renders from them |
|---|---|---|
| `model_aliases` | 7 | The pills and their grey resolution lines — `coder-max` → *claude-fable-5 · Anthropic*, `coder-fallback` → *gpt-5-codex · GitHub Copilot*, `local-docs`, `local-free`, `coder-std`, `sizer`, and `second-opinion`, which no chain contains and the *security label* rule adds as a vote |
| `task_kinds` | 8 | The matrix's eight rows, in its order — the mono name and the grey line under it |
| `routes` | 8 | Each row's tag pill, and the inspector's policy triple: local fallback **on**, no floor, and `$2.50` — a cap only `implement-primary` carries |
| `route_hops` | 17 | The *Primary model* and *Fallback* columns, and the inspector's numbered rail — `coder-max → coder-fallback → local-docs`, with the mockup's two hop notes |
| `escalation_rules` | 3 | The card's three sentences, which V018 **generates** from the rules' structure rather than storing |
| `token_usage` | 370 | The routed calls every number on the screen is aggregated out of |

> **Not one figure on that screen is stored, and that is decision M7.** `$0.87` is the mean
> of fifteen `implement` costs, `41.0s` the median of fifteen `implement` latencies,
> `$412.80` a sum across three seeds and *31%* a ratio of two sums — so the seed shapes the
> *usage* and lets the aggregation land on the mockup. Storing the answers instead would
> leave the stats service ([#198](https://github.com/NobuData/ouroboros/issues/198))
> untested and the em-dash rule unverifiable: a number that was never computed cannot be
> *absent* in the way the rule requires. Each kind's calls are spread symmetrically around
> its figure, so the mean is exactly the centre and the median is exactly the row at it, with
> no rounding anywhere. `tests/seed.test.sh` asserts the file carries none of the rendered
> figures as a literal; `tests/seed.sql` computes all sixteen of them back.

> **`$0.00` is a price, not an absence.** The two local kinds route to vLLM and Ollama, and
> their rows carry `cost_cents = 0` — calls that were priced, at nothing. The earlier seeds'
> Ollama rows carry `null`, which says the other thing: *nobody priced this*. Both states now
> exist in one workspace, which is what makes
> [#92](https://github.com/NobuData/ouroboros/issues/92)'s honesty rule testable rather than
> promised — a re-pricing pass must fill the nulls and leave the zeros alone.

> **Two of mockup 06's spend figures cannot be reached by any seed.** *Spend by provider ·
> 30d* asks for `$96.40` of Copilot and `$54.10` of Cursor, while mockup 07's cards pin the
> same rows' calendar month at `$76.00` and `$64.10`. Thirty days is a **superset** of
> month-to-date, so a 30-day total can never be less than the month total inside it, and
> Cursor's figure is `$10.00` below one. Anthropic's `$412.80` and the local `$0.00` land
> exactly; the other two land on mockup 07's, which is the reading both screens can hold at
> once, and [#192](https://github.com/NobuData/ouroboros/issues/192) asks for the design to be
> amended. The seed's header carries the arithmetic and `tests/seed.sql` asserts all four.

**Nothing the routing seed writes lands on *today*** either, and its priced spend comes *out
of* the providers seed's remainder rather than on top of it — so mockup 02's *Token spend ·
today* card and mockup 07's month meters both read exactly what they read without it.

#### The work and the plan over it

Mockup 09's planning page, all of it in `acme-robotics`. **Every figure on the page is an
aggregate over these rows** and the migration contains none of them —
[`tests/seed.test.sh`](tests/seed.test.sh) refuses the literals and
[`tests/seed.sql`](tests/seed.sql) asserts each as the query that computes it.

| Table | Rows | What mockup 09 renders from them |
|---|---|---|
| `tickets` | 52 | `#540`–`#591` in the GitHub source, 42 open: *two-way sync · 42 issues*, the health card's `42 open`, **Sized** `38/42` (`sizing_status`; four newest are `unsized`) and **Stale > 30d** `6` (`source_updated_at`) |
| `ticket_dependencies` | 10 | **Blocked** `4` — six ticket edges, two of them `synced` — and the drafts' four *blocks OTA-3 / OTA-5* notes |
| `planning_epics` | 5 | The gantt's lanes, tints and order; months are offsets from the current month, so the current month is always the second column and TODAY never rots. *Zephyr 4.2 migration* has null months and status `proposed` |
| `epic_tickets` | 42 | The chips `12 · 8`, `9 · 2`, `14 · 0`, `7 · 0`, through `planning_epic_progress` |
| `draft_batches` | 1 | The *Generate Tickets* card: the OTA prompt, an `outline-v0` outline, GitHub, *Helios 2.1*, `sized` |
| `ticket_drafts` | 6 | `OTA-1`…`OTA-6` — titles and workflow tags, all selected and pending |
| `issue_estimates` | 6 | The effort chips and `✓ all sized`; their `est_minutes` sum to three loop-days, and their `est_tokens` priced at the bundled catalog's rates for the routing seed's aliases come to `$14` (decision N10) |

> **Each metric has a row that catches a nearly-right query.** A ticket blocked twice counts
> once; a ticket blocked only by a closed one does not count; ten closed tickets are `sized`
> and eight of them untouched for months, so a count that forgets `state = 'open'` reads 48/52
> and 14; one open ticket was updated 28 days ago; and ten open tickets belong to no lane.
>
> **No ticket number collides with another seed.** The intake mirror is `#483`–`#491` and the
> dashboard's runs and queue name `#300`–`#345` and `#465`–`#496`, so mockup 03 still computes
> *9 open · 7 sized* over `github_issues` while mockup 09 computes 42/38 over `tickets`.
>
> **Deliberately absent:** no `epic_mirrors` (nothing has been pushed), no `linear` source
> (its absence is the *Tracker Sync* card's **connect ↗**), no price rows (the `$` exists
> because the bundled rates already do), and no source sync stamps.

#### What it does with the work

Mockup 04's studio, all of it in `acme-robotics`. Two tables, and one of them holds documents
rather than columns:

| Table | Rows | What mockup 04 renders from them |
|---|---|---|
| `workflows` | 5 | The rail — `standard-fix`, `feature-loop`, `deps-refresh`, `docs-loop` and the paused `hotfix-p0` the err-dot belongs to — and the page head's title and `v14` chip |
| `workflow_versions` | 19 | `standard-fix`'s fourteen versions, one apiece for the other four, and the draft the head's *Last edited 2h ago* and its **Publish v15** button are both read from |

The definitions are P.2 documents
([`schemas/workflow-dsl/v1.json`](../schemas/workflow-dsl/v1.json)), and `standard-fix`'s v14
is the committed fixture `schemas/workflow-dsl/fixtures/valid/standard-fix.json` written out —
the canvas node for node, at the positions the mockup draws them at, with its twelve edges
including the dashed loop back from the gate to implement. A migration cannot read a file, so
the copy is closed from the other side:
`ouroboros-rest/src/modules/workflows/dsl.seed.spec.ts` runs the real validator over every
document in the seed and compares that one against the fixture, and
[`tests/seed.sql`](tests/seed.sql) asserts the graph against the mockup's own coordinates.

> **`v14` is fourteen rows, not a column with a 14 in it.** `workflow_version_next` (V029)
> holds version numbers dense from 1, so a workflow cannot be published straight to its
> fourteenth. What the seed does *not* do is invent thirteen graphs: v1–v13 are one six-node
> predecessor, each version raising the implement stage's token budget by 20k, and each change
> note naming the number its own document carries. That predecessor is also where the
> mockup's own disagreement with itself is resolved — see below.

> **The rail reads `12 stages · auto-merge` where the mockup wrote `6 stages`.** A stage is a
> node — the canvas toolbar's **Add stage** adds one, the inspector's **Delete stage** deletes
> one, and mockup 20 counts the same way — and the mockup's caption was written beside a
> canvas of six work stages that has since grown to twelve nodes.
> [#135](https://github.com/NobuData/ouroboros/issues/135) left the choice to this seed, which
> takes the ticket's twelve-node canvas and the caption it earns; the six-stage document the
> string was written for is v13. The other four captions are the mockup's exactly:
> `7 stages · auto-merge`, `5 stages · needs review`, `4 stages · auto-merge` and
> `5 stages · paused`.

> **The head's *used by 61% of runs* reads `used by 42% of runs`, and the seed does not fake
> it.** That share is computed over `runs`, where the dashboard seed's fifty-three rows in the
> trailing thirty days include twenty-two under `standard-fix`. No retagging reaches 61%
> either — 61% of 53 is 32.33, and 32 runs give 60% while 33 give 62% — so the mockup's string
> would need a different number of runs, which is mockup 02's figure and four of its cards'
> arithmetic. `tests/seed.sql` asserts 22 of 53, so an edit to either seed that moves the
> subline fails a test rather than a design review.

**`kensuenobu` and `acme-labs` get no dashboard rows at all.** That is not an omission: the
personal workspace is the *empty-state fixture* the zero-state cards
([#86](https://github.com/NobuData/ouroboros/issues/86)) are rendered against, so switching
the active organization to it is how a developer sees the empty dashboard. **Neither gets a
ticket, a roadmap lane or a draft batch** — mockup 09's guidance path
([#287](https://github.com/NobuData/ouroboros/issues/287)), whose generator footer has no `$`
to print. **Neither gets a
provider connection either**, which is the same fixture for mockup 07's *connect your first
provider* guidance ([#233](https://github.com/NobuData/ouroboros/issues/233)). Neither gets a
`workspace_settings` row either, which keeps "answered no" and "never asked" distinguishable
— `workspace_settings_effective` resolves both to `false`, and only it says which. **And
neither gets a workflow**, which is the studio's own empty state: a workspace that has never
opened it has an empty rail and a **+ New workflow** tile, and that is what switching to the
personal workspace shows.

Every seeded row carries an id beginning `5eed` —
`5eed0001-0000-4000-8000-000000000001` is the acme-robotics organization,
`5eed0009-…-000000000482` the run against issue `#482` — so demo data is recognisable on
sight in a log or a URL, and a test can name a row without looking it up. The workspace
seed lists all of its ids; the dashboard seed builds its seventy-seven from three
documented prefixes (`5eed0009…` runs, `5eed000a…` queue items, `5eed000b…` usage events)
and the issue number or ordinal of the row, which is as deterministic and rather more
readable than seventy-seven literals. The providers seed takes the three prefixes after
those — `5eed000c…` connections, `5eed000d…` discovered models, `5eed000e…` its own spend
events — which is also what keeps its usage rows and the dashboard's apart on sight in a
table both of them write. The routing seed takes the six after *those* — `5eed000f…`
aliases, `5eed0010…` task kinds, `5eed0011…` routes, `5eed0012…` hops, `5eed0013…` rules and
`5eed0014…` its own routed calls — so all three of the seeds that write `token_usage` are
told apart by the first two hex digits of a row's id. The workflows seed takes the two after
the sources seed's — `5eed001b…` a workflow and `5eed001c…` one of its versions — and builds
each id from the rail's ordinal and the version number, with `…0000000000` for the draft,
which is a version a row does not have. The planning seed takes the seven after those —
`5eed001d…` tickets, `5eed001e…` dependencies, `5eed001f…` epics, `5eed0020…` epic links,
`5eed0021…` the batch, `5eed0022…` drafts and `5eed0023…` their estimates — suffixed by issue
number, sort order or draft ordinal.

**Neither can run against anything but a development database.** Each statement in either
seed ends `and ${ouro_dev_seed}`, a Flyway placeholder that is `false` in
[`flyway.toml`](flyway.toml) — the configuration `scripts/migrate`, CI and every
hand-run migration read. With it false the migration still applies and inserts nothing.
[`flyway.seed.toml`](flyway.seed.toml) is the one file that sets it `true`, the compose
stack is the one thing that loads it by itself, and this is the deliberate way to reach
it for a database the stack does not own:

```bash
ouroboros-db/scripts/migrate --config flyway.seed.toml
```

Both are repeatable migrations and both are idempotent: every id is fixed and every
statement ends `on conflict do nothing`, so applying either twice writes nothing the second
time and leaves even the timestamps alone. Child rows find their parent by slug, by email
or by repository name rather than by id, so a database somebody has edited by hand gets a
seed that re-creates what it can instead of failing.

> One consequence of Flyway's rules is worth knowing: a repeatable migration's checksum
> is taken of the file, *before* placeholders are substituted. A database that has
> already recorded these migrations un-seeded therefore does not pick the data up merely
> by being migrated again with the overlay — reachable only by pointing both
> configurations at the same database. `scripts/clean-dev` then a seeded `migrate` fixes
> it, or `docker compose down -v && docker compose up` for the stack's own database.

### The bundled price catalog

The other repeatable migration is not a seed, and it is the one piece of data this module
ships to **every** environment:
[`migrations/R__model_price_catalog.sql`](migrations/R__model_price_catalog.sql) fills
`model_prices` ([#580](https://github.com/NobuData/ouroboros/issues/580)) with what a
model costs, which is what mockup 21's `$ per 1M in·out` column renders and what
[#92](https://github.com/NobuData/ouroboros/issues/92)'s priced accounting will value
`token_usage` with.

It carries no `${ouro_dev_seed}` guard because it is not development data. A price is a
fact about the world, an air-gapped deployment needs it as much as a laptop does, and the
alternative — an empty column until somebody types a hundred models in — is the failure
mode [decision R4](migrations/V012__model_prices.sql) exists to avoid.

**Nothing reaches a network, at migration time or ever.** The catalog is data in the
repository, in three files with one direction of flow:

```
catalog/litellm-model-prices.json     a pruned extract of upstream, at a pinned commit
  └── scripts/price-catalog.mjs       the transform: per-token costs → cents per 1M
        └── migrations/R__model_price_catalog.sql   generated; one import call, rows as jsonb
```

```bash
ouroboros-db/scripts/price-catalog.mjs --check   # the migration is what the extract renders (ci/db)
ouroboros-db/scripts/price-catalog.mjs --write   # re-render it after the extract moves
ouroboros-db/scripts/price-catalog.mjs --vendor --commit <sha>   # refresh the pin — the only mode that downloads
```

The extract is a subset of
[LiteLLM's `model_prices_and_context_window.json`](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)
(MIT — the licence is committed as `catalog/LICENSE.litellm`), pruned to the providers
this product can reach and the fields it keeps, so it can be diffed against upstream
directly. Every row it renders is stamped with a `catalog_version` naming that commit and
its date. Three rows are *not* upstream's — Copilot's `seat`, Cursor's `usage` and
Ollama's `free` — because upstream publishes no rate for a provider that has none; they
are stamped `meta.catalog_source = 'ouroboros'`.

Re-running it is safe by construction. `ouroboros.import_model_price_catalog()`, which is
all the generated file calls, returns `(inserted, updated, unchanged, deleted)`: the same
snapshot twice is `(0, 0, n, 0)` and writes nothing at all, a newer snapshot updates the
bundled rows and sweeps the ones it dropped, and **no organization's override is reachable
from it** — every row it writes is `organization_id null`, so there is no key it can
produce that collides with one. A workspace that corrects a price for itself does so in a
row of its own, and it survives every re-import:

```sql
insert into ouroboros.model_prices
  (organization_id, match_provider_kind, match_model, billing_mode,
   input_cents_per_1m, output_cents_per_1m, source)
values ('org-acme', 'anthropic', 'claude-fable-5', 'token', 1200, 6000, 'override');

select * from ouroboros.model_price('org-acme', 'anthropic', 'claude-fable-5');
```

`ouroboros.model_price(organization, provider kind, model)` is how everything reads this
table: it returns the one row that prices that pair — override over bundled, exact model
over family row — or **no row at all** when the catalog does not cover the model, which is
what the registry renders as `—`. It never returns a zero for a model whose price is
unknown, and that distinction is the point of the table: `—` says *we do not know*, `$0`
says *this is free*, and only one of them is safe to be wrong about.

### The runner underneath

Each command is a name for one [`run.sh`](run.sh) invocation; use `run.sh` directly for
anything the four do not cover, and pass its flags through any of them:

```bash
ouroboros-db/run.sh repair                    # any Flyway command
ouroboros-db/scripts/migrate --dry-run        # print the command, run nothing
ouroboros-db/scripts/migrate --runner docker  # force a runner instead of choosing one
ouroboros-db/run.sh --help                    # every flag, and what it reads
```

Flyway itself comes from whichever is available, and `--runner` overrides the choice:

| Runner | What it uses | When it is chosen |
|---|---|---|
| `flyway` | the `flyway` on your PATH | automatically, if you have one — no Docker at all |
| `docker` | the pinned `flyway/flyway:13` image | otherwise, so no local Java is needed |

When the container runs against a database on this machine it is given host networking,
because a server bound to loopback — which both a default PostgreSQL install and the
compose stack are — is not otherwise reachable from inside a container. Only what Flyway
reads is mounted into it, read-only: `flyway.toml` and `migrations/`.

Parameters come from `ouroboros-db/.env`, then the repo-root `.env`, then the defaults,
and anything already in the environment beats all three. Any argument the runner does
not recognise goes to Flyway untouched, and the password is never printed — not in the
progress line, not by `--dry-run`.

> `run.sh` migrates whatever `OURO_DB_HOST`/`OURO_DB_PORT` resolve to, and the default
> is `localhost:5432`. If you have a PostgreSQL of your own there, that is the one it
> will migrate. `--dry-run` prints the target without touching it.

### The tests

The module's tooling has its own suite — the runner and the four commands, exercised
against a synthetic module with both Flyway runners stubbed out, so it needs no database
and no Docker:

```bash
scripts/run-tests.sh ouroboros-db/tests   # this module's suite
scripts/run-tests.sh                      # every suite in the repository
```

`ci/db` runs it on every pull request that touches this directory, after
[`scripts/verify-dev-env.sh`](../scripts/verify-dev-env.sh).

The three `.sql` suites are the other half, and they are separate because they need the one
thing the suite above deliberately does without: a database with the migrations applied.
They share their assertion helpers through [`tests/lib/assert.sql`](tests/lib/assert.sql),
as the shell suites share [`../scripts/lib/checks.sh`](../scripts/lib/checks.sh).

[`tests/constraints.sql`](tests/constraints.sql) asserts what the schema *enforces* —
every uniqueness rule, check constraint, cascade, trigger and index the migrations claim
— because `validate` compares checksums rather than behaviour, and a `unique` on the
wrong columns passes it. [`tests/seed.sql`](tests/seed.sql) asserts the opposite side:
what the eight `R__dev_seed*.sql` migrations actually put in a development database, one
assertion per row — the workspaces, mockup 02's dashboard number for number, mockup 03's
backlog and the estimates behind its chips, mockup 07's five provider cards with the
meters their two seeds add up to, and mockup 04's studio: the canvas against the mockup's
own coordinates, the rail's five captions recomputed the way P.4 composes them, and a dry
run of the seeded `#485` walked edge by edge through the graph.
[`tests/registry-invariants.sql`](tests/registry-invariants.sql) is the third, and it is a
second way into a file rather than a third body of assertions:
[`tests/lib/registry-invariants.sql`](tests/lib/registry-invariants.sql) is CG.5's
([#583](https://github.com/NobuData/ouroboros/issues/583)) list of the registry rules the
services over mockup 21 are written against, `constraints.sql` includes it as its last
section, and this runs the same file on its own — because the one database `constraints.sql`
cannot be pointed at is the *seeded* one, and that is the database #583 asks these probes of.
Run them against a migrated database:

```bash
PGPASSWORD=ouroboros psql -h localhost -p 5432 -U ouroboros -d ouroboros \
  -v ON_ERROR_STOP=1 -f ouroboros-db/tests/constraints.sql
PGPASSWORD=ouroboros psql -h localhost -p 5432 -U ouroboros -d ouroboros \
  -v ON_ERROR_STOP=1 -f ouroboros-db/tests/seed.sql
PGPASSWORD=ouroboros psql -h localhost -p 5432 -U ouroboros -d ouroboros \
  -v ON_ERROR_STOP=1 -f ouroboros-db/tests/registry-invariants.sql
PGPASSWORD=ouroboros psql -h localhost -p 5432 -U ouroboros -d ouroboros \
  -v ON_ERROR_STOP=1 -f ouroboros-db/tests/planning-invariants.sql
```

[`tests/planning-invariants.sql`](tests/planning-invariants.sql) is the same arrangement for
AK.5's ([#276](https://github.com/NobuData/ouroboros/issues/276)) planning invariants, kept in
[`tests/lib/planning-invariants.sql`](tests/lib/planning-invariants.sql). It writes nothing: it
reads the rows the database holds and the catalogue, so it is green against AK.4's
([#275](https://github.com/NobuData/ouroboros/issues/275)) seed and against any database whose
planning rows are sound.

`constraints.sql` creates its own fixtures inside a transaction and rolls back, so it
leaves no rows behind — including the seed's, which it clears and restores so its counts
mean what they say. `seed.sql` writes nothing at all. `registry-invariants.sql` writes and
rolls back like the first but clears nothing, because every count in it is scoped to two
workspaces it made itself — which is the property that lets it be pointed at a seeded
database, where clearing the schema is the one thing it must not do. All three are safe to
repeat against a database that is already in use. `seed.sql` wants a database migrated
*with* the seed enabled and fails on the first assertion against one that is not, which is
the answer it should give; running it after two `migrate` passes is how "migrate twice
changes nothing" is checked, since every assertion in it says *exactly one*.

A passing run prints one line; a failure names the rule and exits non-zero, which is what
makes each of them a CI step — [#24](https://github.com/NobuData/ouroboros/issues/24) wires
the first two into `ci/db` and [#583](https://github.com/NobuData/ouroboros/issues/583) the
third, below. A migration that adds a rule adds its assertion in the same change.

`constraints.sql`'s last two sections belong to no migration. Every assertion above them is
behavioural — a write the schema must refuse, attempted, and refused — and a behavioural
probe has one failure mode nothing can see from the outside: it can go **vacuous**, because
it depends on a fixture, and a fixture is a live thing that a later ticket can rename or
delete out from under it. So [#193](https://github.com/NobuData/ouroboros/issues/193)
enumerates the invariants routing resolution ([#194](https://github.com/NobuData/ouroboros/issues/194))
is *written against* rather than re-checks — hop ordering and density, one route per task
kind, the two `restrict` foreign keys, the rule `then` and `when` grammars, the provider
vocabularies, the floor-index bound — and asks the catalogue for each of them by name. It
asserts the **shape** where the shape is the rule: a foreign key is checked for `restrict`,
because a relaxation to `cascade` leaves the name exactly where it was. It deliberately does
not assert any rule's *body* — a CHECK's expression, a trigger function's source — because
those are legitimately rewritten, and a test that pins the wording of a rule fails on the
refactor rather than on the regression.

[#583](https://github.com/NobuData/ouroboros/issues/583) is the same list for the registry —
unbound ⇒ disabled, the params and restrictions vocabularies, alias uniqueness per
workspace, price coherence, price provenance and uniqueness, the reference view's columns,
and the two `restrict` foreign keys again — and it is the section kept in a file of its own,
[`tests/lib/registry-invariants.sql`](tests/lib/registry-invariants.sql), because it runs in
two places. Mostly behavioural rather than catalogue reads, unlike #193's: it can afford to
be, because its fixtures are two workspaces it creates and deletes itself, and a probe whose
fixture is its own cannot go vacuous when somebody else's moves.

[#276](https://github.com/NobuData/ouroboros/issues/276) is planning's list, and it is the one
that asks about **rows** as well as rules. Three of mockup 09's guarantees are kept by
application code, and each has a failure mode that lands in the database without raising
anything: a dependency cycle that got past AL.4's check is a batch AL.3 can *never* push, a
draft that leaves `pushed` is pushed twice, and a reversed or half-null month range is a gantt
lane drawn with negative width or not at all. So the fragment asserts, over every workspace,
that the stored dependency graph has no cycle — a recursive CTE,
[`tests/lib/dependency-cycles.sql`](tests/lib/dependency-cycles.sql), shared with the V035
section that proves it sees a planted one — that every endpoint is exactly one kind, that push
states, tints and lane statuses are in vocabulary, that month ranges run forwards and come in
pairs, and that no batch repeats a local key; and then asks the catalogue for each rule by name.
Every failure opens with the invariant's name, so a red build says which guarantee went.

Both of the first two are **one session inside one transaction**, which is what
[Proving the guard is a guard](#proving-the-guard-is-a-guard) exists for: a rule about what
two concurrent writers may do to each other cannot be asserted by one of them.

### Proving the assertions are load-bearing

A green `constraints.sql` does not prove its assertions are doing anything. A file that
asserted nothing at all would be exactly as green, and so would one whose probes had
drifted off the constraints they were written for — the two are indistinguishable from the
outside. The only way to tell them apart is to break a rule on purpose and check that the
right probe goes red for the right reason.

[`tests/verify-constraint-probes.sh`](tests/verify-constraint-probes.sh) is that check for
the dashboard read-model ([#69](https://github.com/NobuData/ouroboros/issues/69)), the
provider cards ([#221](https://github.com/NobuData/ouroboros/issues/221)), the routing
invariants ([#193](https://github.com/NobuData/ouroboros/issues/193)), the registry rules
([#583](https://github.com/NobuData/ouroboros/issues/583)), the intake schema
([#104](https://github.com/NobuData/ouroboros/issues/104)) and planning
([#276](https://github.com/NobuData/ouroboros/issues/276)). It drops one rule at
a time — the `runs.status` and `queue_items.effort` vocabularies, the terminal-run rule, the
queue's position and issue keys, the `workspace_settings` primary key; the monthly cap's
floor, the discovered catalog's uniqueness, the `enabled` switch's `not null` and the health
vocabulary beside it, the `added_by` reference; the hop position key, the
one-route-per-task-kind key, the rule `then` grammar and the provider `kind` vocabulary; the
unbound-alias switch, the params and restrictions vocabularies, alias uniqueness, the three
price-coherence rules, price provenance and the reference-kind vocabulary; the
`sizing_status` vocabulary, the `(github_repo_id, number)` key the backlog sync upserts on,
the `labels` array-of-names shape, the sync cursor that cannot precede its own sync, the
estimate-version trigger and the unique key beneath it, and decision **K10**'s mandatory
trace provenance; and of the workflow studio
([#137](https://github.com/NobuData/ouroboros/issues/137)), the trigger that keeps a published
version immutable, the `workflows.status` vocabulary, the numbering trigger and the version key
beneath it, and the one-draft index; and of planning, both dependency-endpoint one-kind checks,
the push-state vocabulary and the trigger that keeps `pushed` terminal, the month range's order
and pairing, the tint and lane-status vocabularies, and the batch-local key —
and rewrites the expressions a rule lives in where no drop can falsify it: the two
`token_usage_daily` computes its sums from, and the two tests inside `route_chain_intact()`
that hold a chain dense from 1 and its floor inside it. For each, it requires the suite to
fail **and** to name the assertion that caught it: a bare non-zero status would also be
produced by a mutation that broke on its own statement.

`issue_estimates_version_monotonic` is the one mutation that is a `drop trigger`. Versions
ascend within an issue by trigger rather than by CHECK, because a CHECK cannot see the other
rows of its own table; dropped, the version it refused is refused by the unique key beneath
it instead — which is the weaker rule and the whole reason the trigger exists, since unique
alone accepts 3 then 2 and *latest wins* then returns the estimate that was replaced. So that
probe reads `must_reject`'s *wrong rule fired* message rather than its *statement was
accepted* one, and both are the probe noticing.

Three mutations are *relaxations* rather than drops, and they are the ones worth
understanding. `route_hops_alias_fk` and `model_aliases_provider_fk` are re-added as
`on delete cascade`, because `restrict` → `cascade` is the refactor that really happens and
it leaves the constraint's name exactly where it was. Both fail **open**: the delete succeeds
and takes the dependent rows with it, so a provider removed on *Providers & keys* would empty
chains drawn on *Model routing*, and an alias retired in the model registry would shorten
every chain that named it — past the floor those chains were written against.
`model_prices_match_key` is the third, re-added without its `nulls not distinct`: every
bundled price row has a null `organization_id`, so under the ordinary spelling that key
separates none of them and the next snapshot import doubles the catalog instead of updating
it — while the override half goes on working, which is what would make the loss hard to
notice. All three are the class of regression a green suite cannot see, which is why they
are probed rather than trusted. Relaxing also probes harder than dropping would: a suite
that catches the relaxation catches the drop, since the drop refuses less.

```bash
PGPASSWORD=ouroboros ouroboros-db/tests/verify-constraint-probes.sh
```

It reads where to connect from `run.sh --print-target`, so the same `.env` precedence
applies; `PGPASSWORD` is the one thing it needs from the environment, because that is the
one thing `--print-target` will not print. Every mutation runs against a throwaway copy of
a template database it migrates for itself, inside a transaction that is never committed,
so it changes nothing that outlives the run — including the database you point it at. The
copy is what makes the runs *deterministic*: `constraints.sql` carries plan assertions, and
a plan is chosen from catalogue statistics rather than from the schema, so a database the
suite has already been run against and left dead rows in can plan differently once
autovacuum has recorded those tables as empty. A copy of a freshly migrated template always
has the statistics a freshly migrated database has.

### Proving the planning invariants read the rows

A stored dependency cycle is data, not a rule, so `verify-constraint-probes.sh` has nothing to
drop for it — and it could not plant one either, because `constraints.sql` clears every
workspace before its first assertion. [`tests/verify-planning-invariants.sh`](tests/verify-planning-invariants.sh)
is the other half of [#276](https://github.com/NobuData/ouroboros/issues/276), and it runs
against the **seeded** database: it requires `planning-invariants.sql` to be green there, then
plants a bad row and requires red naming the invariant — a cycle among the seeded tickets and
another among the seeded drafts, and, each under the rule it drops first, a two-kind and a
no-kind endpoint, a `queued` push state, a reversed and a half-null month range, a foreign tint
and status, and a second `OTA-3` in the seeded batch.

```bash
PGPASSWORD=ouroboros OURO_DB_NAME=ouroboros ouroboros-db/tests/verify-planning-invariants.sh
```

It refuses a database without the planning seed rather than going red for the wrong reason.
Every plant runs in a transaction that is never committed, so the seed is left as it was found —
`ci/db` re-runs `seed.sql` afterwards to say so. The whole run is well under a second.

### Proving the guard is a guard

`constraints.sql` is one session inside one transaction, and CG.3's delete guard
([#581](https://github.com/NobuData/ouroboros/issues/581)) is a rule about what a *second*
session may do while the first is deciding. `alias_reference_guard()` takes a row lock
before it counts, so what has to be proven is that a concurrent route save waits for it —
and that a plain `select` from `alias_references` does not make it wait, because a guard
nothing distinguishes from a bare count is not a guard.

[`tests/verify-alias-reference-guard.sh`](tests/verify-alias-reference-guard.sh) drives two
long-lived psql sessions through three interleavings against a database of its own:

1. **The guard holds.** A guards an unreferenced alias and is told it is unreferenced; B's
   route save naming that alias *waits* — asserted from `pg_stat_activity`, not inferred
   from a statement that has not finished; A deletes and commits; B wakes into a foreign key
   whose target is gone. No orphan, and the list A acted on was still true when A acted.
2. **Without the lock, that list goes stale.** The same interleaving through the bare view:
   B does not wait, B commits, and A's delete is refused by `route_hops_alias_fk` — still no
   orphan, because the foreign key is not optional, but a referential error where the user
   was owed a 409 naming the route. This is the probe, and it is what would go green if the
   guard ever stopped locking.
3. **The lock is no wider than the alias.** Two guards on two aliases of one workspace do
   not wait on each other.

```bash
PGPASSWORD=ouroboros ouroboros-db/tests/verify-alias-reference-guard.sh
```

Same connection rules as the probes above — `run.sh --print-target`, `PGPASSWORD` from the
environment — and its own database, dropped on the way out, because two sessions cannot see
each other's uncommitted rows and this suite therefore has to commit while it runs.

### The drift check

Every table BetterAuth uses is hand-ported into a `V###__*.sql` migration here, because
Flyway is the only thing allowed to change this schema and the library is never allowed to
change it itself. That is the right arrangement, and it is exactly what makes **drift**
possible: a `better-auth` upgrade, or a plugin added to `ouroboros-rest/src/auth`, can
move what the library expects while this copy stands still. Nothing about that is visible
until a query in production names a column that does not exist.

[`scripts/betterauth-schema.mjs`](scripts/betterauth-schema.mjs) is what makes it visible
on the pull request instead ([#710](https://github.com/NobuData/ouroboros/issues/710)). It
asks BetterAuth's own schema planner what it wants, and answers two different questions
depending on which database it is pointed at:

```bash
# does the applied schema still hold everything the library expects?
ouroboros-db/scripts/betterauth-schema.mjs --applied   # against a migrated database

# has what the library expects changed since the snapshot was rendered?
ouroboros-db/scripts/betterauth-schema.mjs --check     # against an empty schema
ouroboros-db/scripts/betterauth-schema.mjs --write     # …and re-render it
```

Both need `OURO_DATABASE_URL`, and both refuse the other's database rather than answering
the wrong question. The service's own `.env` supplies the rest, as it does for
`ouroboros-rest` itself; `--check` and `--write` want a scratch database whose `ouroboros`
schema is empty, because the planner reports what a database is *missing* and only an
empty one draws the whole picture. Both read `ouroboros-rest/dist`, so
`yarn workspace ouroboros-rest build` comes first.

[`betterauth-schema.sql`](betterauth-schema.sql) is the committed rendering — beside the
migrations rather than among them, because Flyway would otherwise try to apply it, and it
is a description of what the library wants rather than a migration. Committing it is what
turns an upgrade into a reviewable diff, and the diff is the DDL the new migration has to
apply. Neither mode ever writes to a database.

> Two things the check deliberately does not do. It does not shell out to
> `@better-auth/cli`, which brings its own copy of `better-auth` — the CLI's latest release
> carries 1.4.x while this repository pins 1.6.26 — so the core tables would be checked
> against a version the service does not run, and the two copies already disagree about
> `organization_slug_uidx`. And it cannot see **indexes**: the planner plans one only for a
> table it is creating or a column it is adding, so an index dropped from a table that
> otherwise still fits is invisible to it. That gap is closed in `tests/constraints.sql`,
> which asserts every index the snapshot lists, by name — and the suite that reads this
> file checks the two lists still agree.

### The workflow schema drift check

The workflow seed ([#136](https://github.com/NobuData/ouroboros/issues/136)) writes P.2
documents into `workflow_versions.definition`, and
[`schemas/workflow-dsl/v1.json`](../schemas/workflow-dsl/v1.json) is the language they are
written in. A Flyway migration cannot read a file, so nothing joins the two at the moment
either changes: a schema edit that tightens a rule leaves the seeds describing a language that
no longer exists.

[`scripts/workflow-dsl-drift.mjs`](scripts/workflow-dsl-drift.mjs) is the check that says so on
the pull request ([#137](https://github.com/NobuData/ouroboros/issues/137)). It validates the
**stored rows** — every version the seed wrote, v2–v13 of `standard-fix` included, which exist
only as a `jsonb_set` and appear in the migration as no literal at all — with ajv, compiled
exactly as `ouroboros-rest`'s conformance suite compiles the same schema.
[`tests/lib/seeded-definitions.sql`](tests/lib/seeded-definitions.sql) reads them out as one
JSON array, scoped to the seed's own `5eed001c…` ids so a draft made in the studio is not its
business:

```bash
PGPASSWORD=ouroboros psql -h localhost -p 5432 -U ouroboros -d ouroboros_seed \
  -f ouroboros-db/tests/lib/seeded-definitions.sql > seeded-definitions.json
ouroboros-db/scripts/workflow-dsl-drift.mjs seeded-definitions.json
```

It wants a database migrated with `--config flyway.seed.toml`, and an empty result is red
rather than green, because a drift check over nothing proves nothing. It is the schema and
nothing more: the structural rules JSON Schema cannot state — one trigger, somewhere to end,
every stage reachable — are `tests/seed.sql`'s, and P.2's full validator runs over the
migration's documents in `ouroboros-rest`'s `dsl.seed.spec.ts`. `--schema PATH` validates
against another copy of the schema, which is how
[`tests/workflow-dsl-drift.test.sh`](tests/workflow-dsl-drift.test.sh) keeps *"red on drift"*
a standing assertion rather than a one-off: it tightens a copy and requires the committed
fixtures that pass the real one to fail against it.

## Continuous integration

[`ci/db`](../.github/workflows/db.yml) is what runs all of the above on a pull request
that touches this directory, the compose file, `.env.example`, the workflow itself, or the
two things in `ouroboros-rest` that decide what BetterAuth expects — `src/auth/` and the
`package.json` that pins the library — or the workflow DSL's
[`schemas/workflow-dsl/v1.json`](../schemas/workflow-dsl/v1.json)
([#11](https://github.com/NobuData/ouroboros/issues/11) set the routing;
[#24](https://github.com/NobuData/ouroboros/issues/24) added the live pass;
[#710](https://github.com/NobuData/ouroboros/issues/710) added the two `ouroboros-rest`
paths, because a version bump touches no file in this directory and is exactly what the drift
check exists to catch; [#137](https://github.com/NobuData/ouroboros/issues/137) added the
schema, for the same reason one directory over). It runs in two halves, cheap first — a
misnamed migration is worth reporting before a database is waited on.

| Step | What it proves | Needs a database |
|---|---|---|
| `scripts/verify-dev-env.sh` | Migration naming, the pinned images and healthcheck gate, `flyway.toml`'s settings, credential hygiene, `.env.example` coverage | no |
| `scripts/run-tests.sh ouroboros-db/tests` | `run.sh` and the four commands, against stubbed runners | no |
| `scripts/migrate` | Every migration applies, in order, to a database that has never seen them | yes |
| `scripts/validate` | Checksums and the naming rule, read back from the history that pass wrote | yes |
| `tests/constraints.sql` | What the schema *enforces* — the half `validate` cannot see | yes |
| `tests/verify-constraint-probes.sh` | That those assertions are load-bearing — each goes red when the rule it watches is dropped, routing ([#193](https://github.com/NobuData/ouroboros/issues/193)), the registry ([#583](https://github.com/NobuData/ouroboros/issues/583)), intake ([#104](https://github.com/NobuData/ouroboros/issues/104)), the workflow studio ([#137](https://github.com/NobuData/ouroboros/issues/137)) and planning ([#276](https://github.com/NobuData/ouroboros/issues/276)) included | yes (copies of its own) |
| `tests/verify-alias-reference-guard.sh` | That the alias delete guard is a lock and not a count — the rule two concurrent writers make, which one session cannot assert | yes (one of its own) |
| `scripts/betterauth-schema.mjs --applied` | The applied schema still holds everything BetterAuth expects | yes |
| `scripts/betterauth-schema.mjs --check` | The library still expects what the committed snapshot describes | yes (an empty one) |
| `scripts/migrate --config flyway.seed.toml` ×2 | The seed applies, and applies twice without changing anything | yes (a second one) |
| `tests/seed.sql` | The demo tenant is there, exactly once, with the ids the documentation publishes | yes (that one) |
| `tests/planning-invariants.sql` | The planning invariants AL.3 and AL.4 rely on, against the *seeded* database — no stored dependency cycle among them ([#276](https://github.com/NobuData/ouroboros/issues/276)) | no |
| `tests/verify-planning-invariants.sh` | That those go red on a planted cycle, reversed or half-null month range, duplicate local key, bad push state, tint, status or endpoint, naming the invariant ([#276](https://github.com/NobuData/ouroboros/issues/276)) | yes (rolled back) |
| `tests/registry-invariants.sql` | The registry rules again, against the *seeded* database — and `tests/seed.sql` a second time to say it survived them ([#583](https://github.com/NobuData/ouroboros/issues/583)) | yes (that one) |

The drift check is the one step that needs a Node toolchain, which is why the job installs
the workspace and builds `ouroboros-rest`: the configuration deciding the expected schema
is that module's, and reading it is the whole point — a plugin enabled there changes the
answer the same way an upgrade does, and neither has to be remembered.

The database is a `postgres:17-alpine` service container — **the same image
[`../docker-compose.yml`](../docker-compose.yml) pins**, so what a pull request proves is
what a developer gets; `scripts/verify-ci.sh` fails if the two ever drift apart. It is
created empty for every run and thrown away with the runner, which is what makes
"migrate from scratch" mean it.

Two details are the reason the job is worth its minute:

- **It runs the module's own commands**, not a `flyway` invocation written into the
  workflow. CI reads [`flyway.toml`](flyway.toml) through `-workingDirectory` exactly as
  `docker compose up` and a hand-run `scripts/migrate` do, so there is no configuration
  that only CI applies and none it can miss.
- **The seed gets a database of its own.** The first one has to go on proving what a
  production migration does — apply every `R__dev_seed*.sql` migration and insert
  nothing, because `${ouro_dev_seed}` is `false` in `flyway.toml` — so the overlay is
  layered onto a second database instead. Migrating it twice before asserting is the idempotency
  criterion, since every assertion in `seed.sql` says *exactly one*.
- **`OURO_*` enters the environment where the live pass begins**, not job-wide. Those
  variables are the last word in `run.sh`'s precedence, and the tooling suite two steps
  earlier is what tests that precedence — in job scope they point it at the workflow
  instead of at the `.env` files it writes. `scripts/verify-ci.sh` fails on an `OURO_*`
  key in job scope, so the mistake cannot come back quietly.

Everything the live pass runs is runnable by hand against any PostgreSQL, which is how a
failure is reproduced: start one, point the `OURO_*` variables at it, and run the same
commands in the same order.

A second job, `publish/db`, turns what that pass proved into [the image](#the-image). It
`needs: ci`, which is why it lives in this workflow rather than one of its own — the
image is the SQL the job above applied to a real database, validated and asserted
against, so a red run publishes nothing. The build itself runs on every event and needs
no credential, so a `Dockerfile` that stops building fails the pull request that broke
it; only the login and the push are held back to a push on `main`. Two things about the
artefact are checked before it is pushed, and neither needs a database: that it carries
every migration in the checkout — the allow-list in `.dockerignore` is what could
silently drop one — and that it still refuses to migrate a database nobody named.

## The image

Everything above assumes a checkout: `docker compose up` mounts this directory, and the
`scripts/` commands read it from disk. A deployment has neither. [`Dockerfile`](Dockerfile)
is this module in the form that needs no checkout — the migrations, `flyway.toml`, the
seed overlay and [`docker-entrypoint.sh`](docker-entrypoint.sh), on the same
`flyway/flyway:13-alpine` the compose stack and `run.sh` already use — and `publish/db`
pushes it as `ouroboros-db:latest` and `ouroboros-db:<commit sha>`.

**It is a task, not a service.** It applies what is pending and exits, and its exit
status is the answer — which is what makes it a Kubernetes `Job`, a compose service with
`restart: "no"`, or a step in a deploy script:

```bash
docker run --rm \
  -e OURO_DB_HOST=db.internal \
  -e OURO_DB_USER=ouroboros \
  -e OURO_DB_PASSWORD="$PGPASSWORD" \
  "$DOCKER_HOSTNAME"/ouroboros-db:latest            # migrate

docker run --rm … "$DOCKER_HOSTNAME"/ouroboros-db:latest info       # or validate, repair, …
```

The parameters are the six this module already documents under
[Configuration](#configuration) — `OURO_DB_HOST`, `OURO_DB_PORT`, `OURO_DB_NAME`,
`OURO_DB_USER`, `OURO_DB_PASSWORD`, `OURO_DB_SCHEMA` — because a seventh that only the
image understood would be a parameter no other way of migrating had. Four details are
worth knowing before it goes near a production database:

- **`OURO_DB_HOST` has no default.** `localhost` inside a container is the container, so
  a default would turn a forgotten variable into a run that migrates nothing and reports
  success. Missing, it exits `2` naming the variable.
- **The password never reaches the command line.** The entrypoint sets Flyway's own
  `FLYWAY_*` environment variables rather than `-user=`/`-password=` arguments, which
  keeps the credential out of the container's process list and out of anything that logs
  a command. Anything you *do* pass on the command line goes to Flyway untouched and
  beats the environment, so `-url=… -user=… -password=… migrate` works with no
  `OURO_*` variable at all.
- **`clean` cannot be reached from it.** `flyway.toml` disables it and
  [`flyway.dev.toml`](flyway.dev.toml), the one file that re-enables it, is deliberately
  not in the image — so the command that drops every object in the schema is not
  available to a caller who asks for it by name.
- **The dev seed is inert unless it is named**, exactly as everywhere else. The overlay
  is in the image; Flyway loads no overlay it is not handed, and `-configFiles` *replaces*
  the auto-loaded file, so both have to be named to get a seeded database — which is how
  a test fixture asks for one:

  ```bash
  docker run --rm … "$DOCKER_HOSTNAME"/ouroboros-db:latest \
    -configFiles=/flyway/project/flyway.toml,/flyway/project/flyway.seed.toml migrate
  ```

Build it yourself with the module as the context — nothing here installs through the
workspace lockfile, so unlike `ouroboros-ui` it needs nothing from the repository root:

```bash
docker build -t ouroboros-db ouroboros-db      # from the repo root
```

[`.dockerignore`](.dockerignore) is an allow-list: `*`, then the four paths the build
copies. That is what keeps this module's real `.env` — and `run.sh`, `tests/` and the
`clean` overlay — out of a published layer no matter what else lands in this directory.

## Configuration

Two questions, and three files: one project configuration, and two overlays that are
inert until something names them.

**[`flyway.toml`](flyway.toml) — how migrations are applied.** Where they are, that the
schema is created if absent, that a misnamed file fails the run, that `clean` is off,
and that the dev seed inserts nothing. Every path reads it: the compose stack, `run.sh`,
and the `scripts/` commands are all pointed at this directory with `-workingDirectory`,
so there is one place to change a rule and no way for `up` and a hand-run migration to
disagree.

The overlays each hold one setting, and hold it separately so that the safe
configuration is the one every command already reads. Flyway never loads either by
itself; it takes an explicit `-configFiles`, which `run.sh --config FILE` is the way to
pass:

| Overlay | Sets | Loaded by |
|---|---|---|
| [`flyway.dev.toml`](flyway.dev.toml) | `cleanDisabled = false` | `scripts/clean-dev`, and nothing else |
| [`flyway.seed.toml`](flyway.seed.toml) | `ouro_dev_seed = "true"` | the compose stack, and `scripts/migrate --config flyway.seed.toml` |

They stay two files rather than one because they are wanted in different places: the
compose stack needs the seed and must not be given a `clean` that drops the schema.
None of the three carries a url, a user or a password — those describe a machine, not a
project.

**`.env` — which database.** Development default port: **5432**.
[`.env.example`](.env.example) here is *which database the commands migrate*; the
repo-root [`../.env.example`](../.env.example) is *every `OURO_*` variable the whole
system reads*. Both carry development defaults, so the stack and the commands work with
no `.env` at all.

| Variable | Purpose |
|---|---|
| `OURO_DATABASE_URL` | Connection string used by `ouroboros-rest` |
| `OURO_DB_HOST` | Host the commands connect to, default `localhost` |
| `OURO_DB_PORT` | Port they connect to, and the one the container publishes, default `5432` |
| `OURO_DB_USER` / `OURO_DB_PASSWORD` | Credentials for the database |
| `OURO_DB_NAME` | Database name, default `ouroboros` |
| `OURO_DB_SCHEMA` | Schema Flyway owns and migrates, default `ouroboros` |

`OURO_DB_USER`, `OURO_DB_PASSWORD` and `OURO_DB_NAME` are read by PostgreSQL's own
first-boot initialisation. Changing one after the volume exists has no effect until the
volume is dropped — `docker compose down -v`, then `up`.

A local `flyway.user.toml` is Flyway's own per-developer override file and is
git-ignored; the committed project is `flyway.toml` and its overlay.

## Migration rules

These are non-negotiable. [`ci/db`](#continuous-integration) checks them on every pull
request touching this directory — first by reading the files, then by applying them to a
real PostgreSQL — and Flyway's own `validateMigrationNaming` and `validate` enforce them
again whenever the migrations are applied.

1. **Versioned migrations are immutable.** Once `V###__*.sql` has been applied
   anywhere, it is never edited — fix forward with a new version.
2. **Plain SQL only**, one concern per migration.
3. **Repeatable migrations (`R__*.sql`) are for seeds and views only** — never for
   schema that other migrations depend on.
4. **Naming:** `V###__snake_case_description.sql` / `R__snake_case_description.sql`.
   `validateMigrationNaming` fails the build on anything else.
5. **Dev seed data never runs in production** — every statement in every `R__dev_seed*.sql`
   ends `and ${ouro_dev_seed}`, which is `false` in `flyway.toml` and `true` only in
   `flyway.seed.toml`. A seed statement without that guard is the one thing
   `tests/seed.test.sh` counts.
6. **A seed that depends on another seed is named to sort after it.** Flyway orders
   repeatable migrations by description, so `R__dev_seed_dashboard.sql` runs after
   `R__dev_seed.sql` and finds the workspaces its rows hang off. `tests/seed.test.sh`
   asserts the ordering, because getting it wrong seeds nothing and says nothing.

## Layout

```
ouroboros-db/
├── flyway.toml                       # the project: locations, schema, naming, clean off, seed off
├── flyway.dev.toml                   # the overlay that re-enables clean — clean-dev only
├── flyway.seed.toml                  # the overlay that enables the dev seed — the stack, or --config
├── run.sh                            # apply migrations to a live database
├── Dockerfile                        # the published migration image — a task, not a service
├── docker-entrypoint.sh              # its front door: the OURO_ variables in, a connection out
├── .dockerignore                     # the allow-list that governs that image's build context
├── .env.example                      # which database the commands migrate
├── package.json                      # workspace adapter — `yarn dev` reaches scripts/dev
├── catalog/
│   ├── litellm-model-prices.json     # the vendored price extract, at a pinned commit — #580
│   └── LICENSE.litellm               # the MIT licence it came under
├── scripts/
│   ├── dev                           # up, healthy, migrated — the `dev` verb
│   ├── migrate                       # apply what is pending
│   ├── info                          # applied and pending versions
│   ├── validate                      # checksums and naming rules
│   ├── clean-dev                     # drop everything — gated three ways
│   ├── betterauth-schema.mjs         # what BetterAuth expects, rendered and checked — #710
│   └── price-catalog.mjs             # the extract → R__model_price_catalog.sql transform — #580
├── migrations/
│   ├── V000__bootstrap.sql           # the schema itself
│   ├── V001__tenants.sql             # tenants, tenant_domains — #20
│   ├── V002__users_membership.sql    # users, user_identities, tenant_members — #21
│   ├── V003__github_enablement.sql   # github_orgs, github_repos — #22
│   ├── V004__betterauth_core.sql     # "user", session, account, verification — #706
│   ├── V005__betterauth_organization.sql # organization, member, invitation — #707
│   ├── V006__tenancy_extensions.sql  # the cut-over: rows move, extensions re-point, V001/V002 drop — #708
│   ├── V007__user_preferences.sql    # user_preferences — the font scale — #649
│   ├── V008__dashboard_runs.sql      # runs — the loop lifecycle read-model — #64
│   ├── V009__dashboard_queue.sql     # queue_items — the ordered issue queue — #65
│   ├── V010__dashboard_usage.sql     # token_usage + token_usage_daily — the spend ledger — #66
│   ├── V011__workspace_settings.sql  # workspace_settings + …_effective — the auto-merge switch — #67
│   ├── V012__model_prices.sql        # model_prices + the lookup and import functions — #580
│   ├── V013__tenant_keys.sql         # tenant_keys — the sealed per-workspace DEKs — #222
│   ├── V014__github_issue_cache.sql  # github_issues + the per-repo sync cursor — #99
│   ├── V015__provider_connections_model_aliases.sql
│   │                                 # provider_connections + model_aliases — the routing foundation — #189
│   ├── V016__task_kinds_routes_hops.sql
│   │                                 # task_kinds + routes + ordered route_hops — the routing matrix — #190
│   ├── V017__provider_extensions_model_catalog.sql
│   │                                 # the provider cards' columns + provider_models — #221
│   ├── V018__escalation_rules.sql    # escalation_rules — structured predicates, derived display — #191
│   ├── V019__alias_lifecycle_binding_params.sql
│   │                                 # the alias switch, the unbound binding, structured params — #579
│   ├── V020__routing_usage_attribution.sql
│   │                                 # token_usage.task_kind + .latency_ms — what $/run and p50 compute from — #192
│   ├── V021__route_revisions.sql     # route_revisions — who changed the routing table, and what moved — #195
│   ├── V022__audit_events.sql        # audit_events — #26's table, landed early; append-only — #225
│   ├── V023__alias_reference_index.sql  # alias_references — what references an alias, and the delete/rename guard — #581
│   ├── V024__resolution_snapshots.sql   # resolution_snapshots — what a run's resolution decided, kept; append-only — #582
│   ├── V025__alias_revisions.sql        # alias_revisions — who changed an alias, when, and what moved — #584
│   ├── V026__issue_estimates.sql        # issue_estimates — the AI Work Breakdown, versioned latest-wins; append-only — #100
│   ├── V027__github_credentials.sql     # github_credentials — the per-workspace GitHub token, sealed by the vault — #101
│   ├── V028__github_issue_bot_authors.sql # github_issues.author_login accepts a GitHub App's [bot] login — #102
│   ├── V029__workflows_versions.sql     # workflows + workflow_versions — the studio's entities, immutable after publish — #132
│   ├── V030__canonical_tickets.sql      # ticket_sources + tickets — the source-agnostic intake model, additive — #138
│   ├── V031__ticket_source_status_reason.sql  # ticket_sources.status_reason — the sentence behind the status dot — #139
│   ├── V032__queue_items_workflow_pin.sql  # queue_items.workflow_version + workflow_pin_reason — the pin R.1 stores — #143
│   ├── V033__workflow_draft_editor.sql     # workflow_versions.edited_in — which editor last wrote the draft — #167
│   ├── V034__draft_batches_ticket_drafts.sql  # draft_batches + ticket_drafts, and issue_estimates.draft_id — #272
│   ├── V035__ticket_dependencies.sql       # ticket_dependencies — blocks over drafts and tickets, polymorphic ends — #273
│   ├── V036__planning_epics_mirrors.sql    # planning_epics + epic_tickets + epic_mirrors, and draft_batches.epic_id — #274
│   ├── V037__ticket_draft_provenance.sql   # ticket_drafts.provenance — planned | edited — #280
│   ├── V038__ticket_estimates.sql          # issue_estimates.ticket_id — the canonical ticket as a third subject — #281
│   ├── V039__reestimation_runs.sql         # reestimation_runs + reestimation_run_counts — the nightly job's record — #281
│   ├── V040__farm_schema.sql               # pools, runners, tokens, jobs, log chunks + the per-job log cap trigger — #249
│   ├── V041__farm_certificate_authority.sql # farm_authorities + runner_certificates, runners.bearer_sealed, the fallback setting — #250
│   ├── V042__farm_gateway.sql              # runner_terminal_frames — the exactly-once ledger — and runners.hostname — #251
│   ├── V043__farm_dispatch.sql             # runner_pools.default_command — what a submission falls back to — #252
│   ├── V044__farm_log_ingest.sql           # where a build log's holes are, and the retention tombstone — #253
│   ├── V045__run_stage_history.sql         # run_stages per stage × attempt, the generated note, runs.loop_seq — #298
│   ├── V046__run_event_store.sql           # run_events — the typed, capped, append-only transcript and its JSONL shape — #299
│   ├── R__dev_seed.sql               # the demo workspaces, dev only — #23, reshaped by #708
│   ├── R__dev_seed_audit.sql         # the credential trail the Audit log sheet draws, dev only — #225
│   ├── R__dev_seed_dashboard.sql     # mockup 02 as rows, dev only — #68 (sorts after the above)
│   ├── R__dev_seed_farm.sql          # mockup 08's fleet, builds and live log, dev only — #249 (sorts after the above)
│   ├── R__dev_seed_intake.sql        # mockup 03's backlog and its estimates, dev only — #103 (sorts after the above)
│   ├── R__dev_seed_providers.sql     # mockup 07's connections and meters, dev only — #221
│   ├── R__dev_seed_routing.sql       # mockup 06 as rows, and mockup 21's registry over them, dev only — #192, #582 (sorts after the above)
│   ├── R__dev_seed_sources.sql       # the two trackers acme-robotics ingests from, dev only — #138 (sorts after the above)
│   ├── R__dev_seed_ticket_planning.sql # mockup 09 — backlog, roadmap lanes, OTA batch, dev only — #275 (sorts after sources)
│   ├── R__dev_seed_workflows.sql     # mockup 04's studio — five workflows, standard-fix at v14, dev only — #136 (sorts after the above)
│   └── R__model_price_catalog.sql    # the bundled price snapshot, every environment — #580 (generated)
└── tests/
    ├── lib/
    │   ├── fixture.sh                # the synthetic module and stub runners the shell suites share
    │   ├── assert.sql                # the assertion helpers the live-database suites share
    │   ├── planning-invariants.sql   # the planning invariants, named — included twice — #276
    │   ├── dependency-cycles.sql     # the recursive-CTE walk that finds a stored cycle — #276
    │   └── run-events-jsonl.sql      # the JSONL export's bytes, for mockup 10's transcript — #299
    ├── rehearsal/
    │   ├── pre.sql                   # a populated V005 database, rebuilt for every run — #708
    │   └── post.sql                  # what V006 must have done to those rows — #708
    ├── run.test.sh                   # the runner
    ├── scripts.test.sh               # the four commands and the project configuration
    ├── seed.test.sh                  # every seed's guard, order, idempotency and determinism — #23, #68
    ├── betterauth-schema.test.sh     # the drift check's contract, without a database — #710
    ├── price-catalog.test.sh         # the price transform, its provenance and --check — #580
    ├── constraint-probes.test.sh     # the probe verifier's usage and refusals — #69
    ├── verify-constraint-probes.sh   # that constraints.sql goes red when a rule is dropped — #69, #221, #193, #583, #104, #276
    ├── planning-invariants.test.sh   # the planting verifier's usage, and that its pieces agree — #276
    ├── planning-invariants.sql       # the planning invariants against the seeded database — #276
    ├── verify-planning-invariants.sh # that they go red on planted rows, naming the invariant — #276
    ├── constraints.sql               # what the schema enforces, asserted against a live database
    └── seed.sql                      # what the seeds put there, asserted against a live database
```

Everything below `V000` is named for the issue that lands it. `tests/constraints.sql` is
not — it grows with every migration that adds a rule, rather than belonging to one of
them.

## Schema

What the applied migrations define. `ouroboros-rest` reads this through Kysely; nothing
outside this module alters it.

| Table | Since | Holds | Enforces |
|---|---|---|---|
| `"user"` | `V004` | The person, as BetterAuth holds them — `users`' successor, and since `V006` the only user table | `email` unique across the installation. **Quoted at every reference: `user` is a reserved word** |
| `session` | `V004` | One row per live sign-in, which is what makes sign-out revoke rather than forget | `token` unique; `userId` cascades from `"user"` |
| `account` | `V004` | How a person proves who they are: a provider, or a password | `(providerId, accountId)` unique, so one GitHub account is one person. **The one table here that holds credentials** |
| `verification` | `V004` | Short-lived one-time values — email verification, password reset | Unused until [#705](https://github.com/NobuData/ouroboros/issues/705) |
| `organization` | `V005` | The workspace, as BetterAuth's organization plugin holds it — `tenants`' successor, and since `V006` the root the extension tables cascade from | `slug` unique across the installation; `metadata` must be JSON, and carries the `personal` flag mockup 01 renders as a pill |
| `member` | `V005` | A person's role in one organization — `tenant_members`' successor | `(organizationId, userId)` unique, so a person joins an organization once; cascades from both sides |
| `invitation` | `V005` | Somebody asked to join who has not joined yet | `expiresAt` required — expiry is a timestamp, not a status. Written at the API level in MVP; [#724](https://github.com/NobuData/ouroboros/issues/724) delivers the email |
| `tenant_domains` | `V001`, re-parented `V006` | Email domains that resolve an organization at sign-in | Domain unique across *all* organizations and stored lower-cased; at most one `is_primary` per organization |
| `github_orgs` | `V003`, re-parented `V006` | GitHub orgs an organization has enabled | `login` unique *per organization*, stored lower-cased; `enabled` defaults false |
| `github_repos` | `V003`, cursor added `V014` | Repos within an org, and — since `V014` — when their issues were last polled | `name` unique per org, stored lower-cased; `enabled` defaults false; `issues_sync_cursor` is non-blank and cannot precede the `issues_synced_at` of the sync that produced it |
| `user_preferences` | `V007` | Per-person product preferences — today the font scale | One row per person, absent while every setting is at its default; `font_scale` is one of § 4's five steps; cascades from `"user"` |
| `runs` | `V008` | One run of the loop against one issue — the dashboard read-model | `status` is one of `coding\|building\|review\|merged\|needs_human\|failed`, and a terminal status carries `finished_at` exactly when it is terminal; the run's repository must belong to the run's organization. `loop_seq` (`V045`, [#298](https://github.com/NobuData/ouroboros/issues/298)) is the `Loop #1847` counter — unique per workspace and allocated by `runs_allocate_loop_seq()` under an advisory lock when an insert supplies none — beside `branch_name` and `workflow_version_pin`, the version half of the pin whose slug half is `workflow_tag`. `V046` ([#299](https://github.com/NobuData/ouroboros/issues/299)) adds the transcript's accounting — `simulated`, decision **R4**'s watermark that every `run_events` row inherits and that is fixed once the run has written one; `event_cap` and `event_byte_cap`, the two caps bounding it; and `event_seq`, `event_bytes` and `events_elided_at`, which are `run_events_append()`'s alone, because a writer that could set them would be telling the store how much of itself it had used |
| `run_stages` | `V045` | One run of one workflow stage, one row per attempt ([#298](https://github.com/NobuData/ouroboros/issues/298), AO.1) — mockup 10's stage timeline, and the history `runs`' current-stage columns cannot hold | `(run_id, stage_key, attempt)` unique, so a retry is a new row and attempt 1 stays answerable; `status` is one of `pending\|active\|succeeded\|failed\|skipped` and `run_stages_clock` makes the timestamps agree with it, so a duration exists for exactly the rows the stepper prints one for and **no column stores one**; at most one stage per run is `active`; an attempt above 1 needs its predecessor to exist and to have ended (`run_stages_attempt_sequence`); `max_attempts` and `token_budget` are snapshots of the DSL's `limits` at pin time, bounded by the DSL's own ranges; and `note` is `generated always … stored` over `attempt` and three transition columns, so **no writer can supply one** (decision **R1**) |
| `run_events` | `V046` | Mockup 10's **agent transcript**, typed and append-only ([#299](https://github.com/NobuData/ouroboros/issues/299), AO.2, decisions **R3** and **R4**) — the product's flight recorder, and what every other card on the run page summarises | `seq` is dense from 1 and **the database's to assign** (`run_events_append()`), so the `?after=` cursor is exact and a supplied number that does not continue the transcript is refused rather than re-based; `actor` is one of `plan\|tool\|model\|gate\|user\|system` and `tool_tag` belongs to `tool` alone; a `model` entry **cannot exist without naming its model, stage and attempt** (decision **R4**); `stage_key` and `attempt` arrive together and are deliberately not a foreign key, because a report can reach here before the transition that created the row it names; a `payload`'s `hunks` are held to the three kinds the console can draw; `simulated` is **raised to `runs.simulated`** on write, so no client can report an unwatermarked entry into a simulated run, and the run's own flag is fixed from its first entry; the transcript is bounded by `runs.event_cap` and `runs.event_byte_cap` and bounded **visibly** — an entry past either is refused whole and the first refusal becomes a `system` **elision marker** carrying how many entries and bytes were dropped and over what span; and the table is append-only by trigger and by grant, with exactly one permitted update, which is that marker's figures growing |
| `queue_items` | `V009` | What the loop will do next — the ordered, estimable per-organization issue queue | `position` unique per organization and **deferrable**, so a reorder swaps inside a transaction; `(organization_id, issue_number)` unique, so an issue queues once; `effort` is one of `xs\|s\|m\|l\|xl`; the item's repository must belong to the item's organization |
| `token_usage` | `V010`, routing attribution `V020` | What the loop has spent — one append-only event per provider call, not one total per organization. Since `V020` it is also what mockup 06's routing matrix is computed from: `task_kind` says which routed kind of work a call served and `latency_ms` how long it took, so `$/run avg` and `p50 latency` are aggregates here rather than numbers stored on a route (decision **M7**) | Token counts and costs cannot go negative; `cost_cents` is nullable and null means **unpriced** ([#92](https://github.com/NobuData/ouroboros/issues/92) prices it) — never defaulted to 0; `provider` is stored folded, so the card counts providers rather than spellings; `run_id` is nullable and **sets null** rather than cascading, because deleting a run does not un-spend money; the usage's run must belong to the usage's organization. `task_kind` is shaped as `task_kinds.name` is but is deliberately **not** a foreign key (decision **F8**, as `runs.workflow_tag`): a ledger row records what happened, and retiring a kind must neither block, delete nor rewrite the history routed under it. `latency_ms` is non-negative, and **both are nullable, which is the point** — null is *not routed* and *not timed*, so an aggregate over none of either is null and the matrix renders the em-dash `M7` requires instead of a fabricated `$0.00` and `0.0s`; zero is permitted on `latency_ms` because a local daemon on loopback really answers inside a millisecond |
| `workspace_settings` | `V011`, `V041` | Org-scoped typed product settings — the auto-merge switch, and since [#250](https://github.com/NobuData/ouroboros/issues/250) the `runner_bearer_fallback` switch that decides whether a machine may enrol in the farm without a client certificate (default **false**, so a deployment that never considers the question never has the weaker path) | One row per organization, as a primary key, which is also what the settings upsert conflicts on; **absent while every setting is at its default** — read through `workspace_settings_effective`, never directly; `auto_merge_on_checks` is `not null default false`, so the switch has two positions and absence of the row is the only "unset"; `updated_by` references `"user"` and **sets null** rather than cascading, because deleting the person who flipped a switch must not turn it back off |
| `github_issues` | `V014`, author rule widened `V028` | The backlog as Ouroboros sees it — one row per mirrored GitHub issue, behind mockup 03's table and detail panel. **A cache, not a fork** (decision **K3**): GitHub owns every column but `sizing_status` | `(github_repo_id, number)` unique, which is also the sync's upsert key; `state` is `open\|closed` and `sizing_status` one of `unsized\|estimating\|sized\|needs_human`, defaulting to `unsized`; `labels` must be a JSON array of at most 100 non-empty **names** — GitHub's, not ours; `gh_url` must be `https` with a host, because it becomes an `href`; `gh_updated_at` cannot precede `gh_created_at`; `author_login` is GitHub's login rule with an optional literal `[bot]` suffix and a bound of 44 (`V028`, [#102](https://github.com/NobuData/ouroboros/issues/102)), because a GitHub App opens issues under one and `V014`'s org-login rule refused every one of them; the issue's repository must belong to the issue's organization |
| `provider_connections` | `V015`, cards' columns `V017` | Where a workspace's model providers are, and the sealed credential for the ones that need one — mockup 06's `.phealth` strip, and the shared foundation mockup 07 manages (decision **M2**). Since `V017` it also carries what a card *shows*: `monthly_cap_cents`, `added_by`, `last_used_at`, `capability_note` and the `enabled` switch | `kind` is one of `anthropic\|openai_compatible\|ollama\|copilot\|cursor\|custom` and `status` one of `active\|paused\|error\|unknown`, defaulting to `unknown` because a connection nothing has checked is genuinely unknown (decision **M8**); `credentials_encrypted` is **envelope-only** — an `ouro.v1.…` value or null, so a plaintext key cannot be stored by any writer — and null is legitimate, because a local provider needs none; `base_url` is `http`/`https` and required for `ollama` and `openai_compatible`, which have no public endpoint; `health` must be an object, may only carry content once `last_checked_at` exists, and a `latency_ms` must be a non-negative number — there is deliberately no defaulted `0ms`; `monthly_cap_cents` is non-negative and **nullable**, where null is *no cap* (the mockup's em-dash) and zero is the real instruction *spend nothing*; `added_by` references `"user"` and **sets null**, because deleting the person who added a provider must not delete the provider; `enabled` is `not null default true` and is **not** `status` — the switch is what a person decided, the status is what the last check measured, and a card draws both |
| `model_aliases` | `V015`, registry columns `V019` | The names a workspace's routes may use, and what each resolves to — and, since `V019`, the surface mockup 21 manages: the `enabled` switch, the unbound binding, `params`, `restrictions`, `notes` and `updated_by` | `alias` unique **per organization** and constrained to lower-case kebab, so uniqueness cannot be defeated by capitalisation; `model_id` is the raw provider model string and the **only** place one lives (decision **M1**); the connection is reached through a **composite** foreign key on `(organization_id, provider_connection_id)`, which is what holds an alias and its connection to one workspace, and it **restricts** on delete, so a provider aliases depend on cannot be removed out from under the routes that reach it. Since `V019` that binding is **nullable** — null is *unbound*, an alias created ahead of its key, admitted by the key's `MATCH SIMPLE` rather than by any change to it — and `enabled` is `not null default true` and **not** provider health: an **unbound alias can never be enabled**, by CHECK, so no service path can race past it and creating one without saying `enabled = false` is refused rather than corrected. `params` is a closed vocabulary — `thinking` (`off\|std\|max`), `token_budget`, `max_output` and `context_clamp` (whole tokens, 1 to 10000000) and `temperature` (0 to 2) — and `restrictions` a two-flag one (`review_vote_only`, `batch_ok`, boolean), because the table's chips are derived from both and a key nothing derives is a param that renders nowhere; whether a well-formed param *means* anything for the bound model is CH.2's ([#585](https://github.com/NobuData/ouroboros/issues/585)). `notes` is non-blank or absent; `updated_by` references `"user"` and **sets null**, because deleting the person who last edited an alias must not delete the alias |
| `provider_models` | `V017` | The models a connection has, as discovery reported them — the cards' chips and Ollama pull-list, mockup 21's registry, and what Y.1's aliases are validated against (decision **P6**) | `(provider_connection_id, model_id)` is unique, which is what makes discovery an **upsert** rather than a duplication; `display` is required, because a chip with no text is a chip nobody can click; `size_bytes` is positive or null — only a locally-pulled model has one, and null rather than zero is how *no size* is said; `meta` must be an object, and carries `context_tokens` under the key `model_prices.meta` already uses; cascades from the connection, which is deliberately its **only** tenancy — a discovered model is a fact about a connection, and every read enters through one |
| `task_kinds` | `V016` | The kinds of work a route can be written for — mockup 06's `8 task kinds`, and the vocabulary the WF stage catalog ([#145](https://github.com/NobuData/ouroboros/issues/145)), the estimator and the DSL's `route.task()` all read rather than each hardcode (decision **M3**) | `name` unique **per workspace** and lower-case kebab, so uniqueness cannot be defeated by capitalisation; `description` is required, because it is the matrix line that tells one row from its neighbour; `sort_order` is unique per workspace and **deferrable**, so a drag-reorder is plain SQL — and deliberately **not** dense, because nothing reads those numbers |
| `routes` | `V016` | One task kind's route: the owner of the ordered alias chain and of mockup 06's policy triple — **Allow fallback to local models**, the floor, and **Max cost per run** (decision **M4**) | **Exactly one route per task kind**, as a unique key rather than as application code, so resolution's *"the route of this kind"* has one answer; `tag` unique per workspace and its own column rather than derived, because the mockup's tags are not mechanical (`test-gen` → `testgen-primary`); `max_cost_cents_per_run` is **integer cents** — `$2.50` is `250`, never a float; `floor_hop_index` is null-permitting, at least 1 by CHECK and never past the end of the chain, which is `route_chain_intact()`; `updated_by` **sets null** rather than cascading, because deleting the person who last saved a route must not delete the route |
| `route_hops` | `V016` | The ordered fallback chain — mockup 06's numbered inspector rail, each hop naming a registry alias and carrying the hop-meta line beside it | `position` unique per route and **deferrable**, so a reorder swaps inside a transaction, and **dense from 1** by the `route_chain_intact()` constraint trigger — unlike `queue_items.position`, because these numbers are read: `floor_hop_index` counts them; a route may never be left with an empty chain; the alias is reached through a **composite** foreign key on `(organization_id, model_alias_id)` and it **restricts** on delete, so an alias a chain names cannot be retired out from under it; **there is no raw model id column here, in any of the three tables** — decision **M1** by construction |
| `escalation_rules` | `V018` | Mockup 06's *ESCALATION RULES* card — the three rules as **structured predicates that modify a route**, not as the sentences they read like (decision **M5**) | `"when"` is the WF-P8 predicate grammar scoped to routing — `effort_gte` (V009's five **F9** sizes, the same vocabulary the queue uses), `label` (GitHub's, as `V014` mirrors them) and `diff_kind` (`docs_only`), at least one, ANDed; `"then"` is **exactly one** of `{use_alias: {task_kind, alias, params?}}` — the mockup's *"(max thinking)"* is `params`, not prose — `{add_vote: {task_kind, alias}}` or `{route_local: {}}`; both are **domains**, so an unknown key is refused at the value rather than at the row; `display` is **`generated always … stored`** from the two, so a hand-written sentence is refused by PostgreSQL and an edited rule cannot keep the sentence it had; the task kind and alias a rule names must exist **in the rule's own workspace**, held by a deferred constraint trigger on all three tables; `sort_order` is unique per workspace and **deferrable**, which is what makes "which rule wins" have one answer and a drag-reorder plain SQL |
| `route_revisions` | `V021` | One row per press of mockup 06's **Save routes** — who changed the routing table, when, and exactly what moved ([#195](https://github.com/NobuData/ouroboros/issues/195)); the feed the audit log ([#26](https://github.com/NobuData/ouroboros/issues/26)) reads | `actor` references `"user"` and **sets null**, because deleting a person must not delete the record of what they changed; `diff` is CHECKed by `ouroboros.route_revision_diff_valid()` to `{routes: [{task_kind, changes: {<column>: {from, to}}}]}` — at least one route, at least one change each, every change a `{from, to}` pair — so a save that changed **nothing** is unstorable rather than merely not written; task kinds inside the document are *shaped* as `task_kinds.name` is but are deliberately **not** foreign keys, and hops are named by `model_aliases.alias`, because a revision is history a person reads months later and an id is a lookup into a row that may since have been repointed; there is **no `updated_at`** and no touch trigger, because an event that can be edited is not one; one index — `(organization_id, created_at desc, id desc)` — which is the only read this table has |
| `audit_events` | `V022` | Who did what to which credential, from where, and when — the platform audit trail ([#225](https://github.com/NobuData/ouroboros/issues/225)), in the shape [#26](https://github.com/NobuData/ouroboros/issues/26) specified and landed early because decision **P5** puts credential auditing in the MVP. `ouroboros-rest`'s audit module is the only writer; `GET /api/v1/providers/audit` is the only reader, and mockup 07's **Audit log** sheet is what it draws | **Append-only, enforced twice**: `ouroboros_app` — a role this migration creates `nologin` — holds `select` and `insert` and nothing else, and `audit_events_no_update` refuses a revision from *any* role including the owner, because a superuser bypasses every grant and a rule that is true only in production is a rule nobody can test. Both foreign keys shape that trigger: `organization_id` **cascades**, which is why the trigger covers `update` and not `delete` — a delete-refusing trigger would make removing a workspace impossible rather than protecting the trail — and `actor_id`'s `on delete set null` **is** an update, so exactly that one statement is permitted and nothing beside it (*what happened cannot be rewritten; who did it can be forgotten*). `actor_id` is nullable because a `credential.lease_granted` has no person behind it; the **subject** is `subject_type` + `subject_id` with deliberately **no** foreign key, because `provider.deleted` is exactly the row one would make unwritable; `action` and `subject_type` are CHECKed to an identifier *grammar* and not to a vocabulary, so adding an event is an application release while a misspelled one is still refused; `ip` is `inet`, which refuses a string that is not an address; `detail` must be an **object** so the secrecy grep can enumerate its keys — that it holds no secret material is enforced by the writer and by that grep, because a CHECK could only match the credential shapes somebody thought of. There is **no `updated_at`**, and one index — `(organization_id, occurred_at desc, id desc)` — which is the only read this table has; #26's BRIN is deliberately not created until something sweeps by time |
| `resolution_snapshots` | `V024` | What a run's routing resolution decided, **kept** — the stored truth behind mockup 21's *RESOLUTION CHAIN* card and the run console's transcript ([#582](https://github.com/NobuData/ouroboros/issues/582), decision **R9**), in the versioned shape CH.6 ([#589](https://github.com/NobuData/ouroboros/issues/589)) contracts and AF.2 ([#235](https://github.com/NobuData/ouroboros/issues/235)) writes at execution time; until invocation exists, `R__dev_seed_routing.sql` writes run #482's. Landed here because a fixture needs a table, on `V022`'s reasoning; #589 inherits it and adds the read path | One row per resolution. The **run** is the one foreign key — **cascading**, because a transcript of a deleted run is a transcript of nothing, and held to the snapshot's workspace by `resolution_snapshots_run_in_organization`, a trigger on `V008`'s precedent rather than a composite key, so `runs` gains no second index for it; `task_kind` and `route_tag` are **names** with no foreign key (`V020`'s decision **F8** — a transcript survives a rename); `outcome` is `resolved\|fail_run`, held to the chain by `resolution_snapshots_outcome_coherent` (resolved exactly when a hop was kept); `duration_ms` is nullable and never defaulted (null is *nobody timed it*, `0` is a measurement — decision **M8**); `chain` and `rules` are jsonb whose grammar three `immutable` validators CHECK clause by clause — every hop with its `index` (dense from 1), alias, model, params, the provider *as the health snapshot then saw it*, the masked `key_suffix` (at most sixteen alphanumerics, a shape no credential fits), `kept`/`dropped`, Z.1's `code` and sentence, and a timing only on a hop that was tried; `shape_version` is CHECKed to exactly the versions the validators can read, so a writer ahead of the schema is refused rather than stored unreadably. **Append-only**: no `updated_at`, and `resolution_snapshots_no_update` refuses a revision from any role, with no exception because both foreign keys cascade. Three indexes — latest-first per workspace, per run, and a `jsonb_path_ops` GIN on `chain` for the card's `chain @> '[{"alias": …}]'` read. No read path: the endpoint is #589's |
| `alias_revisions` | `V025` | Who changed a model alias, when, and what moved — the lightweight revision record every write of the registry's lifecycle API ([#584](https://github.com/NobuData/ouroboros/issues/584), CH.1) leaves behind; `V021`'s table for the registry. Promoted into `audit_events` by CJ.2 ([#599](https://github.com/NobuData/ouroboros/issues/599)), whose nouns its columns are | One row per write. `alias_id` references `model_aliases` and **sets null**, so a `deleted` revision outlives the row it describes; `alias` is the name as it read after the write, text with no foreign key, kept for exactly that case; `actor` references `"user"` and **sets null**; `action` is one of `created\|renamed\|rebound\|enabled\|disabled\|edited\|duplicated\|deleted` (a `PATCH` that did several records the most consequential — the service ranks them — and its diff carries the rest); `diff` is `{<column>: {from, to}}`, at least one entry, every value a pair, every key a column name or `duplicate_of`, CHECKed by `ouroboros.alias_revision_diff_valid()` so a no-op is unstorable. **Append-only by construction**: no `updated_at`, no touch trigger. Two indexes — a workspace's history newest first, and one alias's (also the referencing side of the set-null key) |
| `issue_estimates` | `V026`, `V034`, `V038` | Everything mockup 03 calls **AI Work Breakdown**, as versioned latest-wins rows ([#100](https://github.com/NobuData/ouroboros/issues/100), decision **K4**) — effort, confidence, the workflow tag and routed model, the breakdown and trace documents, and the regression risk with the sentence under it. `V014` mirrors the issues; this is what sizing says about them, and re-estimation is the next row rather than an edit, because the mockup offers three ways to ask for one and a trace is only worth reading beside the answer it replaced. Written by L.3 ([#107](https://github.com/NobuData/ouroboros/issues/107)), seeded by K.5 ([#103](https://github.com/NobuData/ouroboros/issues/103)) | `(github_issue_id, version)` unique — and, **read backwards, the descending index latest-wins needs**, which is why no second one was created; `version` is held *ascending* within an issue by `issue_estimate_version_monotonic()`, because unique alone accepts 3 then 2 and *latest* would then be the older answer. `effort` is `xs\|s\|m\|l\|xl` and `risk` `low\|medium\|high` — the mockup's two vocabularies; `confidence` is 0-100 with both ends real answers. `suggested_workflow` and `routed_model` are **opaque** (decisions **K5**, **K6**), shaped and bounded as `runs.workflow_tag` and `runs.model` are under **F8** — no vocabulary, because mockup 04 turns the fixed four tags into workspace-defined entities, and no foreign key, because this records a resolution that happened rather than configures one (which is why it is no breach of **M1**). `breakdown` and `trace` are **closed** jsonb grammars CHECKed by `ouroboros.issue_estimate_breakdown_valid()` and `…_trace_valid()` — exactly `files[]`, `est_tokens`, `cycle_min`, `cycle_max`, `est_minutes`, and exactly `estimator`, `sized_at`, `tokens_used`, `signals[]` — with `sized_at` an ISO-8601 instant *with an offset*, checked by regex because a `timestamptz` cast reads the session's `TimeZone` and is not immutable. Decision **K10** is `issue_estimates_provenance`, its own constraint so a rejected write names the decision: `trace->>'estimator'` is a non-blank **string**, always. Every bound is the estimation contract's ([#105](https://github.com/NobuData/ouroboros/issues/105)) and never stricter — a column that refused a legal estimate would leave L.3 holding an answer it cannot store. **Append-only**: no `updated_at`, and `issue_estimates_no_update` refuses a revision from any role, with no exception because the one foreign key cascades. There is deliberately **no `organization_id`** — the issue is the whole of its tenancy, as `provider_models`' connection is. `V034` ([#272](https://github.com/NobuData/ouroboros/issues/272)) adds a nullable **`draft_id`** and makes `github_issue_id` nullable beside it: an estimate has **exactly one subject**, a mirrored issue or a ticket draft (`issue_estimates_one_subject`), which is decision **N3** — there is one sizer in the product, so mockup 09's drafts are sized by this table through this pipeline rather than by an estimation path of their own. Versions are per subject: `(draft_id, version)` is unique and `issue_estimate_draft_version_monotonic()` holds a draft's ascending, because `V026`'s key and trigger both go quiet against a null issue — `null = null` is unknown, and a unique key treats nulls as distinct. The column cascades from the **draft**, which is what lets regeneration replace the unselected drafts without orphaning the estimates of the ones that remain. `V038` ([#281](https://github.com/NobuData/ouroboros/issues/281)) adds `ticket_id` as a **third** subject by the same pattern — `issue_estimates_one_subject` now counts three columns, `(ticket_id, version)` is unique and `issue_estimate_ticket_version_monotonic()` holds a ticket's versions ascending — so AL.5's nightly job sizes canonical tickets through the one pipeline; it cascades from the ticket, whose `organization_id` is the whole of the estimate's tenancy |
| `github_credentials` | `V027` | The **per-workspace GitHub token** the backlog sync authenticates with ([#101](https://github.com/NobuData/ouroboros/issues/101), decision **K1** — the MVP's credential is a personal access token an administrator pastes in; the GitHub App installation flow is O.1, [#122](https://github.com/NobuData/ouroboros/issues/122), and brings its own columns rather than redefining this one). `V003` records *which* repositories a workspace has enabled and `V014` records what is in them; neither records how this product is allowed to ask. Written and read by `ouroboros-rest`'s `github/` module; K.4 ([#102](https://github.com/NobuData/ouroboros/issues/102)) is what will use it | One row per workspace, keyed by the workspace — `organization_id` is the primary key, because there is nothing else a row could be and because that value is half the envelope's additional authenticated data and must therefore never change. `token_encrypted` holds one of the vault's envelopes (AD.1, [#222](https://github.com/NobuData/ouroboros/issues/222)) and `github_credentials_token_sealed` refuses anything else — `V015`'s guarantee for `V015`'s reason: the service is one writer and a CHECK is *every* writer, so a plaintext `ghp_…` cannot be stored by a seed, a fixture or a hand-written `update`, and the vault's **adoption** path therefore has nothing to do on this table. Deliberately **no mask or suffix column** (a derived value in a second column is a second source of truth a rotation can leave disagreeing — the mask is computed from the plaintext at read time) and **no `rotated_at` or `last_used_at`** (`updated_at > created_at` already answers *has this been rotated*, *who* did is `audit_events`, and *when a repository was last polled* is `github_repos.issues_synced_at`). Clearing **deletes the row**: `token_encrypted` is `not null`, so "no token" is an absence rather than a row to inspect. `updated_at` is the `V001` trigger's. **Cascades from `organization`**, together with `tenant_keys` (`V013`) — deleting a workspace destroys both the ciphertext and the key that could open it, in live rows and in every backup |
| `workflows` | `V029` | A workspace's workflows — the entities mockup 04's `.wf-list` rail lists and its page head names ([#132](https://github.com/NobuData/ouroboros/issues/132), P.1), and the real thing behind the opaque `workflow_tag` strings `runs` and `queue_items` carry. Nothing writes it yet: P.2 ([#133](https://github.com/NobuData/ouroboros/issues/133)) is the DSL, P.3 the endpoints, [#136](https://github.com/NobuData/ouroboros/issues/136) the seed | `slug` unique **per organization**, lower-case kebab and bounded at **64 characters — the bound `runs.workflow_tag` and `queue_items.workflow_tag` already carry**, so every stored tag is a slug and the existing `standard-fix`, `feature-loop`, `docs-loop` and `deps-refresh` remain valid unchanged. Those columns are deliberately **not** turned into foreign keys (decision **F8**): a closed run must still render under a workflow that has since been renamed, so the bridge is a join on `(organization_id, slug)` — which is the unique key, so it has one answer and is one index probe. `status` is `active\|paused\|archived`, the vocabulary the rail's err-dot is rendered from, and there is deliberately **no `draft` value** — unpublished work is a draft row, not a status. `current_version` is a **pointer, not a cache** of `max(version)`: it names the published version *in force*, held to a real version **of this workflow** by the composite key `workflows_current_version_fk`, so a rollback to an earlier version is this column moving and no history changing; `MATCH SIMPLE` admits the null, which is a workflow that has only ever had a draft. Cascades from `organization` |
| `workflow_versions` | `V029` | A workflow's version history plus its one mutable draft — the two things mockup 04's head shows as `v14` and **Publish v15** ([#132](https://github.com/NobuData/ouroboros/issues/132), decision **P1**). A run pins the version it executed, which is why a published row is a record rather than a document | **Immutable once published**, by trigger rather than by grant — `V022`'s argument, since the development stack connects as the database owner and a superuser bypasses every grant. Two updates pass: any edit of the draft, and the `published_by` foreign key's own `ON DELETE SET NULL`, narrowed so an attribution may only ever be *erased* and never while another column moves (*what was published cannot be rewritten; who published it can be forgotten*). No delete counterpart, for `V022`'s reason — `workflow_id` cascades, and a delete-refusing trigger would make removing a workflow fail; what cannot be deleted is the version in force, which the pointer's key refuses. **The draft is the row with `version is null`**, not an `is_draft` flag: publishing is what confers a number, and `workflow_versions_version_publish_stamp` ties the number to the publish stamp so the two cannot disagree, while a draft carries neither a publisher nor a change note. *At most one draft* is the partial unique index `workflow_versions_one_draft_idx`, which is also the read that opens it. **Publishing creates version N+1** — `workflow_versions_next_version` refuses any other number rather than assigning the right one (`V026`'s argument: two publishers racing both compute `max + 1`, and the unique key lets exactly one commit), and versions are **dense from 1**, unlike `issue_estimates.version`, because a person reads `v14` as the fourteenth publish and nothing deletes a published version. `definition` is CHECKed to be a jsonb **object and no further** — the grammar is P.2's and an empty `{}` is the legal state of a canvas with nothing on it. `updated_at` is the draft's *last edited*, and its touch trigger is scoped to drafts so the stamp cannot come to mean *when somebody was forgotten*. No `organization_id`: tenancy is the workflow's, as `provider_models`' is its connection's |
| `ticket_sources` | `V030`, `V031` | Where a workspace's tickets come from — one row per configured tracker ([#138](https://github.com/NobuData/ouroboros/issues/138), decision **P6**), which is what makes ingestion pluggable rather than GitHub-shaped. Q.2's registry resolves a provider from `kind`, its sync loop iterates the `active` rows, and Q.4 ([#141](https://github.com/NobuData/ouroboros/issues/141)) manages them. Nothing writes it yet | `display_name` unique **per organization** — two sources with one name cannot be told apart by anything that renders them, and deliberately *not* unique on `kind`, because two GitHub sources in one workspace (two enterprises, or a personal account beside an org) is a legitimate configuration. `kind` is `github\|gitlab\|jira\|linear\|custom` — `custom` is in the set from the start so a community provider needs no migration before it can store a row — and `status` is `active\|paused\|error`, three states rather than a boolean so a failing source is never confused with one somebody switched off, defaulting to `active`. `config` is non-secret settings and is CHECKed to be an **object and no further**: the per-kind shape is Q.2's SPI contract, because a grammar spelled here would be GitHub's under a neutral name. `credentials_encrypted` is **`text` and envelope-only**, `V015`'s decision against the same ER diagram and `V027`'s after it — `ticket_sources_credentials_sealed` refuses anything that is not one of the vault's `ouro.v1.…` envelopes, so a plaintext token cannot be stored by any writer and #222's re-sealing sweep has nothing to do here; nullable, because a source exists before anybody has finished configuring it. `sync_cursor` is opaque text and non-blank and cannot precede the `synced_at` of the sync that produced it — `V014`'s decision **K2** one level up, and the watermark lives on the *source* for its reason. Cascades from `organization`, so a deleted workspace takes its sealed credentials with it. `V031` ([#139](https://github.com/NobuData/ouroboros/issues/139)) adds `status_reason`: the sentence behind the dot — `rate limited until 14:20 UTC`, `credentials rejected` — null when there is nothing to say, non-blank and ≤ 200 characters when there is, and a *sentence* rather than a code because `custom` makes the failure set open. Deliberately not tied to `status = 'error'`, since a paused source may keep the reason its last poll produced |
| `ticket_sources_public` | `V030`, `V031` | `ticket_sources` **without `credentials_encrypted`** — what every read path selects. The mechanism behind the acceptance criterion that the sealed credential *"is never selected by read paths"*: a comment asking readers not to select a column is not a mechanism and `select *` is one autocomplete away from breaking it, so the secret is **absent** rather than forgotten, and only the one code path that has to decrypt names the table | A view, so it enforces nothing itself — what is enforced is its shape. `tests/constraints.sql` asserts over `information_schema` that the column is not in it and that the other ten are, so a later migration that widened it back fails the build rather than quietly re-exposing the credential. `V031` ([#139](https://github.com/NobuData/ouroboros/issues/139)) appended `status_reason` — the eleventh column, added at the end because `create or replace view` may append and may not reorder, so every existing reader keeps its ordinal |
| `tickets` | `V030` | The canonical intake row ([#138](https://github.com/NobuData/ouroboros/issues/138), decision **P6**) — one per ticket per source, whatever tracker it came from, and source-agnostic by construction: no repository, no issue number, no `gh_` prefix. `github_issues` remains the shipped intake table until Q.3 ([#140](https://github.com/NobuData/ouroboros/issues/140)) cuts the sync over; this table is empty until then, which is the honest state and the reason the seed fills sources and not tickets | `(source_id, external_id)` unique — one row per ticket per source, the key a provider's sync upserts on, and two sources may each hold `PROJ-142` because an identifier is unique within the tracker that issued it and nowhere else. `external_key` is deliberately **not** unique: it is the display form, a label rather than an identity. `state` is `open\|closed`, the one vocabulary every tracker maps onto (collapsing Jira's or Linear's richer workflow is the provider's job, so the filter's options do not change with the tracker), and `sizing_status` is `unsized\|estimating\|sized\|needs_human` defaulting to `unsized` — **`V014`'s four values and default, verbatim and as an acceptance criterion**, because the estimation pipeline claims work by this column. `labels` is a JSON array of at most 100 non-blank names of at most 255 characters, through `V026`'s `jsonb_string_list_valid` rather than `V014`'s open-coded jsonpath; `meta` is an object and no further. `external_url` must be `https` with a host, `V014`'s rule verbatim, because it becomes an `href` and an `href` is a place a scheme executes. `author` carries **no login grammar** — `V014`'s GitHub pattern would reject a Jira account id and a Linear display name, which is three of the five kinds — only non-blank and bounded. `body` is bounded at 256 KiB, which is **storage sanity rather than a tracker's rule**: with an open provider set there is no single limit to copy, and this constraint must never be the reason a ticket a provider legitimately returned cannot be stored. `source_updated_at` cannot precede `source_created_at`; the ticket's source must belong to the ticket's workspace, by `tickets_source_in_organization` — `V009`'s and `V010`'s guard with a third parent column. Four indexes: the filter path `(organization_id, source_id, state)`, `jsonb_ops` GIN on `labels`, trigram GIN on `title`, and a GIN on `meta` for the *Repository* filter P6 moved out of a column. Cascades from both parents |
| `draft_batches` | `V034` | One press of mockup 09's **Generate Tickets** ([#272](https://github.com/NobuData/ouroboros/issues/272), AK.1) — the prompt, the optional outline, which planner answered, the target source and milestone, the two toggles, and where the batch is in its life. Decision **N1**: drafts are rows with a lifecycle rather than a response held open in a browser tab, because the page's safety promise is a review step and a tab cannot be re-opened tomorrow, reviewed by somebody else, or asked what happened to each draft when a push half succeeded. Nothing writes it yet — AL.4 ([#280](https://github.com/NobuData/ouroboros/issues/280)) is the API and AL.3 ([#279](https://github.com/NobuData/ouroboros/issues/279)) the push | `status` is `drafting\|sized\|pushing\|pushed\|abandoned`, closed because the card renders the word as a pill, and `abandoned` is deliberately not the same as failed — a batch somebody read and threw away. `planner` is **shaped rather than enumerated** (decision **N2**): a name and a version, so `outline-v0`, AN.1's `llm-v1` ([#289](https://github.com/NobuData/ouroboros/issues/289)) and the Build Analyzer's `analyzer-vN` ([#514](https://github.com/NobuData/ouroboros/issues/514)) all fit while the blank, the capitalised and the unversioned are refused — a closed CHECK would make every analyzer generation a migration, widened by whoever noticed the insert failing rather than by whoever chose the name. `source_prompt` is non-blank and both texts are bounded for **storage sanity rather than at anybody's limit**, `V030`'s argument for `tickets.body`. `target_milestone` is null or non-blank, because `''` is not *no milestone* — null is. A batch's target source must belong to the batch's workspace, by `draft_batches_target_source_in_organization` — `V030`'s guard reaching its parent through a differently named column, and a sibling rather than a reuse for that function's own reason. `created_by` set-nulls, since removing a person must not delete the work they planned. One index, `(organization_id, created_at desc)`, which is the page's own list; `target_source_id` is deliberately unindexed, leaving `ticket_sources`' cascade a scan of a table that holds a handful of rows per workspace. `epic_id` arrived with `V036` ([#274](https://github.com/NobuData/ouroboros/issues/274)) — the migration that creates the epics it references, which is why `V034` declined to add a bare uuid pointing at nothing. It **sets null** rather than cascading, `ticket_drafts.pushed_ticket_id`'s posture: a batch whose epic is deleted is still a batch somebody generated, reviewed and possibly pushed, and deleting that record to tidy up a lane would lose which issues exist. Null is a batch belonging to no lane, the ordinary case rather than a missing value, and `draft_batches_epic_in_organization` is the third of this table's workspace guards — deliberately unindexed, as `target_source_id` is, since the epic's set-null is a workspace-shaped event over a handful of batches |
| `ticket_drafts` | `V034`, `V037` | The draft tickets of one batch ([#272](https://github.com/NobuData/ouroboros/issues/272)) — mockup 09's `OTA-1`…`OTA-6` rows, each carrying the checkbox that makes the review step real and its own record of what the push did to it. Sized through `issue_estimates.draft_id` (decision **N3**), never through a sizer of its own | `(batch_id, local_key)` unique — `blocks OTA-3` resolves within its batch and nowhere else, and two batches may each hold an `OTA-1` because the key is the planner's numbering rather than an identity. Its leading column also serves the batch cascade and every read of a batch's drafts, which is why `batch_id` has no index of its own. `local_key` carries **no pattern**: `OTA-` is `outline-v0`'s prefix, not this schema's, and AN.1 may number its batches differently. `selected` defaults true, which is how a freshly generated batch is drawn — the reviewer's work is to *remove*. `suggested_workflow` is opaque (decision **K5**) and nullable, `V033`'s honest third state. `push_state` is `pending\|pushed\|failed`, **per draft rather than per batch**, because a partial push is the ordinary outcome and a batch-level failure would lose which issues exist: `ticket_drafts_push_state_coherent` gives each state its own evidence, and `ticket_draft_push_state_transition()` holds the two rules a CHECK cannot — a draft becomes pushed only with the ticket it became, and **`pushed` is terminal**, because a tracker will not un-create an issue. The one write that trigger lets through on a pushed draft is the foreign key's own `on delete set null`, since refusing it would let a planning draft veto the removal of a workspace — `V029`'s `published_by` exception, same shape. `push_error` is a **structured reason, not a stringified exception**: exactly `code` (a lower-case slug the card can branch on), `message`, and an optional `detail` object, by `ouroboros.ticket_draft_push_error_valid()`. There is deliberately **no `organization_id`** — the batch is the whole of a draft's tenancy, as the issue is an estimate's — so `ticket_drafts_ticket_in_organization` is what holds a pushed ticket to the batch's workspace `provenance` (`V037`, [#280](https://github.com/NobuData/ouroboros/issues/280)) is `planned\|edited`, closed — `edited` once a person has rewritten the title or body through the planning API, so the planner is never credited with text it did not produce |
| `ticket_dependencies` | `V035` | The **`blocks` relation over drafts and canonical tickets alike** ([#273](https://github.com/NobuData/ouroboros/issues/273), decision **N4**) — mockup 09's `blocks OTA-3` draft note and the Backlog Health card's `Blocked` meter, which are one relation seen at two moments in its life rather than two features. AL.3 ([#279](https://github.com/NobuData/ouroboros/issues/279)) rewrites draft references to ticket references in the same transaction that creates the tickets, so a half-pushed batch has a coherent graph rather than an inconsistent one; AL.5 ([#281](https://github.com/NobuData/ouroboros/issues/281)) counts the blocked end | Each endpoint is **exactly one** of a ticket draft or a canonical ticket — `num_nonnulls(…) = 1` per end, `V034`'s `issue_estimates_one_subject` for the same kind of polymorphic reference — stated once per end, so a rejected write names the end that was wrong. `ticket_dependencies_pair_key` is `unique **nulls not distinct**` over all four endpoint columns, which is what makes it a key at all: three of them are null in any row, and under the default nulls-are-distinct rule an identical edge would be unique against its twin every time (`V012`'s `model_prices_match_key`, a second table on; `V029` declined the same construct because *there* it would have folded two rules into one name, and here there is one rule the name states). `origin` is `planned\|synced` — authored here versus mirrored back from a tracker's native relations — a **closed** CHECK where `draft_batches.planner` is a grammar, because a dependency is either read out of a tracker or it is not; the Blocked metric counts **both**, and the column sits deliberately **outside** the pair key so a sync upserts an edge Ouroboros authored rather than doubling the number this table exists to make true. **Nothing blocks itself** — a one-node cycle, and the only unpushable shape a CHECK can catch without walking the graph — written as a null-guarded inequality per kind rather than with `is distinct from`, which reads better and would reject every same-kind edge, since `null is distinct from null` is false. All four endpoint references **cascade**, unlike `ticket_drafts.pushed_ticket_id`'s set-null, and the difference is not an inconsistency: a draft whose ticket is deleted was still truthfully pushed, but an edge whose end is gone is a dependency on nothing. That cascade is also what keeps regeneration safe, inheriting `V034`'s placement — replacing the unselected drafts takes their edges in both directions and nobody else's. There is deliberately **no acyclicity constraint**: a cycle is a *walk*, so AL.4 ([#280](https://github.com/NobuData/ouroboros/issues/280)) enforces it on every write and AK.5 ([#276](https://github.com/NobuData/ouroboros/issues/276)) probes the stored graph, whose node identity is `coalesce(draft_id, ticket_id)` — two uuid primary keys that cannot collide, which is what makes that probe one recursive CTE rather than a four-branch join. `organization_id` is **carried rather than inherited**, unlike `ticket_drafts`', because an edge has two parents of two possible kinds and no single one to take tenancy from — so `ticket_dependencies_endpoints_in_organization` holds all four references to it, a ticket directly and a draft through its batch |
| `planning_epics` | `V036` | The gantt lanes of mockup 09's **Roadmap** card as planning entities ([#274](https://github.com/NobuData/ouroboros/issues/274), decision **N5** / option 4-A) — name, tint, month range, status, lane order, and the roadmap head they belong to. Every column is planning **intent**: no tracker stores any of them, which is what makes Ouroboros their unambiguous owner and the other half of the split that leaves nothing to merge. Nothing writes it yet — AL.4 ([#280](https://github.com/NobuData/ouroboros/issues/280)) is the epic CRUD and the roadmap payload, AL.3 ([#279](https://github.com/NobuData/ouroboros/issues/279)) the push, AM.4 ([#286](https://github.com/NobuData/ouroboros/issues/286)) the gantt | **There is deliberately no progress counter**: `12 issues · 8 done` is tracker truth, so a stored count would read `8 done` while the tracker said nine — it is computed by `planning_epic_progress` instead. `tint` is `accent\|model\|warn\|ok\|neutral` and `status` is `active\|proposed\|done\|unscoped`, both closed because each selects a rendering rule, so a sixth value is a bar the card cannot draw. `start_month` and `end_month` are nullable **as a pair** by `num_nonnulls(…) <> 1` — `V035`'s endpoint idiom inverted, since half a range is a bar with one end — are held to the **first of the month** because the axis is months (the `::timestamp` cast in that CHECK is load-bearing: `date_trunc` over `timestamptz` is not immutable, `V026`'s reason), and must run forwards. Both null is the dashed `unscoped` lane, a first-class state rather than a row with placeholder dates; the pairing is deliberately **not** tied to `status`, because the two are set by different gestures and a CHECK binding them would refuse an epic mid-scheduling. `sort_order` is unique per workspace and **deferrable initially deferred** — uniqueness because two lanes sharing a number have no deterministic order, deferral so a reorder is plain SQL inside one transaction (`task_kinds.sort_order`, `V016`) — and positive, and deliberately **not dense**, because nothing reads these numbers. `roadmap_name` and `roadmap_window` are carried on the lane rather than in a `roadmaps` table: two strings nothing joins to, and the only read is the head of a card already selecting these rows |
| `planning_epic_progress` | `V036` | `12 issues · 8 done`, **computed** — the mechanism behind the acceptance criterion that no stored counter exists to go stale ([#274](https://github.com/NobuData/ouroboros/issues/274)), and the roadmap payload AL.4 returns. A view for `ticket_sources_public`'s reason: AL.4 and AM.4 both need this number, and two hand-written counts would eventually disagree about which states count as done, so the card and the API would print different chips for the same epic | A view, so it enforces nothing itself — what it guarantees is that there is **one** definition. `done` is `state = 'closed'`, `V030`'s two-word vocabulary and the only one every tracker maps onto, so collapsing Jira's or Linear's richer workflow stays the provider's job rather than becoming a per-tracker branch here. **`left join` twice**, so an epic with no linked tickets reads `0 · 0` rather than vanishing from the roadmap — which is exactly the unscoped lane, and a missing lane is the worst possible reading of *unscoped*. Grouped by the epic's primary key, which is what lets its own columns be selected without being repeated. `tests/constraints.sql` asserts the four mockup chips against fixtures **and** that closing a ticket underneath one moves it — the only way to tell a computed number from a cached one that happens to agree |
| `epic_tickets` | `V036` | Which canonical tickets are in a planning lane ([#274](https://github.com/NobuData/ouroboros/issues/274)) — the join `planning_epic_progress` computes the chip over | It holds **no tracker truth at all**: no state, no done flag, no ordinal, because each would be a second copy of something the ticket already knows and the point of **N5** is that nothing here can go stale. `(epic_id, ticket_id)` is unique — the pair rather than the ticket, deliberately: a ticket may serve two epics, and the mockup's five lanes partitioning its backlog (12 + 9 + 14 + 7 is the 42 the Backlog Health card counts) is that workspace's planning rather than a rule of the schema. Its leading column serves the epic cascade and the chip's own read, which is why `epic_id` carries no index of its own; `ticket_id` **is** indexed, unlike `epic_mirrors.source_id`, and the difference is the delete that really happens — a sync removes tickets one at a time, where a source leaves in one event. Both references cascade: a link to a deleted ticket would otherwise be counted into the chip as a ticket that no longer exists. No `updated_at` and no touch trigger, because nothing on the row is mutable — both columns are the key, so moving a ticket between lanes is a delete and an insert. There is deliberately **no `organization_id`** — the epic is the whole of a link's tenancy — so `epic_tickets_ticket_in_organization` is what stops one workspace's closed tickets being counted into another's chip |
| `epic_mirrors` | `V036` | Where a planning epic lives in a tracker ([#274](https://github.com/NobuData/ouroboros/issues/274)) — the bookkeeping **N5** needs on the push side. When AL.3 ([#279](https://github.com/NobuData/ouroboros/issues/279)) creates a GitHub parent issue for an epic and assigns it a milestone, those references must persist: otherwise the next push creates a *second* parent issue and the epic is split across two trackers' worth of container, which is **N6**'s idempotency failure one level above the drafts `V034` gave their own `push_state` | `(epic_id, source_id, kind)` unique is **the idempotency key**, not decoration — it is what makes *"a second push finds the existing parent issue rather than creating another"* true, and what the push upserts onto. `kind` is **in** the key rather than beside it: a `parent_issue` and a `milestone` in one GitHub source are two different containers for one epic, so a key without it would make the push's second write overwrite its first. The vocabulary is `milestone\|parent_issue\|jira_epic`, closed, and carrying `jira_epic` **ahead of its writer** for `V030`'s `custom` reason — AN.2 ([#290](https://github.com/NobuData/ouroboros/issues/290)) should not need a migration before it can store its first row. `external_ref` is text for `tickets.external_id`'s reason (a GitHub number, a milestone title and a Jira key are three shapes) and non-blank, because `''` would send the next push looking for a nameless container. `source_id` is deliberately unindexed, `V034`'s decision for `draft_batches.target_source_id` verbatim; a `(source_id, kind, external_ref)` index is left to AN.2, which brings the reader that wants it. No `organization_id` — the epic is the whole of a mirror's tenancy — so `epic_mirrors_source_in_organization` is what stops an epic being pushed into another workspace's repository |
| `reestimation_runs` | `V039` | One night of the nightly re-estimation job ([#281](https://github.com/NobuData/ouroboros/issues/281), AL.5, decision **N9**) — when it started, whether it finished, and the batch bound it ran under. What the Backlog Health card's last-run tooltip reads, so *"Estimator re-runs nightly"* is checkable rather than copy. Written by `ouroboros-rest`'s `ReestimationJob` | `night` is **unique** (`reestimation_runs_night_key`): every replica schedules the job, the first to start a night inserts it, and every later one collides and stands down — so a fleet does not multiply the batch bound. `status` is `running\|succeeded\|failed`, closed, with a finish time exactly when a run has settled and never before it started. `batch_limit` is at least one. Deployment-wide — no `organization_id` — because *when it ran* is any workspace's to read; `(started_at desc)` is indexed for the tooltip's latest-run read |
| `reestimation_run_counts` | `V039` | What one nightly run did in one workspace ([#281](https://github.com/NobuData/ouroboros/issues/281)) — the open unsized tickets it selected, how many it queued, and how many the pipeline was already sizing | Keyed `(run_id, organization_id)`, cascading from both: a count of somebody's backlog is tenant data, so it is never a column of the run. `queued + in_flight = found` and nothing is negative, by constraint — a count that did not add up would be a ticket the job lost track of. A workspace the run found nothing in has no row and reads zeros |
| `runner_pools` | `V040` | An execution world builds can be dispatched to ([#249](https://github.com/NobuData/ouroboros/issues/249), AH.1, decision **B4**) — mockup 08's POOLS card. Executor kind, the pinned image for a container pool, the environment a job may carry, how much one runner may run at once, and the queryable tags a marketplace snippet's `runner_tags` resolves against ([#776](https://github.com/NobuData/ouroboros/issues/776)) | `(organization_id, name)` unique and slug-shaped, because the name travels on a command line as `--pool`. `executor` is `container\|shell`, closed. `runner_pools_image_for_container` is a **biconditional**: a container pool has an image and a shell pool has none — half of it prevents a pool that cannot run anything, the other half a pinned image on the card that nothing will ever pull. `env_allowlist` is an allow-list rather than a deny-list, since the machines it reaches are the customer's. `autoscale_pref` is the mockup's *"Auto-scale to cloud when queue > 5"* — **stored and inert** (decision **B9**) until AJ.1 ([#263](https://github.com/NobuData/ouroboros/issues/263)), and still a closed document, because the point of storing an inert preference is that its activator can read it. `tags` is GIN-indexed and lower-case-slug-shaped, which is the difference between a tag being resolvable and being decoration. The runner counts the card prints are counts of `runners`, never a column here. `(id, organization_id)` is unique so every reference to a pool can carry the workspace. `default_command` (`V043`, [#252](https://github.com/NobuData/ouroboros/issues/252)) is what dispatch falls back to when a submission names no command — the canonical rendering of an argv, the form `build_jobs.command` holds — and `runner_pools_default_command_shape` refuses a blank one |
| `runners` | `V040` | One machine in a workspace's farm ([#249](https://github.com/NobuData/ouroboros/issues/249)) — **the one table in this schema that holds live state**: a heartbeat every ten seconds writes `status`, `last_seen_at` and a `telemetry` snapshot (decision **B7**), and every load of mockup 08 reads them back | **Observation and intent are two columns.** `status` is what the fleet last saw — `online\|building\|draining\|offline\|removed` — and `desired_state` is what an operator decided — `active\|draining\|removed`. `runners_draining_is_intended` stops a heartbeat writing a pill nobody chose, and `runners_removed_is_intended` makes removal true on both sides or neither; without the pair, *"who drained this?"* has no row to answer from and a drained machine is indistinguishable from a dead one. Rows are **never deleted** — a removed runner's jobs reference it — so every count of the fleet excludes `removed`. `arch` is the three architectures AG.6 builds for, `security_mode` is `mtls\|bearer_fallback` (decision **B3**, so AI.2 can render a degraded connection rather than a green shield over a weaker one), and `runners_cert_serial_with_mtls` makes the serial follow the mode both ways. `last_seen_at` is null until the first heartbeat, because `now()` would render as health nothing has evidence for; `telemetry` is bounded by `farm_telemetry_valid` (a CPU meter cannot read 140%, and used memory cannot exceed total) and is emptied when the sweep flips a runner offline, since a stale snapshot renders exactly like a fresh one. `runners_presence_idx` is partial on the three live statuses — the sweep's index, so it grows with the fleet rather than with its history. `hostname` (`V042`, [#251](https://github.com/NobuData/ouroboros/issues/251)) is what the machine called itself in its last `hello` — recognition, never identity — and `runners_hostname_length` holds it to the protocol's 1–253 characters |
| `enrollment_tokens` | `V040` | The scoped secret the install one-liner carries so a machine can join one pool of one workspace ([#249](https://github.com/NobuData/ouroboros/issues/249), decision **B3**) — minted and revoked through AH.2 ([#250](https://github.com/NobuData/ouroboros/issues/250)), every action audited on AD.4's shape | `token_sealed` is an AD.1 ([#222](https://github.com/NobuData/ouroboros/issues/222)) envelope and `enrollment_tokens_sealed` refuses any other shape — `V015`'s and `V027`'s posture, for their reason: a rule about every writer rather than about the one service that is supposed to seal. `expires_at > created_at`, because a TTL is a positive interval and a token that expired before it was minted is unusable and uncollectable. `uses` between zero and `max_uses`, which is more than one so a rack installs with one command and bounded so a token is not a password. `revoked` and `revoked_at` are true together — revocation and expiry are different events and only one of them is an incident. There is deliberately **no lookup column**: the envelope is not searchable, the presented token carries its own row's id, and a second place for the secret to leak from is not worth a search that does not happen |
| `runner_pool_windows` | `V040` | A time-windowed pool assignment ([#249](https://github.com/NobuData/ouroboros/issues/249), for [#514](https://github.com/NobuData/ouroboros/issues/514)) — *"forge-02 joins pool-a between 14:00–16:00 UTC on weekdays"*, which is how the Build Analyzer's pool-move suggestion is applied. The analyzer composes it through the farm's own APIs and never writes farm tables, so the capability belongs here | `days_of_week` is an enumerated set of ISO weekday numbers by `farm_weekday_set_valid` — enumerated rather than range-checked, so `1.5` and `"mon"` are both refused and a window dispatch cannot interpret is not a window that silently never opens. Times are `time`, **UTC and only UTC**: a window stored in local time reshapes the farm twice a year. `ends_at > starts_at`, so a row lies inside one day and a wrapping window is split by its writer rather than understood by every reader. There is deliberately **no non-overlap constraint** — that is a rule about a set of rows under a moving clock, and resolving a runner's effective pool at an instant is AH.4's ([#252](https://github.com/NobuData/ouroboros/issues/252)) |
| `build_jobs` | `V040` | One build attempt ([#249](https://github.com/NobuData/ouroboros/issues/249)) — what was built, in which pool, on which runner, how it ended, and what its log cost. Mockup 08's stat row is four aggregates over these rows and stores none of them | **`run_id` is nullable on purpose** (decision **B6**): MVP builds are API- and UI-submitted, workflow execution is v2, and the column exists now so AJ.3 ([#265](https://github.com/NobuData/ouroboros/issues/265)) fills it in rather than migrating a live table later — composite with `organization_id` under MATCH SIMPLE, so null satisfies it and a value can only name this workspace's run. `number` is the job's public name per workspace, because until that linkage exists a job has no other one. `executor`, `image` and `command` are **snapshots** rather than reads through the pool: a pool edited later must not rewrite what an earlier build ran under, and CD.3's ([#561](https://github.com/NobuData/ouroboros/issues/561)) configuration class is derived from them. `status` is the seven-name lifecycle, closed, with a finish time exactly when a job has stopped, a start unless it was queued or cancelled, and a runner unless it is queued or cancelled. A `succeeded` job exited zero and a `failed` one did not. `ccache_stats` is nullable and **null is not zero** (decision **B5**): a shell job and a build that died before the summary have no rate, and `build_ccache_stats_valid` refuses a present-but-empty one, which the stat row would divide by. `retry_of` is a self-reference carrying the workspace; the earlier attempt keeps `retried`, so `19 clean · 3 retried · 1 failed` is one partition rather than three queries. Three partial indexes serve the reads that are not page loads: per-runner queue depth, per-pool queue depth, and `(organization_id, finished_at desc)` for the stat row's windows. `V044` ([#253](https://github.com/NobuData/ouroboros/issues/253)) widens `log_dropped_bytes` to everything elided after the last stored byte — the cap's count plus the agent's own tail drops and the rate guard's, one figure so one marker — and adds `log_agent_dropped_bytes` (the agent's running total, which splits a finish's total from its tail), `log_missing_chunks` (lost frames at the tail) and `log_swept_at`, the retention sweep's tombstone, which only a finished job may carry (`build_jobs_log_swept_when_finished`); `build_jobs_log_retained_idx` is the budget sweep's read |
| `build_log_chunks` | `V040` | A build's log, in the chunks it was streamed as ([#249](https://github.com/NobuData/ouroboros/issues/249), decision **B8**) — the LIVE card's listing, read back by offset through AH.5 ([#253](https://github.com/NobuData/ouroboros/issues/253)) | **The per-job cap is a trigger, because one bug must not become an outage.** `build_log_chunk_cap()` locks the job row, assigns `byte_start` from its running total (and refuses an offset that does not continue the stream, since a gap in an offset-addressed log is a reader silently returning the wrong bytes), then writes the chunk whole, clamped with an **elision marker**, or not at all. The marker — `reason`, the cap, kept and dropped bytes, and when — is written by the trigger and refused from a caller, because a marker nobody earned describes an elision that did not happen; `build_jobs.log_dropped_bytes` carries the total, since every chunk past the cap has no row to hold a second one. Together they are what lets AI.6 ([#261](https://github.com/NobuData/ouroboros/issues/261)) render *"4.2 MB elided"* rather than a log that stops mid-line. `(job_id, seq)` unique is AG.1's resume as a key: a re-sent chunk collides and writes nothing. `retain_until` is a column rather than an interval applied at read time, so a retention policy that changes does not retroactively delete what was written under the old one. `elided_bytes` and `missing_chunks` (`V044`, [#253](https://github.com/NobuData/ouroboros/issues/253)) keep a hole *before* the chunk — the agent's throttle and the ingest rate guard, and frames that never arrived — so the console draws one marker per position; both are non-negative |
| `farm_authorities` | `V041` | One workspace's build-farm certificate authority ([#250](https://github.com/NobuData/ouroboros/issues/250), decision **B3**) — what turns `runners.cert_serial` from a string into an identity somebody issued | `key_sealed` is an AD.1 ([#222](https://github.com/NobuData/ouroboros/issues/222)) envelope and `farm_authorities_key_sealed` refuses any other shape, so **a row holding a plaintext CA key cannot exist** — `V015`'s, `V027`'s and `V040`'s posture at the most consequential column in the farm, and a rule about a migration run by hand as much as about application code. No API returns this column; `ouroboros-rest`'s `ouroboros/no-ca-key-escape` lint rule and its grep test are the other two thirds of that claim. `certificate_pem` and `fingerprint` are **public** — they are what a runner pins, and a fingerprint rather than the certificate because comparing it is a string comparison an agent implementation cannot get subtly wrong. `organization_id` is the primary key: one authority per workspace, because a second is a second chain a gateway would have to try. `not_after > not_before`, for `V040`'s reason about token TTLs |
| `runner_certificates` | `V041` | Every client certificate the farm CA has issued, and therefore the **revocation list** AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)) checks at each handshake ([#250](https://github.com/NobuData/ouroboros/issues/250)) | **`runner_certificates_live_idx` is the load-bearing one**: a partial unique index over `runner_id` where the row is neither revoked nor superseded, so a runner has at most one live certificate and *revoke this runner* is unambiguous. Without it, a renewal whose two writes came apart would leave a runner with two valid identities and revoking one would leave the other working. `revoked` and `superseded_at` are **different states** — superseded is routine and revoked is an incident; the gateway refuses both and the audit trail has to tell them apart. Rows are **never deleted**: a revocation that vanished would be a serial the check cannot find, and *not found* has to mean *refuse*, so a deleted row would be safe by luck. `(organization_id, serial)` is unique because that pair is the handshake's lookup — a serial is 128 random bits, so what is being prevented is naming one workspace's certificate from another's query, not a collision. `issued_for` is `enrollment\|renewal`, closed, because a renewal with no prior enrollment is a question worth being able to ask. `runners.cert_serial` is deliberately **not** a foreign key onto this table: the two reference each other, and a cycle of non-deferrable keys is a pair of rows neither of which can be inserted first |
| `runner_terminal_frames` | `V042` | The agent gateway's ledger of terminal frames ([#251](https://github.com/NobuData/ouroboros/issues/251)) — the receiver's half of the runner protocol's resume rule. Every `job.finish` an agent delivers, by its envelope id, recorded in the transaction that applies it and before its receipt is written | **`runner_terminal_frames_pkey` on `(runner_id, frame_id)` is the exactly-once rule**: a re-send after a dropped socket finds its row and is answered `duplicate: true` without touching the build, and two copies racing each other lose to the key rather than to a check. Keyed per runner, not per session — a reconnect that could not resume still delivers the frame it held — and not globally, because the id is the agent's to choose and a shared key would let one workspace's frame be answered as another's duplicate. `frame_id` is a ULID and `frame_type` an enum of one (`job.finish`), mirroring `receipt.of_type`. `applied` says whether recording it finished a build and `job_id` names that build; `runner_terminal_frames_applied_names_job` refuses an application that names none, and a frame that finished nothing — another runner's job, an unknown one, one already finished — is recorded with `applied = false` so the agent can stop re-sending. **Append-only** (`runner_terminal_frames_no_update`, V022's argument), with no delete trigger for V024's reason: the workspace cascades. Both references are composite with `organization_id`. `(job_id)` is indexed, partial, for *how many times was this build finished?* |
| `model_prices` | `V012` | What a model costs — the pricing catalog behind mockup 21's `$ per 1M in·out` column, and the shared price table [#92](https://github.com/NobuData/ouroboros/issues/92), [#198](https://github.com/NobuData/ouroboros/issues/198) and [#210](https://github.com/NobuData/ouroboros/issues/210) read rather than re-invent | `billing_mode` is one of `token\|seat\|usage\|free`, and the amounts follow it structurally — `token` requires both, `free` requires zero or none, `seat` and `usage` may carry none, and a `token` row that costs nothing in both directions is refused as a mislabelled `free`; `organization_id` null means a bundled catalog row and set means a workspace's override, with `source` required to agree and `catalog_version` required on bundled rows; the match key is unique **`nulls not distinct`**, without which every re-import would duplicate the whole catalog; the only wildcard is a whole `*` |

Two **functions**, both `V012`'s and both documented in
[The bundled price catalog](#the-bundled-price-catalog).
**`ouroboros.model_price(organization, provider kind, model)`** is the read: the one row
that prices that pair — override over bundled, exact model over family row — or no row at
all, which is what the registry renders as `—` rather than as `$0`. It is `language sql`
and `stable` so PostgreSQL inlines it, which is what keeps a price lookup a single indexed
query instead of an opaque function scan.
**`ouroboros.import_model_price_catalog(version, effective_at, rows)`** is the write, and
the whole of what `R__model_price_catalog.sql` does: idempotent, sweeping the previous
snapshot, and structurally unable to touch a workspace's override.

Two more **functions**, `V017`'s, and one row trigger over them.
**`ouroboros.provider_model_discovered(connection, model)`** answers *has discovery
reported this model on this connection* — the predicate behind the alias warning, exposed
on its own so a service, mockup 21's discovery-mismatch state and `tests/constraints.sql`
all read one definition. **`ouroboros.warn_undiscovered_alias_model()`** is the trigger
function on `model_aliases` that consults it and **raises a `WARNING` without refusing the
write** (decision **P6**): discovery is not yet universal — a connection exists before
anything has discovered it, and an operator may create an alias ahead of a key — so a hard
foreign key would refuse configurations that are valid during that gap. It tells a *gap*
(nothing discovered on this connection yet) from a *mismatch* (its catalog lists other
models), and becomes enforcement the day discovery covers every adapter, by raising instead
of warning. `ci/db` greps the `constraints.sql` transcript for both branches, because
nothing in SQL can catch a warning and a suite that had lost the trigger would be exactly
as green. `V019` amends it in one place: an **unbound** alias returns before either branch,
because there is no connection to have discovered anything and the gap message would
otherwise name one that does not exist.

Two more **functions**, `V019`'s, and they are the vocabularies themselves rather than
anything a caller has to remember.
**`ouroboros.model_alias_params_valid(params)`** and
**`ouroboros.model_alias_restrictions_valid(restrictions)`** answer whether a document is
inside the registry's closed key set with every value in range. `immutable`, table-free and
**total** — a document that is not an object is answered `false` rather than raised on — so
each is callable from a CHECK, and so `ouroboros-rest` can validate a payload against the
same definition the database will enforce instead of restating it. They are *shape* only,
which is the split decision **R3** draws: whether `{"thinking": "max"}` means anything for
the model an alias is bound to needs the adapter's schema and `provider_models`, and is
CH.2's ([#585](https://github.com/NobuData/ouroboros/issues/585)).

One **constraint trigger function**, `V016`'s. **`ouroboros.route_chain_intact()`** holds
the two rules that are properties of a *chain* rather than of a row — a route's hop
positions are dense from 1 and never empty, and its `floor_hop_index` points at a hop that
exists — for both `routes` and `route_hops`. Neither can be a `CHECK`, because both look at
rows other than the one being written, and both are **deferred to `commit`** so that a
reorder, a whole-chain rewrite, and an `insert route; insert hops` sequence may each be
momentarily inconsistent inside their transaction and correct when it ends. It raises class
23 naming the trigger, so each table reports its own constraint name.

Three more **functions** and a second constraint trigger function, `V018`'s.
**`ouroboros.escalation_rule_when_valid(when)`** and
**`ouroboros.escalation_rule_then_valid(then)`** are the grammar behind the two **domains**
`escalation_rule_when` and `escalation_rule_then` — a domain rather than a table `CHECK`
because a stored generated column is computed *before* any `CHECK` on the row, so the
derivation would otherwise have to defend itself against shapes its own table was about to
reject. **`ouroboros.escalation_rule_display(when, then)`** is that derivation: the card's
sentence, produced from the structure and from nothing else, `immutable` and table-free,
which is what lets `escalation_rules.display` be `generated always … stored`. Changing the
*wording* is therefore a migration that rewrites the column
(`alter table … alter column display set expression as (…)`), which is the price of a
sentence that cannot drift. **`ouroboros.escalation_rule_targets_exist()`** is the reference
this schema cannot declare: the task kind and alias a rule names live inside a jsonb
document, so a **deferred** constraint trigger on `escalation_rules`, `task_kinds` and
`model_aliases` holds all three sides — writing a rule that names neither, and retiring the
kind or alias a rule already names, are both refused.

Four more **functions**, `V026`'s, and two of them are deliberately general.
**`ouroboros.issue_estimate_breakdown_valid(breakdown)`** and
**`ouroboros.issue_estimate_trace_valid(trace)`** are the two closed grammars
`issue_estimates` stores its documents under — exactly five keys and exactly four, every
count whole and non-negative, a cycle range that runs forwards, and a `sized_at` that
carries an offset. Underneath them,
**`ouroboros.jsonb_string_list_valid(value, max_items, max_length)`** and
**`ouroboros.jsonb_whole_number_valid(value, ceiling)`** are the two shapes both documents
share — `files[]` and `signals[]`, and the four counts between them — written once because
six inline copies of the same three clauses drift one at a time. All four are `immutable`
and table-free, which is what lets them sit in a `CHECK`: a `CHECK` may not contain the
subquery `jsonb_array_elements` needs, and inside a function body that subquery is ordinary
SQL. `V014`'s `labels` predates them and answers the same problem with `jsonb_path_exists`;
it is not rewritten to use them, because a versioned migration that has been applied is
never edited.

Five **views**. **`token_usage_daily`** (`V010`) rolls `token_usage` up per organization,
UTC day and provider — the read behind mockup 02's *Token spend · today*. It is a plain
view rather than a materialized one on purpose: a stored total drifts the moment an event
is corrected or back-filled. Its `cost_cents` propagates null rather than coalescing to
zero, and `unpriced_events` is how a caller knows the total is a lower bound.

**`workspace_settings_effective`** (`V011`) is `organization LEFT JOIN
workspace_settings` with the defaults coalesced in — one row per organization whether or
not it has ever set anything. It exists because `workspace_settings` creates its rows
**lazily**: there is no creation trigger, and a workspace with no row is at every default.
This view is what keeps that decision out of every caller, so a newly created workspace
reads `auto_merge_on_checks = false` from the database rather than from an application's
memory of the default. Read settings here; write the table, with an `on conflict
(organization_id) do update` upsert. `is_explicit` is the one column that still tells a
written default from no row, for onboarding and audit lines.

**`alias_references`** (`V023`) is what references a model alias, across every storage shape
one can be referenced from — `(organization_id, alias_id, alias, kind, ref_id, ref_label,
blocking)`, one row per reference. `route` rows come from `route_hops` and are labelled with
the route's tag; `escalation` rows come from an `escalation_rules."then"` target, joined by
**name** within the workspace because that is what the rule stores, and labelled
`escalation:effort≥L` — mockup 21's chip, derived from the rule's `"when"` rather than cut
out of `display`, because a rule's `label` condition carries a GitHub label name and the
sentence therefore has no separator a substring is safe to cut at. `workflow` and `chat_pin`
are in the vocabulary and contribute no rows until their storage exists. Nothing stores a
count: the `USED BY` column is `count(*)` over this view and the `0 routes` row is a left
join from `model_aliases`. Read it through **`alias_reference_guard(organization_id,
alias_id)`** from inside the transaction that deletes or renames — selecting from the view
directly takes no lock and its answer can go stale before the next statement runs.

**`run_stage_current`** and **`runs_with_stage`** (`V045`) are the derivation behind the stage
meter. The first answers *where is this run* for every run that has stage history: the active
stage if there is one — `run_stages_one_active_idx` says there is at most one — else the stage
it got furthest into, else the one it is about to enter, with `stage_index` (distinct stages
entered) and `stage_total` (distinct stages materialised) computed beside it. The second is
every column of `runs` with those three coalesced over `V008`'s columns, so a dashboard read
moves onto the derivation by changing one word and answers identically for a run with no
history. That is the amendment filed on [#64](https://github.com/NobuData/ouroboros/issues/64),
and it is why `runs.stage_label`, `stage_index` and `stage_total` are still there: removing
them in the same migration that replaced them would have left mockup 02 in mid-air.

`V001`'s `tenants`, `V002`'s `users`, `user_identities` and `tenant_members` are **gone**:
`V006` ([#708](https://github.com/NobuData/ouroboros/issues/708)) moved their rows into
`organization`, `"user"`/`account` and `member`, re-parented the two extension tables
above onto a snake_case `organization_id`, and dropped them. `tests/constraints.sql`
asserts they *stay* gone, so a migration that recreated one fails `ci/db`.

`V005` also adds one column to an existing table: **`session."activeOrganizationId"`**, the
tenant pointer. It is a nullable foreign key to `organization` with `on delete set null`,
and both halves of that are deliberate — see
[The tenant pointer](#the-tenant-pointer) below.

### The two generations of user table

A closed chapter, kept because its reasoning still governs the shape of what remains.
`V004` ([#706](https://github.com/NobuData/ouroboros/issues/706)) landed BetterAuth's four
core tables beside the tenancy ones, which left the schema briefly holding **two tables
that described the same people**: `users` from `V002`, and `"user"` from `V004` — a
difference of one letter. `V004`'s back-fill kept them agreeing — `users` → `"user"` and
`user_identities` → `account`, **preserving ids**, so every foreign key written against
`users.id` named the same person on both sides. That id preservation is what made the
transitional state end cleanly: `V006`
([#708](https://github.com/NobuData/ouroboros/issues/708)) re-ran the back-fill one last
time (a database whose seed landed after `V004` needed it), refused to proceed past
anyone the back-fill had had to skip, moved the memberships, and dropped `users`,
`user_identities` and the back-fill function itself. There is one user table now, and it
is the quoted one.

> **`user` is a reserved word — quote it, always.** `ouroboros."user"` in every statement,
> in every migration, in every hand-typed `psql` query. Unquoted, `ouroboros.user` parses
> as the `user` keyword rather than as this table. `scripts/verify-dev-env.sh` greps every
> migration for an unquoted `user` in a table position and fails `ci/db` before PostgreSQL
> sees it.

BetterAuth's own naming is kept exactly as its CLI emits it — singular table names, quoted
camelCase columns like `"emailVerified"` and `"createdAt"` — which is roadmap decision
**A4**. These are vendor-shaped tables, and renaming their columns would put this schema at
war with every library upgrade and every plugin that reads them. The house snake_case style
still governs `V001`–`V003`. Flyway remains the only thing that issues DDL (decision
**A3**): BetterAuth ships a `migrate` command that would create these tables itself, it is
never run, and `scripts/verify-dev-env.sh` asserts that nothing in the repository wires it
up. The SQL in `V004` is a hand-port of `@better-auth/cli generate` — see
`ouroboros-rest/README.md` § Generating the auth schema for the command. `V005`
([#707](https://github.com/NobuData/ouroboros/issues/707)) is the same hand-port for the
organization plugin, and re-running `generate` against a database carrying it prints
*"Your schema is already up to date"* — which is how the port was checked rather than
trusted.

### The tenant pointer

`V005` adds `session."activeOrganizationId"`, and it is the column that changes how the
service behaves rather than merely what it stores. Before it, the tenant a request acted in
was a **header the client asserted** — `X-Ouro-Tenant`, which
[#32](https://github.com/NobuData/ouroboros/issues/32) shipped and
[#713](https://github.com/NobuData/ouroboros/issues/713) demotes to an override. After it,
the tenant is a column on the session row, which only the server writes: the plugin's
`setActiveOrganization` is the one way it changes. That is roadmap decision **A5**.

Three properties, all asserted in `tests/constraints.sql`:

- **Nullable**, because a session exists from the moment somebody signs in — which is
  before they have chosen anything in mockup 01 Step 2. Null means *signed in, acting
  nowhere*.
- **A foreign key**, which the library does not emit: it clears the pointer in application
  code instead. Written into the schema, no session can point at an organization that does
  not exist — including after a delete issued by a migration, a support script or `psql`
  rather than by the plugin.
- **`on delete set null`, never `cascade`.** This is the one worth getting right: a cascade
  here would delete the *session rows*, so deleting an organization would sign out everybody
  who happened to be acting in it. Nulling the pointer leaves them signed in with a choice
  to make.

Four conventions run through the tenancy tables, and are worth knowing before adding
another:

1. **Case-folded on the way in, not at read time.** Domains, org logins and repo names
   are stored lower-cased and held there by a check constraint. That is what lets one
   plain unique btree be both the uniqueness rule and the case-insensitive lookup index —
   query with `where domain = lower($1)` and it is an index scan. It needs no `citext`
   extension, which a managed PostgreSQL may not grant the migration role rights to
   create. All three get the folding free, because their format patterns admit no upper
   case. (`"user".email` is folded too, but by the library rather than by a constraint —
   it is BetterAuth's column.)
2. **Enablement fails closed.** Both `enabled` flags default to `false`, and they are
   independent: a repo is in scope only when its own flag *and* its org's are true, so
   suspending an org preserves the per-repo choices underneath. These two tables bound
   where Ouroboros may operate, so anything arriving by an undesigned path arrives off.
3. **`updated_at` is one shared trigger.** `ouroboros.touch_updated_at()`, defined in
   `V001` and attached by every table since, stamps from the server clock and overwrites
   whatever the statement supplied. One function means the behaviour cannot drift between
   tables.
4. **No credential is stored in the tables this module designed.** The extension tables
   record enablement and domains, never a token, refresh token or secret; a credential
   there would make every `select *` over the tenancy schema a secret-bearing query.
   `tests/constraints.sql` asserts the absence by reading `information_schema`, so a
   column added later is caught rather than merely discouraged.

   `V004`'s `account` is the deliberate exception, and the assertion is scoped to name it
   as one. It is the library's table, its `accessToken`/`refreshToken`/`password` columns
   are part of BetterAuth's contract, and the library encrypts the tokens with
   `BETTER_AUTH_SECRET` before they are written. The rule above still governs every table
   this module designed.

Deleting an organization cascades the whole way down — domains, memberships, invitations,
orgs, and the orgs' repos — so nothing is left naming a workspace that is gone. It stops
at the people: deleting an organization removes the *memberships*, not the `"user"` rows,
since a person may hold roles in organizations that remain, and it does not delete their
sessions either — the tenant pointer is nulled instead (see above). Deleting a `"user"`
is the cascade in the other direction, and takes their sessions, accounts and memberships
with them.

## Related issues

Scaffold [#19](https://github.com/NobuData/ouroboros/issues/19) ·
tenants & domains [#20](https://github.com/NobuData/ouroboros/issues/20) *(done)* ·
users & membership [#21](https://github.com/NobuData/ouroboros/issues/21) *(done)* ·
GitHub enablement [#22](https://github.com/NobuData/ouroboros/issues/22) *(done)* ·
dev seed [#23](https://github.com/NobuData/ouroboros/issues/23) *(done)* ·
migration CI [#24](https://github.com/NobuData/ouroboros/issues/24) *(done)* ·
BetterAuth core schema [#706](https://github.com/NobuData/ouroboros/issues/706) *(done)* ·
organization schema [#707](https://github.com/NobuData/ouroboros/issues/707) *(done)* ·
tenancy cut-over [#708](https://github.com/NobuData/ouroboros/issues/708) *(done)* ·
model pricing catalog [#580](https://github.com/NobuData/ouroboros/issues/580) *(done)* ·
provider connections & aliases [#189](https://github.com/NobuData/ouroboros/issues/189) *(done)* ·
provider schema extensions, discovered models & seeds [#221](https://github.com/NobuData/ouroboros/issues/221) *(done)* ·
GitHub issue cache schema [#99](https://github.com/NobuData/ouroboros/issues/99) *(done)* ·
issue estimates schema [#100](https://github.com/NobuData/ouroboros/issues/100) *(done)* ·
workflow & version schema [#132](https://github.com/NobuData/ouroboros/issues/132) *(done)* ·
studio dev seeds [#136](https://github.com/NobuData/ouroboros/issues/136) *(done)* ·
full epic [#3](https://github.com/NobuData/ouroboros/issues/3) ·
model registry epic [#575](https://github.com/NobuData/ouroboros/issues/575) ·
auth database epic [#696](https://github.com/NobuData/ouroboros/issues/696).

See [`../docs/CONVENTIONS.md`](../docs/CONVENTIONS.md) for the conventions every module
follows and [`../README.md`](../README.md) for the module map.
