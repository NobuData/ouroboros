import type { EnrollmentToken, FarmPage, FarmRunner, FarmStats, RunnerPool } from "@/app/api/farm";
import type { components } from "@/app/api/schema";
import type { FarmReadings } from "@/app/farm/data";
import type { MintOutcome, TokenListing } from "@/app/farm/enroll";
import type { FarmReader } from "@/app/farm/farm-screen";

/**
 * Build farm fixtures (#256): the development seed's fleet
 * (`ouroboros-db/migrations/R__dev_seed_farm.sql`) as `GET /api/v1/farm` answers it, which is
 * mockup 08's page — `5 runners. 2 pools. 78% cache hits.` — and the empty organization beside it.
 * The stat values are the ones `ouroboros-rest`'s own integration suite holds the seed to.
 */

/** When the fixtures' page was read: 2026-09-19T14:02:00Z, in epoch milliseconds. */
export const FARM_READ_AT = Date.UTC(2026, 8, 19, 14, 2, 0);

/**
 * The four stat cards, seed-shaped: `4/5`, `23` (`19 · 3 · 1`), `4m 12s ▼ 38s`, `78%`.
 *
 * @param over Whole cards to replace — a card is replaced, not merged, so a case states every
 *   field of the card it is about.
 * @returns The stats.
 */
export function farmStats(over: Partial<FarmStats> = {}): FarmStats {
  return {
    runnersOnline: {
      online: 4,
      total: 5,
      note: "forge-03 offline · 2h",
      offline: { name: "forge-03", lastSeenAt: "2026-09-19T12:02:00.000Z" },
    },
    buildsToday: {
      total: 23,
      clean: 19,
      retried: 3,
      failed: 1,
      canceled: 0,
      since: "2026-09-19T00:00:00.000Z",
      timeZone: "UTC",
    },
    avgBuildTime: { seconds: 252, builds: 20, priorSeconds: 290, priorBuilds: 140, deltaVsLastWeek: -38 },
    cacheHitRate: { pct: 78, hits: 6864, objects: 8800, label: "ccache · per-runner" },
    ...over,
  };
}

/**
 * One runner, seed-shaped — `forge-02`, idle in `pool-a`.
 *
 * @param over Fields to replace.
 * @returns The runner.
 */
export function farmRunner(over: Partial<FarmRunner> = {}): FarmRunner {
  return {
    id: "5eed0400-0000-4000-8000-0000000000a2",
    name: "forge-02",
    arch: "linux/arm64",
    poolId: "5eed0400-0000-4000-8000-0000000000b1",
    pool: "pool-a",
    status: "online",
    desiredState: "active",
    securityMode: "mtls",
    agentVersion: "0.9.0",
    hostname: "forge-02.lan",
    lastSeenAt: "2026-09-19T14:01:53.000Z",
    enrolledAt: "2026-08-01T09:00:00.000Z",
    uptimeSeconds: 604_800,
    telemetry: null,
    queueDepth: 0,
    currentJob: null,
    capabilities: {},
    ...over,
  };
}

/**
 * One pool, seed-shaped — `pool-a`, the container world, exactly as `R__dev_seed_farm.sql` stores
 * it: the pinned Zephyr SDK image, its allow-list, and an auto-scale preference that is off.
 *
 * @param over Fields to replace.
 * @returns The pool.
 */
export function runnerPool(over: Partial<RunnerPool> = {}): RunnerPool {
  return {
    id: "5eed0400-0000-4000-8000-0000000000b1",
    name: "pool-a",
    description: "firmware builds",
    executor: "container",
    image: "ghcr.io/acme-robotics/zephyr-sdk:0.17",
    enabled: true,
    maxConcurrency: 2,
    envAllowlist: ["CCACHE_DIR", "WEST_TOPDIR", "ZEPHYR_BASE"],
    tags: ["firmware", "zephyr"],
    defaultCommand: "west build -b helios_mainboard app",
    // Stored and inert (decision B9) — and what draws the card's auto-scale sub-toggle.
    autoscalePref: { enabled: false, queue_threshold: 5 },
    runners: 3,
    ...over,
  };
}

/** A runner's live snapshot, as the payload carries one. */
type RunnerTelemetry = components["schemas"]["RunnerTelemetry"];

/**
 * A heartbeat snapshot, seed-shaped.
 *
 * @param cpuPct CPU, `0`–`100`.
 * @param usedGb Memory in use, in decimal gigabytes.
 * @param totalGb Memory installed, in decimal gigabytes.
 * @param queueDepth What the agent said it was holding.
 * @returns The snapshot, sampled seven seconds before {@link FARM_READ_AT}.
 */
