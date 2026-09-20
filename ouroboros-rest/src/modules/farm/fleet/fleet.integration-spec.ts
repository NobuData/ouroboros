import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApiHarness, type Person, type Workspace } from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import { certificationRequest } from "../farm.fixture";
import type {
  EnrollCommandResource,
  EnrollmentResource,
  MintedTokenResource,
} from "../farm.resources";
import { FakeAgent, isRefused } from "../gateway/fake.agent.fixture";
import { fixtureFrame } from "../gateway/gateway.fixture";
import type { FarmResource, PoolResource, RunnerResource } from "./fleet.resources";
import type { LifecycleResult } from "./runners.service";

/**
 * The build farm's read surfaces and lifecycle actions, end to end
 * ([#254](https://github.com/NobuData/ouroboros/issues/254)) — against the whole application,
 * a migrated database, and a fake agent over a real WebSocket.
 *
 * Every acceptance criterion the issue lists is asked here as an operator would ask it:
 *
 *   * **Seeded payloads reproduce every number on mockup 08** — `4/5`, `forge-03 offline · 2h`,
 *     `23` split `19 · 3 · 1`, `4m 12s` with `▼ 38s`, `78%`, `q:2`/`q:1`, `3 runners`/
 *     `2 runners`, and the live build `#479` on `forge-01`.
 *   * **The windows have edges**, including a build finished two minutes before midnight and
 *     one finished two minutes after — which land in different days.
 *   * **An empty organization** yields zeros where a count is genuinely zero and **nulls**
 *     where there is nothing to average. Never `0m 00s`, never `0%`.
 *   * **The prior-week delta is absent** when no prior window exists.
 *   * **The cache label reads `ccache · per-runner`** (B5), and is derived.
 *   * **Drain round-trips to a live fake agent** and the pill follows its heartbeat.
 *   * **Remove is blocked** for an online runner, with an error naming the reason.
 *   * **`autoscale_pref` persists and returns unchanged.**
 *   * **The enroll command actually enrols** — its token is spent against the real route.
 *   * **Member is read-only; admin and above may mutate**, enforced server-side.
 *   * **Organization isolation** holds on every route.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The header this suite's application trusts a proxy to forward a certificate in. */
const HEADER = "x-ouro-client-cert";

/** Where the page lives. */
const FARM = "/api/v1/farm";

/** The https origin this deployment tells runner machines to install from. */
const ORIGIN = "https://ouroboros.acme.dev";

/** The agent release it serves. */
const RELEASE = "0.7.0";

/**
 * Today's twenty-three finished builds, exactly as `R__dev_seed_farm.sql` shapes them.
 *
 * The durations are the seed's own and total **5 796 seconds** over twenty-three builds —
 * `252`, which the card prints as `4m 12s`. The sixteen ccache pairs total **6 864 hits in
 * 8 800 objects**, which is the `78%` meter. The seven that carry none are the shell pool's
 * four and the three attempts that died before ccache printed a summary: **null is not zero**
 * (decision B5), and a rate that read them as 0% would be visibly wrong rather than plausibly
 * wrong.
 *
 * `slot` places each build inside the *elapsed* part of the current UTC day, as the seed
 * does, so the whole set lands inside today and in the past whatever hour the suite runs at.
 */
const TODAY: readonly [
  number,
  string,
  number | null,
  number,
  number | null,
  number | null,
  number,
][] = [
  [455, "succeeded", 0, 198, 374, 106, 1],
  [456, "succeeded", 0, 205, 488, 122, 2],
  [457, "retried", 1, 96, null, null, 3],
  [458, "succeeded", 0, 212, 315, 105, 4],
  [459, "succeeded", 0, 221, 583, 137, 5],
  [460, "succeeded", 0, 228, 421, 119, 6],
  [461, "succeeded", 0, 233, 341, 114, 7],
  [462, "retried", 1, 142, null, null, 8],
  [463, "succeeded", 0, 240, 544, 136, 9],
  [464, "succeeded", 0, 246, 379, 126, 10],
  [465, "succeeded", 0, 251, 448, 112, 11],
  [466, "retried", 1, 173, null, null, 12],
  [467, "succeeded", 0, 255, 322, 108, 13],
  [468, "succeeded", 0, 262, 486, 129, 14],
  [469, "succeeded", 0, 268, 372, 118, 15],
  [470, "succeeded", 0, 274, 460, 115, 16],
  [471, "succeeded", 0, 281, 507, 143, 17],
  [473, "succeeded", 0, 288, 353, 117, 18],
  [474, "succeeded", 0, 295, 471, 129, 19],
  [475, "succeeded", 0, 302, null, null, 20],
  [476, "succeeded", 0, 311, null, null, 21],
  [477, "succeeded", 0, 324, null, null, 22],
  [478, "failed", 2, 491, null, null, 23],
];

/**
 * The prior week's twenty, and the other side of `▼ 38s`.
 *
 * Every one of them 290 seconds, which is the seed's mean over its own spread. The spread is
 * the seed's business; what this window has to be is **290**, so that `252 − 290` is the
 * thirty-eight the card prints. Each lands on one of the seven whole days before today.
 *
 * Fourteen carry ccache at a deliberately different rate — near 70%, not 78% — so a cache
 * rate computed **without** the day window reads about 74% and fails loudly rather than
 * passing by a rounding.
 */
const PRIOR_DURATION = 290;

/** How many builds the prior week holds. */
const PRIOR_BUILDS = 20;

/** A runner as this suite seeds one. */
interface RunnerSeed {
  readonly name: string;
  readonly pool: string;
  readonly arch: string;
  readonly status: string;
  readonly desired: string;
  readonly lastSeenSecondsAgo: number;
  readonly uptime: number | null;
  readonly telemetry: Record<string, number> | null;
  readonly securityMode: string;
  readonly certSerial: string | null;
}

