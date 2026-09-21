/**
 * What mockup 08 renders against the farm seed, the fresh workspace the real chain runs in, and
 * what the farm leg leaves behind
 * ([#262](https://github.com/NobuData/ouroboros/issues/262), AI.7, amending
 * [#56](https://github.com/NobuData/ouroboros/issues/56)).
 *
 * Copied, not imported — `support/seed.ts` argues why for the whole directory. `ouroboros-ui`
 * owns these sentences and `R__dev_seed_farm.sql` owns these figures; a leg that imported either
 * would agree with a wrong value the moment it changed, and the point of this suite is to be the
 * place that disagrees.
 *
 * ## Two workspaces, and why the leg needs both
 *
 * **`acme-robotics` is the mockup.** Its five runners, two pools, forty-eight builds and one
 * streamed log are the seed's, so parity, the member's page and the shell's promises are asserted
 * there. But nothing can *enrol* there: the seed gives the workspace a farm CA whose key is a
 * placeholder envelope on purpose (`R__dev_seed_farm.sql` § *Neither the CA key nor the
 * certificate is real* — a genuine key in a migration is a private key in every clone), so a
 * real registration would ask the vault to open a sentence.
 *
 * **A fresh workspace is the chain.** {@link enterFreshWorkspace} creates one per run through
 * the same plugin route `specs/tenants.spec.ts` certifies. It has no pool, no runner and no CA,
 * which makes it two things at once: the issue's *fresh organization* — the first thing every
 * new tenant sees, and the subject of the states group — and the one place `ouroboros-rest`
 * will mint a real CA the first time a machine enrols. It also makes the leg **green on a second
 * run against the same volume**, unlike legs 11 and 15: every run gets its own workspace, so
 * nothing a previous run enrolled is in the way.
 *
 * ## What this leg writes, and what it leaves
 *
 * | what | where | put back? |
 * |---|---|---|
 * | a workspace, `e2e-farm-…` | the tenancy tables | **no** — there is no delete on the API, and `tenants.spec.ts` takes the same position |
 * | a pool, `pool-e2e` | the fresh workspace | no — a pool a runner has named cannot be deleted (`farm_pool_in_use`), and a runner's row is never deleted |
 * | two enrollment tokens, one revoked and one spent | the fresh workspace | no — both are dead by the end of the chain |
 * | a runner, a farm CA and a certificate | the fresh workspace | no — the machine is killed and recreated; the row stays `offline` in a workspace nobody reads again |
 * | the reader's font scale | the seeded owner | **yes** — the shell group restores it |
 *
 * Nothing is written to `acme-robotics`, so no other leg's parity can see this one ran.
 */

import type { BrowserContext, Page } from "@playwright/test";

import { requestAs } from "./rest";
import { SEED_OWNER, ephemeralSlug } from "./seed";
import { AUTH_BASE_PATH, SESSION_COOKIE, sessionTokenOf, signIn } from "./session";
import { REST_URL } from "./stack";
import { selectWorkspace } from "./workspace";

/** Where the page lives — `BUILD_FARM_PATH` in `ouroboros-ui`. */
export const FARM_PATH = "/build-farm";

/* ------------------------------------------------------------------ the seeded page */

/** The page head over the seeded workspace: three live values in a sentence. */
export const FARM_HEAD = {
  eyebrow: "Build Farm",
  headline: "5 runners. 2 pools. 78% cache hits.",
  /** What the head reads over a workspace with nothing in it. */
  emptyHeadline: "No runners yet. No pools yet. No cache data today.",
} as const;

/**
 * The stat row, tile by tile — four aggregates the service computes and the seed is shaped to.
 *
 * `ccache · per-runner` is where the page deliberately differs from the mockup's `shared per
 * pool`: decision **B5** makes the MVP's caches one per runner, and the label is the service's.
 */
export const SEEDED_STATS = [
  // An age, so a pattern: the seed wrote `forge-03`'s last heartbeat two hours before it
  // *migrated*, and the note is re-aged on every read. `2h` on a stack that has just come up,
  // `3h` on one somebody kept for the afternoon — both are the page telling the truth.
  { label: "Runners online", value: "4/5", line: /forge-03 offline · \dh/ },
  { label: "Builds today", value: "23", line: "19 clean · 3 retried · 1 failed" },
  { label: "Avg build time", value: "4m 12s", line: "▼ 38s vs last week" },
  { label: "Cache hit rate", value: "78%", line: "ccache · per-runner" },
] as const;

/**
 * The runners table's five rows, in the page's default order — by pool, then by name — with the
 * cells that do not move on a heartbeat.
 *
 * The status column is the point: the seed exists to put all of the mockup's archetypes on one
 * screen, and they are only still there because the seed dates its live runners' last heartbeat
 * a day ahead (`R__dev_seed_farm.sql` § *dated a day AHEAD*). With the stamps in the past, the
 * presence sweep made this whole table `offline` half a minute after the stack came up.
 */
