/**
 * Retention tiers — the classes, their defaults and their bounds, written down once
 * (BQ.3, [#482](https://github.com/NobuData/ouroboros/issues/482)).
 *
 * ```
 * class         default   floor   ceiling   read by
 * transcripts   30 d      7 d     365 d     the transcript sweep (runs/transcript.retention.ts, #299)
 * build_logs    30 d      7 d     365 d     the build-log sweep (farm/logs/log.retention.ts, #253)
 * artifacts     30 d¹     7 d     365 d     the artifact sweep (test-results-read/artifact.retention.ts, #333)
 * audit         400 d     90 d    3650 d    the audit purge (BR.2, #486)
 * custom:<slug> 30 d      7 d     3650 d    whichever plane adds the class
 * ```
 *
 * ¹ `OURO_ARTIFACT_RETENTION_DAYS` when the deployment set it — the value the artifact sweep kept
 * before this service existed, so a deployment that had raised it does not lose data on upgrade.
 *
 * **The defaults reproduce what the sweeps did before** (thirty days for loop data, the audit
 * card's `retained 400d`), so a workspace with no stored tier is swept exactly as it was.
 *
 * **The bounds are a compliance rule, not a preference.** The floor stops a setting from
 * destroying what a quarterly review (audit) or a long weekend's investigation (loop data) needs;
 * the ceiling stops a mistyped value from configuring unbounded growth. V094/V101 enforce the
 * same numbers as CHECKs, so a write that skipped this file would still be refused.
 *
 * **The cutoff is computed here and nowhere else**: `now − days`. A sweep receives a cutoff and
 * never derives one, which is what keeps one class's change from moving another class's sweep.
 */

/** The three classes the workspace card's one select governs — "transcripts, logs, artifacts". */
export const LOOP_DATA_CLASSES = ["transcripts", "build_logs", "artifacts"] as const;

/** The classes every workspace has a tier for, stored or default. */
export const CORE_DATA_CLASSES = [...LOOP_DATA_CLASSES, "audit"] as const;

/** One of {@link LOOP_DATA_CLASSES}. */
export type LoopDataClass = (typeof LOOP_DATA_CLASSES)[number];

/** One of {@link CORE_DATA_CLASSES}. */
export type CoreDataClass = (typeof CORE_DATA_CLASSES)[number];

/** A class a later plane adds without a schema change — `custom:<slug>`. */
export type CustomDataClass = `custom:${string}`;

/** Any data class a tier can be stored for. */
export type DataClass = CoreDataClass | CustomDataClass;

/** `custom:<slug>` — the grammar V094's `retention_policies_data_class_known` CHECK accepts. */
export const CUSTOM_CLASS_PATTERN = /^custom:[a-z0-9][a-z0-9_-]{0,62}$/;

/** Days a class is kept when its workspace stored no tier — what the sweeps did before #482. */
export const RETENTION_DEFAULT_DAYS: Readonly<Record<CoreDataClass, number>> = {
  transcripts: 30,
  build_logs: 30,
  artifacts: 30,
  audit: 400,
};

/** Days a `custom:*` class is kept when its workspace stored no tier: loop data's default. */
export const CUSTOM_DEFAULT_DAYS = 30;

/** The least and most days a tier may hold. */
export interface RetentionBounds {
  /** The fewest days — 90 for audit, 7 for everything else. */
  readonly floor: number;
  /** The most days — 365 for loop data, 3650 for audit and custom classes. */
  readonly ceiling: number;
}

/** Loop data: a week at least, a year at most. */
const LOOP_BOUNDS: RetentionBounds = { floor: 7, ceiling: 365 };

/** Audit: a quarter's review at least, ten years at most. */
const AUDIT_BOUNDS: RetentionBounds = { floor: 90, ceiling: 3650 };

/** A custom class: loop data's floor, audit's ceiling — the plane decides within it. */
const CUSTOM_BOUNDS: RetentionBounds = { floor: 7, ceiling: 3650 };

/** One day, in milliseconds. */
const DAY_MS = 86_400_000;

