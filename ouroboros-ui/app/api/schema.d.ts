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
    "/api/v1/registry/param-schema": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * What one model can be tuned with
         * @description The schema mockup 21's alias inspector renders its parameter fields from
         *     ([#585](https://github.com/NobuData/ouroboros/issues/585)), and the same schema every
         *     write to that alias's parameters is validated against.
         *
         *     **The fields are generated from what the bound model actually supports, and that is the
         *     point of the endpoint.** A thinking budget on `qwen3-coder:32b` is a control somebody
         *     fills in, a value the server stores and a chip the table renders — and nothing at all at
         *     the other end. So the provider adapter says which tunables a model has, and this is
         *     where it says it. A client renders `params.fields` in order and needs no knowledge of
         *     any provider: a new adapter brings its own parameters without a change here or in the
         *     UI.
         *
         *     **Four sources shape the answer, in this precedence:**
         *
         *     | Source | What it is | May it override? |
         *     |---|---|---|
         *     | `adapter` | what this build's provider adapter says about the model | — |
         *     | `discovery` | what the provider reported into its discovered catalog | tightens a bound |
         *     | `catalog` | the bundled price catalog's metadata ([#580](https://github.com/NobuData/ouroboros/issues/580)) | **fills an absent bound only** |
         *     | `registry` | what this workspace's own columns will store | clamps, last |
         *
         *     Every field carries `x-ouroboros-sources` naming the ones that shaped it, and the
         *     response repeats the union in `sources`. The catalog is a vendored snapshot of an
         *     upstream file and can go stale, so it may fill a bound nothing else knows and may never
         *     contradict one — which is why a reader can tell a live bound from a catalogued one
         *     rather than having to distrust both.
         *
         *     **`connection` is optional, and omitting it is a question rather than a mistake.** An
         *     alias created ahead of its key — mockup 21's `gpt5-experiments` — has a model and no
         *     provider, so there is no adapter to ask. The answer is then an empty `params` schema
         *     whose `description` says why, `reason: alias_unbound`, and the registry restrictions in
         *     full: those are what *this workspace* allows the alias to be used for, which is true
         *     whether or not anything is on the other end of it. Nothing is invented for such an
         *     alias — no capability is guessed from a catalog.
         *
         *     `reason` is also non-null in two other honest cases: `provider_has_no_parameters` for a
         *     fixed catalog such as Copilot or Cursor, which publish no per-call parameters this
         *     product can set; and `provider_unsupported` for a connection whose kind this build has
         *     no adapter for. Neither is an error — each is a form that explains itself.
         *
         *     **Any member may read it**, viewers included: a parameter schema describes a model
         *     rather than a workspace's data, and names no credential, no spend and no alias. What it
         *     *validates* is role-gated where that happens, on the alias writes.
         *
         *     **The workspace is the session's**, as everywhere in `/api/v1`: no workspace in this
         *     path, the session's active organization or `X-Ouro-Tenant` decides, and membership is
         *     checked before the operation runs.
         */
        get: operations["getModelParamSchema"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/registry/aliases": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The allowed-models table
         * @description Every model alias this workspace has — mockup 21's *ALLOWED MODELS* table and the
         *     inspector's whole state ([#584](https://github.com/NobuData/ouroboros/issues/584)):
         *     the switch, the binding, both documents, the note, and **everything that references
         *     the alias**. The `Used by` column is that list counted and the inspector's chips are it
         *     listed, read from one definition so the two cannot disagree (decision **R5**) — and a
         *     `409` on delete names the same rows.
         *
         *     **Unbound aliases are in the list**, with `connection: null` and `enabled: false`. An
         *     alias created ahead of its key is a row mockup 21 draws (*no key — connect a
         *     provider*), not an absence.
         *
         *     **This is the registry's read; routing keeps its own.** `GET /api/v1/routing/aliases`
         *     answers the swap menus with each alias's current resolution and stays for that page;
         *     this answers the registry page with the row itself.
         *
         *     **Unpaged**, for the same reason as routing's list: a workspace's registry is a handful
         *     of names, and a page over a list that short would cost a client a second request to
         *     discover there was nothing more.
         *
         *     **Any member may read it.**
         */
        get: operations["listModelAliases"];
        put?: never;
        /**
         * Create an alias — bound, or unbound
         * @description Mockup 21's **+ New alias**, in either of its two modes
         *     ([#584](https://github.com/NobuData/ouroboros/issues/584)).
         *
         *     **Bound** — `connectionId` names a provider connection in this workspace and
         *     `modelId` a model on it. The model is checked against what discovery (AC.6) has
         *     reported on the connection; a model it has not reported is **saved anyway**, with a
         *     `model_not_discovered` warning in the answer rather than a refusal — discovery is not
         *     yet universal, and a hard reference would refuse configurations that are valid during
         *     the gap. `params` and `restrictions` are validated against the bound model's
         *     capability schema (CH.2, the same schema `GET /registry/param-schema` renders the
         *     inspector from) and refused by field. `enabled` defaults to on.
         *
         *     **Unbound** — no `connectionId` (or `null`): a name created ahead of its key, mockup
         *     21's `gpt5-experiments`. Stored with `enabled: false` **whatever the body said**,
         *     because an unbound alias can never be switched on, and the answer carries an
         *     `alias_unbound` warning whose `fix` is where to go — Providers & keys. Every param is
         *     refused for an unbound alias, since nothing knows what the model supports;
         *     restrictions are registry policy and are accepted.
         *
         *     **Names are unique per workspace**, and a taken one is a designed `422` — never a
         *     unique-violation leak.
         *
         *     **Every write leaves exactly one revision record**, and `revisionId` names it.
         *
         *     **`owner` or `admin`.**
         */
        post: operations["createModelAlias"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/registry/aliases/model-options": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The models a connection has, for the inspector's select
         * @description Mockup 21's model select, *listed live from the provider*
         *     ([#584](https://github.com/NobuData/ouroboros/issues/584)): the rows discovery (AC.6)
         *     has reported on one connection, each with what it reported — the id an alias's
         *     `modelId` would be set to, the display name, and the metadata the param schema is
         *     narrowed by.
         *
         *     **Empty when discovery has not run**, which is an honest empty select rather than a
         *     failure: an alias may still be created on the connection by typing the model, and the
         *     create answers with a `model_not_discovered` warning.
         *
         *     **Any member may read it.**
         */
        get: operations["listModelOptions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/registry/aliases/{id}": {
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
         * Remove an alias
         * @description Mockup 21's **Remove** ([#584](https://github.com/NobuData/ouroboros/issues/584)) —
         *     and the caption beside it: *"Deleting one is blocked while any route or workflow
         *     references it."*
         *
         *     The referrer list is read **inside the delete's own transaction, under a lock** on the
         *     alias (CG.3's `alias_reference_guard()`), so the list a `409` names is still true when
         *     the delete would have run — a route save that would add a reference waits behind this
         *     request rather than slipping in between the check and the delete.
         *
         *     `204`, and no body: there is nothing to say about a row that no longer exists. The
         *     revision record survives it, with the alias's name and no longer its id.
         *
         *     **`owner` or `admin`.**
         */
        delete: operations["deleteModelAlias"];
        options?: never;
        head?: never;
        /**
         * Save alias — edit, rebind, rename, or switch
         * @description Mockup 21's **Save alias**, its **On** switch, a rename in the name field, and the
         *     rebind that is the product's central claim
         *     ([#584](https://github.com/NobuData/ouroboros/issues/584)). Only the fields present
         *     are written; the row after the write is checked whole, diffed against the row before
         *     it, and written whole.
         *
         *     **Rebind is one row and touches nothing else.** *Point coder-max at Bedrock tomorrow;
         *     zero workflow or route edits.* A new `connectionId` and/or `modelId` writes the
         *     binding and nothing in any route, rule or workflow — those hold the alias by id or by
         *     name, both of which stand still. The stored params are re-validated against the
         *     **new** model (CH.2), discovery is asked again, and `nextResolution` states what the
         *     next resolution through the alias will now reach.
         *
         *     **Enabling an unbound alias is refused** with `model_alias_unbound` and the pointer to
         *     Providers & keys — never a raw constraint error. Unbinding an enabled alias
         *     (`connectionId: null`) switches it off, with an `alias_unbound` warning saying so.
         *
         *     **Switching a referenced alias off succeeds**, and `droppedHops` names every referrer:
         *     the hops the next resolution will drop, with a stated reason (CH.6's semantics), so the
         *     UI can warn before it happens.
         *
         *     **Rename is delete-shaped** (decision **R5**). Workflow documents hold the alias by
         *     name, so renaming a referenced alias breaks them exactly as deleting it would: refused
         *     with `model_alias_rename_blocked` naming every referrer and its kind. An unreferenced
         *     alias renames freely, to any name that is not taken.
         *
         *     **A body that changes nothing is a `200` with `revisionId: null`** — nothing was
         *     written and nothing was recorded. Otherwise every write leaves exactly one revision.
         *
         *     **`owner` or `admin`.**
         */
        patch: operations["updateModelAlias"];
        trace?: never;
    };
    "/api/v1/registry/aliases/{id}/duplicate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Duplicate an alias
         * @description Mockup 21's **Duplicate** ([#584](https://github.com/NobuData/ouroboros/issues/584))
         *     — the *same model, different keys* story: `coder-max` (prod key, $600 cap) beside
         *     `coder-max-dev` (dev key, $50 cap) starts as a copy.
         *
         *     The copy is named `<alias>-copy`, or `<alias>-copy-2`, `-copy-3` … when that is
         *     taken. Binding, params, restrictions and notes are copied; **`enabled` is not** — the
         *     copy is switched off, so a duplicate never starts taking traffic before it has been
         *     edited into what it is for. Its revision records the alias it was copied from.
         *
         *     `201`, and the copy is what is answered.
         *
         *     **`owner` or `admin`.**
         */
        post: operations["duplicateModelAlias"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/routing": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The routing matrix, the chains behind it, and the escalation rules
         * @description Everything mockup 06 draws below the health strip
         *     ([#195](https://github.com/NobuData/ouroboros/issues/195)) — the eight-row matrix, each
         *     row's route and ordered chain with every hop resolved to an alias, a model and a
         *     provider, the inspector's policy triple, and the **escalation rules** card beside it.
         *
         *     **One request rather than one per card**, because they are one screen: the matrix's
         *     escalation column and the rules card render the same rows, and two requests would let
         *     them disagree for as long as one of them was in flight.
         *
         *     **A task kind may have no route**, and it arrives as a row with `route: null`. That is a
         *     state the schema permits on purpose — a matrix row with an empty cell — and hiding it
         *     would hide a kind the workspace has.
         *
         *     **A hop whose alias is unbound keeps its place**, with `provider: null`. An alias created
         *     ahead of its key is a first-class row in the model registry, and a chain that lost a hop
         *     that way would arrive shorter than the operator configured it.
         *
         *     **`stats` is measured, or it is two nulls**
         *     ([#198](https://github.com/NobuData/ouroboros/issues/198)). Roadmap decision **M7**: a
         *     figure the product cannot compute is a figure it does not print, and `0` is not
         *     *unknown* — it is a number. A kind nothing has been spent on renders the em-dash.
         *
         *     **`spend` is the card under the matrix**, in this payload rather than behind a second
         *     request. The matrix's `$/run avg` and the card's totals are aggregates over the same
         *     ledger rows over the same thirty days; fetched apart they would be aggregates over
         *     those rows *at two instants*, which is a page that can show a call in one figure and
         *     not the other. `GET /api/v1/routing/spend` serves the identical object for a client
         *     that wants the card alone.
         *
         *     **Any member may read it**, viewers included.
         *
         *     **The workspace is the session's**, as everywhere in `/api/v1`: no workspace in this
         *     path, the session's active organization or `X-Ouro-Tenant` decides, and membership is
         *     checked before the operation runs.
         */
        get: operations["readRoutingMatrix"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/routing/aliases": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The model aliases a route may name
         * @description The registry list the matrix's swap menus are built from
         *     ([#195](https://github.com/NobuData/ouroboros/issues/195)) — every alias this workspace
         *     has, with the model and provider it currently resolves to, so a menu can preview what a
         *     swap would mean before anybody presses **Save routes**.
         *
         *     **A read, and only a read.** Creating, editing and retiring an alias is the model
         *     registry's surface (mockup 21); routing needs the names it is allowed to point at.
         *
         *     **Unbound aliases are in the list**, with `provider: null`. An alias created ahead of its
         *     key is a real row, and hiding it would make it unreachable from the surface that would
         *     bind a route to it — the hop it produces is dropped at resolution time, with a stated
         *     reason, which is a different and more honest failure than a name that cannot be chosen.
         *
         *     **Unpaged.** A workspace's registry is the handful of aliases its routes name, and a page
         *     over a list that short would cost a client a second request to discover there was
         *     nothing more.
         *
         *     **Any member may read it.**
         */
        get: operations["listRoutingAliases"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/routing/spend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Spend by provider over the trailing thirty days, and the local-token share
         * @description Mockup 06's **Spend by provider · 30d** card, on its own
         *     ([#198](https://github.com/NobuData/ouroboros/issues/198)) — the metered rows, the
         *     *"Local models served 31% of all tokens"* footnote, and the window all of it was
         *     measured over.
         *
         *     **The identical object `GET /api/v1/routing` carries under `spend`**, from the same
         *     computation and the same short-TTL cache. It is published separately for a surface that
         *     wants the card without the matrix — the full spend report
         *     ([#210](https://github.com/NobuData/ouroboros/issues/210)) — because a report that
         *     re-aggregated the ledger for itself would be a second opinion about one invoice.
         *
         *     **Every figure is an aggregate, and nothing is coalesced.** Roadmap decision **M7**:
         *     `$/run`, p50 and spend are computed from the token-spend ledger, and a figure the
         *     product cannot compute is one it does not print. A provider whose calls nobody has
         *     priced answers `spendCents: null` and renders as **unpriced**; a provider whose calls
         *     were priced at nothing answers `spendCents: 0` and renders `$0.00`. Those are different
         *     facts and the payload never merges them.
         *
         *     **The window is rolling.** *30d* is `now − 30 × 24h`, not the calendar month, so the
         *     card reads the same way on the 1st as on the 28th. It is served with the figures.
         *
         *     **Any member may read it**, viewers included: what a workspace spends on models is
         *     something everybody in it may look at.
         *
         *     **The workspace is the session's**, as everywhere in `/api/v1`: no workspace in this
         *     path, the session's active organization or `X-Ouro-Tenant` decides, and membership is
         *     checked before the operation runs. No other workspace's usage can reach a total here.
         */
        get: operations["readRoutingSpend"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/routing/routes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Save routes — commit a batch of edits
         * @description One press of mockup 06's **Save routes**
         *     ([#195](https://github.com/NobuData/ouroboros/issues/195)).
         *
         *     The page's editing model is **staged, not live**: drag a chain into order, swap an alias,
         *     set a floor and a cap — all client-side — then commit the whole matrix in one request.
         *     `200` rather than `201`, because nothing is created; routes exist, and this is what they
         *     now say.
         *
         *     **The batch is atomic, and every refusal is decided before anything is written.** A body
         *     naming an alias this workspace does not have, or a floor deeper than the chain sent with
         *     it, is a `422` — and the other routes in the same batch are untouched, so a corrected
         *     batch can simply be re-sent rather than reconciled.
         *
         *     **Errors map back to their route.** `details.routes` is keyed by task kind, so a client
         *     that sent eight routes and got one wrong knows which row of the matrix to mark:
         *     `{"docs": {"floorHopIndex": ["…"]}}`.
         *
         *     **The chain is the array you send.** There are no positions in the request: hop order is
         *     array order, and the server numbers them densely from 1. A hop names an **alias** and
         *     never a raw model id.
         *
         *     **`null` means off.** The three policy fields are required, and `floorHopIndex: null` is
         *     *no floor* while `maxCostCentsPerRun: null` is *no cap*. A `PUT` has no
         *     leave-this-alone case, so omitting a policy is a malformed body rather than a way to
         *     keep the value it had.
         *
         *     **Each save that changes something writes a revision** — who, when, and a diff of
         *     exactly what moved — and answers with its id. A save that changes nothing writes none
         *     and answers `revisionId: null`; an audit trail of button presses that moved nothing is
         *     one nobody reads to the end.
         *
         *     **`owner` or `admin`.** A member reads the matrix and cannot write it, refused by the
         *     server rather than by a hidden control.
         */
        put: operations["saveRoutes"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/routing/routes/{taskKind}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Save one route
         * @description The same operation as **Save routes**, addressed at one row of the matrix
         *     ([#195](https://github.com/NobuData/ouroboros/issues/195)) — a batch of one, with the
         *     same validation, the same atomicity, and the same revision.
         *
         *     The body is a route without its task kind, which comes from the path. A body that also
         *     carried one is refused rather than resolved in the path's favour: addressing one route
         *     and editing another is not a request this API guesses at.
         *
         *     Everything the batch operation's description says applies here — the array *is* the
         *     chain, `null` means off, and the answer carries the revision and the route as re-read.
         *
         *     **`owner` or `admin`.**
         */
        put: operations["saveRoute"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/routing/rules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Add an escalation rule
         * @description The **+ Add rule** control on mockup 06's escalation-rules card
         *     ([#195](https://github.com/NobuData/ouroboros/issues/195)).
         *
         *     **A rule is structure, not a sentence.** `when` is a predicate — at least one of
         *     `effort_gte`, `label` and `diff_kind`, ANDed — and `then` is exactly one of three route
         *     modifications: `use_alias`, `add_vote`, `route_local`. Free text would be unenforceable;
         *     the switch would toggle, the line would grey out, and routing would behave identically.
         *
         *     **`display` is derived and cannot be sent.** The sentence the card renders is generated
         *     from the structure by the database, so it can never drift from what the rule does. A
         *     body carrying one is a `422 validation_failed` naming the field, not a value this
         *     service quietly discards.
         *
         *     **`sortOrder` is where it evaluates**, 1 first. Omit it and the rule is **appended** —
         *     one past the highest this workspace holds — because a new rule that silently claimed the
         *     first position would change what every existing rule does. A position another rule
         *     already holds is a `409`.
         *
         *     **`enabled` defaults to on**: the only reason to write a rule is to have it apply, and
         *     the switch exists to suspend one without deleting it.
         *
         *     **`owner` or `admin`.**
         */
        post: operations["addEscalationRule"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/routing/rules/{id}": {
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
         * Remove an escalation rule
         * @description Delete a rule outright ([#195](https://github.com/NobuData/ouroboros/issues/195)).
         *
         *     `204`, and no body: there is nothing to say about a row that no longer exists, and a
         *     `200` carrying the deleted resource invites a client to keep using it.
         *
         *     **This is not the switch.** `PATCH {"enabled": false}` suspends a rule and keeps its
         *     place in the order and the sentence the card greys out; this is for a rule that was a
         *     mistake.
         *
         *     **`owner` or `admin`.**
         */
        delete: operations["removeEscalationRule"];
        options?: never;
        head?: never;
        /**
         * Change an escalation rule
         * @description The switch on a rule row, its place in the evaluation order, or the rule itself
         *     ([#195](https://github.com/NobuData/ouroboros/issues/195)).
         *
         *     A `PATCH` rather than a `PUT` because the card's affordance is a **switch**: turning one
         *     off should not require resending a predicate and an action the client has no intention
         *     of changing, nor risk rewriting them from a stale copy. An empty body changes nothing
         *     and answers the rule as it stands.
         *
         *     **`when` and `then` are replaced whole.** There is no patching *inside* a predicate — a
         *     condition removed and a condition never sent would be the same request — and neither
         *     admits `null`, because a rule has no clearable parts.
         *
         *     **The sentence regenerates.** Change either half and `display` is re-derived, so an
         *     edited rule cannot keep the sentence it used to have. It still cannot be sent.
         *
         *     **Switching off is not deleting.** A disabled rule keeps its `sortOrder` and its
         *     sentence, so switching it back on restores it exactly where it was.
         *
         *     **`owner` or `admin`.**
         */
        patch: operations["changeEscalationRule"];
        trace?: never;
    };
    "/api/v1/routing/simulate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Simulate routing — resolve a task kind against a context, and say why
         * @description Mockup 06's **Simulate routing**
         *     ([#197](https://github.com/NobuData/ouroboros/issues/197)) — ask what would run, and be
         *     told what would run *and why*.
         *
         *     **This is the resolution function, not a preview of it.** The endpoint calls the same
         *     `ResolutionService` an execution bridge will call, and returns what it answered
         *     unchanged. That is the whole point of the operation: a simulator that re-implemented
         *     routing would be a second answer to *which model runs this*, and the two would disagree
         *     the first time either was edited. What the panel shows is what execution does.
         *
         *     **`ctx` is what is known about the work, and nothing else can be known.** An escalation
         *     rule's predicate is closed over three conditions — `effort_gte`, `label`, `diff_kind` —
         *     so a context carrying a fourth fact would be carrying something no rule could ever read,
         *     and it is refused rather than ignored. `repo` is accepted and read by nothing yet;
         *     per-repository overrides are
         *     [#211](https://github.com/NobuData/ouroboros/issues/211).
         *
         *     **An absent fact is *unknown*, never *small*.** A context with no `effort` has not told
         *     this service the work is tiny; it has told it nothing, and a rule reading `effort_gte:
         *     "l"` does not fire on it. Simulating with no `ctx` at all is a legitimate question — it
         *     is what `route.task("docs")` looks like before anything has been sized — and it means
         *     *no escalation rule fires*.
         *
         *     **`fail_run` is a `200`.** Every provider down, a chain filtered to nothing, the floor
         *     breached: those are *answers*, carrying an `outcome`, a `failure.code` and a sentence,
         *     because the caller asked a well-formed question about a route that exists and is
         *     entitled to know what the route did. The only `4xx` this operation has of its own is
         *     `404 route_not_found`, for the one case with no chain to explain.
         *
         *     **Dropped hops stay in the chain.** The array is every hop in the order the executor
         *     would try them, each `kept` or `dropped` with a stable `code` and a sentence — because
         *     the inspector draws hop 2 struck through with a reason beside it, and it can only do
         *     that if the hop is still there. The chain an executor walks is the `kept` ones, and that
         *     filter is deliberately the client's.
         *
         *     **Sentences are rendered verbatim.** Every `explanation` is composed server-side, once,
         *     so the inspector and this panel cannot print two different accounts of one decision.
         *     Branch on `code`, which is stable; never on wording, which improves.
         *
         *     **`POST` for a read.** Nothing is created — hence `200` — but a context is a nested
         *     document with an array in it, and `?ctx[labels][]=security` is a shape every client
         *     library spells differently.
         *
         *     **Any member may simulate**, viewers included: looking at which model would answer a
         *     piece of work changes nothing. **The workspace is the session's**, as everywhere in
         *     `/api/v1` — there is no workspace in this path and none in the body.
         */
        post: operations["simulateRouting"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/routing/providers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * This workspace's providers, and what is honestly known about each
         * @description The chips mockup 06 draws above the routing matrix
         *     ([#196](https://github.com/NobuData/ouroboros/issues/196)) — one per provider
         *     connection, ordered by name so they do not reshuffle between polls.
         *
         *     **Every field is what a check found, or `null`.** `latencyMs` is present only where a
         *     check measured one, `models` only where a check counted them, and neither has a
         *     fallback — see the `routing` tag for why `0ms` is the one answer this endpoint must
         *     never invent. `check` says *which* question produced the state, because *the socket
         *     answered* and *the credential is valid* are different claims and a hover that explains
         *     one should not be able to print the other.
         *
         *     **`meta` is the chip's line, already composed** — `workstation · 3 models`, `42ms`,
         *     `degraded · elevated latency`, or `null` when nothing measured is worth printing. A
         *     client is free to render from the fields instead; what it should not have to invent is
         *     the composition rule, so that the strip and the route inspector cannot draw two
         *     different sentences from one row.
         *
         *     **Nothing here triggers a check.** The cadence belongs to this service's scheduler and
         *     the page polls. A *check now* button would let anybody holding a session make this
         *     service issue outbound requests at whatever rate they can click, against a vendor's
         *     rate limit and signed with the workspace's own credential.
         *
         *     **Any member may read it**, viewers included: *is Ollama up* is the kind of thing a
         *     viewer exists to be able to look at.
         *
         *     **The workspace is the session's**, as everywhere in `/api/v1`: no workspace in this
         *     path, the session's active organization or `X-Ouro-Tenant` decides, and membership is
         *     checked before the operation runs.
         */
        get: operations["listProviderHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/providers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * This workspace's provider connections
         * @description One page of the providers this workspace has connected
         *     ([#223](https://github.com/NobuData/ouroboros/issues/223)), ordered by display name —
         *     the cards mockup 07 draws.
         *
         *     **The credential is not in this payload and cannot be.** Each entry carries `mask`,
         *     a server-computed `••••Xq4A`: four bullets and the last four characters of the key,
         *     made from the plaintext inside this service and unable to be turned back into it.
         *     Returning the value and letting a browser draw the bullets would put the credential
         *     in the page's memory, in the network tab and in every error report that page ever
         *     sends, which is exactly what decision **P4** exists to prevent. The one endpoint that
         *     answers with a live credential is `POST /api/v1/providers/{id}/reveal`, and it is
         *     priced accordingly.
         *
         *     **Any member may read it**, viewers included — every field here is masked, and *which
         *     providers does this workspace have* is the kind of question a role that exists to look
         *     should be able to ask. Every write below is `owner` or `admin`.
         *
         *     **What is deliberately not here.** The card foot's health detail is
         *     `GET /api/v1/routing/providers` ([#196](https://github.com/NobuData/ouroboros/issues/196)),
         *     and the model chips are AE.4's
         *     ([#230](https://github.com/NobuData/ouroboros/issues/230)) discovery. This surface is
         *     the *lifecycle* — exactly the set of things the five writes below can change.
         *
         *     **The workspace is the session's**, as everywhere in `/api/v1`: no workspace in this
         *     path, the session's active organization or `X-Ouro-Tenant` decides, and membership is
         *     checked before the operation runs.
         */
        get: operations["listProviderConnections"];
        put?: never;
        /**
         * Connect a provider
         * @description Add a provider connection — schema-checked, **validated against the live provider**,
         *     sealed, and only then stored.
         *
         *     **A bad key is never stored silently, and nothing is written on failure.** The order
         *     is the operation: the submitted `config` is checked against the adapter's own
         *     `configSchema()`, then the adapter asks the provider whether the configuration and
         *     credential work, and only a success reaches the database. There is no row to clean up
         *     when a key is refused, because there was never a row — which is what makes *adding a
         *     provider with an invalid key fails without persisting anything* a property of the
         *     control flow rather than a promise.
         *
         *     **`config` is the adapter's own vocabulary.** Which fields it takes is
         *     `configSchema()`'s answer for the `kind` — a base URL for a vLLM endpoint, a host for
         *     Ollama, a key for Anthropic — and the credential is whichever field the schema marks
         *     `x-ouroboros-secret`. It goes to the vault
         *     ([#222](https://github.com/NobuData/ouroboros/issues/222)) and never to a column a
         *     response can read. Two field names are reserved and land in columns of their own:
         *     `baseUrl` and `capabilityNote`.
         *
         *     **A setting this build cannot store is a `501` naming it**, never a value silently
         *     dropped. `provider_connections` keeps a connection's settings in columns, and one
         *     adapter declares an optional field that has none — Copilot's billing `organization`.
         *     Connecting Copilot without it works; sending it is refused with
         *     `provider_config_not_storable` and the field named, so nobody is left believing they
         *     configured something they did not.
         *
         *     **`owner` or `admin`, and nobody else.** A connection is what a workspace's routing
         *     spends money through; a `member` or a `viewer` gets the API's one `403`.
         *
         *     The connection is created `enabled`, with the status and latency the live check just
         *     measured, and `addedBy` set from the session — never from the body.
         */
        post: operations["addProviderConnection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/providers/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * This workspace's credential audit trail
         * @description Every credential operation this workspace has performed, newest first
         *     ([#225](https://github.com/NobuData/ouroboros/issues/225)) — what mockup 07's **Audit
         *     log** button in the page head opens.
         *
         *     **Decision P5 is why this exists in v1 rather than in v2.** A page that reveals and
         *     rotates credentials while keeping no record of who did it fails its own stated
         *     security posture, and *"we'll add audit later"* means the first months of a credential
         *     store's history are simply gone. The rows are written to the `audit_events` table
         *     scaffolding [#26](https://github.com/NobuData/ouroboros/issues/26) specified; this
         *     issue landed it early so there is one audit schema rather than two.
         *
         *     **Every operation is here, and a refusal is an operation.** Each of `add`, `reveal`,
         *     `rotate`, the settings edits, and `delete` writes exactly one event whether it
         *     succeeded or was refused — `detail.outcome` is `success` or `failure`, and on a
         *     failure `detail.reason` carries the refusal's own error code. *Nobody rotated this
         *     key* and *three people tried and the provider refused all three* are very different
         *     facts, and only one of them is visible in a trail of successes.
         *
         *     **No event ever contains secret material.** `detail` is a flat object of scalars built
         *     from a closed field set — a step-up method, a pair of cap figures, an outcome — and
         *     there is no code path that could put a plaintext, a mask or an envelope in it. It is
         *     enforced by the writer's own types, by a lint rule over the whole module, and by a
         *     grep test over the rows a full credential lifecycle actually writes.
         *
         *     **Append-only.** Nothing in this API updates or deletes an event; the application role
         *     holds `select` and `insert` on the table and nothing else, and a database trigger
         *     refuses a revision from any role at all. The single exception is erasing an
         *     attribution when a person is deleted — what happened cannot be rewritten, who did it
         *     can be forgotten.
         *
         *     **`owner` or `admin` only**, and this is the one read in the providers surface that
         *     is. The listing and the single-connection read are open to every member because every
         *     field they show is masked; *Maya revealed the Anthropic key at 14:02 from
         *     198.51.100.61* is not a fact about the workspace's configuration but a fact about a
         *     colleague.
         *
         *     **The `ip` is the address this API saw**, which behind a reverse proxy is the proxy's
         *     rather than the browser's — no forwarded header is trusted, because a header a client
         *     writes is a header a client can choose, and an audit trail that can be made to lie is
         *     worse than one whose address is less specific. It is `null` when none was knowable.
         *
         *     **What is deliberately not here.** The full audit surface — every kind of event this
         *     installation records, not only credential ones — is mockup 17's, and this endpoint is
         *     scoped to the trail the providers page opens. `credential.lease_granted` appears
         *     because a worker being told how to reach a provider *is* a credential operation
         *     (AD.3, [#224](https://github.com/NobuData/ouroboros/issues/224)), and it is the one
         *     event class with no actor.
         *
         *     **The workspace is the session's**, as everywhere in `/api/v1`: no workspace in this
         *     path, and another organization's events are unreachable rather than merely unlisted.
         */
        get: operations["listProviderAuditEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/providers/catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The kinds this build can connect, each with its form
         * @description Every provider kind this build has an adapter for, with the form its adapter declares
         *     ([#231](https://github.com/NobuData/ouroboros/issues/231)) — what mockup 07's
         *     **Browse catalog** draws its tiles from, and what the form behind each tile renders.
         *
         *     **The entries derive from the adapter registry, and from nothing else.** Decision
         *     **P1** made pluggability structural: core code imports the `ModelProviderAdapter`
         *     interface and never an adapter, so an adapter registered tomorrow is in tomorrow's
         *     catalog without a change here, in the UI, or in any list somebody keeps. The
         *     conformance kit's in-memory fake, registered under `custom` in a test, comes out of
         *     this endpoint with a working form — which is the property AF.3
         *     ([#236](https://github.com/NobuData/ouroboros/issues/236)) relies on to light its
         *     three tiles the day its adapters land.
         *
         *     **Each entry's `fields` are the form, already derived.** Which widget a field takes,
         *     whether it is required, what its placeholder is and which field is the credential are
         *     read from the adapter's `configSchema()` by one function in this service, once, so
         *     the add-form and the provider card cannot disagree about which value goes to the
         *     vault. A client iterates `fields` in order and needs no knowledge of any provider —
         *     a `select` for an `enum` field, a masked row for the one marked secret, a URL input
         *     for an address — and submits what it collected as `config` to `POST /api/v1/providers`,
         *     keyed by each field's `name`.
         *
         *     **A kind that is not here is not connectable in this build.** There is no *coming
         *     soon* flag: the registry answers what it has, and which kinds are announced is a
         *     product statement the page makes, not a fact this service keeps in step with a
         *     roadmap. `POST /api/v1/providers` refuses an absent kind with
         *     `501 provider_kind_unsupported` regardless.
         *
         *     **Any member may read it**, viewers included: the catalog names no credential and no
         *     workspace fact — it is *what could be connected*, which is open to the same readers as
         *     *what is connected*. The flow it starts is gated where it writes.
         *
         *     **Not workspace-scoped, and still under the tenant guard.** The registry is the
         *     build's, so the answer is the same for every workspace; a session acting in none is
         *     nevertheless a `400` here as everywhere in `/api/v1`, because a caller with no
         *     workspace has nowhere to connect a provider to.
         */
        get: operations["listProviderCatalog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/providers/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * One provider connection
         * @description One connection, with its credential masked exactly as the listing masks it. Readable
         *     by every member.
         *
         *     A connection of another workspace answers `404`, not `403` — the same rule the rest of
         *     this API follows, and sharper here: a `403` would confirm that an identifier names a
         *     real provider connection, which is the whole of what somebody enumerating identifiers
         *     is trying to learn.
         */
        get: operations["readProviderConnection"];
        put?: never;
        post?: never;
        /**
         * Disconnect a provider
         * @description Remove a connection, unless the workspace's routing still points at it.
         *
         *     **A connection with model aliases resolving on it cannot be removed, and the refusal
         *     names them.** V015's `model_aliases_provider_fk` is what makes the delete impossible;
         *     `provider_connection_in_use` is what turns *violates foreign key constraint* into an
         *     instruction — `details.aliases` lists the names to repoint or remove first. The check
         *     runs before the delete so the message is a good one, and the delete is still guarded,
         *     because an alias created in between makes the server refuse anyway.
         *
         *     `204` and no body: there is nothing to say about a row that no longer exists, and a
         *     `200` carrying the deleted resource invites a client to keep using it.
         *
         *     **The sealed credential goes with the row.** There is no soft delete and no archive:
         *     a credential nothing can reach is a credential every backup still carries.
         *
         *     `owner` or `admin`.
         */
        delete: operations["removeProviderConnection"];
        options?: never;
        head?: never;
        /**
         * Change a connection's settings
         * @description The card's switch, its monthly cap, its capability note and its address — each
         *     independently, and each optional.
         *
         *     **A `PATCH` rather than a `PUT`**, which is the opposite of the choice
         *     `PUT /api/v1/registry/prices` makes and for a reason about the resource rather than
         *     about taste: a price is one statement replaced outright, while a connection is a row
         *     of independent settings where *turn this off* should not require resending an address
         *     the client may not have.
         *
         *     **An absent field is left alone; an explicit `null` clears one.** Only
         *     `monthlyCapCents` and `capabilityNote` accept `null`, because those are the two
         *     settings whose absence is itself a value — *no cap*, *no second line*. A body that
         *     changes nothing is answered with the connection unchanged and writes no audit event.
         *
         *     **`config` is validated exactly as an add is, live provider included.** It is merged
         *     over what is stored — a schema's rules can span fields, and half a request cannot be
         *     judged against them — then checked against the adapter's schema and then against the
         *     provider itself, with the stored credential opened for the length of that one call. A
         *     refusal changes nothing. This is what makes editing a base URL safe: an address that
         *     does not work is refused here rather than discovered by the next run.
         *
         *     **`capabilityNote` is not a `config` field on this body**, and sending it inside
         *     `config` is a `422` saying so. The note has a column beside the cap and the switch and
         *     only three of the five adapters declare it in their form schema — routing it through
         *     `config` would make it editable for some providers and not others for a reason that is
         *     about a form rather than about the connection.
         *
         *     **The credential is not here.** Replacing one is `POST {id}/rotate`, which validates
         *     the new value against the live provider before it destroys anything; an edit that
         *     could carry a key would be that operation without the check.
         *
         *     `owner` or `admin`.
         */
        patch: operations["updateProviderConnection"];
        trace?: never;
    };
    "/api/v1/providers/{id}/reveal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reveal a stored credential
         * @description The one operation in this API that answers with a live credential, and the only one
         *     with four gates in front of it.
         *
         *     **It costs a step-up re-authentication.** A session cookie is not a strong enough
         *     claim to open a key: a borrowed laptop, a copied cookie inside the session cache's
         *     five-minute window and an XSS on any page of this product are all "a valid session".
         *     So a reveal needs a *recent* proof that the browser is still the person, and without
         *     one the answer is `401 step_up_required` carrying `details.methods` and
         *     `details.maxAgeSeconds` — a challenge a client can act on rather than a wall.
         *
         *     Two methods, which are the two BetterAuth gives this build:
         *
         *     | Method | What satisfies it |
         *     |---|---|
         *     | `session` | the session was **created** within `maxAgeSeconds` — somebody who has just signed in, by any means their account uses, GitHub included |
         *     | `password` | `password` in this body, compared against the caller's own credential account |
         *
         *     A confirmed password counts for `maxAgeSeconds`, so confirming once and revealing two
         *     keys is one prompt rather than two. A **wrong** password answers exactly as an absent
         *     one does: telling them apart would make this endpoint a password oracle for anybody
         *     holding a stolen session, which is precisely the person a step-up exists to stop.
         *
         *     **It is rate-limited per user and per connection**, and every attempt counts —
         *     including one that failed the step-up, because a limiter behind the step-up would
         *     leave the password comparison unlimited. `details.scope` says which limit was reached
         *     and `details.retryAfterSeconds` how long until it has room.
         *
         *     **It is always audited.** One `provider.revealed` event, recording the workspace, the
         *     connection, the person and *how the step-up was satisfied* — which is the difference
         *     between somebody with this session and somebody who proved they are this person.
         *
         *     **The answer carries `Cache-Control: no-store`** and an `expiresAt` a client should
         *     stop displaying the value at. The second is an instruction rather than an enforcement,
         *     and it is published because the alternative is every client inventing its own timeout
         *     and most of them choosing *never*.
         *
         *     `owner` or `admin` — reveal is grouped with the writes despite changing nothing,
         *     because it is the operation that hands back a key.
         */
        post: operations["revealProviderCredential"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/providers/{id}/rotate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Replace a credential, verify-then-retire
         * @description Rotate a provider credential: accept the new one, **validate it against the live
         *     provider**, and only then swap.
         *
         *     **A failed validation leaves the old credential live and working.** The naive
         *     implementation writes the new key and drops the old one, so a typo leaves the
         *     workspace's routing broken *and* the working credential gone. Here the check happens
         *     before any statement is issued, and a refusal is `422 provider_validation_failed`
         *     carrying the taxonomy's class and the adapter's own note — a designed error, not a
         *     stack trace.
         *
         *     **The swap is atomic.** It is a single conditional `UPDATE`, so the old credential is
         *     live until the instant the new one is: there is no window in which neither works. The
         *     condition is that the row still holds the credential the validation ran against — two
         *     administrators rotating at once, or the vault's re-encryption sweep landing in
         *     between, answers `409 provider_connection_changed` rather than overwriting a value it
         *     never checked.
         *
         *     **A provider that takes no credential cannot be rotated** — an Ollama host is
         *     `409 provider_credential_absent`. A provider whose credential is *optional* and
         *     currently absent **can** be: an OpenAI-compatible endpoint that has just been put
         *     behind auth is a real thing to rotate onto, and the new key is live-validated exactly
         *     as any other.
         *
         *     `owner` or `admin`. Audited as `provider.rotated`.
         */
        post: operations["rotateProviderCredential"];
        delete?: never;
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
         * ParamSource
         * @description Where a parameter field, or one of its bounds, came from — in precedence order.
         *
         *     `adapter` is what this build's provider adapter says about the model. `discovery` is
         *     what the provider itself reported about it into the discovered catalog. `catalog` is the
         *     bundled price catalog's metadata, a vendored snapshot of an upstream file, which may
         *     fill a bound nothing else knows and may **never** override the two above it. `registry`
         *     is what this workspace's own columns will store, applied last so a schema cannot offer a
         *     value a save would refuse.
         *
         *     A page that cannot tell a live bound from a catalogued one is a page whose bounds all
         *     have to be distrusted, which is why every field says.
         * @enum {string}
         */
        ParamSource: "adapter" | "discovery" | "catalog" | "registry";
        /**
         * ModelParamField
         * @description One tunable, as JSON Schema plus one annotation. The keywords are JSON Schema's and mean
         *     what JSON Schema says they mean; the dialect is deliberately narrow — one flat object of
         *     scalar-valued fields, no `$ref`, no composition, no nesting — so a renderer can be total
         *     over it rather than growing a case per keyword.
         */
        ModelParamField: {
            /**
             * @description Which of the four shapes this parameter is. `integer` is separate from `number`
             *     because a token budget of `4096.5` is a value no provider accepts.
             * @example integer
             * @enum {string}
             */
            type: "string" | "integer" | "number" | "boolean";
            /**
             * @description The form's label. Never empty — a field name is not a label.
             * @example Token budget
             */
            title: string;
            /** @description The help line under the input, when the label is not enough on its own. */
            description?: string;
            /**
             * @description The permitted values, for a `string` field. Drives a select.
             * @example [
             *       "off",
             *       "std",
             *       "max"
             *     ]
             */
            enum?: string[];
            /**
             * @description The lowest acceptable value, for a `number` or an `integer`.
             * @example 1
             */
            minimum?: number;
            /**
             * @description The highest acceptable value, for a `number` or an `integer`.
             * @example 400000
             */
            maximum?: number;
            /**
             * @description What the input starts at when the alias has no value of its own. **Not a value this
             *     product sends** — an alias whose parameters omit a key says nothing about it, and
             *     what the provider then does is the provider's own default.
             */
            default?: string | number | boolean;
            /**
             * @description Every source that shaped this field, highest precedence first.
             * @example [
             *       "adapter",
             *       "discovery"
             *     ]
             */
            "x-ouroboros-sources"?: components["schemas"]["ParamSource"][];
        };
        /**
         * ModelParamDocument
         * @description A parameter schema, as JSON Schema — published unchanged rather than translated into a
         *     vocabulary of this product's own, so a client may hand it to a generic validator and get
         *     the same answer the server will give it.
         *
         *     **There is no `required`.** Every parameter is optional by construction: an alias that
         *     names none of them takes the provider's defaults, which is the ordinary state.
         *
         *     `properties` may be **empty**, and then `description` says why — a fixed-catalog
         *     provider with nothing to tune, or an alias with no provider bound. An empty form that
         *     cannot explain itself is indistinguishable from one that failed to load, so the
         *     explanation is required rather than hoped for.
         */
        ModelParamDocument: {
            /**
             * @description The dialect. Stated so a generic validator knows the rules.
             * @enum {string}
             */
            $schema: "https://json-schema.org/draft/2020-12/schema";
            /** @enum {string} */
            type: "object";
            /**
             * @description What the inspector's parameter section is headed.
             * @example Anthropic model parameters
             */
            title: string;
            /**
             * @description Why there is nothing to tune, when there is nothing. Present and non-empty whenever
             *     `properties` is empty; allowed, and useful, alongside fields.
             */
            description?: string;
            /**
             * @description The tunables, keyed by the name a stored parameter document carries. **Key order is
             *     the order the inspector renders them in**, and it is preserved end to end.
             */
            properties: {
                [key: string]: components["schemas"]["ModelParamField"];
            };
            /**
             * @description Always `false` — the keyword that makes *this model does not support thinking* a
             *     validation failure rather than a stored key nothing reads.
             * @enum {boolean}
             */
            additionalProperties: false;
        };
        /**
         * ModelParamFormField
         * @description One parameter, already derived into what a form draws. Served beside the schema because
         *     which widget a field gets and what its bounds are is a decision this service should make
         *     once — a client that wants the schema has it, a client that wants a form has one, and
         *     the two cannot disagree because the second is computed from the first.
         *
         *     Every optional schema keyword is an explicit `null` here: absence is fine in a schema an
         *     author is writing and unhelpful in a value a renderer is consuming.
         */
        ModelParamFormField: {
            /**
             * @description The key a submitted value is carried under. Never shown to a person.
             * @example context_clamp
             */
            name: string;
            /**
             * @description What the `<label>` says.
             * @example Context clamp
             */
            label: string;
            /**
             * @description How to draw it, derived from the field's own description rather than declared — a
             *     `string` with an `enum` is a select, one without is free text, and the other three
             *     types name themselves.
             * @example integer
             * @enum {string}
             */
            widget: "select" | "text" | "integer" | "number" | "switch";
            /** @description The help line under the input, or null. */
            help: string | null;
            /** @description What the input starts at, or null. */
            defaultValue: string | number | boolean | null;
            /** @description The options for a select, or null for every other widget. */
            choices: string[] | null;
            /**
             * @description The lowest acceptable value, or null.
             * @example 1
             */
            minimum: number | null;
            /**
             * @description The highest acceptable value, or null.
             * @example 32768
             */
            maximum: number | null;
            /** @description Every source that shaped this field, highest precedence first. */
            sources: components["schemas"]["ParamSource"][];
        };
        /**
         * ModelParamSection
         * @description One half of a parameter answer — a schema, and the fields it renders as.
         */
        ModelParamSection: {
            schema: components["schemas"]["ModelParamDocument"];
            /**
             * @description The schema as an ordered field list. Empty exactly when the schema declares no
             *     properties, which is where a client renders the schema's `description` instead.
             */
            fields: components["schemas"]["ModelParamFormField"][];
        };
        /**
         * ModelParamSchemaResponse
         * @description What a model can be tuned with, and what this workspace allows the alias to be used for.
         *
         *     **Two sections rather than one**, mirroring the two documents an alias write carries: a
         *     `422` from a write names `params.thinking` or `restrictions.batch_ok`, and a client maps
         *     either back to a field of the section it came from without a lookup table. Both sections
         *     are in the same dialect, so one renderer draws both.
         */
        ModelParamSchemaResponse: {
            /**
             * @description The model this answer is about, echoed so a stale response is recognisable.
             * @example qwen3-coder:32b
             */
            modelId: string;
            /**
             * Format: uuid
             * @description The connection it was asked on, or null when the question was about an unbound
             *     alias.
             */
            connectionId: string | null;
            params: components["schemas"]["ModelParamSection"];
            restrictions: components["schemas"]["ModelParamSection"];
            /**
             * @description Why `params` offers nothing, or null when it offers something.
             *
             *     A code and never a sentence: the prose belongs to whatever is rendering, and the
             *     schema's own `description` carries the one this service would write. `alias_unbound`
             *     is an alias with no provider yet; `provider_has_no_parameters` is a fixed catalog
             *     that publishes nothing to set; `provider_unsupported` is a connection whose kind
             *     this build has no adapter for. None of the three is an error.
             * @enum {string|null}
             */
            reason: "alias_unbound" | "provider_unsupported" | "provider_has_no_parameters" | null;
            /**
             * @description Every source that shaped any field, in precedence order — the union of the per-field
             *     annotations, so a client can say *some of these bounds are catalogued* once above a
             *     form.
             * @example [
             *       "adapter",
             *       "discovery",
             *       "registry"
             *     ]
             */
            sources: components["schemas"]["ParamSource"][];
        };
        /**
         * ProviderHealth
         * @description One chip on the routing page's provider health strip — a provider connection, and what
         *     the last check honestly found. Every optional fact is `null` rather than a stand-in
         *     value; see the `routing` tag.
         */
        ProviderHealth: {
            /**
             * Format: uuid
             * @description The connection, as every other surface addresses it.
             * @example 9c4a5f6e-7d8c-4b10-8f43-5a6b7c8d9e03
             */
            id: string;
            /**
             * @description Which adapter reaches this provider.
             * @example ollama
             * @enum {string}
             */
            kind: "anthropic" | "openai_compatible" | "ollama" | "copilot" | "cursor" | "custom";
            /**
             * @description The chip's name. Free text a workspace chose, and deliberately not unique — two
             *     Ollama daemons on two machines are two legitimate connections.
             * @example Ollama
             */
            displayName: string;
            /**
             * @description Whether the provider is usable, as far as anything knows.
             *
             *     `unknown` is a state and **must never be rendered as healthy**: it is what a
             *     connection is before anything checked it. `paused` is an operator's intent rather
             *     than a conclusion from a check, which is why nothing ties it to `checkedAt`.
             * @example active
             * @enum {string}
             */
            status: "active" | "paused" | "error" | "unknown";
            /**
             * @description Which question produced this state, or `null` when no check this service performs
             *     did — a seeded state, or a provider it has nothing cheap and truthful to ask.
             * @example reachability
             * @enum {string|null}
             */
            check: "reachability" | "key_validation" | null;
            /**
             * Format: date-time
             * @description When the last check finished, or `null` when none has.
             * @example 2026-08-23T09:59:41.882Z
             */
            checkedAt: string | null;
            /**
             * @description The hostname this connection points at — no scheme, no port — or `null` when it
             *     names no address. It is what makes two chips both called `Ollama` tellable apart.
             * @example workstation
             */
            host: string | null;
            /**
             * @description Milliseconds the last check measured, or **`null`** when none measured one. There
             *     is deliberately no default: `0ms` is an excellent latency, not an absence.
             * @example 42
             */
            latencyMs: number | null;
            /**
             * @description How many models the provider listed, or `null` when nothing counted them. Null and
             *     `0` are different facts: one is *we could not read the list*, the other is *the
             *     list was empty*.
             * @example 3
             */
            models: number | null;
            /**
             * @description Why the provider is in this state, in a phrase — `unreachable (ECONNREFUSED)`,
             *     `key rejected (401)`, `degraded · elevated latency`. Never a driver's own message,
             *     which would carry a host and a port.
             * @example key rejected (401)
             */
            detail: string | null;
            /**
             * @description The chip's line, already composed from the facts above in the order the design
             *     draws them — address, models, latency, detail — or `null` when there is nothing
             *     measured worth printing.
             * @example workstation · 3 models
             */
            meta: string | null;
        };
        /**
         * ProviderHealthStrip
         * @description The routing page's provider health strip. Unpaged: a workspace's strip is a handful of
         *     chips, and a page over a list that short would cost a client a second request to
         *     discover there was nothing more.
         */
        ProviderHealthStrip: {
            /** @description Every connection in the workspace, ordered by display name. */
            providers: components["schemas"]["ProviderHealth"][];
        };
        /**
         * RouteProvider
         * @description Where a hop's model runs — the four identifying facts, and **no health**.
         *
         *     The status a provider is in comes from `GET /api/v1/routing/providers` and from
         *     nowhere else. The strip and the matrix are drawn from the same page load, and a status
         *     published twice is a status that can be shown two ways at once.
         */
        RouteProvider: {
            /**
             * Format: uuid
             * @description The provider connection's id — how mockup 07's surfaces address it.
             */
            id: string;
            kind: components["schemas"]["ProviderConnectionKind"];
            /**
             * @description What the resolution line prints beside the model — `Anthropic`, `Ollama`.
             * @example Anthropic
             */
            displayName: string;
            /**
             * @description Where it is, or null for a kind reached at its vendor's own endpoint.
             * @example http://workstation:11434
             */
            baseUrl: string | null;
        };
        /**
         * RouteHop
         * @description One numbered hop of a **configured** chain — the inspector's rail.
         *
         *     Nothing here says whether the hop would be *used*. Health, escalation rules and the
         *     floor decide that at resolution time, and a second opinion published from the editor
         *     would be a second thing to disagree with the first.
         */
        RouteHop: {
            /**
             * @description Where in the chain this hop sits; 1 is the primary. Dense from 1 by constraint,
             *     which is what makes `floorHopIndex` a number anybody can count.
             * @example 1
             */
            position: number;
            /**
             * @description The alias this hop names — `coder-max`. The only thing a route may name: raw
             *     provider model ids are unreachable from a route by construction.
             * @example coder-max
             */
            alias: string;
            /**
             * @description What the alias resolves to — the resolution line's first half.
             * @example claude-fable-5
             */
            modelId: string;
            /**
             * @description The operator's sentence for this hop, or null. Most hops have none.
             * @example Fallback on 5xx / timeouts
             */
            note: string | null;
            /**
             * @description Where it runs, or **null** for an alias with no provider bound yet. The hop keeps
             *     its place either way — a chain that lost a hop would arrive shorter than the
             *     operator configured it.
             */
            provider: components["schemas"]["RouteProvider"] | null;
        };
        /**
         * RouteStats
         * @description The matrix's two numeric columns, or nulls where nothing has been measured.
         *
         *     Both are computed from the token-spend ledger over the trailing thirty days
         *     ([#198](https://github.com/NobuData/ouroboros/issues/198)) — never stored on a route.
         *     A null is the answer roadmap decision **M7** requires: a workspace that has run
         *     nothing has not spent `$0.00` per run, it has spent nothing anybody can average.
         *     Render the em-dash.
         *
         *     **The three counts are why a `0` here can be believed.** `costCentsPerRunAvg: 0` with
         *     `pricedCalls: 15` is fifteen calls that really did cost nothing — a `docs` pass on a
         *     local model. `costCentsPerRunAvg: null` with `unpricedCalls: 15` is fifteen calls
         *     nobody has priced. Those are different facts about the same money, and only one of
         *     them is an em-dash. A non-zero `unpricedCalls` also means the average is over *part*
         *     of this kind's work.
         */
        RouteStats: {
            /**
             * @description The row's `$/run avg`, in cents, or null when nothing priced has been attributed to this kind.
             * @example 87
             */
            costCentsPerRunAvg: number | null;
            /**
             * @description The row's `p50 latency`, in milliseconds, or null when nothing timed a call for this kind.
             * @example 41000
             */
            latencyP50Ms: number | null;
            /**
             * @description How many calls of this kind carried a price — what `costCentsPerRunAvg` averages.
             * @example 15
             */
            pricedCalls: number;
            /**
             * @description How many carried none. Surfaced rather than rounded away; non-zero means the
             *     average above is a figure over part of this kind's work.
             * @example 0
             */
            unpricedCalls: number;
            /**
             * @description How many were timed — the size of the sample `latencyP50Ms` is the median of.
             * @example 15
             */
            timedCalls: number;
        };
        /**
         * StatsWindow
         * @description The span every figure on the routing page was measured over
         *     ([#198](https://github.com/NobuData/ouroboros/issues/198)).
         *
         *     A **rolling duration** subtracted from the request instant, never a calendar month:
         *     *30d* means `now − 30 × 24h`, which needs no timezone to be well defined and is immune
         *     to daylight saving by construction. One window is computed per read and handed to
         *     every aggregate, so the matrix's averages and the spend card's totals are over the
         *     same population.
         *
         *     `until` is the instant the aggregation ran at, which a short-TTL cached answer
         *     preserves rather than refreshes — a stale answer that claimed to be fresh would be the
         *     one thing a cache must never add.
         */
        StatsWindow: {
            /**
             * @description How many days wide the window is.
             * @example 30
             */
            days: number;
            /**
             * Format: date-time
             * @description The oldest instant a counted call occurred at. Inclusive.
             * @example 2026-07-24T09:58:12.004Z
             */
            since: string;
            /**
             * Format: date-time
             * @description When the figures were measured.
             * @example 2026-08-23T09:58:12.004Z
             */
            until: string;
        };
        /**
         * ProviderSpend
         * @description One metered row of the **Spend by provider · 30d** card
         *     ([#198](https://github.com/NobuData/ouroboros/issues/198)).
         *
         *     A row is a provider *kind* as the ledger records one, except for the local row, which
         *     is the mockup's *Local (vLLM + Ollama)*: `ollama` and `openai_compatible` are summed
         *     into one line because the meters are widths relative to the largest row — a client
         *     that merged afterwards would be rescaling numbers it had already been given — and the
         *     card's footnote is a fraction of exactly this row's tokens.
         *
         *     **`spendCents: 0` and `spendCents: null` are the two states this card exists to keep
         *     apart.** Zero is a total over calls that were **priced, at nothing** — a local model on
         *     hardware the workspace already owns — and is the mockup's `$0.00`. Null is *nobody
         *     priced these calls*, which renders as **unpriced** and never as a figure. A row can
         *     carry both facts at once: `spendCents: 0` with a non-zero `unpricedCalls` is a local
         *     provider whose routed calls cost nothing and whose earlier calls nobody has priced.
         */
        ProviderSpend: {
            /**
             * @description The row's identity, stable across reads — the kinds it sums, joined by `+`.
             *     Derived rather than reserved, so no provider a workspace records can collide with
             *     the local row's name.
             * @example ollama+openai_compatible
             */
            key: string;
            /**
             * @description The `token_usage.provider` values summed into this row.
             * @example [
             *       "ollama",
             *       "openai_compatible"
             *     ]
             */
            kinds: string[];
            /**
             * @description Whether this is the local row — a provider reachable without a credential, which
             *     is the same list the worker lease policy draws.
             * @example true
             */
            local: boolean;
            /**
             * @description The window's spend on this provider in cents, or null when none of its calls are
             *     priced. `41280` is `$412.80`.
             * @example 0
             */
            spendCents: number | null;
            /**
             * @description The meter's width, 0–1, relative to the largest `spendCents` on the card — or null
             *     when this row has nothing priced to draw. Served rather than left to the client
             *     because *relative to the maximum* is a property of the whole card. `0` is the
             *     honest width of a row that really did cost nothing; a visible minimum sliver is
             *     the stylesheet's.
             * @example 0
             */
            meterFraction: number | null;
            /**
             * @description `tokens_in + tokens_out` over the window.
             * @example 21700000
             */
            tokens: number;
            /**
             * @description How many of this provider's calls carried a price.
             * @example 260
             */
            pricedCalls: number;
            /**
             * @description How many did not. Non-zero makes `spendCents` a lower bound.
             * @example 5
             */
            unpricedCalls: number;
        };
        /**
         * RoutingSpend
         * @description The **Spend by provider · 30d** card, its footnote, and the window all of it was
         *     measured over ([#198](https://github.com/NobuData/ouroboros/issues/198)).
         *
         *     Served both inside `RoutingMatrix` — because the card and the matrix are one screen —
         *     and on its own at `GET /api/v1/routing/spend`. One computation and one shape, so the
         *     card and a report built on it cannot come to differ about an invoice.
         *
         *     Every figure is an aggregate over the token-spend ledger (roadmap decision **M7**), and
         *     nothing here is coalesced: a workspace that has spent nothing answers with an empty
         *     `providers`, a null total and a **null** share, never `$0.00`.
         */
        RoutingSpend: {
            window: components["schemas"]["StatsWindow"];
            /**
             * @description The card's metered rows, largest spend first, the local kinds folded into one. A
             *     provider with no usage in the window is **absent** rather than a row of zeros;
             *     empty is the card's zero-state.
             */
            providers: components["schemas"]["ProviderSpend"][];
            /**
             * @description Every row's priced spend added together, in cents, or null when nothing at all is
             *     priced. A lower bound whenever `unpricedCalls` is non-zero.
             * @example 55290
             */
            totalSpendCents: number | null;
            /**
             * @description Every token the workspace spent in the window — the footnote's denominator.
             * @example 70000000
             */
            tokens: number;
            /**
             * @description How many of them a local provider served — the footnote's numerator.
             * @example 21700000
             */
            localTokens: number;
            /**
             * @description The footnote — *"Local models served 31% of all tokens"* — as a fraction between 0
             *     and 1. **Null when the window holds no tokens at all**, and `0` when it holds
             *     tokens and none of them are local: *nothing ran* and *nothing ran locally* are
             *     different sentences, and only the first is an em-dash.
             * @example 0.31
             */
            localTokenShare: number | null;
            /**
             * @description Calls in the window with no price, across every provider.
             * @example 5
             */
            unpricedCalls: number;
        };
        /**
         * Route
         * @description One task kind's route: the inspector's numbered chain, its policy triple, and who last
         *     saved it.
         */
        Route: {
            /**
             * Format: uuid
             * @description The route's id.
             */
            id: string;
            /**
             * @description The kind this route answers for.
             * @example implement
             */
            taskKind: string;
            /**
             * @description The pill the matrix prints and the inspector's title. Its own value rather than
             *     something derived from the kind: `test-gen` tags `testgen-primary`.
             * @example implement-primary
             */
            tag: string;
            /**
             * @description Mockup 06's **Allow fallback to local models**. Off is a statement about which
             *     providers this route may use at all — every local hop is dropped, primary
             *     included, with a stated reason.
             */
            allowLocalFallback: boolean;
            /**
             * @description Mockup 06's **Fail run instead of degrading below fallback N**, as the hop number
             *     it is really about — so *below fallback 2* is `3`, the chain's third hop. Null is
             *     the switch being off: degrade as far as the chain goes.
             * @example 3
             */
            floorHopIndex: number | null;
            /**
             * @description Mockup 06's **Max cost per run**, in **integer cents** — `250` is `$2.50`. Null
             *     for no cap. Never a float and never dollars: it is compared against a running
             *     total, in the unit the spend ledger already keeps.
             * @example 250
             */
            maxCostCentsPerRun: number | null;
            /** @description The chain, primary first. Never empty for a route that exists. */
            hops: components["schemas"]["RouteHop"][];
            stats: components["schemas"]["RouteStats"];
            /**
             * Format: date-time
             * @description When it was last saved.
             * @example 2026-08-23T09:58:12.004Z
             */
            updatedAt: string;
            /**
             * @description Who last saved it, or null for a route written by a seed — or by somebody since
             *     deleted, because the route outlives the person who last touched it.
             */
            updatedBy: string | null;
        };
        /**
         * RoutingTaskKind
         * @description One row of the routing matrix — a task kind, and the route it resolves through.
         */
        RoutingTaskKind: {
            /**
             * @description The mono label the row prints. A workspace's own list rather than a fixed vocabulary.
             * @example implement
             */
            name: string;
            /**
             * @description The grey line under it.
             * @example Write the change
             * @example run tests
             * @example iterate to green
             */
            description: string;
            /**
             * @description The order the matrix draws the rows in; 1 is first.
             * @example 4
             */
            sortOrder: number;
            /**
             * @description The route, or **null** for a kind with none — a matrix row with an empty cell. A
             *     legal state, and one worth drawing rather than hiding.
             */
            route: components["schemas"]["Route"] | null;
        };
        /**
         * EscalationWhen
         * @description An escalation rule's predicate — at least one condition, and every one present is
         *     **ANDed** with the others. The empty object is refused: a rule with no condition always
         *     fires, which is not an escalation, it is a route.
         */
        EscalationWhen: {
            /**
             * @description Fires at this size **or larger**. `_gte` rather than the workflow builder's `_lte`
             *     because the two ask opposite questions of the same scale: a trigger gates work
             *     *small enough* to run unattended, an escalation catches work *big enough* to
             *     deserve a better model.
             * @example l
             * @enum {string}
             */
            effort_gte?: "xs" | "s" | "m" | "l" | "xl";
            /**
             * @description Fires when the issue carries this GitHub label. GitHub's vocabulary, not ours.
             * @example security
             */
            label?: string;
            /**
             * @description Fires on this diff classification. One value today, and honestly so: a
             *     classification nothing computes is a rule that can never fire.
             * @example docs_only
             * @enum {string}
             */
            diff_kind?: "docs_only";
        };
        /**
         * EscalationThen
         * @description An escalation rule's route modification — **exactly one** of three shapes. A document
         *     carrying two actions is refused: a rule whose effect depends on which action a reader
         *     notices first is a rule nobody can predict.
         */
        EscalationThen: {
            use_alias: {
                /** @example implement */
                task_kind: string;
                /** @example coder-max */
                alias: string;
                /**
                 * @description Invocation defaults merged **over** the alias's own. Scalars only — every
                 *     one of them is rendered into the card's one-line sentence.
                 */
                params?: {
                    [key: string]: string | number | boolean;
                };
            };
        } | {
            add_vote: {
                /** @example review */
                task_kind: string;
                /** @example second-opinion */
                alias: string;
            };
        } | {
            route_local: Record<string, never>;
        };
        /**
         * EscalationRule
         * @description One line of mockup 06's **ESCALATION RULES** card, as structure rather than as the
         *     sentence it reads like.
         */
        EscalationRule: {
            /**
             * Format: uuid
             * @description What the switch and the delete address.
             */
            id: string;
            /**
             * @description The card's switch, and the card's `N active` is the count of these that are true.
             *     A disabled rule keeps its place and its sentence, so switching it back on restores
             *     it exactly where it was.
             */
            enabled: boolean;
            /**
             * @description Evaluation order; 1 is first, and it is what gives *which rule wins* one answer
             *     when two match the same run. Unique per workspace and deliberately not dense.
             * @example 1
             */
            sortOrder: number;
            when: components["schemas"]["EscalationWhen"];
            then: components["schemas"]["EscalationThen"];
            /**
             * @description The sentence the card renders, **generated from the structure by the database**. A
             *     client may not send one: it is derived, so it can never drift from what the rule
             *     does, and the card, the matrix's escalation column and the resolution explanation
             *     all print the same string because there is only one.
             * @example effort ≥ L → implement uses coder-max (max thinking)
             */
            display: string;
        };
        /**
         * RoutingMatrix
         * @description The routing page's read: the matrix, the rules card and the spend card, in one payload
         *     because they are one screen — and, since
         *     [#198](https://github.com/NobuData/ouroboros/issues/198), because the matrix's numerics
         *     and the spend card's totals are aggregates over the same ledger rows over the same
         *     thirty days.
         */
        RoutingMatrix: {
            /**
             * @description Every task kind, in the order the matrix draws them. Empty for a workspace whose
             *     routing foundations have not been seeded.
             */
            taskKinds: components["schemas"]["RoutingTaskKind"][];
            /** @description Every escalation rule, enabled and disabled alike, in evaluation order. */
            rules: components["schemas"]["EscalationRule"][];
            /**
             * @description The **Spend by provider · 30d** card, over the same window the matrix's numerics
             *     are. Identical to what `GET /api/v1/routing/spend` answers with.
             */
            spend: components["schemas"]["RoutingSpend"];
        };
        /**
         * RoutingAlias
         * @description One alias a route may name, with the resolution a swap menu previews.
         */
        RoutingAlias: {
            /**
             * @description The name a route uses.
             * @example coder-max
             */
            alias: string;
            /**
             * @description What it resolves to — the only place a raw provider model string appears.
             * @example claude-fable-5
             */
            modelId: string;
            /** @description The alias's own invocation defaults. `{}` is the ordinary state. */
            params: {
                [key: string]: unknown;
            };
            /** @description Where it runs, or null for an alias with no provider bound yet. */
            provider: components["schemas"]["RouteProvider"] | null;
        };
        /**
         * RoutingAliasList
         * @description The registry list the swap menus are built from. Unpaged: a workspace's registry is the
         *     handful of aliases its routes name, and a page over a list that short would cost a
         *     client a second request to discover there was nothing more.
         */
        RoutingAliasList: {
            /** @description Every alias in the workspace, ordered by name, unbound ones included. */
            aliases: components["schemas"]["RoutingAlias"][];
        };
        /**
         * ModelAliasConnection
         * @description Where an alias resolves — the connection half of a binding.
         */
        ModelAliasConnection: {
            /**
             * Format: uuid
             * @description `provider_connections.id`.
             */
            id: string;
            /**
             * @description Which adapter reaches it. The table's `AN` / `GH` / `CU` / `OL` / `VL` monogram is derived from this.
             * @example anthropic
             * @example copilot
             * @example cursor
             * @example ollama
             * @example openai_compatible
             */
            kind: string;
            /**
             * @description What mockup 07's card calls it.
             * @example Anthropic Claude
             */
            displayName: string;
        };
        /**
         * ModelAliasReference
         * @description One reference to an alias — one `Used by` chip, and one line of a `409`.
         */
        ModelAliasReference: {
            /**
             * @description Which storage shape the reference lives in. `route` and `escalation` are live;
             *     `workflow` and `chat_pin` are declared and contribute nothing until their storage
             *     exists.
             * @enum {string}
             */
            kind: "route" | "escalation" | "workflow" | "chat_pin";
            /**
             * Format: uuid
             * @description The referring row — `route_hops.id` for a route, `escalation_rules.id` for a rule. Stable enough to link to.
             */
            refId: string;
            /**
             * @description Mockup 21's chip, verbatim.
             * @example implement-primary
             * @example escalation:effort≥L
             */
            label: string;
            /** @description Whether this reference refuses a delete rather than warns about one. True for every live kind today. */
            blocking: boolean;
        };
        /**
         * ModelAlias
         * @description One row of mockup 21's allowed-models table, and the inspector's whole state.
         */
        ModelAlias: {
            /**
             * Format: uuid
             * @description `model_aliases.id` — what every write addresses.
             */
            id: string;
            /**
             * @description The name routes use.
             * @example coder-max
             */
            alias: string;
            /** @description The **On** switch. Always false for an unbound alias. */
            enabled: boolean;
            /** @description Where it resolves, or null for the unbound state — mockup 21's *no key* row. */
            connection: components["schemas"]["ModelAliasConnection"] | null;
            /**
             * @description The raw model id — the only place one appears (decision **M1**).
             * @example claude-fable-5
             */
            modelId: string;
            /** @description Per-alias invocation defaults — what the table's chips are derived from. */
            params: {
                [key: string]: unknown;
            };
            /** @description Registry policy flags — `review_vote_only`, `batch_ok`. */
            restrictions: {
                [key: string]: unknown;
            };
            /** @description An operator's note, or null. */
            notes: string | null;
            /** @description Everything that references the alias. The `Used by` column is this list's length; the inspector's chips are its labels. */
            references: components["schemas"]["ModelAliasReference"][];
            /** @description Who last wrote it — a user id — or null for a seed or an import. */
            updatedBy: string | null;
            /** Format: date-time */
            createdAt: string;
            /**
             * Format: date-time
             * @description Moved by every write.
             */
            updatedAt: string;
        };
        /**
         * ModelAliasList
         * @description The registry's list. Unpaged — a workspace's registry is a handful of names.
         */
        ModelAliasList: {
            /** @description Every alias in the workspace, ordered by name, unbound ones included. */
            aliases: components["schemas"]["ModelAlias"][];
        };
        /**
         * ModelAliasWarning
         * @description Something a write wants the client to know, beside the alias it stored. A warning is not a refusal — the write happened.
         */
        ModelAliasWarning: {
            /**
             * @description `alias_unbound` — the alias has no connection: it is stored switched off and
             *     nothing routes through it. `model_not_discovered` — discovery has not reported the
             *     model on the connection (V017's soft warning, surfaced rather than swallowed).
             * @enum {string}
             */
            code: "alias_unbound" | "model_not_discovered";
            /** @description For a person. */
            message: string;
            /** @description Where to go to resolve it — `/models/providers` for an unbound alias — or null when it is only information. */
            fix: string | null;
        };
        /**
         * ModelAliasResolutionPreview
         * @description What the next resolution through the alias will reach, after a rebind.
         */
        ModelAliasResolutionPreview: {
            /** @description The connection it will run on, or null when the alias was unbound. */
            connection: components["schemas"]["ModelAliasConnection"] | null;
            /** @description The model it will name. */
            modelId: string;
        };
        /**
         * ModelAliasChange
         * @description What a write answers with — the alias as stored, and what the write did.
         */
        ModelAliasChange: {
            alias: components["schemas"]["ModelAlias"];
            /**
             * @description The revision record this write left, or **null** when it changed nothing — a
             *     `PATCH` whose every field already held that value. Null is not a failure.
             */
            revisionId: string | null;
            /** @description What the client should know. Empty is the ordinary case. */
            warnings: components["schemas"]["ModelAliasWarning"][];
            /** @description Where the next resolution goes, present when the write rebound the alias and null otherwise. */
            nextResolution: components["schemas"]["ModelAliasResolutionPreview"] | null;
            /** @description The references whose hops the next resolution will drop, present when the write switched a referenced alias off and empty otherwise. */
            droppedHops: components["schemas"]["ModelAliasReference"][];
        };
        /**
         * CreateModelAlias
         * @description `POST /registry/aliases` — the + New alias dialog, in either mode.
         */
        CreateModelAlias: {
            /**
             * @description The name routes will use. Unique per workspace; lower-case letters, digits and single hyphens.
             * @example coder-max
             */
            alias: string;
            /** @description The connection to bind to, or absent / null for an unbound alias. */
            connectionId?: string | null;
            /**
             * @description The provider's model id, in the vendor's own spelling. Not padded.
             * @example claude-fable-5
             * @example qwen3-coder:32b
             */
            modelId: string;
            /** @description Per-alias invocation defaults. Validated against the bound model's schema; absent means `{}`. */
            params?: {
                [key: string]: unknown;
            };
            /** @description Registry policy flags. Absent means `{}`. */
            restrictions?: {
                [key: string]: unknown;
            };
            /** @description An operator's note. Trimmed and non-empty; may span lines. */
            notes?: string;
            /** @description The **On** switch. Defaults to on for a bound alias; forced off for an unbound one. */
            enabled?: boolean;
        };
        /**
         * UpdateModelAlias
         * @description `PATCH /registry/aliases/{id}` — only the fields present are written.
         */
        UpdateModelAlias: {
            /** @description A new name — a rename, guarded like a delete while the alias is referenced. */
            alias?: string;
            /** @description A new connection — a rebind — or null to unbind, which also switches the alias off. */
            connectionId?: string | null;
            /** @description A new model — also a rebind, validated against discovery the same way. */
            modelId?: string;
            /** @description The whole params document, replacing the stored one. */
            params?: {
                [key: string]: unknown;
            };
            /** @description The whole restrictions document, replacing the stored one. */
            restrictions?: {
                [key: string]: unknown;
            };
            /** @description A new note, or null to clear it. */
            notes?: string | null;
            /** @description The **On** switch. Enabling an unbound alias is refused with `model_alias_unbound`. */
            enabled?: boolean;
        };
        /**
         * ModelOption
         * @description One model a connection has, as discovery reported it — an entry of the inspector's model select.
         */
        ModelOption: {
            /** @description The provider's own identifier — what an alias's `modelId` would be set to. */
            modelId: string;
            /** @description What the select prints. */
            display: string;
            /**
             * Format: date-time
             * @description When discovery last reported it.
             */
            discoveredAt: string;
            /** @description What else discovery reported — `context_tokens`, `tier`. */
            meta: {
                [key: string]: unknown;
            };
        };
        /**
         * ModelOptionList
         * @description The inspector's model select — *listed live from the provider*.
         */
        ModelOptionList: {
            connection: components["schemas"]["ModelAliasConnection"];
            /** @description The connection's models, ordered by id. Empty when discovery has not run. */
            models: components["schemas"]["ModelOption"][];
        };
        /**
         * RoutingSimulationContext
         * @description What is known about the work a route is being simulated for — the `ctx` of
         *     `resolve(taskKind, ctx)`.
         *
         *     **Everything an escalation rule can ask about is here, and nothing else is.** The
         *     predicate grammar is closed over `effort_gte`, `label` and `diff_kind`, so a fourth fact
         *     would be one no rule could ever read; a property this schema does not declare is a `422`
         *     rather than a value quietly discarded.
         *
         *     **Every field is optional, and absence is a real answer.** An unstated fact never
         *     satisfies a condition about it: a rule reading `effort_gte: "l"` against a context with
         *     no effort has not learned the work is small, it has learned nothing. `null` is refused —
         *     it is a client saying something a context cannot mean.
         */
        RoutingSimulationContext: {
            /**
             * @description How big the work was sized. Absent for work nothing has estimated, which is the
             *     ordinary state of an issue that has not been through the estimator.
             * @example l
             * @enum {string}
             */
            effort?: "xs" | "s" | "m" | "l" | "xl";
            /**
             * @description The issue's labels, as GitHub spells them — GitHub's vocabulary, not ours. Compared
             *     **whole and case-sensitively**, because GitHub's own labels are: `security` and
             *     `Security` are two labels a repository may genuinely have.
             * @example [
             *       "security"
             *     ]
             */
            labels?: string[];
            /**
             * @description How the change was classified, when something classified it. One value today, and
             *     honestly so: a classification nothing computes is a rule that can never fire.
             * @example docs_only
             * @enum {string}
             */
            diffKind?: "docs_only";
            /**
             * @description The repository the work belongs to. **Read by nothing today** — per-repository route
             *     overrides are [#211](https://github.com/NobuData/ouroboros/issues/211). Accepted now
             *     so a consumer holding the repository sends it now rather than being amended later.
             * @example acme-robotics/control-plane
             */
            repo?: string;
        };
        /**
         * RoutingSimulationRequest
         * @description What to simulate: a task kind, and what is known about the work.
         *
         *     There is no workspace in it. The workspace is the session's, as everywhere in `/api/v1`,
         *     and a body that could name one would be a body that could simulate somebody else's
         *     routes.
         */
        RoutingSimulationRequest: {
            /**
             * @description The kind of work being routed — the matrix row being asked about. Lower-case kebab,
             *     which is the shape the column has: a name outside it names something no row could
             *     hold.
             * @example review
             */
            taskKind: string;
            ctx?: components["schemas"]["RoutingSimulationContext"];
        };
        /**
         * ResolvedProvider
         * @description Where a resolved hop's model runs, and whether it is usable — `RouteProvider`'s four
         *     identifying facts **plus** the health the resolution decided on.
         *
         *     Health is present here and absent from `RouteProvider`, and the difference is the
         *     difference between the two surfaces: the editor publishes the chain an operator
         *     configured, and this publishes the chain a run would walk. The status arrives from the
         *     health snapshot, so a resolution has exactly one opinion about a provider's state and
         *     the hop's sentence can be composed once — a client that had to fetch the health strip to
         *     learn why a hop was dropped would be composing the story this endpoint exists to stop it
         *     composing.
         *
         *     **There is no credential here and nowhere to put one.** A resolution carries an address
         *     and a model: everything an executor needs to choose a provider, and nothing it needs to
         *     authenticate as one.
         */
        ResolvedProvider: {
            /**
             * Format: uuid
             * @description The provider connection's id — how mockup 07's surfaces address it.
             */
            id: string;
            kind: components["schemas"]["ProviderConnectionKind"];
            /**
             * @description What the hop's sentence prints beside the model.
             * @example Anthropic Claude
             */
            displayName: string;
            /**
             * @description Where it is, or null for a kind reached at its vendor's own endpoint.
             * @example http://workstation:11434
             */
            baseUrl: string | null;
            status: components["schemas"]["ProviderConnectionStatus"];
            /**
             * @description Milliseconds the last check measured, or **null** when none measured one. Never `0`
             *     as a stand-in for *unmeasured*: `0ms` is an excellent latency, not an absence.
             * @example 42
             */
            latencyMs: number | null;
            /**
             * @description Why the provider is in this state, when there is something to say — `elevated
             *     latency`, `503 upstream` — or null.
             * @example 503 upstream
             */
            detail: string | null;
        };
        /**
         * ResolutionHop
         * @description One hop of a **resolved** chain — kept or dropped, and why.
         *
         *     **Dropped hops stay in the array.** A chain that quietly omitted them would be exactly
         *     the silence mockup 06's promise is about: the inspector draws hop 2 struck through with
         *     a reason beside it, and it can only do that if the hop is still there. The chain an
         *     executor walks is the hops whose `decision` is `kept`, and that filter is the client's.
         */
        ResolutionHop: {
            /**
             * @description Where this hop sits in the **resolved** chain; 1 is the primary. Dense, and it counts
             *     dropped hops — it is the number the inspector's rail prints.
             * @example 1
             */
            index: number;
            /**
             * @description The hop's number in the **stored** chain, or **null** for a hop an escalation rule
             *     prepended. The distinction is load-bearing: `floor.hopIndex` is measured against this
             *     and never against `index`, so a rule that prepends a primary cannot silently move a
             *     floor an operator set against the chain they saw.
             * @example 1
             */
            position: number | null;
            /**
             * @description The alias this hop names. Never a raw model id — a route may name nothing else.
             * @example coder-max
             */
            alias: string;
            /**
             * @description What that alias means — the raw provider model string, and the only place it appears.
             * @example claude-fable-5
             */
            modelId: string;
            /**
             * @description The invocation defaults this hop carries: the alias's own, with an applied rule's
             *     merged **over** them, because the rule is the more specific statement. Keys are
             *     sorted, which is not cosmetic — a resolution is byte-for-byte identical for identical
             *     inputs, and key order survives serialisation.
             */
            params: {
                [key: string]: unknown;
            };
            /**
             * @description Where it runs, or **null** when the alias is bound to no provider connection. Such a
             *     hop is always `dropped`, with a stated reason.
             */
            provider: components["schemas"]["ResolvedProvider"] | null;
            /**
             * @description The **operator's** own sentence for this hop, unchanged, or null. Separate from
             *     `explanation` because the two have different authors: a note says why this hop is in
             *     the chain, an explanation says what this resolution concluded about it.
             * @example Fallback on 5xx / timeouts
             */
            note: string | null;
            /**
             * @description Whether the executor will try this hop.
             * @example kept
             * @enum {string}
             */
            decision: "kept" | "dropped";
            /**
             * @description Why — **stable**, and what a client branches on. Two of the eight keep a hop:
             *     `provider_healthy` and `provider_unknown`. They are separate codes because *usable*
             *     and *nothing has checked it* are different claims, and the second must never be
             *     rendered as the first. A code this list does not carry still arrives with a sentence
             *     and a `decision`, which is why adding one is not a version bump.
             * @example provider_healthy
             * @enum {string}
             */
            code: "provider_healthy" | "provider_unknown" | "provider_paused" | "provider_error" | "alias_unbound" | "below_floor" | "rule_route_local" | "local_not_allowed";
            /**
             * @description Why, as a sentence — **rendered verbatim**. A kept hop reads as the inspector's
             *     hop-meta line (`Primary · healthy · 42ms`); anything that removed a hop reads as a
             *     sentence saying what and why. Never branch on this wording; branch on `code`.
             * @example Primary · healthy · 42ms
             */
            explanation: string;
        };
        /**
         * ResolutionRule
         * @description One escalation rule whose predicate **matched the context**, and what it did about it.
         *
         *     Matched rather than applied, deliberately. A rule that fired but names another task kind
         *     did nothing, and *nothing happened and here is why* is the answer an operator needs when
         *     a rule they can see on the card did not change the run they are looking at. Filter on
         *     `applied` for the rules that took effect; the rest are the near misses, each with a
         *     reason.
         */
        ResolutionRule: {
            /**
             * Format: uuid
             * @description The rule's id — what `/api/v1/routing/rules/{id}` addresses it by.
             */
            id: string;
            /**
             * @description Its evaluation order; 1 is first. Rules are listed in this order.
             * @example 2
             */
            sortOrder: number;
            /**
             * @description The sentence the rules card renders, **reported rather than recomposed**: the
             *     database derives it from the rule's structure and refuses a hand-written one, so this
             *     panel and the card cannot print two different sentences for one rule.
             * @example security label → review adds second-opinion vote
             */
            display: string;
            /**
             * @description Whether it changed this resolution.
             * @example true
             */
            applied: boolean;
            /**
             * @description What it did, or why it did not. The first five mean `applied: true`; the last three
             *     are the near misses.
             * @example add_vote_added
             * @enum {string}
             */
            code: "use_alias_params_merged" | "use_alias_swapped" | "use_alias_prepended" | "add_vote_added" | "route_local_applied" | "not_this_task_kind" | "alias_unresolvable" | "vote_already_added";
            /**
             * @description The same, as a sentence — rendered verbatim.
             * @example Applied — a second-opinion vote was added for the executor to obtain.
             */
            explanation: string;
        };
        /**
         * ResolutionVote
         * @description A second opinion an `add_vote` rule attached — the matrix's *"always second vote"*.
         *
         *     **A requirement, not a hop.** It is not somewhere the run falls back to, it is something
         *     the executor must *also* do; dropping it into the chain would make it look like a
         *     fallback only reached when everything above it fails.
         */
        ResolutionVote: {
            /**
             * @description The alias casting the vote.
             * @example second-opinion
             */
            alias: string;
            /**
             * @description What it resolves to.
             * @example claude-opus-5
             */
            modelId: string;
            /** @description Its invocation defaults. Sorted, for the determinism reason a hop's are. */
            params: {
                [key: string]: unknown;
            };
            provider: components["schemas"]["ResolvedProvider"];
            /**
             * Format: uuid
             * @description Which rule asked for it, so a client can point at the row that did.
             */
            ruleId: string;
        };
        /**
         * ResolutionFloor
         * @description What mockup 06's **Fail run instead of degrading below fallback N** decided — recorded on
         *     **every** resolution, including the ones where it did nothing.
         *
         *     *No floor is set* and *the floor was satisfied* are different facts, and a field that
         *     appeared only when a policy fired would leave a reader unable to tell either from a
         *     client that forgot to render it.
         */
        ResolutionFloor: {
            /**
             * @description The deepest **stored** hop position this route may run on, or null for the switch
             *     being off. Measured against `chain[].position`, never against `chain[].index`.
             * @example 1
             */
            hopIndex: number | null;
            /**
             * @description What it decided.
             * @example no_floor
             * @enum {string}
             */
            code: "no_floor" | "floor_held" | "floor_breached";
            /**
             * @description The same, as a sentence — rendered verbatim.
             * @example No floor is set — this route may degrade to the end of its chain.
             */
            explanation: string;
        };
        /**
         * ResolutionFailure
         * @description Why a resolution refuses to produce a chain — present exactly when `outcome` is
         *     `fail_run`, and null otherwise.
         *
         *     **Never a truncated chain instead.** *The run may not proceed* and *the run proceeds on
         *     the third fallback* are different outcomes, and this product does not quietly turn the
         *     first into the second.
         */
        ResolutionFailure: {
            /**
             * @description Which refusal. `floor_breached` is the same fact `floor.code` states, spelled the
             *     same way on purpose so a client does not have to check both for two names.
             * @example floor_breached
             * @enum {string}
             */
            code: "floor_breached" | "no_eligible_hop";
            /**
             * @description Why, as a sentence — rendered verbatim.
             * @example The floor is hop 1 — no hop at or above it is usable
             * @example so this run fails rather than degrading below it.
             */
            explanation: string;
        };
        /**
         * Resolution
         * @description One resolution — what would run for this task kind in this context, and why.
         *
         *     **Deterministic given its inputs**: the same route, health snapshot and context produce
         *     this object byte for byte, which is what makes **Simulate routing** the same code path as
         *     execution rather than a parallel mock of it.
         *
         *     `resolutionVersion` is the pin a consumer holds. Adding a hop code or a rule code is
         *     **not** a bump — an unrecognised code still arrives with a sentence and a decision to
         *     branch on. Renaming a field, removing one, or changing what an existing one means is.
         */
        Resolution: {
            /**
             * @description The shape's version — the string a consumer pins. Deliberately not a semver: a
             *     resolution is not a package, and `1.0.0` would invite reasoning about a patch digit
             *     that will never move.
             * @example r1
             * @enum {string}
             */
            resolutionVersion: "r1";
            /**
             * @description The kind that was asked for.
             * @example review
             */
            taskKind: string;
            /**
             * @description Its route's tag — the inspector's title.
             * @example review-primary
             */
            routeTag: string;
            /**
             * @description Whether there is a chain to run. `fail_run` arrives with a `200`: it is a successful
             *     answer carrying a reason, not an error.
             * @example resolved
             * @enum {string}
             */
            outcome: "resolved" | "fail_run";
            /**
             * @description Every hop, in the order the executor would try them, **dropped ones included**. The
             *     chain actually walked is the hops whose `decision` is `kept`.
             */
            chain: components["schemas"]["ResolutionHop"][];
            /** @description Every rule whose predicate matched, in evaluation order, applied or not. */
            rules: components["schemas"]["ResolutionRule"][];
            /** @description Second opinions the executor must also obtain. Empty is the ordinary case. */
            votes: components["schemas"]["ResolutionVote"][];
            floor: components["schemas"]["ResolutionFloor"];
            /**
             * @description The route's **Allow fallback to local models** switch, echoed. No sentence of its
             *     own: the policy has nothing to say until it drops something, and then the sentence is
             *     on the hop it dropped, where the reader is already looking.
             * @example true
             */
            allowLocalFallback: boolean;
            /**
             * @description The cost cap that travels to the executor, in integer cents — `250` is `$2.50` — or
             *     null for a route with none. Attached to **every** resolution including a `fail_run`,
             *     because it is a property of the route rather than of the outcome.
             * @example 250
             */
            maxCostCents: number | null;
            /** @description Why there is no chain, or null when there is one. */
            failure: components["schemas"]["ResolutionFailure"] | null;
        };
        /**
         * RouteHopInput
         * @description One hop of a chain, as a client sends it.
         *
         *     **There is no position**: the array's order *is* the chain's order, and the server
         *     numbers the hops densely from 1 — so a client that dragged hop 3 above hop 2 sends the
         *     array it now draws rather than computing two new numbers for it.
         *
         *     **And there is no model id.** A hop names an alias; the raw provider model string lives
         *     in the registry and nowhere else.
         */
        RouteHopInput: {
            /**
             * @description The alias this hop uses. Checked for shape here and for existence in this workspace
             *     by the server — an alias it has never bound is a `422` naming the hop.
             * @example coder-max
             */
            alias: string;
            /**
             * @description The inspector's hop-meta line. Absent and `null` mean the same thing on this verb:
             *     the hop has no note. Neither blank nor padded.
             * @example Fallback on 5xx / timeouts
             */
            note?: string | null;
        };
        /**
         * RoutePolicy
         * @description One route's chain and its policy triple — the inspector, as a body.
         *
         *     **All three policy fields are required.** A `PUT` has no leave-this-alone case, so
         *     omitting one is a malformed body rather than a way to keep the value it had; `null` is
         *     how *off* is said for the floor and *no cap* for the cost.
         */
        RoutePolicy: {
            /**
             * @description The chain, primary first. Never empty — a route with no hops is refused by the
             *     schema itself, so an empty array could not be stored by anything.
             */
            hops: components["schemas"]["RouteHopInput"][];
            /** @description Mockup 06's **Allow fallback to local models**. A switch has two positions, so there is no null. */
            allowLocalFallback: boolean;
            /**
             * @description The deepest hop this route may run on, or null for the switch being off. Measured
             *     against the chain **in the same body**: a save that shortens a chain and lowers its
             *     floor is a legal edit, and one deeper than the chain sent with it is a `422`.
             * @example 2
             */
            floorHopIndex: number | null;
            /**
             * @description The cap in **integer cents**, or null for no cap. A cap of zero is not a cap, it is
             *     a route that can never run.
             * @example 250
             */
            maxCostCentsPerRun: number | null;
        };
        /**
         * SaveRouteInput
         * @description One entry of a batch — a route, plus the task kind that says which one.
         */
        SaveRouteInput: components["schemas"]["RoutePolicy"] & {
            /**
             * @description The matrix row this entry edits. A kind may appear once in a batch: a body that
             *     says two different things about one row has no reading under which both were
             *     applied.
             * @example implement
             */
            taskKind: string;
        };
        /**
         * SaveRoutesRequest
         * @description One press of **Save routes** — the whole staged batch, committed atomically.
         *
         *     An object with one array rather than a bare array, for the reason every list in this API
         *     is an object: a top-level array has nowhere to grow a field.
         */
        SaveRoutesRequest: {
            /** @description The routes to commit, in any order. Each task kind at most once. */
            routes: components["schemas"]["SaveRouteInput"][];
        };
        /**
         * SaveRoutesResult
         * @description What a save answers with — the revision it wrote, and the routes as they now stand.
         */
        SaveRoutesResult: {
            /**
             * Format: uuid
             * @description The revision row this save wrote, or **null** when it changed nothing.
             *
             *     Null is neither a failure nor an omission: it is a client pressing **Save routes**
             *     on a matrix it had not edited. A revision records what moved, and an audit trail of
             *     button presses that moved nothing is one nobody reads to the end.
             */
            revisionId: string | null;
            /**
             * @description The routes as they now stand, in the order the request listed them — re-read after
             *     the commit rather than echoed from the body, so the round trip is a property of the
             *     answer rather than a second request a client has to make.
             */
            routes: components["schemas"]["Route"][];
        };
        /**
         * CreateEscalationRule
         * @description A new escalation rule.
         *
         *     **There is no `display`, and its absence is the enforcement.** The sentence is derived
         *     from the structure by the database; a body carrying one is refused rather than silently
         *     discarded.
         */
        CreateEscalationRule: {
            /**
             * @description The card's switch. Absent means **on**: the only reason to write a rule is to have
             *     it apply, and the switch exists to suspend one without deleting it.
             */
            enabled?: boolean;
            /**
             * @description Where this rule evaluates; 1 is first. Absent means **appended** — one past the
             *     highest this workspace holds, because a new rule that silently claimed the first
             *     position would change what every existing rule does.
             * @example 2
             */
            sortOrder?: number;
            when: components["schemas"]["EscalationWhen"];
            then: components["schemas"]["EscalationThen"];
        };
        /**
         * UpdateEscalationRule
         * @description What may change about an escalation rule. Every field is optional and **none of them
         *     admits `null`** — a rule has no clearable parts. An empty body changes nothing and
         *     answers the rule as it stands.
         *
         *     `when` and `then` are replaced whole: there is no patching *inside* a predicate, because
         *     a condition removed and a condition never sent would be the same request.
         */
        UpdateEscalationRule: {
            /** @description The card's switch. */
            enabled?: boolean;
            /**
             * @description Where this rule evaluates; 1 is first.
             * @example 2
             */
            sortOrder?: number;
            when?: components["schemas"]["EscalationWhen"];
            then?: components["schemas"]["EscalationThen"];
        };
        /**
         * AuditAction
         * @description What an audit event records — `family.event`, lower snake on both sides.
         *
         *     Nine names, and the set is deliberately not a database constraint: `audit_events.action`
         *     is CHECKed for the *grammar* and not for the vocabulary, so adding an event is an
         *     application release rather than a migration. What the grammar buys is that
         *     `action = "provider.revealed"` finds every reveal — one writer spelling it
         *     `Provider.Revealed` would make that filter quietly wrong rather than loudly broken.
         *
         *     The three settings names are the three affordances mockup 07 draws — the switch on a
         *     card, and the cap under it — so a trail says *disabled* where somebody saw themselves
         *     press a switch. `provider.updated` is what a rename, an address change, or a request
         *     that did two things at once records under: naming one of the specialisations on an
         *     edit that also tripled the spend ceiling would be answering *what happened* with half
         *     of it.
         * @example provider.rotated
         * @enum {string}
         */
        AuditAction: "provider.added" | "provider.revealed" | "provider.rotated" | "provider.enabled" | "provider.disabled" | "provider.cap_changed" | "provider.updated" | "provider.deleted" | "provider.tested" | "credential.lease_granted";
        /**
         * AuditEventDetail
         * @description The rest of what happened — **a flat object of scalars, and never anything else**.
         *
         *     Flatness is load-bearing rather than tidy: it is what makes *enumerate the keys and you
         *     have read the whole payload* true, and both of this repository's secrecy greps depend
         *     on it. A nested object would give a credential somewhere to hide from a top-level
         *     scan.
         *
         *     The keys depend on the action, and the set is closed by the writer's own types rather
         *     than by this schema — `kind` on every provider event, `outcome` (and `reason` on a
         *     failure) on all of them, `step_up` on a reveal, `fields` on an edit,
         *     `from_cap_cents`/`to_cap_cents` on a cap change, `latency_ms` on a test, and
         *     `lease`/`provider`/`address`/`expires_at` on a lease grant.
         *
         *     **There is no credential here and no code path that could put one here.** See the
         *     endpoint's description.
         * @example {
         *       "kind": "anthropic",
         *       "step_up": "password",
         *       "outcome": "success"
         *     }
         */
        AuditEventDetail: {
            [key: string]: string | number | boolean | null;
        };
        /**
         * AuditEvent
         * @description One thing that happened to this workspace's credentials, and who did it.
         */
        AuditEvent: {
            /**
             * Format: uuid
             * @description The event's own id — what a support conversation names.
             * @example 5eed0015-0000-4000-8000-000000000009
             */
            id: string;
            /**
             * Format: date-time
             * @description When it happened, ISO-8601 in UTC.
             * @example 2026-08-21T16:53:00.000Z
             */
            occurredAt: string;
            /**
             * @description Who did it, or `null`.
             *
             *     Two different `null`s, and this payload does not distinguish them because a reader
             *     cannot act on the difference: a lease grant never had an actor, and a person who
             *     has since been deleted left one behind.
             * @example 5eed0003-0000-4000-8000-000000000001
             */
            actorId: string | null;
            /**
             * @description Their name, or `null` on the same two terms.
             *
             *     **A name and never an address.** A trail that was a list of email addresses would
             *     be a trail worth exfiltrating, and the sheet renders a person rather than a
             *     mailbox.
             * @example Ken Suenobu
             */
            actorName: string | null;
            action: components["schemas"]["AuditAction"];
            /**
             * @description What kind of thing it was about — `provider_connection` for every `provider.*`
             *     event, `run` for a lease grant.
             * @example provider_connection
             */
            subjectType: string;
            /**
             * @description Which one, or `null` when the event named a kind rather than an instance — a
             *     refused `add` has no connection to name, because nothing was written.
             * @example 5eed000c-0000-4000-8000-000000000001
             */
            subjectId: string | null;
            /**
             * @description Where from, or `null` when no address was knowable.
             *
             *     The address this API saw. See the endpoint's description on what that honestly
             *     means behind a proxy, and why no forwarded header is trusted.
             * @example 198.51.100.24
             */
            ip: string | null;
            detail: components["schemas"]["AuditEventDetail"];
        };
        /**
         * AuditEventPage
         * @description One page of a workspace's credential trail, newest first.
         */
        AuditEventPage: {
            items: components["schemas"]["AuditEvent"][];
            /** @example 14 */
            total: number;
            /** @example 25 */
            limit: number;
            /** @example 0 */
            offset: number;
        };
        /**
         * ProviderConnectionKind
         * @description Which adapter reaches a provider (V015). The same six spellings a price's
         *     `connectionKind` carries, so a connection and a price agree about what kind of thing
         *     they describe without either translating.
         *
         *     Not every one of them is connectable in every build: a kind with no adapter compiled
         *     in answers `501 provider_kind_unsupported`, whose `details.registered` lists the ones
         *     that are.
         * @example anthropic
         * @enum {string}
         */
        ProviderConnectionKind: "anthropic" | "openai_compatible" | "ollama" | "copilot" | "cursor" | "custom";
        /**
         * ProviderConnectionStatus
         * @description What the last health check concluded — read-only on this surface, and written by the
         *     provider-health sweep ([#196](https://github.com/NobuData/ouroboros/issues/196)).
         *
         *     **Not the same thing as `enabled`.** The status is what a check measured; `enabled` is
         *     what a person decided, and *connected* beside a switch that is off is a real state.
         *     `unknown` is a state and must never be rendered as healthy.
         * @example active
         * @enum {string}
         */
        ProviderConnectionStatus: "active" | "paused" | "error" | "unknown";
        /**
         * ProviderConnection
         * @description One provider connection — the card mockup 07 draws, minus the two things another
         *     surface owns: the health detail is `GET /api/v1/routing/providers` and the model chips
         *     are the discovery surface.
         *
         *     **There is nowhere in this shape for a credential.** `mask` is a server-computed
         *     `••••Xq4A` and cannot be turned back into the key; the one endpoint that answers with
         *     a live value is `POST /api/v1/providers/{id}/reveal`.
         */
        ProviderConnection: {
            /**
             * Format: uuid
             * @description The connection, as every operation below the collection addresses it.
             * @example 5eed000c-0000-4000-8000-000000000001
             */
            id: string;
            kind: components["schemas"]["ProviderConnectionKind"];
            /**
             * @description The card's heading. Free text a workspace chose, and deliberately not unique — two
             *     Ollama daemons on two machines are two legitimate connections.
             * @example Anthropic Claude
             */
            displayName: string;
            /**
             * @description Where the provider is, or `null` for one reached at a fixed public endpoint.
             *     Required for `ollama` and `openai_compatible`, which have none to fall back on.
             * @example http://ken-station.local:11434
             */
            baseUrl: string | null;
            /**
             * @description The card's second line, verbatim — *api.anthropic.com · primary coding lane*. Null
             *     when there is nothing to say, and the card then draws one line instead of two.
             * @example self-hosted · A100 ×2
             */
            capabilityNote: string | null;
            status: components["schemas"]["ProviderConnectionStatus"];
            /**
             * @description The card's switch — may this connection be used at all. A disabled connection
             *     drops out of routing while its aliases and routes survive, which is the difference
             *     between switched off and deleted.
             * @example true
             */
            enabled: boolean;
            /**
             * @description The monthly cap in whole cents — `$600` is `60000` — or **`null` for no cap**,
             *     which mockup 07 renders as an em-dash. Null is not the same as `0`, which is a
             *     real instruction meaning *spend nothing*. Warning-only until the spend gate lands
             *     ([#237](https://github.com/NobuData/ouroboros/issues/237)).
             * @example 60000
             */
            monthlyCapCents: number | null;
            /**
             * @description The stored credential, masked: four bullets and its last four characters. `null`
             *     when this provider needs no credential — a local daemon, an unauthenticated
             *     endpoint — which is an ordinary state rather than an unfinished row.
             *
             *     Computed inside this service from the plaintext and unable to be reversed. It is
             *     the **only** thing this API says about a stored credential outside `reveal`.
             * @example ••••Xq4A
             */
            mask: string | null;
            /**
             * @description The person who connected this provider — the card's *Added by Ken* — or `null`.
             *     Null is both *nobody in this table added it* and *the person who did has since
             *     gone*: deleting a person must not delete their workspace's provider.
             * @example 5eed0003-0000-4000-8000-000000000001
             */
            addedBy: string | null;
            /**
             * Format: date-time
             * @description When the last health check finished, or `null` until one has.
             * @example 2026-08-23T09:59:41.882Z
             */
            lastCheckedAt: string | null;
            /**
             * Format: date-time
             * @description When something last invoked through this connection — the card's *last used 3m
             *     ago* — or `null` for *never used*. Written by the invocation gateway
             *     ([#235](https://github.com/NobuData/ouroboros/issues/235)); `null` is therefore
             *     the ordinary state today rather than a defect.
             * @example 2026-08-23T09:57:12.004Z
             */
            lastUsedAt: string | null;
            /**
             * Format: date-time
             * @example 2026-06-12T16:20:00.000Z
             */
            createdAt: string;
            /**
             * Format: date-time
             * @example 2026-08-23T09:59:41.882Z
             */
            updatedAt: string;
        };
        /**
         * ProviderConnectionPage
         * @description One page of a workspace's provider connections, ordered by display name.
         */
        ProviderConnectionPage: {
            items: components["schemas"]["ProviderConnection"][];
            /** @example 2 */
            total: number;
            /** @example 25 */
            limit: number;
            /** @example 0 */
            offset: number;
        };
        /**
         * ProviderConnectionConfig
         * @description A provider's own settings, keyed by the field names its `configSchema()` declares — a
         *     flat object of strings and nothing else.
         *
         *     The keys are **the adapter's**, which is why this schema cannot name them: a vLLM
         *     endpoint takes `baseUrl` and an optional key, Ollama takes a host, Anthropic takes a
         *     key. Two names are reserved across every adapter and land in columns of their own:
         *     `baseUrl` is the connection's address and `capabilityNote` is the card's second line.
         *     Whichever field the schema marks `x-ouroboros-secret` is the credential; it is sealed
         *     and is never readable again except through `reveal`.
         *
         *     At most 20 settings, each at most 2048 characters. A setting the adapter does not
         *     declare is a `422`; one it declares and this build has no column for is a `501` naming
         *     it, never a value silently dropped.
         * @example {
         *       "baseUrl": "http://10.0.4.20:8000/v1",
         *       "capabilityNote": "self-hosted · A100 ×2"
         *     }
         */
        ProviderConnectionConfig: {
            [key: string]: string;
        };
        /**
         * ProviderFormWidget
         * @description How one form field is drawn. Four values, **derived** from the adapter's schema rather
         *     than declared by it — a field marked secret is a masked row whatever else it says, an
         *     `enum` is a select, a `uri` is a URL input, and everything else is text — so an
         *     adapter author picks a widget by describing the field truthfully, and a fifth widget
         *     cannot be invented per provider.
         * @example secret
         * @enum {string}
         */
        ProviderFormWidget: "text" | "url" | "secret" | "select";
        /**
         * ProviderFormField
         * @description One field of an add-form, as the form renders it. Every optional schema keyword is an
         *     explicit `null` here rather than absent: absence is fine in a schema an author is
         *     writing, and unhelpful in a value a renderer is consuming.
         *
         *     The credential is the field whose `widget` is `secret`. At most one per entry, by the
         *     conformance kit; it is submitted in `config` like every other field and is routed to
         *     the vault by the service, never stored as a setting.
         */
        ProviderFormField: {
            /**
             * @description The property name — what the submitted value is keyed by in `config`. Never shown
             *     to a person. Two names are reserved across every adapter: `baseUrl` is the
             *     connection's address and `capabilityNote` is the card's second line.
             * @example apiKey
             */
            name: string;
            /**
             * @description What the `<label>` says.
             * @example API key
             */
            label: string;
            widget: components["schemas"]["ProviderFormWidget"];
            /**
             * @description Whether the schema requires a value.
             * @example true
             */
            required: boolean;
            /**
             * @description The help line under the input, or null.
             * @example Where the daemon is listening. No credential — it is your own machine.
             */
            help: string | null;
            /**
             * @description The input's placeholder, or null. Prose rather than an example value — mockup 07's
             *     *API key — optional, no auth configured* — which is why it is not the schema's
             *     `examples`.
             * @example sk-ant-api03-…
             */
            placeholder: string | null;
            /**
             * @description What the input starts at, or null. Never set on the secret field.
             * @example null
             */
            defaultValue: string | null;
            /**
             * @description The options for a `select`, or null for every other widget.
             * @example null
             */
            choices: string[] | null;
            /**
             * @description The shortest acceptable value, or null. `1` is how a schema says *not blank*.
             * @example 1
             */
            minLength: number | null;
            /**
             * @description The longest acceptable value, or null.
             * @example null
             */
            maxLength: number | null;
            /**
             * @description A regular expression the value must match, in ECMA-262 syntax, or null.
             * @example null
             */
            pattern: string | null;
        };
        /**
         * ProviderCatalogEntry
         * @description One connectable kind — a tile in mockup 07's catalog, and the form behind it. The
         *     `title` is the form's heading, straight from the adapter's schema (*Connect Anthropic*,
         *     *Connect an Ollama host*); `fields` is what the form draws, in order.
         */
        ProviderCatalogEntry: {
            kind: components["schemas"]["ProviderConnectionKind"];
            /**
             * @description The form's heading — the adapter's own `configSchema().title`.
             * @example Connect Anthropic
             */
            title: string;
            /**
             * @description The fields, in the order the form renders them — the schema's own property order,
             *     which is a contract rather than a coincidence (address first, key second, as
             *     mockup 07 draws the vLLM card).
             */
            fields: components["schemas"]["ProviderFormField"][];
        };
        /**
         * ProviderCatalog
         * @description Every kind this build can connect, in V015's declaration order. Empty only in a build
         *     that registers no adapter at all.
         */
        ProviderCatalog: {
            kinds: components["schemas"]["ProviderCatalogEntry"][];
        };
        /**
         * ProviderConnectionCreate
         * @description A provider to connect. Live-validated before anything is written; see
         *     `POST /api/v1/providers`.
         */
        ProviderConnectionCreate: {
            kind: components["schemas"]["ProviderConnectionKind"];
            /**
             * @description The card's heading. Trimmed and non-blank — a value carrying surrounding
             *     whitespace is refused rather than quietly trimmed, because storing something other
             *     than what was sent is the failure this surface refuses everywhere else.
             * @example Anthropic Claude
             */
            displayName: string;
            config: components["schemas"]["ProviderConnectionConfig"];
            /**
             * @description The monthly cap in whole cents. Absent or `null` is *no cap*, which is not the
             *     same as `0`.
             * @example 60000
             */
            monthlyCapCents?: number | null;
        };
        /**
         * ProviderConnectionPatch
         * @description What to change about a connection. Every field is optional, an absent field is left
         *     alone, and an explicit `null` clears the two settings whose absence is a value. A body
         *     that changes nothing is answered with the connection unchanged.
         */
        ProviderConnectionPatch: {
            /** @example Anthropic Claude */
            displayName?: string;
            /**
             * @description The card's switch. No `null` — a switch has two positions.
             * @example false
             */
            enabled?: boolean;
            /**
             * @description The monthly cap in whole cents. `null` clears it, which is *no cap*.
             * @example 75000
             */
            monthlyCapCents?: number | null;
            /**
             * @description The card's second line. `null` clears it. A connection field rather than a
             *     `config` one — sending it inside `config` is refused; see the operation.
             * @example api.anthropic.com · primary coding lane
             */
            capabilityNote?: string | null;
            config?: components["schemas"]["ProviderConnectionConfig"];
        };
        /**
         * ProviderRevealRequest
         * @description How this reveal is stepping up, if it is. An empty object is a legitimate body: a
         *     session created within the step-up window is itself a re-authentication, and so is a
         *     password confirmed within it.
         */
        ProviderRevealRequest: {
            /**
             * @description The caller's own password, compared against their credential account by
             *     BetterAuth. Never stored and never logged. A wrong one answers exactly as an
             *     absent one does — see the operation.
             * @example correct-horse-battery
             */
            password?: string;
        };
        /**
         * ProviderRevealed
         * @description A credential, in the clear — the one payload in this API that carries one. Sent with
         *     `Cache-Control: no-store`.
         */
        ProviderRevealed: {
            /**
             * Format: uuid
             * @description Which connection this belongs to, echoed so a page with two reveals in flight
             *     cannot paint one provider's key onto another's row.
             * @example 5eed000c-0000-4000-8000-000000000001
             */
            connectionId: string;
            /**
             * @description The credential.
             * @example sk-ant-api03-not-a-real-key-Xq4A
             */
            value: string;
            /**
             * Format: date-time
             * @description When a client should stop displaying the value and forget it. An **instruction**
             *     rather than an enforcement — a value handed to a browser is in the browser, and no
             *     header takes it back — published so that clients do not each invent a timeout, most
             *     of them *never*.
             * @example 2026-08-23T10:00:41.882Z
             */
            expiresAt: string;
        };
        /**
         * ProviderRotateRequest
         * @description The replacement credential. Live-validated before the old one is retired.
         */
        ProviderRotateRequest: {
            /**
             * @description The new credential. Not trimmed and not normalised: a credential is an opaque
             *     string, and a service that stripped a character would break a key that
             *     legitimately carried it.
             * @example sk-ant-api03-the-new-key-7Kd2
             */
            secret: string;
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
        /**
         * @description A provider connection's id. A connection of another workspace answers `404`, never
         *     `403`: confirming that an identifier names something real is the whole of what
         *     enumerating identifiers is for.
         * @example 5eed000c-0000-4000-8000-000000000001
         */
        ConnectionId: string;
        /**
         * @description The escalation rule's id. It must belong to the workspace the session is acting in;
         *     another workspace's answers `404`, exactly as an id that names nothing does.
         * @example f0000000-0000-4000-8000-000000000002
         */
        EscalationRuleId: string;
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
    getModelParamSchema: {
        parameters: {
            query: {
                /**
                 * @description The provider connection the alias is bound to. Omit it to ask about an unbound
                 *     alias — see the description.
                 */
                connection?: string;
                /**
                 * @description The model's own identifier, exactly as the provider spells it and as the alias
                 *     stores it. Unfolded — `claude-fable-5` and `qwen3-coder:32b` are two vendors'
                 *     conventions and neither is normalised.
                 */
                model: string;
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
            /** @description The two schemas, the fields they render as, and where each bound came from. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "modelId": "qwen3-coder:32b",
                     *       "connectionId": "9c4a5f6e-7d8c-4b10-8f43-5a6b7c8d9e01",
                     *       "params": {
                     *         "schema": {
                     *           "$schema": "https://json-schema.org/draft/2020-12/schema",
                     *           "type": "object",
                     *           "title": "Ollama model parameters",
                     *           "properties": {
                     *             "context_clamp": {
                     *               "type": "integer",
                     *               "title": "Context clamp",
                     *               "description": "`num_ctx` — hold this model to a smaller context than it was loaded with.",
                     *               "minimum": 1,
                     *               "maximum": 32768,
                     *               "x-ouroboros-sources": [
                     *                 "adapter",
                     *                 "discovery"
                     *               ]
                     *             }
                     *           },
                     *           "additionalProperties": false
                     *         },
                     *         "fields": [
                     *           {
                     *             "name": "context_clamp",
                     *             "label": "Context clamp",
                     *             "widget": "integer",
                     *             "help": "`num_ctx` — hold this model to a smaller context than it was loaded with.",
                     *             "defaultValue": null,
                     *             "choices": null,
                     *             "minimum": 1,
                     *             "maximum": 32768,
                     *             "sources": [
                     *               "adapter",
                     *               "discovery"
                     *             ]
                     *           }
                     *         ]
                     *       },
                     *       "restrictions": {
                     *         "schema": {
                     *           "$schema": "https://json-schema.org/draft/2020-12/schema",
                     *           "type": "object",
                     *           "title": "Registry restrictions",
                     *           "description": "What this workspace allows this alias to be used for. Registry policy rather than provider capability, so it is offered on every alias — including one with no provider bound yet.",
                     *           "properties": {
                     *             "review_vote_only": {
                     *               "type": "boolean",
                     *               "title": "Review vote only",
                     *               "description": "This alias may cast a review vote and may not be routed work of its own.",
                     *               "x-ouroboros-sources": [
                     *                 "registry"
                     *               ]
                     *             },
                     *             "batch_ok": {
                     *               "type": "boolean",
                     *               "title": "Batch ok",
                     *               "description": "Work routed to this alias may be batched rather than sent one call at a time.",
                     *               "x-ouroboros-sources": [
                     *                 "registry"
                     *               ]
                     *             }
                     *           },
                     *           "additionalProperties": false
                     *         },
                     *         "fields": [
                     *           {
                     *             "name": "review_vote_only",
                     *             "label": "Review vote only",
                     *             "widget": "switch",
                     *             "help": "This alias may cast a review vote and may not be routed work of its own.",
                     *             "defaultValue": null,
                     *             "choices": null,
                     *             "minimum": null,
                     *             "maximum": null,
                     *             "sources": [
                     *               "registry"
                     *             ]
                     *           },
                     *           {
                     *             "name": "batch_ok",
                     *             "label": "Batch ok",
                     *             "widget": "switch",
                     *             "help": "Work routed to this alias may be batched rather than sent one call at a time.",
                     *             "defaultValue": null,
                     *             "choices": null,
                     *             "minimum": null,
                     *             "maximum": null,
                     *             "sources": [
                     *               "registry"
                     *             ]
                     *           }
                     *         ]
                     *       },
                     *       "reason": null,
                     *       "sources": [
                     *         "adapter",
                     *         "discovery",
                     *         "registry"
                     *       ]
                     *     }
                     */
                    "application/json": components["schemas"]["ModelParamSchemaResponse"];
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
             * @description `provider_connection_not_found` — `connection` names no connection in this
             *     workspace, or `tenant_not_found` when `X-Ouro-Tenant` names no workspace you are a
             *     member of. A connection that is absent and one that is somebody else's are
             *     deliberately one answer.
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
             * @description `validation_failed` — `model` was missing or malformed, or `connection` was not a
             *     uuid. `details` carries the entry keyed by the field.
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
    listModelAliases: {
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
             * @description Every alias, ordered by name. Empty for a workspace with none — the registry's
             *     empty state, not a failure.
             */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "aliases": [
                     *         {
                     *           "id": "5eed000f-0000-4000-8000-000000000001",
                     *           "alias": "coder-max",
                     *           "enabled": true,
                     *           "connection": {
                     *             "id": "5eed000c-0000-4000-8000-000000000001",
                     *             "kind": "anthropic",
                     *             "displayName": "Anthropic Claude"
                     *           },
                     *           "modelId": "claude-fable-5",
                     *           "params": {
                     *             "thinking": "max",
                     *             "token_budget": 400000
                     *           },
                     *           "restrictions": {},
                     *           "notes": null,
                     *           "references": [
                     *             {
                     *               "kind": "route",
                     *               "refId": "5eed0012-0000-4000-8000-000000000007",
                     *               "label": "implement-primary",
                     *               "blocking": true
                     *             },
                     *             {
                     *               "kind": "escalation",
                     *               "refId": "5eed0013-0000-4000-8000-000000000001",
                     *               "label": "escalation:effort≥L",
                     *               "blocking": true
                     *             }
                     *           ],
                     *           "updatedBy": "5eed0002-0000-4000-8000-000000000001",
                     *           "createdAt": "2026-06-12T16:20:00.000Z",
                     *           "updatedAt": "2026-08-23T09:59:41.882Z"
                     *         },
                     *         {
                     *           "id": "5eed000f-0000-4000-8000-000000000008",
                     *           "alias": "gpt5-experiments",
                     *           "enabled": false,
                     *           "connection": null,
                     *           "modelId": "gpt-5.2-preview",
                     *           "params": {},
                     *           "restrictions": {},
                     *           "notes": null,
                     *           "references": [],
                     *           "updatedBy": null,
                     *           "createdAt": "2026-08-20T10:00:00.000Z",
                     *           "updatedAt": "2026-08-20T10:00:00.000Z"
                     *         }
                     *       ]
                     *     }
                     */
                    "application/json": components["schemas"]["ModelAliasList"];
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
        };
    };
    createModelAlias: {
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
                 *       "alias": "coder-max",
                 *       "connectionId": "5eed000c-0000-4000-8000-000000000001",
                 *       "modelId": "claude-fable-5",
                 *       "params": {
                 *         "thinking": "max",
                 *         "token_budget": 400000
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["CreateModelAlias"];
            };
        };
        responses: {
            /** @description The alias as stored, re-read after the commit; its revision; and any warnings. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "alias": {
                     *         "id": "5eed000f-0000-4000-8000-000000000001",
                     *         "alias": "coder-max",
                     *         "enabled": true,
                     *         "connection": {
                     *           "id": "5eed000c-0000-4000-8000-000000000001",
                     *           "kind": "anthropic",
                     *           "displayName": "Anthropic Claude"
                     *         },
                     *         "modelId": "claude-fable-5",
                     *         "params": {
                     *           "thinking": "max",
                     *           "token_budget": 400000
                     *         },
                     *         "restrictions": {},
                     *         "notes": null,
                     *         "references": [],
                     *         "updatedBy": "5eed0002-0000-4000-8000-000000000001",
                     *         "createdAt": "2026-08-24T10:00:00.000Z",
                     *         "updatedAt": "2026-08-24T10:00:00.000Z"
                     *       },
                     *       "revisionId": "a1000000-0000-4000-8000-000000000001",
                     *       "warnings": [],
                     *       "nextResolution": null,
                     *       "droppedHops": []
                     *     }
                     */
                    "application/json": components["schemas"]["ModelAliasChange"];
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
             *     this. Creating an alias is `owner` or `admin`.
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
             *
             *     `provider_connection_not_found` — `connectionId` names no connection in this
             *     workspace. The same answer for *no such connection* and *another workspace's*.
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
             * @description `validation_failed` — the body is malformed: a name that is not lower-case kebab, a
             *     `connectionId` that is not a uuid, a `params` that is not an object, a field this
             *     body does not declare. `details` names each field.
             *
             *     `model_alias_name_taken` — this workspace already has an alias by that name.
             *     `details.alias` is the name.
             *
             *     `model_alias_params_invalid` — a param or a restriction the bound model cannot
             *     honour, or any param at all on an unbound alias. `details` names each field —
             *     `params.thinking`, `restrictions.batch_ok` — with the schema's own sentence.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listModelOptions: {
        parameters: {
            query: {
                /** @description The connection whose models to list — `provider_connections.id`, in this workspace. */
                connection: string;
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
            /** @description The connection, and its models ordered by id. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "connection": {
                     *         "id": "5eed000c-0000-4000-8000-000000000001",
                     *         "kind": "anthropic",
                     *         "displayName": "Anthropic Claude"
                     *       },
                     *       "models": [
                     *         {
                     *           "modelId": "claude-fable-5",
                     *           "display": "claude-fable-5",
                     *           "discoveredAt": "2026-08-24T09:56:00.000Z",
                     *           "meta": {
                     *             "context_tokens": 1000000,
                     *             "tier": "priority"
                     *           }
                     *         },
                     *         {
                     *           "modelId": "claude-sonnet-5",
                     *           "display": "claude-sonnet-5",
                     *           "discoveredAt": "2026-08-24T09:56:00.000Z",
                     *           "meta": {
                     *             "context_tokens": 1000000,
                     *             "tier": "priority"
                     *           }
                     *         }
                     *       ]
                     *     }
                     */
                    "application/json": components["schemas"]["ModelOptionList"];
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
             *
             *     `provider_connection_not_found` — `connection` names no connection in this
             *     workspace, or another workspace's.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `validation_failed` — `connection` is missing or is not a uuid. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteModelAlias: {
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
                /** @description The alias — `model_aliases.id`. */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Gone. */
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
             *     this. Removing an alias is `owner` or `admin`.
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
             *
             *     `model_alias_not_found` — no alias with that id in this workspace.
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
             * @description `model_alias_referenced` — routes, rules or workflows reference the alias, and
             *     nothing was deleted. `details.references` names every one with its kind and its
             *     chip label — the work list. Repoint them, then retry.
             */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "code": "model_alias_referenced",
                     *       "message": "coder-max cannot be removed while 4 references reference it. Repoint them first — see details.references for each one.",
                     *       "details": {
                     *         "alias": "coder-max",
                     *         "references": [
                     *           {
                     *             "kind": "route",
                     *             "refId": "5eed0012-0000-4000-8000-000000000007",
                     *             "label": "implement-primary",
                     *             "blocking": true
                     *           },
                     *           {
                     *             "kind": "route",
                     *             "refId": "5eed0012-0000-4000-8000-000000000005",
                     *             "label": "plan-primary",
                     *             "blocking": true
                     *           },
                     *           {
                     *             "kind": "route",
                     *             "refId": "5eed0012-0000-4000-8000-000000000012",
                     *             "label": "review-primary",
                     *             "blocking": true
                     *           },
                     *           {
                     *             "kind": "escalation",
                     *             "refId": "5eed0013-0000-4000-8000-000000000001",
                     *             "label": "escalation:effort≥L",
                     *             "blocking": true
                     *           }
                     *         ]
                     *       }
                     *     }
                     */
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateModelAlias: {
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
                /** @description The alias — `model_aliases.id`. */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "connectionId": "5eed000c-0000-4000-8000-000000000006"
                 *     }
                 */
                "application/json": components["schemas"]["UpdateModelAlias"];
            };
        };
        responses: {
            /**
             * @description The alias after the change, re-read after the commit; the revision the write left
             *     (null when it changed nothing); the warnings; and what the write did —
             *     `nextResolution` after a rebind, `droppedHops` after switching a referenced alias
             *     off.
             */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "alias": {
                     *         "id": "5eed000f-0000-4000-8000-000000000001",
                     *         "alias": "coder-max",
                     *         "enabled": true,
                     *         "connection": {
                     *           "id": "5eed000c-0000-4000-8000-000000000006",
                     *           "kind": "anthropic",
                     *           "displayName": "Anthropic — Bedrock"
                     *         },
                     *         "modelId": "claude-fable-5",
                     *         "params": {
                     *           "thinking": "max",
                     *           "token_budget": 400000
                     *         },
                     *         "restrictions": {},
                     *         "notes": null,
                     *         "references": [
                     *           {
                     *             "kind": "route",
                     *             "refId": "5eed0012-0000-4000-8000-000000000007",
                     *             "label": "implement-primary",
                     *             "blocking": true
                     *           },
                     *           {
                     *             "kind": "route",
                     *             "refId": "5eed0012-0000-4000-8000-000000000005",
                     *             "label": "plan-primary",
                     *             "blocking": true
                     *           },
                     *           {
                     *             "kind": "route",
                     *             "refId": "5eed0012-0000-4000-8000-000000000012",
                     *             "label": "review-primary",
                     *             "blocking": true
                     *           },
                     *           {
                     *             "kind": "escalation",
                     *             "refId": "5eed0013-0000-4000-8000-000000000001",
                     *             "label": "escalation:effort≥L",
                     *             "blocking": true
                     *           }
                     *         ],
                     *         "updatedBy": "5eed0002-0000-4000-8000-000000000001",
                     *         "createdAt": "2026-06-12T16:20:00.000Z",
                     *         "updatedAt": "2026-08-24T10:05:00.000Z"
                     *       },
                     *       "revisionId": "a1000000-0000-4000-8000-000000000002",
                     *       "warnings": [],
                     *       "nextResolution": {
                     *         "connection": {
                     *           "id": "5eed000c-0000-4000-8000-000000000006",
                     *           "kind": "anthropic",
                     *           "displayName": "Anthropic — Bedrock"
                     *         },
                     *         "modelId": "claude-fable-5"
                     *       },
                     *       "droppedHops": []
                     *     }
                     */
                    "application/json": components["schemas"]["ModelAliasChange"];
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
             *     this. Editing an alias is `owner` or `admin`.
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
             *
             *     `model_alias_not_found` — no alias with that id in this workspace. The same answer
             *     for *no such alias* and *another workspace's*.
             *
             *     `provider_connection_not_found` — `connectionId` names no connection in this
             *     workspace.
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
             * @description `validation_failed` — the body is malformed. `details` names each field.
             *
             *     `model_alias_unbound` — the alias has no provider connection and the body asked to
             *     enable it. `details.fix` is the path to Providers & keys.
             *
             *     `model_alias_rename_blocked` — the body asked for a new name and routes, rules or
             *     workflows reference the alias. `details.references` names each, with its kind.
             *
             *     `model_alias_name_taken` — the new name is taken in this workspace.
             *
             *     `model_alias_params_invalid` — a param or a restriction the bound model — after
             *     this write — cannot honour. `details` names each field.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    duplicateModelAlias: {
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
                /** @description The alias to copy — `model_aliases.id`. */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The copy as stored — `<alias>-copy`, switched off — and its revision. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "alias": {
                     *         "id": "5eed000f-0000-4000-8000-000000000009",
                     *         "alias": "coder-max-copy",
                     *         "enabled": false,
                     *         "connection": {
                     *           "id": "5eed000c-0000-4000-8000-000000000001",
                     *           "kind": "anthropic",
                     *           "displayName": "Anthropic Claude"
                     *         },
                     *         "modelId": "claude-fable-5",
                     *         "params": {
                     *           "thinking": "max",
                     *           "token_budget": 400000
                     *         },
                     *         "restrictions": {},
                     *         "notes": null,
                     *         "references": [],
                     *         "updatedBy": "5eed0002-0000-4000-8000-000000000001",
                     *         "createdAt": "2026-08-24T10:10:00.000Z",
                     *         "updatedAt": "2026-08-24T10:10:00.000Z"
                     *       },
                     *       "revisionId": "a1000000-0000-4000-8000-000000000003",
                     *       "warnings": [],
                     *       "nextResolution": null,
                     *       "droppedHops": []
                     *     }
                     */
                    "application/json": components["schemas"]["ModelAliasChange"];
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
             *     this. Duplicating an alias is `owner` or `admin`.
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
             *
             *     `model_alias_not_found` — no alias with that id in this workspace.
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
             * @description `model_alias_copy_name_too_long` — the suffixed name would exceed the 64
             *     characters an alias may have. Rename the alias to something shorter first;
             *     `details.proposed` is the name that did not fit.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    readRoutingMatrix: {
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
             * @description The matrix and the rules. Both arrays are empty for a workspace whose routing
             *     foundations have not been seeded — the page's empty state, not a failure.
             */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "taskKinds": [
                     *         {
                     *           "name": "implement",
                     *           "description": "Write the change, run tests, iterate to green",
                     *           "sortOrder": 4,
                     *           "route": {
                     *             "id": "5eed0011-0000-4000-8000-000000000004",
                     *             "taskKind": "implement",
                     *             "tag": "implement-primary",
                     *             "allowLocalFallback": true,
                     *             "floorHopIndex": null,
                     *             "maxCostCentsPerRun": 250,
                     *             "hops": [
                     *               {
                     *                 "position": 1,
                     *                 "alias": "coder-max",
                     *                 "modelId": "claude-fable-5",
                     *                 "note": "Primary",
                     *                 "provider": {
                     *                   "id": "6f1d2c3b-4a59-4e87-9c10-2d3e4f5a6b70",
                     *                   "kind": "anthropic",
                     *                   "displayName": "Anthropic",
                     *                   "baseUrl": null
                     *                 }
                     *               },
                     *               {
                     *                 "position": 2,
                     *                 "alias": "coder-fallback",
                     *                 "modelId": "gpt-5-codex",
                     *                 "note": "Fallback on 5xx / timeouts",
                     *                 "provider": {
                     *                   "id": "8b3f4e5d-6c7b-4a09-9e32-4f5a6b7c8d92",
                     *                   "kind": "copilot",
                     *                   "displayName": "GitHub Copilot",
                     *                   "baseUrl": null
                     *                 }
                     *               }
                     *             ],
                     *             "stats": {
                     *               "costCentsPerRunAvg": 87,
                     *               "latencyP50Ms": 41000,
                     *               "pricedCalls": 15,
                     *               "unpricedCalls": 0,
                     *               "timedCalls": 15
                     *             },
                     *             "updatedAt": "2026-08-23T09:58:12.004Z",
                     *             "updatedBy": "5eed0003-0000-4000-8000-000000000001"
                     *           }
                     *         },
                     *         {
                     *           "name": "docs",
                     *           "description": "Draft and revise the written record",
                     *           "sortOrder": 7,
                     *           "route": null
                     *         }
                     *       ],
                     *       "rules": [
                     *         {
                     *           "id": "f0000000-0000-4000-8000-000000000001",
                     *           "enabled": true,
                     *           "sortOrder": 1,
                     *           "when": {
                     *             "effort_gte": "l"
                     *           },
                     *           "then": {
                     *             "use_alias": {
                     *               "task_kind": "implement",
                     *               "alias": "coder-max",
                     *               "params": {
                     *                 "thinking": "max"
                     *               }
                     *             }
                     *           },
                     *           "display": "effort ≥ L → implement uses coder-max (max thinking)"
                     *         }
                     *       ],
                     *       "spend": {
                     *         "window": {
                     *           "days": 30,
                     *           "since": "2026-07-24T09:58:12.004Z",
                     *           "until": "2026-08-23T09:58:12.004Z"
                     *         },
                     *         "providers": [
                     *           {
                     *             "key": "anthropic",
                     *             "kinds": [
                     *               "anthropic"
                     *             ],
                     *             "local": false,
                     *             "spendCents": 41280,
                     *             "meterFraction": 1,
                     *             "tokens": 35000000,
                     *             "pricedCalls": 101,
                     *             "unpricedCalls": 0
                     *           },
                     *           {
                     *             "key": "copilot",
                     *             "kinds": [
                     *               "copilot"
                     *             ],
                     *             "local": false,
                     *             "spendCents": 7600,
                     *             "meterFraction": 0.1841085271317829,
                     *             "tokens": 8180000,
                     *             "pricedCalls": 21,
                     *             "unpricedCalls": 0
                     *           },
                     *           {
                     *             "key": "cursor",
                     *             "kinds": [
                     *               "cursor"
                     *             ],
                     *             "local": false,
                     *             "spendCents": 6410,
                     *             "meterFraction": 0.15528100775193798,
                     *             "tokens": 5120000,
                     *             "pricedCalls": 6,
                     *             "unpricedCalls": 0
                     *           },
                     *           {
                     *             "key": "ollama+openai_compatible",
                     *             "kinds": [
                     *               "ollama",
                     *               "openai_compatible"
                     *             ],
                     *             "local": true,
                     *             "spendCents": 0,
                     *             "meterFraction": 0,
                     *             "tokens": 21700000,
                     *             "pricedCalls": 260,
                     *             "unpricedCalls": 5
                     *           }
                     *         ],
                     *         "totalSpendCents": 55290,
                     *         "tokens": 70000000,
                     *         "localTokens": 21700000,
                     *         "localTokenShare": 0.31,
                     *         "unpricedCalls": 5
                     *       }
                     *     }
                     */
                    "application/json": components["schemas"]["RoutingMatrix"];
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
    listRoutingAliases: {
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
             * @description Every alias, ordered by name. Empty for a workspace with none — the routing page's
             *     empty state, not a failure.
             */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "aliases": [
                     *         {
                     *           "alias": "coder-max",
                     *           "modelId": "claude-fable-5",
                     *           "params": {
                     *             "thinking": "max"
                     *           },
                     *           "provider": {
                     *             "id": "6f1d2c3b-4a59-4e87-9c10-2d3e4f5a6b70",
                     *             "kind": "anthropic",
                     *             "displayName": "Anthropic",
                     *             "baseUrl": null
                     *           }
                     *         },
                     *         {
                     *           "alias": "gpt5-experiments",
                     *           "modelId": "gpt-5-preview",
                     *           "params": {},
                     *           "provider": null
                     *         }
                     *       ]
                     *     }
                     */
                    "application/json": components["schemas"]["RoutingAliasList"];
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
    readRoutingSpend: {
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
             * @description The card. `providers` is empty, `totalSpendCents` and `localTokenShare` are null and
             *     the counts are zero for a workspace that has spent nothing in the window — the
             *     card's zero-state, and never `$0.00` for usage nobody priced.
             */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoutingSpend"];
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
    saveRoutes: {
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
                 *       "routes": [
                 *         {
                 *           "taskKind": "implement",
                 *           "hops": [
                 *             {
                 *               "alias": "coder-max",
                 *               "note": "Primary"
                 *             },
                 *             {
                 *               "alias": "coder-fallback",
                 *               "note": "Fallback on 5xx / timeouts"
                 *             },
                 *             {
                 *               "alias": "local-docs",
                 *               "note": null
                 *             }
                 *           ],
                 *           "allowLocalFallback": true,
                 *           "floorHopIndex": 2,
                 *           "maxCostCentsPerRun": 250
                 *         }
                 *       ]
                 *     }
                 */
                "application/json": components["schemas"]["SaveRoutesRequest"];
            };
        };
        responses: {
            /**
             * @description The revision this save wrote — `null` when it changed nothing — and the routes as
             *     they now stand, re-read after the commit rather than echoed from the request.
             */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "revisionId": "a1000000-0000-4000-8000-000000000001",
                     *       "routes": [
                     *         {
                     *           "id": "5eed0011-0000-4000-8000-000000000004",
                     *           "taskKind": "implement",
                     *           "tag": "implement-primary",
                     *           "allowLocalFallback": true,
                     *           "floorHopIndex": 2,
                     *           "maxCostCentsPerRun": 250,
                     *           "hops": [
                     *             {
                     *               "position": 1,
                     *               "alias": "coder-max",
                     *               "modelId": "claude-fable-5",
                     *               "note": "Primary",
                     *               "provider": {
                     *                 "id": "6f1d2c3b-4a59-4e87-9c10-2d3e4f5a6b70",
                     *                 "kind": "anthropic",
                     *                 "displayName": "Anthropic",
                     *                 "baseUrl": null
                     *               }
                     *             }
                     *           ],
                     *           "stats": {
                     *             "costCentsPerRunAvg": 87,
                     *             "latencyP50Ms": 41000,
                     *             "pricedCalls": 15,
                     *             "unpricedCalls": 0,
                     *             "timedCalls": 15
                     *           },
                     *           "updatedAt": "2026-08-23T09:58:12.004Z",
                     *           "updatedBy": "5eed0003-0000-4000-8000-000000000001"
                     *         }
                     *       ]
                     *     }
                     */
                    "application/json": components["schemas"]["SaveRoutesResult"];
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
             *     this. Editing routes is `owner` or `admin`; `member` and `viewer` may read them.
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
             * @description Two codes, and the difference is which layer refused the request. **Nothing was
             *     saved** in either case.
             *
             *     `validation_failed` — the body is malformed: an empty chain, a note that is blank or
             *     padded, a cap of zero, a floor below 1, an alias that is not lower-case kebab.
             *     `details` is keyed by field path, `routes.0.hops` and the like.
             *
             *     `route_save_invalid` — the body is well formed and this workspace cannot honour it:
             *     a task kind it does not have, a task kind with no route to save onto, the same kind
             *     twice in one batch, an alias it has never bound, or a floor deeper than the chain
             *     sent with it. `details.routes` is keyed by **task kind**, so each complaint maps
             *     back to the row of the matrix that produced it.
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
    saveRoute: {
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
                 * @description The task kind whose route this is — the mono label the matrix row prints,
                 *     `implement` or `commit-msg`. Lower-case letters, digits and single hyphens: the
                 *     shape the column itself is constrained to, so a path that could not name a kind is
                 *     refused before a statement is issued.
                 * @example implement
                 */
                taskKind: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "hops": [
                 *         {
                 *           "alias": "coder-max",
                 *           "note": "Primary"
                 *         },
                 *         {
                 *           "alias": "local-docs",
                 *           "note": null
                 *         }
                 *       ],
                 *       "allowLocalFallback": true,
                 *       "floorHopIndex": null,
                 *       "maxCostCentsPerRun": 250
                 *     }
                 */
                "application/json": components["schemas"]["RoutePolicy"];
            };
        };
        responses: {
            /**
             * @description The same envelope the batch answers with, so a client has one shape to read: the
             *     revision, and the route as it now stands.
             */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "revisionId": null,
                     *       "routes": [
                     *         {
                     *           "id": "5eed0011-0000-4000-8000-000000000004",
                     *           "taskKind": "implement",
                     *           "tag": "implement-primary",
                     *           "allowLocalFallback": true,
                     *           "floorHopIndex": null,
                     *           "maxCostCentsPerRun": 250,
                     *           "hops": [
                     *             {
                     *               "position": 1,
                     *               "alias": "coder-max",
                     *               "modelId": "claude-fable-5",
                     *               "note": "Primary",
                     *               "provider": {
                     *                 "id": "6f1d2c3b-4a59-4e87-9c10-2d3e4f5a6b70",
                     *                 "kind": "anthropic",
                     *                 "displayName": "Anthropic",
                     *                 "baseUrl": null
                     *               }
                     *             }
                     *           ],
                     *           "stats": {
                     *             "costCentsPerRunAvg": 87,
                     *             "latencyP50Ms": 41000,
                     *             "pricedCalls": 15,
                     *             "unpricedCalls": 0,
                     *             "timedCalls": 15
                     *           },
                     *           "updatedAt": "2026-08-23T09:58:12.004Z",
                     *           "updatedBy": "5eed0003-0000-4000-8000-000000000001"
                     *         }
                     *       ]
                     *     }
                     */
                    "application/json": components["schemas"]["SaveRoutesResult"];
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
             *     this. Editing routes is `owner` or `admin`.
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
             *
             *     A task kind this workspace does not have is **not** a `404` here: it is a
             *     `422 route_save_invalid` naming the kind, because the batch operation this shares
             *     an implementation with names its kinds in a body and both must answer alike.
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
             * @description `validation_failed` or `route_save_invalid`, exactly as the batch operation
             *     documents them — including for a task kind this workspace does not have, or has no
             *     route for. Nothing was saved.
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
    addEscalationRule: {
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
                 *       "when": {
                 *         "label": "security"
                 *       },
                 *       "then": {
                 *         "add_vote": {
                 *           "task_kind": "review",
                 *           "alias": "second-opinion"
                 *         }
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["CreateEscalationRule"];
            };
        };
        responses: {
            /** @description The rule as stored, with the sentence the database derived from it. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "f0000000-0000-4000-8000-000000000002",
                     *       "enabled": true,
                     *       "sortOrder": 2,
                     *       "when": {
                     *         "label": "security"
                     *       },
                     *       "then": {
                     *         "add_vote": {
                     *           "task_kind": "review",
                     *           "alias": "second-opinion"
                     *         }
                     *       },
                     *       "display": "security label → review adds second-opinion vote"
                     *     }
                     */
                    "application/json": components["schemas"]["EscalationRule"];
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
             *     this. Editing escalation rules is `owner` or `admin`.
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
             * @description `escalation_rule_sort_order_taken` — another rule already evaluates at that
             *     position. Nothing about the request is malformed and a retry of it unchanged
             *     answers the same thing: move the other rule, or leave `sortOrder` out to be
             *     appended. `details.sortOrder` is the position that is taken.
             */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `validation_failed` — the body is malformed: `when` or `then` is not an object, or
             *     it carries a `display` this API does not accept from a client.
             *
             *     `escalation_rule_invalid` — the body is well formed and the routing domain refuses
             *     it: a predicate with no condition or an unknown one, an action that is not exactly
             *     one of the three, or a rule naming a task kind or model alias this workspace does
             *     not have. `details.fields` is keyed `when` and `then`.
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
    removeEscalationRule: {
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
                 * @description The escalation rule's id. It must belong to the workspace the session is acting in;
                 *     another workspace's answers `404`, exactly as an id that names nothing does.
                 * @example f0000000-0000-4000-8000-000000000002
                 */
                id: components["parameters"]["EscalationRuleId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Gone. No body. */
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
             *     this. Editing escalation rules is `owner` or `admin`.
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
             * @description `escalation_rule_not_found` — this workspace has no rule by that id, which is also
             *     the answer for another workspace's.
             *
             *     `tenant_not_found` — the `X-Ouro-Tenant` header names no workspace, or none you are
             *     a member of.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `validation_failed` — the path segment is not a uuid, so it could not name a rule. */
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
    changeEscalationRule: {
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
                 * @description The escalation rule's id. It must belong to the workspace the session is acting in;
                 *     another workspace's answers `404`, exactly as an id that names nothing does.
                 * @example f0000000-0000-4000-8000-000000000002
                 */
                id: components["parameters"]["EscalationRuleId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "enabled": false
                 *     }
                 */
                "application/json": components["schemas"]["UpdateEscalationRule"];
            };
        };
        responses: {
            /** @description The rule as it now stands, its sentence regenerated from whatever changed. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "f0000000-0000-4000-8000-000000000002",
                     *       "enabled": false,
                     *       "sortOrder": 2,
                     *       "when": {
                     *         "label": "security"
                     *       },
                     *       "then": {
                     *         "add_vote": {
                     *           "task_kind": "review",
                     *           "alias": "second-opinion"
                     *         }
                     *       },
                     *       "display": "security label → review adds second-opinion vote"
                     *     }
                     */
                    "application/json": components["schemas"]["EscalationRule"];
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
             *     this. Editing escalation rules is `owner` or `admin`.
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
             * @description `escalation_rule_not_found` — this workspace has no rule by that id. The same
             *     answer for *no such rule* and *another workspace's rule*, deliberately: telling
             *     the two apart would let somebody enumerate another workspace's rules by watching
             *     which ids answer differently.
             *
             *     `tenant_not_found` — the `X-Ouro-Tenant` header names no workspace, or none you are
             *     a member of.
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
             * @description `escalation_rule_sort_order_taken` — another rule already evaluates at the position
             *     this request asked for.
             */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `validation_failed` or `escalation_rule_invalid`, exactly as adding a rule documents
             *     them — including the refusal of a client-supplied `display`.
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
    simulateRouting: {
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
                "application/json": components["schemas"]["RoutingSimulationRequest"];
            };
        };
        responses: {
            /**
             * @description The resolution — the chain with a reason on every hop, the rules that matched and
             *     what each did, any votes the executor must also obtain, the floor's decision and
             *     the cost cap.
             *
             *     **`outcome: "fail_run"` arrives here**, not in an error status. It is a successful
             *     answer to a well-formed question, and `failure` carries the reason.
             */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Resolution"];
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
             * @description `route_not_found` — this workspace has no route for that task kind. The one failure
             *     that is not an answer: there is no chain to explain. Reachable two ways and both are
             *     the caller's — a kind the workspace never had, and a kind that exists with no route
             *     pointing at it. `details.taskKind` echoes what was asked for.
             *
             *     `tenant_not_found` — the `X-Ouro-Tenant` header names no workspace, or none you are
             *     a member of. The two are deliberately one answer.
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
             * @description `validation_failed` — the body is malformed: a `taskKind` outside the shape a task
             *     kind has, an `effort` that is not one of the five sizes, a `diffKind` nothing
             *     classifies, or a `ctx` carrying a condition no escalation rule could read.
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
    listProviderHealth: {
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
             * @description The strip. Empty for a workspace that has configured no providers — the page's
             *     empty state, not a failure.
             */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "providers": [
                     *         {
                     *           "id": "6f1d2c3b-4a59-4e87-9c10-2d3e4f5a6b70",
                     *           "kind": "anthropic",
                     *           "displayName": "Anthropic",
                     *           "status": "active",
                     *           "check": "key_validation",
                     *           "checkedAt": "2026-08-23T09:58:12.004Z",
                     *           "host": null,
                     *           "latencyMs": 42,
                     *           "models": null,
                     *           "detail": null,
                     *           "meta": "42ms"
                     *         },
                     *         {
                     *           "id": "7a2e3d4c-5b6a-4f98-8d21-3e4f5a6b7c81",
                     *           "kind": "cursor",
                     *           "displayName": "Cursor",
                     *           "status": "unknown",
                     *           "check": null,
                     *           "checkedAt": null,
                     *           "host": null,
                     *           "latencyMs": null,
                     *           "models": null,
                     *           "detail": null,
                     *           "meta": null
                     *         },
                     *         {
                     *           "id": "8b3f4e5d-6c7b-4a09-9e32-4f5a6b7c8d92",
                     *           "kind": "copilot",
                     *           "displayName": "GitHub Copilot",
                     *           "status": "error",
                     *           "check": null,
                     *           "checkedAt": "2026-08-23T09:41:00.000Z",
                     *           "host": null,
                     *           "latencyMs": null,
                     *           "models": null,
                     *           "detail": "degraded · elevated latency",
                     *           "meta": "degraded · elevated latency"
                     *         },
                     *         {
                     *           "id": "9c4a5f6e-7d8c-4b10-8f43-5a6b7c8d9e03",
                     *           "kind": "ollama",
                     *           "displayName": "Ollama",
                     *           "status": "active",
                     *           "check": "reachability",
                     *           "checkedAt": "2026-08-23T09:59:41.882Z",
                     *           "host": "workstation",
                     *           "latencyMs": null,
                     *           "models": 3,
                     *           "detail": null,
                     *           "meta": "workstation · 3 models"
                     *         },
                     *         {
                     *           "id": "0d5b6a7f-8e9d-4c21-9a54-6b7c8d9e0f14",
                     *           "kind": "openai_compatible",
                     *           "displayName": "OpenAI-compatible",
                     *           "status": "active",
                     *           "check": "reachability",
                     *           "checkedAt": "2026-08-23T09:59:41.902Z",
                     *           "host": "vllm-local",
                     *           "latencyMs": null,
                     *           "models": 2,
                     *           "detail": null,
                     *           "meta": "vllm-local · 2 models"
                     *         }
                     *       ]
                     *     }
                     */
                    "application/json": components["schemas"]["ProviderHealthStrip"];
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
    listProviderConnections: {
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
             * @description The page. Empty for a workspace that has connected nothing — mockup 07's
             *     dashed-card empty state, not a failure.
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
                     *           "id": "5eed000c-0000-4000-8000-000000000001",
                     *           "kind": "anthropic",
                     *           "displayName": "Anthropic Claude",
                     *           "baseUrl": null,
                     *           "capabilityNote": "api.anthropic.com · primary coding lane",
                     *           "status": "active",
                     *           "enabled": true,
                     *           "monthlyCapCents": 60000,
                     *           "mask": "••••Xq4A",
                     *           "addedBy": "5eed0003-0000-4000-8000-000000000001",
                     *           "lastCheckedAt": "2026-08-23T09:59:41.882Z",
                     *           "lastUsedAt": "2026-08-23T09:57:12.004Z",
                     *           "createdAt": "2026-06-12T16:20:00.000Z",
                     *           "updatedAt": "2026-08-23T09:59:41.882Z"
                     *         },
                     *         {
                     *           "id": "5eed000c-0000-4000-8000-000000000005",
                     *           "kind": "ollama",
                     *           "displayName": "Ollama · workstation",
                     *           "baseUrl": "http://ken-station.local:11434",
                     *           "capabilityNote": "zero-cost lane — used for docs & commit messages",
                     *           "status": "active",
                     *           "enabled": true,
                     *           "monthlyCapCents": null,
                     *           "mask": null,
                     *           "addedBy": "5eed0003-0000-4000-8000-000000000001",
                     *           "lastCheckedAt": "2026-08-23T09:59:40.101Z",
                     *           "lastUsedAt": null,
                     *           "createdAt": "2026-05-14T08:55:00.000Z",
                     *           "updatedAt": "2026-08-23T09:59:40.101Z"
                     *         }
                     *       ],
                     *       "total": 2,
                     *       "limit": 25,
                     *       "offset": 0
                     *     }
                     */
                    "application/json": components["schemas"]["ProviderConnectionPage"];
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
    addProviderConnection: {
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
                 *       "kind": "anthropic",
                 *       "displayName": "Anthropic Claude",
                 *       "monthlyCapCents": 60000,
                 *       "config": {
                 *         "apiKey": "sk-ant-api03-not-a-real-key-Xq4A"
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["ProviderConnectionCreate"];
            };
        };
        responses: {
            /** @description The connection, as it was stored, with its credential masked. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "5eed000c-0000-4000-8000-000000000001",
                     *       "kind": "anthropic",
                     *       "displayName": "Anthropic Claude",
                     *       "baseUrl": null,
                     *       "capabilityNote": null,
                     *       "status": "active",
                     *       "enabled": true,
                     *       "monthlyCapCents": 60000,
                     *       "mask": "••••Xq4A",
                     *       "addedBy": "5eed0003-0000-4000-8000-000000000001",
                     *       "lastCheckedAt": "2026-08-23T09:59:41.882Z",
                     *       "lastUsedAt": null,
                     *       "createdAt": "2026-08-23T09:59:41.882Z",
                     *       "updatedAt": "2026-08-23T09:59:41.882Z"
                     *     }
                     */
                    "application/json": components["schemas"]["ProviderConnection"];
                };
            };
            /**
             * @description `organization_required` — this session is not acting in any workspace and this
             *     operation names none.
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
             *     honour.
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
             *     this. Connecting a provider is `owner` or `admin`; `member` and `viewer` may read
             *     the list.
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
             * @description One of three, and they are worth telling apart:
             *
             *     * `validation_failed` — the body's own shape is wrong. `details` is keyed by field.
             *     * `provider_config_invalid` — the body is well-formed and does not satisfy the
             *       adapter's `configSchema()`. `details.fields` is keyed by config field name, in
             *       the same shape, so one renderer serves both.
             *     * `provider_validation_failed` — the **provider** refused the configuration or the
             *       credential. `details.errorClass` is one of `auth`, `network`, `rate_limit`,
             *       `server`, `config`, and `details.detail` is the note mockup 07's card foot would
             *       draw — `key rejected (401)`. Nothing was stored.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `internal_error` — the service itself failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Either `provider_kind_unsupported` — this build has no adapter for that kind, and
             *     `details.registered` lists the ones it has — or `provider_config_not_storable`,
             *     which names the submitted settings this build has no column for. Both are a
             *     capability this deployment lacks rather than a mistake the caller made, which is
             *     why neither is a `4xx`.
             */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listProviderAuditEvents: {
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
                /**
                 * @description Only events about this connection. *What has been done to this key* — the first
                 *     question a trail is opened with.
                 *
                 *     Matched against the event's subject, which carries no foreign key: an event about
                 *     a connection outlives the connection, and `provider.deleted` is exactly the row a
                 *     foreign key would have made unwritable.
                 * @example 5eed000c-0000-4000-8000-000000000001
                 */
                connectionId?: string;
                /**
                 * @description Only events by this person. *What has this person done.*
                 *
                 *     A `"user".id`, which is text minted by BetterAuth rather than a uuid this service
                 *     constrains — so it is bounded in length and not in shape.
                 * @example 5eed0003-0000-4000-8000-000000000002
                 */
                actorId?: string;
                /**
                 * @description Only events of this kind. *Who has revealed anything.*
                 *
                 *     Validated against the vocabulary rather than accepted as free text: a filter
                 *     naming an event this service never writes would return an empty page, which is
                 *     indistinguishable from *nothing has happened yet* — and `provider.reveal` is a
                 *     typo, not a finding.
                 */
                action?: components["schemas"]["AuditAction"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /**
             * @description The page, newest first. Ordered by instant then id, so two events inside the same
             *     millisecond page deterministically rather than swapping places between requests.
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
                     *           "id": "5eed0015-0000-4000-8000-000000000014",
                     *           "occurredAt": "2026-08-24T16:13:00.000Z",
                     *           "actorId": "5eed0003-0000-4000-8000-000000000001",
                     *           "actorName": "Ken Suenobu",
                     *           "action": "provider.revealed",
                     *           "subjectType": "provider_connection",
                     *           "subjectId": "5eed000c-0000-4000-8000-000000000001",
                     *           "ip": "198.51.100.24",
                     *           "detail": {
                     *             "kind": "anthropic",
                     *             "step_up": "session",
                     *             "outcome": "success"
                     *           }
                     *         },
                     *         {
                     *           "id": "5eed0015-0000-4000-8000-000000000013",
                     *           "occurredAt": "2026-08-24T15:23:00.000Z",
                     *           "actorId": null,
                     *           "actorName": null,
                     *           "action": "credential.lease_granted",
                     *           "subjectType": "run",
                     *           "subjectId": "5eed0009-0000-4000-8000-000000000482",
                     *           "ip": "10.0.4.20",
                     *           "detail": {
                     *             "kind": "ollama",
                     *             "ttl_seconds": 900
                     *           }
                     *         }
                     *       ],
                     *       "total": 14,
                     *       "limit": 25,
                     *       "offset": 0
                     *     }
                     */
                    "application/json": components["schemas"]["AuditEventPage"];
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
             *     this. Reading the credential trail is `owner` or `admin`. `details.role` is what
             *     you hold and `details.required` is what would have been enough.
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
             * @description `validation_failed` — a filter or a window parameter was out of range, not an
             *     integer, not a uuid, or named an action this service does not write. `details`
             *     carries the entry keyed by the field.
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
    listProviderCatalog: {
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
             * @description The catalog, in the order V015 declares the kinds — stable between builds rather
             *     than an injector's ordering. Empty only in a build that registers no adapter.
             */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "kinds": [
                     *         {
                     *           "kind": "anthropic",
                     *           "title": "Connect Anthropic",
                     *           "fields": [
                     *             {
                     *               "name": "apiKey",
                     *               "label": "API key",
                     *               "widget": "secret",
                     *               "required": true,
                     *               "help": null,
                     *               "placeholder": "sk-ant-api03-…",
                     *               "defaultValue": null,
                     *               "choices": null,
                     *               "minLength": 1,
                     *               "maxLength": null,
                     *               "pattern": null
                     *             }
                     *           ]
                     *         },
                     *         {
                     *           "kind": "openai_compatible",
                     *           "title": "Connect an OpenAI-compatible endpoint",
                     *           "fields": [
                     *             {
                     *               "name": "baseUrl",
                     *               "label": "Base URL",
                     *               "widget": "url",
                     *               "required": true,
                     *               "help": "The OpenAI-compatible root — vLLM, LM Studio, llama.cpp, TGI.",
                     *               "placeholder": "http://10.0.4.20:8000/v1",
                     *               "defaultValue": null,
                     *               "choices": null,
                     *               "minLength": 1,
                     *               "maxLength": null,
                     *               "pattern": null
                     *             },
                     *             {
                     *               "name": "apiKey",
                     *               "label": "API key",
                     *               "widget": "secret",
                     *               "required": false,
                     *               "help": null,
                     *               "placeholder": "API key — optional, no auth configured",
                     *               "defaultValue": null,
                     *               "choices": null,
                     *               "minLength": null,
                     *               "maxLength": null,
                     *               "pattern": null
                     *             }
                     *           ]
                     *         },
                     *         {
                     *           "kind": "ollama",
                     *           "title": "Connect an Ollama host",
                     *           "fields": [
                     *             {
                     *               "name": "baseUrl",
                     *               "label": "Host",
                     *               "widget": "url",
                     *               "required": true,
                     *               "help": "Where the daemon is listening. No credential — it is your own machine.",
                     *               "placeholder": "http://ken-station.local:11434",
                     *               "defaultValue": null,
                     *               "choices": null,
                     *               "minLength": 1,
                     *               "maxLength": null,
                     *               "pattern": null
                     *             }
                     *           ]
                     *         }
                     *       ]
                     *     }
                     */
                    "application/json": components["schemas"]["ProviderCatalog"];
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
    readProviderConnection: {
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
                 * @description A provider connection's id. A connection of another workspace answers `404`, never
                 *     `403`: confirming that an identifier names something real is the whole of what
                 *     enumerating identifiers is for.
                 * @example 5eed000c-0000-4000-8000-000000000001
                 */
                id: components["parameters"]["ConnectionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The connection. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "5eed000c-0000-4000-8000-000000000004",
                     *       "kind": "openai_compatible",
                     *       "displayName": "OpenAI-compatible · local vLLM",
                     *       "baseUrl": "http://10.0.4.20:8000/v1",
                     *       "capabilityNote": "self-hosted · A100 ×2",
                     *       "status": "active",
                     *       "enabled": true,
                     *       "monthlyCapCents": null,
                     *       "mask": null,
                     *       "addedBy": "5eed0003-0000-4000-8000-000000000001",
                     *       "lastCheckedAt": "2026-08-23T09:59:38.221Z",
                     *       "lastUsedAt": "2026-08-23T09:50:12.000Z",
                     *       "createdAt": "2026-05-30T14:12:00.000Z",
                     *       "updatedAt": "2026-08-23T09:59:38.221Z"
                     *     }
                     */
                    "application/json": components["schemas"]["ProviderConnection"];
                };
            };
            /**
             * @description `organization_required` — this session is not acting in any workspace and this
             *     operation names none.
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
             *     honour.
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
             * @description `provider_connection_not_found` — this workspace has no connection with that id,
             *     including when another workspace does. Or `tenant_not_found`, when the
             *     `X-Ouro-Tenant` header names no workspace you are a member of.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `validation_failed` — `id` is not a uuid. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `internal_error` — the service itself failed. */
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
    removeProviderConnection: {
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
                 * @description A provider connection's id. A connection of another workspace answers `404`, never
                 *     `403`: confirming that an identifier names something real is the whole of what
                 *     enumerating identifiers is for.
                 * @example 5eed000c-0000-4000-8000-000000000001
                 */
                id: components["parameters"]["ConnectionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The connection is gone. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /**
             * @description `organization_required` — this session is not acting in any workspace and this
             *     operation names none.
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
             *     honour.
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
             *     this. Disconnecting a provider is `owner` or `admin`.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `provider_connection_not_found`, or `tenant_not_found`. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `provider_connection_in_use` — model aliases still resolve on this connection.
             *     `details.aliases` names them, sorted, and `details.connectionId` echoes the
             *     connection. Repoint or remove the aliases first; nothing about the request is
             *     wrong, so retrying it unchanged gets the same answer.
             */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `validation_failed` — `id` is not a uuid. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `internal_error` — the service itself failed. */
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
    updateProviderConnection: {
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
                 * @description A provider connection's id. A connection of another workspace answers `404`, never
                 *     `403`: confirming that an identifier names something real is the whole of what
                 *     enumerating identifiers is for.
                 * @example 5eed000c-0000-4000-8000-000000000001
                 */
                id: components["parameters"]["ConnectionId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "enabled": false,
                 *       "monthlyCapCents": 75000
                 *     }
                 */
                "application/json": components["schemas"]["ProviderConnectionPatch"];
            };
        };
        responses: {
            /** @description The connection after the change. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "5eed000c-0000-4000-8000-000000000001",
                     *       "kind": "anthropic",
                     *       "displayName": "Anthropic Claude",
                     *       "baseUrl": null,
                     *       "capabilityNote": "api.anthropic.com · primary coding lane",
                     *       "status": "active",
                     *       "enabled": false,
                     *       "monthlyCapCents": 75000,
                     *       "mask": "••••Xq4A",
                     *       "addedBy": "5eed0003-0000-4000-8000-000000000001",
                     *       "lastCheckedAt": "2026-08-23T09:59:41.882Z",
                     *       "lastUsedAt": "2026-08-23T09:57:12.004Z",
                     *       "createdAt": "2026-06-12T16:20:00.000Z",
                     *       "updatedAt": "2026-08-23T10:02:00.000Z"
                     *     }
                     */
                    "application/json": components["schemas"]["ProviderConnection"];
                };
            };
            /**
             * @description `organization_required` — this session is not acting in any workspace and this
             *     operation names none.
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
             *     honour.
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
             *     this. Editing a connection is `owner` or `admin`.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `provider_connection_not_found`, or `tenant_not_found`. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `validation_failed`, `provider_config_invalid` or `provider_validation_failed` —
             *     on exactly the terms `POST /api/v1/providers` describes. A refused edit changes
             *     nothing.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `internal_error` — the service itself failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `provider_kind_unsupported` or `provider_config_not_storable`, as
             *     `POST /api/v1/providers` describes. Reachable only from a body carrying `config`.
             */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    revealProviderCredential: {
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
                 * @description A provider connection's id. A connection of another workspace answers `404`, never
                 *     `403`: confirming that an identifier names something real is the whole of what
                 *     enumerating identifiers is for.
                 * @example 5eed000c-0000-4000-8000-000000000001
                 */
                id: components["parameters"]["ConnectionId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "password": "correct-horse-battery"
                 *     }
                 */
                "application/json": components["schemas"]["ProviderRevealRequest"];
            };
        };
        responses: {
            /** @description The credential, and when to stop showing it. Sent with `Cache-Control: no-store`. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "connectionId": "5eed000c-0000-4000-8000-000000000001",
                     *       "value": "sk-ant-api03-not-a-real-key-Xq4A",
                     *       "expiresAt": "2026-08-23T10:00:41.882Z"
                     *     }
                     */
                    "application/json": components["schemas"]["ProviderRevealed"];
                };
            };
            /**
             * @description `organization_required` — this session is not acting in any workspace and this
             *     operation names none.
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
             * @description `step_up_required` — there is no recent re-authentication on this session, or the
             *     password offered was not accepted. `details.methods` names what would satisfy it
             *     and `details.maxAgeSeconds` how long a proof counts for.
             *
             *     Or `unauthenticated`, when the request carries no session at all.
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
             *     this. Revealing a credential is `owner` or `admin`.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `provider_connection_not_found`, or `tenant_not_found`. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `provider_credential_absent` — this connection stores no credential. A local
             *     provider is reached without one, which V015 makes an ordinary state rather than an
             *     unfinished row.
             */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `validation_failed` — `id` is not a uuid, or `password` is not a string of 1–128
             *     characters.
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
             * @description `provider_reveal_rate_limited` — too many attempts. `details.scope` is `user` or
             *     `connection`, and `details.retryAfterSeconds` is how long until that limit has
             *     room. Waiting works; retrying immediately does not.
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `internal_error` — the service itself failed. */
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
    rotateProviderCredential: {
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
                 * @description A provider connection's id. A connection of another workspace answers `404`, never
                 *     `403`: confirming that an identifier names something real is the whole of what
                 *     enumerating identifiers is for.
                 * @example 5eed000c-0000-4000-8000-000000000001
                 */
                id: components["parameters"]["ConnectionId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "secret": "sk-ant-api03-the-new-key-7Kd2"
                 *     }
                 */
                "application/json": components["schemas"]["ProviderRotateRequest"];
            };
        };
        responses: {
            /** @description The connection after the swap, masked with the new credential's suffix. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "5eed000c-0000-4000-8000-000000000001",
                     *       "kind": "anthropic",
                     *       "displayName": "Anthropic Claude",
                     *       "baseUrl": null,
                     *       "capabilityNote": "api.anthropic.com · primary coding lane",
                     *       "status": "active",
                     *       "enabled": true,
                     *       "monthlyCapCents": 60000,
                     *       "mask": "••••7Kd2",
                     *       "addedBy": "5eed0003-0000-4000-8000-000000000001",
                     *       "lastCheckedAt": "2026-08-23T10:04:02.510Z",
                     *       "lastUsedAt": "2026-08-23T09:57:12.004Z",
                     *       "createdAt": "2026-06-12T16:20:00.000Z",
                     *       "updatedAt": "2026-08-23T10:04:02.510Z"
                     *     }
                     */
                    "application/json": components["schemas"]["ProviderConnection"];
                };
            };
            /**
             * @description `organization_required` — this session is not acting in any workspace and this
             *     operation names none.
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
             *     honour.
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
             *     this. Rotating a credential is `owner` or `admin`.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `provider_connection_not_found`, or `tenant_not_found`. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `provider_credential_absent` — this provider takes no credential, so there is
             *     nothing to rotate. Or `provider_connection_changed` — the row was rewritten while
             *     the new credential was being checked; read it again and retry.
             */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `validation_failed` — `id` is not a uuid, or `secret` is not a string of 1–4096
             *     characters. Or `provider_validation_failed` — the provider refused the new
             *     credential, and **the old one is still live**. `details.errorClass` and
             *     `details.detail` say what the provider said.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `internal_error` — the service itself failed. */
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