/** Mockup 08's five rows, and the sixth it does not show. */
const FLEET: readonly RunnerSeed[] = [
  {
    name: "forge-01",
    pool: "pool-a",
    arch: "linux/arm64",
    status: "building",
    desired: "active",
    lastSeenSecondsAgo: 4,
    uptime: 3_542_400,
    telemetry: {
      cpu_pct: 82,
      ram_used_bytes: 14_200_000_000,
      ram_total_bytes: 32_000_000_000,
      queue_depth: 2,
    },
    securityMode: "mtls",
    certSerial: "4a110e97",
  },
  {
    name: "forge-02",
    pool: "pool-a",
    arch: "linux/arm64",
    status: "online",
    desired: "active",
    lastSeenSecondsAgo: 7,
    uptime: 3_542_400,
    telemetry: {
      cpu_pct: 3,
      ram_used_bytes: 2_100_000_000,
      ram_total_bytes: 32_000_000_000,
      queue_depth: 0,
    },
    securityMode: "mtls",
    certSerial: "4a110e98",
  },
  {
    name: "anvil-mac",
    pool: "pool-b",
    arch: "darwin/arm64",
    status: "online",
    desired: "active",
    lastSeenSecondsAgo: 5,
    uptime: 1_036_800,
    telemetry: {
      cpu_pct: 6,
      ram_used_bytes: 5_000_000_000,
      ram_total_bytes: 64_000_000_000,
      queue_depth: 0,
    },
    // Decision B3 — a Mac behind a proxy that terminates client certificates.
    securityMode: "bearer_fallback",
    certSerial: null,
  },
  {
    name: "bigiron",
    pool: "pool-b",
    arch: "linux/x86_64",
    status: "draining",
    desired: "draining",
    lastSeenSecondsAgo: 9,
    uptime: 259_200,
    telemetry: {
      cpu_pct: 54,
      ram_used_bytes: 88_000_000_000,
      ram_total_bytes: 256_000_000_000,
      queue_depth: 1,
    },
    securityMode: "mtls",
    certSerial: "4a110e99",
  },
  {
    // Two hours, which is the note's `2h`. No telemetry and no uptime: a snapshot the fleet
    // cannot vouch for is not a snapshot, and the mockup prints `—`.
    name: "forge-03",
    pool: "pool-a",
    arch: "linux/arm64",
    status: "offline",
    desired: "active",
    lastSeenSecondsAgo: 7200,
    uptime: null,
    telemetry: null,
    securityMode: "mtls",
    certSerial: "4a110e9a",
  },
  {
    // The near miss every count of the fleet has to exclude. A count that forgets reads six
    // runners, and pool-a reads four rather than three.
    name: "forge-00",
    pool: "pool-a",
    arch: "linux/arm64",
    status: "removed",
    desired: "removed",
    lastSeenSecondsAgo: 518_400,
    uptime: null,
    telemetry: null,
    securityMode: "mtls",
    certSerial: "4a110e9b",
  },
];

/** A refusal, as the error filter writes one — named once rather than inlined six times. */
interface Refusal {
  readonly code: string;
  readonly message: string;
  readonly details: Record<string, unknown>;
}

/** A workspace with the mockup's farm in it. */
interface Farm {
  readonly owner: Person;
  readonly workspace: Workspace;
  readonly repoId: string;
}

