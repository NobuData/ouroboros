/**
 * Row → resource for mockup 08's read surfaces: the stat row, the runners table, the pools
 * card and the live-build reference.
 *
 * AH.6 ([#254](https://github.com/NobuData/ouroboros/issues/254)). The rows are the database's
 * (snake_case, `Date`s, bigints as strings, `jsonb` as `unknown`); the resources are the
 * contract's (camelCase, ISO 8601, numbers that fit) — `farm.resources.ts`' conventions, and
 * `dispatch/jobs.resources.ts` follows them for the job payload this one links to.
 *
 * ---------------------------------------------------------------------------
 * **`null` here is the mockup's em-dash, everywhere it appears.**
 *
 * The offline row in mockup 08 prints `—` for CPU, RAM and uptime, and it prints them because
 * there is nothing to print: V040 clears `telemetry` and `uptime_seconds` when the presence
 * sweep flips a runner offline, precisely so that a two-hour-old snapshot cannot render as a
 * fresh one. This file does not substitute zeros for any of them. A `0%` CPU meter on a
 * machine nobody has heard from is the single most misleading thing this payload could say.
 *
 * ---------------------------------------------------------------------------
 * **Two fields are deliberately passed through rather than mapped.**
 *
 * `capabilities` and `autoscalePref` are returned as the database holds them. For
 * `autoscale_pref` that is the acceptance criterion — *persists and is returned unchanged* —
 * and it is also the honest option: decision **B9** makes the preference **inert** until AJ.1
 * ([#263](https://github.com/NobuData/ouroboros/issues/263)), nothing in this service reads
 * inside it, and a mapper that renamed its keys would be this service having an opinion about
 * a document it does not act on. V040's `farm_autoscale_pref_valid` is what keeps the shape
 * closed in the meantime.
 */

import type { BuildJob, Runner, RunnerCertificate, RunnerPool } from "../../db/schema";
import { renewAfter } from "../farm.resources";

/** *Runners online* — mockup 08's `4/5` and the line under it. */
export interface RunnersOnlineStat {
  /** Connected: `online`, `building` or `draining`. */
  readonly online: number;
  /** The fleet, excluding retired machines. `0` for a workspace that has enrolled nothing. */
  readonly total: number;
  /** `forge-03 offline · 2h`, or `null` when nothing is offline. */
  readonly note: string | null;
  /**
   * The runner {@link RunnersOnlineStat.note} names, as data.
   *
   * Carried beside the rendered note so a page that stays open does not go stale: the note is
   * correct at the instant it was computed, and a client holding `lastSeenAt` can re-render
   * *2h* as *3h* an hour later without asking again. `null` when nothing is offline, and
   * `lastSeenAt` is `null` for a machine that enrolled and never connected.
   */
  readonly offline: { readonly name: string; readonly lastSeenAt: string | null } | null;
}

/** *Builds today* — the count and its partition. */
export interface BuildsTodayStat {
  /** The four below, summed. */
  readonly total: number;
  /** `succeeded` — the mockup's *19 clean*. */
  readonly clean: number;
  /** `retried` — an attempt replaced after an infrastructure failure. */
  readonly retried: number;
  /** `failed` — it ran and exited non-zero. */
  readonly failed: number;
  /** `canceled` — somebody stopped it. Zero on the seeded day; see `fleet.stats.ts`. */
  readonly canceled: number;
  /** Where the day starts, ISO 8601 — so *today* is a stated window rather than a word. */
  readonly since: string;
  /** The zone that boundary was taken in. `UTC`. */
  readonly timeZone: string;
}

/** *Avg build time* — the mean, and the week it is compared against. */
export interface AvgBuildTimeStat {
  /** The mean, in seconds — `252` is the mockup's `4m 12s`. **`null` over no builds.** */
  readonly seconds: number | null;
  /** How many builds it is the mean of. */
  readonly builds: number;
  /** The same mean over the prior seven whole days, or `null` if it holds no builds. */
  readonly priorSeconds: number | null;
  /** How many builds that was. `0` is what makes the delta absent. */
  readonly priorBuilds: number;
  /**
   * Today's mean less the prior week's, in seconds — `-38` is the mockup's `▼ 38s`.
   *
   * **`null`, not `0`, when either window is empty.** A farm switched on this morning has
   * nothing to compare against, and `▼ 0s` would claim a comparison that was never made.
   */
  readonly deltaVsLastWeek: number | null;
}

