# Demonstration — P2 · Identity, Tenancy & the Login Page

> A five-minute walkthrough of what phase **P2** of
> [`ROADMAP_OOE_MVP.md`](ROADMAP_OOE_MVP.md) delivered, and how to show it.
> **Status at the time of writing:** ✅ complete — all 29 issues closed
> (`#31`–`#44` and [`#700`](https://github.com/NobuData/ouroboros/issues/700)–[`#721`](https://github.com/NobuData/ouroboros/issues/721)).

## Regeneration prompt

Copy this into Claude Code to rebuild this document, or swap the phase token to
generate another phase's script.

```text
Read `docs/ROADMAP_OOE_MVP.md` and produce `docs/DEMONSTRATION_P2.md` — a
walkthrough script for phase **P2** of the order-of-execution plan.

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
| **BetterAuth in the service** | [#700](https://github.com/NobuData/ouroboros/issues/700)–[#705](https://github.com/NobuData/ouroboros/issues/705) | Library installed and configured, handler mounted at `/api/auth/*`, GitHub social provider, DB-backed sessions with a global auth guard, the organization plugin as the tenancy backbone, and development email/password sign-in |
| **The schema** | [#706](https://github.com/NobuData/ouroboros/issues/706)–[#710](https://github.com/NobuData/ouroboros/issues/710) | `V004` core auth tables, `V005` organization plugin, `V006` extension tables re-pointed onto `organization.id`, the auth-aware dev seed, and the constraint/drift tests in `ci/db` |
| **Tenancy over the session** | [#711](https://github.com/NobuData/ouroboros/issues/711)–[#715](https://github.com/NobuData/ouroboros/issues/715), [#31](https://github.com/NobuData/ouroboros/issues/31), [#32](https://github.com/NobuData/ouroboros/issues/32) | Auth route surface in OpenAPI, `POST /api/v1/auth/discover`, tenant context read from the session's active organization, org & repo enablement on the plugin's roles, and the auth integration suite |
| **The login screen** | [#716](https://github.com/NobuData/ouroboros/issues/716)–[#721](https://github.com/NobuData/ouroboros/issues/721) | BetterAuth client & session store, the split brand panel, Step 1 (GitHub + SSO domain form), Step 2 (workspaces & repo enablement), route guards, and the signed-in session UI in the shell |
| **The contract** | [#34](https://github.com/NobuData/ouroboros/issues/34), [#43](https://github.com/NobuData/ouroboros/issues/43), [#37](https://github.com/NobuData/ouroboros/issues/37) | OpenAPI export, the typed UI client generated from it, and the REST integration harness |

**The point of the phase.** Identity is the second root of the graph: 99 database
issues and 172 REST issues are organization-scoped, and every route past this point is
guarded. It precedes the shell — which renders the profile menu and the tenant chip —
and every product screen, which reads the session's active organization.

## Setup

Ten minutes before, on the presenting machine:

```bash
cd ouroboros
git switch main && git pull
yarn install && yarn setup
docker compose up -d               # PostgreSQL + Flyway, seeded via flyway.seed.toml
yarn dev                           # engine, rest and ui from the checkout
```

> **Port note.** If something on the machine already holds 5432, publish the
> container elsewhere — `OURO_DB_PORT=45432 docker compose up -d` — and move the
> `psql` URL and `OURO_DATABASE_URL` with it.

`yarn dev` is the right stack for this demo, not `docker compose --profile full`: the
compose stack runs `ouroboros-rest`'s **production** image, where email/password
sign-in is off by design, so the only way in there is a real GitHub OAuth handshake.
Under `yarn dev` you get the seeded password route as well, which is a real credential
rather than a bypass.

Confirm the seed is present before you start:

```bash
psql postgresql://ouroboros:ouroboros@localhost:5432/ouroboros \
  -c "select slug from ouroboros.organization order by slug;"
# acme-labs · acme-robotics · kensuenobu
```

If those rows are missing, run `ouroboros-db/scripts/migrate --config flyway.seed.toml`.

**Credentials for the demo** — from `R__dev_seed.sql`:

| Person | Email | Role in `acme-robotics` |
|--------|-------|-------------------------|
| Ken Suenobu | `ken@acme-robotics.dev` | owner |
| Maya Chen | `maya@acme-robotics.dev` | admin |
| Jorge Reyes | `jorge@acme-robotics.dev` | member |

Password for all three: `ouroboros-dev-password`.

Start **signed out** — open <http://localhost:3000> in a fresh private window.

## Walkthrough — 4:45

### Beat 1 · The guard, before anything else — 0:00 → 0:35

**Navigate**

Type <http://localhost:3000/dashboard> into the address bar of the signed-out window.

**Say**

> I asked for the dashboard and I am on the login screen. That is
> [#720](https://github.com/NobuData/ouroboros/issues/720) — every route in the
> application group is behind a guard that reads the session, and there is no session
> here. Nothing in the product renders for a visitor who has not signed in, and the
> redirect happens before any data is fetched.

### Beat 2 · Step 1 — two ways in, and a domain that resolves — 0:35 → 1:40

**Navigate**

Point at the split layout — 55% brand panel, 45% cards. In the **Company domain**
field type `acme-robotics.dev` and submit.

**Say**

> Mockup 01, built. The brand panel on the left is
> [#717](https://github.com/NobuData/ouroboros/issues/717); the card on the right is
> [#718](https://github.com/NobuData/ouroboros/issues/718), and it offers three ways
> in: **Continue with GitHub**, which is a real OAuth handshake performed by
> BetterAuth; an SSO domain form; and — only because this process is not running as
> production — a seeded email and password.
>
> The domain form is not decoration. `acme-robotics.dev` is a row in the database, and
> submitting it calls `POST /api/v1/auth/discover`, which answers with the workspace
> that domain belongs to. A domain nobody has claimed is refused, and the refusal is
> announced to a screen reader as an alert rather than as a status — the form
> distinguishes an answer from a refusal.

### Beat 3 · A session is a row — 1:40 → 2:40

**Navigate**

Sign in as `ken@acme-robotics.dev` / `ouroboros-dev-password`. While the page settles,
switch to a terminal:

```bash
psql postgresql://ouroboros:ouroboros@localhost:5432/ouroboros \
  -c 'select count(*) from ouroboros."session";'
```

**Say**

> That is a password, not a bypass. `ouroboros-rest` enables BetterAuth's
> email/password provider only when `NODE_ENV` is not production; in production the
> same request is refused with `EMAIL_PASSWORD_DISABLED`. The hash in the seed is
> real scrypt over a documented development password, so the service verified it the
> same way it will verify anyone's.
>
> And the session is a **row**, which is
> [#703](https://github.com/NobuData/ouroboros/issues/703)'s whole point. It is not a
> signed token the service has forgotten about — signing out deletes it, and a copied
> cookie is worth nothing afterwards. That is also why the end-to-end suite can no
> longer mint its own credential from outside the stack: there is nothing to mint.

### Beat 4 · Step 2 — the workspaces, from the organization plugin — 2:40 → 3:50

**Navigate**

Step 2 — *Choose where the loop runs* — now lists the workspaces. Point at each row,
then select **Acme Robotics** and press **Enter mission control →**.

**Say**

> Three workspaces, and each one is making a different point. **Acme Robotics** is the
> shared workspace every mockup in this repository is drawn in, with four repositories
> enabled — `helios-firmware`, `helios-console`, `helios-telemetry` and
> `atlas-scheduler`. **Acme Labs** is a second shared workspace with nothing enabled,
> which is what proves the empty state is a real state and not a placeholder.
> **kensuenobu** is a personal workspace, carrying the `personal` flag, which is the
> shape the organization plugin creates for a first sign-in.
>
> These are not three tables of our own design. They are BetterAuth's `organization`,
> `member` and `invitation` tables, landed through Flyway in `V005`, and `V006` is the
> migration that re-pointed our own extension tables — domains, GitHub orgs,
> repositories — onto `organization.id`. Flyway still owns every line of DDL, including
> the vendor's.
>
> Choosing a workspace sets the session's active organization, and from here on the
> API resolves tenant context from the session rather than from a cookie the browser
> could set. That is [#713](https://github.com/NobuData/ouroboros/issues/713), and it
> is what makes the boundary enforceable in one place.

### Beat 5 · Signed in, and signing out — 3:50 → 4:45

**Navigate**

You are on `/dashboard`. Open the profile menu in the header — it now carries a real
identity — then choose **Sign out**. Re-run the session count in the terminal.

**Say**

> The shell knows who signed in: name, email, and the workspace, from the session
> rather than from a placeholder — that is
> [#721](https://github.com/NobuData/ouroboros/issues/721). The workspace switcher in
> this menu writes the active organization back through the same plugin.
>
> Sign out, and the count goes back down. The row is gone, the cookie is cleared, and
> asking for the dashboard again puts you back where we started five minutes ago. The
> whole loop — screen, service, schema — is one system, and no part of it is stubbed.

## Prove it

```bash
cd ouroboros-rest && yarn test        # includes the auth integration suite (#715)
scripts/run-tests.sh ouroboros-db/tests   # auth constraint & drift assertions (#710)
cd tests/e2e && scripts/run.sh -- --grep "sign-in|tenants"
```

- [`specs/sign-in.spec.ts`](../tests/e2e/specs/sign-in.spec.ts) — a session
  authenticated by `ouroboros-rest` against rows Flyway seeded, rendered as a
  workspace.
- [`specs/tenants.spec.ts`](../tests/e2e/specs/tenants.spec.ts) — the workspace
  roundtrip against a real migrated database: the plugin's write read back through
  this service's listing.
- `ouroboros-db/tests/betterauth-schema.test.sh` — the drift check that the committed
  migrations still match what BetterAuth's own generator emits.

## Don't claim

- **The GitHub button is not exercised by this script.** It works, but it needs a
  registered OAuth application whose callback is
  `http://localhost:4000/api/auth/callback/github`. Set one up beforehand if the
  audience needs to see the real handshake; otherwise say plainly that you are using
  the seeded password route.
- **SSO/SAML is inert.** Step 1 ships the domain form and the discovery endpoint; the
  SSO half beyond domain discovery is not implemented.
- **This is not the finished chrome.** The header, sidebar and profile menu you see
  are P3's shell. P2 delivered the *session UI inside* it.
- **The dashboard behind the login is P4's.** At the end of P2 it was a placeholder.