/** Why a tier was refused — the code the card branches on to render its message. */
export type RetentionRefusalReason = "below_floor" | "above_ceiling" | "not_whole_days";

/** A refused tier, with everything the card needs to say why. */
export interface RetentionRefusal {
  /** The class the value was for. */
  readonly dataClass: DataClass;
  /** The value that was refused. */
  readonly days: number;
  /** Why. */
  readonly reason: RetentionRefusalReason;
  /** The class's bounds, so the message can name them. */
  readonly floor: number;
  readonly ceiling: number;
  /** A complete sentence for a human. */
  readonly message: string;
}

/**
 * Whether a value names a data class a tier can be stored for.
 *
 * @param value - Anything — a request body key, typically.
 * @returns `true` for the four core classes and a well-formed `custom:<slug>`.
 */
export function isDataClass(value: unknown): value is DataClass {
  return (
    typeof value === "string" &&
    ((CORE_DATA_CLASSES as readonly string[]).includes(value) || CUSTOM_CLASS_PATTERN.test(value))
  );
}

/**
 * Whether a class is one of the three the card's simple select governs.
 *
 * @param dataClass - The class.
 * @returns `true` for transcripts, build_logs and artifacts.
 */
export function isLoopDataClass(dataClass: DataClass): dataClass is LoopDataClass {
  return (LOOP_DATA_CLASSES as readonly string[]).includes(dataClass);
}

/**
 * The bounds a class's tier must sit within.
 *
 * @param dataClass - The class.
 * @returns Its floor and ceiling, in days.
 */
export function boundsFor(dataClass: DataClass): RetentionBounds {
  if (dataClass === "audit") return AUDIT_BOUNDS;
  return isLoopDataClass(dataClass) ? LOOP_BOUNDS : CUSTOM_BOUNDS;
}

/**
 * Check a proposed tier against its class's bounds.
 *
 * @param dataClass - The class.
 * @param days - The proposed number of days.
 * @returns The refusal, or `undefined` when the tier may be stored.
 */
export function checkTier(dataClass: DataClass, days: number): RetentionRefusal | undefined {
  const { floor, ceiling } = boundsFor(dataClass);
  const refuse = (reason: RetentionRefusalReason, message: string): RetentionRefusal => ({
    dataClass,
    days,
    reason,
    floor,
    ceiling,
    message,
  });

  if (!Number.isSafeInteger(days)) {
    return refuse("not_whole_days", `Retention for ${dataClass} must be a whole number of days.`);
  }
  if (days < floor) {
    return refuse(
      "below_floor",
      `Retention for ${dataClass} must be at least ${String(floor)} days.`,
    );
  }
  if (days > ceiling) {
    return refuse(
      "above_ceiling",
      `Retention for ${dataClass} must be at most ${String(ceiling)} days.`,
    );
  }
  return undefined;
}

/**
 * The instant before which a class's data is expired — `now − days`. The only cutoff arithmetic
 * in the service: every sweep is handed the result.
 *
 * @param now - When the sweep runs.
 * @param days - The class's tier.
 * @returns The cutoff.
 */
export function cutoffAt(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/**
 * The tier a cutoff was computed from — {@link cutoffAt}'s inverse, in whole days. What a sweep
 * reports and checks against its class's floor without doing date arithmetic of its own.
 *
 * @param now - When the sweep runs — the instant the cutoff was computed at.
 * @param cutoff - The cutoff.
 * @returns The days between them, rounded to the nearest whole day.
 */
export function tierDaysOf(now: Date, cutoff: Date): number {
  return Math.round((now.getTime() - cutoff.getTime()) / DAY_MS);
}

/**
 * When data stored now is promised until — `at + days`, for the columns that record the promise
 * at write time (`build_log_chunks.retain_until`, `test_artifacts.retained_until`).
 *
 * @param at - When it is stored.
 * @param days - The class's tier at that moment.
 * @returns The instant it may first be swept.
 */
export function retainedUntil(at: Date, days: number): Date {
  return new Date(at.getTime() + days * DAY_MS);
}
