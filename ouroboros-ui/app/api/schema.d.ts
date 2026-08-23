// Generated from ouroboros-rest/openapi.json — do not edit.
// Run `yarn api:sync` after the contract changes; `yarn test` fails while this
// file and that document disagree. See scripts/api-sync.mjs.
export interface paths {
    "/api/v1": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Heartbeat
         * @description Report that the service is up, and which build is up.
         *
         *     Deliberately the same three questions `ouroboros-engine`'s `/v0/status` answers,
         *     in the same order — *what is this*, *which build*, *how long has it been up* — so
         *     someone looking at both services is reading one shape rather than two. It opens
         *     no connection and reads no configuration: whether the service's *dependencies*
         *     are reachable is a readiness probe's question
         *     ([#29](https://github.com/NobuData/ouroboros/issues/29)), not this one's.
         */
        get: operations["readHeartbeat"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/sign-in/social": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Begin a social sign-in
         * @description Start the GitHub handshake ([#702](https://github.com/NobuData/ouroboros/issues/702)).
         *     `{"provider": "github"}` is the whole body; the answer carries the github.com
         *     authorization URL for the browser to follow.
         *
         *     **A `POST` answering with a URL rather than a redirect**, so a script can decide what
         *     to do with it — which is why `ouroboros-ui` calls `authClient.signIn.social` instead
         *     of rendering a link. An anchor pointed at this path gets a `404`: it does not answer
         *     `GET`.
         *
         *     `github` is the only provider configured, plus email/password in development
         *     ([#705](https://github.com/NobuData/ouroboros/issues/705)). The scopes are
         *     `read:user` and `user:email` and are this service's rather than the library's
         *     defaults — see `src/auth/github.provider.ts`.
         */
        post: operations["signInSocial"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/callback/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Complete a social sign-in
         * @description Where the provider returns the browser. **This is the URL an OAuth App is registered
         *     against** — `${BETTER_AUTH_URL}/api/auth/callback/github` — and github.com compares
         *     what it was registered with against what the exchange presents, so a difference of
         *     one character is a sign-in that fails at the last hop.
         *
         *     The library checks the `state` it issued, exchanges the code for the profile and the
         *     verified primary address, upserts `"user"` and `account`, creates the `session` row
         *     and sets its cookies. Nothing here is this service's to call: it is a navigation the
         *     browser makes.
         */
        get: operations["signInCallback"];
        put?: never;
        /**
         * Complete a social sign-in (form post)
         * @description The same operation for a provider that returns by form post rather than by
         *     redirect. GitHub redirects, so this is the verb nothing in this installation uses —
         *     described because the library answers it and a document that described half a route
         *     would be describing something else.
         */
        post: operations["signInCallbackFormPost"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/get-session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read the session
         * @description The caller's session and the person holding it, or `null` for nobody.
         *
         *     **This is the only route that answers *who is signed in*.** `GET /api/v1/auth/me`
         *     answered it too until [#711](https://github.com/NobuData/ouroboros/issues/711)
         *     deleted it; do not build another. The two questions it also used to answer are
         *     `GET /api/auth/organization/list` (where do I belong) and
         *     `GET /api/auth/organization/get-active-member-role` (what may I do here).
         *
         *     `null` rather than a `401`, which is what makes it callable from a login screen: the
         *     absence of a session is the answer, not a failure. Since
         *     [#703](https://github.com/NobuData/ouroboros/issues/703) the global guard calls it on
         *     every request, and with the cookie cache fresh it answers from the signed snapshot in
         *     `better-auth.session_data` and issues no statement at all.
         *
         *     `session.activeOrganizationId` is the tenant pointer — see the `organizations` tag.
         */
        get: operations["getSession"];
        put?: never;
        /**
         * Read the session (post)
         * @description The same answer for a caller that would rather not put anything in a URL. Identical
         *     in every respect; the library accepts both verbs.
         */
        post: operations["getSessionPost"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/sign-out": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sign out
         * @description End the session and clear its cookies. **It deletes the `session` row**
         *     ([#703](https://github.com/NobuData/ouroboros/issues/703)), so revocation is
         *     immediate rather than an expiry a copied cookie can outlive.
         *
         *     `POST /api/v1/auth/logout` is this service's versioned alias and delegates here; the
         *     two are interchangeable, and which one a client calls is decided by which client it
         *     is calling through.
         */
        post: operations["authSignOut"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/ok": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The handler answering for itself
         * @description `{"ok": true}` — no database, no session, no configuration read.
         *
         *     **It is not a health probe.** It says the BetterAuth handler is mounted and nothing
         *     else: not that the database is reachable, not that the engine is. `/health/ready` is
         *     the readiness answer and this is deliberately not a second one.
         */
        get: operations["authOk"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/error": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Where a failed flow lands
         * @description Where the library redirects a browser whose sign-in failed, with the reason in the
         *     query string. It answers HTML for a person to read rather than JSON for a client to
         *     parse, because whoever arrives here arrived by navigation.
         */
        get: operations["authError"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/organization/list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The workspaces you belong to
         * @description Every organization the caller is a member of — mockup 01 Step 2's list, and
         *     mockup 17's. `metadata.personal` is what renders the `personal` pill
         *     ([#704](https://github.com/NobuData/ouroboros/issues/704)).
         *
         *     It answers **from the session**, so there is no id to pass and no way to ask about
         *     somebody else's memberships.
         *
         *     **It carries no role.** The plugin reads the caller's `member` rows and returns the
         *     organizations they point at, discarding the role on the way — so *what may I do
         *     here* is `get-active-member-role`, a separate call because it is a separate
         *     question.
         */
        get: operations["listOrganizations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/organization/create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create a workspace
         * @description The caller becomes its `owner` — the one role nobody else can grant — and it becomes
         *     the session's active organization unless `keepCurrentActiveOrganization` says
         *     otherwise.
         *
         *     **A `personal` flag in `metadata` is stripped before the row is written.** The pill
         *     it would render means *this workspace is yours alone*, and a shared workspace wearing
         *     it would be a label that lies on the one screen whose job is to say where somebody's
         *     work is going. A personal organization is made by first sign-in and by nothing else —
         *     see `stripPersonalFlag` in `src/auth/organization.plugin.ts`.
         */
        post: operations["createOrganization"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/organization/set-active": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Choose where the loop runs
         * @description Mockup 01 Step 2's **Enter mission control →**. It **writes
         *     `session.activeOrganizationId`**, which is what makes the tenant server state rather
         *     than a header a client asserts (decision A5), and
         *     [#713](https://github.com/NobuData/ouroboros/issues/713) is what teaches this
         *     service's own middleware to read it.
         *
         *     Name the organization by id or by slug. `null` unsets the pointer, which is the
         *     state somebody who has signed in and chosen nothing yet is in.
         */
        post: operations["setActiveOrganization"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/organization/get-full-organization": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * One workspace, with its members and invitations
         * @description Mockup 17's members & roles table. Defaults to the session's active organization
         *     when neither query parameter is given, and answers `null` when there is no active
         *     one to default to.
         */
        get: operations["getFullOrganization"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/organization/get-active-member-role": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * What you may do here
         * @description `{"role": "owner"}` for the session's active organization, or for whichever
         *     `organizationId` names, provided the caller belongs to it.
         *
         *     **The third part of the session question**, and the reason `GET /api/v1/auth/me` was
         *     deleted rather than reimplemented
         *     ([#711](https://github.com/NobuData/ouroboros/issues/711)): who you are is
         *     `get-session`, where you belong is `organization/list`, and what you hold there is
         *     this. Cheaper than `get-full-organization` for the purpose, and it discloses one role
         *     rather than a whole membership list.
         */
        get: operations["getActiveMemberRole"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/organization/invite-member": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Invite somebody
         * @description Writes an `invitation` row at the role given, and nothing else in MVP: **no email is
         *     sent**. [#724](https://github.com/NobuData/ouroboros/issues/724) is the delivery, and
         *     `expiresAt` is already on the row waiting for it
         *     ([#707](https://github.com/NobuData/ouroboros/issues/707)).
         *
         *     Requires the `invitation: create` permission, which `owner` and `admin` hold and
         *     `member` and `viewer` do not — see `src/auth/organization.roles.ts`.
         */
        post: operations["inviteOrganizationMember"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/organization/update-member-role": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Change what somebody may do
         * @description Requires `member: update`, which `owner` and `admin` hold; `member` and `viewer` do
         *     not, and `viewer` holds none of the four resources at all. This is the route
         *     [#715](https://github.com/NobuData/ouroboros/issues/715) verifies a member-level
         *     caller is refused on.
         */
        post: operations["updateMemberRole"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sign out
         * @description End the session, and remove its cookies from the browser.
         *
         *     **It deletes the session row** ([#703](https://github.com/NobuData/ouroboros/issues/703)),
         *     so revocation is immediate: a cookie copied beforehand is refused on its next use.
         *     This service delegates to BetterAuth's own `POST /api/auth/sign-out` rather than
         *     implementing a second sign-out beside it, and the two are interchangeable — this
         *     one is the versioned alias `ouroboros-ui` calls.
         *
         *     Idempotent, and reachable without a session: requiring one would mean an *expired*
         *     cookie could never be cleared, because the request to remove it would be refused
         *     for carrying exactly the thing it was trying to remove. It answers `204` either
         *     way.
         *
         *     A `POST` rather than a `GET`, because it changes state — a `GET` that signs you out
         *     is a link, an image tag or a prefetch away from signing you out.
         *
         *     It ends **one** session rather than all of the person's: somebody signing out of a
         *     shared machine is not signed out of their own.
         */
        post: operations["signOut"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/discover": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Discover a company domain
         * @description Given a company domain, answer the two things the sign-in flow needs before anybody
         *     has signed in: is there a workspace here, and does it use enterprise SSO?
         *     ([#712](https://github.com/NobuData/ouroboros/issues/712).) This is the backend of
         *     mockup 01 Step 1's **Company domain** field.
         *
         *     **The answer is the same for every domain in this release**, and that is the contract
         *     rather than an implementation detail. Enterprise SSO is
         *     [#722](https://github.com/NobuData/ouroboros/issues/722); MVP signs in with GitHub
         *     (decision A7), so `ssoAvailable` is `false` whether or not a workspace holds the
         *     domain, and the body is identical field for field either way.
         *
         *     **Reachable without a session, which is what shapes the rest of it.** Its caller is a
         *     browser on the login page, so whatever this endpoint tells one caller it tells
         *     everybody — and an endpoint that answers *does this company use Ouroboros* is a
         *     tenant-enumeration oracle unless it is built not to be. Two things make it not one:
         *
         *       * **A uniform body.** No organization name, no member count, no identifier, nothing
         *         conditional. `DiscoverResponse` is what an unknown domain answers with too.
         *       * **Uniform timing.** The service holds every answer for a fixed floor, so the
         *         difference between an index hit and a miss is not readable off a stopwatch.
         *         `src/modules/auth/discovery.timing.ts` is where that is implemented and where its
         *         limits are written down.
         *
         *     Neither is rate limiting, and this route has none yet: per-IP throttling on the auth
         *     and discovery surface is
         *     [#725](https://github.com/NobuData/ouroboros/issues/725).
         *
         *     A `POST` rather than a `GET` for two reasons that point the same way. A domain is an
         *     organization's name for itself, and a `GET` puts it in the request line — where a
         *     proxy log, a browser history and a `Referer` header all keep it. And a `GET` is
         *     cacheable by anything in between, which for an answer that becomes caller-specific
         *     when #722 lands is a shared cache holding one company's redirect for another. It
         *     answers `200` rather than `201`: nothing is created, and the verb is protecting the
         *     argument rather than describing a write.
         */
        post: operations["discoverDomain"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/engine/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Report the engine's health and version
         * @description Whether `ouroboros-engine` is reachable, and which build answered.
         *
         *     The engine is internal — it is reachable from this service and from nothing else
         *     (`docs/ARCHITECTURE.md` § 10) — so this is how a signed-in person learns anything
         *     about it at all. This service asks the engine `GET /v0/status` over the internal
         *     boundary, carrying a shared secret a browser never sees, and reports back the two
         *     facts a caller can act on.
         *
         *     **Every way that call can fail is one `502`.** An engine that is down, one that is
         *     too slow, one at an address that no longer resolves, one holding a different shared
         *     secret, and one answering outside its own contract are indistinguishable here by
         *     design: the caller learns that the system cannot serve the request, and nothing it
         *     could use to probe the inside of the network. In particular a shared-secret mismatch
         *     is **never** forwarded as a `401` — that is this deployment's mistake rather than the
         *     caller's, and it is logged where an operator reads it.
         *
         *     This route is not a proxy. It is a named operation with its own contract that
         *     happens to be answered by asking the engine one question, because a route that
         *     forwarded a path, a method and a body to an internal service would be the boundary
         *     above written as a hole.
         */
        get: operations["readEngineStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/dashboard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The whole dashboard, in one payload
         * @description Every number, list and switch mockup 02 draws, for the workspace this session is
         *     acting in — the four stat-row figures, the pulse meters, the runs in flight, the runs
         *     that have stopped, the head of the queue, and the page head's subline.
         *
         *     **The workspace is the session's.** There is no workspace in this path: it is the
         *     session's active organization, overridden for one request by `X-Ouro-Tenant`. A
         *     session acting in none is a `400` with `code: "organization_required"` — this is the
         *     first operation in the API that can answer it, since every other operation taking that
         *     header also names a workspace in its path.
         *
         *     **Poll it conditionally.** Send back the `ETag` you were given in `If-None-Match`; a
         *     dashboard nothing has changed answers `304` with no body, and costs four aggregate
         *     subqueries rather than a payload. The tag is **strong** and it is derived from the
         *     version of the four source tables plus the calendar day — so it also changes at
         *     midnight, when the day's spend and "since this morning" start counting again with no
         *     row having moved. Rows aging out of a rolling window are the one change it does not
         *     notice; on a dashboard whose numbers are moving, rows are being written.
         *
         *     **What each aggregate means** is on the field that carries it, and the two window
         *     lengths are the part worth reading before rendering a label: the merge rate is
         *     measured over **fourteen** days and the other two meters over **seven**. `LoopPulse`
         *     says why.
         *
         *     **Durations that belong to one row are not sent.** *Elapsed* is `now − startedAt` and
         *     *Cycle* is `finishedAt − startedAt`; both are computed by the client from the instants
         *     below, because elapsed is a number that moves while nobody is asking and a value
         *     computed here would be stale before it was rendered. Aggregates over many rows — the
         *     average cycle time — are computed here, because no client can derive them from what it
         *     was sent.
         */
        get: operations["readDashboard"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The workspace's runs, paged
         * @description The drill-in behind the dashboard's `Open run console →` and `All issues →` links
         *     ([#71](https://github.com/NobuData/ouroboros/issues/71)): the same rows the
         *     aggregate's `activeRuns` and `recentRuns` slices carry, without their card-sized
         *     limits, one family at a time.
         *
         *     **`status` is required, and names a family rather than a status.** `active` is the
         *     runs still moving, in lifecycle order — coding, building, review — oldest first
         *     within a stage, which is the *Active loops* card's own order extended past its ten.
         *     `terminal` is the runs that have stopped, newest first, the *Recently closed* card's
         *     order past its eight. The two orders answer different questions, which is why there
         *     is no unfiltered listing: a screen that wants both asks twice, exactly as the two
         *     cards do.
         *
         *     **The aggregate's slices are pages of these listings — as a contract.** A row here
         *     and the same run in `Dashboard.activeRuns` are byte-identical: one `RunSummary`
         *     schema, one mapper in the service, and an integration test that holds the two
         *     answers equal over one population. A client may therefore paint a card from the
         *     aggregate and a full screen from this listing without reconciling shapes.
         *
         *     **`repo` narrows to one repository** — `github_repos.id`, which is what the
         *     focus-repo preference ([#77](https://github.com/NobuData/ouroboros/issues/77))
         *     holds. The id rather than the name, because a name is unique only within its GitHub
         *     organisation. A repository that is not this workspace's narrows to an empty page
         *     rather than erroring: under the workspace scope the filter is a predicate, and an
         *     empty page is the honest answer to "your runs, in a repository that is not yours".
         *
         *     **The workspace is the session's**, exactly as the dashboard's: no workspace in this
         *     path, the session's active organization or `X-Ouro-Tenant` decides, and membership
         *     is checked before this operation runs.
         */
        get: operations["listRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/runs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * One run
         * @description The run a card links to, in exactly the shape every listing row and every aggregate
         *     slice has — `RunSummary` is the one shape a run takes on this API, and this
         *     operation is the third place it is served rather than a second definition of it.
         *
         *     **A run that is not yours does not exist.** A well-formed id belonging to another
         *     workspace answers `404` with `run_not_found`, indistinguishably from an id that
         *     names nothing at all — the query that reads the row is scoped to the workspace
         *     before it is keyed by the id, so the distinction is not represented anywhere a
         *     response could leak it. A `403` would confirm that an identifier names something
         *     real, which is the whole of what somebody enumerating uuids is trying to learn.
         */
        get: operations["readRun"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/queue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The workspace's queue, ordered and paged
         * @description The drill-in behind the dashboard's `Manage queue →` link
         *     ([#73](https://github.com/NobuData/ouroboros/issues/73)): the whole ordered queue
         *     whose first five rows are the aggregate's `queueHead`, with the summed estimate the
         *     *Queued issues* stat displays.
         *
         *     **The order is `position` ascending, and it is total.** `1` is next. Positions are
         *     unique within a workspace, so the order carries no tiebreak and two rows cannot swap
         *     places between polls. It is the *Up next in queue* card's own order extended past its
         *     five — the aggregate's `queueHead` is the head of this listing, one shape and one
         *     ordering, not a second opinion about what is next.
         *
         *     **`totalEstMinutes` is the stat row's own number.** It is computed by the same
         *     sentence over the same rows as `stats.queued.estMinutes` — a sum over the estimates
         *     that skips items nobody has sized rather than counting them as zero — so unfiltered,
         *     the two are equal for the same workspace and the card and this page cannot disagree.
         *     `total` may therefore speak for more issues than the sum does; that is the honest
         *     shape of a queue where something has not been sized yet.
         *
         *     **`total` and `totalEstMinutes` describe the whole match, not the page.** Both
         *     ignore the window, and both respect the `repo` filter when one narrows the listing —
         *     a total summed without the filter would make the page describe rows it will never
         *     show.
         *
         *     **`repo` narrows to one repository** — `github_repos.id`, which is what the
         *     focus-repo preference ([#77](https://github.com/NobuData/ouroboros/issues/77))
         *     holds. The id rather than the name, because a name is unique only within its GitHub
         *     organisation. A repository that is not this workspace's narrows to an empty page
         *     rather than erroring: under the workspace scope the filter is a predicate, and an
         *     empty page is the honest answer to "your queue, in a repository that is not yours".
         *
         *     **Mutations are deliberately absent.** Reorder, remove and enqueue belong to the
         *     issues screen's roadmap (mockup 03), where the queue is managed rather than
         *     displayed; this operation reads. The omission is stated here so it reads as a
         *     decision rather than an oversight.
         *
         *     **The workspace is the session's**, exactly as the dashboard's: no workspace in this
         *     path, the session's active organization or `X-Ouro-Tenant` decides, and membership
         *     is checked before this operation runs.
         */
        get: operations["listQueue"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/auto-merge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The auto-merge setting
         * @description The position of mockup 02's **Auto-merge when checks pass** switch
         *     ([#74](https://github.com/NobuData/ouroboros/issues/74)): whether this workspace
         *     merges on green checks without asking.
         *
         *     **Any member may read it**, viewers included — a role that exists to be able to look
         *     at the switch it may not flip. Never a `404` and never empty: the setting always has
         *     a position, `false` for a workspace that has never chosen, resolved from the database
         *     rather than defaulted in code.
         *
         *     **The stamps are null together, and that is the "never chosen" signal.** `updatedAt`
         *     and `updatedBy` are both null exactly when no administrator has ever written the
         *     setting, so a client can tell a chosen `false` from a default one without a boolean
         *     invented for the purpose. `updatedBy` alone may also be null on a chosen setting
         *     whose setter was since deleted — the choice outlives the chooser.
         *
         *     **The workspace is the session's**, exactly as the dashboard's: no workspace in this
         *     path, the session's active organization or `X-Ouro-Tenant` decides, and membership
         *     is checked before this operation runs. The dashboard aggregate reports the same
         *     value as `pulse.autoMerge`; this operation is where a client reads it with its
         *     attribution.
         */
        get: operations["readAutoMergeSetting"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Flip the auto-merge switch
         * @description The dashboard's **one mutation** (decision F6). Send the switch's new position; the
         *     answer is the setting as it now stands, read back from the row rather than from the
         *     request. A body carrying nothing changes nothing and answers the current state —
         *     PATCH means "what is present changed", per the preferences surface's own grammar.
         *
         *     **`owner` or `admin`, and nobody else.** Flipping this changes what the loop does
         *     without a human, so the write is role-gated where reads are not: a `member` or a
         *     `viewer` gets the API's one `403` and writes nothing. It is also attributed —
         *     `updatedBy` records the session user on every write — and will be audited:
         *     [#90](https://github.com/NobuData/ouroboros/issues/90) emits
         *     `settings.auto_merge_changed` through the #26 audit path this operation already
         *     stubs the seam for.
         *
         *     **The write is an upsert keyed on the workspace.** A workspace that has never chosen
         *     has no settings row — the first flip creates it, the fortieth updates it, and two
         *     racing administrators are arbitrated by the database rather than by whichever
         *     arrived second overwriting a read.
         *
         *     **The next dashboard poll notices.** The aggregate's `ETag` fingerprints the
         *     settings table, so a persisted flip turns the poller's `304` back into a `200` whose
         *     `pulse.autoMerge` carries the new position.
         */
        patch: operations["patchAutoMergeSetting"];
        trace?: never;
    };
    "/api/v1/registry/prices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * This workspace's price corrections
         * @description One page of the prices this workspace has recorded for itself
         *     ([#586](https://github.com/NobuData/ouroboros/issues/586)), ordered by provider kind
         *     then model.
         *
         *     **The bundled catalog is not in this listing, and that is what the listing means.**
         *     The snapshot is the same hundred and twenty-nine rows for every workspace and nobody
         *     here wrote it; *what have we corrected* is a question about a workspace's own list.
         *     An empty page therefore means this workspace is on the catalog's own numbers
         *     throughout — not that no model has a price.
         *
         *     **Any member may read it**, viewers included, exactly as the auto-merge switch is
         *     readable by the role that exists to be able to look. Writing one is `owner` or
         *     `admin`; see the `PUT` beside this.
         *
         *     Each entry carries `display` — the cell mockup 21 would draw for that correction —
         *     so a settings table can show what a rate will look like without re-deriving the
         *     formatting. `—` never appears there: an override is a price by definition, and the
         *     `—` cell is the absence of a row rather than the content of one.
         *
         *     **The workspace is the session's**, as everywhere in `/api/v1`: no workspace in this
         *     path, the session's active organization or `X-Ouro-Tenant` decides, and membership is
         *     checked before the operation runs.
         */
        get: operations["listPriceOverrides"];
        /**
         * Record what this workspace pays for a model
         * @description Replace this workspace's statement about one model's price. An override always beats
         *     the bundled catalog, and every answer that resolves through it says
         *     `provenance.source: override` — which is what lets a reader tell a negotiated rate
         *     from a published one.
         *
         *     **`owner` or `admin`, and nobody else.** This number is multiplied by a token count
         *     in every spend report this product draws, so the write is role-gated where the read
         *     is not: a `member` or a `viewer` gets the API's one `403` and writes nothing.
         *
         *     **A `PUT`, and every field the mode requires is required.** This replaces the
         *     workspace's statement outright rather than amending it. A partial correction — change
         *     the output rate, keep the input one — cannot be checked against the billing-mode rules
         *     without reading the stored row first, and a price assembled from half a request and
         *     half a row is a number nobody entered.
         *
         *     **The amounts have to match the billing mode**, which is a rule of the schema
         *     ([#580](https://github.com/NobuData/ouroboros/issues/580)) and not a preference:
         *
         *     | `billingMode` | `inputCentsPer1m` / `outputCentsPer1m` | Renders |
         *     |---|---|---|
         *     | `token` | **both required**, and not both zero | `$12 · $60` |
         *     | `seat` | **must be omitted** | `seat-based` |
         *     | `usage` | **must be omitted** | `usage-based` |
         *     | `free` | omitted, or `0` | `$0` |
         *
         *     A body that breaks one of those is a `422` naming the field, not a `500`. A `token`
         *     price of zero in both directions is refused specifically: that is a free model
         *     recorded under the wrong mode, and it would render `$0` for something somebody is
         *     being invoiced for.
         *
         *     **`modelId` may be `*`**, which prices every model of the kind — the family row a
         *     seat- or usage-billed provider is priced by, and how a workspace says *everything I
         *     reach through this OpenAI-compatible endpoint runs on our own hardware*
         *     (`connectionKind: openai_compatible`, `modelId: "*"`, `billingMode: free`). It is the
         *     only wildcard there is: a `*` inside an identifier is refused.
         *
         *     **Idempotent.** The same body sent twice leaves one row; the second send is a
         *     re-affirmation that moves `effectiveAt` and `updatedAt` rather than a second
         *     correction. `connectionKind` is folded to lower case, so `Anthropic` and `anthropic`
         *     address one row rather than two that would shadow each other.
         *
         *     **The correction is visible immediately.** The service's short-lived price cache is
         *     dropped for this workspace inside the same request, so no read after this one can
         *     answer with the number it replaced.
         */
        put: operations["putPriceOverride"];
        post?: never;
        /**
         * Withdraw a price correction
         * @description Remove this workspace's override for one model, so the bundled catalog answers for it
         *     again.
         *
         *     **Withdrawing a correction is not pricing a model at nothing.** The row goes and the
         *     lookup falls back to the snapshot; a model the snapshot does not cover goes back to
         *     reading `—`, which is true. That is why this is a `DELETE` rather than a write of
         *     zeros — a `free` override would claim the model costs nothing, which is a different
         *     and much stronger statement.
         *
         *     **`owner` or `admin`**, as the `PUT` is, and for the same reason.
         *
         *     **The pair is in the query string rather than the path**, because a model identifier
         *     is a vendor's string — `qwen3-coder:32b`, `openai/gpt-oss-120b`, `*` — and half of
         *     those need escaping to survive a path segment.
         *
         *     **A missing override is a `404`, not a quiet success.** *Withdraw my correction* and
         *     *there was no correction* are different outcomes, and a client that believed it had
         *     removed one needs to learn that the price it is now looking at was already the
         *     catalog's.
         */
        delete: operations["deletePriceOverride"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/preferences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Your preferences
         * @description Stored choices where they exist, the defaults where none do. Never a `404` and never
         *     empty: a preference always has a value, even for somebody who has never expressed
         *     one — so a client can render a control from this answer without a fallback branch.
         *
         *     Requires no workspace, exactly as `GET /api/v1/orgs` does not: the answer belongs to
         *     the person, and a fresh sign-up who belongs to nothing yet still has a text size.
         */
        get: operations["readPreferences"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Change your preferences
         * @description Send what changed; the answer is the whole surface as it now stands, read back from
         *     the row rather than from the request. A body carrying nothing changes nothing and
         *     answers the current state — PATCH means "what is present changed", and an empty
         *     change is a question, not an error.
         *
         *     The write is an upsert keyed on the person: "set my font scale" is the same request
         *     whether it is the first choice or the fortieth, and two racing writes are arbitrated
         *     by the database rather than by whichever arrived second overwriting a read.
         */
        patch: operations["patchPreferences"];
        trace?: never;
    };
    "/api/v1/orgs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The workspaces you belong to
         * @description **Mockup 01 Step 2's row model, in one request.** Every workspace the signed-in
         *     person is a member of, with the monogram initials its avatar draws, whether it is a
         *     personal workspace, how many repositories are enabled inside it, one of them to name,
         *     and the role the caller holds there.
         *
         *     It exists because that answer is three tables and the organization plugin serves only
         *     one of them: `GET /api/auth/organization/list` returns the workspaces but discards the
         *     role in its adapter, so a client composing this itself needs one further request *per
         *     workspace* — and still has no counts. This is a join and a grouped count, and it is
         *     the one read `/api/v1` offers that the auth family cannot.
         *
         *     **It is the one operation in this document that requires no workspace.** Asking
         *     somebody to choose one before being told which they have would be circular, and it is
         *     exactly the state `organization_required` tells them to leave. The listing is scoped
         *     to the caller, so the exemption is not a way around the rule — a person sees their own
         *     memberships and no others.
         *
         *     Oldest first, which is the order Step 2 draws them in.
         */
        get: operations["listOrgs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orgs/{orgId}/domains": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a workspace's email domains
         * @description One page of this workspace's domains, the primary first and the rest alphabetically.
         *     The order is the settings screen's: the domain the product displays back is the one a
         *     reader looks for.
         */
        get: operations["listDomains"];
        put?: never;
        /**
         * Claim an email domain
         * @description Claim a domain for this workspace, optionally as the one displayed back.
         *
         *     A domain is unique across the whole installation rather than within a workspace,
         *     because it is what resolves a workspace at sign-in: `POST /api/v1/auth/discover` reads
         *     exactly this table, and a domain naming two workspaces would name neither.
         */
        post: operations["addDomain"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orgs/{orgId}/domains/{domainId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Give a domain up
         * @description Remove a domain from this workspace, primary or not.
         *
         *     `204` and no body: there is nothing to say about a row that no longer exists, and a
         *     body carrying the deleted resource invites a client to keep using it.
         */
        delete: operations["removeDomain"];
        options?: never;
        head?: never;
        /**
         * Promote or demote a domain
         * @description Make this the workspace's primary domain, or give up the flag.
         *
         *     Demoting is allowed to leave the workspace with no primary at all: that is a legal
         *     state, and refusing would make "replace the domain we display" an operation with no
         *     order that works.
         */
        patch: operations["setPrimaryDomain"];
        trace?: never;
    };
    "/api/v1/orgs/{orgId}/github-orgs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a workspace's GitHub organisations
         * @description One page of this workspace's GitHub organisations, by login — **including the disabled
         *     ones**, because a settings screen has to render the switch that is off, and a list
         *     that hid them would make turning one back on impossible through this API.
         *
         *     Two words called "org" meet on this path, and the path is what keeps them apart:
         *     `{orgId}` is the **workspace**, and `github-orgs` are **GitHub's**.
         */
        get: operations["listGithubOrgs"];
        put?: never;
        /**
         * Record a GitHub organisation
         * @description Record a GitHub organisation for this workspace, switched off unless the request asks
         *     otherwise.
         *
         *     Enablement is per workspace rather than global: two workspaces may each enable an
         *     organisation they both belong to, and each holds its own flag and its own
         *     installation.
         */
        post: operations["addGithubOrg"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orgs/{orgId}/github-orgs/{login}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * One GitHub organisation
         * @description The organisation, addressed by its login rather than by an id — the login is what a
         *     person types, what a URL elsewhere already carries, and what is unique within the
         *     workspace.
         */
        get: operations["readGithubOrg"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Enable or disable a GitHub organisation
         * @description **Mockup 01 Step 2's switch.** Turn the organisation on or off for this workspace.
         *
         *     Turning it off suspends everything under it **without** discarding the per-repository
         *     choices underneath — which is why there are two flags rather than one, and why this
         *     touches only the organisation's. A repository is in scope for Ouroboros when its own
         *     flag and its organisation's are both true.
         */
        patch: operations["setGithubOrgEnabled"];
        trace?: never;
    };
    "/api/v1/orgs/{orgId}/github-orgs/{login}/repos": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List an organisation's repositories
         * @description One page of this organisation's repositories, by name, enabled or not.
         *
         *     A repository hangs from its GitHub organisation rather than from the workspace, which
         *     is why this path carries both — and why a repository resource names its parent
         *     `githubOrgId` rather than `orgId`, which is the workspace everywhere else here.
         */
        get: operations["listRepos"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orgs/{orgId}/github-orgs/{login}/repos/{name}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * One repository
         * @description The repository, if Ouroboros has heard of it.
         *
         *     **This is the only operation that can answer `repo_not_found`.** The `PATCH` beside it
         *     *creates* the row it cannot find — there is no discovery flow yet, so naming a
         *     repository is how one comes to exist — which leaves a `GET` as the one operation with
         *     nothing to create and something honest to report.
         */
        get: operations["readRepo"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Enable or disable a repository
         * @description Turn a repository on or off — **and record it if this is the first Ouroboros has heard
         *     of it.**
         *
         *     There is no `POST` for a repository, and that is why this one creates: the GitHub App
         *     installation flow that would discover repositories is future product work, so nothing
         *     exists today to have created a row for somebody to then switch on. Making the `PATCH`
         *     an upsert is what keeps "turn this repository on" a single request either way.
         *
         *     `defaultBranch` is left alone when omitted rather than cleared — it is discovered from
         *     GitHub, and an enable/disable is not the thing that should forget it.
         *
         *     It answers no `repo_not_found`: the only thing that can be missing is the organisation
         *     the row would hang from.
         */
        patch: operations["setRepoEnabled"];
        trace?: never;
    };
    "/health/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Liveness probe
         * @description Report that the process is up and serving.
         *
         *     Deliberately shallow — it opens no connection, reads no configuration and calls
         *     nothing downstream, so it cannot fail for a reason that has nothing to do with
         *     whether this process should be restarted. Reaching the handler at all is the answer;
         *     the three empty sections in the body are the shape `/health/ready` fills in.
         *
         *     Its reader restarts the container when this stops answering, which is why *no*
         *     dependency is consulted here: a liveness probe that failed because PostgreSQL was
         *     down would restart every replica of a healthy service, repeatedly, while the
         *     database was the thing that needed attention.
         */
        get: operations["readLiveness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Readiness probe
         * @description Report whether this service's dependencies are reachable: PostgreSQL, asked
         *     `SELECT 1` on a connection of the probe's own, and `ouroboros-engine`, asked for the
         *     one route it serves without the internal key — `GET /healthz`.
         *
         *     Both are asked concurrently and reported independently, so a body that says the
         *     database is down still says whether the engine is up. Every wait is bounded at two
         *     seconds, so this answers whether or not a dependency does.
         *
         *     A `down` message names what was attempted and classifies why it failed. It carries
         *     no host, no port, no role and no driver text: this route answers without
         *     authentication, and the driver's own message — which is written for an operator and
         *     names all three — goes to the service log instead.
         *
         *     Its reader takes the process out of rotation, or holds a dependent container back,
         *     and putting it back costs nothing. That is why this one is allowed to fail because a
         *     dependency is missing, and `/health/live` is not.
         */
        get: operations["readReadiness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /**
         * Error
         * @description The body of **every** error this API answers with, and the same shape
         *     `ouroboros-engine` uses behind it (`docs/ARCHITECTURE.md` § 5.3). A failure the
         *     framework produced — a path no route claims, a body the parser refused — carries it
         *     too, so a client has one thing to parse rather than one per layer.
         */
        Error: {
            /**
             * @description Stable, machine-readable, and the thing to branch on. Every code this API can
             *     answer with is named in the description of the response that carries it.
             * @example domain_taken
             * @example tenant_not_found
             * @example org_not_found
             * @example validation_failed
             */
            code: string;
            /**
             * @description Written for a person. It may name a value the caller sent and never names
             *     anything about the service's own internals — no driver text, no stack, no
             *     constraint. A `500`'s message is a constant for exactly that reason.
             * @example That domain belongs to another workspace.
             */
            message: string;
            /**
             * @description Whatever is specific to this failure — the field messages of a `422`, keyed by
             *     field path; the identifier a `404` was asked about; the constraint a generic
             *     conflict tripped. Always present, empty rather than absent when there is nothing
             *     to add, so a client reading `details.x` never has to check `details` first.
             * @example {
             *       "slug": [
             *         "slug must be lower-case letters, digits and single hyphens"
             *       ]
             *     }
             * @example {}
             */
            details: {
                [key: string]: unknown;
            };
        };
        /**
         * SignInSocialRequest
         * @description Which provider to sign in with, and where to come back to.
         */
        SignInSocialRequest: {
            /**
             * @description The provider's id. `github` is the only one configured — see
             *     `src/auth/github.provider.ts`.
             * @example github
             */
            provider: string;
            /**
             * @description Where to send the browser once the handshake completes.
             * @example http://localhost:3000/login
             */
            callbackURL?: string;
            /** @description Where to send it when the handshake fails, instead of `/api/auth/error`. */
            errorCallbackURL?: string;
            /**
             * @description Answer with the URL only, setting no `Location` header. `ouroboros-ui` follows
             *     the URL itself, which is what makes the sign-in button a script's decision
             *     rather than a navigation the service forces.
             */
            disableRedirect?: boolean;
        } & {
            [key: string]: unknown;
        };
        /**
         * SignInSocialResponse
         * @description Where to send the browser to authorize.
         */
        SignInSocialResponse: {
            /**
             * @description The provider's authorization URL, carrying the `state` this service issued.
             * @example https://github.com/login/oauth/authorize?client_id=…&state=…
             */
            url?: string;
            /**
             * @description Whether a `Location` header was set beside the body.
             * @example true
             */
            redirect: boolean;
        } & {
            [key: string]: unknown;
        };
        /**
         * AuthUser
         * @description The signed-in person, as BetterAuth holds them — the `"user"` table
         *     ([#706](https://github.com/NobuData/ouroboros/issues/706)).
         *
         *     One human is one row however many organizations they belong to. `name` and `image`
         *     are the library's field names; this API's own resources call the same two things
         *     `displayName` and `avatarUrl`.
         */
        AuthUser: {
            /**
             * @description Stable for the person's whole life. A uuid rendered as text for everybody who
             *     came across in V004's back-fill, and the library's own id for anybody who signed
             *     in after it.
             * @example 5eed0003-0000-4000-8000-000000000001
             */
            id: string;
            /**
             * Format: email
             * @description Lower-cased and unique. How a person is recognised — including as the recipient
             *     of an invitation sent before they ever signed in — and not how they
             *     authenticate.
             * @example ken@acme-robotics.dev
             */
            email: string;
            /**
             * @description Whether *this service* has verified the address. Not what authorises account
             *     linking: that needs the **provider** to call it verified, which is the stricter
             *     of the two — see `ACCOUNT_LINKING` in `src/auth/github.provider.ts`.
             */
            emailVerified: boolean;
            /**
             * @description Their name on GitHub, or their login when they have set none.
             * @example Ken Suenobu
             */
            name: string;
            /** @description The avatar the provider hosts, or `null` — which is what makes the UI draw a monogram. */
            image?: string | null;
            /**
             * Format: date-time
             * @example 2026-08-11T10:20:23.114Z
             */
            createdAt: string;
            /**
             * Format: date-time
             * @example 2026-08-11T10:20:23.114Z
             */
            updatedAt: string;
        } & {
            [key: string]: unknown;
        };
        /**
         * AuthSession
         * @description The session row itself. **A row, not a claim in a cookie** — which is what makes
         *     sign-out immediate and a deleted account's outstanding session stop working at once
         *     ([#703](https://github.com/NobuData/ouroboros/issues/703)).
         */
        AuthSession: {
            id: string;
            /** @description The person this session belongs to. */
            userId: string;
            /**
             * @description The value the session cookie carries. Published because the shape has it, not
             *     because a client should read it: the cookie is `HttpOnly` and nothing in a
             *     browser can.
             */
            token: string;
            /** Format: date-time */
            expiresAt: string;
            /**
             * @description **The tenant pointer** — which organization this session is acting in, or `null`
             *     for somebody who has signed in and chosen nothing yet. Written by
             *     `POST /api/auth/organization/set-active` and by nothing a client can assert
             *     (decision A5).
             */
            activeOrganizationId?: string | null;
            ipAddress?: string | null;
            userAgent?: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        } & {
            [key: string]: unknown;
        };
        /**
         * AuthSessionEnvelope
         * @description What `get-session` answers when there is a session to answer with.
         */
        AuthSessionEnvelope: {
            session: components["schemas"]["AuthSession"];
            user: components["schemas"]["AuthUser"];
        } & {
            [key: string]: unknown;
        };
        /**
         * AuthSessionOrNull
         * @description The session, or `null` for nobody.
         *
         *     `null` rather than a `401`, and that is the property a login screen is built on: it
         *     has to be able to ask *is anybody signed in* and get an answer rather than a
         *     redirect.
         */
        AuthSessionOrNull: components["schemas"]["AuthSessionEnvelope"] | null;
        /**
         * SignOutResponse
         * @description `{"success": true}`, whether or not there was a session to end — the removal is
         *     idempotent, because requiring a live session to clear an expired cookie would mean
         *     the cookie could never be cleared.
         */
        SignOutResponse: {
            /** @example true */
            success: boolean;
        } & {
            [key: string]: unknown;
        };
        /**
         * AuthOk
         * @description The BetterAuth handler answering for itself, and for nothing else.
         */
        AuthOk: {
            /** @example true */
            ok: boolean;
        } & {
            [key: string]: unknown;
        };
        /**
         * AuthError
         * @description **BetterAuth's error shape, which is not this API's envelope.** The `/api/v1` routes
         *     answer `{code, message, details}` from one filter; these routes are the library's
         *     and it composes its own failures, so a client handling both families handles two
         *     error shapes. That is a real cost of the two-client rule, and stating it is cheaper
         *     than a client discovering it.
         */
        AuthError: {
            /**
             * @description Written for a person.
             * @example You are not a member of this organization
             */
            message?: string;
            /**
             * @description The library's stable code, screaming case.
             * @example YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION
             */
            code?: string;
        } & {
            [key: string]: unknown;
        };
        /**
         * MemberRole
         * @description What somebody may do in an organization. Three are the plugin's; `viewer` is this
         *     service's, added as a custom access-control role so the vocabulary
         *     `V002__users_membership.sql` had been storing since
         *     [#21](https://github.com/NobuData/ouroboros/issues/21) survived the move
         *     (`src/auth/organization.roles.ts`).
         * @example owner
         * @enum {string}
         */
        MemberRole: "owner" | "admin" | "member" | "viewer";
        /**
         * MemberRoleResponse
         * @description The role the caller holds in one organization.
         */
        MemberRoleResponse: {
            role: components["schemas"]["MemberRole"];
        } & {
            [key: string]: unknown;
        };
        /**
         * Organization
         * @description A workspace — the tenancy backbone since
         *     [#704](https://github.com/NobuData/ouroboros/issues/704). What `V001__tenants.sql`
         *     called a `tenant`, holding the same ids: `V006__tenancy_extensions.sql` moved the
         *     rows across without remapping them ([#708](https://github.com/NobuData/ouroboros/issues/708)).
         */
        Organization: {
            /**
             * @description Stable for the organization's whole life. The slug is not; this is what to store.
             * @example 9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10
             */
            id: string;
            /**
             * @description What a person calls it.
             * @example Acme, Inc.
             */
            name: string;
            /**
             * @description The URL- and CLI-safe handle, unique across the installation.
             * @example acme
             */
            slug: string;
            logo?: string | null;
            /**
             * @description `{"personal": true}` is the one key this installation writes, and it is what
             *     renders mockup 01 Step 2's `personal` pill. **A client cannot set it**: it is
             *     stripped from every creation request, so the pill can only ever be telling the
             *     truth.
             */
            metadata?: {
                [key: string]: unknown;
            } | null;
            /** Format: date-time */
            createdAt: string;
        } & {
            [key: string]: unknown;
        };
        /**
         * OrganizationMember
         * @description One person's membership of one organization — the `(organization, person)` pair, and
         *     the role they hold in it.
         */
        OrganizationMember: {
            id: string;
            organizationId: string;
            userId: string;
            role: components["schemas"]["MemberRole"];
            /**
             * Format: date-time
             * @description When the membership came into being. The plugin keeps one timestamp where
             *     `tenant_members` kept two, so *invited* and *joined* are no longer separable —
             *     an invitation lives on the `invitation` row until it is accepted, and the member
             *     row is written at acceptance.
             */
            createdAt: string;
            /** @description The person, when the caller asked for a listing that joins them in. */
            user?: components["schemas"]["AuthUser"] | null;
        } & {
            [key: string]: unknown;
        };
        /**
         * Invitation
         * @description Somebody asked to join, at a role, before they are a member.
         *
         *     **No email is sent in MVP** — the row is the whole of the operation, and
         *     [#724](https://github.com/NobuData/ouroboros/issues/724) is the delivery. `expiresAt`
         *     is already here waiting for it.
         */
        Invitation: {
            id: string;
            organizationId: string;
            /**
             * Format: email
             * @description Who was invited. They need not have an account yet.
             */
            email: string;
            role: components["schemas"]["MemberRole"];
            /**
             * @example pending
             * @enum {string}
             */
            status: "pending" | "accepted" | "rejected" | "canceled";
            /** Format: date-time */
            expiresAt: string;
            /** @description Who issued it. */
            inviterId: string;
        } & {
            [key: string]: unknown;
        };
        /**
         * FullOrganization
         * @description One organization with its people — mockup 17's members & roles table in a single
         *     answer.
         */
        FullOrganization: {
            id: string;
            name: string;
            slug: string;
            logo?: string | null;
            metadata?: {
                [key: string]: unknown;
            } | null;
            /** Format: date-time */
            createdAt: string;
            members?: components["schemas"]["OrganizationMember"][];
            /** @description The outstanding ones. */
            invitations?: components["schemas"]["Invitation"][];
        } & {
            [key: string]: unknown;
        };
        /**
         * FullOrganizationOrNull
         * @description The organization, or `null` — which is what a session with no active organization
         *     gets, rather than an error. Choosing nothing yet is a state the login screen exists
         *     to resolve, not a failure.
         */
        FullOrganizationOrNull: components["schemas"]["FullOrganization"] | null;
        /**
         * CreatedOrganization
         * @description The new organization, with the caller's own membership — the `owner` row created in
         *     the same operation, so nothing has to be read back to find out what they hold.
         */
        CreatedOrganization: components["schemas"]["Organization"] & {
            members?: components["schemas"]["OrganizationMember"][];
        };
        /**
         * CreateOrganizationRequest
         * @description A workspace to create. The caller becomes its `owner`.
         */
        CreateOrganizationRequest: {
            /** @example Acme, Inc. */
            name: string;
            /**
             * @description Unique across the installation; a taken one is a `400`.
             * @example acme
             */
            slug: string;
            logo?: string;
            /**
             * @description **`personal` is stripped from whatever is sent here.** See the operation's own
             *     description for why the one flag a client may not set is the one that renders a
             *     pill.
             */
            metadata?: {
                [key: string]: unknown;
            };
            /**
             * @description Create it without switching into it. Absent means the new organization becomes
             *     the session's active one, which is what somebody creating their first workspace
             *     wants.
             */
            keepCurrentActiveOrganization?: boolean;
        } & {
            [key: string]: unknown;
        };
        /**
         * SetActiveOrganizationRequest
         * @description Which organization this session acts in. Give an id or a slug; give `null` to unset
         *     the pointer.
         */
        SetActiveOrganizationRequest: {
            organizationId?: string | null;
            organizationSlug?: string;
        } & {
            [key: string]: unknown;
        };
        /**
         * OrgInviteMemberRequest
         * @description Somebody to invite, and what they will hold when they accept.
         */
        OrgInviteMemberRequest: {
            /** Format: email */
            email: string;
            role: components["schemas"]["MemberRole"];
            /** @description Which organization. Defaults to the session's active one. */
            organizationId?: string;
            /** @description Re-issue an outstanding invitation rather than refusing a duplicate. */
            resend?: boolean;
        } & {
            [key: string]: unknown;
        };
        /**
         * UpdateMemberRoleRequest
         * @description A membership, and the role it should now hold.
         */
        UpdateMemberRoleRequest: {
            /** @description The membership row's id — not the person's. */
            memberId: string;
            role: components["schemas"]["MemberRole"];
            /** @description Which organization. Defaults to the session's active one. */
            organizationId?: string;
        } & {
            [key: string]: unknown;
        };
        /**
         * DiscoverResponse
         * @description What a company domain resolves to: whether it signs in through an identity provider,
         *     and what to do about it.
         *
         *     **The same object comes back for a domain we hold and one we have never seen.** The
         *     endpoint is public, so anything conditional here would be a way to ask *is this
         *     company a customer* — see the operation's own description. There is no organization
         *     name in this schema, no member count and no identifier, and that is a property of the
         *     contract rather than of one release's implementation.
         *
         *     `ssoAvailable` is the discriminator, and the two optional-looking halves are its two
         *     branches: `false` means read `message`, `true` means follow `redirectUrl`. A client
         *     written against that reads correctly today, when the answer is always `false`, and
         *     goes on reading correctly when
         *     [#722](https://github.com/NobuData/ouroboros/issues/722) makes it sometimes `true`.
         */
        DiscoverResponse: {
            /**
             * @description Whether this domain signs in through SAML or OIDC.
             *
             *     **`false` in every answer this release sends**, for every domain — enterprise SSO
             *     is #722 and MVP signs in with GitHub (decision A7). It is in the contract now, and
             *     answered honestly now, so the card that reads it does not have to be rewritten
             *     when the other branch starts happening.
             * @example false
             */
            ssoAvailable: boolean;
            /**
             * @description A sentence to render, always present. When `ssoAvailable` is `false` it says why;
             *     when it is `true` it is what the card shows while the browser is on its way.
             *
             *     Required rather than optional so a client has something to display in **both**
             *     branches without inventing copy of its own.
             * @example Enterprise SSO is not configured yet — sign in with GitHub for now.
             */
            message: string;
            /**
             * @description Where to send the browser to sign in, present only when `ssoAvailable` is `true`.
             *
             *     **Never sent in this release.** It is published now because #718's sign-in card is
             *     written against this document today and must not need restructuring when #722
             *     fills it in.
             * @example /api/auth/sso/saml2/acme
             */
            redirectUrl?: string;
        };
        /**
         * RepoCounts
         * @description How many repositories are switched on, and how many there are.
         *
         *     Counted on each repository's **own** flag, without regard to its organisation's. The
         *     two are independent by design — a repository is in scope for Ouroboros only when both
         *     are true — and a count that folded them together would make turning an organisation
         *     off look like losing the per-repository choices underneath it, which is exactly what
         *     two flags exist to prevent.
         */
        RepoCounts: {
            /** @example 4 */
            enabled: number;
            /**
             * @description Never smaller than `enabled`.
             * @example 4
             */
            total: number;
        };
        /**
         * GithubOrgSummary
         * @description One GitHub organisation as a workspace row carries it — enough to draw a switch and to
         *     address the `PATCH` that flips it.
         *
         *     A summary rather than the whole `GithubOrg`: the ids and timestamps a settings screen
         *     pages through are noise on a first-run card, and `login` is what the enable/disable
         *     path takes.
         */
        GithubOrgSummary: {
            /**
             * @description The `{login}` in the enable/disable path.
             * @example acme-robotics
             */
            login: string;
            /** @example true */
            enabled: boolean;
            repoCounts: components["schemas"]["RepoCounts"];
        };
        /**
         * OrgRow
         * @description One workspace the signed-in person belongs to — mockup 01 Step 2's row, field for
         *     field.
         *
         *     ```
         *     ┌────┐  acme-robotics ✓                          ┌────●
         *     │ AR │  4 repos enabled · incl. helios-firmware  └────┘
         *     └────┘
         *       ▲     ▲              ▲     ▲                     ▲
         *       │     slug           │     featuredRepo          enabled
         *       monogram             repoCounts.enabled
         *     ```
         *
         *     The derived fields — `monogram`, `personal` — are computed by the service rather than
         *     by the client on purpose: a browser that derived them would be a second place the rule
         *     lives, and the two would disagree the first time either changed.
         */
        OrgRow: {
            /**
             * @description The `{orgId}` every other operation in this document takes. An opaque string in
             *     one of two shapes — see the `orgId` path parameter.
             * @example aBcD1234eFgH5678iJkL9012mNoP3456
             */
            id: string;
            /**
             * @description The handle. What the mockup prints as the row's name.
             * @example acme-robotics
             */
            slug: string;
            /**
             * @description What a human reads. The monogram is derived from it.
             * @example Acme Robotics
             */
            name: string;
            /**
             * @description Initials for the avatar the mockup draws in place of a logo — the first letter of
             *     each of the first two words, or the first two letters of a single-word name.
             *     Empty for a name with no letters or digits in it at all, which a client renders as
             *     an empty circle rather than as a failure.
             * @example AR
             */
            monogram: string;
            /**
             * @description Whether this is somebody's own workspace — the mockup's `personal` pill. Set only
             *     by the service, at a person's first sign-in; `POST /api/auth/organization/create`
             *     strips the flag from whatever a client sends, so this is a fact rather than a
             *     claim.
             * @example false
             */
            personal: boolean;
            /**
             * @description What the caller may do here — **a list, not a word**, because the stored column is
             *     one. It is what a screen greys the switch out on: `owner` and `admin` may toggle,
             *     `member` and `viewer` may look. Ordinarily one entry; possibly none, for a
             *     membership carrying only roles this service does not recognise.
             * @example [
             *       "owner"
             *     ]
             */
            roles: components["schemas"]["MemberRole"][];
            /**
             * @description Whether **any** of this workspace's GitHub organisations is switched on — the
             *     row's own switch, summarising the ones in `githubOrgs` rather than a flag of its
             *     own.
             * @example true
             */
            enabled: boolean;
            repoCounts: components["schemas"]["RepoCounts"];
            /**
             * @description One enabled repository to name in the mockup's `incl. <repo>`, or `null` when none
             *     is. The earliest-recorded one in the first of this workspace's organisations that
             *     has any — earliest rather than alphabetical, because "the first one you turned on"
             *     is a more useful thing to show a person than "the one whose name sorts first".
             * @example helios-firmware
             */
            featuredRepo: string | null;
            /** @description Its GitHub organisations, by login — what the switch acts on. */
            githubOrgs: components["schemas"]["GithubOrgSummary"][];
            /**
             * Format: date-time
             * @description When the workspace came into being. The listing's own order.
             * @example 2026-08-11T10:20:23.114Z
             */
            createdAt: string;
        };
        /**
         * OrgRowPage
         * @description One page of the workspaces you belong to, oldest first.
         */
        OrgRowPage: {
            items: components["schemas"]["OrgRow"][];
            /** @example 3 */
            total: number;
            /** @example 25 */
            limit: number;
            /** @example 0 */
            offset: number;
        };
        /**
         * Domain
         * @description An email domain that resolves a workspace at sign-in.
         */
        Domain: {
            /**
             * Format: uuid
             * @example 4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94
             */
            id: string;
            /**
             * @description The workspace it belongs to. An opaque string — see the path parameter.
             * @example aBcD1234eFgH5678iJkL9012mNoP3456
             */
            orgId: string;
            /**
             * @description Lower-cased, and unique across the whole installation rather than within the
             *     workspace — a domain names exactly one workspace at sign-in.
             * @example acme-robotics.dev
             */
            domain: string;
            /**
             * @description The domain the product displays back. At most one per workspace, and zero is legal
             *     for a workspace part-way through setting itself up.
             * @example true
             */
            isPrimary: boolean;
            /**
             * Format: date-time
             * @example 2026-08-11T10:20:23.114Z
             */
            createdAt: string;
            /**
             * Format: date-time
             * @example 2026-08-11T10:20:23.114Z
             */
            updatedAt: string;
        };
        /**
         * DomainPage
         * @description One page of a workspace's domains, the primary first.
         */
        DomainPage: {
            items: components["schemas"]["Domain"][];
            /** @example 1 */
            total: number;
            /** @example 25 */
            limit: number;
            /** @example 0 */
            offset: number;
        };
        /**
         * GithubOrg
         * @description A GitHub organisation a workspace has recorded, enabled or not.
         *
         *     Not to be confused with `Organization`, which is the *workspace* the organization
         *     plugin holds. `orgId` here is the workspace; the GitHub organisation is addressed by
         *     `login`.
         */
        GithubOrg: {
            /**
             * Format: uuid
             * @example 2e5f7a19-3b4c-4d6e-8f01-9a2b3c4d5e6f
             */
            id: string;
            /**
             * @description The workspace it belongs to. An opaque string — see the path parameter.
             * @example aBcD1234eFgH5678iJkL9012mNoP3456
             */
            orgId: string;
            /**
             * @description Lower-cased, and unique within the workspace rather than globally.
             * @example acme-robotics
             */
            login: string;
            /**
             * @description Whether Ouroboros may operate in it. A row records that the organisation is
             *     *known*; this records that somebody deliberately turned it on, and anything
             *     arriving by a path nobody has thought about yet arrives switched off.
             * @example true
             */
            enabled: boolean;
            /**
             * @description When the GitHub App was installed. `null` until the installation flow exists — a
             *     timestamp here would assert an installation that never happened.
             * @example null
             */
            installedAt: string | null;
            /**
             * Format: date-time
             * @example 2026-08-11T10:20:23.114Z
             */
            createdAt: string;
            /**
             * Format: date-time
             * @example 2026-08-11T10:20:23.114Z
             */
            updatedAt: string;
        };
        /**
         * GithubOrgPage
         * @description One page of a workspace's GitHub organisations, by login.
         */
        GithubOrgPage: {
            items: components["schemas"]["GithubOrg"][];
            /** @example 1 */
            total: number;
            /** @example 25 */
            limit: number;
            /** @example 0 */
            offset: number;
        };
        /**
         * Repo
         * @description A repository within a GitHub organisation. In scope for Ouroboros only when this
         *     **and** its organisation are enabled.
         */
        Repo: {
            /**
             * Format: uuid
             * @example 7a3d9c21-8e4f-4b5a-9c6d-0e1f2a3b4c5d
             */
            id: string;
            /**
             * Format: uuid
             * @description The **GitHub organisation** it belongs to, not the workspace. A repository hangs
             *     off its organisation and the workspace is reachable through that, so a second copy
             *     of the fact here could disagree with the organisation's. `githubOrgId` rather than
             *     `orgId` because `orgId` is the workspace everywhere else in this document.
             * @example 2e5f7a19-3b4c-4d6e-8f01-9a2b3c4d5e6f
             */
            githubOrgId: string;
            /**
             * @description Lower-cased, without the owner prefix, and unique within its organisation.
             * @example helios-firmware
             */
            name: string;
            /** @example true */
            enabled: boolean;
            /**
             * @description The branch work is cut from. `null` until it has been discovered from GitHub, and
             *     left alone by an enable/disable that does not mention it.
             * @example main
             */
            defaultBranch: string | null;
            /**
             * Format: date-time
             * @example 2026-08-11T10:20:23.114Z
             */
            createdAt: string;
            /**
             * Format: date-time
             * @example 2026-08-11T10:20:23.114Z
             */
            updatedAt: string;
        };
        /**
         * RepoPage
         * @description One page of an organisation's repositories, by name.
         */
        RepoPage: {
            items: components["schemas"]["Repo"][];
            /** @example 1 */
            total: number;
            /** @example 25 */
            limit: number;
            /** @example 0 */
            offset: number;
        };
        /**
         * DiscoverRequest
         * @description The body of `POST /api/v1/auth/discover` — the company domain, as a person typed it.
         *
         *     **This is the one request body in this API that is normalised rather than rejected.**
         *     Everywhere else a value with upper case in it is refused, because what is stored
         *     should be what was sent; nothing is stored here, and the field is filled in by
         *     somebody who has just pasted `https://Acme.Ouroboros.dev/` out of their address bar.
         *     So the service trims it, lower-cases it, and removes the scheme, the path, the query,
         *     the fragment and a trailing dot — and *then* requires what is left to be a domain
         *     name. `  HTTPS://Acme.Ouroboros.dev/login  ` and `acme.ouroboros.dev` are the same
         *     request.
         *
         *     What it does **not** do is guess. A port, an email address, an internal hostname with
         *     no dot in it — none of them are folded into something plausible; they are a `422`
         *     naming the field.
         */
        DiscoverRequest: {
            /**
             * @description The company domain. `acme.ouroboros.dev` — mockup 01's own placeholder.
             *
             *     No `pattern` here, deliberately: the rule applies to the *normalised* value, and a
             *     pattern on this field would tell a client generator to refuse `https://acme.…/`,
             *     which the service accepts. After normalisation the value must be a lower-case
             *     domain name of two or more labels and at most 253 characters — the same shape
             *     `CreateDomainRequest` states, because it is the same column being matched.
             *
             *     The generous `maxLength` bounds what a form can post rather than what a domain may
             *     be; the scheme and path a person pastes are removed before the real limit applies.
             * @example acme.ouroboros.dev
             */
            domain: string;
        };
        /**
         * CreateDomainRequest
         * @description A domain to claim for a workspace.
         */
        CreateDomainRequest: {
            /**
             * @description Lower-cased. Upper case is **rejected rather than folded**: folding would be
             *     friendlier, and it would also mean the value stored is not the value sent, which
             *     is the beginning of a client that cannot predict what a `GET` will return.
             * @example acme-robotics.dev
             */
            domain: string;
            /**
             * @description Make this the primary domain, demoting whichever one holds the flag now.
             * @default false
             * @example true
             */
            isPrimary: boolean;
        };
        /**
         * UpdateDomainRequest
         * @description The set-primary operation. One field, because it is the only thing about a domain that
         *     can change: the domain itself is what the row *is*, and renaming one is adding the new
         *     one and removing the old.
         */
        UpdateDomainRequest: {
            /** @example true */
            isPrimary: boolean;
        };
        /**
         * CreateGithubOrgRequest
         * @description A GitHub organisation to record for a workspace.
         */
        CreateGithubOrgRequest: {
            /**
             * @description The organisation's GitHub login, lower-cased.
             * @example acme-robotics
             */
            login: string;
            /**
             * @description Whether Ouroboros may operate in it. Defaults to `false`: failing closed is the
             *     posture for the flags whose whole job is to bound what an autonomous agent may
             *     touch.
             * @default false
             * @example true
             */
            enabled: boolean;
        };
        /**
         * UpdateGithubOrgRequest
         * @description Mockup 01 Step 2's switch, as a request body.
         */
        UpdateGithubOrgRequest: {
            /** @example true */
            enabled: boolean;
        };
        /**
         * UpdateRepoRequest
         * @description Turn a repository on or off. This is also how one first comes to be known — see the
         *     operation.
         */
        UpdateRepoRequest: {
            /** @example true */
            enabled: boolean;
            /**
             * @description The branch work is cut from. Omitted leaves whatever was discovered alone rather
             *     than clearing it — the difference between "I am not setting this" and "I am
             *     setting this to nothing".
             *
             *     The pattern is the database's rule as one expression: no leading or trailing
             *     slash, no empty segment, no leading dot, and **no `..` anywhere** — which is the
             *     one that matters, because a slash is permitted and `..` would otherwise be path
             *     traversal in anything that builds a checkout directory from the value.
             * @example main
             */
            defaultBranch?: string;
        };
        /**
         * FontScale
         * @description One of the five root font-size steps, as a percentage of the browser's base size
         *     (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 4). A **string, deliberately**: the value is a
         *     label the UI stamps onto `<html>` — nothing does arithmetic with it, `"100.0"` is
         *     not `"100"`, and a number would round-trip through JSON as a float. The vocabulary
         *     is `user_preferences_font_scale`'s CHECK (V007), restated; widening it is a
         *     migration there before it is a value here.
         * @example 100
         * @enum {string}
         */
        FontScale: "87.5" | "100" | "112.5" | "125" | "150";
        /**
         * Preferences
         * @description The caller's product preferences, defaults included — the answer of both operations
         *     under `/api/v1/me/preferences`. Every field always has a value: absence of a stored
         *     choice reads as the default, never as a missing property, so a client renders
         *     controls from this without a fallback branch.
         */
        Preferences: {
            fontScale: components["schemas"]["FontScale"];
        };
        /**
         * PreferencesPatch
         * @description What changed. Every field optional — send what changed, omit the rest — and an
         *     empty object is legal: it changes nothing and reads back the current state.
         */
        PreferencesPatch: {
            fontScale?: components["schemas"]["FontScale"];
        };
        /**
         * RunStatus
         * @description Where a run is in its life. The first three are **active** — the run is in flight and
         *     has no `finishedAt` — and the last three are **terminal**.
         *
         *     The split is the dashboard's two run cards: *Active loops* is the runs holding one of
         *     the first three, *Recently closed by the loop* is the runs holding one of the last
         *     three. They are one table and one shape, queried twice; a run moving between the cards
         *     *is* the transition into a terminal status.
         * @example coding
         * @enum {string}
         */
        RunStatus: "coding" | "building" | "review" | "merged" | "needs_human" | "failed";
        /**
         * QueueEffort
         * @description The size somebody put on a queued issue — the chip the card renders, lower-case, which
         *     is also the class name the UI stamps.
         *
         *     It is a *judgement*, and deliberately not a function of `estMinutes`: the chip is a
         *     size a person chose and the estimate is minutes something measured. If one were
         *     derived from the other, the queue's total would be a restatement of the chips rather
         *     than a second fact.
         * @example m
         * @enum {string}
         */
        QueueEffort: "xs" | "s" | "m" | "l" | "xl";
        /**
         * RunSummary
         * @description One run of the loop against one issue, as every card that draws a run draws it.
         *
         *     **One shape for both lists.** *Active loops* and *Recently closed* are two queries over
         *     one table, so the columns a stopped run has and a running one does not — `finishedAt`,
         *     `prNumber`, the check counts — are `null` here rather than absent, and a client renders
         *     both lists with one component. The paged runs endpoints
         *     ([#71](https://github.com/NobuData/ouroboros/issues/71)) answer with this same shape,
         *     so a card and its drill-in cannot drift apart.
         *
         *     **No duration is carried.** *Elapsed* is `now − startedAt`, *Cycle* is
         *     `finishedAt − startedAt`, and both are the client's to compute — see the operation's
         *     description for why.
         */
        RunSummary: {
            /**
             * Format: uuid
             * @description The run — what the run console will be addressed by, and what a row links to.
             */
            id: string;
            issueNumber: number;
            /**
             * @description The title as it was when the run started, stored rather than fetched: a card
             *     renders it on every poll, and a closed run should read as the work it actually did.
             */
            issueTitle: string;
            /**
             * @description The workflow's label, as free text. **Opaque** — there is no workflow catalogue
             *     behind it, so a run still renders under a workflow that has since been renamed.
             */
            workflowTag: string;
            /**
             * @description The model identifier as recorded — `claude-fable-5`, `ollama/qwen3-coder`,
             *     `copilot/gpt-5-codex`. **Opaque**: nothing in this service interprets it, and a
             *     client should render it rather than parse it.
             * @example claude-fable-5
             * @example ollama/qwen3-coder
             */
            model: string;
            status: components["schemas"]["RunStatus"];
            /**
             * @description The workflow's own word for the current step, captioning the stage meter.
             * @example Implementing
             */
            stageLabel: string;
            /** @description Where the run is in its workflow, out of `stageTotal`. */
            stageIndex: number;
            /** @description How many steps the workflow has. At least one, so a meter never divides by zero. */
            stageTotal: number;
            /**
             * Format: date-time
             * @description When the loop started on this issue. Not when the row appeared.
             */
            startedAt: string;
            /**
             * Format: date-time
             * @description When the run reached a terminal status, and `null` exactly while it has not.
             */
            finishedAt: string | null;
            /**
             * @description The pull request, or `null`. A run may fail, or stop for a human, before there is
             *     anything to open one for.
             */
            prNumber: number | null;
            /** @description Checks that passed. Paired with `checksTotal`: both present, or both `null`. */
            checksPassed: number | null;
            /**
             * @description Total checks on the pull request. `0` of `0` is a repository with no checks, which
             *     is **not** the same as `null` — not knowing yet.
             */
            checksTotal: number | null;
        };
        /**
         * RunPage
         * @description One page of runs ([#71](https://github.com/NobuData/ouroboros/issues/71)) — the #31
         *     pagination convention over `RunSummary` rows, in the order the requested family
         *     documents. The items are byte-identical to the aggregate's `activeRuns` and
         *     `recentRuns` entries: one schema, one mapper, one shape for a run everywhere.
         */
        RunPage: {
            items: components["schemas"]["RunSummary"][];
            /**
             * @description How many runs match the family — and the repo filter, if one narrows it.
             * @example 53
             */
            total: number;
            /** @example 25 */
            limit: number;
            /** @example 0 */
            offset: number;
        };
        /**
         * QueuePage
         * @description One page of the queue ([#73](https://github.com/NobuData/ouroboros/issues/73)) — the
         *     #31 pagination convention over `QueueItemSummary` rows in `position` order, plus the
         *     summed estimate for everything that matched. The items are byte-identical to the
         *     aggregate's `queueHead` entries: one schema, one mapper, one shape for a queued
         *     issue everywhere.
         */
        QueuePage: {
            items: components["schemas"]["QueueItemSummary"][];
            /**
             * @description How many issues are queued — the whole match, not the page, narrowed by the
             *     `repo` filter when one applies.
             * @example 12
             */
            total: number;
            /**
             * @description The **sum** of the matched rows' estimates, in minutes — rendered as
             *     `est. 9h 40m`. It skips items carrying no estimate rather than counting them as
             *     zero, so `total` may speak for more issues than this number does. Unfiltered, it
             *     equals the aggregate's `stats.queued.estMinutes` for the same workspace: the two
             *     are computed by the same sentence over the same rows, so the stat and this page
             *     cannot disagree.
             * @example 580
             */
            totalEstMinutes: number;
            /** @example 25 */
            limit: number;
            /** @example 0 */
            offset: number;
        };
        /**
         * QueueItemSummary
         * @description One queued issue, as the *Up next in queue* card draws it.
         */
        QueueItemSummary: {
            /** Format: uuid */
            id: string;
            issueNumber: number;
            issueTitle: string;
            effort: components["schemas"]["QueueEffort"];
            workflowTag: string;
            /**
             * @description Place in the queue; `1` is next. Positions are dense by the writer's convention
             *     rather than by constraint, so do not compute a queue length from the last one.
             */
            position: number;
            /**
             * @description Expected minutes of autonomous work, or `null` for **not estimated** — which is
             *     not zero. Rendering a `null` as `0m` would be inventing a claim about how long the
             *     work takes; `stats.queued.estMinutes` sums the estimates and skips these.
             */
            estMinutes: number | null;
            /**
             * Format: date-time
             * @description When the issue joined the queue. Not when the row appeared.
             */
            enqueuedAt: string;
        };
        /**
         * LoopsLive
         * @description *Loops live* — how many runs are in flight, and in which stage.
         */
        LoopsLive: {
            /** @description The card's big number, and the sum of `byStatus`. */
            total: number;
            /**
             * @description The same runs split by status, for the subline. **Every active status is a key,
             *     zeros included**, in lifecycle order — so a client composes "2 coding · 1 in
             *     review" from this without knowing which statuses exist.
             */
            byStatus: {
                coding: number;
                building: number;
                review: number;
            };
        };
        /**
         * QueuedWork
         * @description *Queued issues* — how many are waiting, and how long they are expected to take.
         */
        QueuedWork: {
            count: number;
            /**
             * @description The **sum** of the queue's estimates, in minutes — rendered as `est. 9h 40m`. It
             *     skips items carrying no estimate rather than counting them as zero, so `count` may
             *     speak for more issues than this total does. That is the honest shape of a queue
             *     where something has not been sized yet.
             */
            estMinutes: number;
        };
        /**
         * MergedSevenDays
         * @description *PRs merged · 7d* — the count, and how it compares with the week before.
         */
        MergedSevenDays: {
            /** @description Runs that reached `merged` in the trailing seven days. */
            count: number;
            /**
             * @description This week's count less the previous seven days' — rendered as `▲ 8 vs last week`.
             *     **Signed**: a negative value is a week that merged less than the one before, and
             *     the direction is read from the sign rather than from a separate flag.
             */
            deltaVsPrior: number;
        };
        /**
         * TokensToday
         * @description *Token spend · today* — the day's ledger, rolled up across providers.
         *
         *     "Today" is the **UTC** calendar day, which is the day the usage rollup is keyed by. A
         *     client rendering this beside a local clock should say so.
         */
        TokensToday: {
            /** @description Input plus output tokens across every provider — rendered as `4.2M`. */
            tokens: number;
            /**
             * @description What the day's **priced** events cost, in cents. Cents rather than a decimal
             *     currency amount so that nothing rounds on the way through JSON; it may carry
             *     fractions of a cent.
             *
             *     It is a **lower bound** whenever `unpricedEvents` is non-zero.
             */
            costCents: number;
            /** @description How many distinct providers were paid — the `across 4 providers` in the subline. */
            providers: number;
            /**
             * @description How many of the day's events carry no recorded cost. This is the `≈` on the card.
             *
             *     Cost is nullable in the ledger so that "nobody has priced this" has a value that
             *     is not zero — local inference on a workstation is the honest case of it — and a
             *     total that silently omitted those events would read as exact. Non-zero means
             *     `costCents` is a floor; equal to the day's event count means the cost is *unknown*
             *     rather than zero, which is the "cost unavailable" a card renders.
             */
            unpricedEvents: number;
        };
        /**
         * DashboardStats
         * @description The four numbers of the stat row.
         */
        DashboardStats: {
            loopsLive: components["schemas"]["LoopsLive"];
            queued: components["schemas"]["QueuedWork"];
            merged7d: components["schemas"]["MergedSevenDays"];
            tokensToday: components["schemas"]["TokensToday"];
        };
        /**
         * LoopPulse
         * @description *Loop pulse* — three windowed meters, and the one switch this page can change.
         *
         *     **The three meters are not all measured over the same window**, and the reason is
         *     mockup 02's own arithmetic. See `mergeRate`.
         */
        LoopPulse: {
            /**
             * @description **Autonomous merge rate**: merged runs ÷ every run that reached a terminal status,
             *     over **fourteen days**, as a fraction between 0 and 1.
             *
             *     Every terminal status is in the denominator — merged, stopped for a human, and
             *     failed. The meter's question is *how often does the loop finish the job without
             *     us*, and a run that stopped for a human is the clearest possible no; excluding it
             *     would make the rate say "of the runs that went well, how many went well".
             *
             *     **Fourteen days, where the two meters below are seven.** The three figures the
             *     mockup draws cannot all be true of one seven-day window: 27 merged against 2
             *     interventions is 93.1%, and no integer count of closed runs makes 27 merged 92%.
             *     Over fourteen days the same rows give 46 merged of 50 closed, which is 92% exactly.
             *     A longer window is the better measurement on its own terms as well — a rate over a
             *     denominator of twenty-nine moves four points when one run fails — and it reaches
             *     over exactly the rows `stats.merged7d.deltaVsPrior` already compares across.
             *
             *     **`0` when nothing closed in the window.** That is a floor rather than a
             *     measurement: an organization with no history reads `0` here with `0` merged and `0`
             *     interventions, and a meter should render *no data* rather than a bad week.
             * @example 0.92
             */
            mergeRate: number;
            /**
             * @description **Average cycle time**: the mean of `finishedAt − startedAt` over every run that
             *     reached a terminal status in the trailing **seven** days, in seconds.
             *
             *     Every terminal run, not only the merged ones — a run that stopped for a human took
             *     the time it took, and a mean that dropped it would report the loop as faster than
             *     it is.
             *
             *     `0` when nothing closed in the window, with the same reading as `mergeRate`'s zero.
             * @example 860
             */
            avgCycleSeconds: number;
            /**
             * @description **Human interventions**: runs that reached `needs_human` in the trailing seven
             *     days. A count of *runs*, not of interruptions — a run handed back twice is one row
             *     and counts once, because the row is what the loop stopped on.
             */
            interventions7d: number;
            /**
             * @description Whether this workspace merges on green checks without asking.
             *
             *     `false` for a workspace that has never answered, resolved from the database rather
             *     than defaulted here — so "answered no" and "never asked" read the same to the
             *     switch and differently to anything that needs to know. Changing it is
             *     [#74](https://github.com/NobuData/ouroboros/issues/74)'s operation, not this one:
             *     this endpoint writes nothing.
             */
            autoMerge: boolean;
        };
        /**
         * DashboardActivity
         * @description The page head's subline — *"3 issues in flight, 12 queued behind them. Ouroboros
         *     merged 6 pull requests since this morning."*
         *
         *     The greeting beside it is the client's: it is composed from the session user's name and
         *     the reader's own clock, and a server that rendered it would be rendering somebody's
         *     afternoon in the wrong hemisphere. These three are the half of the sentence that is
         *     data, and the first two deliberately restate figures from `stats` under the names the
         *     sentence uses — one payload should not be able to disagree with itself.
         */
        DashboardActivity: {
            /** @description Runs in flight — the same number as `stats.loopsLive.total`. */
            inFlight: number;
            /** @description Issues waiting — the same number as `stats.queued.count`. */
            queued: number;
            /**
             * @description Runs merged since **midnight UTC**. The only figure on the page measured from a
             *     calendar boundary rather than a rolling window, and therefore the only one that
             *     needs a timezone to be well defined. It is the same day boundary
             *     `stats.tokensToday` uses, so the sentence and the card cannot mean different
             *     mornings.
             */
            mergedSinceMorning: number;
        };
        /**
         * Dashboard
         * @description The whole dashboard for one workspace, measured between one set of boundaries.
         *
         *     **Every field is always present.** An organization with nothing in it answers zeros
         *     and empty arrays — never `null`, and never an absent key — so a card renders from this
         *     without a fallback branch. The nullable values are all *inside* a row, where a null is
         *     a fact about that row: a run in flight has no `finishedAt`, a queued issue may carry no
         *     estimate.
         */
        Dashboard: {
            stats: components["schemas"]["DashboardStats"];
            pulse: components["schemas"]["LoopPulse"];
            /**
             * @description The runs in flight, in **lifecycle order** — coding, then building, then review —
             *     and oldest first within a stage, so the run that has been stuck longest is at the
             *     top of its group. At most ten; a workspace running more than that is one whose
             *     drill-in the *Open run console →* link leads to.
             */
            activeRuns: components["schemas"]["RunSummary"][];
            /**
             * @description The runs that have stopped, newest first by `finishedAt`. At most eight — the card
             *     draws four, and the rest are what a client already holds if it expands.
             */
            recentRuns: components["schemas"]["RunSummary"][];
            /**
             * @description The head of the queue in queue order — exactly what the card draws. The queue's
             *     full length is `stats.queued.count`, and the whole of it is
             *     [#73](https://github.com/NobuData/ouroboros/issues/73)'s endpoint.
             */
            queueHead: components["schemas"]["QueueItemSummary"][];
            activity: components["schemas"]["DashboardActivity"];
        };
        /**
         * AutoMergeSetting
         * @description The position of the **Auto-merge when checks pass** switch, with its attribution —
         *     what both operations on `/api/v1/settings/auto-merge` answer.
         *
         *     The stamps are nullable **together**: both are null exactly when the workspace has
         *     never written a settings row, which is how a client tells a chosen `false` from a
         *     default one. `updatedBy` alone may also be null on a chosen setting whose setter was
         *     since deleted — the choice outlives the chooser.
         */
        AutoMergeSetting: {
            /**
             * @description Whether this workspace merges on green checks without asking. `false` for a
             *     workspace that has never chosen — the safe default for "merge without review"
             *     is never yes.
             */
            enabled: boolean;
            /**
             * Format: date-time
             * @description When a setting last changed, or null when nothing ever has.
             */
            updatedAt: string | null;
            /**
             * @description Who last changed it — a `"user".id` — or null: never set, or the setter was
             *     since deleted. An opaque string with the same two shapes every id in this
             *     document has (see `{orgId}`): 32-character alphanumeric from BetterAuth, uuid
             *     for rows that predate it. Never parse it as a uuid.
             */
            updatedBy: string | null;
        };
        /**
         * AutoMergeSettingPatch
         * @description The body of `PATCH /api/v1/settings/auto-merge`: send what changed. A body carrying
         *     nothing changes nothing and answers the current state.
         */
        AutoMergeSettingPatch: {
            /**
             * @description The switch's new position. A boolean and nothing else — a `"true"`, a `1` or a
             *     `null` is a `422` naming the field, never a coercion.
             */
            enabled?: boolean;
        };
        /**
         * BillingMode
         * @description How the money works for one model — which of mockup 21's four cells it renders, and
         *     which rates it may carry at all.
         *
         *     | Value | Means | Rates |
         *     |---|---|---|
         *     | `token` | Per-token rates | both present |
         *     | `seat` | Billed per person, not per call | none |
         *     | `usage` | Metered by the vendor on terms this catalog cannot express | none |
         *     | `free` | No per-call charge — a model running locally | zero or absent |
         *
         *     **There is no fifth value for "unknown".** *We have no price for this model* is the
         *     absence of a price, not a mode a price can be in — which is what keeps `—` and `$0`
         *     from ever collapsing into each other.
         * @example token
         * @enum {string}
         */
        BillingMode: "token" | "seat" | "usage" | "free";
        /**
         * PriceOverride
         * @description One price this workspace has recorded for itself, overriding the bundled catalog.
         *
         *     It has no `source`: every row here is this workspace's own statement, which is what
         *     `source: override` would say. What it does carry is `display` — the cell this
         *     correction renders — so a settings table shows the same string the registry column
         *     will.
         */
        PriceOverride: {
            /**
             * @description The provider kind, folded, or `*` for every kind.
             * @example anthropic
             */
            connectionKind: string;
            /**
             * @description The model identifier as the vendor spells it, or `*` for every model of the kind.
             * @example claude-fable-5
             */
            modelId: string;
            billingMode: components["schemas"]["BillingMode"];
            /**
             * @description Input rate in **cents per one million tokens**, or null for a mode that carries no
             *     rate. Cents per 1M because that is the unit vendors publish and the unit the
             *     column renders; four decimal places are kept, because a rate rounded down to zero
             *     is the one arithmetic error this surface must not make.
             * @example 1200
             */
            inputCentsPer1m: number | null;
            /**
             * @description Output rate, same unit and same rules. Kept apart because every vendor prices the two differently.
             * @example 6000
             */
            outputCentsPer1m: number | null;
            /**
             * @description The cell this correction renders — `$12 · $60`, `seat-based`, `usage-based` or
             *     `$0`. Never `—`: an override is a price by definition.
             * @example $12 · $60
             */
            display: string;
            /**
             * Format: date-time
             * @description When this correction took effect. Moves on every save, including a re-affirming one.
             * @example 2026-08-22T09:00:00.000Z
             */
            effectiveAt: string;
            /**
             * Format: date-time
             * @description When the row last changed — the database's own stamp, never the client's.
             * @example 2026-08-22T09:00:00.000Z
             */
            updatedAt: string;
        };
        /**
         * PriceOverrideWrite
         * @description The body of `PUT /api/v1/registry/prices`.
         *
         *     **The rates and the billing mode have to agree**, and the operation's description
         *     carries the table. In short: `token` requires both and refuses two zeros, `seat` and
         *     `usage` refuse either, and `free` accepts none or `0`. A body that breaks one of those
         *     is a `422` naming the field.
         */
        PriceOverrideWrite: {
            /**
             * @description The provider kind, in any casing — it is folded before it is stored — or `*` for
             *     every kind.
             * @example anthropic
             */
            connectionKind: string;
            /**
             * @description The model identifier, or `*` for every model of the kind. Never folded. A `*`
             *     *inside* an identifier is refused: `*` is the only wildcard there is.
             * @example claude-fable-5
             */
            modelId: string;
            billingMode: components["schemas"]["BillingMode"];
            /**
             * @description Input rate in cents per one million tokens. Required when `billingMode` is
             *     `token`, refused when it is `seat` or `usage`, and `0` or omitted when it is
             *     `free`. At most four decimal places — a finer one would be rounded on the way in,
             *     and a workspace should not be billed against a number it did not enter.
             * @example 1200
             */
            inputCentsPer1m?: number;
            /**
             * @description Output rate, same unit and same rules.
             * @example 6000
             */
            outputCentsPer1m?: number;
        };
        /**
         * PriceOverridePage
         * @description One page of a workspace's price corrections, ordered by provider kind then model.
         */
        PriceOverridePage: {
            items: components["schemas"]["PriceOverride"][];
            /** @example 2 */
            total: number;
            /** @example 25 */
            limit: number;
            /** @example 0 */
            offset: number;
        };
        /**
         * EngineStatus
         * @description The body of a `GET /api/v1/engine/status` response.
         */
        EngineStatus: {
            /**
             * @description Always `up`, and that is honest rather than redundant: every way the engine can
             *     fail to answer is a `502`, so a body that exists at all came from a reachable
             *     engine. It is a field rather than nothing so the shape can grow a second state —
             *     `degraded`, once there is something that could be degraded — without changing how
             *     a client reads the first one.
             * @example up
             * @constant
             */
            engine: "up";
            /**
             * @description The engine build that answered, read from its package metadata. It is the
             *     engine's version and not this service's: the two are released independently
             *     (`docs/CONVENTIONS.md` § 8), and which pair is deployed together is exactly what
             *     this route exists to tell you.
             * @example 0.3.0
             */
            version: string;
        };
        /**
         * Heartbeat
         * @description The body of a `GET /api/v1` response.
         */
        Heartbeat: {
            /**
             * @description This service's name, constant across deployments.
             * @example ouroboros-rest
             * @constant
             */
            service: "ouroboros-rest";
            /**
             * @description The running build, read from this module's `package.json` — the one place a
             *     module's version is written down (`docs/CONVENTIONS.md` § 8), and the same
             *     string `info.version` above carries.
             * @example 0.1.0
             */
            version: string;
            /**
             * @description Always `ok`. Reaching this handler at all is what the field reports; a client
             *     reads the status code, and this is for the human who runs the request by
             *     hand.
             * @example ok
             * @constant
             */
            status: "ok";
            /**
             * @description Seconds since the service was constructed, to millisecond precision. Small
             *     and shrinking across polls means something is restarting the process — which
             *     is the one thing a heartbeat can tell you that a plain `200` cannot.
             * @example 3.885
             */
            uptimeSeconds: number;
        };
        /**
         * HealthReport
         * @description The body of both probes — one shape, so a reader parses one thing.
         *
         *     It is `@nestjs/terminus`'s report, and the three sections are the same dependencies
         *     seen three ways: `info` holds the ones that are up, `error` the ones that are down,
         *     and `details` holds all of them. All three are always present, and all three are
         *     empty for `/health/live`, which has no dependencies to report on.
         */
        HealthReport: {
            /**
             * @description `ok` when every dependency answered, `error` when one did not — and
             *     `shutting_down` when the process has been told to stop, at which point it should
             *     neither be sent traffic nor be counted live.
             * @example ok
             * @enum {string}
             */
            status: "ok" | "error" | "shutting_down";
            /** @description The dependencies that answered. */
            info: components["schemas"]["DependencyStatuses"];
            /** @description The dependencies that did not, each with a reason. */
            error: components["schemas"]["DependencyStatuses"];
            /** @description Every dependency, whatever it reported. */
            details: components["schemas"]["DependencyStatuses"];
        };
        /**
         * DependencyStatuses
         * @description Dependencies, keyed by name. `/health/ready` reports two of them — `database` and
         *     `engine` — and the map is open because a dependency added later is a key added here
         *     rather than a new shape.
         * @example {
         *       "database": {
         *         "status": "up"
         *       },
         *       "engine": {
         *         "status": "up"
         *       }
         *     }
         */
        DependencyStatuses: {
            [key: string]: components["schemas"]["DependencyStatus"];
        };
        /**
         * DependencyStatus
         * @description What one dependency reported when it was asked.
         */
        DependencyStatus: {
            /**
             * @description Whether this dependency answered.
             * @example up
             * @enum {string}
             */
            status: "up" | "down";
            /**
             * @description Present when the status is `down`: what was attempted, and a classification of
             *     why it failed — `SELECT 1 failed (ECONNREFUSED)`, `GET /healthz responded 503`,
             *     `SELECT 1 timed out after 2000 ms`. Never a driver's own message; this route
             *     answers without authentication, and a driver names the host, the port and the
             *     role it could not reach with.
             * @example SELECT 1 failed (ECONNREFUSED)
             */
            message?: string;
        };
    };
    responses: never;
    parameters: {
        /**
         * @description The workspace's id — an `organization` row, and what `GET /api/v1/orgs` returns as
         *     `id`.
         *
         *     **Not a GitHub organisation.** The two words collide and the paths are what keep them
         *     apart: this is the workspace, and the GitHub organisations inside it are
         *     `/github-orgs/{login}` under it.
         *
         *     **Two shapes, because two things write the column.** A workspace created through
         *     `POST /api/auth/organization/create` — which is every workspace made since #714 — has
         *     a 32-character alphanumeric id, and the rows migrated out of the pre-BetterAuth
         *     tenancy tables have uuids. Treat it as an opaque string: match the pattern if you must
         *     validate, and never parse it as a uuid.
         * @example aBcD1234eFgH5678iJkL9012mNoP3456
         */
        OrgId: string;
        /**
         * @description The domain's id. It must belong to the workspace in the path.
         * @example 4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94
         */
        DomainId: string;
        /**
         * @description The GitHub organisation's login — the `NobuData` in github.com/NobuData, lower-cased.
         *     GitHub treats logins case-insensitively, so they are stored folded and one casing is
         *     the only one that resolves.
         * @example acme-robotics
         */
        OrgLogin: string;
        /**
         * @description The repository's name within its organisation, without the owner prefix — the
         *     `ouroboros` in NobuData/ouroboros, lower-cased.
         * @example helios-firmware
         */
        RepoName: string;
        /**
         * @description The provider's name, as BetterAuth knows it. `github` is the only one configured, so
         *     the callback github.com is registered against is `/api/auth/callback/github` — a
         *     string three places have to agree on, and only one of them is code
         *     (`GITHUB_CALLBACK_PATH` in `src/auth/auth.routes.ts`).
         * @example github
         */
        AuthProviderId: string;
        /**
         * @description The workspace this request is operating in — its slug or its uuid.
         *
         *     **An override, not the answer.** Since
         *     [#713](https://github.com/NobuData/ouroboros/issues/713) the workspace a request acts
         *     in is the session's active organization, which is server state: it is set through
         *     `/api/auth/organization/set-active`, it is stamped onto every new session, and no
         *     header can assert it. This header names a *different* workspace for one request —
         *     which is how a client acts outside the active one without changing it for every other
         *     request in flight. It is validated exactly as everything else is: a workspace the
         *     caller is not a member of is a `404`, the same answer one that does not exist gets.
         *
         *     On the operations that name a workspace in their path it is **optional and
         *     redundant**: the path is the more specific of the two, and a header that names a
         *     *different* workspace is a `422` with `code: "tenant_mismatch"` rather than a silent
         *     preference for either. It is accepted there so that one client can set it on every
         *     request, and it is how the operations that have no workspace in their path say which
         *     workspace they mean.
         *
         *     A caller who omits it is acting in their session's active organization. A session
         *     that has none — a person who belongs to no workspace, one whose workspace was
         *     deleted, one who was removed from it — gets a `400` with
         *     `code: "organization_required"` on any operation that names no workspace of its own.
         *     `GET /api/v1/dashboard` ([#70](https://github.com/NobuData/ouroboros/issues/70)) is
         *     the first such operation, and it is therefore the first that can answer that code: it
         *     is workspace-scoped and has no path to say so in, so this header is the only thing a
         *     client can override it with. `GET /api/v1/orgs` names no workspace either and does
         *     **not** take this header at all — *which workspaces are yours* is precisely the
         *     question somebody in that state is asking, and answering it must not require them to
         *     have already chosen one.
         *
         *     Nothing is inferred from how many workspaces somebody belongs to: the choice is made
         *     once, at sign-in or in the picker, and lives on the session.
         */
        TenantHeader: string;
        /**
         * @description How many rows to return. The ceiling is not a suggestion: without it, a `limit` of a
         *     million is a client's way of asking this service to hold a table in memory, and the
         *     request that does it is indistinguishable from a mistake in a loop.
         * @example 25
         */
        Limit: number;
        /**
         * @description How many rows to skip.
         * @example 0
         */
        Offset: number;
        /**
         * @description Which provider kind the correction being withdrawn applies to, or `*` for every kind.
         *
         *     Folded to lower case before the lookup, so `Anthropic` and `anthropic` address one
         *     row. The vocabulary is the adapter registry's — `anthropic`, `openai_compatible`,
         *     `ollama`, `copilot`, `cursor`, … — and is deliberately not enumerated here: the list
         *     grows, and a document that fixed it would refuse a price for a provider this product
         *     really supports.
         * @example anthropic
         */
        OverrideConnectionKind: string;
        /**
         * @description Which model the correction being withdrawn applies to, or `*` for every model of the
         *     kind.
         *
         *     Never folded: a model identifier is a name the vendor chose and some of them carry
         *     capitals. `*` is the only wildcard — a `*` inside an identifier is refused.
         * @example claude-fable-5
         */
        OverrideModelId: string;
        /**
         * @description The run — `runs.id`, a uuid minted by the database (V008). Anything that is not a
         *     uuid is a `422` naming the field, before anything is read.
         * @example 5eed0009-0000-4000-8000-000000000482
         */
        RunId: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    readHeartbeat: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The service is answering, and this is the build that answered. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "service": "ouroboros-rest",
                     *       "version": "0.7.0",
                     *       "status": "ok",
                     *       "uptimeSeconds": 3.885
                     *     }
                     */
                    "application/json": components["schemas"]["Heartbeat"];
                };
            };
        };
    };
    signInSocial: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SignInSocialRequest"];
            };
        };
        responses: {
            /**
             * @description The authorization URL to send the browser to. `redirect` is `true` unless the
             *     caller asked for none, in which case a `Location` header is also set.
             */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SignInSocialResponse"];
                };
            };
            /**
             * @description The provider is unknown or not configured. BetterAuth's error shape, not this
             *     API's envelope — the library answers its own routes.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthError"];
                };
            };
        };
    };
    signInCallback: {
        parameters: {
            query?: {
                /** @description The provider's authorization code. */
                code?: string;
                /** @description The value issued when the sign-in began, echoed back for checking. */
                state?: string;
            };
            header?: never;
            path: {
                /**
                 * @description The provider's name, as BetterAuth knows it. `github` is the only one configured, so
                 *     the callback github.com is registered against is `/api/auth/callback/github` — a
                 *     string three places have to agree on, and only one of them is code
                 *     (`GITHUB_CALLBACK_PATH` in `src/auth/auth.routes.ts`).
                 * @example github
                 */
                id: components["parameters"]["AuthProviderId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /**
             * @description Signed in, and back to the application. `Set-Cookie` carries the session token
             *     and its cache.
             */
            302: {
                headers: {
                    /** @description Where the browser is sent next — the application, or `/api/auth/error`. */
                    Location?: string;
                    /** @description `better-auth.session_token` and `better-auth.session_data`. */
                    "Set-Cookie"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    signInCallbackFormPost: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The provider's name, as BetterAuth knows it. `github` is the only one configured, so
                 *     the callback github.com is registered against is `/api/auth/callback/github` — a
                 *     string three places have to agree on, and only one of them is code
                 *     (`GITHUB_CALLBACK_PATH` in `src/auth/auth.routes.ts`).
                 * @example github
                 */
                id: components["parameters"]["AuthProviderId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description As the `GET` above. */
            302: {
                headers: {
                    Location?: string;
                    "Set-Cookie"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The session and its user, or `null` when the request carries neither. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthSessionOrNull"];
                };
            };
        };
    };
    getSessionPost: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description As the `GET` above. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthSessionOrNull"];
                };
            };
        };
    };
    authSignOut: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Signed out. The cookies are emptied with `Max-Age=0`. */
            200: {
                headers: {
                    /** @description `better-auth.session_token` and `better-auth.session_data`, emptied. */
                    "Set-Cookie"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SignOutResponse"];
                };
            };
        };
    };
    authOk: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The handler is mounted. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "ok": true
                     *     }
                     */
                    "application/json": components["schemas"]["AuthOk"];
                };
            };
        };
    };
    authError: {
        parameters: {
            query?: {
                /** @description The reason the flow failed, as the library names it. */
                error?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page naming the failure. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/html": string;
                };
            };
        };
    };
    listOrganizations: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The caller's organizations. Empty for somebody invited nowhere yet. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Organization"][];
                };
            };
            /** @description No session. BetterAuth's error shape, not this API's envelope. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthError"];
                };
            };
        };
    };
    createOrganization: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateOrganizationRequest"];
            };
        };
        responses: {
            /** @description The organization, with the caller's own membership row. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatedOrganization"];
                };
            };
            /** @description The slug is already taken, or the body did not validate. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthError"];
                };
            };
            /** @description No session. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthError"];
                };
            };
        };
    };
    setActiveOrganization: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetActiveOrganizationRequest"];
            };
        };
        responses: {
            /**
             * @description The organization now active, with its members and pending invitations — or
             *     `null` when the pointer was unset.
             */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FullOrganizationOrNull"];
                };
            };
            /** @description No such organization. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthError"];
                };
            };
            /**
             * @description The caller is not a member of it. The pointer is cleared on the way out, so a
             *     session cannot be left pointing somewhere it may not go.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthError"];
                };
            };
        };
    };
    getFullOrganization: {
        parameters: {
            query?: {
                /** @description Which organization. Defaults to the session's active one. */
                organizationId?: string;
                /** @description The same, by slug. Takes precedence over `organizationId`. */
                organizationSlug?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The organization, or `null` when there is no active one. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FullOrganizationOrNull"];
                };
            };
            /** @description No such organization. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthError"];
                };
            };
            /** @description The caller is not a member of it. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthError"];
                };
            };
        };
    };
    getActiveMemberRole: {
        parameters: {
            query?: {
                /** @description Which organization. Defaults to the session's active one. */
                organizationId?: string;
                /** @description The same, by slug. */
                organizationSlug?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The role the caller holds there. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemberRoleResponse"];
                };
            };
            /** @description No such organization, or no active one to default to. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthError"];
                };
            };
            /** @description The caller is not a member of it. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthError"];
                };
            };
        };
    };
    inviteOrganizationMember: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OrgInviteMemberRequest"];
            };
        };
        responses: {
            /** @description The invitation, pending. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Invitation"];
                };
            };
            /** @description The address is already a member, or the body did not validate. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthError"];
                };
            };
            /**
             * @description The caller's role does not carry `invitation: create` — `member` and `viewer`
             *     do not.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthError"];
                };
            };
        };
    };
    updateMemberRole: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateMemberRoleRequest"];
            };
        };
        responses: {
            /** @description The membership, as it now stands. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrganizationMember"];
                };
            };
            /** @description No such member, or the body did not validate. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthError"];
                };
            };
            /**
             * @description The caller's role does not carry `member: update` — `member` and `viewer` do
             *     not.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthError"];
                };
            };
        };
    };
    signOut: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /**
             * @description Signed out. `Set-Cookie` removes the session cookie and its cache. There is no
             *     body — there is nothing to say.
             */
            204: {
                headers: {
                    /**
                     * @description `better-auth.session_token` and `better-auth.session_data`, emptied, with
                     *     `Max-Age=0` — one header each.
                     */
                    "Set-Cookie"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately: the real diagnosis names a query, a host or a
             *     role, and it goes to the service log where only an operator reads it.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    discoverDomain: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DiscoverRequest"];
            };
        };
        responses: {
            /**
             * @description The answer. Identical in shape and in timing for a domain a workspace holds and
             *     one nothing does.
             */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "ssoAvailable": false,
                     *       "message": "Enterprise SSO is not configured yet — sign in with GitHub for now."
                     *     }
                     */
                    "application/json": components["schemas"]["DiscoverResponse"];
                };
            };
            /**
             * @description `validation_failed` — the value is not a domain name once the scheme, the path and
             *     the surrounding whitespace have been removed. `details` names the field, as it
             *     does for every other body in this API.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "code": "validation_failed",
                     *       "message": "The request is not valid. See `details` for each field.",
                     *       "details": {
                     *         "domain": [
                     *           "domain must be a company domain, such as acme.ouroboros.dev"
                     *         ]
                     *       }
                     *     }
                     */
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately: the real diagnosis names a query, a host or a
             *     role, and it goes to the service log where only an operator reads it.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    readEngineStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The engine answered. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "engine": "up",
                     *       "version": "0.3.0"
                     *     }
                     */
                    "application/json": components["schemas"]["EngineStatus"];
                };
            };
            /**
             * @description `unauthenticated` — this request carries no session, or one this service will
             *     not honour. The engine's own credential has nothing to do with this answer; see
             *     the `502` below.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately: the real diagnosis names a query, a host or a
             *     role, and it goes to the service log where only an operator reads it.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `engine_unavailable` — the engine could not serve this request. `details` is
             *     empty and the message names no address: everything that would go in them — the
             *     status the engine answered, the code the socket failed with, the URL that was
             *     called — is in this service's log instead.
             *
             *     A `502` rather than a `500`, because nothing in this service is broken and
             *     retrying is reasonable.
             */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "code": "engine_unavailable",
                     *       "message": "The engine is not available right now. Try again in a moment.",
                     *       "details": {}
                     *     }
                     */
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    readDashboard: {
        parameters: {
            query?: never;
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     **An override, not the answer.** Since
                 *     [#713](https://github.com/NobuData/ouroboros/issues/713) the workspace a request acts
                 *     in is the session's active organization, which is server state: it is set through
                 *     `/api/auth/organization/set-active`, it is stamped onto every new session, and no
                 *     header can assert it. This header names a *different* workspace for one request —
                 *     which is how a client acts outside the active one without changing it for every other
                 *     request in flight. It is validated exactly as everything else is: a workspace the
                 *     caller is not a member of is a `404`, the same answer one that does not exist gets.
                 *
                 *     On the operations that name a workspace in their path it is **optional and
                 *     redundant**: the path is the more specific of the two, and a header that names a
                 *     *different* workspace is a `422` with `code: "tenant_mismatch"` rather than a silent
                 *     preference for either. It is accepted there so that one client can set it on every
                 *     request, and it is how the operations that have no workspace in their path say which
                 *     workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     `GET /api/v1/dashboard` ([#70](https://github.com/NobuData/ouroboros/issues/70)) is
                 *     the first such operation, and it is therefore the first that can answer that code: it
                 *     is workspace-scoped and has no path to say so in, so this header is the only thing a
                 *     client can override it with. `GET /api/v1/orgs` names no workspace either and does
                 *     **not** take this header at all — *which workspaces are yours* is precisely the
                 *     question somebody in that state is asking, and answering it must not require them to
                 *     have already chosen one.
                 *
                 *     Nothing is inferred from how many workspaces somebody belongs to: the choice is made
                 *     once, at sign-in or in the picker, and lives on the session.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The dashboard, as of the moment the request was answered. */
            200: {
                headers: {
                    /**
                     * @description A strong entity tag for this payload. Send it back in `If-None-Match` on the
                     *     next poll.
                     * @example "9c1f0b7d4e2a86315f0c9d3b7a48e152"
                     */
                    ETag?: string;
                    /**
                     * @description `private, no-cache` — one workspace's operational numbers, which no shared
                     *     cache may store, and which a browser must revalidate rather than reuse.
                     * @example private, no-cache
                     */
                    "Cache-Control"?: string;
                    /**
                     * @description How many seconds the server currently wants you to wait before polling
                     *     again. Treat the latest value as the effective interval: it is how a
                     *     deployment under load slows every dashboard consumer within one poll
                     *     cycle, with no client change. Whole seconds, `15` by default.
                     * @example 15
                     */
                    "X-Ouro-Poll-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "stats": {
                     *         "loopsLive": {
                     *           "total": 3,
                     *           "byStatus": {
                     *             "coding": 1,
                     *             "building": 1,
                     *             "review": 1
                     *           }
                     *         },
                     *         "queued": {
                     *           "count": 12,
                     *           "estMinutes": 580
                     *         },
                     *         "merged7d": {
                     *           "count": 27,
                     *           "deltaVsPrior": 8
                     *         },
                     *         "tokensToday": {
                     *           "tokens": 4200000,
                     *           "costCents": 1860,
                     *           "providers": 4,
                     *           "unpricedEvents": 3
                     *         }
                     *       },
                     *       "pulse": {
                     *         "mergeRate": 0.92,
                     *         "avgCycleSeconds": 860,
                     *         "interventions7d": 2,
                     *         "autoMerge": true
                     *       },
                     *       "activeRuns": [
                     *         {
                     *           "id": "5eed0009-0000-4000-8000-000000000482",
                     *           "issueNumber": 482,
                     *           "issueTitle": "Fix flaky CAN-bus telemetry test",
                     *           "workflowTag": "standard-fix",
                     *           "model": "claude-fable-5",
                     *           "status": "coding",
                     *           "stageLabel": "Implementing",
                     *           "stageIndex": 4,
                     *           "stageTotal": 6,
                     *           "startedAt": "2026-08-13T14:25:01.000Z",
                     *           "finishedAt": null,
                     *           "prNumber": null,
                     *           "checksPassed": null,
                     *           "checksTotal": null
                     *         }
                     *       ],
                     *       "recentRuns": [
                     *         {
                     *           "id": "5eed0009-0000-4000-8000-000000000474",
                     *           "issueNumber": 474,
                     *           "issueTitle": "Debounce e-stop interrupt handler",
                     *           "workflowTag": "standard-fix",
                     *           "model": "claude-fable-5",
                     *           "status": "merged",
                     *           "stageLabel": "Merged",
                     *           "stageIndex": 6,
                     *           "stageTotal": 6,
                     *           "startedAt": "2026-08-13T13:44:41.000Z",
                     *           "finishedAt": "2026-08-13T13:55:41.000Z",
                     *           "prNumber": 512,
                     *           "checksPassed": 14,
                     *           "checksTotal": 14
                     *         }
                     *       ],
                     *       "queueHead": [
                     *         {
                     *           "id": "5eed000a-0000-4000-8000-000000000485",
                     *           "issueNumber": 485,
                     *           "issueTitle": "Watchdog reset on I²C bus lockup",
                     *           "effort": "m",
                     *           "workflowTag": "standard-fix",
                     *           "position": 1,
                     *           "estMinutes": 45,
                     *           "enqueuedAt": "2026-08-13T01:37:41.000Z"
                     *         },
                     *         {
                     *           "id": "5eed000a-0000-4000-8000-000000000496",
                     *           "issueNumber": 496,
                     *           "issueTitle": "Telemetry: split ingest into a worker pool",
                     *           "effort": "m",
                     *           "workflowTag": "feature-loop",
                     *           "position": 12,
                     *           "estMinutes": null,
                     *           "enqueuedAt": "2026-08-13T13:37:41.000Z"
                     *         }
                     *       ],
                     *       "activity": {
                     *         "inFlight": 3,
                     *         "queued": 12,
                     *         "mergedSinceMorning": 6
                     *       }
                     *     }
                     */
                    "application/json": components["schemas"]["Dashboard"];
                };
            };
            /**
             * @description Nothing has changed since the tag you sent. **No body**, deliberately: the
             *     representation you hold is the current one, and `ETag` on this answer is how you
             *     learn that rather than merely being refused.
             */
            304: {
                headers: {
                    /**
                     * @description The same tag, still current.
                     * @example "9c1f0b7d4e2a86315f0c9d3b7a48e152"
                     */
                    ETag?: string;
                    /**
                     * @description `private, no-cache`, as on the `200`.
                     * @example private, no-cache
                     */
                    "Cache-Control"?: string;
                    /**
                     * @description As on the `200`, and mattering more here: a server slowing its pollers
                     *     answers mostly `304`s, so the hint has to travel on the answer that costs
                     *     nothing or a backed-off client would never hear the new cadence.
                     * @example 15
                     */
                    "X-Ouro-Poll-After"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            /**
             * @description `organization_required` — this session is not acting in any workspace and this
             *     operation names none. Choose one through `/api/auth/organization/set-active`, or
             *     name one per request with `X-Ouro-Tenant`. It is what somebody whose workspace was
             *     deleted, or who was removed from it, is answered — and what the workspace picker
             *     is for.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `unauthenticated` — this request carries no session, or one this service will not
             *     honour. Sign in through `/api/auth/sign-in/social`.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `tenant_not_found` — the `X-Ouro-Tenant` header names no workspace, or none you
             *     are a member of. The two are deliberately one answer.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listRuns: {
        parameters: {
            query: {
                /** @description Which family — see the operation description for the two orders. */
                status: "active" | "terminal";
                /** @description Narrow to one repository, by `github_repos.id`. */
                repo?: string;
                /**
                 * @description How many rows to return. The ceiling is not a suggestion: without it, a `limit` of a
                 *     million is a client's way of asking this service to hold a table in memory, and the
                 *     request that does it is indistinguishable from a mistake in a loop.
                 * @example 25
                 */
                limit?: components["parameters"]["Limit"];
                /**
                 * @description How many rows to skip.
                 * @example 0
                 */
                offset?: components["parameters"]["Offset"];
            };
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     **An override, not the answer.** Since
                 *     [#713](https://github.com/NobuData/ouroboros/issues/713) the workspace a request acts
                 *     in is the session's active organization, which is server state: it is set through
                 *     `/api/auth/organization/set-active`, it is stamped onto every new session, and no
                 *     header can assert it. This header names a *different* workspace for one request —
                 *     which is how a client acts outside the active one without changing it for every other
                 *     request in flight. It is validated exactly as everything else is: a workspace the
                 *     caller is not a member of is a `404`, the same answer one that does not exist gets.
                 *
                 *     On the operations that name a workspace in their path it is **optional and
                 *     redundant**: the path is the more specific of the two, and a header that names a
                 *     *different* workspace is a `422` with `code: "tenant_mismatch"` rather than a silent
                 *     preference for either. It is accepted there so that one client can set it on every
                 *     request, and it is how the operations that have no workspace in their path say which
                 *     workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     `GET /api/v1/dashboard` ([#70](https://github.com/NobuData/ouroboros/issues/70)) is
                 *     the first such operation, and it is therefore the first that can answer that code: it
                 *     is workspace-scoped and has no path to say so in, so this header is the only thing a
                 *     client can override it with. `GET /api/v1/orgs` names no workspace either and does
                 *     **not** take this header at all — *which workspaces are yours* is precisely the
                 *     question somebody in that state is asking, and answering it must not require them to
                 *     have already chosen one.
                 *
                 *     Nothing is inferred from how many workspaces somebody belongs to: the choice is made
                 *     once, at sign-in or in the picker, and lives on the session.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /**
             * @description The page. A workspace with no runs in the family — or none in the repository the
             *     filter named — gets an empty one, which is a state to render and not a failure.
             */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [
                     *         {
                     *           "id": "5eed0009-0000-4000-8000-000000000482",
                     *           "issueNumber": 482,
                     *           "issueTitle": "Fix flaky CAN-bus telemetry test",
                     *           "workflowTag": "standard-fix",
                     *           "model": "claude-fable-5",
                     *           "status": "coding",
                     *           "stageLabel": "Implementing",
                     *           "stageIndex": 4,
                     *           "stageTotal": 6,
                     *           "startedAt": "2026-08-13T14:25:01.000Z",
                     *           "finishedAt": null,
                     *           "prNumber": null,
                     *           "checksPassed": null,
                     *           "checksTotal": null
                     *         }
                     *       ],
                     *       "total": 3,
                     *       "limit": 25,
                     *       "offset": 0
                     *     }
                     */
                    "application/json": components["schemas"]["RunPage"];
                };
            };
            /**
             * @description `organization_required` — this session is not acting in any workspace and this
             *     operation names none. Choose one through `/api/auth/organization/set-active`, or
             *     name one per request with `X-Ouro-Tenant`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `unauthenticated` — this request carries no session, or one this service will not
             *     honour. Sign in through `/api/auth/sign-in/social`.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `tenant_not_found` — the `X-Ouro-Tenant` header names no workspace, or none you
             *     are a member of. The two are deliberately one answer.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `validation_failed` — `status` missing or naming no family, `repo` not a uuid, or
             *     the window out of range. `details` carries one entry per field.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    readRun: {
        parameters: {
            query?: never;
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     **An override, not the answer.** Since
                 *     [#713](https://github.com/NobuData/ouroboros/issues/713) the workspace a request acts
                 *     in is the session's active organization, which is server state: it is set through
                 *     `/api/auth/organization/set-active`, it is stamped onto every new session, and no
                 *     header can assert it. This header names a *different* workspace for one request —
                 *     which is how a client acts outside the active one without changing it for every other
                 *     request in flight. It is validated exactly as everything else is: a workspace the
                 *     caller is not a member of is a `404`, the same answer one that does not exist gets.
                 *
                 *     On the operations that name a workspace in their path it is **optional and
                 *     redundant**: the path is the more specific of the two, and a header that names a
                 *     *different* workspace is a `422` with `code: "tenant_mismatch"` rather than a silent
                 *     preference for either. It is accepted there so that one client can set it on every
                 *     request, and it is how the operations that have no workspace in their path say which
                 *     workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     `GET /api/v1/dashboard` ([#70](https://github.com/NobuData/ouroboros/issues/70)) is
                 *     the first such operation, and it is therefore the first that can answer that code: it
                 *     is workspace-scoped and has no path to say so in, so this header is the only thing a
                 *     client can override it with. `GET /api/v1/orgs` names no workspace either and does
                 *     **not** take this header at all — *which workspaces are yours* is precisely the
                 *     question somebody in that state is asking, and answering it must not require them to
                 *     have already chosen one.
                 *
                 *     Nothing is inferred from how many workspaces somebody belongs to: the choice is made
                 *     once, at sign-in or in the picker, and lives on the session.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The run — `runs.id`, a uuid minted by the database (V008). Anything that is not a
                 *     uuid is a `422` naming the field, before anything is read.
                 * @example 5eed0009-0000-4000-8000-000000000482
                 */
                id: components["parameters"]["RunId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The run. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "5eed0009-0000-4000-8000-000000000482",
                     *       "issueNumber": 482,
                     *       "issueTitle": "Fix flaky CAN-bus telemetry test",
                     *       "workflowTag": "standard-fix",
                     *       "model": "claude-fable-5",
                     *       "status": "coding",
                     *       "stageLabel": "Implementing",
                     *       "stageIndex": 4,
                     *       "stageTotal": 6,
                     *       "startedAt": "2026-08-13T14:25:01.000Z",
                     *       "finishedAt": null,
                     *       "prNumber": null,
                     *       "checksPassed": null,
                     *       "checksTotal": null
                     *     }
                     */
                    "application/json": components["schemas"]["RunSummary"];
                };
            };
            /**
             * @description `organization_required` — this session is not acting in any workspace and this
             *     operation names none. Choose one through `/api/auth/organization/set-active`, or
             *     name one per request with `X-Ouro-Tenant`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `unauthenticated` — this request carries no session, or one this service will not
             *     honour. Sign in through `/api/auth/sign-in/social`.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `run_not_found` — no run with that id, **or none this caller may know about**:
             *     an id belonging to another workspace is the same answer, deliberately.
             *     `details.runId` echoes what was asked for. (`tenant_not_found` is the other
             *     `404` here, when `X-Ouro-Tenant` names a workspace you are not a member of.)
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "code": "run_not_found",
                     *       "message": "No such run.",
                     *       "details": {
                     *         "runId": "5eed0009-0000-4000-8000-000000000999"
                     *       }
                     *     }
                     */
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `validation_failed` — the id is not a uuid. Malformed is the caller's mistake,
             *     answered before anything is read; well-formed-but-absent is the `404` above.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listQueue: {
        parameters: {
            query?: {
                /** @description Narrow to one repository, by `github_repos.id`. */
                repo?: string;
                /**
                 * @description How many rows to return. The ceiling is not a suggestion: without it, a `limit` of a
                 *     million is a client's way of asking this service to hold a table in memory, and the
                 *     request that does it is indistinguishable from a mistake in a loop.
                 * @example 25
                 */
                limit?: components["parameters"]["Limit"];
                /**
                 * @description How many rows to skip.
                 * @example 0
                 */
                offset?: components["parameters"]["Offset"];
            };
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     **An override, not the answer.** Since
                 *     [#713](https://github.com/NobuData/ouroboros/issues/713) the workspace a request acts
                 *     in is the session's active organization, which is server state: it is set through
                 *     `/api/auth/organization/set-active`, it is stamped onto every new session, and no
                 *     header can assert it. This header names a *different* workspace for one request —
                 *     which is how a client acts outside the active one without changing it for every other
                 *     request in flight. It is validated exactly as everything else is: a workspace the
                 *     caller is not a member of is a `404`, the same answer one that does not exist gets.
                 *
                 *     On the operations that name a workspace in their path it is **optional and
                 *     redundant**: the path is the more specific of the two, and a header that names a
                 *     *different* workspace is a `422` with `code: "tenant_mismatch"` rather than a silent
                 *     preference for either. It is accepted there so that one client can set it on every
                 *     request, and it is how the operations that have no workspace in their path say which
                 *     workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     `GET /api/v1/dashboard` ([#70](https://github.com/NobuData/ouroboros/issues/70)) is
                 *     the first such operation, and it is therefore the first that can answer that code: it
                 *     is workspace-scoped and has no path to say so in, so this header is the only thing a
                 *     client can override it with. `GET /api/v1/orgs` names no workspace either and does
                 *     **not** take this header at all — *which workspaces are yours* is precisely the
                 *     question somebody in that state is asking, and answering it must not require them to
                 *     have already chosen one.
                 *
                 *     Nothing is inferred from how many workspaces somebody belongs to: the choice is made
                 *     once, at sign-in or in the picker, and lives on the session.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /**
             * @description The page. A workspace with nothing queued — or nothing in the repository the
             *     filter named — gets an empty one with zero totals, which is a state to render
             *     and not a failure.
             */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [
                     *         {
                     *           "id": "5eed000a-0000-4000-8000-000000000485",
                     *           "issueNumber": 485,
                     *           "issueTitle": "Watchdog reset on I²C bus lockup",
                     *           "effort": "m",
                     *           "workflowTag": "standard-fix",
                     *           "position": 1,
                     *           "estMinutes": 45,
                     *           "enqueuedAt": "2026-08-13T01:37:41.000Z"
                     *         },
                     *         {
                     *           "id": "5eed000a-0000-4000-8000-000000000486",
                     *           "issueNumber": 486,
                     *           "issueTitle": "Expose battery health over BLE GATT",
                     *           "effort": "l",
                     *           "workflowTag": "feature-loop",
                     *           "position": 2,
                     *           "estMinutes": 90,
                     *           "enqueuedAt": "2026-08-13T02:37:41.000Z"
                     *         }
                     *       ],
                     *       "total": 12,
                     *       "totalEstMinutes": 580,
                     *       "limit": 25,
                     *       "offset": 0
                     *     }
                     */
                    "application/json": components["schemas"]["QueuePage"];
                };
            };
            /**
             * @description `organization_required` — this session is not acting in any workspace and this
             *     operation names none. Choose one through `/api/auth/organization/set-active`, or
             *     name one per request with `X-Ouro-Tenant`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `unauthenticated` — this request carries no session, or one this service will not
             *     honour. Sign in through `/api/auth/sign-in/social`.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `tenant_not_found` — the `X-Ouro-Tenant` header names no workspace, or none you
             *     are a member of. The two are deliberately one answer.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `validation_failed` — `repo` not a uuid, or the window out of range. `details`
             *     carries one entry per field.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    readAutoMergeSetting: {
        parameters: {
            query?: never;
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     **An override, not the answer.** Since
                 *     [#713](https://github.com/NobuData/ouroboros/issues/713) the workspace a request acts
                 *     in is the session's active organization, which is server state: it is set through
                 *     `/api/auth/organization/set-active`, it is stamped onto every new session, and no
                 *     header can assert it. This header names a *different* workspace for one request —
                 *     which is how a client acts outside the active one without changing it for every other
                 *     request in flight. It is validated exactly as everything else is: a workspace the
                 *     caller is not a member of is a `404`, the same answer one that does not exist gets.
                 *
                 *     On the operations that name a workspace in their path it is **optional and
                 *     redundant**: the path is the more specific of the two, and a header that names a
                 *     *different* workspace is a `422` with `code: "tenant_mismatch"` rather than a silent
                 *     preference for either. It is accepted there so that one client can set it on every
                 *     request, and it is how the operations that have no workspace in their path say which
                 *     workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     `GET /api/v1/dashboard` ([#70](https://github.com/NobuData/ouroboros/issues/70)) is
                 *     the first such operation, and it is therefore the first that can answer that code: it
                 *     is workspace-scoped and has no path to say so in, so this header is the only thing a
                 *     client can override it with. `GET /api/v1/orgs` names no workspace either and does
                 *     **not** take this header at all — *which workspaces are yours* is precisely the
                 *     question somebody in that state is asking, and answering it must not require them to
                 *     have already chosen one.
                 *
                 *     Nothing is inferred from how many workspaces somebody belongs to: the choice is made
                 *     once, at sign-in or in the picker, and lives on the session.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /**
             * @description The setting. `enabled: false` with null stamps for a workspace that has never
             *     chosen — a state to render, not a failure.
             */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "enabled": true,
                     *       "updatedAt": "2026-08-13T09:00:00.000Z",
                     *       "updatedBy": "aBcD1234eFgH5678iJkL9012mNoP3456"
                     *     }
                     */
                    "application/json": components["schemas"]["AutoMergeSetting"];
                };
            };
            /**
             * @description `organization_required` — this session is not acting in any workspace and this
             *     operation names none. Choose one through `/api/auth/organization/set-active`, or
             *     name one per request with `X-Ouro-Tenant`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `unauthenticated` — this request carries no session, or one this service will not
             *     honour. Sign in through `/api/auth/sign-in/social`.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `tenant_not_found` — the `X-Ouro-Tenant` header names no workspace, or none you
             *     are a member of. The two are deliberately one answer.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchAutoMergeSetting: {
        parameters: {
            query?: never;
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     **An override, not the answer.** Since
                 *     [#713](https://github.com/NobuData/ouroboros/issues/713) the workspace a request acts
                 *     in is the session's active organization, which is server state: it is set through
                 *     `/api/auth/organization/set-active`, it is stamped onto every new session, and no
                 *     header can assert it. This header names a *different* workspace for one request —
                 *     which is how a client acts outside the active one without changing it for every other
                 *     request in flight. It is validated exactly as everything else is: a workspace the
                 *     caller is not a member of is a `404`, the same answer one that does not exist gets.
                 *
                 *     On the operations that name a workspace in their path it is **optional and
                 *     redundant**: the path is the more specific of the two, and a header that names a
                 *     *different* workspace is a `422` with `code: "tenant_mismatch"` rather than a silent
                 *     preference for either. It is accepted there so that one client can set it on every
                 *     request, and it is how the operations that have no workspace in their path say which
                 *     workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     `GET /api/v1/dashboard` ([#70](https://github.com/NobuData/ouroboros/issues/70)) is
                 *     the first such operation, and it is therefore the first that can answer that code: it
                 *     is workspace-scoped and has no path to say so in, so this header is the only thing a
                 *     client can override it with. `GET /api/v1/orgs` names no workspace either and does
                 *     **not** take this header at all — *which workspaces are yours* is precisely the
                 *     question somebody in that state is asking, and answering it must not require them to
                 *     have already chosen one.
                 *
                 *     Nothing is inferred from how many workspaces somebody belongs to: the choice is made
                 *     once, at sign-in or in the picker, and lives on the session.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "enabled": true
                 *     }
                 */
                "application/json": components["schemas"]["AutoMergeSettingPatch"];
            };
        };
        responses: {
            /** @description The setting after the change, attribution included. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "enabled": true,
                     *       "updatedAt": "2026-08-13T09:00:00.000Z",
                     *       "updatedBy": "aBcD1234eFgH5678iJkL9012mNoP3456"
                     *     }
                     */
                    "application/json": components["schemas"]["AutoMergeSetting"];
                };
            };
            /**
             * @description `organization_required` — this session is not acting in any workspace and this
             *     operation names none. Choose one through `/api/auth/organization/set-active`, or
             *     name one per request with `X-Ouro-Tenant`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `unauthenticated` — this request carries no session, or one this service will not
             *     honour. Sign in through `/api/auth/sign-in/social`.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `forbidden` — you are a member of this workspace and your role does not permit
             *     this. Administering a workspace is `owner` or `admin`; `member` and `viewer` may
             *     read it.
             *
             *     The one place this API answers `403` rather than `404`. Everywhere else, "you
             *     may not" would confirm that an identifier names something real — here the caller
             *     has already proved they are a member, so the workspace is no secret from them
             *     and their role is the only thing left to tell them. `details.role` is what they
             *     hold and `details.required` is what would have been enough.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `tenant_not_found` — the `X-Ouro-Tenant` header names no workspace, or none you
             *     are a member of. The two are deliberately one answer.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `validation_failed` — `enabled` was not a boolean. `details` carries the entry
             *     keyed by the field. A `"true"`, a `1` or a `null` is refused, not coerced,
             *     because a workspace's merge posture is nothing to flip by accident of type.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listPriceOverrides: {
        parameters: {
            query?: {
                /**
                 * @description How many rows to return. The ceiling is not a suggestion: without it, a `limit` of a
                 *     million is a client's way of asking this service to hold a table in memory, and the
                 *     request that does it is indistinguishable from a mistake in a loop.
                 * @example 25
                 */
                limit?: components["parameters"]["Limit"];
                /**
                 * @description How many rows to skip.
                 * @example 0
                 */
                offset?: components["parameters"]["Offset"];
            };
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     **An override, not the answer.** Since
                 *     [#713](https://github.com/NobuData/ouroboros/issues/713) the workspace a request acts
                 *     in is the session's active organization, which is server state: it is set through
                 *     `/api/auth/organization/set-active`, it is stamped onto every new session, and no
                 *     header can assert it. This header names a *different* workspace for one request —
                 *     which is how a client acts outside the active one without changing it for every other
                 *     request in flight. It is validated exactly as everything else is: a workspace the
                 *     caller is not a member of is a `404`, the same answer one that does not exist gets.
                 *
                 *     On the operations that name a workspace in their path it is **optional and
                 *     redundant**: the path is the more specific of the two, and a header that names a
                 *     *different* workspace is a `422` with `code: "tenant_mismatch"` rather than a silent
                 *     preference for either. It is accepted there so that one client can set it on every
                 *     request, and it is how the operations that have no workspace in their path say which
                 *     workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     `GET /api/v1/dashboard` ([#70](https://github.com/NobuData/ouroboros/issues/70)) is
                 *     the first such operation, and it is therefore the first that can answer that code: it
                 *     is workspace-scoped and has no path to say so in, so this header is the only thing a
                 *     client can override it with. `GET /api/v1/orgs` names no workspace either and does
                 *     **not** take this header at all — *which workspaces are yours* is precisely the
                 *     question somebody in that state is asking, and answering it must not require them to
                 *     have already chosen one.
                 *
                 *     Nothing is inferred from how many workspaces somebody belongs to: the choice is made
                 *     once, at sign-in or in the picker, and lives on the session.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /**
             * @description The page. Empty for a workspace that has corrected nothing — a state to render,
             *     not a failure.
             */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [
                     *         {
                     *           "connectionKind": "anthropic",
                     *           "modelId": "claude-fable-5",
                     *           "billingMode": "token",
                     *           "inputCentsPer1m": 1200,
                     *           "outputCentsPer1m": 6000,
                     *           "display": "$12 · $60",
                     *           "effectiveAt": "2026-08-22T09:00:00.000Z",
                     *           "updatedAt": "2026-08-22T09:00:00.000Z"
                     *         },
                     *         {
                     *           "connectionKind": "openai_compatible",
                     *           "modelId": "*",
                     *           "billingMode": "free",
                     *           "inputCentsPer1m": null,
                     *           "outputCentsPer1m": null,
                     *           "display": "$0",
                     *           "effectiveAt": "2026-08-22T09:04:11.220Z",
                     *           "updatedAt": "2026-08-22T09:04:11.220Z"
                     *         }
                     *       ],
                     *       "total": 2,
                     *       "limit": 25,
                     *       "offset": 0
                     *     }
                     */
                    "application/json": components["schemas"]["PriceOverridePage"];
                };
            };
            /**
             * @description `organization_required` — this session is not acting in any workspace and this
             *     operation names none. Choose one through `/api/auth/organization/set-active`, or
             *     name one per request with `X-Ouro-Tenant`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `unauthenticated` — this request carries no session, or one this service will not
             *     honour. Sign in through `/api/auth/sign-in/social`.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `tenant_not_found` — the `X-Ouro-Tenant` header names no workspace, or none you
             *     are a member of. The two are deliberately one answer.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `validation_failed` — `limit` or `offset` was out of range or not an integer.
             *     `details` carries the entry keyed by the field.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    putPriceOverride: {
        parameters: {
            query?: never;
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     **An override, not the answer.** Since
                 *     [#713](https://github.com/NobuData/ouroboros/issues/713) the workspace a request acts
                 *     in is the session's active organization, which is server state: it is set through
                 *     `/api/auth/organization/set-active`, it is stamped onto every new session, and no
                 *     header can assert it. This header names a *different* workspace for one request —
                 *     which is how a client acts outside the active one without changing it for every other
                 *     request in flight. It is validated exactly as everything else is: a workspace the
                 *     caller is not a member of is a `404`, the same answer one that does not exist gets.
                 *
                 *     On the operations that name a workspace in their path it is **optional and
                 *     redundant**: the path is the more specific of the two, and a header that names a
                 *     *different* workspace is a `422` with `code: "tenant_mismatch"` rather than a silent
                 *     preference for either. It is accepted there so that one client can set it on every
                 *     request, and it is how the operations that have no workspace in their path say which
                 *     workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     `GET /api/v1/dashboard` ([#70](https://github.com/NobuData/ouroboros/issues/70)) is
                 *     the first such operation, and it is therefore the first that can answer that code: it
                 *     is workspace-scoped and has no path to say so in, so this header is the only thing a
                 *     client can override it with. `GET /api/v1/orgs` names no workspace either and does
                 *     **not** take this header at all — *which workspaces are yours* is precisely the
                 *     question somebody in that state is asking, and answering it must not require them to
                 *     have already chosen one.
                 *
                 *     Nothing is inferred from how many workspaces somebody belongs to: the choice is made
                 *     once, at sign-in or in the picker, and lives on the session.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "connectionKind": "anthropic",
                 *       "modelId": "claude-fable-5",
                 *       "billingMode": "token",
                 *       "inputCentsPer1m": 1200,
                 *       "outputCentsPer1m": 6000
                 *     }
                 */
                "application/json": components["schemas"]["PriceOverrideWrite"];
            };
        };
        responses: {
            /** @description The correction as stored, with the cell it renders. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "connectionKind": "anthropic",
                     *       "modelId": "claude-fable-5",
                     *       "billingMode": "token",
                     *       "inputCentsPer1m": 1200,
                     *       "outputCentsPer1m": 6000,
                     *       "display": "$12 · $60",
                     *       "effectiveAt": "2026-08-22T09:00:00.000Z",
                     *       "updatedAt": "2026-08-22T09:00:00.000Z"
                     *     }
                     */
                    "application/json": components["schemas"]["PriceOverride"];
                };
            };
            /**
             * @description `organization_required` — this session is not acting in any workspace and this
             *     operation names none. Choose one through `/api/auth/organization/set-active`, or
             *     name one per request with `X-Ouro-Tenant`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `unauthenticated` — this request carries no session, or one this service will not
             *     honour. Sign in through `/api/auth/sign-in/social`.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `forbidden` — you are a member of this workspace and your role does not permit
             *     this. Recording a price is `owner` or `admin`; `member` and `viewer` may read the
             *     corrections and may not write one. `details.role` is what you hold and
             *     `details.required` is what would have been enough.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `tenant_not_found` — the `X-Ouro-Tenant` header names no workspace, or none you
             *     are a member of. The two are deliberately one answer.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `validation_failed` — the body was refused. `details` carries one entry per field,
             *     keyed by its name, so a form can render each message beside the input that
             *     produced it: a rate missing when `billingMode` is `token`, a rate present when it
             *     is `seat` or `usage`, a rate finer than four decimal places, a `modelId` carrying
             *     a `*` of its own, or a `token` price of zero in both directions.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deletePriceOverride: {
        parameters: {
            query: {
                /**
                 * @description Which provider kind the correction being withdrawn applies to, or `*` for every kind.
                 *
                 *     Folded to lower case before the lookup, so `Anthropic` and `anthropic` address one
                 *     row. The vocabulary is the adapter registry's — `anthropic`, `openai_compatible`,
                 *     `ollama`, `copilot`, `cursor`, … — and is deliberately not enumerated here: the list
                 *     grows, and a document that fixed it would refuse a price for a provider this product
                 *     really supports.
                 * @example anthropic
                 */
                connectionKind: components["parameters"]["OverrideConnectionKind"];
                /**
                 * @description Which model the correction being withdrawn applies to, or `*` for every model of the
                 *     kind.
                 *
                 *     Never folded: a model identifier is a name the vendor chose and some of them carry
                 *     capitals. `*` is the only wildcard — a `*` inside an identifier is refused.
                 * @example claude-fable-5
                 */
                modelId: components["parameters"]["OverrideModelId"];
            };
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     **An override, not the answer.** Since
                 *     [#713](https://github.com/NobuData/ouroboros/issues/713) the workspace a request acts
                 *     in is the session's active organization, which is server state: it is set through
                 *     `/api/auth/organization/set-active`, it is stamped onto every new session, and no
                 *     header can assert it. This header names a *different* workspace for one request —
                 *     which is how a client acts outside the active one without changing it for every other
                 *     request in flight. It is validated exactly as everything else is: a workspace the
                 *     caller is not a member of is a `404`, the same answer one that does not exist gets.
                 *
                 *     On the operations that name a workspace in their path it is **optional and
                 *     redundant**: the path is the more specific of the two, and a header that names a
                 *     *different* workspace is a `422` with `code: "tenant_mismatch"` rather than a silent
                 *     preference for either. It is accepted there so that one client can set it on every
                 *     request, and it is how the operations that have no workspace in their path say which
                 *     workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     `GET /api/v1/dashboard` ([#70](https://github.com/NobuData/ouroboros/issues/70)) is
                 *     the first such operation, and it is therefore the first that can answer that code: it
                 *     is workspace-scoped and has no path to say so in, so this header is the only thing a
                 *     client can override it with. `GET /api/v1/orgs` names no workspace either and does
                 *     **not** take this header at all — *which workspaces are yours* is precisely the
                 *     question somebody in that state is asking, and answering it must not require them to
                 *     have already chosen one.
                 *
                 *     Nothing is inferred from how many workspaces somebody belongs to: the choice is made
                 *     once, at sign-in or in the picker, and lives on the session.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /**
             * @description Gone. No body: what was removed is of no further use to the client that asked for
             *     it, and what the price is *now* is a different question with its own answer.
             */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /**
             * @description `organization_required` — this session is not acting in any workspace and this
             *     operation names none. Choose one through `/api/auth/organization/set-active`, or
             *     name one per request with `X-Ouro-Tenant`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `unauthenticated` — this request carries no session, or one this service will not
             *     honour. Sign in through `/api/auth/sign-in/social`.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `forbidden` — you are a member of this workspace and your role does not permit
             *     this. Withdrawing a price correction is `owner` or `admin`.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `price_override_not_found` — this workspace has no correction recorded for that
             *     model. `details` echoes the `connectionKind` (folded, as it was looked up) and the
             *     `modelId`, so a client that spelled the kind differently can see which spelling
             *     was searched for.
             *
             *     Or `tenant_not_found` — the `X-Ouro-Tenant` header names no workspace, or none you
             *     are a member of.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `validation_failed` — `connectionKind` or `modelId` was missing or malformed.
             *     `details` carries the entry keyed by the field.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    readPreferences: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The caller's preferences, defaults included. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "fontScale": "100"
                     *     }
                     */
                    "application/json": components["schemas"]["Preferences"];
                };
            };
            /**
             * @description `unauthenticated` — this request carries no session, or one this service will
             *     not honour. Preferences belong to somebody.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchPreferences: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "fontScale": "125"
                 *     }
                 */
                "application/json": components["schemas"]["PreferencesPatch"];
            };
        };
        responses: {
            /** @description The caller's preferences after the change. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "fontScale": "125"
                     *     }
                     */
                    "application/json": components["schemas"]["Preferences"];
                };
            };
            /**
             * @description `unauthenticated` — this request carries no session, or one this service will
             *     not honour. Preferences belong to somebody.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `validation_failed` — `fontScale` was not one of the five steps. `details`
             *     carries the entry keyed by the field, so a control can render the message
             *     beside itself. The five are the design system's (§ 4) and the database CHECK's
             *     alike; a respelling of a named step — `"100.0"` for `"100"` — is refused, not
             *     coerced, because the value is a label rather than a number.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listOrgs: {
        parameters: {
            query?: {
                /**
                 * @description How many rows to return. The ceiling is not a suggestion: without it, a `limit` of a
                 *     million is a client's way of asking this service to hold a table in memory, and the
                 *     request that does it is indistinguishable from a mistake in a loop.
                 * @example 25
                 */
                limit?: components["parameters"]["Limit"];
                /**
                 * @description How many rows to skip.
                 * @example 0
                 */
                offset?: components["parameters"]["Offset"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /**
             * @description The page. Somebody who belongs to nothing yet gets an empty one — the login
             *     screen's create-your-first-workspace state, and not a failure.
             */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [
                     *         {
                     *           "id": "5eed0001-0000-4000-8000-000000000001",
                     *           "slug": "acme-robotics",
                     *           "name": "Acme Robotics",
                     *           "monogram": "AR",
                     *           "personal": false,
                     *           "roles": [
                     *             "owner"
                     *           ],
                     *           "enabled": true,
                     *           "repoCounts": {
                     *             "enabled": 4,
                     *             "total": 4
                     *           },
                     *           "featuredRepo": "helios-firmware",
                     *           "githubOrgs": [
                     *             {
                     *               "login": "acme-robotics",
                     *               "enabled": true,
                     *               "repoCounts": {
                     *                 "enabled": 4,
                     *                 "total": 4
                     *               }
                     *             }
                     *           ],
                     *           "createdAt": "2026-08-11T10:20:23.114Z"
                     *         },
                     *         {
                     *           "id": "5eed0001-0000-4000-8000-000000000002",
                     *           "slug": "acme-labs",
                     *           "name": "Acme Labs",
                     *           "monogram": "AL",
                     *           "personal": false,
                     *           "roles": [
                     *             "member"
                     *           ],
                     *           "enabled": false,
                     *           "repoCounts": {
                     *             "enabled": 0,
                     *             "total": 0
                     *           },
                     *           "featuredRepo": null,
                     *           "githubOrgs": [
                     *             {
                     *               "login": "acme-labs",
                     *               "enabled": false,
                     *               "repoCounts": {
                     *                 "enabled": 0,
                     *                 "total": 0
                     *               }
                     *             }
                     *           ],
                     *           "createdAt": "2026-08-11T10:20:24.221Z"
                     *         },
                     *         {
                     *           "id": "5eed0001-0000-4000-8000-000000000003",
                     *           "slug": "kensuenobu",
                     *           "name": "Ken Suenobu",
                     *           "monogram": "KS",
                     *           "personal": true,
                     *           "roles": [
                     *             "owner"
                     *           ],
                     *           "enabled": true,
                     *           "repoCounts": {
                     *             "enabled": 2,
                     *             "total": 2
                     *           },
                     *           "featuredRepo": "dotfiles",
                     *           "githubOrgs": [
                     *             {
                     *               "login": "kensuenobu",
                     *               "enabled": true,
                     *               "repoCounts": {
                     *                 "enabled": 2,
                     *                 "total": 2
                     *               }
                     *             }
                     *           ],
                     *           "createdAt": "2026-08-11T10:20:25.007Z"
                     *         }
                     *       ],
                     *       "total": 3,
                     *       "limit": 25,
                     *       "offset": 0
                     *     }
                     */
                    "application/json": components["schemas"]["OrgRowPage"];
                };
            };
            /**
             * @description `unauthenticated` — this request carries no session, or one this service will
             *     not honour. Sign in through `/api/auth/sign-in/social`.
             *
             *     Every way a session can fail is this one answer: absent, expired, signed with a
             *     rotated key, forged, or naming a person who has since been deleted. A client
             *     cannot act differently on any of them, and distinguishing them would tell
             *     whoever is probing which part of their forgery was right.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `validation_failed` — a path parameter, a query parameter or a field of the body
             *     was refused. `details` carries one entry per field, keyed by its path, so a form
             *     can render each message beside the input that produced it.
             *
             *     Or `constraint_violated`, when the value was one this document's own rules admit
             *     and a `check` in the database does not. `details.constraint` names which. The two
             *     share a status because both mean the same thing to a client: the request was
             *     understood, and a different value can succeed.
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately: the real diagnosis names a query, a host or a
             *     role, and it goes to the service log where only an operator reads it.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listDomains: {
        parameters: {
            query?: {
                /**
                 * @description How many rows to return. The ceiling is not a suggestion: without it, a `limit` of a
                 *     million is a client's way of asking this service to hold a table in memory, and the
                 *     request that does it is indistinguishable from a mistake in a loop.
                 * @example 25
                 */
                limit?: components["parameters"]["Limit"];
                /**
                 * @description How many rows to skip.
                 * @example 0
                 */
                offset?: components["parameters"]["Offset"];
            };
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     **An override, not the answer.** Since
                 *     [#713](https://github.com/NobuData/ouroboros/issues/713) the workspace a request acts
                 *     in is the session's active organization, which is server state: it is set through
                 *     `/api/auth/organization/set-active`, it is stamped onto every new session, and no
                 *     header can assert it. This header names a *different* workspace for one request —
                 *     which is how a client acts outside the active one without changing it for every other
                 *     request in flight. It is validated exactly as everything else is: a workspace the
                 *     caller is not a member of is a `404`, the same answer one that does not exist gets.
                 *
                 *     On the operations that name a workspace in their path it is **optional and
                 *     redundant**: the path is the more specific of the two, and a header that names a
                 *     *different* workspace is a `422` with `code: "tenant_mismatch"` rather than a silent
                 *     preference for either. It is accepted there so that one client can set it on every
                 *     request, and it is how the operations that have no workspace in their path say which
                 *     workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     `GET /api/v1/dashboard` ([#70](https://github.com/NobuData/ouroboros/issues/70)) is
                 *     the first such operation, and it is therefore the first that can answer that code: it
                 *     is workspace-scoped and has no path to say so in, so this header is the only thing a
                 *     client can override it with. `GET /api/v1/orgs` names no workspace either and does
                 *     **not** take this header at all — *which workspaces are yours* is precisely the
                 *     question somebody in that state is asking, and answering it must not require them to
                 *     have already chosen one.
                 *
                 *     Nothing is inferred from how many workspaces somebody belongs to: the choice is made
                 *     once, at sign-in or in the picker, and lives on the session.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The workspace's id — an `organization` row, and what `GET /api/v1/orgs` returns as
                 *     `id`.
                 *
                 *     **Not a GitHub organisation.** The two words collide and the paths are what keep them
                 *     apart: this is the workspace, and the GitHub organisations inside it are
                 *     `/github-orgs/{login}` under it.
                 *
                 *     **Two shapes, because two things write the column.** A workspace created through
                 *     `POST /api/auth/organization/create` — which is every workspace made since #714 — has
                 *     a 32-character alphanumeric id, and the rows migrated out of the pre-BetterAuth
                 *     tenancy tables have uuids. Treat it as an opaque string: match the pattern if you must
                 *     validate, and never parse it as a uuid.
                 * @example aBcD1234eFgH5678iJkL9012mNoP3456
                 */
                orgId: components["parameters"]["OrgId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The page. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [
                     *         {
                     *           "id": "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
                     *           "orgId": "5eed0001-0000-4000-8000-000000000001",
                     *           "domain": "acme-robotics.dev",
                     *           "isPrimary": true,
                     *           "createdAt": "2026-08-11T10:20:23.114Z",
                     *           "updatedAt": "2026-08-11T10:20:23.114Z"
                     *         }
                     *       ],
                     *       "total": 1,
                     *       "limit": 25,
                     *       "offset": 0
                     *     }
                     */
                    "application/json": components["schemas"]["DomainPage"];
                };
            };
            /**
             * @description `unauthenticated` — this request carries no session, or one this service will
             *     not honour. Sign in through `/api/auth/sign-in/social`.
             *
             *     Every way a session can fail is this one answer: absent, expired, signed with a
             *     rotated key, forged, or naming a person who has since been deleted. A client
             *     cannot act differently on any of them, and distinguishing them would tell
             *     whoever is probing which part of their forgery was right.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `tenant_not_found` — no workspace has that id, or none you are a member of. The two are deliberately one answer. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `validation_failed` — a path parameter, a query parameter or a field of the body
             *     was refused. `details` carries one entry per field, keyed by its path, so a form
             *     can render each message beside the input that produced it.
             *
             *     Or `constraint_violated`, when the value was one this document's own rules admit
             *     and a `check` in the database does not. `details.constraint` names which. The two
             *     share a status because both mean the same thing to a client: the request was
             *     understood, and a different value can succeed.
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately: the real diagnosis names a query, a host or a
             *     role, and it goes to the service log where only an operator reads it.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    addDomain: {
        parameters: {
            query?: never;
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     **An override, not the answer.** Since
                 *     [#713](https://github.com/NobuData/ouroboros/issues/713) the workspace a request acts
                 *     in is the session's active organization, which is server state: it is set through
                 *     `/api/auth/organization/set-active`, it is stamped onto every new session, and no
                 *     header can assert it. This header names a *different* workspace for one request —
                 *     which is how a client acts outside the active one without changing it for every other
                 *     request in flight. It is validated exactly as everything else is: a workspace the
                 *     caller is not a member of is a `404`, the same answer one that does not exist gets.
                 *
                 *     On the operations that name a workspace in their path it is **optional and
                 *     redundant**: the path is the more specific of the two, and a header that names a
                 *     *different* workspace is a `422` with `code: "tenant_mismatch"` rather than a silent
                 *     preference for either. It is accepted there so that one client can set it on every
                 *     request, and it is how the operations that have no workspace in their path say which
                 *     workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     `GET /api/v1/dashboard` ([#70](https://github.com/NobuData/ouroboros/issues/70)) is
                 *     the first such operation, and it is therefore the first that can answer that code: it
                 *     is workspace-scoped and has no path to say so in, so this header is the only thing a
                 *     client can override it with. `GET /api/v1/orgs` names no workspace either and does
                 *     **not** take this header at all — *which workspaces are yours* is precisely the
                 *     question somebody in that state is asking, and answering it must not require them to
                 *     have already chosen one.
                 *
                 *     Nothing is inferred from how many workspaces somebody belongs to: the choice is made
                 *     once, at sign-in or in the picker, and lives on the session.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The workspace's id — an `organization` row, and what `GET /api/v1/orgs` returns as
                 *     `id`.
                 *
                 *     **Not a GitHub organisation.** The two words collide and the paths are what keep them
                 *     apart: this is the workspace, and the GitHub organisations inside it are
                 *     `/github-orgs/{login}` under it.
                 *
                 *     **Two shapes, because two things write the column.** A workspace created through
                 *     `POST /api/auth/organization/create` — which is every workspace made since #714 — has
                 *     a 32-character alphanumeric id, and the rows migrated out of the pre-BetterAuth
                 *     tenancy tables have uuids. Treat it as an opaque string: match the pattern if you must
                 *     validate, and never parse it as a uuid.
                 * @example aBcD1234eFgH5678iJkL9012mNoP3456
                 */
                orgId: components["parameters"]["OrgId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "domain": "acme-robotics.dev",
                 *       "isPrimary": true
                 *     }
                 */
                "application/json": components["schemas"]["CreateDomainRequest"];
            };
        };
        responses: {
            /** @description The domain, as it was stored. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
                     *       "orgId": "5eed0001-0000-4000-8000-000000000001",
                     *       "domain": "acme-robotics.dev",
                     *       "isPrimary": true,
                     *       "createdAt": "2026-08-11T10:20:23.114Z",
                     *       "updatedAt": "2026-08-11T10:20:23.114Z"
                     *     }
                     */
                    "application/json": components["schemas"]["Domain"];
                };
            };
            /**
             * @description `unauthenticated` — this request carries no session, or one this service will
             *     not honour. Sign in through `/api/auth/sign-in/social`.
             *
             *     Every way a session can fail is this one answer: absent, expired, signed with a
             *     rotated key, forged, or naming a person who has since been deleted. A client
             *     cannot act differently on any of them, and distinguishing them would tell
             *     whoever is probing which part of their forgery was right.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `forbidden` — you are a member of this workspace and your role does not permit
             *     this. Administering a workspace is `owner` or `admin`; `member` and `viewer` may
             *     read it.
             *
             *     The one place this API answers `403` rather than `404`. Everywhere else, "you
             *     may not" would confirm that an identifier names something real — here the caller
             *     has already proved they are a member, so the workspace is no secret from them
             *     and their role is the only thing left to tell them. `details.role` is what they
             *     hold and `details.required` is what would have been enough.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `tenant_not_found` — no workspace has that id, or none you are a member of. The two are deliberately one answer. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `domain_taken` — that domain belongs to another workspace. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `validation_failed` — a path parameter, a query parameter or a field of the body
             *     was refused. `details` carries one entry per field, keyed by its path, so a form
             *     can render each message beside the input that produced it.
             *
             *     Or `constraint_violated`, when the value was one this document's own rules admit
             *     and a `check` in the database does not. `details.constraint` names which. The two
             *     share a status because both mean the same thing to a client: the request was
             *     understood, and a different value can succeed.
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately: the real diagnosis names a query, a host or a
             *     role, and it goes to the service log where only an operator reads it.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    removeDomain: {
        parameters: {
            query?: never;
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     **An override, not the answer.** Since
                 *     [#713](https://github.com/NobuData/ouroboros/issues/713) the workspace a request acts
                 *     in is the session's active organization, which is server state: it is set through
                 *     `/api/auth/organization/set-active`, it is stamped onto every new session, and no
                 *     header can assert it. This header names a *different* workspace for one request —
                 *     which is how a client acts outside the active one without changing it for every other
                 *     request in flight. It is validated exactly as everything else is: a workspace the
                 *     caller is not a member of is a `404`, the same answer one that does not exist gets.
                 *
                 *     On the operations that name a workspace in their path it is **optional and
                 *     redundant**: the path is the more specific of the two, and a header that names a
                 *     *different* workspace is a `422` with `code: "tenant_mismatch"` rather than a silent
                 *     preference for either. It is accepted there so that one client can set it on every
                 *     request, and it is how the operations that have no workspace in their path say which
                 *     workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     `GET /api/v1/dashboard` ([#70](https://github.com/NobuData/ouroboros/issues/70)) is
                 *     the first such operation, and it is therefore the first that can answer that code: it
                 *     is workspace-scoped and has no path to say so in, so this header is the only thing a
                 *     client can override it with. `GET /api/v1/orgs` names no workspace either and does
                 *     **not** take this header at all — *which workspaces are yours* is precisely the
                 *     question somebody in that state is asking, and answering it must not require them to
                 *     have already chosen one.
                 *
                 *     Nothing is inferred from how many workspaces somebody belongs to: the choice is made
                 *     once, at sign-in or in the picker, and lives on the session.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The workspace's id — an `organization` row, and what `GET /api/v1/orgs` returns as
                 *     `id`.
                 *
                 *     **Not a GitHub organisation.** The two words collide and the paths are what keep them
                 *     apart: this is the workspace, and the GitHub organisations inside it are
                 *     `/github-orgs/{login}` under it.
                 *
                 *     **Two shapes, because two things write the column.** A workspace created through
                 *     `POST /api/auth/organization/create` — which is every workspace made since #714 — has
                 *     a 32-character alphanumeric id, and the rows migrated out of the pre-BetterAuth
                 *     tenancy tables have uuids. Treat it as an opaque string: match the pattern if you must
                 *     validate, and never parse it as a uuid.
                 * @example aBcD1234eFgH5678iJkL9012mNoP3456
                 */
                orgId: components["parameters"]["OrgId"];
                /**
                 * @description The domain's id. It must belong to the workspace in the path.
                 * @example 4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94
                 */
                domainId: components["parameters"]["DomainId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description It is gone. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /**
             * @description `unauthenticated` — this request carries no session, or one this service will
             *     not honour. Sign in through `/api/auth/sign-in/social`.
             *
             *     Every way a session can fail is this one answer: absent, expired, signed with a
             *     rotated key, forged, or naming a person who has since been deleted. A client
             *     cannot act differently on any of them, and distinguishing them would tell
             *     whoever is probing which part of their forgery was right.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `forbidden` — you are a member of this workspace and your role does not permit
             *     this. Administering a workspace is `owner` or `admin`; `member` and `viewer` may
             *     read it.
             *
             *     The one place this API answers `403` rather than `404`. Everywhere else, "you
             *     may not" would confirm that an identifier names something real — here the caller
             *     has already proved they are a member, so the workspace is no secret from them
             *     and their role is the only thing left to tell them. `details.role` is what they
             *     hold and `details.required` is what would have been enough.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `tenant_not_found` or `domain_not_found`. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `validation_failed` — a path parameter, a query parameter or a field of the body
             *     was refused. `details` carries one entry per field, keyed by its path, so a form
             *     can render each message beside the input that produced it.
             *
             *     Or `constraint_violated`, when the value was one this document's own rules admit
             *     and a `check` in the database does not. `details.constraint` names which. The two
             *     share a status because both mean the same thing to a client: the request was
             *     understood, and a different value can succeed.
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately: the real diagnosis names a query, a host or a
             *     role, and it goes to the service log where only an operator reads it.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    setPrimaryDomain: {
        parameters: {
            query?: never;
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     **An override, not the answer.** Since
                 *     [#713](https://github.com/NobuData/ouroboros/issues/713) the workspace a request acts
                 *     in is the session's active organization, which is server state: it is set through
                 *     `/api/auth/organization/set-active`, it is stamped onto every new session, and no
                 *     header can assert it. This header names a *different* workspace for one request —
                 *     which is how a client acts outside the active one without changing it for every other
                 *     request in flight. It is validated exactly as everything else is: a workspace the
                 *     caller is not a member of is a `404`, the same answer one that does not exist gets.
                 *
                 *     On the operations that name a workspace in their path it is **optional and
                 *     redundant**: the path is the more specific of the two, and a header that names a
                 *     *different* workspace is a `422` with `code: "tenant_mismatch"` rather than a silent
                 *     preference for either. It is accepted there so that one client can set it on every
                 *     request, and it is how the operations that have no workspace in their path say which
                 *     workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     `GET /api/v1/dashboard` ([#70](https://github.com/NobuData/ouroboros/issues/70)) is
                 *     the first such operation, and it is therefore the first that can answer that code: it
                 *     is workspace-scoped and has no path to say so in, so this header is the only thing a
                 *     client can override it with. `GET /api/v1/orgs` names no workspace either and does
                 *     **not** take this header at all — *which workspaces are yours* is precisely the
                 *     question somebody in that state is asking, and answering it must not require them to
                 *     have already chosen one.
                 *
                 *     Nothing is inferred from how many workspaces somebody belongs to: the choice is made
                 *     once, at sign-in or in the picker, and lives on the session.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The workspace's id — an `organization` row, and what `GET /api/v1/orgs` returns as
                 *     `id`.
                 *
                 *     **Not a GitHub organisation.** The two words collide and the paths are what keep them
                 *     apart: this is the workspace, and the GitHub organisations inside it are
                 *     `/github-orgs/{login}` under it.
                 *
                 *     **Two shapes, because two things write the column.** A workspace created through
                 *     `POST /api/auth/organization/create` — which is every workspace made since #714 — has
                 *     a 32-character alphanumeric id, and the rows migrated out of the pre-BetterAuth
                 *     tenancy tables have uuids. Treat it as an opaque string: match the pattern if you must
                 *     validate, and never parse it as a uuid.
                 * @example aBcD1234eFgH5678iJkL9012mNoP3456
                 */
                orgId: components["parameters"]["OrgId"];
                /**
                 * @description The domain's id. It must belong to the workspace in the path.
                 * @example 4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94
                 */
                domainId: components["parameters"]["DomainId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "isPrimary": true
                 *     }
                 */
                "application/json": components["schemas"]["UpdateDomainRequest"];
            };
        };
        responses: {
            /** @description The domain, after the change. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
                     *       "orgId": "5eed0001-0000-4000-8000-000000000001",
                     *       "domain": "acme-robotics.dev",
                     *       "isPrimary": true,
                     *       "createdAt": "2026-08-11T10:20:23.114Z",
                     *       "updatedAt": "2026-08-11T10:20:23.114Z"
                     *     }
                     */
                    "application/json": components["schemas"]["Domain"];
                };
            };
            /**
             * @description `unauthenticated` — this request carries no session, or one this service will
             *     not honour. Sign in through `/api/auth/sign-in/social`.
             *
             *     Every way a session can fail is this one answer: absent, expired, signed with a
             *     rotated key, forged, or naming a person who has since been deleted. A client
             *     cannot act differently on any of them, and distinguishing them would tell
             *     whoever is probing which part of their forgery was right.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `forbidden` — you are a member of this workspace and your role does not permit
             *     this. Administering a workspace is `owner` or `admin`; `member` and `viewer` may
             *     read it.
             *
             *     The one place this API answers `403` rather than `404`. Everywhere else, "you
             *     may not" would confirm that an identifier names something real — here the caller
             *     has already proved they are a member, so the workspace is no secret from them
             *     and their role is the only thing left to tell them. `details.role` is what they
             *     hold and `details.required` is what would have been enough.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `tenant_not_found` or `domain_not_found`. A domain belonging to another workspace answers exactly as one that does not exist. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `validation_failed` — a path parameter, a query parameter or a field of the body
             *     was refused. `details` carries one entry per field, keyed by its path, so a form
             *     can render each message beside the input that produced it.
             *
             *     Or `constraint_violated`, when the value was one this document's own rules admit
             *     and a `check` in the database does not. `details.constraint` names which. The two
             *     share a status because both mean the same thing to a client: the request was
             *     understood, and a different value can succeed.
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately: the real diagnosis names a query, a host or a
             *     role, and it goes to the service log where only an operator reads it.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listGithubOrgs: {
        parameters: {
            query?: {
                /**
                 * @description How many rows to return. The ceiling is not a suggestion: without it, a `limit` of a
                 *     million is a client's way of asking this service to hold a table in memory, and the
                 *     request that does it is indistinguishable from a mistake in a loop.
                 * @example 25
                 */
                limit?: components["parameters"]["Limit"];
                /**
                 * @description How many rows to skip.
                 * @example 0
                 */
                offset?: components["parameters"]["Offset"];
            };
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     **An override, not the answer.** Since
                 *     [#713](https://github.com/NobuData/ouroboros/issues/713) the workspace a request acts
                 *     in is the session's active organization, which is server state: it is set through
                 *     `/api/auth/organization/set-active`, it is stamped onto every new session, and no
                 *     header can assert it. This header names a *different* workspace for one request —
                 *     which is how a client acts outside the active one without changing it for every other
                 *     request in flight. It is validated exactly as everything else is: a workspace the
                 *     caller is not a member of is a `404`, the same answer one that does not exist gets.
                 *
                 *     On the operations that name a workspace in their path it is **optional and
                 *     redundant**: the path is the more specific of the two, and a header that names a
                 *     *different* workspace is a `422` with `code: "tenant_mismatch"` rather than a silent
                 *     preference for either. It is accepted there so that one client can set it on every
                 *     request, and it is how the operations that have no workspace in their path say which
                 *     workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     `GET /api/v1/dashboard` ([#70](https://github.com/NobuData/ouroboros/issues/70)) is
                 *     the first such operation, and it is therefore the first that can answer that code: it
                 *     is workspace-scoped and has no path to say so in, so this header is the only thing a
                 *     client can override it with. `GET /api/v1/orgs` names no workspace either and does
                 *     **not** take this header at all — *which workspaces are yours* is precisely the
                 *     question somebody in that state is asking, and answering it must not require them to
                 *     have already chosen one.
                 *
                 *     Nothing is inferred from how many workspaces somebody belongs to: the choice is made
                 *     once, at sign-in or in the picker, and lives on the session.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The workspace's id — an `organization` row, and what `GET /api/v1/orgs` returns as
                 *     `id`.
                 *
                 *     **Not a GitHub organisation.** The two words collide and the paths are what keep them
                 *     apart: this is the workspace, and the GitHub organisations inside it are
                 *     `/github-orgs/{login}` under it.
                 *
                 *     **Two shapes, because two things write the column.** A workspace created through
                 *     `POST /api/auth/organization/create` — which is every workspace made since #714 — has
                 *     a 32-character alphanumeric id, and the rows migrated out of the pre-BetterAuth
                 *     tenancy tables have uuids. Treat it as an opaque string: match the pattern if you must
                 *     validate, and never parse it as a uuid.
                 * @example aBcD1234eFgH5678iJkL9012mNoP3456
                 */
                orgId: components["parameters"]["OrgId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The page. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [
                     *         {
                     *           "id": "2e5f7a19-3b4c-4d6e-8f01-9a2b3c4d5e6f",
                     *           "orgId": "5eed0001-0000-4000-8000-000000000001",
                     *           "login": "acme-robotics",
                     *           "enabled": true,
                     *           "installedAt": null,
                     *           "createdAt": "2026-08-11T10:20:23.114Z",
                     *           "updatedAt": "2026-08-11T10:20:23.114Z"
                     *         }
                     *       ],
                     *       "total": 1,
                     *       "limit": 25,
                     *       "offset": 0
                     *     }
                     */
                    "application/json": components["schemas"]["GithubOrgPage"];
                };
            };
            /**
             * @description `unauthenticated` — this request carries no session, or one this service will
             *     not honour. Sign in through `/api/auth/sign-in/social`.
             *
             *     Every way a session can fail is this one answer: absent, expired, signed with a
             *     rotated key, forged, or naming a person who has since been deleted. A client
             *     cannot act differently on any of them, and distinguishing them would tell
             *     whoever is probing which part of their forgery was right.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `tenant_not_found` — no workspace has that id, or none you are a member of. The two are deliberately one answer. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `validation_failed` — a path parameter, a query parameter or a field of the body
             *     was refused. `details` carries one entry per field, keyed by its path, so a form
             *     can render each message beside the input that produced it.
             *
             *     Or `constraint_violated`, when the value was one this document's own rules admit
             *     and a `check` in the database does not. `details.constraint` names which. The two
             *     share a status because both mean the same thing to a client: the request was
             *     understood, and a different value can succeed.
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately: the real diagnosis names a query, a host or a
             *     role, and it goes to the service log where only an operator reads it.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    addGithubOrg: {
        parameters: {
            query?: never;
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     **An override, not the answer.** Since
                 *     [#713](https://github.com/NobuData/ouroboros/issues/713) the workspace a request acts
                 *     in is the session's active organization, which is server state: it is set through
                 *     `/api/auth/organization/set-active`, it is stamped onto every new session, and no
                 *     header can assert it. This header names a *different* workspace for one request —
                 *     which is how a client acts outside the active one without changing it for every other
                 *     request in flight. It is validated exactly as everything else is: a workspace the
                 *     caller is not a member of is a `404`, the same answer one that does not exist gets.
                 *
                 *     On the operations that name a workspace in their path it is **optional and
                 *     redundant**: the path is the more specific of the two, and a header that names a
                 *     *different* workspace is a `422` with `code: "tenant_mismatch"` rather than a silent
                 *     preference for either. It is accepted there so that one client can set it on every
                 *     request, and it is how the operations that have no workspace in their path say which
                 *     workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     `GET /api/v1/dashboard` ([#70](https://github.com/NobuData/ouroboros/issues/70)) is
                 *     the first such operation, and it is therefore the first that can answer that code: it
                 *     is workspace-scoped and has no path to say so in, so this header is the only thing a
                 *     client can override it with. `GET /api/v1/orgs` names no workspace either and does
                 *     **not** take this header at all — *which workspaces are yours* is precisely the
                 *     question somebody in that state is asking, and answering it must not require them to
                 *     have already chosen one.
                 *
                 *     Nothing is inferred from how many workspaces somebody belongs to: the choice is made
                 *     once, at sign-in or in the picker, and lives on the session.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The workspace's id — an `organization` row, and what `GET /api/v1/orgs` returns as
                 *     `id`.
                 *
                 *     **Not a GitHub organisation.** The two words collide and the paths are what keep them
                 *     apart: this is the workspace, and the GitHub organisations inside it are
                 *     `/github-orgs/{login}` under it.
                 *
                 *     **Two shapes, because two things write the column.** A workspace created through
                 *     `POST /api/auth/organization/create` — which is every workspace made since #714 — has
                 *     a 32-character alphanumeric id, and the rows migrated out of the pre-BetterAuth
                 *     tenancy tables have uuids. Treat it as an opaque string: match the pattern if you must
                 *     validate, and never parse it as a uuid.
                 * @example aBcD1234eFgH5678iJkL9012mNoP3456
                 */
                orgId: components["parameters"]["OrgId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "login": "acme-robotics",
                 *       "enabled": true
                 *     }
                 */
                "application/json": components["schemas"]["CreateGithubOrgRequest"];
            };
        };
        responses: {
            /** @description The organisation, as it was stored. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "2e5f7a19-3b4c-4d6e-8f01-9a2b3c4d5e6f",
                     *       "orgId": "5eed0001-0000-4000-8000-000000000001",
                     *       "login": "acme-robotics",
                     *       "enabled": true,
                     *       "installedAt": null,
                     *       "createdAt": "2026-08-11T10:20:23.114Z",
                     *       "updatedAt": "2026-08-11T10:20:23.114Z"
                     *     }
                     */
                    "application/json": components["schemas"]["GithubOrg"];
                };
            };
            /**
             * @description `unauthenticated` — this request carries no session, or one this service will
             *     not honour. Sign in through `/api/auth/sign-in/social`.
             *
             *     Every way a session can fail is this one answer: absent, expired, signed with a
             *     rotated key, forged, or naming a person who has since been deleted. A client
             *     cannot act differently on any of them, and distinguishing them would tell
             *     whoever is probing which part of their forgery was right.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `forbidden` — you are a member of this workspace and your role does not permit
             *     this. Administering a workspace is `owner` or `admin`; `member` and `viewer` may
             *     read it.
             *
             *     The one place this API answers `403` rather than `404`. Everywhere else, "you
             *     may not" would confirm that an identifier names something real — here the caller
             *     has already proved they are a member, so the workspace is no secret from them
             *     and their role is the only thing left to tell them. `details.role` is what they
             *     hold and `details.required` is what would have been enough.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `tenant_not_found` — no workspace has that id, or none you are a member of. The two are deliberately one answer. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `org_taken` — this workspace has already recorded that organisation. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `validation_failed` — a path parameter, a query parameter or a field of the body
             *     was refused. `details` carries one entry per field, keyed by its path, so a form
             *     can render each message beside the input that produced it.
             *
             *     Or `constraint_violated`, when the value was one this document's own rules admit
             *     and a `check` in the database does not. `details.constraint` names which. The two
             *     share a status because both mean the same thing to a client: the request was
             *     understood, and a different value can succeed.
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately: the real diagnosis names a query, a host or a
             *     role, and it goes to the service log where only an operator reads it.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    readGithubOrg: {
        parameters: {
            query?: never;
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     **An override, not the answer.** Since
                 *     [#713](https://github.com/NobuData/ouroboros/issues/713) the workspace a request acts
                 *     in is the session's active organization, which is server state: it is set through
                 *     `/api/auth/organization/set-active`, it is stamped onto every new session, and no
                 *     header can assert it. This header names a *different* workspace for one request —
                 *     which is how a client acts outside the active one without changing it for every other
                 *     request in flight. It is validated exactly as everything else is: a workspace the
                 *     caller is not a member of is a `404`, the same answer one that does not exist gets.
                 *
                 *     On the operations that name a workspace in their path it is **optional and
                 *     redundant**: the path is the more specific of the two, and a header that names a
                 *     *different* workspace is a `422` with `code: "tenant_mismatch"` rather than a silent
                 *     preference for either. It is accepted there so that one client can set it on every
                 *     request, and it is how the operations that have no workspace in their path say which
                 *     workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     `GET /api/v1/dashboard` ([#70](https://github.com/NobuData/ouroboros/issues/70)) is
                 *     the first such operation, and it is therefore the first that can answer that code: it
                 *     is workspace-scoped and has no path to say so in, so this header is the only thing a
                 *     client can override it with. `GET /api/v1/orgs` names no workspace either and does
                 *     **not** take this header at all — *which workspaces are yours* is precisely the
                 *     question somebody in that state is asking, and answering it must not require them to
                 *     have already chosen one.
                 *
                 *     Nothing is inferred from how many workspaces somebody belongs to: the choice is made
                 *     once, at sign-in or in the picker, and lives on the session.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The workspace's id — an `organization` row, and what `GET /api/v1/orgs` returns as
                 *     `id`.
                 *
                 *     **Not a GitHub organisation.** The two words collide and the paths are what keep them
                 *     apart: this is the workspace, and the GitHub organisations inside it are
                 *     `/github-orgs/{login}` under it.
                 *
                 *     **Two shapes, because two things write the column.** A workspace created through
                 *     `POST /api/auth/organization/create` — which is every workspace made since #714 — has
                 *     a 32-character alphanumeric id, and the rows migrated out of the pre-BetterAuth
                 *     tenancy tables have uuids. Treat it as an opaque string: match the pattern if you must
                 *     validate, and never parse it as a uuid.
                 * @example aBcD1234eFgH5678iJkL9012mNoP3456
                 */
                orgId: components["parameters"]["OrgId"];
                /**
                 * @description The GitHub organisation's login — the `NobuData` in github.com/NobuData, lower-cased.
                 *     GitHub treats logins case-insensitively, so they are stored folded and one casing is
                 *     the only one that resolves.
                 * @example acme-robotics
                 */
                login: components["parameters"]["OrgLogin"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The organisation. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "2e5f7a19-3b4c-4d6e-8f01-9a2b3c4d5e6f",
                     *       "orgId": "5eed0001-0000-4000-8000-000000000001",
                     *       "login": "acme-robotics",
                     *       "enabled": true,
                     *       "installedAt": null,
                     *       "createdAt": "2026-08-11T10:20:23.114Z",
                     *       "updatedAt": "2026-08-11T10:20:23.114Z"
                     *     }
                     */
                    "application/json": components["schemas"]["GithubOrg"];
                };
            };
            /**
             * @description `unauthenticated` — this request carries no session, or one this service will
             *     not honour. Sign in through `/api/auth/sign-in/social`.
             *
             *     Every way a session can fail is this one answer: absent, expired, signed with a
             *     rotated key, forged, or naming a person who has since been deleted. A client
             *     cannot act differently on any of them, and distinguishing them would tell
             *     whoever is probing which part of their forgery was right.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `tenant_not_found` or `org_not_found`. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `validation_failed` — a path parameter, a query parameter or a field of the body
             *     was refused. `details` carries one entry per field, keyed by its path, so a form
             *     can render each message beside the input that produced it.
             *
             *     Or `constraint_violated`, when the value was one this document's own rules admit
             *     and a `check` in the database does not. `details.constraint` names which. The two
             *     share a status because both mean the same thing to a client: the request was
             *     understood, and a different value can succeed.
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately: the real diagnosis names a query, a host or a
             *     role, and it goes to the service log where only an operator reads it.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    setGithubOrgEnabled: {
        parameters: {
            query?: never;
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     **An override, not the answer.** Since
                 *     [#713](https://github.com/NobuData/ouroboros/issues/713) the workspace a request acts
                 *     in is the session's active organization, which is server state: it is set through
                 *     `/api/auth/organization/set-active`, it is stamped onto every new session, and no
                 *     header can assert it. This header names a *different* workspace for one request —
                 *     which is how a client acts outside the active one without changing it for every other
                 *     request in flight. It is validated exactly as everything else is: a workspace the
                 *     caller is not a member of is a `404`, the same answer one that does not exist gets.
                 *
                 *     On the operations that name a workspace in their path it is **optional and
                 *     redundant**: the path is the more specific of the two, and a header that names a
                 *     *different* workspace is a `422` with `code: "tenant_mismatch"` rather than a silent
                 *     preference for either. It is accepted there so that one client can set it on every
                 *     request, and it is how the operations that have no workspace in their path say which
                 *     workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     `GET /api/v1/dashboard` ([#70](https://github.com/NobuData/ouroboros/issues/70)) is
                 *     the first such operation, and it is therefore the first that can answer that code: it
                 *     is workspace-scoped and has no path to say so in, so this header is the only thing a
                 *     client can override it with. `GET /api/v1/orgs` names no workspace either and does
                 *     **not** take this header at all — *which workspaces are yours* is precisely the
                 *     question somebody in that state is asking, and answering it must not require them to
                 *     have already chosen one.
                 *
                 *     Nothing is inferred from how many workspaces somebody belongs to: the choice is made
                 *     once, at sign-in or in the picker, and lives on the session.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The workspace's id — an `organization` row, and what `GET /api/v1/orgs` returns as
                 *     `id`.
                 *
                 *     **Not a GitHub organisation.** The two words collide and the paths are what keep them
                 *     apart: this is the workspace, and the GitHub organisations inside it are
                 *     `/github-orgs/{login}` under it.
                 *
                 *     **Two shapes, because two things write the column.** A workspace created through
                 *     `POST /api/auth/organization/create` — which is every workspace made since #714 — has
                 *     a 32-character alphanumeric id, and the rows migrated out of the pre-BetterAuth
                 *     tenancy tables have uuids. Treat it as an opaque string: match the pattern if you must
                 *     validate, and never parse it as a uuid.
                 * @example aBcD1234eFgH5678iJkL9012mNoP3456
                 */
                orgId: components["parameters"]["OrgId"];
                /**
                 * @description The GitHub organisation's login — the `NobuData` in github.com/NobuData, lower-cased.
                 *     GitHub treats logins case-insensitively, so they are stored folded and one casing is
                 *     the only one that resolves.
                 * @example acme-robotics
                 */
                login: components["parameters"]["OrgLogin"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "enabled": true
                 *     }
                 */
                "application/json": components["schemas"]["UpdateGithubOrgRequest"];
            };
        };
        responses: {
            /** @description The organisation, after the change. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "2e5f7a19-3b4c-4d6e-8f01-9a2b3c4d5e6f",
                     *       "orgId": "5eed0001-0000-4000-8000-000000000001",
                     *       "login": "acme-robotics",
                     *       "enabled": true,
                     *       "installedAt": null,
                     *       "createdAt": "2026-08-11T10:20:23.114Z",
                     *       "updatedAt": "2026-08-11T10:20:23.114Z"
                     *     }
                     */
                    "application/json": components["schemas"]["GithubOrg"];
                };
            };
            /**
             * @description `unauthenticated` — this request carries no session, or one this service will
             *     not honour. Sign in through `/api/auth/sign-in/social`.
             *
             *     Every way a session can fail is this one answer: absent, expired, signed with a
             *     rotated key, forged, or naming a person who has since been deleted. A client
             *     cannot act differently on any of them, and distinguishing them would tell
             *     whoever is probing which part of their forgery was right.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `forbidden` — you are a member of this workspace and your role does not permit
             *     this. Administering a workspace is `owner` or `admin`; `member` and `viewer` may
             *     read it.
             *
             *     The one place this API answers `403` rather than `404`. Everywhere else, "you
             *     may not" would confirm that an identifier names something real — here the caller
             *     has already proved they are a member, so the workspace is no secret from them
             *     and their role is the only thing left to tell them. `details.role` is what they
             *     hold and `details.required` is what would have been enough.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `tenant_not_found` or `org_not_found`. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `validation_failed` — a path parameter, a query parameter or a field of the body
             *     was refused. `details` carries one entry per field, keyed by its path, so a form
             *     can render each message beside the input that produced it.
             *
             *     Or `constraint_violated`, when the value was one this document's own rules admit
             *     and a `check` in the database does not. `details.constraint` names which. The two
             *     share a status because both mean the same thing to a client: the request was
             *     understood, and a different value can succeed.
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately: the real diagnosis names a query, a host or a
             *     role, and it goes to the service log where only an operator reads it.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listRepos: {
        parameters: {
            query?: {
                /**
                 * @description How many rows to return. The ceiling is not a suggestion: without it, a `limit` of a
                 *     million is a client's way of asking this service to hold a table in memory, and the
                 *     request that does it is indistinguishable from a mistake in a loop.
                 * @example 25
                 */
                limit?: components["parameters"]["Limit"];
                /**
                 * @description How many rows to skip.
                 * @example 0
                 */
                offset?: components["parameters"]["Offset"];
            };
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     **An override, not the answer.** Since
                 *     [#713](https://github.com/NobuData/ouroboros/issues/713) the workspace a request acts
                 *     in is the session's active organization, which is server state: it is set through
                 *     `/api/auth/organization/set-active`, it is stamped onto every new session, and no
                 *     header can assert it. This header names a *different* workspace for one request —
                 *     which is how a client acts outside the active one without changing it for every other
                 *     request in flight. It is validated exactly as everything else is: a workspace the
                 *     caller is not a member of is a `404`, the same answer one that does not exist gets.
                 *
                 *     On the operations that name a workspace in their path it is **optional and
                 *     redundant**: the path is the more specific of the two, and a header that names a
                 *     *different* workspace is a `422` with `code: "tenant_mismatch"` rather than a silent
                 *     preference for either. It is accepted there so that one client can set it on every
                 *     request, and it is how the operations that have no workspace in their path say which
                 *     workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     `GET /api/v1/dashboard` ([#70](https://github.com/NobuData/ouroboros/issues/70)) is
                 *     the first such operation, and it is therefore the first that can answer that code: it
                 *     is workspace-scoped and has no path to say so in, so this header is the only thing a
                 *     client can override it with. `GET /api/v1/orgs` names no workspace either and does
                 *     **not** take this header at all — *which workspaces are yours* is precisely the
                 *     question somebody in that state is asking, and answering it must not require them to
                 *     have already chosen one.
                 *
                 *     Nothing is inferred from how many workspaces somebody belongs to: the choice is made
                 *     once, at sign-in or in the picker, and lives on the session.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The workspace's id — an `organization` row, and what `GET /api/v1/orgs` returns as
                 *     `id`.
                 *
                 *     **Not a GitHub organisation.** The two words collide and the paths are what keep them
                 *     apart: this is the workspace, and the GitHub organisations inside it are
                 *     `/github-orgs/{login}` under it.
                 *
                 *     **Two shapes, because two things write the column.** A workspace created through
                 *     `POST /api/auth/organization/create` — which is every workspace made since #714 — has
                 *     a 32-character alphanumeric id, and the rows migrated out of the pre-BetterAuth
                 *     tenancy tables have uuids. Treat it as an opaque string: match the pattern if you must
                 *     validate, and never parse it as a uuid.
                 * @example aBcD1234eFgH5678iJkL9012mNoP3456
                 */
                orgId: components["parameters"]["OrgId"];
                /**
                 * @description The GitHub organisation's login — the `NobuData` in github.com/NobuData, lower-cased.
                 *     GitHub treats logins case-insensitively, so they are stored folded and one casing is
                 *     the only one that resolves.
                 * @example acme-robotics
                 */
                login: components["parameters"]["OrgLogin"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The page. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [
                     *         {
                     *           "id": "7a3d9c21-8e4f-4b5a-9c6d-0e1f2a3b4c5d",
                     *           "githubOrgId": "2e5f7a19-3b4c-4d6e-8f01-9a2b3c4d5e6f",
                     *           "name": "helios-firmware",
                     *           "enabled": true,
                     *           "defaultBranch": "main",
                     *           "createdAt": "2026-08-11T10:20:23.114Z",
                     *           "updatedAt": "2026-08-11T10:20:23.114Z"
                     *         }
                     *       ],
                     *       "total": 1,
                     *       "limit": 25,
                     *       "offset": 0
                     *     }
                     */
                    "application/json": components["schemas"]["RepoPage"];
                };
            };
            /**
             * @description `unauthenticated` — this request carries no session, or one this service will
             *     not honour. Sign in through `/api/auth/sign-in/social`.
             *
             *     Every way a session can fail is this one answer: absent, expired, signed with a
             *     rotated key, forged, or naming a person who has since been deleted. A client
             *     cannot act differently on any of them, and distinguishing them would tell
             *     whoever is probing which part of their forgery was right.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `tenant_not_found` or `org_not_found`. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `validation_failed` — a path parameter, a query parameter or a field of the body
             *     was refused. `details` carries one entry per field, keyed by its path, so a form
             *     can render each message beside the input that produced it.
             *
             *     Or `constraint_violated`, when the value was one this document's own rules admit
             *     and a `check` in the database does not. `details.constraint` names which. The two
             *     share a status because both mean the same thing to a client: the request was
             *     understood, and a different value can succeed.
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately: the real diagnosis names a query, a host or a
             *     role, and it goes to the service log where only an operator reads it.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    readRepo: {
        parameters: {
            query?: never;
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     **An override, not the answer.** Since
                 *     [#713](https://github.com/NobuData/ouroboros/issues/713) the workspace a request acts
                 *     in is the session's active organization, which is server state: it is set through
                 *     `/api/auth/organization/set-active`, it is stamped onto every new session, and no
                 *     header can assert it. This header names a *different* workspace for one request —
                 *     which is how a client acts outside the active one without changing it for every other
                 *     request in flight. It is validated exactly as everything else is: a workspace the
                 *     caller is not a member of is a `404`, the same answer one that does not exist gets.
                 *
                 *     On the operations that name a workspace in their path it is **optional and
                 *     redundant**: the path is the more specific of the two, and a header that names a
                 *     *different* workspace is a `422` with `code: "tenant_mismatch"` rather than a silent
                 *     preference for either. It is accepted there so that one client can set it on every
                 *     request, and it is how the operations that have no workspace in their path say which
                 *     workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     `GET /api/v1/dashboard` ([#70](https://github.com/NobuData/ouroboros/issues/70)) is
                 *     the first such operation, and it is therefore the first that can answer that code: it
                 *     is workspace-scoped and has no path to say so in, so this header is the only thing a
                 *     client can override it with. `GET /api/v1/orgs` names no workspace either and does
                 *     **not** take this header at all — *which workspaces are yours* is precisely the
                 *     question somebody in that state is asking, and answering it must not require them to
                 *     have already chosen one.
                 *
                 *     Nothing is inferred from how many workspaces somebody belongs to: the choice is made
                 *     once, at sign-in or in the picker, and lives on the session.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The workspace's id — an `organization` row, and what `GET /api/v1/orgs` returns as
                 *     `id`.
                 *
                 *     **Not a GitHub organisation.** The two words collide and the paths are what keep them
                 *     apart: this is the workspace, and the GitHub organisations inside it are
                 *     `/github-orgs/{login}` under it.
                 *
                 *     **Two shapes, because two things write the column.** A workspace created through
                 *     `POST /api/auth/organization/create` — which is every workspace made since #714 — has
                 *     a 32-character alphanumeric id, and the rows migrated out of the pre-BetterAuth
                 *     tenancy tables have uuids. Treat it as an opaque string: match the pattern if you must
                 *     validate, and never parse it as a uuid.
                 * @example aBcD1234eFgH5678iJkL9012mNoP3456
                 */
                orgId: components["parameters"]["OrgId"];
                /**
                 * @description The GitHub organisation's login — the `NobuData` in github.com/NobuData, lower-cased.
                 *     GitHub treats logins case-insensitively, so they are stored folded and one casing is
                 *     the only one that resolves.
                 * @example acme-robotics
                 */
                login: components["parameters"]["OrgLogin"];
                /**
                 * @description The repository's name within its organisation, without the owner prefix — the
                 *     `ouroboros` in NobuData/ouroboros, lower-cased.
                 * @example helios-firmware
                 */
                name: components["parameters"]["RepoName"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The repository. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "7a3d9c21-8e4f-4b5a-9c6d-0e1f2a3b4c5d",
                     *       "githubOrgId": "2e5f7a19-3b4c-4d6e-8f01-9a2b3c4d5e6f",
                     *       "name": "helios-firmware",
                     *       "enabled": true,
                     *       "defaultBranch": "main",
                     *       "createdAt": "2026-08-11T10:20:23.114Z",
                     *       "updatedAt": "2026-08-11T10:20:23.114Z"
                     *     }
                     */
                    "application/json": components["schemas"]["Repo"];
                };
            };
            /**
             * @description `unauthenticated` — this request carries no session, or one this service will
             *     not honour. Sign in through `/api/auth/sign-in/social`.
             *
             *     Every way a session can fail is this one answer: absent, expired, signed with a
             *     rotated key, forged, or naming a person who has since been deleted. A client
             *     cannot act differently on any of them, and distinguishing them would tell
             *     whoever is probing which part of their forgery was right.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `tenant_not_found`, `org_not_found`, or `repo_not_found` when nothing has recorded that repository. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `validation_failed` — a path parameter, a query parameter or a field of the body
             *     was refused. `details` carries one entry per field, keyed by its path, so a form
             *     can render each message beside the input that produced it.
             *
             *     Or `constraint_violated`, when the value was one this document's own rules admit
             *     and a `check` in the database does not. `details.constraint` names which. The two
             *     share a status because both mean the same thing to a client: the request was
             *     understood, and a different value can succeed.
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately: the real diagnosis names a query, a host or a
             *     role, and it goes to the service log where only an operator reads it.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    setRepoEnabled: {
        parameters: {
            query?: never;
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     **An override, not the answer.** Since
                 *     [#713](https://github.com/NobuData/ouroboros/issues/713) the workspace a request acts
                 *     in is the session's active organization, which is server state: it is set through
                 *     `/api/auth/organization/set-active`, it is stamped onto every new session, and no
                 *     header can assert it. This header names a *different* workspace for one request —
                 *     which is how a client acts outside the active one without changing it for every other
                 *     request in flight. It is validated exactly as everything else is: a workspace the
                 *     caller is not a member of is a `404`, the same answer one that does not exist gets.
                 *
                 *     On the operations that name a workspace in their path it is **optional and
                 *     redundant**: the path is the more specific of the two, and a header that names a
                 *     *different* workspace is a `422` with `code: "tenant_mismatch"` rather than a silent
                 *     preference for either. It is accepted there so that one client can set it on every
                 *     request, and it is how the operations that have no workspace in their path say which
                 *     workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     `GET /api/v1/dashboard` ([#70](https://github.com/NobuData/ouroboros/issues/70)) is
                 *     the first such operation, and it is therefore the first that can answer that code: it
                 *     is workspace-scoped and has no path to say so in, so this header is the only thing a
                 *     client can override it with. `GET /api/v1/orgs` names no workspace either and does
                 *     **not** take this header at all — *which workspaces are yours* is precisely the
                 *     question somebody in that state is asking, and answering it must not require them to
                 *     have already chosen one.
                 *
                 *     Nothing is inferred from how many workspaces somebody belongs to: the choice is made
                 *     once, at sign-in or in the picker, and lives on the session.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The workspace's id — an `organization` row, and what `GET /api/v1/orgs` returns as
                 *     `id`.
                 *
                 *     **Not a GitHub organisation.** The two words collide and the paths are what keep them
                 *     apart: this is the workspace, and the GitHub organisations inside it are
                 *     `/github-orgs/{login}` under it.
                 *
                 *     **Two shapes, because two things write the column.** A workspace created through
                 *     `POST /api/auth/organization/create` — which is every workspace made since #714 — has
                 *     a 32-character alphanumeric id, and the rows migrated out of the pre-BetterAuth
                 *     tenancy tables have uuids. Treat it as an opaque string: match the pattern if you must
                 *     validate, and never parse it as a uuid.
                 * @example aBcD1234eFgH5678iJkL9012mNoP3456
                 */
                orgId: components["parameters"]["OrgId"];
                /**
                 * @description The GitHub organisation's login — the `NobuData` in github.com/NobuData, lower-cased.
                 *     GitHub treats logins case-insensitively, so they are stored folded and one casing is
                 *     the only one that resolves.
                 * @example acme-robotics
                 */
                login: components["parameters"]["OrgLogin"];
                /**
                 * @description The repository's name within its organisation, without the owner prefix — the
                 *     `ouroboros` in NobuData/ouroboros, lower-cased.
                 * @example helios-firmware
                 */
                name: components["parameters"]["RepoName"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "enabled": true,
                 *       "defaultBranch": "main"
                 *     }
                 */
                "application/json": components["schemas"]["UpdateRepoRequest"];
            };
        };
        responses: {
            /** @description The repository, after the change — created if it was not there before. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "7a3d9c21-8e4f-4b5a-9c6d-0e1f2a3b4c5d",
                     *       "githubOrgId": "2e5f7a19-3b4c-4d6e-8f01-9a2b3c4d5e6f",
                     *       "name": "helios-firmware",
                     *       "enabled": true,
                     *       "defaultBranch": "main",
                     *       "createdAt": "2026-08-11T10:20:23.114Z",
                     *       "updatedAt": "2026-08-11T10:20:23.114Z"
                     *     }
                     */
                    "application/json": components["schemas"]["Repo"];
                };
            };
            /**
             * @description `unauthenticated` — this request carries no session, or one this service will
             *     not honour. Sign in through `/api/auth/sign-in/social`.
             *
             *     Every way a session can fail is this one answer: absent, expired, signed with a
             *     rotated key, forged, or naming a person who has since been deleted. A client
             *     cannot act differently on any of them, and distinguishing them would tell
             *     whoever is probing which part of their forgery was right.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `forbidden` — you are a member of this workspace and your role does not permit
             *     this. Administering a workspace is `owner` or `admin`; `member` and `viewer` may
             *     read it.
             *
             *     The one place this API answers `403` rather than `404`. Everywhere else, "you
             *     may not" would confirm that an identifier names something real — here the caller
             *     has already proved they are a member, so the workspace is no secret from them
             *     and their role is the only thing left to tell them. `details.role` is what they
             *     hold and `details.required` is what would have been enough.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `tenant_not_found` or `org_not_found`. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `validation_failed` — a path parameter, a query parameter or a field of the body
             *     was refused. `details` carries one entry per field, keyed by its path, so a form
             *     can render each message beside the input that produced it.
             *
             *     Or `constraint_violated`, when the value was one this document's own rules admit
             *     and a `check` in the database does not. `details.constraint` names which. The two
             *     share a status because both mean the same thing to a client: the request was
             *     understood, and a different value can succeed.
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `internal_error` — the service itself failed. The message is a constant and
             *     `details` is empty, deliberately: the real diagnosis names a query, a host or a
             *     role, and it goes to the service log where only an operator reads it.
             */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    readLiveness: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The process is up. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "status": "ok",
                     *       "info": {},
                     *       "error": {},
                     *       "details": {}
                     *     }
                     */
                    "application/json": components["schemas"]["HealthReport"];
                };
            };
        };
    };
    readReadiness: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Every dependency answered. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "status": "ok",
                     *       "info": {
                     *         "database": {
                     *           "status": "up"
                     *         },
                     *         "engine": {
                     *           "status": "up"
                     *         }
                     *       },
                     *       "error": {},
                     *       "details": {
                     *         "database": {
                     *           "status": "up"
                     *         },
                     *         "engine": {
                     *           "status": "up"
                     *         }
                     *       }
                     *     }
                     */
                    "application/json": components["schemas"]["HealthReport"];
                };
            };
            /**
             * @description At least one dependency did not answer. `error` names which, and `details` still
             *     reports the ones that did.
             */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "status": "error",
                     *       "info": {
                     *         "engine": {
                     *           "status": "up"
                     *         }
                     *       },
                     *       "error": {
                     *         "database": {
                     *           "status": "down",
                     *           "message": "SELECT 1 failed (ECONNREFUSED)"
                     *         }
                     *       },
                     *       "details": {
                     *         "engine": {
                     *           "status": "up"
                     *         },
                     *         "database": {
                     *           "status": "down",
                     *           "message": "SELECT 1 failed (ECONNREFUSED)"
                     *         }
                     *       }
                     *     }
                     */
                    "application/json": components["schemas"]["HealthReport"];
                };
            };
        };
    };
}