/** *Cache hit rate* — the weighted rate, and the label that says what it is a rate of. */
export interface CacheHitRateStat {
  /** Σ hits ÷ Σ objects, as a percentage. **`null` when no build today reported a cache.** */
  readonly pct: number | null;
  /** Σ hits, for a client that would rather show `412/525` than a percentage. */
  readonly hits: number;
  /** Σ (hits + misses). */
  readonly objects: number;
  /**
   * `ccache · per-runner` — composed from decision **B5**, never written out.
   *
   * The mockup reads *shared per pool*; that becomes true with AJ.2
   * ([#264](https://github.com/NobuData/ouroboros/issues/264)) and not before. `fleet.policy.ts`
   * is where the one line that changes lives.
   */
  readonly label: string;
}

/** The whole stat row. */
export interface FarmStatsResource {
  readonly runnersOnline: RunnersOnlineStat;
  readonly buildsToday: BuildsTodayStat;
  readonly avgBuildTime: AvgBuildTimeStat;
  readonly cacheHitRate: CacheHitRateStat;
}

/** A runner's live snapshot — the CPU meter, the RAM column and the queue chip (decision B7). */
export interface RunnerTelemetry {
  /** 0–100. */
  readonly cpuPct: number | null;
  readonly ramUsedBytes: number | null;
  readonly ramTotalBytes: number | null;
  /** What the agent last said it was holding. The control plane's own count is on the runner. */
  readonly queueDepth: number | null;
  /** When the agent sampled it, ISO 8601. */
  readonly sampledAt: string | null;
}

/** The build a runner is working on, as the *Current job* cell prints it. */
export interface RunnerJobRef {
  readonly id: string;
  /** The job's public name — mockup 08's `#479`. */
  readonly number: number;
  /** The short label beside the number — *zephyr build*, *HIL test rig*. */
  readonly label: string;
  readonly title: string;
  /** When it started, ISO 8601 — what the live card's elapsed timer counts from. */
  readonly startedAt: string | null;
  /**
   * The loop run the build belongs to — `build_jobs.run_id` — or `null` for a build no loop
   * opened (decision B6). What the *Current job* cell links to the run console by
   * ([#309](https://github.com/NobuData/ouroboros/issues/309)).
   */
  readonly runId: string | null;
}

/**
 * The certificate a runner is presenting, as AI.5's details sheet prints it
 * ([#260](https://github.com/NobuData/ouroboros/issues/260)).
 *
 * Three facts and no more. **None of them is a secret**: a serial is public by construction —
 * it is in every handshake the machine makes and in the `runner.enrolled` audit event
 * (`farm.audit.ts`) — and there is no key, fingerprint or PEM here to mistake for one. The
 * operator-facing `RunnerCertificate` that a revocation answers carries the rest.
 */
export interface RunnerCertificateRef {
  /** Lower-case hex, as V041 stores it. */
  readonly serial: string;
  /** When it stops being accepted, ISO 8601. **May be in the past** — live is not valid. */
  readonly notAfter: string;
  /**
   * When the agent starts renewing, ISO 8601 — `notAfter` less `RENEWAL_LEAD_MS`, derived by
   * the rule the agent itself was handed at enrollment rather than stored.
   */
  readonly renewAfter: string;
}

