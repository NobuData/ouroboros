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
    "/api/v1/tenants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List your workspaces
         * @description One page of the workspaces the signed-in person belongs to, oldest first.
         *
         *     **Scoped to the caller**, never the installation's whole table: a listing that
         *     enumerated every workspace would be a larger existence leak than the `403` this API
         *     answers `404` to avoid, and it would be one request rather than a scan. Somebody who
         *     belongs to none gets an empty page.
         *
         *     It is one of the three operations that need no active workspace, and the reason is
         *     circularity: this is the question a workspace switcher asks *before* it can name
         *     one.
         *
         *     Ordered by creation time and then by id. The second term is not decoration: two
         *     tenants created in the same millisecond would otherwise be free to swap places
         *     between requests, and a paginated read could show one of them twice and the other
         *     never.
         */
        get: operations["listTenants"];
        put?: never;
        /**
         * Create a tenant
         * @description Create a tenant.
         *
         *     The slug is chosen rather than derived from the display name: it appears in paths
         *     and command arguments and is the thing a person types, and a generator that turned
         *     `Acme, Inc.` into `acme-inc` would be one more rule to keep in step with the
         *     database's own.
         *
         *     **The caller becomes its `owner`**, in the same transaction. That is not a
         *     convenience: a workspace with no members is one every route under it answers `404`
         *     to, including for the person who has just made it, so the two rows are written
         *     together or not at all.
         *
         *     The tenant is created with no domains and no organisations. It is `active` from the
         *     moment it exists — the status is a lifecycle, not an approval. This operation needs
         *     no active workspace, because somebody creating their first belongs to none.
         */
        post: operations["createTenant"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tenants/{tenantId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read a tenant
         * @description Read one tenant by its id.
         */
        get: operations["readTenant"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Change a tenant
         * @description Rename a tenant, re-slug it, or change its status. Every field is optional, and a
         *     body naming none of them answers with the tenant unchanged — which is what `PATCH`
         *     means, and a friendlier answer than refusing a request that asked for nothing.
         *
         *     `status: "deleted"` is the soft delete. The row and everything cascading from it
         *     survive, so it is one further `PATCH` away from being undone; there is no `DELETE`
         *     for a tenant at all.
         */
        patch: operations["updateTenant"];
        trace?: never;
    };
    "/api/v1/tenants/{tenantId}/domains": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a tenant's domains
         * @description One page of this tenant's email domains, the primary first and then alphabetically —
         *     the order a settings screen reads in, rather than whatever creation time produced.
         */
        get: operations["listDomains"];
        put?: never;
        /**
         * Claim a domain
         * @description Claim an email domain for this tenant, optionally as the one the product displays
         *     back.
         *
         *     `isPrimary: true` demotes whichever domain currently holds it, in the same
         *     transaction — the database permits only one primary per tenant, and the two
         *     statements are what make changing it possible at all.
         */
        post: operations["addDomain"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tenants/{tenantId}/domains/{domainId}": {
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
         * Give up a domain
         * @description Remove a domain from this tenant. Removing the primary is permitted, for the same
         *     reason demoting it is.
         */
        delete: operations["removeDomain"];
        options?: never;
        head?: never;
        /**
         * Set or clear a domain's primary flag
         * @description Promote this domain to the tenant's primary, or demote it.
         *
         *     Demotion may leave the tenant with no primary at all, deliberately: zero is a legal
         *     state, and refusing it would make "replace the domain we display" an operation with
         *     no order that works.
         */
        patch: operations["setDomainPrimary"];
        trace?: never;
    };
    "/api/v1/tenants/{tenantId}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a tenant's members
         * @description One page of this tenant's members, by name, each row carrying the person's own
         *     details — this is the query mockup 17's member table renders.
         */
        get: operations["listMembers"];
        put?: never;
        /**
         * Invite somebody
         * @description Invite a person to this tenant, by email address.
         *
         *     **A stub, deliberately.** The membership is created with `joinedAt` null and nothing
         *     is sent: what turns an outstanding invitation into a joined member is the sign-in
         *     [#33](https://github.com/NobuData/ouroboros/issues/33) adds, which is the first
         *     thing that can honestly say somebody accepted.
         *
         *     A person Ouroboros has never heard of is created here so the membership has
         *     something to point at. One that already exists is reused and their display name is
         *     left alone — a person is one row across every tenant they belong to, and an inviter
         *     typing a name into a form is not authority to rename them in the others.
         */
        post: operations["inviteMember"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tenants/{tenantId}/members/{userId}": {
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
         * Remove a member
         * @description Remove somebody from this tenant. The person is not deleted — they may hold roles in
         *     other tenants, and one human is one row across all of them.
         */
        delete: operations["removeMember"];
        options?: never;
        head?: never;
        /**
         * Change a member's role
         * @description Change what a member may do in this tenant.
         *
         *     Demoting the tenant's last `owner` is refused — see the `409` below. Promoting
         *     somebody *to* owner never is: it cannot reduce the number of owners.
         */
        patch: operations["changeMemberRole"];
        trace?: never;
    };
    "/api/v1/tenants/{tenantId}/orgs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a tenant's GitHub organisations
         * @description One page of this tenant's GitHub organisations, by login — **including the disabled
         *     ones**, because a settings screen has to render the switch that is off, and a list
         *     that hid them would make turning one back on impossible through this API.
         */
        get: operations["listOrgs"];
        put?: never;
        /**
         * Record a GitHub organisation
         * @description Record a GitHub organisation for this tenant, switched off unless the request asks
         *     otherwise.
         *
         *     Enablement is per tenant rather than global: two tenants may each enable an
         *     organisation they both belong to, and each holds its own flag and its own
         *     installation.
         */
        post: operations["addOrg"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tenants/{tenantId}/orgs/{login}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Enable or disable a GitHub organisation
         * @description Turn an organisation on or off for this tenant.
         *
         *     Turning it off suspends everything under it without discarding the per-repository
         *     choices underneath — which is why there are two flags rather than one, and why this
         *     touches only the organisation's.
         */
        patch: operations["setOrgEnabled"];
        trace?: never;
    };
    "/api/v1/tenants/{tenantId}/orgs/{login}/repos": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List an organisation's repositories
         * @description One page of the repositories recorded under this organisation, by name, enabled or
         *     not.
         *
         *     A repository is in scope for Ouroboros only when its own `enabled` **and** its
         *     organisation's are both true. Neither this operation nor the one below applies that
         *     rule — they set the flags; whatever is about to act on a repository is what has to
         *     find both of them true.
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
    "/api/v1/tenants/{tenantId}/orgs/{login}/repos/{name}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Enable or disable a repository
         * @description Turn a repository on or off — **and record it if this is the first Ouroboros has
         *     heard of it.**
         *
         *     There is no `POST` for a repository, and that is why this one creates. The GitHub App
         *     installation flow that would discover repositories is future product work, so nothing
         *     exists today to have created a row for a person to then switch on; making this an
         *     upsert keeps "turn this repository on" a single request either way, and doing it in
         *     one statement keeps it correct when two people do it at once.
         *
         *     `defaultBranch` is left alone when the request omits it rather than cleared: it is
         *     discovered from GitHub, and an enable/disable is not the thing that should forget it.
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
             * @example last_owner
             * @example validation_failed
             */
            code: string;
            /**
             * @description Written for a person. It may name a value the caller sent and never names
             *     anything about the service's own internals — no driver text, no stack, no
             *     constraint. A `500`'s message is a constant for exactly that reason.
             * @example That domain belongs to another tenant.
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
         * Tenant
         * @description An isolated customer workspace — the root of everything else in the API.
         */
        Tenant: {
            /**
             * Format: uuid
             * @description Stable for the tenant's whole life. The slug is not; this is what to store.
             * @example 9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10
             */
            id: string;
            /**
             * @description The URL- and CLI-safe handle, unique across the installation. DNS-label shaped,
             *     which keeps it usable if one is ever wanted as a subdomain.
             * @example acme
             */
            slug: string;
            /**
             * @description What a human reads. Free text; it carries no machine meaning.
             * @example Acme, Inc.
             */
            displayName: string;
            /**
             * @description The lifecycle. `deleted` is a soft-delete marker: the row and everything
             *     cascading from it survive, so it is recoverable.
             * @example active
             * @enum {string}
             */
            status: "active" | "suspended" | "deleted";
            /**
             * Format: date-time
             * @example 2026-08-11T10:20:23.114Z
             */
            createdAt: string;
            /**
             * Format: date-time
             * @description Maintained by the database on every write; never accepted from a client.
             * @example 2026-08-11T10:20:23.114Z
             */
            updatedAt: string;
        };
        /**
         * TenantPage
         * @description One page of tenants.
         */
        TenantPage: {
            /** @description The rows for this window, oldest first. */
            items: components["schemas"]["Tenant"][];
            /**
             * @description How many rows there are in total, ignoring the window.
             * @example 1
             */
            total: number;
            /**
             * @description The window that was applied — the default, when the request named none.
             * @example 25
             */
            limit: number;
            /** @example 0 */
            offset: number;
        };
        /**
         * Domain
         * @description An email domain that resolves a tenant at sign-in.
         */
        Domain: {
            /**
             * Format: uuid
             * @example 4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94
             */
            id: string;
            /**
             * Format: uuid
             * @example 9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10
             */
            tenantId: string;
            /**
             * @description Lower-cased, and unique across the whole installation rather than within the
             *     tenant — a domain names exactly one tenant at sign-in.
             * @example acme.example
             */
            domain: string;
            /**
             * @description The domain the product displays back. At most one per tenant, and zero is legal
             *     for a tenant part-way through setting itself up.
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
         * @description One page of a tenant's domains, the primary first.
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
         * Member
         * @description A person's membership of one tenant, with the person's own details alongside — one
         *     row of a member table.
         *
         *     Flattened rather than nested, and with no id of its own: the membership *is* the
         *     `(tenantId, userId)` pair, which is what a `PATCH` or a `DELETE` addresses.
         */
        Member: {
            /**
             * Format: uuid
             * @example 9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10
             */
            tenantId: string;
            /**
             * Format: uuid
             * @example c7b1e2f4-5a63-4d8e-b0c9-7f2a1d3e6b85
             */
            userId: string;
            /**
             * Format: email
             * @description Lower-cased and unique across the installation. How a person is recognised and
             *     contacted — not how they authenticate.
             * @example ada@acme.example
             */
            email: string;
            /**
             * @description What the member list prints. For somebody who has never signed in this is the
             *     name their inviter gave, or the local part of their address.
             * @example Ada Lovelace
             */
            displayName: string;
            /**
             * @description An `http(s)` URL, or `null` when none is known — which is every person who has
             *     not signed in yet. A placeholder is the UI's decision, so none is invented here.
             * @example https://avatars.example/ada.png
             * @example null
             */
            avatarUrl: string | null;
            /**
             * @description What this person may do in this tenant.
             * @example owner
             * @enum {string}
             */
            role: "owner" | "admin" | "member" | "viewer";
            /**
             * Format: date-time
             * @description When the invitation was issued. Also when the membership came into being.
             * @example 2026-08-11T10:20:23.114Z
             */
            invitedAt: string;
            /**
             * Format: date-time
             * @description When it was accepted, or `null` while it is outstanding — a real state the member
             *     list renders, and what an invitation looks like until #33's sign-in exists.
             * @example 2026-08-11T10:24:51.400Z
             * @example null
             */
            joinedAt: string | null;
        };
        /**
         * MemberPage
         * @description One page of a tenant's members, by name.
         */
        MemberPage: {
            items: components["schemas"]["Member"][];
            /** @example 1 */
            total: number;
            /** @example 25 */
            limit: number;
            /** @example 0 */
            offset: number;
        };
        /**
         * Org
         * @description A GitHub organisation a tenant has recorded, enabled or not.
         */
        Org: {
            /**
             * Format: uuid
             * @example 2e5f7a19-3b4c-4d6e-8f01-9a2b3c4d5e6f
             */
            id: string;
            /**
             * Format: uuid
             * @example 9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10
             */
            tenantId: string;
            /**
             * @description Lower-cased GitHub login, unique within the tenant.
             * @example nobudata
             */
            login: string;
            /**
             * @description Whether Ouroboros may operate in it. A row records that the organisation is
             *     known; this records that somebody deliberately turned it on.
             * @example true
             */
            enabled: boolean;
            /**
             * Format: date-time
             * @description When the GitHub App was installed. `null` on every row today — the installation
             *     flow is future product work, and a default would assert something that never
             *     happened.
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
         * OrgPage
         * @description One page of a tenant's GitHub organisations, by login.
         */
        OrgPage: {
            items: components["schemas"]["Org"][];
            /** @example 1 */
            total: number;
            /** @example 25 */
            limit: number;
            /** @example 0 */
            offset: number;
        };
        /**
         * Repo
         * @description A repository within an organisation. In scope for Ouroboros only when this `enabled`
         *     and its organisation's are **both** true.
         */
        Repo: {
            /**
             * Format: uuid
             * @example 7a3d9c21-8e4f-4b5a-9c6d-0e1f2a3b4c5d
             */
            id: string;
            /**
             * Format: uuid
             * @description The organisation it hangs from. The tenant is reachable through that, and a
             *     second copy of the fact here could disagree with it.
             * @example 2e5f7a19-3b4c-4d6e-8f01-9a2b3c4d5e6f
             */
            orgId: string;
            /**
             * @description Lower-cased, without the owner prefix. Unique within the organisation.
             * @example ouroboros
             */
            name: string;
            /**
             * @description Independent of the organisation's flag, so suspending one preserves this.
             * @example true
             */
            enabled: boolean;
            /**
             * @description The branch work is cut from, or `null` until it has been discovered from GitHub.
             *     An enable/disable that omits it leaves it alone rather than clearing it.
             * @example main
             * @example null
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
         * CreateTenantRequest
         * @description The body of `POST /api/v1/tenants`.
         *
         *     Request schemas are closed, as the response schemas are: a property this document
         *     does not list is refused rather than ignored, which is what closes mass assignment
         *     for every route at once instead of per handler.
         */
        CreateTenantRequest: {
            /** @example acme */
            slug: string;
            /** @example Acme, Inc. */
            displayName: string;
        };
        /**
         * UpdateTenantRequest
         * @description The body of `PATCH /api/v1/tenants/{tenantId}`. Every field optional; a body naming
         *     none of them is a no-op that answers with the tenant unchanged.
         */
        UpdateTenantRequest: {
            /** @example acme */
            slug?: string;
            /** @example Acme Corporation */
            displayName?: string;
            /**
             * @example suspended
             * @enum {string}
             */
            status?: "active" | "suspended" | "deleted";
        };
        /**
         * CreateDomainRequest
         * @description The body of `POST /api/v1/tenants/{tenantId}/domains`.
         */
        CreateDomainRequest: {
            /**
             * @description Lower-cased. An address with upper case in it is refused rather than folded —
             *     folding would mean the value stored is not the value sent, which is the beginning
             *     of a client that cannot predict what a `GET` returns.
             * @example acme.example
             */
            domain: string;
            /**
             * @description Make this the displayed domain, demoting whichever one holds it now.
             * @default false
             * @example true
             */
            isPrimary: boolean;
        };
        /**
         * UpdateDomainRequest
         * @description The body of `PATCH /api/v1/tenants/{tenantId}/domains/{domainId}`. One field, because
         *     it is the only thing about a domain that can change: the domain itself is what the
         *     row *is*, and renaming one is adding the new and removing the old.
         */
        UpdateDomainRequest: {
            /** @example true */
            isPrimary: boolean;
        };
        /**
         * InviteMemberRequest
         * @description The body of `POST /api/v1/tenants/{tenantId}/members`.
         */
        InviteMemberRequest: {
            /**
             * Format: email
             * @description Who to invite. Lower-cased before the lookup — the one value this API normalises
             *     rather than refuses, because an address is typed by a person into a form and
             *     `Ada@acme.example` is not a mistake worth an error message.
             * @example grace@acme.example
             */
            email: string;
            /**
             * @example admin
             * @enum {string}
             */
            role: "owner" | "admin" | "member" | "viewer";
            /**
             * @description What to call them if this is the first Ouroboros has heard of them. Ignored when
             *     the person already exists — their own name is not an inviter's to overwrite.
             *     Omitted, the local part of the address is used.
             * @example Grace Hopper
             */
            displayName?: string;
        };
        /**
         * UpdateMemberRequest
         * @description The body of `PATCH /api/v1/tenants/{tenantId}/members/{userId}`.
         */
        UpdateMemberRequest: {
            /**
             * @example admin
             * @enum {string}
             */
            role: "owner" | "admin" | "member" | "viewer";
        };
        /**
         * CreateOrgRequest
         * @description The body of `POST /api/v1/tenants/{tenantId}/orgs`.
         */
        CreateOrgRequest: {
            /** @example nobudata */
            login: string;
            /**
             * @description Off unless asked. Anything arriving by a path nobody has thought about yet
             *     arrives switched off, which is the right posture for a flag whose whole job is to
             *     bound what an autonomous agent may touch.
             * @default false
             * @example true
             */
            enabled: boolean;
        };
        /**
         * UpdateOrgRequest
         * @description The body of `PATCH /api/v1/tenants/{tenantId}/orgs/{login}`.
         */
        UpdateOrgRequest: {
            /** @example false */
            enabled: boolean;
        };
        /**
         * UpdateRepoRequest
         * @description The body of `PATCH /api/v1/tenants/{tenantId}/orgs/{login}/repos/{name}`, which is
         *     also how a repository is first recorded.
         */
        UpdateRepoRequest: {
            /** @example true */
            enabled: boolean;
            /**
             * @description The branch work is cut from. Left alone when omitted rather than cleared. The
             *     shape is an allow-list — letters, digits, dot, underscore, hyphen and slash, with
             *     no leading or trailing slash, no empty segment, no leading dot and no `..`
             *     anywhere — because the value is joined onto a filesystem path.
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
         * @description The tenant's id.
         * @example 9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10
         */
        TenantId: string;
        /**
         * @description The domain's id. It must belong to the tenant in the path.
         * @example 4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94
         */
        DomainId: string;
        /**
         * @description The person's id. A membership is the `(tenant, person)` pair rather than a row with
         *     an identity of its own, so this is what addresses one.
         * @example c7b1e2f4-5a63-4d8e-b0c9-7f2a1d3e6b85
         */
        UserId: string;
        /**
         * @description The organisation's GitHub login — the `NobuData` in github.com/NobuData, lower-cased.
         *     GitHub treats logins case-insensitively, so they are stored folded and one casing is
         *     the only one that resolves.
         * @example nobudata
         */
        OrgLogin: string;
        /**
         * @description The repository's name within its organisation, without the owner prefix — the
         *     `ouroboros` in NobuData/ouroboros, lower-cased.
         * @example ouroboros
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
         *     On the operations below it is **optional and redundant**: they already name a
         *     workspace in their path, which is the more specific of the two, and a header that
         *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
         *     silent preference for either. It is accepted here so that one client can set it on
         *     every request, and it is how the operations that have no workspace in their path —
         *     everything the epic adds after this one — say which workspace they mean.
         *
         *     A caller who belongs to exactly one workspace may omit it everywhere; theirs is
         *     inferred. A caller who belongs to several, on an operation with no `{tenantId}`,
         *     gets a `422` with `code: "tenant_required"`.
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
    listTenants: {
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
                     *           "id": "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
                     *           "slug": "acme",
                     *           "displayName": "Acme, Inc.",
                     *           "status": "active",
                     *           "createdAt": "2026-08-11T10:20:23.114Z",
                     *           "updatedAt": "2026-08-11T10:20:23.114Z"
                     *         }
                     *       ],
                     *       "total": 1,
                     *       "limit": 25,
                     *       "offset": 0
                     *     }
                     */
                    "application/json": components["schemas"]["TenantPage"];
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
    createTenant: {
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
                 *       "slug": "acme",
                 *       "displayName": "Acme, Inc."
                 *     }
                 */
                "application/json": components["schemas"]["CreateTenantRequest"];
            };
        };
        responses: {
            /** @description The tenant, as it was stored. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
                     *       "slug": "acme",
                     *       "displayName": "Acme, Inc.",
                     *       "status": "active",
                     *       "createdAt": "2026-08-11T10:20:23.114Z",
                     *       "updatedAt": "2026-08-11T10:20:23.114Z"
                     *     }
                     */
                    "application/json": components["schemas"]["Tenant"];
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
            /** @description `slug_taken` — another tenant already has that slug. */
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
    readTenant: {
        parameters: {
            query?: never;
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path —
                 *     everything the epic adds after this one — say which workspace they mean.
                 *
                 *     A caller who belongs to exactly one workspace may omit it everywhere; theirs is
                 *     inferred. A caller who belongs to several, on an operation with no `{tenantId}`,
                 *     gets a `422` with `code: "tenant_required"`.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The tenant's id.
                 * @example 9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10
                 */
                tenantId: components["parameters"]["TenantId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The tenant. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
                     *       "slug": "acme",
                     *       "displayName": "Acme, Inc.",
                     *       "status": "active",
                     *       "createdAt": "2026-08-11T10:20:23.114Z",
                     *       "updatedAt": "2026-08-11T10:20:23.114Z"
                     *     }
                     */
                    "application/json": components["schemas"]["Tenant"];
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
            /** @description `tenant_not_found` — no tenant has that id. */
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
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             *     understood, and a different value can succeed.
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
    updateTenant: {
        parameters: {
            query?: never;
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path —
                 *     everything the epic adds after this one — say which workspace they mean.
                 *
                 *     A caller who belongs to exactly one workspace may omit it everywhere; theirs is
                 *     inferred. A caller who belongs to several, on an operation with no `{tenantId}`,
                 *     gets a `422` with `code: "tenant_required"`.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The tenant's id.
                 * @example 9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10
                 */
                tenantId: components["parameters"]["TenantId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "displayName": "Acme Corporation"
                 *     }
                 */
                "application/json": components["schemas"]["UpdateTenantRequest"];
            };
        };
        responses: {
            /** @description The tenant, after the change. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
                     *       "slug": "acme",
                     *       "displayName": "Acme Corporation",
                     *       "status": "active",
                     *       "createdAt": "2026-08-11T10:20:23.114Z",
                     *       "updatedAt": "2026-08-11T11:02:44.900Z"
                     *     }
                     */
                    "application/json": components["schemas"]["Tenant"];
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
            /** @description `tenant_not_found` — no tenant has that id. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `slug_taken` — the new slug is another tenant's. */
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
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             *     understood, and a different value can succeed.
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
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path —
                 *     everything the epic adds after this one — say which workspace they mean.
                 *
                 *     A caller who belongs to exactly one workspace may omit it everywhere; theirs is
                 *     inferred. A caller who belongs to several, on an operation with no `{tenantId}`,
                 *     gets a `422` with `code: "tenant_required"`.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The tenant's id.
                 * @example 9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10
                 */
                tenantId: components["parameters"]["TenantId"];
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
                     *           "tenantId": "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
                     *           "domain": "acme.example",
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
            /** @description `tenant_not_found` — no tenant has that id. */
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
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             *     understood, and a different value can succeed.
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
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path —
                 *     everything the epic adds after this one — say which workspace they mean.
                 *
                 *     A caller who belongs to exactly one workspace may omit it everywhere; theirs is
                 *     inferred. A caller who belongs to several, on an operation with no `{tenantId}`,
                 *     gets a `422` with `code: "tenant_required"`.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The tenant's id.
                 * @example 9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10
                 */
                tenantId: components["parameters"]["TenantId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "domain": "acme.example",
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
                     *       "tenantId": "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
                     *       "domain": "acme.example",
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
            /** @description `tenant_not_found` — no tenant has that id. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `domain_taken` — the domain belongs to another tenant. A domain resolves exactly
             *     one tenant at sign-in, so it is unique across the whole installation rather than
             *     within a tenant.
             */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "code": "domain_taken",
                     *       "message": "That domain belongs to another tenant.",
                     *       "details": {}
                     *     }
                     */
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
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             *     understood, and a different value can succeed.
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
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path —
                 *     everything the epic adds after this one — say which workspace they mean.
                 *
                 *     A caller who belongs to exactly one workspace may omit it everywhere; theirs is
                 *     inferred. A caller who belongs to several, on an operation with no `{tenantId}`,
                 *     gets a `422` with `code: "tenant_required"`.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The tenant's id.
                 * @example 9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10
                 */
                tenantId: components["parameters"]["TenantId"];
                /**
                 * @description The domain's id. It must belong to the tenant in the path.
                 * @example 4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94
                 */
                domainId: components["parameters"]["DomainId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /**
             * @description Gone. No body: there is nothing to say about a row that no longer exists, and a
             *     `200` carrying the deleted resource invites a client to keep using it.
             */
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
            /** @description `tenant_not_found`, or `domain_not_found`. */
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
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             *     understood, and a different value can succeed.
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
    setDomainPrimary: {
        parameters: {
            query?: never;
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path —
                 *     everything the epic adds after this one — say which workspace they mean.
                 *
                 *     A caller who belongs to exactly one workspace may omit it everywhere; theirs is
                 *     inferred. A caller who belongs to several, on an operation with no `{tenantId}`,
                 *     gets a `422` with `code: "tenant_required"`.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The tenant's id.
                 * @example 9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10
                 */
                tenantId: components["parameters"]["TenantId"];
                /**
                 * @description The domain's id. It must belong to the tenant in the path.
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
                     *       "tenantId": "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
                     *       "domain": "acme.example",
                     *       "isPrimary": true,
                     *       "createdAt": "2026-08-11T10:20:23.114Z",
                     *       "updatedAt": "2026-08-11T11:31:02.005Z"
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
            /**
             * @description `tenant_not_found`, or `domain_not_found` — which a domain belonging to a
             *     *different* tenant also answers, so the API does not confirm to whoever asked
             *     that an identifier they guessed is real.
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
             * @description `conflict` — this tenant's primary domain was changed by another request at the
             *     same moment. Retrying is the honest response.
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
             * @description `validation_failed` — a path parameter, a query parameter or a field of the body
             *     was refused. `details` carries one entry per field, keyed by its path, so a form
             *     can render each message beside the input that produced it.
             *
             *     Or `constraint_violated`, when the value was one this document's own rules admit
             *     and a `check` in the database does not. `details.constraint` names which. The two
             *     share a status because both mean the same thing to a client: the request was
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             *     understood, and a different value can succeed.
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
    listMembers: {
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
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path —
                 *     everything the epic adds after this one — say which workspace they mean.
                 *
                 *     A caller who belongs to exactly one workspace may omit it everywhere; theirs is
                 *     inferred. A caller who belongs to several, on an operation with no `{tenantId}`,
                 *     gets a `422` with `code: "tenant_required"`.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The tenant's id.
                 * @example 9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10
                 */
                tenantId: components["parameters"]["TenantId"];
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
                     *           "tenantId": "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
                     *           "userId": "c7b1e2f4-5a63-4d8e-b0c9-7f2a1d3e6b85",
                     *           "email": "ada@acme.example",
                     *           "displayName": "Ada Lovelace",
                     *           "avatarUrl": "https://avatars.example/ada.png",
                     *           "role": "owner",
                     *           "invitedAt": "2026-08-11T10:20:23.114Z",
                     *           "joinedAt": "2026-08-11T10:24:51.400Z"
                     *         }
                     *       ],
                     *       "total": 1,
                     *       "limit": 25,
                     *       "offset": 0
                     *     }
                     */
                    "application/json": components["schemas"]["MemberPage"];
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
            /** @description `tenant_not_found` — no tenant has that id. */
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
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             *     understood, and a different value can succeed.
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
    inviteMember: {
        parameters: {
            query?: never;
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path —
                 *     everything the epic adds after this one — say which workspace they mean.
                 *
                 *     A caller who belongs to exactly one workspace may omit it everywhere; theirs is
                 *     inferred. A caller who belongs to several, on an operation with no `{tenantId}`,
                 *     gets a `422` with `code: "tenant_required"`.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The tenant's id.
                 * @example 9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10
                 */
                tenantId: components["parameters"]["TenantId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "email": "grace@acme.example",
                 *       "role": "admin",
                 *       "displayName": "Grace Hopper"
                 *     }
                 */
                "application/json": components["schemas"]["InviteMemberRequest"];
            };
        };
        responses: {
            /** @description The membership, as the member list shows it. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "tenantId": "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
                     *       "userId": "c7b1e2f4-5a63-4d8e-b0c9-7f2a1d3e6b85",
                     *       "email": "grace@acme.example",
                     *       "displayName": "Grace Hopper",
                     *       "avatarUrl": null,
                     *       "role": "admin",
                     *       "invitedAt": "2026-08-11T10:20:23.114Z",
                     *       "joinedAt": null
                     *     }
                     */
                    "application/json": components["schemas"]["Member"];
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
            /** @description `tenant_not_found` — no tenant has that id. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `member_exists` — that person already belongs to this tenant. */
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
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             *     understood, and a different value can succeed.
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
    removeMember: {
        parameters: {
            query?: never;
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path —
                 *     everything the epic adds after this one — say which workspace they mean.
                 *
                 *     A caller who belongs to exactly one workspace may omit it everywhere; theirs is
                 *     inferred. A caller who belongs to several, on an operation with no `{tenantId}`,
                 *     gets a `422` with `code: "tenant_required"`.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The tenant's id.
                 * @example 9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10
                 */
                tenantId: components["parameters"]["TenantId"];
                /**
                 * @description The person's id. A membership is the `(tenant, person)` pair rather than a row with
                 *     an identity of its own, so this is what addresses one.
                 * @example c7b1e2f4-5a63-4d8e-b0c9-7f2a1d3e6b85
                 */
                userId: components["parameters"]["UserId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description They are no longer a member. */
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
            /** @description `tenant_not_found`, or `member_not_found`. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `last_owner` — they are the only owner this tenant has. */
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
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             *     understood, and a different value can succeed.
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
    changeMemberRole: {
        parameters: {
            query?: never;
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path —
                 *     everything the epic adds after this one — say which workspace they mean.
                 *
                 *     A caller who belongs to exactly one workspace may omit it everywhere; theirs is
                 *     inferred. A caller who belongs to several, on an operation with no `{tenantId}`,
                 *     gets a `422` with `code: "tenant_required"`.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The tenant's id.
                 * @example 9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10
                 */
                tenantId: components["parameters"]["TenantId"];
                /**
                 * @description The person's id. A membership is the `(tenant, person)` pair rather than a row with
                 *     an identity of its own, so this is what addresses one.
                 * @example c7b1e2f4-5a63-4d8e-b0c9-7f2a1d3e6b85
                 */
                userId: components["parameters"]["UserId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "role": "admin"
                 *     }
                 */
                "application/json": components["schemas"]["UpdateMemberRequest"];
            };
        };
        responses: {
            /** @description The membership, after the change. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "tenantId": "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
                     *       "userId": "c7b1e2f4-5a63-4d8e-b0c9-7f2a1d3e6b85",
                     *       "email": "grace@acme.example",
                     *       "displayName": "Grace Hopper",
                     *       "avatarUrl": null,
                     *       "role": "admin",
                     *       "invitedAt": "2026-08-11T10:20:23.114Z",
                     *       "joinedAt": "2026-08-11T10:24:51.400Z"
                     *     }
                     */
                    "application/json": components["schemas"]["Member"];
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
            /** @description `tenant_not_found`, or `member_not_found`. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `last_owner` — this would leave the tenant with nobody who can administer it.
             *     The one rule in the tenancy schema the database deliberately does not enforce:
             *     it spans rows and has to survive both a role change and a removal, so this
             *     service owns it.
             */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "code": "last_owner",
                     *       "message": "A tenant must keep at least one owner. Promote another member first.",
                     *       "details": {
                     *         "userId": "c7b1e2f4-5a63-4d8e-b0c9-7f2a1d3e6b85"
                     *       }
                     *     }
                     */
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
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             *     understood, and a different value can succeed.
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
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path —
                 *     everything the epic adds after this one — say which workspace they mean.
                 *
                 *     A caller who belongs to exactly one workspace may omit it everywhere; theirs is
                 *     inferred. A caller who belongs to several, on an operation with no `{tenantId}`,
                 *     gets a `422` with `code: "tenant_required"`.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The tenant's id.
                 * @example 9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10
                 */
                tenantId: components["parameters"]["TenantId"];
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
                     *           "tenantId": "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
                     *           "login": "nobudata",
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
                    "application/json": components["schemas"]["OrgPage"];
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
            /** @description `tenant_not_found` — no tenant has that id. */
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
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             *     understood, and a different value can succeed.
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
    addOrg: {
        parameters: {
            query?: never;
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path —
                 *     everything the epic adds after this one — say which workspace they mean.
                 *
                 *     A caller who belongs to exactly one workspace may omit it everywhere; theirs is
                 *     inferred. A caller who belongs to several, on an operation with no `{tenantId}`,
                 *     gets a `422` with `code: "tenant_required"`.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The tenant's id.
                 * @example 9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10
                 */
                tenantId: components["parameters"]["TenantId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "login": "nobudata",
                 *       "enabled": true
                 *     }
                 */
                "application/json": components["schemas"]["CreateOrgRequest"];
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
                     *       "tenantId": "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
                     *       "login": "nobudata",
                     *       "enabled": true,
                     *       "installedAt": null,
                     *       "createdAt": "2026-08-11T10:20:23.114Z",
                     *       "updatedAt": "2026-08-11T10:20:23.114Z"
                     *     }
                     */
                    "application/json": components["schemas"]["Org"];
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
            /** @description `tenant_not_found` — no tenant has that id. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `org_taken` — this tenant has already recorded that organisation. */
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
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             *     understood, and a different value can succeed.
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
    setOrgEnabled: {
        parameters: {
            query?: never;
            header?: {
                /**
                 * @description The workspace this request is operating in — its slug or its uuid.
                 *
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path —
                 *     everything the epic adds after this one — say which workspace they mean.
                 *
                 *     A caller who belongs to exactly one workspace may omit it everywhere; theirs is
                 *     inferred. A caller who belongs to several, on an operation with no `{tenantId}`,
                 *     gets a `422` with `code: "tenant_required"`.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The tenant's id.
                 * @example 9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10
                 */
                tenantId: components["parameters"]["TenantId"];
                /**
                 * @description The organisation's GitHub login — the `NobuData` in github.com/NobuData, lower-cased.
                 *     GitHub treats logins case-insensitively, so they are stored folded and one casing is
                 *     the only one that resolves.
                 * @example nobudata
                 */
                login: components["parameters"]["OrgLogin"];
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
                "application/json": components["schemas"]["UpdateOrgRequest"];
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
                     *       "tenantId": "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
                     *       "login": "nobudata",
                     *       "enabled": false,
                     *       "installedAt": null,
                     *       "createdAt": "2026-08-11T10:20:23.114Z",
                     *       "updatedAt": "2026-08-11T12:05:19.732Z"
                     *     }
                     */
                    "application/json": components["schemas"]["Org"];
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
            /** @description `tenant_not_found`, or `org_not_found`. */
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
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             *     understood, and a different value can succeed.
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
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path —
                 *     everything the epic adds after this one — say which workspace they mean.
                 *
                 *     A caller who belongs to exactly one workspace may omit it everywhere; theirs is
                 *     inferred. A caller who belongs to several, on an operation with no `{tenantId}`,
                 *     gets a `422` with `code: "tenant_required"`.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The tenant's id.
                 * @example 9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10
                 */
                tenantId: components["parameters"]["TenantId"];
                /**
                 * @description The organisation's GitHub login — the `NobuData` in github.com/NobuData, lower-cased.
                 *     GitHub treats logins case-insensitively, so they are stored folded and one casing is
                 *     the only one that resolves.
                 * @example nobudata
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
                     *           "orgId": "2e5f7a19-3b4c-4d6e-8f01-9a2b3c4d5e6f",
                     *           "name": "ouroboros",
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
            /** @description `tenant_not_found`, or `org_not_found`. */
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
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             *     understood, and a different value can succeed.
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
                 *     On the operations below it is **optional and redundant**: they already name a
                 *     workspace in their path, which is the more specific of the two, and a header that
                 *     names a *different* one is a `422` with `code: "tenant_mismatch"` rather than a
                 *     silent preference for either. It is accepted here so that one client can set it on
                 *     every request, and it is how the operations that have no workspace in their path —
                 *     everything the epic adds after this one — say which workspace they mean.
                 *
                 *     A caller who belongs to exactly one workspace may omit it everywhere; theirs is
                 *     inferred. A caller who belongs to several, on an operation with no `{tenantId}`,
                 *     gets a `422` with `code: "tenant_required"`.
                 */
                "X-Ouro-Tenant"?: components["parameters"]["TenantHeader"];
            };
            path: {
                /**
                 * @description The tenant's id.
                 * @example 9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10
                 */
                tenantId: components["parameters"]["TenantId"];
                /**
                 * @description The organisation's GitHub login — the `NobuData` in github.com/NobuData, lower-cased.
                 *     GitHub treats logins case-insensitively, so they are stored folded and one casing is
                 *     the only one that resolves.
                 * @example nobudata
                 */
                login: components["parameters"]["OrgLogin"];
                /**
                 * @description The repository's name within its organisation, without the owner prefix — the
                 *     `ouroboros` in NobuData/ouroboros, lower-cased.
                 * @example ouroboros
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
                     *       "orgId": "2e5f7a19-3b4c-4d6e-8f01-9a2b3c4d5e6f",
                     *       "name": "ouroboros",
                     *       "enabled": true,
                     *       "defaultBranch": "main",
                     *       "createdAt": "2026-08-11T10:20:23.114Z",
                     *       "updatedAt": "2026-08-11T12:11:38.220Z"
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
            /**
             * @description `tenant_not_found`, or `org_not_found`. There is no `repo_not_found`: a
             *     repository this API has never seen is one it creates, so the only thing that can
             *     be missing is the organisation it would hang from.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description `conflict` — the repository was recorded by another request at the same moment. */
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
             *
             *     Or `tenant_mismatch`, when the path and the `X-Ouro-Tenant` header name different
             *     workspaces — refused rather than resolved by precedence, so a client holding a
             *     stale workspace in a header cannot quietly act on another one.
             *     understood, and a different value can succeed.
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