export function runnerTelemetry(
  cpuPct: number | null,
  usedGb: number | null,
  totalGb: number | null,
  queueDepth: number | null = 0,
): RunnerTelemetry {
  return {
    cpuPct,
    ramUsedBytes: usedGb === null ? null : usedGb * 1e9,
    ramTotalBytes: totalGb === null ? null : totalGb * 1e9,
    queueDepth,
    sampledAt: "2026-09-19T14:01:53.000Z",
  };
}

/** The pools' ids, by name. */
const POOL_IDS: Readonly<Record<string, string>> = {
  "pool-a": "5eed0400-0000-4000-8000-0000000000b1",
  "pool-b": "5eed0400-0000-4000-8000-0000000000b2",
};

/** Seconds in a day, for the seeded uptimes. */
const DAY_S = 86_400;

/**
 * The seeded fleet's five machines, in the seed's own order — which is mockup 08's row order and
 * **not** the table's default one — with everything the runners table (#257) prints: `forge-01`
 * building `#479` at 82%, two idle machines (the Mac on `bearer_fallback`, decision B3), `bigiron`
 * draining and finishing `#472`, and `forge-03` offline for two hours with no snapshot at all.
 */
const SEEDED_RUNNERS: readonly Partial<FarmRunner>[] = [
  {
    name: "forge-01",
    pool: "pool-a",
    status: "building",
    uptimeSeconds: 41 * DAY_S,
    telemetry: runnerTelemetry(82, 14.2, 32, 2),
    queueDepth: 2,
    currentJob: {
      id: "5eed0400-0000-4000-8000-0000000004f9",
      number: 479,
      label: "zephyr build",
      title: "Add OTA rollback on failed checksum",
      startedAt: "2026-09-19T13:58:19.000Z",
    },
  },
  {
    name: "forge-02",
    pool: "pool-a",
    status: "online",
    uptimeSeconds: 41 * DAY_S,
    telemetry: runnerTelemetry(3, 2.1, 32),
  },
  {
    name: "anvil-mac",
    arch: "darwin/arm64",
    pool: "pool-b",
    status: "online",
    securityMode: "bearer_fallback",
    uptimeSeconds: 12 * DAY_S,
    telemetry: runnerTelemetry(6, 5, 64),
  },
  {
    name: "bigiron",
    arch: "linux/x86_64",
    pool: "pool-b",
    status: "draining",
    desiredState: "draining",
    uptimeSeconds: 3 * DAY_S,
    telemetry: runnerTelemetry(54, 88, 256, 1),
    queueDepth: 1,
    currentJob: {
      id: "5eed0400-0000-4000-8000-0000000004f2",
      number: 472,
      label: "HIL test rig",
      title: "Overnight HIL sweep on rig-02",
      startedAt: "2026-09-19T09:42:00.000Z",
    },
  },
  {
    name: "forge-03",
    pool: "pool-a",
    status: "offline",
    agentVersion: "0.9.2",
    lastSeenAt: "2026-09-19T12:02:00.000Z",
    uptimeSeconds: null,
    telemetry: null,
  },
];

/**
 * The seeded farm, as mockup 08 draws it: five runners, two pools, and the stat row's numbers.
 *
 * @param over Top-level fields to replace.
 * @returns The page.
 */
export function seededFarm(over: Partial<FarmPage> = {}): FarmPage {
  return {
    stats: farmStats(),
    runners: SEEDED_RUNNERS.map((runner, index) =>
      farmRunner({
        id: `5eed0400-0000-4000-8000-0000000000a${String(index + 1)}`,
        poolId: POOL_IDS[runner.pool ?? "pool-a"],
        ...runner,
      }),
    ),
    pools: [
      runnerPool(),
      runnerPool({
        id: "5eed0400-0000-4000-8000-0000000000b2",
        name: "pool-b",
        description: "HIL & macOS jobs",
        executor: "shell",
        image: null,
        maxConcurrency: 1,
        envAllowlist: ["DEVELOPER_DIR", "HIL_RIG_ID"],
        tags: ["hil", "macos"],
        defaultCommand: null,
        autoscalePref: {},
        runners: 2,
      }),
    ],
    live: null,
    ...over,
  };
}

/**
 * A brand-new organization: nothing enrolled, nothing built, nothing measured. Genuine zeros for
 * the counts and `null` wherever there is nothing to average — exactly what AH.6 answers.
 *
 * @returns The page.
 */
export function emptyFarm(): FarmPage {
  return {
    stats: {
      runnersOnline: { online: 0, total: 0, note: null, offline: null },
      buildsToday: {
        total: 0,
        clean: 0,
        retried: 0,
        failed: 0,
        canceled: 0,
        since: "2026-09-19T00:00:00.000Z",
        timeZone: "UTC",
      },
      avgBuildTime: { seconds: null, builds: 0, priorSeconds: null, priorBuilds: 0, deltaVsLastWeek: null },
      cacheHitRate: { pct: null, hits: 0, objects: 0, label: "ccache · per-runner" },
    },
    runners: [],
    pools: [],
    live: null,
  };
}

