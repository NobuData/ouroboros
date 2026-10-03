/**
 * What the farm configuration routes answer (BV.5, [#514](https://github.com/NobuData/ouroboros/issues/514)) —
 * a pool window and a job hook, in the API's `camelCase`.
 */

import { parseCommand } from "../dispatch/command";
import type { JobHookRow, PoolWindowRow } from "./farm-config.repository";

/** A time-windowed pool assignment. */
export interface PoolWindowResource {
  id: string;
  runner: { id: string; name: string };
  pool: { id: string; name: string };
  /** ISO weekdays, 1 = Monday. */
  daysOfWeek: number[];
  /** `HH:MM`, UTC. */
  startsAt: string;
  /** `HH:MM`, UTC. */
  endsAt: string;
  enabled: boolean;
  createdBy: string | null;
  createdAt: string;
}

/** A job hook. */
export interface JobHookResource {
  id: string;
  /** `owner/name`. */
  repo: string;
  pool: { id: string; name: string };
  event: "merge";
  titleContains: string | null;
  label: string;
  title: string;
  /** argv; empty when the stored text is not one this service rendered. */
  command: string[];
  enabled: boolean;
  createdBy: string | null;
  createdAt: string;
}

/**
 * @param row - A stored window.
 * @returns The resource.
 */
export function poolWindowResource(row: PoolWindowRow): PoolWindowResource {
  return {
    id: row.id,
    runner: { id: row.runner_id, name: row.runner },
    pool: { id: row.pool_id, name: row.pool },
    daysOfWeek: [...row.days_of_week],
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    enabled: row.enabled,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * @param row - A stored hook.
 * @returns The resource.
 */
export function jobHookResource(row: JobHookRow): JobHookResource {
  return {
    id: row.id,
    repo: row.repository,
    pool: { id: row.pool_id, name: row.pool },
    event: row.event,
    titleContains: row.title_contains,
    label: row.label,
    title: row.title,
    command: parseCommand(row.command) ?? [],
    enabled: row.enabled,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  };
}
