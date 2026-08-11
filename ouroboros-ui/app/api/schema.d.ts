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
    "/api/v1/auth/github": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Begin sign-in with GitHub
         * @description Send the browser to GitHub to authorize, and remember the trip.
         *
         *     This is a **navigation, not a call**. A person clicks "Continue with GitHub" and
         *     their browser follows a `302` to github.com, where they see a consent screen; a
         *     `fetch` from script would follow the redirect into a page it cannot render and land
         *     nobody anywhere. `ouroboros-ui` links to it.
         *
         *     The redirect carries the client id, the scopes (`read:user` and `user:email`, and
         *     nothing else), an opaque `state` and a PKCE `code_challenge`. The `state` and the
         *     matching verifier are kept in a short-lived signed `HttpOnly` cookie —
         *     `ouro_oauth`, ten minutes, scoped to `/api/v1/auth` — and comparing the returned
         *     `state` against that cookie is what makes the callback safe from being fabricated.
         */
        get: operations["startGithubSignIn"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/github/callback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Finish sign-in with GitHub
         * @description Where GitHub returns the browser. Verifies the handshake, exchanges the code for a
         *     token, reads the account's profile and verified primary address, resolves the
         *     person, and lands the session cookie before redirecting to `OURO_UI_URL`.
         *
         *     **This URL is registered against the OAuth application**; it is not something a
         *     client composes. It is described here because this document describes everything
         *     the service serves.
         *
         *     Resolving the person has three outcomes, and the middle one is why a sign-in can
         *     arrive already holding a membership: the GitHub identity is already known and the
         *     same user row is reused; or the identity is new and the *address* is one an
         *     invitation was sent to, in which case the identity is attached to that existing
         *     row; or neither is known and a person is created. The access token is used for
         *     those two reads and then dropped — `ouroboros.user_identities` holds no credential,
         *     and the schema's own tests fail if a column that looks like one ever appears.
         */
        get: operations["completeGithubSignIn"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read the current session
         * @description Who is signed in, which workspaces they belong to, and — for somebody who belongs
         *     to none yet — the tenant their email domain points at.
         *
         *     One call rather than three, because it is what `ouroboros-ui`'s shell needs before
         *     it can render anything: the person for the profile menu, the memberships for the
         *     workspace switcher, and the suggestion for a first-run screen.
         *
         *     The person is read from the database on every request rather than from the cookie,
         *     which is why a deleted account's outstanding session stops working immediately.
         */
        get: operations["readSession"];
        put?: never;
        post?: never;
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
         * @description Remove the session cookie from the browser.
         *
         *     Idempotent, and reachable without a session: requiring one would mean an *expired*
         *     cookie could never be cleared, because the request to remove it would be refused
         *     for carrying exactly the thing it was trying to remove. It answers `204` either
         *     way.
         *
         *     A `POST` rather than a `GET`, because it changes state — a `GET` that signs you out
         *     is a link, an image tag or a prefetch away from signing you out.
         *
         *     What it ends is the *browser's* copy. The session is a stateless signed cookie, so
         *     a copy taken beforehand stays valid until it ages out; revocation is recorded with
         *     the security baseline, [#38](https://github.com/NobuData/ouroboros/issues/38).
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
         * Session
         * @description Who is signed in, and everything the application shell needs before it can render:
         *     the person, the workspaces they may switch between, and — only when there are none —
         *     the workspace their email domain points at.
         */
        Session: {
            user: components["schemas"]["SessionUser"];
            /**
             * @description Every tenant this person belongs to, by the tenant's name and then its id.
             *     Empty for somebody who has signed in and been invited nowhere.
             */
            memberships: components["schemas"]["Membership"][];
            /**
             * @description A workspace worth asking to join, or `null`.
             *
             *     Non-null only when `memberships` is empty *and* the domain of this person's
             *     address is one some tenant has registered. It grants nothing: matching a domain
             *     is not membership, and the tenant is named so a first-run screen can say "your
             *     organisation is already here, ask an owner to add you" rather than dropping a
             *     new signee into an empty product.
             */
            tenantSuggestion: components["schemas"]["TenantSuggestion"] | null;
        };
        /**
         * SessionUser
         * @description The signed-in person. Global rather than tenant-scoped: one human is one row however
         *     many workspaces they belong to.
         */
        SessionUser: {
            /**
             * Format: uuid
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
             * @description Their name on GitHub, or their login when they have set none. Refreshed on every
             *     sign-in.
             * @example Ken Suenobu
             */
            displayName: string;
            /**
             * @description The avatar GitHub hosts, or `null` when none is known — which is what makes the
             *     UI draw a monogram instead.
             */
            avatarUrl: string | null;
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
         * Membership
         * @description One workspace the signed-in person belongs to, and the role they hold there.
         *     Flattened rather than nested, because it is one row of a workspace switcher.
         */
        Membership: {
            /**
             * Format: uuid
             * @example 9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10
             */
            tenantId: string;
            /** @example acme */
            slug: string;
            /** @example Acme, Inc. */
            displayName: string;
            /**
             * @description The tenant's lifecycle, so a switcher can render a suspended one as such.
             * @example active
             * @enum {string}
             */
            status: "active" | "suspended" | "deleted";
            /**
             * @description What this person may do in this tenant.
             * @example owner
             * @enum {string}
             */
            role: "owner" | "admin" | "member" | "viewer";
            /**
             * Format: date-time
             * @description When the invitation was issued; also when the membership came into being.
             * @example 2026-08-11T10:20:23.114Z
             */
            invitedAt: string;
            /**
             * @description When it was accepted, or `null` while the invitation is outstanding. Null is
             *     preserved rather than defaulted: "not joined yet" and "joined at the epoch" are
             *     different facts.
             */
            joinedAt: string | null;
        };
        /**
         * TenantSuggestion
         * @description A tenant whose registered email domain matches the signed-in person's address.
         *     Deliberately thin — an id, a handle and a name — because it is shown to somebody who
         *     is *not* a member, so the tenant's lifecycle and timestamps are none of their
         *     business.
         */
        TenantSuggestion: {
            /**
             * Format: uuid
             * @example 9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10
             */
            tenantId: string;
            /** @example acme */
            slug: string;
            /** @example Acme, Inc. */
            displayName: string;
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
    startGithubSignIn: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /**
             * @description Go and authorize. `Location` is on github.com and `Set-Cookie` carries the
             *     handshake this service will check on the way back. There is no body.
             */
            302: {
                headers: {
                    /** @description The GitHub authorization URL, with the state and PKCE challenge. */
                    Location?: string;
                    /**
                     * @description `ouro_oauth`, `HttpOnly`, `SameSite=Lax`, `Path=/api/v1/auth`, ten minutes,
                     *     and `Secure` outside development.
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
    completeGithubSignIn: {
        parameters: {
            query: {
                /** @description The authorization code GitHub issued. Opaque, and redeemable once. */
                code: string;
                /**
                 * @description The value this service generated before the browser left, echoed back
                 *     unchanged. Compared against the `ouro_oauth` cookie; a mismatch is a `401`.
                 */
                state: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /**
             * @description Signed in. `Location` is `OURO_UI_URL` and `Set-Cookie` carries two headers: the
             *     session, and the removal of the spent handshake. There is no body.
             */
            302: {
                headers: {
                    /** @description `OURO_UI_URL` — where a signed-in browser lands. */
                    Location?: string;
                    /**
                     * @description `ouro_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`, seven days, and
                     *     `Secure` outside development — plus the expiry of `ouro_oauth`.
                     */
                    "Set-Cookie"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            /**
             * @description `oauth_handshake_invalid` — this callback does not match a handshake this
             *     service started. The cookie was absent, expired, forged, or carries a different
             *     `state` than the query string.
             *
             *     All four are one answer on purpose. A callback an attacker composed cannot
             *     carry the cookie, and telling them which part was missing is telling them what
             *     to fix.
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
             * @description `validation_failed` — `code` or `state` was missing, too long, or not an opaque
             *     URL-safe value. `details` carries one entry per parameter, keyed by its name.
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
            /**
             * @description `github_unavailable` — GitHub refused the exchange or did not answer inside ten
             *     seconds. Or `github_email_unavailable`, when the account authenticated and
             *     offered no *verified* address: an address is how a person invited to a tenant
             *     before their first sign-in is recognised as that person, and accepting an
             *     unverified one would let somebody else's address decide which account they land
             *     on.
             *
             *     A `502` rather than a `500`, because nothing in this service is broken and
             *     retrying is reasonable. Nothing GitHub said is repeated in the body.
             */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    readSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The session. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "user": {
                     *         "id": "5eed0003-0000-4000-8000-000000000001",
                     *         "email": "ken@acme-robotics.dev",
                     *         "displayName": "Ken Suenobu",
                     *         "avatarUrl": null,
                     *         "createdAt": "2026-08-11T10:20:23.114Z",
                     *         "updatedAt": "2026-08-11T10:20:23.114Z"
                     *       },
                     *       "memberships": [
                     *         {
                     *           "tenantId": "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
                     *           "slug": "acme",
                     *           "displayName": "Acme, Inc.",
                     *           "status": "active",
                     *           "role": "owner",
                     *           "invitedAt": "2026-08-11T10:20:23.114Z",
                     *           "joinedAt": "2026-08-11T10:20:23.114Z"
                     *         }
                     *       ],
                     *       "tenantSuggestion": null
                     *     }
                     */
                    "application/json": components["schemas"]["Session"];
                };
            };
            /**
             * @description `unauthenticated` — this request carries no session, or one this service will
             *     not honour. Sign in at `/api/v1/auth/github`.
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
             * @description Signed out. `Set-Cookie` removes `ouro_session`. There is no body — there is
             *     nothing to say.
             */
            204: {
                headers: {
                    /** @description `ouro_session`, emptied, with `Max-Age=0`. */
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
             *     not honour. Sign in at `/api/v1/auth/github`.
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
             *     not honour. Sign in at `/api/v1/auth/github`.
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
             *     not honour. Sign in at `/api/v1/auth/github`.
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
             *     not honour. Sign in at `/api/v1/auth/github`.
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
             *     not honour. Sign in at `/api/v1/auth/github`.
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
             *     not honour. Sign in at `/api/v1/auth/github`.
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
             *     not honour. Sign in at `/api/v1/auth/github`.
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
             *     not honour. Sign in at `/api/v1/auth/github`.
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
             *     not honour. Sign in at `/api/v1/auth/github`.
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
             *     not honour. Sign in at `/api/v1/auth/github`.
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
             *     not honour. Sign in at `/api/v1/auth/github`.
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
             *     not honour. Sign in at `/api/v1/auth/github`.
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
             *     not honour. Sign in at `/api/v1/auth/github`.
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
             *     not honour. Sign in at `/api/v1/auth/github`.
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
             *     not honour. Sign in at `/api/v1/auth/github`.
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
             *     not honour. Sign in at `/api/v1/auth/github`.
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
             *     not honour. Sign in at `/api/v1/auth/github`.
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