describe("the build farm page", () => {
  let api: ApiHarness;
  const agents: FakeAgent[] = [];

  beforeAll(async () => {
    // A releases directory with one version in it. `enrollTarget` reads the *names* of the
    // subdirectories and never their contents, so an empty one is a release as far as the
    // enroll command is concerned — and laying out a real `install.sh` here would be testing
    // the filesystem rather than the command.
    const releases = await mkdtemp(join(tmpdir(), "ouro-releases-"));
    await mkdir(join(releases, RELEASE));

    api = await ApiHarness.start({
      OURO_FARM_CLIENT_CERT_HEADER: HEADER,
      OURO_FARM_PUBLIC_URL: ORIGIN,
      OURO_FARM_RELEASES_DIR: releases,
    });
  });

  afterAll(() => api.close());

  afterEach(async () => {
    for (const agent of agents.splice(0)) agent.drop();
    await api.truncate();
  });

  /** A workspace with an owner, and a mirrored repository for its builds to be of. */
  async function workspace(): Promise<Farm> {
    const owner = await api.signIn();
    const space = await api.workspace(owner);

    const { rows: orgs } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.github_orgs (organization_id, login, enabled)
       values ($1, 'acme-robotics', true) returning id`,
      [space.id],
    );
    const { rows: repos } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.github_repos (org_id, name, enabled)
       values ($1, 'helios-firmware', true) returning id`,
      [orgs[0].id],
    );

    return { owner, workspace: space, repoId: repos[0].id };
  }

  /** The two pools of mockup 08. */
  async function pools(context: Farm): Promise<void> {
    await api.sql.query(
      `insert into ouroboros.runner_pools
         (organization_id, name, description, executor, image, env_allowlist,
          max_concurrency, enabled, autoscale_pref, tags, default_command)
       values
         ($1, 'pool-a', 'firmware builds', 'container',
          'ghcr.io/acme-robotics/zephyr-sdk:0.17',
          '["CCACHE_DIR"]'::jsonb, 2, true,
          '{"enabled": false, "queue_threshold": 5}'::jsonb, '["firmware"]'::jsonb,
          'west build -b helios_mainboard app'),
         ($1, 'pool-b', 'HIL & macOS jobs', 'shell', null,
          '["HIL_RIG_ID"]'::jsonb, 1, true, '{}'::jsonb, '["hil"]'::jsonb, null)`,
      [context.workspace.id],
    );
  }

  /**
   * One idle machine, for a case that needs a fleet only so its builds are legal.
   *
   * V040's `build_jobs_runner_when_dispatched` requires a runner on every build past
   * `queued`: a finished build ran somewhere. The window cases care about `finished_at` and
   * nothing else, so they get the smallest fleet that lets a build exist.
   *
   * @param context - The workspace.
   * @returns The machine's name.
   */
  async function oneRunner(context: Farm): Promise<string> {
    await api.sql.query(
      `insert into ouroboros.runners
         (organization_id, pool_id, name, arch, status, last_seen_at, security_mode,
          cert_serial, enrolled_at, telemetry)
       select $1, pool.id, 'forge-01', 'linux/arm64', 'online', now(), 'mtls',
              '4a110e97', now() - make_interval(days => 60), '{}'::jsonb
         from ouroboros.runner_pools pool
        where pool.organization_id = $1 and pool.name = 'pool-a'`,
      [context.workspace.id],
    );

    return "forge-01";
  }

  /** The six machines, five of them in the fleet. */
  async function fleet(context: Farm): Promise<void> {
    for (const machine of FLEET) {
      await api.sql.query(
        `insert into ouroboros.runners
           (organization_id, pool_id, name, arch, status, desired_state, last_seen_at,
            agent_version, capabilities, security_mode, cert_serial, bearer_sealed,
            enrolled_at, uptime_seconds, telemetry)
         select $1, pool.id, $2, $3, $4, $5,
                now() - make_interval(secs => $6::double precision),
                '1.0.0', '{"docker": true, "cpu_count": 8}'::jsonb, $7, $8, $9,
                now() - make_interval(days => 60), $10, $11::jsonb
           from ouroboros.runner_pools pool
          where pool.organization_id = $1 and pool.name = $12`,
        [
          context.workspace.id,
          machine.name,
          machine.arch,
          machine.status,
          machine.desired,
          machine.lastSeenSecondsAgo,
          machine.securityMode,
          machine.certSerial,
          machine.securityMode === "bearer_fallback"
            ? "ouro.v1.1.ZmFybS1zZWVkLW5vbmNlLTM.ZGV2LXNlZWQtdmFsdWUtbm90LWEtcmVhbC1iZWFyZXItc2VjcmV0"
            : null,
          machine.uptime,
          JSON.stringify(machine.telemetry ?? {}),
          machine.pool,
        ],
      );
    }
  }

  /**
   * One finished build, placed inside a window.
   *
   * @param context - The workspace.
   * @param job - Its number, status, exit code, duration and ccache pair.
   * @param at - SQL for the instant it finished, relative to `now()`.
   * @param pool - Which pool it ran in.
   * @param runner - Which machine. Required, because V040's
   *   `build_jobs_runner_when_dispatched` says a build past `queued` ran somewhere.
   */
  async function finished(
    context: Farm,
    job: {
      number: number;
      status: string;
      exitCode: number | null;
      duration: number;
      hits: number | null;
      misses: number | null;
    },
    at: string,
    pool = "pool-a",
    runner = "forge-01",
  ): Promise<void> {
    await api.sql.query(
      `insert into ouroboros.build_jobs
         (organization_id, number, pool_id, runner_id, github_repo_id, git_ref, commit_sha,
          label, title, executor, image, command, status,
          queued_at, offered_at, started_at, finished_at, exit_code, ccache_stats)
       select $1, $2, pool.id, runner.id, $3, 'refs/heads/main',
              lpad(to_hex($2::int), 40, '0'),
              'zephyr build', 'A build', pool.executor, pool.image,
              'west build -b helios_mainboard app', $4,
              (${at}) - make_interval(secs => $5::double precision + 20),
              (${at}) - make_interval(secs => $5::double precision + 10),
              (${at}) - make_interval(secs => $5::double precision),
              (${at}), $6,
              case when $7::int is null then null
                   else jsonb_build_object('hits', $7::int, 'misses', $8::int,
                                           'version', '4.9') end
         from ouroboros.runner_pools pool
         join ouroboros.runners runner
           on runner.organization_id = $1 and runner.name = $9
        where pool.organization_id = $1 and pool.name = $10`,
      [
        context.workspace.id,
        job.number,
        context.repoId,
        job.status,
        job.duration,
        job.exitCode,
        job.hits,
        job.misses,
        runner,
        pool,
      ],
    );
  }

  /** Today's twenty-three, placed in the elapsed part of the current UTC day. */
  async function today(context: Farm): Promise<void> {
    for (const [number, status, exitCode, duration, hits, misses, slot] of TODAY) {
      const pool = number >= 475 ? "pool-b" : "pool-a";
      const runner = pool === "pool-b" ? "bigiron" : "forge-01";

      await finished(
        context,
        { number, status, exitCode, duration, hits, misses },
        `date_trunc('day', now()) + (now() - date_trunc('day', now())) * (${String(slot)}::double precision / 24)`,
        pool,
        runner,
      );
    }
  }

  /** The prior week's twenty, one on each of the seven whole days before today. */
  async function priorWeek(context: Farm): Promise<void> {
    for (let index = 0; index < PRIOR_BUILDS; index += 1) {
      const daysAgo = (index % 7) + 1;
      const status = index < 17 ? "succeeded" : index < 19 ? "retried" : "failed";

      await finished(
        context,
        {
          number: 400 + index,
          status,
          exitCode: status === "succeeded" ? 0 : status === "failed" ? 2 : 1,
          duration: PRIOR_DURATION,
          // A deliberately different rate — near 70%, so a window-less cache read is visibly
          // wrong rather than plausibly wrong.
          hits: index < 14 ? 700 : null,
          misses: index < 14 ? 300 : null,
        },
        `date_trunc('day', now()) - make_interval(days => ${String(daysAgo)}) + make_interval(hours => 9)`,
      );
    }
  }

  /** What is in flight: two running builds and three waiting behind them. */
  async function inFlight(context: Farm): Promise<void> {
    const rows: [number, string, string, string, number, number | null][] = [
      [472, "pool-b", "bigiron", "running", 15_660, 15_600],
      [479, "pool-a", "forge-01", "running", 260, 221],
      [480, "pool-a", "forge-01", "queued", 150, null],
      [481, "pool-a", "forge-01", "queued", 95, null],
      [482, "pool-b", "bigiron", "queued", 40, null],
    ];

    for (const [number, pool, runner, status, queued, started] of rows) {
      await api.sql.query(
        `insert into ouroboros.build_jobs
           (organization_id, number, pool_id, runner_id, github_repo_id, git_ref, commit_sha,
            label, title, executor, image, command, status,
            queued_at, offered_at, started_at, ccache_stats)
         select $1, $2, pool.id, runner.id, $3, 'refs/heads/main',
                lpad(to_hex($2::int), 40, '0'),
                $4, $5, pool.executor, pool.image, 'west build', $6,
                now() - make_interval(secs => $7::double precision),
                case when $8::int is null then null
                     else now() - make_interval(secs => $8::double precision + 10) end,
                case when $8::int is null then null
                     else now() - make_interval(secs => $8::double precision) end,
                case when $2 = 479
                     then jsonb_build_object('hits', 412, 'misses', 113, 'version', '4.9')
                     else null end
           from ouroboros.runner_pools pool
           join ouroboros.runners runner
             on runner.organization_id = $1 and runner.name = $9
          where pool.organization_id = $1 and pool.name = $10`,
        [
          context.workspace.id,
          number,
          context.repoId,
          number === 472 ? "HIL test rig" : "zephyr build",
          number === 479 ? "Add OTA rollback on failed checksum" : "A build",
          status,
          queued,
          started,
          runner,
          pool,
        ],
      );
    }
  }

  /** The whole of mockup 08's farm. */
  async function seeded(): Promise<Farm> {
    const context = await workspace();
    await pools(context);
    await fleet(context);
    await today(context);
    await priorWeek(context);
    await inFlight(context);

    return context;
  }

  /** Read the page as somebody. */
  async function page(context: Farm, person: Person = context.owner): Promise<FarmResource> {
    return bodyOf<FarmResource>(
      await api.as(person)("get", FARM).set(TENANT_HEADER, context.workspace.id).expect(200),
    );
  }

  /** A runner of the payload, by name. */
  function machine(payload: FarmResource, name: string): RunnerResource {
    const found = payload.runners.find((runner) => runner.name === name);
    if (!found) throw new Error(`no runner named ${name} in the payload`);

    return found;
  }

  /** A pool of the payload, by name. */
  function pool(payload: FarmResource, name: string): PoolResource {
    const found = payload.pools.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`no pool named ${name} in the payload`);

    return found;
  }

  /** Enrol a machine through the real routes, into a pool. */
  async function enrol(
    context: Farm,
    name: string,
    poolName = "pool-a",
  ): Promise<{ runnerId: string; certificate: string }> {
    const minted = bodyOf<MintedTokenResource>(
      await api
        .as(context.owner)("post", "/api/v1/farm/enrollment-tokens")
        .set(TENANT_HEADER, context.workspace.id)
        .send({ pool: poolName })
        .expect(201),
    );
    const enrollment = bodyOf<EnrollmentResource>(
      await api
        .anonymous("post", "/api/v1/farm/registrations")
        .send({ token: minted.token, name, arch: "linux/x86_64", csr: certificationRequest() })
        .expect(201),
    );

    return { runnerId: enrollment.runnerId, certificate: enrollment.certificate as string };
  }

  /** Connect an enrolled runner and say hello. */
  async function connect(runner: { certificate: string }): Promise<FakeAgent> {
    const agent = await FakeAgent.connect(api.baseUrl, {
      certificate: runner.certificate,
      header: HEADER,
    });
    if (isRefused(agent)) throw new Error(`refused: ${String(agent.status)} ${agent.code}`);
    agents.push(agent);

    agent.send(fixtureFrame("valid/hello.json"));
    await agent.next("ack");

    return agent;
  }

  /** Read a runner row's observed status. */
  async function statusOf(runnerId: string): Promise<string> {
    const { rows } = await api.sql.query<{ status: string }>(
      `select status from ouroboros.runners where id = $1`,
      [runnerId],
    );

    return rows[0].status;
  }

  /** Poll until a read satisfies a predicate, or give up. */
  async function eventually<T>(read: () => Promise<T>, holds: (value: T) => boolean): Promise<T> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const value = await read();
      if (holds(value)) return value;

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error("the condition never held");
  }

  describe("the seeded payload reproduces every number on mockup 08", () => {
    it("reads 4/5 runners online, with forge-03 offline two hours ago", async () => {
      const payload = await page(await seeded());

      expect(payload.stats.runnersOnline.online).toBe(4);
      expect(payload.stats.runnersOnline.total).toBe(5);
      expect(payload.stats.runnersOnline.note).toBe("forge-03 offline · 2h");
    });

    it("excludes the retired machine from the fleet and from every count of it", async () => {
      // `forge-00` is the near miss. A count that forgets reads six runners and four in
      // pool-a; the row is kept because two of last week's builds reference it.
      const payload = await page(await seeded());

      expect(payload.runners.map((runner) => runner.name).sort()).toEqual([
        "anvil-mac",
        "bigiron",
        "forge-01",
        "forge-02",
        "forge-03",
      ]);
      expect(pool(payload, "pool-a").runners).toBe(3);
      expect(pool(payload, "pool-b").runners).toBe(2);
    });

    it("reads 23 builds today, split 19 clean · 3 retried · 1 failed", async () => {
      const payload = await page(await seeded());

      expect(payload.stats.buildsToday).toMatchObject({
        total: 23,
        clean: 19,
        retried: 3,
        failed: 1,
        canceled: 0,
        timeZone: "UTC",
      });
    });

    it("leaves running and queued builds out of the day's count", async () => {
      // A count taken over `queued_at` rather than `finished_at` reads 28; one that forgot to
      // require a terminal status reads the same.
      const payload = await page(await seeded());

      expect(payload.stats.buildsToday.total).toBe(23);
    });

    it("leaves last week's builds out of it", async () => {
      // A count that forgot the day window reads 43.
      const payload = await page(await seeded());

      expect(payload.stats.buildsToday.total).not.toBe(43);
      expect(payload.stats.buildsToday.total).toBe(23);
    });

    it("reads 4m 12s, down 38 seconds on the week before", async () => {
      const payload = await page(await seeded());

      expect(payload.stats.avgBuildTime.seconds).toBe(252);
      expect(payload.stats.avgBuildTime.builds).toBe(23);
      expect(payload.stats.avgBuildTime.priorSeconds).toBe(290);
      expect(payload.stats.avgBuildTime.priorBuilds).toBe(PRIOR_BUILDS);
      expect(payload.stats.avgBuildTime.deltaVsLastWeek).toBe(-38);
    });

    it("is not dragged by a build that has been running since this morning", async () => {
      // `#472` started four hours ago and has no `finished_at`. An average over
      // `now() - started_at` instead of over the recorded pair would be dragged by it.
      const payload = await page(await seeded());

      expect(payload.stats.avgBuildTime.seconds).toBe(252);
    });

    it("reads a 78% cache hit rate, labelled per-runner", async () => {
      const payload = await page(await seeded());

      expect(payload.stats.cacheHitRate.pct).toBe(78);
      expect(payload.stats.cacheHitRate.hits).toBe(6864);
      expect(payload.stats.cacheHitRate.objects).toBe(8800);
      expect(payload.stats.cacheHitRate.label).toBe("ccache · per-runner");
      expect(payload.stats.cacheHitRate.label).not.toContain("shared per pool");
    });

    it("weighs the rate by objects rather than averaging per-build rates", async () => {
      // Seven of today's twenty-three carry no summary at all. A mean of per-job rates that
      // read a missing one as 0% reads about 54%; one that dropped the day window reads 74%.
      const payload = await page(await seeded());

      expect(payload.stats.cacheHitRate.pct).not.toBe(54);
      expect(payload.stats.cacheHitRate.pct).not.toBe(74);
      expect(payload.stats.cacheHitRate.pct).toBe(78);
    });

    it("draws the runners table's cells, including the offline row's em-dashes", async () => {
      const payload = await page(await seeded());

      expect(machine(payload, "forge-01")).toMatchObject({
        arch: "linux/arm64",
        pool: "pool-a",
        status: "building",
        securityMode: "mtls",
        uptimeSeconds: 3_542_400,
        queueDepth: 2,
      });
      expect(machine(payload, "forge-01").telemetry).toMatchObject({
        cpuPct: 82,
        ramUsedBytes: 14_200_000_000,
        ramTotalBytes: 32_000_000_000,
      });
      expect(machine(payload, "forge-01").currentJob).toMatchObject({ number: 479 });

      const offline = machine(payload, "forge-03");

      expect(offline.status).toBe("offline");
      expect(offline.telemetry).toBeNull();
      expect(offline.uptimeSeconds).toBeNull();
      expect(offline.currentJob).toBeNull();
      expect(offline.queueDepth).toBe(0);
    });

    it("reads q:2 on forge-01 and q:1 on bigiron, and q:0 everywhere else", async () => {
      const payload = await page(await seeded());

      expect(machine(payload, "forge-01").queueDepth).toBe(2);
      expect(machine(payload, "bigiron").queueDepth).toBe(1);
      expect(machine(payload, "forge-02").queueDepth).toBe(0);
      expect(machine(payload, "anvil-mac").queueDepth).toBe(0);
    });

    it("shows the bearer fallback as what it is", async () => {
      // Decision B3: recorded rather than hidden, so AI.2 renders a degraded connection as
      // degraded instead of putting a green shield over the weaker mode.
      const payload = await page(await seeded());

      expect(machine(payload, "anvil-mac").securityMode).toBe("bearer_fallback");
    });

    it("names the live build as #479 on forge-01", async () => {
      // The newest running build, not the longest: `#472` has been sweeping a rig since this
      // morning, and `#479` is the one somebody is waiting on.
      const payload = await page(await seeded());

      expect(payload.live).toMatchObject({
        number: 479,
        runner: "forge-01",
        title: "Add OTA rollback on failed checksum",
      });
    });

    it("carries the pools card's metadata", async () => {
      const payload = await page(await seeded());

      expect(pool(payload, "pool-a")).toMatchObject({
        description: "firmware builds",
        executor: "container",
        image: "ghcr.io/acme-robotics/zephyr-sdk:0.17",
        enabled: true,
        runners: 3,
        autoscalePref: { enabled: false, queue_threshold: 5 },
      });
      expect(pool(payload, "pool-b")).toMatchObject({
        description: "HIL & macOS jobs",
        executor: "shell",
        image: null,
        runners: 2,
      });
    });

    it("carries no secret of any kind", async () => {
      const payload = await page(await seeded());

      expect(JSON.stringify(payload)).not.toContain("ouro.v1");
      expect(JSON.stringify(payload)).not.toContain("4a110e97");
    });

    it("tells a client how long to wait, and not to cache it", async () => {
      const context = await seeded();
      const response = await api
        .as(context.owner)("get", FARM)
        .set(TENANT_HEADER, context.workspace.id)
        .expect(200);

      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["x-ouro-poll-after"]).toBe("10");
    });
  });

  describe("the windows have edges", () => {
    it("counts a build finished just before midnight in the day it finished in", async () => {
      // The issue's own case. Both builds are minutes apart and land in different days,
      // which is the whole of what a day boundary is for.
      //
      // The later one is clamped to `now()`, and that is not a fudge: the day window is
      // closed at **both** ends — `[dayStart, now]` — so a build dated two minutes after
      // midnight is genuinely in the future for a suite run at 00:01, and excluding it is
      // the window being right. Clamping keeps the case about the *boundary* rather than
      // about what time the suite happens to run at.
      const context = await workspace();
      await pools(context);
      const on = await oneRunner(context);

      await finished(
        context,
        { number: 900, status: "succeeded", exitCode: 0, duration: 60, hits: null, misses: null },
        "date_trunc('day', now()) - make_interval(mins => 2)",
        "pool-a",
        on,
      );
      await finished(
        context,
        { number: 901, status: "succeeded", exitCode: 0, duration: 60, hits: null, misses: null },
        "least(date_trunc('day', now()) + make_interval(mins => 2), now())",
        "pool-a",
        on,
      );

      const payload = await page(context);

      expect(payload.stats.buildsToday.total).toBe(1);
      expect(payload.stats.buildsToday.since).toBe(
        new Date(
          Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()),
        ).toISOString(),
      );
    });

    it("puts the build before midnight in the prior week's window instead", async () => {
      // Adjacent and disjoint: the build that left today is inside the window today is
      // compared against, rather than nowhere.
      const context = await workspace();
      await pools(context);
      const on = await oneRunner(context);

      await finished(
        context,
        { number: 900, status: "succeeded", exitCode: 0, duration: 120, hits: null, misses: null },
        "date_trunc('day', now()) - make_interval(mins => 2)",
        "pool-a",
        on,
      );

      const payload = await page(context);

      expect(payload.stats.buildsToday.total).toBe(0);
      expect(payload.stats.avgBuildTime.priorBuilds).toBe(1);
      expect(payload.stats.avgBuildTime.priorSeconds).toBe(120);
    });

    it("leaves a build eight days old out of both windows", async () => {
      const context = await workspace();
      await pools(context);
      const on = await oneRunner(context);

      await finished(
        context,
        { number: 900, status: "succeeded", exitCode: 0, duration: 120, hits: null, misses: null },
        "date_trunc('day', now()) - make_interval(days => 8)",
        "pool-a",
        on,
      );

      const payload = await page(context);

      expect(payload.stats.buildsToday.total).toBe(0);
      expect(payload.stats.avgBuildTime.priorBuilds).toBe(0);
    });
  });

  describe("an empty organization", () => {
    it("reads zeros where a count is genuinely zero", async () => {
      const payload = await page(await workspace());

      expect(payload.stats.runnersOnline).toEqual({
        online: 0,
        total: 0,
        note: null,
        offline: null,
      });
      expect(payload.stats.buildsToday.total).toBe(0);
      expect(payload.runners).toEqual([]);
      expect(payload.pools).toEqual([]);
      expect(payload.live).toBeNull();
    });

    it("reads em-dashes where there is nothing to average — never 0m 00s and never 0%", async () => {
      // The acceptance criterion, exactly.
      const payload = await page(await workspace());

      expect(payload.stats.avgBuildTime.seconds).toBeNull();
      expect(payload.stats.cacheHitRate.pct).toBeNull();
      expect(payload.stats.avgBuildTime.seconds).not.toBe(0);
      expect(payload.stats.cacheHitRate.pct).not.toBe(0);
    });

    it("leaves the prior-week delta absent rather than reading ▼ 0s", async () => {
      // A farm that built today and never before. The mean exists; the comparison does not.
      const context = await workspace();
      await pools(context);
      const on = await oneRunner(context);
      await finished(
        context,
        { number: 900, status: "succeeded", exitCode: 0, duration: 200, hits: null, misses: null },
        "date_trunc('day', now()) + (now() - date_trunc('day', now())) / 2",
        "pool-a",
        on,
      );

      const payload = await page(context);

      expect(payload.stats.avgBuildTime.seconds).toBe(200);
      expect(payload.stats.avgBuildTime.deltaVsLastWeek).toBeNull();
      expect(payload.stats.avgBuildTime.deltaVsLastWeek).not.toBe(0);
    });

    it("still labels the cache, because an empty farm still has per-runner caches", async () => {
      const payload = await page(await workspace());

      expect(payload.stats.cacheHitRate.label).toBe("ccache · per-runner");
    });
  });

  describe("draining a runner", () => {
    it("reaches a live agent, and the pill follows the agent's own heartbeat", async () => {
      // The acceptance criterion — *drain round-trips to a live fake agent and flips the
      // runner's status*. The two halves are deliberately separate: this route writes the
      // **intent**, and `status` is what the machine itself reports next.
      const context = await workspace();
      await pools(context);
      const runner = await enrol(context, "forge-09");
      const agent = await connect(runner);

      const result = bodyOf<LifecycleResult>(
        await api
          .as(context.owner)("post", `${FARM}/runners/${runner.runnerId}/drain`)
          .set(TENANT_HEADER, context.workspace.id)
          .expect(200),
      );

      expect(result.pushed).toBe(true);
      expect(result.runner.desiredState).toBe("draining");

      const frame = await agent.next("drain");

      expect(frame.payload.reason).toBe("operator");

      // No deadline: drain means *stop taking work*, and killing a build in N minutes is
      // what cancelling is for.
      expect(frame.payload.deadline_ms).toBe(0);

      const beat = fixtureFrame("valid/heartbeat.json");
      beat.payload.state = "draining";
      agent.send(beat);

      await eventually(
        () => statusOf(runner.runnerId),
        (status) => status === "draining",
      );
      expect(machine(await page(context), "forge-09").status).toBe("draining");
    });

    it("puts the runner back, and the agent hears that too", async () => {
      const context = await workspace();
      await pools(context);
      const runner = await enrol(context, "forge-09");
      const agent = await connect(runner);

      await api
        .as(context.owner)("post", `${FARM}/runners/${runner.runnerId}/drain`)
        .set(TENANT_HEADER, context.workspace.id)
        .expect(200);
      await agent.next("drain");

      const result = bodyOf<LifecycleResult>(
        await api
          .as(context.owner)("post", `${FARM}/runners/${runner.runnerId}/undrain`)
          .set(TENANT_HEADER, context.workspace.id)
          .expect(200),
      );

      expect(result.runner.desiredState).toBe("active");
      expect((await agent.next("undrain")).payload).toEqual({});
    });

    it("succeeds for a machine that is not connected, and says it was not pushed", async () => {
      // `pushed: false` is not a failure: the intent is in the database, and the runner is
      // told at its next heartbeat or hello wherever it connects.
      const context = await workspace();
      await pools(context);
      const runner = await enrol(context, "forge-09");

      const result = bodyOf<LifecycleResult>(
        await api
          .as(context.owner)("post", `${FARM}/runners/${runner.runnerId}/drain`)
          .set(TENANT_HEADER, context.workspace.id)
          .expect(200),
      );

      expect(result.pushed).toBe(false);
      expect(result.runner.desiredState).toBe("draining");
    });
  });

  describe("the removal guard", () => {
    it("is blocked for an online runner, and the error names the reason", async () => {
      // The acceptance criterion. `details.status` is what an operator acts on.
      const context = await workspace();
      await pools(context);
      const runner = await enrol(context, "forge-09");
      await connect(runner);

      await eventually(
        () => statusOf(runner.runnerId),
        (status) => status === "online",
      );

      const response = await api
        .as(context.owner)("delete", `${FARM}/runners/${runner.runnerId}`)
        .set(TENANT_HEADER, context.workspace.id)
        .expect(409);

      const refusal = bodyOf<Refusal>(response);

      expect(refusal).toMatchObject({
        code: "farm_runner_not_removable",
        details: { status: "online" },
      });
      expect(refusal.message).toMatch(/drain it/u);
      expect(machine(await page(context), "forge-09").status).toBe("online");
    });

    it("retires an offline runner, revokes its certificate, and takes it out of the fleet", async () => {
      const context = await seeded();
      const { rows } = await api.sql.query<{ id: string }>(
        `select id from ouroboros.runners
          where organization_id = $1 and name = 'forge-03'`,
        [context.workspace.id],
      );

      const removed = bodyOf<RunnerResource>(
        await api
          .as(context.owner)("delete", `${FARM}/runners/${rows[0].id}`)
          .set(TENANT_HEADER, context.workspace.id)
          .expect(200),
      );

      expect(removed).toMatchObject({ status: "removed", desiredState: "removed" });

      const payload = await page(context);

      expect(payload.runners.map((runner) => runner.name)).not.toContain("forge-03");
      expect(payload.stats.runnersOnline).toMatchObject({ online: 4, total: 4, note: null });
      expect(pool(payload, "pool-a").runners).toBe(2);
    });

    it("retires a drained runner", async () => {
      const context = await seeded();
      const { rows } = await api.sql.query<{ id: string }>(
        `select id from ouroboros.runners where organization_id = $1 and name = 'bigiron'`,
        [context.workspace.id],
      );

      await api
        .as(context.owner)("delete", `${FARM}/runners/${rows[0].id}`)
        .set(TENANT_HEADER, context.workspace.id)
        .expect(200);
    });

    it("refuses a second removal with a different answer from a first", async () => {
      const context = await seeded();
      const { rows } = await api.sql.query<{ id: string }>(
        `select id from ouroboros.runners where organization_id = $1 and name = 'forge-03'`,
        [context.workspace.id],
      );

      await api
        .as(context.owner)("delete", `${FARM}/runners/${rows[0].id}`)
        .set(TENANT_HEADER, context.workspace.id)
        .expect(200);

      const again = await api
        .as(context.owner)("delete", `${FARM}/runners/${rows[0].id}`)
        .set(TENANT_HEADER, context.workspace.id)
        .expect(409);

      expect(bodyOf<Refusal>(again).code).toBe("farm_runner_removed");
    });

    it("keeps the retired machine's builds", async () => {
      // The row survives because its builds reference it — *what has this runner built* is a
      // question the history answers from them.
      const context = await seeded();
      const { rows } = await api.sql.query<{ id: string }>(
        `select id from ouroboros.runners where organization_id = $1 and name = 'forge-01'`,
        [context.workspace.id],
      );

      await api.sql.query(
        `update ouroboros.runners set status = 'offline', telemetry = '{}'::jsonb
          where id = $1`,
        [rows[0].id],
      );
      await api
        .as(context.owner)("delete", `${FARM}/runners/${rows[0].id}`)
        .set(TENANT_HEADER, context.workspace.id)
        .expect(200);

      const { rows: jobs } = await api.sql.query<{ count: string }>(
        `select count(*) as count from ouroboros.build_jobs where runner_id = $1`,
        [rows[0].id],
      );

      expect(Number(jobs[0].count)).toBeGreaterThan(0);
    });
  });

  describe("pools", () => {
    it("stores an auto-scale preference and returns it unchanged", async () => {
      // The acceptance criterion — *persists and is returned unchanged; nothing acts on it*.
      const context = await workspace();
      const pref = { enabled: true, queue_threshold: 7, max_runners: 12 };

      const created = bodyOf<PoolResource>(
        await api
          .as(context.owner)("post", `${FARM}/pools`)
          .set(TENANT_HEADER, context.workspace.id)
          .send({ name: "pool-c", executor: "shell", autoscalePref: pref })
          .expect(201),
      );

      expect(created.autoscalePref).toEqual(pref);
      expect(pool(await page(context), "pool-c").autoscalePref).toEqual(pref);
    });

    it("changes only what a PATCH names", async () => {
      const context = await workspace();
      await pools(context);
      const before = pool(await page(context), "pool-a");

      const patched = bodyOf<PoolResource>(
        await api
          .as(context.owner)("patch", `${FARM}/pools/${before.id}`)
          .set(TENANT_HEADER, context.workspace.id)
          .send({ enabled: false })
          .expect(200),
      );

      expect(patched.enabled).toBe(false);
      expect(patched.image).toBe(before.image);
      expect(patched.envAllowlist).toEqual(before.envAllowlist);
      expect(patched.defaultCommand).toBe(before.defaultCommand);
      expect(patched.autoscalePref).toEqual(before.autoscalePref);
    });

    it("refuses a container pool with no image, in both directions", async () => {
      const context = await workspace();

      await api
        .as(context.owner)("post", `${FARM}/pools`)
        .set(TENANT_HEADER, context.workspace.id)
        .send({ name: "pool-c", executor: "container" })
        .expect(422);

      await api
        .as(context.owner)("post", `${FARM}/pools`)
        .set(TENANT_HEADER, context.workspace.id)
        .send({ name: "pool-d", executor: "shell", image: "img:1" })
        .expect(422);
    });

    it("refuses a duplicate name", async () => {
      const context = await workspace();
      await pools(context);

      const response = await api
        .as(context.owner)("post", `${FARM}/pools`)
        .set(TENANT_HEADER, context.workspace.id)
        .send({ name: "pool-a", executor: "shell" })
        .expect(409);

      expect(bodyOf<Refusal>(response).code).toBe("farm_pool_name_taken");
    });

    it("deletes an empty pool and refuses one anything points at", async () => {
      const context = await seeded();
      const busy = pool(await page(context), "pool-a");

      const refused = await api
        .as(context.owner)("delete", `${FARM}/pools/${busy.id}`)
        .set(TENANT_HEADER, context.workspace.id)
        .expect(409);

      expect(bodyOf<Refusal>(refused).code).toBe("farm_pool_in_use");
      expect(bodyOf<Refusal>(refused).details.runners).toBeGreaterThan(0);

      const empty = bodyOf<PoolResource>(
        await api
          .as(context.owner)("post", `${FARM}/pools`)
          .set(TENANT_HEADER, context.workspace.id)
          .send({ name: "pool-empty", executor: "shell" })
          .expect(201),
      );

      await api
        .as(context.owner)("delete", `${FARM}/pools/${empty.id}`)
        .set(TENANT_HEADER, context.workspace.id)
        .expect(204);
    });
  });

  describe("the enroll command", () => {
    it("returns a command that actually enrols a runner", async () => {
      // The acceptance criterion, proved the only way it can be: the token in the rendered
      // command is spent against the real registration route, and a machine appears.
      const context = await workspace();
      await pools(context);

      const rendered = bodyOf<EnrollCommandResource>(
        await api
          .as(context.owner)("get", `${FARM}/enroll-command?pool=pool-a`)
          .set(TENANT_HEADER, context.workspace.id)
          .expect(200),
      );

      const token = /--token '([^']+)'/u.exec(rendered.command)?.[1];

      expect(token).toBeDefined();

      const enrollment = bodyOf<EnrollmentResource>(
        await api
          .anonymous("post", "/api/v1/farm/registrations")
          .send({
            token,
            name: "forge-new",
            arch: "linux/x86_64",
            csr: certificationRequest(),
          })
          .expect(201),
      );

      expect(enrollment.runnerId).toBeDefined();
      expect(machine(await page(context), "forge-new").pool).toBe("pool-a");
    });

    it("names this deployment's own origin and a pinned version", async () => {
      const context = await workspace();
      await pools(context);

      const rendered = bodyOf<EnrollCommandResource>(
        await api
          .as(context.owner)("get", `${FARM}/enroll-command?pool=pool-a`)
          .set(TENANT_HEADER, context.workspace.id)
          .expect(200),
      );

      expect(rendered.origin).toBe(ORIGIN);
      expect(rendered.version).toBe(RELEASE);
      expect(rendered.command).toContain(`${ORIGIN}/install.sh?version=${RELEASE}`);
      expect(rendered.command).not.toContain("get.ouroboros.dev");
      expect(rendered.tenant).toBe(context.workspace.slug);
    });

    it("masks the token in the resource and carries it only in the command", async () => {
      const context = await workspace();
      await pools(context);

      const rendered = bodyOf<EnrollCommandResource>(
        await api
          .as(context.owner)("get", `${FARM}/enroll-command?pool=pool-a`)
          .set(TENANT_HEADER, context.workspace.id)
          .expect(200),
      );

      expect(rendered.token.masked).toMatch(/^orb_enroll_/u);
      expect(Object.keys(rendered.token)).not.toContain("token");
    });

    it("is not cached, because it carries a live credential", async () => {
      const context = await workspace();
      await pools(context);

      const response = await api
        .as(context.owner)("get", `${FARM}/enroll-command?pool=pool-a`)
        .set(TENANT_HEADER, context.workspace.id)
        .expect(200);

      expect(response.headers["cache-control"]).toBe("no-store");
    });

    it("mints nothing when the pool does not exist", async () => {
      const context = await workspace();

      await api
        .as(context.owner)("get", `${FARM}/enroll-command?pool=pool-z`)
        .set(TENANT_HEADER, context.workspace.id)
        .expect(404);

      const { rows } = await api.sql.query<{ count: string }>(
        `select count(*) as count from ouroboros.enrollment_tokens where organization_id = $1`,
        [context.workspace.id],
      );

      expect(Number(rows[0].count)).toBe(0);
    });
  });

  describe("the role gate", () => {
    it("lets a member and a viewer read the page and the pools", async () => {
      // A route with no `@Roles()` is open to every member of the workspace. Watching the
      // fleet is looking, and a viewer is a role that exists in order to be able to look.
      const context = await seeded();

      for (const role of ["member", "viewer"] as const) {
        const person = await api.signIn();
        await api.join(context.workspace.id, person, role);

        await api.as(person)("get", FARM).set(TENANT_HEADER, context.workspace.id).expect(200);
        await api
          .as(person)("get", `${FARM}/pools`)
          .set(TENANT_HEADER, context.workspace.id)
          .expect(200);
      }
    });

    it("refuses every mutation to a member, server-side", async () => {
      // The acceptance criterion — *member role is read-only; admin and above may mutate*.
      const context = await seeded();
      const member = await api.signIn();
      await api.join(context.workspace.id, member, "member");

      const { rows } = await api.sql.query<{ id: string }>(
        `select id from ouroboros.runners where organization_id = $1 and name = 'forge-03'`,
        [context.workspace.id],
      );
      const poolId = pool(await page(context), "pool-a").id;

      await api
        .as(member)("post", `${FARM}/runners/${rows[0].id}/drain`)
        .set(TENANT_HEADER, context.workspace.id)
        .expect(403);
      await api
        .as(member)("post", `${FARM}/runners/${rows[0].id}/undrain`)
        .set(TENANT_HEADER, context.workspace.id)
        .expect(403);
      await api
        .as(member)("delete", `${FARM}/runners/${rows[0].id}`)
        .set(TENANT_HEADER, context.workspace.id)
        .expect(403);
      await api
        .as(member)("post", `${FARM}/pools`)
        .set(TENANT_HEADER, context.workspace.id)
        .send({ name: "pool-c", executor: "shell" })
        .expect(403);
      await api
        .as(member)("patch", `${FARM}/pools/${poolId}`)
        .set(TENANT_HEADER, context.workspace.id)
        .send({ enabled: false })
        .expect(403);
      await api
        .as(member)("delete", `${FARM}/pools/${poolId}`)
        .set(TENANT_HEADER, context.workspace.id)
        .expect(403);
      await api
        .as(member)("get", `${FARM}/enroll-command?pool=pool-a`)
        .set(TENANT_HEADER, context.workspace.id)
        .expect(403);
    });

    it("lets an admin mutate", async () => {
      const context = await seeded();
      const admin = await api.signIn();
      await api.join(context.workspace.id, admin, "admin");

      await api
        .as(admin)("post", `${FARM}/pools`)
        .set(TENANT_HEADER, context.workspace.id)
        .send({ name: "pool-c", executor: "shell" })
        .expect(201);
    });

    it("changes nothing when it refuses", async () => {
      const context = await seeded();
      const member = await api.signIn();
      await api.join(context.workspace.id, member, "member");
      const poolId = pool(await page(context), "pool-a").id;

      await api
        .as(member)("patch", `${FARM}/pools/${poolId}`)
        .set(TENANT_HEADER, context.workspace.id)
        .send({ enabled: false })
        .expect(403);

      expect(pool(await page(context), "pool-a").enabled).toBe(true);
    });
  });

  describe("organization isolation", () => {
    it("shows one workspace nothing of another's fleet", async () => {
      const mine = await seeded();
      const theirs = await seeded();

      const payload = await page(mine);

      expect(payload.runners).toHaveLength(5);
      expect(payload.stats.buildsToday.total).toBe(23);
      expect(theirs.workspace.id).not.toBe(mine.workspace.id);
    });

    it("refuses every lifecycle route against another workspace's runner", async () => {
      const mine = await workspace();
      const theirs = await seeded();
      const { rows } = await api.sql.query<{ id: string }>(
        `select id from ouroboros.runners where organization_id = $1 and name = 'forge-03'`,
        [theirs.workspace.id],
      );

      for (const [method, path] of [
        ["post", `${FARM}/runners/${rows[0].id}/drain`],
        ["post", `${FARM}/runners/${rows[0].id}/undrain`],
        ["delete", `${FARM}/runners/${rows[0].id}`],
      ] as const) {
        const response = await api
          .as(mine.owner)(method, path)
          .set(TENANT_HEADER, mine.workspace.id)
          .expect(404);

        expect(bodyOf<Refusal>(response).code).toBe("farm_runner_not_found");
      }
    });

    it("refuses every pool route against another workspace's pool", async () => {
      const mine = await workspace();
      const theirs = await seeded();
      const poolId = pool(await page(theirs), "pool-a").id;

      await api
        .as(mine.owner)("patch", `${FARM}/pools/${poolId}`)
        .set(TENANT_HEADER, mine.workspace.id)
        .send({ enabled: false })
        .expect(404);
      await api
        .as(mine.owner)("delete", `${FARM}/pools/${poolId}`)
        .set(TENANT_HEADER, mine.workspace.id)
        .expect(404);

      expect(pool(await page(theirs), "pool-a").enabled).toBe(true);
    });

    it("mints an enroll command only for a pool of the caller's own workspace", async () => {
      const mine = await workspace();
      const theirs = await seeded();

      await api
        .as(mine.owner)("get", `${FARM}/enroll-command?pool=pool-a`)
        .set(TENANT_HEADER, mine.workspace.id)
        .expect(404);

      expect(theirs.workspace.id).not.toBe(mine.workspace.id);
    });
  });
});
