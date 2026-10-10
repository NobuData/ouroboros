/**
 * The regression watch's two inbox cards (CM.4,
 * [#623](https://github.com/NobuData/ouroboros/issues/623); kinds declared by V124).
 *
 *   regression_drift_detected   filed once when a comparison opens a watch item
 *   bisect_complete             filed once when its bisect names a culprit
 *
 * **Exactly one event each.** A card's key is the watch item (`research.watch` /
 * `item:<id>:detected` and `item:<id>:bisected`), and the registry files one item per key — so
 * a comparison that reads the same drift again the next night refreshes nothing and files
 * nothing new.
 *
 * **A card closes itself when its news is old.** The chain does not wait for an answer, so
 * {@link watchMovedOnDetector} settles a detection card once the item has left `detected` and
 * `bisecting`, and a bisect card once the item has a fix drafted, is merged or was dismissed.
 */

import { sql } from "kysely";

import { SCHEMA_NAME } from "../../db/schema";
import { clipFact } from "../../decisions/decision.refs";
import type { DecisionEmission } from "../../decisions/decision.types";
import {
  settledOf,
  type AskingDecision,
  type DecisionSourceDetector,
} from "../../decisions/decision.watchers";
import { windowPhrase } from "./watch.drift";
import type { WatchItemRow, WatchStatus } from "./watch.repository";

/** The kind filed at detection. */
export const DRIFT_DETECTED_KIND = "regression_drift_detected";

/** The kind filed at bisection. */
export const BISECT_COMPLETE_KIND = "bisect_complete";

/** The plane's name in the idempotency key. */
export const WATCH_PLANE = "research.watch";

/** A card's source ref — `item:<uuid>:detected`. */
const ITEM_SOURCE_REF = /^item:([0-9a-f-]{36}):(detected|bisected)$/;

/** The statuses in which a card of each stage is still news. */
const STILL_NEWS: Readonly<Record<string, readonly WatchStatus[]>> = {
  detected: ["detected", "bisecting"],
  bisected: ["bisected", "investigation_open"],
};

/**
 * What a metric is called on a card: a case metric by its measurement, an insights metric by
 * its id — never a 64-hex case key.
 *
 * @param metricKey - `merge_rate`, or `<case key>:<measurement>`.
 * @returns The name.
 */
export function metricLabel(metricKey: string): string {
  const colon = metricKey.indexOf(":");

  return colon < 0 ? metricKey : metricKey.slice(colon + 1);
}

/**
 * The detection card of an item.
 *
 * @param item - The item, as just opened.
 * @param nextStep - What the watch does next, in a sentence.
 * @returns The emission.
 */
export function driftDetectedEmission(item: WatchItemRow, nextStep: string): DecisionEmission {
  return {
    organizationId: item.organizationId,
    kindId: DRIFT_DETECTED_KIND,
    payload: {
      metric: clipFact(metricLabel(item.baseline.metricKey), 120),
      drift: clipFact(item.driftDisplay, 40),
      release: clipFact(item.baseline.releaseTag, 128),
      repository: clipFact(item.baseline.repo, 255),
      baseline: clipFact(windowPhrase(item.baseline.window), 80),
      current: clipFact(windowPhrase(item.current), 80),
      next_step: clipFact(nextStep, 200),
    },
    refs: [],
    key: { plane: WATCH_PLANE, sourceRef: `item:${item.id}:detected` },
    severity: item.severity === "err" ? "err" : "warn",
  };
}

/**
 * The bisection card of an item.
 *
 * @param item - The item, its bisect result recorded.
 * @param nextStep - What the watch does next, in a sentence.
 * @returns The emission, or null for an item with no bisect result.
 */
export function bisectCompleteEmission(
  item: WatchItemRow,
  nextStep: string,
): DecisionEmission | null {
  if (item.bisectResult === null) return null;

  return {
    organizationId: item.organizationId,
    kindId: BISECT_COMPLETE_KIND,
    payload: {
      metric: clipFact(metricLabel(item.baseline.metricKey), 120),
      culprit: item.bisectResult.culprit_sha.slice(0, 7),
      repository: clipFact(item.baseline.repo, 255),
      release: clipFact(item.baseline.releaseTag, 128),
      steps: item.bisectResult.steps,
      next_step: clipFact(nextStep, 200),
    },
    refs: [],
    key: { plane: WATCH_PLANE, sourceRef: `item:${item.id}:bisected` },
  };
}

/**
 * The watch item a card is about.
 *
 * @param sourceRef - The card's source ref.
 * @returns The item id, or undefined for a ref this plane did not write.
 */
export function watchItemOf(sourceRef: string): string | undefined {
  return ITEM_SOURCE_REF.exec(sourceRef)?.[1];
}

/**
 * The detector: a card whose item has moved past the stage it announced is settled.
 *
 * @returns The detector.
 */
export function watchMovedOnDetector(): DecisionSourceDetector {
  return {
    name: "watch-moved-on",
    kinds: [DRIFT_DETECTED_KIND, BISECT_COMPLETE_KIND],
    async settled(items, db) {
      const parsed = items
        .map((item) => ({ item, match: ITEM_SOURCE_REF.exec(item.sourceRef) }))
        .filter(
          (entry): entry is { item: AskingDecision; match: RegExpExecArray } =>
            entry.match !== null,
        );

      if (parsed.length === 0) return [];

      const ids = [...new Set(parsed.map((entry) => entry.match[1]))];
      const { rows } = await sql<{ id: string; organization_id: string; status: WatchStatus }>`
        select w.id, w.organization_id, w.status
          from ${sql.id(SCHEMA_NAME)}.regression_watch_items w
         where w.id in (${sql.join(ids.map((id) => sql`${id}::uuid`))})
      `.execute(db);
      const status = new Map(rows.map((row) => [`${row.organization_id}:${row.id}`, row.status]));

      return parsed.flatMap(({ item, match }) => {
        const now = status.get(`${item.organizationId}:${match[1]}`);

        // An item that is gone is as settled as one that moved on.
        return now !== undefined && STILL_NEWS[match[2]].includes(now)
          ? []
          : [settledOf(item, "watch_moved_on", "web")];
      });
    },
  };
}
