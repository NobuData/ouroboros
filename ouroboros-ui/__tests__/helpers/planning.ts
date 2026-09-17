import type { PlanningEpic, PlanningRoadmap } from "@/app/api/planning";
import type { PlanningReadings } from "@/app/planning/view";

/**
 * Planning fixtures (#283): the development seed's *Helios 2.1* roadmap
 * (`ouroboros-db/migrations/R__dev_seed_ticket_planning.sql`), trimmed to what the frame reads.
 */

/**
 * One lane, seed-shaped.
 *
 * @param over Fields to replace.
 * @returns The lane.
 */
export function planningEpic(over: Partial<PlanningEpic> = {}): PlanningEpic {
  return {
    id: "5eed0280-0000-4000-8000-00000000ee01",
    name: "OTA hardening",
    tint: "accent",
    status: "active",
    startMonth: "2026-07",
    endMonth: "2026-09",
    sortOrder: 1,
    roadmapName: "Helios 2.1",
    roadmapWindow: "Q3–Q4 2026",
    chips: { issues: 12, done: 8 },
    ...over,
  };
}

/**
 * The seeded roadmap: *Helios 2.1*, *Q3–Q4 2026*, five lanes.
 *
 * @returns The roadmap.
 */
export function seededRoadmap(): PlanningRoadmap {
  const names = [
    "OTA hardening",
    "BLE provisioning v2",
    "Motor control refactor",
    "Fleet telemetry dashboard",
    "Zephyr 4.2 migration",
  ];

  return {
    name: "Helios 2.1",
    window: "Q3–Q4 2026",
    lanes: names.map((name, index) =>
      planningEpic({ id: `5eed0280-0000-4000-8000-00000000ee0${index + 1}`, name, sortOrder: index + 1 }),
    ),
  };
}

/** A workspace that has planned nothing. */
export const EMPTY_ROADMAP: PlanningRoadmap = { name: null, window: null, lanes: [] };

/**
 * What the frame's reader answers with.
 *
 * @param roadmap The roadmap read. Defaults to the seed's.
 * @returns The readings.
 */
export function planningReadings(
  roadmap: PlanningReadings["roadmap"] = { ok: true, value: seededRoadmap() },
): PlanningReadings {
  return { roadmap };
}