/** One machine in the fleet, as the runners table draws it. */
export interface RunnerResource {
  readonly id: string;
  readonly name: string;
  /** `linux/arm64`, `linux/x86_64`, `darwin/arm64` — the mockup's line under the name. */
  readonly arch: string;
  readonly poolId: string;
  /** The pool's name — the mockup's tag. */
  readonly pool: string;
  /** What the fleet last **observed**: the pill. */
  readonly status: string;
  /** What an operator **intended**. The two are separate columns; V040 argues why. */
  readonly desiredState: string;
  /**
   * `mtls` or `bearer_fallback` — decision **B3**.
   *
   * Returned so AI.2 ([#257](https://github.com/NobuData/ouroboros/issues/257)) can render a
   * connection that fell back to a bearer token as **visibly degraded**. A green shield over
   * the weaker mode is what this field exists to prevent, so it is never omitted.
   */
  readonly securityMode: string;
  /** The agent build that last connected, or `null` until one has. */
  readonly agentVersion: string | null;
  /** What the machine called itself. Recognition, never identity. */
  readonly hostname: string | null;
  /** When the last heartbeat arrived, or `null` for a machine that has never connected. */
  readonly lastSeenAt: string | null;
  readonly enrolledAt: string;
  /** Uptime as the agent last reported it. **`null` with no live report** — the mockup's `—`. */
  readonly uptimeSeconds: number | null;
  /** The live snapshot, or **`null`** for a runner the fleet cannot vouch for. */
  readonly telemetry: RunnerTelemetry | null;
  /**
   * What is waiting on this machine — the mockup's `q:2`.
   *
   * The **control plane's** count of jobs assigned to it and not yet started, not the agent's
   * `telemetry.queueDepth`. The two agree when the runner is connected; when it is not, this
   * is still true and the telemetry is gone.
   */
  readonly queueDepth: number;
  /** The build it is running, or `null`. */
  readonly currentJob: RunnerJobRef | null;
  /** What it reported it can do, as it reported it. */
  readonly capabilities: unknown;
  /**
   * The certificate it is presenting, or **`null`** when it has none: a machine on the bearer
   * fallback (decision B3), or one whose certificate was revoked — which a removal does.
   */
  readonly certificate: RunnerCertificateRef | null;
}

/** One pool, as the pools card draws it. */
export interface PoolResource {
  readonly id: string;
  readonly name: string;
  /** The first part of the meta line — *firmware builds*, *HIL & macOS jobs*. */
  readonly description: string | null;
  /** `container` or `shell` — decision **B4**. */
  readonly executor: string;
  /** The pinned image, for a container pool and only for one. */
  readonly image: string | null;
  /** The card's right-hand switch: operator intent, not a health signal. */
  readonly enabled: boolean;
  /** How many jobs one runner of this pool may run at once. Per runner, not per pool. */
  readonly maxConcurrency: number;
  /** Environment variable names a submission may carry into the build. */
  readonly envAllowlist: unknown;
  /** Queryable pool tags. */
  readonly tags: unknown;
  /** The command a submission that names none falls back to. */
  readonly defaultCommand: string | null;
  /**
   * The mockup's *"Auto-scale to cloud when queue > 5"*.
   *
   * **Stored, inert, and returned exactly as stored** (decision **B9**). AI.4
   * ([#259](https://github.com/NobuData/ouroboros/issues/259)) labels it as arriving with
   * cloud runners rather than hiding it, which is why the intent is persisted and nothing
   * reads it.
   */
  readonly autoscalePref: unknown;
  /** How many runners are in it, **excluding retired machines** — the meta line's *3 runners*. */
  readonly runners: number;
}

/** The build the LIVE card is showing. */
export interface LiveBuildResource {
  readonly id: string;
  /** Mockup 08's `#479`. */
  readonly number: number;
  readonly label: string;
  readonly title: string;
  /** The runner holding it, by name — the card's *forge-01*. */
  readonly runner: string | null;
  readonly runnerId: string | null;
  /** When it started, ISO 8601. The card's `3m 41s` counts from here. */
  readonly startedAt: string | null;
}

/** Everything mockup 08 reads, in one payload. */
export interface FarmResource {
  readonly stats: FarmStatsResource;
  /** The fleet, by name — the order the table renders. Retired machines are absent. */
  readonly runners: readonly RunnerResource[];
  /** The pools, by name. */
  readonly pools: readonly PoolResource[];
  /** The build the LIVE card shows, or `null` when nothing is running. */
  readonly live: LiveBuildResource | null;
}

/** A runner row with the two things the table prints that are not on it. */
export interface RunnerView {
  /** The row. */
  readonly runner: Runner;
  /** Its pool's name. */
  readonly poolName: string;
  /** What is assigned to it and not yet started. */
  readonly queueDepth: number;
  /** What it is running, if anything. */
  readonly currentJob: BuildJob | undefined;
  /** Its live certificate, if it holds one. */
  readonly certificate: RunnerCertificate | undefined;
}

/** A pool row with its runner count. */
export interface PoolView {
  readonly pool: RunnerPool;
  /** Runners in it, excluding retired machines. */
  readonly runners: number;
}

/**
 * A runner, as the table draws it.
 *
 * @param view - The row, its pool's name, its queue depth, its current build and its live
 *   certificate.
 * @returns The resource.
 */
