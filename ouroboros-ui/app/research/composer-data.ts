import "server-only";

/**
 * The composer's first paint (CN.2, [#628](https://github.com/NobuData/ouroboros/issues/628)):
 * the two catalogs it is drawn from and the setting that says who may start, read once on the
 * server so the card arrives whole — a segmented control that fills in a second later would read
 * as a page that did not know its own kinds.
 *
 * Each read may fail alone (`app/api/reading.ts`): a card whose kinds could not be read says so
 * and offers a reload; a setting that could not be read leaves the gate to the service, whose
 * `403` the card renders as the refusal it is.
 */

import { type Reading, attempt } from "@/app/api/reading";
import { research } from "@/app/api/research";

import type { ComposerReadings } from "./composer";

/**
 * Read what the composer is drawn from.
 *
 * @returns The three readings.
 */
export async function readComposer(): Promise<ComposerReadings> {
  const [kinds, tools, settings] = await Promise.all([
    attempt(() => research.kinds()),
    attempt(() => research.tools()),
    attempt(() => research.settings()),
  ]);

  return { kinds, tools, settings };
}

/** A reading of each catalog that answered nothing — what a test or a story starts from. */
export function emptyComposerReadings(): ComposerReadings {
  const empty = <T>(value: T): Reading<T> => ({ ok: true, value });

  return {
    kinds: empty({ kinds: [] }),
    tools: empty({ tools: [] }),
    settings: empty({ startRole: "member" }),
  };
}
