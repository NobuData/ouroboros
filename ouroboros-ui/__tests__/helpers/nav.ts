import { Gauge } from "lucide-react";

import type { NavEntry } from "@/app/shell/nav";

/**
 * Fixture entries for the navigation registry.
 *
 * Three suites need one — the model's rules, the registry's, and the sidebar's — and each of
 * them cares about one or two fields of an entry that has seven. A builder means a case names
 * only what it is about, which is also what makes "adding a registry entry needs no shell
 * edit" a readable assertion rather than a wall of literals.
 */

/** Distinguishes fixtures within a file, so two built without arguments do not collide. */
let serial = 0;

/**
 * An entry, with everything the caller did not specify filled in plausibly.
 *
 * The default `sort` climbs past the seeded entries' (which stop at 90), so a fixture lands
 * at the end of its group unless a case says otherwise — which is what a real module
 * registering itself later would do.
 *
 * @param overrides The fields this case is about.
 * @returns A complete {@link NavEntry}.
 */
export function navEntry(overrides: Partial<NavEntry> = {}): NavEntry {
  serial += 1;
  const id = overrides.id ?? `fixture-${serial}`;

  return {
    id,
    label: `Fixture ${serial}`,
    route: `/${id}`,
    icon: Gauge,
    group: "primary",
    sort: 100 + serial,
    ...overrides,
  };
}
