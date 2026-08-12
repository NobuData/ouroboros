/**
 * The development seed, as this suite asserts against it.
 *
 * Every value here is copied from
 * [`ouroboros-db/migrations/R__dev_seed.sql`](../../../ouroboros-db/migrations/R__dev_seed.sql),
 * which exists so that local development and this suite have data they can name
 * ([#23](https://github.com/NobuData/ouroboros/issues/23)). The ids are literal in the
 * migration precisely so they can be literal here: they do not change between machines or
 * between runs, and a uuid beginning `5eed` came from that file.
 *
 * **This module is a copy, and that is deliberate.** The alternative is reading the seed's
 * SQL at runtime and parsing values out of it, which would make the suite agree with the
 * seed by construction — and agree with a *renamed workspace* just as happily. A test that
 * derives its expectation from the thing under test asserts nothing. These are written
 * down, so a seed that changes breaks this file and somebody has to look at both.
 *
 * The seed is applied by the compose stack and by nothing else: `flyway.seed.toml` sets
 * the `ouro_dev_seed` placeholder that every statement in the migration is gated on, and
 * `flyway.toml` — which CI, `scripts/migrate` and every hand-run migration read — sets it
 * `false`. A suite run against a stack brought up any other way finds no rows, which is
 * the correct failure: this is the MVP gate for the development stack.
 */

/** The workspace every mockup is drawn in, and the one the dashboard leg lands in. */
export const SEED_TENANT = {
  /** `ouroboros.tenants.id` — literal in the migration. */
  id: "5eed0001-0000-4000-8000-000000000001",
  /** The URL- and CLI-safe handle. What the workspace row shows as its detail line. */
  slug: "acme-robotics",
  /** What the dashboard renders as its `<h1>`. */
  displayName: "Acme Robotics",
} as const;

/**
 * The seeded owner — whose session the browser legs carry.
 *
 * The owner rather than the admin or the member, because the legs that follow this one in
 * later amendments exercise owner-only controls (the auto-merge toggle in
 * [#88](https://github.com/NobuData/ouroboros/issues/88), among others), and a suite that
 * signs in as somebody else first would have to sign in twice.
 */
export const SEED_OWNER = {
  /** `ouroboros.users.id` — the `sub` claim of the minted session. */
  id: "5eed0003-0000-4000-8000-000000000001",
  /** The address `.env.example` suggests for `OURO_AUTH_DEV_USER`. */
  email: "ken@acme-robotics.dev",
  /** What the shell's user menu renders. */
  displayName: "Ken Suenobu",
} as const;

/**
 * A slug for a workspace this run creates, unique to the run.
 *
 * The tenant CRUD leg writes to the same database the browser legs read, and it runs
 * against a stack that is not always torn down between runs — `scripts/run.sh --keep` and
 * a developer's own `docker compose up` are both ordinary. A fixed slug would therefore
 * pass once and answer `409 conflict` for ever after, which is a suite that has to be
 * repaired by hand rather than one that is green twice.
 *
 * The `e2e-` prefix is what makes the rows it leaves identifiable: there is no tenant
 * delete route in the API (`ouroboros-rest/openapi.json`), so this leg cannot clean up
 * after itself and does not pretend to — it suspends what it created instead, and
 * `docker compose down -v` is what actually reclaims the space.
 *
 * @param label - What this tenant is for, in the slug's own alphabet.
 * @returns A slug matching `tenants_slug_format`: lower-case alphanumerics and hyphens.
 */
export function ephemeralSlug(label: string): string {
  const stamp = Date.now().toString(36);
  const noise = Math.random().toString(36).slice(2, 8);

  return `e2e-${label}-${stamp}-${noise}`;
}
