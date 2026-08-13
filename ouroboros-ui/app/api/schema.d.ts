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
             * Format: uuid
             * @description The `{orgId}` every other operation in this document takes.
             * @example 5eed0001-0000-4000-8000-000000000001
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
             * Format: uuid
             * @description The workspace it belongs to.
             * @example 5eed0001-0000-4000-8000-000000000001
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
             * Format: uuid
             * @description The workspace it belongs to.
             * @example 5eed0001-0000-4000-8000-000000000001
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
         * @example 5eed0001-0000-4000-8000-000000000001
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
         *     On the operations below it is **optional and redundant**: they already name a
         *     workspace in their path, which is the more specific of the two, and a header that
         *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
         *     silent preference for either. It is accepted here so that one client can set it on
         *     every request, and it is how the operations that have no workspace in their path say
         *     which workspace they mean.
         *
         *     A caller who omits it is acting in their session's active organization. A session
         *     that has none — a person who belongs to no workspace, one whose workspace was
         *     deleted, one who was removed from it — gets a `400` with
         *     `code: "organization_required"` on any operation that names no workspace of its own.
         *     Every operation that takes this header also names a workspace in its path, so none of
         *     them can answer it; the one operation that names none is `GET /api/v1/orgs`, which
         *     does not take this header at all, because *which workspaces are yours* is the question
         *     somebody in that state is asking.
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
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path say
                 *     which workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     Every operation that takes this header also names a workspace in its path, so none of
                 *     them can answer it; the one operation that names none is `GET /api/v1/orgs`, which
                 *     does not take this header at all, because *which workspaces are yours* is the question
                 *     somebody in that state is asking.
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
                 * @example 5eed0001-0000-4000-8000-000000000001
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
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path say
                 *     which workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     Every operation that takes this header also names a workspace in its path, so none of
                 *     them can answer it; the one operation that names none is `GET /api/v1/orgs`, which
                 *     does not take this header at all, because *which workspaces are yours* is the question
                 *     somebody in that state is asking.
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
                 * @example 5eed0001-0000-4000-8000-000000000001
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
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path say
                 *     which workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     Every operation that takes this header also names a workspace in its path, so none of
                 *     them can answer it; the one operation that names none is `GET /api/v1/orgs`, which
                 *     does not take this header at all, because *which workspaces are yours* is the question
                 *     somebody in that state is asking.
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
                 * @example 5eed0001-0000-4000-8000-000000000001
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
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path say
                 *     which workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     Every operation that takes this header also names a workspace in its path, so none of
                 *     them can answer it; the one operation that names none is `GET /api/v1/orgs`, which
                 *     does not take this header at all, because *which workspaces are yours* is the question
                 *     somebody in that state is asking.
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
                 * @example 5eed0001-0000-4000-8000-000000000001
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
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path say
                 *     which workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     Every operation that takes this header also names a workspace in its path, so none of
                 *     them can answer it; the one operation that names none is `GET /api/v1/orgs`, which
                 *     does not take this header at all, because *which workspaces are yours* is the question
                 *     somebody in that state is asking.
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
                 * @example 5eed0001-0000-4000-8000-000000000001
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
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path say
                 *     which workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     Every operation that takes this header also names a workspace in its path, so none of
                 *     them can answer it; the one operation that names none is `GET /api/v1/orgs`, which
                 *     does not take this header at all, because *which workspaces are yours* is the question
                 *     somebody in that state is asking.
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
                 * @example 5eed0001-0000-4000-8000-000000000001
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
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path say
                 *     which workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     Every operation that takes this header also names a workspace in its path, so none of
                 *     them can answer it; the one operation that names none is `GET /api/v1/orgs`, which
                 *     does not take this header at all, because *which workspaces are yours* is the question
                 *     somebody in that state is asking.
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
                 * @example 5eed0001-0000-4000-8000-000000000001
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
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path say
                 *     which workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     Every operation that takes this header also names a workspace in its path, so none of
                 *     them can answer it; the one operation that names none is `GET /api/v1/orgs`, which
                 *     does not take this header at all, because *which workspaces are yours* is the question
                 *     somebody in that state is asking.
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
                 * @example 5eed0001-0000-4000-8000-000000000001
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
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path say
                 *     which workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     Every operation that takes this header also names a workspace in its path, so none of
                 *     them can answer it; the one operation that names none is `GET /api/v1/orgs`, which
                 *     does not take this header at all, because *which workspaces are yours* is the question
                 *     somebody in that state is asking.
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
                 * @example 5eed0001-0000-4000-8000-000000000001
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
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path say
                 *     which workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     Every operation that takes this header also names a workspace in its path, so none of
                 *     them can answer it; the one operation that names none is `GET /api/v1/orgs`, which
                 *     does not take this header at all, because *which workspaces are yours* is the question
                 *     somebody in that state is asking.
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
                 * @example 5eed0001-0000-4000-8000-000000000001
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
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path say
                 *     which workspace they mean.
                 *
                 *     A caller who omits it is acting in their session's active organization. A session
                 *     that has none — a person who belongs to no workspace, one whose workspace was
                 *     deleted, one who was removed from it — gets a `400` with
                 *     `code: "organization_required"` on any operation that names no workspace of its own.
                 *     Every operation that takes this header also names a workspace in its path, so none of
                 *     them can answer it; the one operation that names none is `GET /api/v1/orgs`, which
                 *     does not take this header at all, because *which workspaces are yours* is the question
                 *     somebody in that state is asking.
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
                 * @example 5eed0001-0000-4000-8000-000000000001
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
