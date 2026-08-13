/**
 * Row → resource, for the preferences surface — the same seam `tenancy/resources.ts` keeps,
 * at the size this module needs.
 *
 * The row is the database's (snake_case, trigger-stamped timestamps); the resource is the
 * contract's (camelCase, exactly what `openapi.yaml`'s `Preferences` schema promises). The
 * mapper is where the two meet, and it is also where **absence becomes an answer**: a
 * person with no row is at every default, so the resource for `undefined` is the default
 * resource rather than a 404 — a preference always has a value, even for somebody who has
 * never expressed one.
 */

import { DEFAULT_FONT_SCALE, type FontScale, type UserPreferences } from "../db/schema";

/** What `GET /api/v1/me/preferences` answers — the contract's `Preferences` schema. */
export interface PreferencesResource {
  /** The reader's font-size step, `'100'` when they have never chosen. */
  readonly fontScale: FontScale;
}

/**
 * One person's preferences, as the contract promises them.
 *
 * @param row - Their row, or `undefined` when they have never stored a choice.
 * @returns The resource — the row's values where one exists, the defaults where none does.
 */
export function preferencesResource(row: UserPreferences | undefined): PreferencesResource {
  return {
    fontScale: row?.font_scale ?? DEFAULT_FONT_SCALE,
  };
}