export function runnerResource(view: RunnerView): RunnerResource {
  const { runner } = view;

  return {
    id: runner.id,
    name: runner.name,
    arch: runner.arch,
    poolId: runner.pool_id,
    pool: view.poolName,
    status: runner.status,
    desiredState: runner.desired_state,
    securityMode: runner.security_mode,
    agentVersion: runner.agent_version,
    hostname: runner.hostname,
    lastSeenAt: runner.last_seen_at?.toISOString() ?? null,
    enrolledAt: runner.enrolled_at.toISOString(),
    // A bigint, which `pg` hands over as text so a 64-bit value cannot be silently rounded.
    // Uptime in seconds is nowhere near that, so it is safe to narrow here — and null stays
    // null, because a machine with no live report has no uptime rather than an uptime of 0.
    uptimeSeconds: runner.uptime_seconds === null ? null : Number(runner.uptime_seconds),
    telemetry: runnerTelemetry(runner.telemetry),
    queueDepth: view.queueDepth,
    currentJob: view.currentJob ? runnerJobRef(view.currentJob) : null,
    capabilities: runner.capabilities,
    certificate: view.certificate ? runnerCertificateRef(view.certificate) : null,
  };
}

/**
 * A live certificate, as the details sheet prints it.
 *
 * @param certificate - The row.
 * @returns The serial, the expiry and the instant renewal starts.
 */
function runnerCertificateRef(certificate: RunnerCertificate): RunnerCertificateRef {
  return {
    serial: certificate.serial,
    notAfter: certificate.not_after.toISOString(),
    renewAfter: renewAfter(certificate.not_after),
  };
}

/**
 * The live snapshot, or nothing.
 *
 * @param telemetry - `runners.telemetry` — `{}` for a runner the fleet cannot vouch for,
 *   which the presence sweep writes when it flips one offline.
 * @returns The snapshot, or `null` for that empty document. **Empty becomes `null` rather
 *   than a record of nulls**: the mockup's offline row prints one `—` per cell because there
 *   is no snapshot at all, and a client should be able to ask *is there one* once.
 */
function runnerTelemetry(telemetry: unknown): RunnerTelemetry | null {
  if (typeof telemetry !== "object" || telemetry === null) return null;

  const snapshot = telemetry as Record<string, unknown>;
  if (Object.keys(snapshot).length === 0) return null;

  return {
    cpuPct: numberOr(snapshot.cpu_pct),
    ramUsedBytes: numberOr(snapshot.ram_used_bytes),
    ramTotalBytes: numberOr(snapshot.ram_total_bytes),
    queueDepth: numberOr(snapshot.queue_depth),
    sampledAt: typeof snapshot.sampled_at === "string" ? snapshot.sampled_at : null,
  };
}

/**
 * One field of a telemetry snapshot, if the agent sent it.
 *
 * @param value - The `jsonb` value. V040's `farm_telemetry_valid` has already refused anything
 *   that is not a number in range, so this narrows rather than validates — and a key the agent
 *   simply did not send is absent, which is `null` here and an em-dash on the page.
 * @returns The number, or `null`.
 */
function numberOr(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/**
 * The build a runner is on, as its row's *Current job* cell prints it.
 *
 * @param job - The build.
 * @returns The reference.
 */
function runnerJobRef(job: BuildJob): RunnerJobRef {
  return {
    id: job.id,
    number: job.number,
    label: job.label,
    title: job.title,
    startedAt: job.started_at?.toISOString() ?? null,
    runId: job.run_id,
  };
}

/**
 * A pool, as the card draws it.
 *
 * @param view - The row and its runner count.
 * @returns The resource.
 */
export function poolResource(view: PoolView): PoolResource {
  const { pool } = view;

  return {
    id: pool.id,
    name: pool.name,
    description: pool.description,
    executor: pool.executor,
    image: pool.image,
    enabled: pool.enabled,
    maxConcurrency: pool.max_concurrency,
    envAllowlist: pool.env_allowlist,
    tags: pool.tags,
    defaultCommand: pool.default_command,
    autoscalePref: pool.autoscale_pref,
    runners: view.runners,
  };
}

/**
 * The build the LIVE card shows.
 *
 * @param job - The build.
 * @param runner - The runner holding it, by name.
 * @returns The reference.
 */
export function liveBuildResource(job: BuildJob, runner: string | null): LiveBuildResource {
  return {
    id: job.id,
    number: job.number,
    label: job.label,
    title: job.title,
    runner,
    runnerId: job.runner_id,
    startedAt: job.started_at?.toISOString() ?? null,
  };
}
