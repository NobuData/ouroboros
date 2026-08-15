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
  /**
   * The URL- and CLI-safe handle. What the workspace row shows as its detail line — and
   * what the shell's tenant chip draws once a session is acting in it, which is where the
   * signed-in legs read the active workspace from (`app/shell/tenant-chip.tsx` draws the
   * *slug*, not the name below).
   */
  slug: "acme-robotics",
  /** The workspace's name, as the login screen's row prints it. */
  displayName: "Acme Robotics",
} as const;

/**
 * The personal workspace — the same person's, and empty on purpose.
 *
 * `R__dev_seed.sql` creates it with `metadata` `{"personal": true}` as the shape
 * [#704](https://github.com/NobuData/ouroboros/issues/704) gives everybody at first sign-in,
 * and `R__dev_seed_dashboard.sql` deliberately writes **no** row of any kind against it: not
 * a run, not a queue item, not a usage event, and no settings row. That absence is a
 * fixture rather than an oversight — it is what lets `specs/dashboard.spec.ts` assert
 * [#86](https://github.com/NobuData/ouroboros/issues/86)'s zero states against a *workspace*
 * instead of against a mocked payload, and it is why the dashboard leg switches workspaces
 * rather than switching users.
 */
export const SEED_PERSONAL_TENANT = {
  /** `ouroboros.organization.id` — literal in the migration. */
  id: "5eed0001-0000-4000-8000-000000000003",
  /** The handle, which is the person's own — what the tenant chip draws. */
  slug: "kensuenobu",
  /** The workspace's name, which for a personal workspace is the person's. */
  displayName: "Ken Suenobu",
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
  /** `ouroboros."user".id` — literal in the migration, and what a `session` row names. */
  id: "5eed0003-0000-4000-8000-000000000001",
  /** The address `support/session.ts` presents to the development sign-in route. */
  email: "ken@acme-robotics.dev",
  /** What the shell's user menu renders. */
  displayName: "Ken Suenobu",
} as const;

/**
 * The password every seeded person signs in with.
 *
 * One value for all of them, because this is demo data on a development machine and a
 * different string per person would be three things to look up rather than one. It is not a
 * secret in any sense that matters: it is written down here, in
 * `ouroboros-db/migrations/R__dev_seed.sql`, and in the README — and the seed it belongs to
 * cannot be applied to anything but a development database, because every statement in that
 * migration is gated on the `ouro_dev_seed` placeholder that only `flyway.seed.toml` sets.
 *
 * **[#709](https://github.com/NobuData/ouroboros/issues/709) is what has to write it**, as
 * an `account` row with `providerId = 'credential'` and a hash BetterAuth's own scrypt
 * verifier accepts. Two constraints on that seed come from this constant: the hash must be
 * of exactly this string, and the string must clear `PASSWORD_MIN_LENGTH` in
 * `ouroboros-rest/src/auth/password.provider.ts`, which is twelve characters.
 */
export const SEED_PASSWORD = "ouroboros-dev-password";

/** Every person the seed creates, by id — what {@link seededUser} looks up. */
const SEEDED_USERS = [SEED_OWNER] as const;

/**
 * Find a seeded person by id.
 *
 * A lookup rather than a bare export because `support/session.ts` is handed an id — that is
 * what the specs already pass — and needs the address that goes with it.
 *
 * @param userId - The id, as one of the constants above spells it.
 * @returns The person.
 * @throws {Error} If no seeded person carries that id, which is a spec naming somebody the
 *   seed does not create. Failing here names the id; failing later names a missing heading.
 */
export function seededUser(userId: string): (typeof SEEDED_USERS)[number] {
  const person = SEEDED_USERS.find((candidate) => candidate.id === userId);

  if (person === undefined) {
    throw new Error(
      `no seeded user has id ${userId} — support/seed.ts knows ` +
        `${SEEDED_USERS.map((each) => each.id).join(", ")}`,
    );
  }

  return person;
}

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