/**
 * What the route hands the screen.
 *
 * @param page The page the first paint read. Defaults to the seeded farm.
 * @returns The readings, read at {@link FARM_READ_AT}.
 */
export function farmReadings(page: FarmPage = seededFarm()): FarmReadings {
  return { page: { ok: true, value: page }, readAt: FARM_READ_AT };
}

/**
 * What the route hands the screen when the first read was refused.
 *
 * @param reason The service's sentence.
 * @returns The readings.
 */
export function failedFarmReadings(reason = "The farm is unavailable."): FarmReadings {
  return { page: { ok: false, reason }, readAt: FARM_READ_AT };
}

/* ------------------------------------------------------------------ the enroll flow (#258) */

/** A reader who may look and not mint — a `member`, or a `viewer`. */
export const MEMBER_READER: FarmReader = { mayAdminister: false, tenant: "acme-robotics" };

/** A reader who may mint and revoke — an `owner` or an `admin`. */
export const ADMIN_READER: FarmReader = { mayAdminister: true, tenant: "acme-robotics" };

/**
 * A token value no fixture renders: the string the *no full token in the DOM* cases search the
 * document for. Shaped like a real one so a mask that only recognised a test value would fail.
 */
export const TOKEN_SECRET = "orb_enroll_5eed0400a4b7.Zm9yZ2UtZmFybS1zZWNyZXQtdmFsdWU";

/** The https origin the fixtures' deployment answers — not the UI's own. */
export const FARM_ORIGIN = "https://ouroboros.acme.dev";

/** The agent release the fixtures' command pins. */
export const FARM_AGENT_VERSION = "0.9.0";

/**
 * One enrollment token, masked — single-use, a day to live from {@link FARM_READ_AT}, unused.
 *
 * @param over Fields to replace.
 * @returns The token.
 */
export function enrollmentToken(over: Partial<EnrollmentToken> = {}): EnrollmentToken {
  return {
    id: "5eed0400-0000-4000-8000-00000000a4b7",
    poolId: POOL_IDS["pool-a"]!,
    masked: "orb_enroll_••••a4b7",
    expiresAt: "2026-09-20T14:02:00.000Z",
    maxUses: 1,
    uses: 0,
    revoked: false,
    revokedAt: null,
    createdBy: "user-ken",
    createdAt: "2026-09-19T14:02:00.000Z",
    ...over,
  };
}

/**
 * The command `GET /api/v1/farm/enroll-command` answers, **with its live token** — four lines,
 * every value single-quoted, as `ouroboros-rest`'s `renderEnrollCommand` writes it.
 *
 * @param pool The pool.
 * @param secret The token's value.
 * @returns The command.
 */
export function mintedCommand(pool = "pool-a", secret = TOKEN_SECRET): string {
  return [
    `curl -fsSL '${FARM_ORIGIN}/install.sh?version=${FARM_AGENT_VERSION}' | sh -s --`,
    "--tenant 'acme-robotics'",
    `--pool '${pool}'`,
    `--token '${secret}'`,
  ].join(" \\\n  ");
}

/**
 * What a press of *Copy command* is answered — the command whole, and masked as the action
 * masks it.
 *
 * @param pool The pool.
 * @param token The masked token it carries.
 * @returns The outcome.
 */
export function mintOutcome(
  pool = "pool-a",
  token: EnrollmentToken = enrollmentToken(),
): Extract<MintOutcome, { ok: true }> {
  return {
    ok: true,
    command: mintedCommand(pool),
    shown: mintedCommand(pool, token.masked),
    origin: FARM_ORIGIN,
    version: FARM_AGENT_VERSION,
    token,
  };
}

/**
 * A listing of the diagram's two rows: a live token for `pool-a`, and an expired one for `pool-b`.
 *
 * @param tokens The tokens, newest first. Defaults to the diagram's.
 * @returns The listing, read at {@link FARM_READ_AT}.
 */
export function tokenListing(
  tokens: readonly EnrollmentToken[] = [
    enrollmentToken({ maxUses: 5, uses: 1 }),
    enrollmentToken({
      id: "5eed0400-0000-4000-8000-00000000c0de",
      poolId: POOL_IDS["pool-b"]!,
      masked: "orb_enroll_••••c0de",
      expiresAt: "2026-09-18T14:02:00.000Z",
      createdAt: "2026-09-17T14:02:00.000Z",
    }),
  ],
): Extract<TokenListing, { ok: true }> {
  return {
    ok: true,
    tokens,
    pools: { [POOL_IDS["pool-a"]!]: "pool-a", [POOL_IDS["pool-b"]!]: "pool-b" },
    people: { "user-ken": "Ken" },
    readAt: FARM_READ_AT,
  };
}