export const SEEDED_RUNNERS = [
  { name: "forge-01", pool: "pool-a", status: "building", job: "#479", cpu: "82%", queue: "q:2" },
  { name: "forge-02", pool: "pool-a", status: "idle", job: null, cpu: "3%", queue: "q:0" },
  { name: "forge-03", pool: "pool-a", status: "offline", job: null, cpu: "—", queue: "q:0" },
  { name: "anvil-mac", pool: "pool-b", status: "idle", job: null, cpu: "6%", queue: "q:0" },
  { name: "bigiron", pool: "pool-b", status: "draining", job: "#472", cpu: "54%", queue: "q:1" },
] as const;

/** The pools card's two rows. */
export const SEEDED_POOLS = [
  { name: "pool-a", meta: /firmware builds · zephyr-sdk 0\.17 image · 3 runners/ },
  { name: "pool-b", meta: /HIL & macOS jobs · 2 runners/ },
] as const;

/**
 * The LIVE card: which build, and the first and last line of what it printed.
 *
 * First *and* last, because the order is the assertion. The seed's chunks were once stored in
 * the order PostgreSQL happened to hand them to the cap trigger, and the card — which reads by
 * offset — printed the memory map before the command that produced it (#261's finding, fixed in
 * the seed by #262).
 */
export const SEEDED_LIVE = {
  heading: /forge-01 · #479/,
  first: "$ west build -b helios_mainboard app -- -DCONFIG_OTA_ROLLBACK=y",
  last: "[6/7] Linking zephyr.elf …",
} as const;

/* ------------------------------------------------------------------ the states */

/** What a fresh workspace's page says — `app/farm/states.ts`, copied. */
export const FIRST_RUN = {
  stepsLabel: "How to enroll your first runner",
  createPool: "Create a pool",
  goToEnroll: "Go to the enroll command",
  stepOne: "Step one",
  stepTwo: "Step two",
  steps: {
    createPool: "Create a pool",
    copyCommand: "Copy the enroll command",
    runCommand: "Run it on the machine",
  },
} as const;

/** The strip over a fleet whose only machine is gone. */
export const FLEET_WARNING = {
  onlyRunnerOffline: "The only runner is offline.",
} as const;

/** What a member's page says about itself, and the reasons on what it draws inert. */
export const MEMBER_PAGE = {
  noteHead: "Viewing the build farm as a member.",
  enrollReason: "Enrolling a runner needs an owner or an admin.",
  poolReason: "Changing a pool needs an owner or an admin.",
  viewDetails: "View details",
} as const;

/* ------------------------------------------------------------------ the fresh workspace */

/** The pool the chain creates — through the page, by the no-pools state's own button. */
export const CHAIN_POOL = "pool-e2e";

/** What the plugin answers a create with — the one field this leg reads. */
interface CreatedOrganization {
  readonly slug: string;
}

/**
 * Sign the seeded owner in, make a brand-new workspace, act in it, and open its farm.
 *
 * The create goes to BetterAuth's organization plugin — the same write `specs/tenants.spec.ts`
 * proves is read back by this service's listing — and the creator is its `owner`, which is what
 * minting a token and creating a pool need.
 *
 * @param context - The context to act for.
 * @param page - The page to open the farm in.
 * @param label - A short word for the slug, so two groups' workspaces can be told apart.
 * @returns The new workspace's slug — the enroll command's `--tenant`.
 * @throws {Error} If the service refused the create, with what it answered.
 */
export async function enterFreshWorkspace(
  context: BrowserContext,
  page: Page,
  label: string,
): Promise<string> {
  await signIn(context, SEED_OWNER.id);

  const slug = ephemeralSlug(`farm-${label}`);
  const created = await requestAs<CreatedOrganization>(
    context,
    "POST",
    `${AUTH_BASE_PATH}/organization/create`,
    { name: `E2E Farm ${label}`, slug },
    `creating the fresh workspace ${slug}`,
  );

  if (created?.slug !== slug) {
    throw new Error(`creating ${slug} answered a workspace called ${String(created?.slug)}`);
  }

  await selectWorkspace(context, slug);
  await page.goto(FARM_PATH);

  return slug;
}

/**
 * Open the seeded workspace's farm.
 *
 * @param context - The context to act for.
 * @param page - The page to open it in.
 * @param as - Who is reading; the seeded owner unless a group says otherwise.
 * @param tenant - The workspace's slug.
 * @returns When the page has been asked for.
 */
export async function enterSeededFarm(
  context: BrowserContext,
  page: Page,
  as: string,
  tenant: string,
): Promise<void> {
  await signIn(context, as);
  await selectWorkspace(context, tenant);
  await page.goto(FARM_PATH);
}

/**
 * What the service answers this context when it asks for an enroll command.
 *
 * The page draws a member no **Copy command** at all, which is *presentation*; the gate that
 * decides is the service's, and this asks it directly. For a member the route refuses before
 * it mints, so asking costs nothing — which is why this is only ever called with one.
 *
 * @param context - The context to act for.
 * @param pool - The pool the command would name.
 * @returns The HTTP status the route answered.
 */
export async function enrollCommandStatusFor(
  context: BrowserContext,
  pool: string,
): Promise<number> {
  const token = await sessionTokenOf(context, `asking for an enroll command for ${pool}`);

  const response = await fetch(
    `${REST_URL}/api/v1/farm/enroll-command?pool=${encodeURIComponent(pool)}`,
    { headers: { cookie: `${SESSION_COOKIE}=${token}` } },
  );

  return response.status;
}
