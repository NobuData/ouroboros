/**
 * The settings request as what is stored (CM.4,
 * [#623](https://github.com/NobuData/ouroboros/issues/623)).
 *
 * The request's nested maps of threshold overrides are keyed by class and by metric, which a
 * DTO cannot type; {@link patchOf} checks them here and names what is wrong. The database then
 * checks the whole shape again (V115's and V124's CHECKs), so nothing stored can be malformed
 * whichever layer is wrong about it.
 */

import { METRIC_CLASSES, type MetricClass } from "./watch.drift";
import { METRIC_KEY_PATTERN, type SaveWatchSettingsDto } from "./watch.dto";
import { settingsInvalid } from "./watch.errors";
import type { StoredMetric, WatchSettingsPatch } from "./watch.repository";
import { storedThresholds, type ThresholdResource } from "./watch.resources";
import { DEFAULT_WINDOW_DAYS } from "./watch.service";

/** The ref a bisect treats as bad when a metric names none. */
export const DEFAULT_NIGHTLY_REF = "HEAD";

const DIRECTIONS = new Set(["higher_is_worse", "lower_is_worse", "either"]);
const RULE_FIELDS = new Set(["direction", "warnPct", "errPct", "minSpreadMultiple", "minSamples"]);

/**
 * Check one threshold override.
 *
 * @param where - What it overrides, for the refusal.
 * @param rule - The override as sent.
 * @returns It, typed.
 * @throws {InvalidRequestError} `regression_watch_settings_invalid` naming the field.
 */
function checkedRule(where: string, rule: unknown): ThresholdResource {
  if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
    throw settingsInvalid(`The threshold for ${where} must be an object.`, { threshold: where });
  }

  const sent = rule as Record<string, unknown>;
  const unknown = Object.keys(sent).find((field) => !RULE_FIELDS.has(field));
  const positive = (field: string, min: number): boolean =>
    sent[field] === undefined || (typeof sent[field] === "number" && sent[field] >= min);

  if (unknown !== undefined) {
    throw settingsInvalid(`The threshold for ${where} has an unknown field.`, {
      threshold: where,
      field: unknown,
    });
  }
  if (sent.direction !== undefined && !DIRECTIONS.has(sent.direction as string)) {
    throw settingsInvalid(`The threshold for ${where} has an unknown direction.`, {
      threshold: where,
      field: "direction",
    });
  }
  if ((sent.warnPct === undefined) !== (sent.errPct === undefined)) {
    throw settingsInvalid(`The threshold for ${where} needs warnPct and errPct together.`, {
      threshold: where,
      field: "warnPct",
    });
  }
  if (
    !positive("warnPct", Number.MIN_VALUE) ||
    !positive("errPct", Number.MIN_VALUE) ||
    (typeof sent.warnPct === "number" && (sent.errPct as number) < sent.warnPct)
  ) {
    throw settingsInvalid(`The threshold for ${where} needs 0 < warnPct ≤ errPct.`, {
      threshold: where,
      field: "errPct",
    });
  }
  if (!positive("minSpreadMultiple", 0)) {
    throw settingsInvalid(`The threshold for ${where} needs minSpreadMultiple ≥ 0.`, {
      threshold: where,
      field: "minSpreadMultiple",
    });
  }
  if (
    !positive("minSamples", 1) ||
    (sent.minSamples !== undefined && !Number.isInteger(sent.minSamples))
  ) {
    throw settingsInvalid(`The threshold for ${where} needs a whole minSamples ≥ 1.`, {
      threshold: where,
      field: "minSamples",
    });
  }

  return sent;
}

/**
 * Check a map of overrides.
 *
 * @param map - The map as sent.
 * @param accepts - Whether a key may be overridden.
 * @param kind - `class` or `metric`, for the refusal.
 * @returns The checked map.
 */
function checkedMap<K extends string>(
  map: Record<string, unknown> | undefined,
  accepts: (key: string) => boolean,
  kind: string,
): Record<K, ThresholdResource> {
  const checked: Record<string, ThresholdResource> = {};

  for (const [key, rule] of Object.entries(map ?? {})) {
    if (!accepts(key)) {
      throw settingsInvalid(`"${key}" is not a ${kind} a threshold can be set for.`, {
        [kind]: key,
      });
    }
    checked[key] = checkedRule(`${kind} ${key}`, rule);
  }
  return checked;
}

/**
 * A settings request as the patch the repository stores.
 *
 * @param body - The request.
 * @returns The patch: only the fields the request carried.
 * @throws {InvalidRequestError} `regression_watch_settings_invalid` for a metric listed twice
 *   or a malformed threshold.
 */
export function patchOf(body: SaveWatchSettingsDto): WatchSettingsPatch {
  let metrics: StoredMetric[] | undefined;

  if (body.metrics !== undefined) {
    metrics = body.metrics.map((metric) => ({
      repo: metric.repository,
      source: metric.source,
      key: metric.key,
      class: metric.class,
      window_days: metric.windowDays ?? DEFAULT_WINDOW_DAYS,
      replay:
        metric.replay == null
          ? null
          : { pool: metric.replay.pool, command: metric.replay.command ?? null },
      nightly_ref: metric.nightlyRef ?? DEFAULT_NIGHTLY_REF,
    }));

    const seen = new Set<string>();
    for (const metric of metrics) {
      const identity = `${metric.repo.toLowerCase()} ${metric.key}`;
      if (seen.has(identity)) {
        throw settingsInvalid("A metric is listed twice for one repository.", {
          repository: metric.repo,
          key: metric.key,
        });
      }
      seen.add(identity);
      if ((metric.source === "case_metric") !== metric.key.includes(":")) {
        throw settingsInvalid("A metric's key does not match its source.", {
          key: metric.key,
          source: metric.source,
        });
      }
    }
  }

  return {
    ...(metrics === undefined ? {} : { metrics }),
    ...(body.thresholds === undefined
      ? {}
      : {
          thresholds: storedThresholds(
            checkedMap<MetricClass>(
              body.thresholds.classes,
              (key) => (METRIC_CLASSES as readonly string[]).includes(key),
              "class",
            ),
            checkedMap<string>(
              body.thresholds.metrics,
              (key) => METRIC_KEY_PATTERN.test(key),
              "metric",
            ),
          ),
        }),
    ...(body.autoBisect === undefined ? {} : { autoBisect: body.autoBisect }),
    ...(body.autoFile === undefined ? {} : { autoFile: body.autoFile }),
    ...(body.fixSourceId === undefined ? {} : { fixSourceId: body.fixSourceId }),
  };
}
