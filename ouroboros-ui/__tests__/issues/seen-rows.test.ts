import { describe, expect, it, vi } from "vitest";

import { createSeenRows, sameSighting, withSightings } from "@/app/issues/seen-rows";
import { type TableRow, tableRows } from "@/app/issues/table";

import { ESTIMATING_ROW, SEEDED_ROWS, issueId } from "../helpers/issues";

/**
 * The rows the table has drawn, as a store (#118).
 *
 * What the selection bar needs from it: every row ever drawn stays known after it leaves the
 * page, a row drawn again with a changed estimate replaces the old sighting, and a listing that
 * changed nothing wakes nobody — the map's identity is the signal, so the merge is asserted by
 * identity first.
 */

const ROWS = tableRows(SEEDED_ROWS);

/** One seeded row, as the table draws it. */
function row(number: number): TableRow {
  const found = ROWS.find((candidate) => candidate.id === issueId(number));
  if (found === undefined) throw new Error(`no row for #${number}`);
  return found;
}

describe("sameSighting", () => {
  it("agrees on a row whose number, estimate, workflow and status are unchanged", () => {
    expect(sameSighting(row(485), { ...row(485), title: "Renamed on GitHub" })).toBe(true);
  });

  it("disagrees when the estimate moved, or the status, or the workflow", () => {
    expect(sameSighting(row(485), { ...row(485), estMinutes: 50 })).toBe(false);
    expect(sameSighting(row(485), { ...row(485), status: "estimating" })).toBe(false);
    expect(sameSighting(row(485), { ...row(485), workflow: "docs-loop" })).toBe(false);
  });
});

describe("withSightings", () => {
  it("adds rows it has not seen, keyed by id", () => {
    const seen = withSightings(new Map(), ROWS);

    expect(seen.size).toBe(SEEDED_ROWS.length);
    expect(seen.get(issueId(485))).toBe(row(485));
  });

  it("hands back the very same map when the listing changed nothing", () => {
    const seen = withSightings(new Map(), ROWS);

    // The poll rebuilds the row objects every answer; identity is not what is compared.
    expect(withSightings(seen, tableRows(SEEDED_ROWS))).toBe(seen);
    expect(withSightings(seen, [])).toBe(seen);
  });

  it("replaces a row seen again with a different estimate, keeping the rest", () => {
    const seen = withSightings(new Map(), ROWS);
    const sized: TableRow = { ...row(483), estMinutes: 40, workflow: "standard-fix", status: "sized" };

    const next = withSightings(seen, [sized]);

    expect(next).not.toBe(seen);
    expect(next.get(issueId(483))).toBe(sized);
    expect(next.get(issueId(485))).toBe(row(485));
    expect(next.size).toBe(seen.size);
  });

  it("keeps a row that left the page — the selection may still hold it", () => {
    const seen = withSightings(new Map(), ROWS);

    const next = withSightings(seen, [row(485)]);

    expect(next.get(ESTIMATING_ROW.id)).toBeDefined();
  });
});

describe("createSeenRows", () => {
  it("starts empty, and publishes what it is given", () => {
    const store = createSeenRows();

    expect(store.snapshot().size).toBe(0);

    store.publish(ROWS);

    expect(store.snapshot().size).toBe(SEEDED_ROWS.length);
  });

  it("tells a subscriber when the map changed, and not when it did not", () => {
    const store = createSeenRows();
    const listener = vi.fn();
    store.subscribe(listener);

    store.publish(ROWS);
    expect(listener).toHaveBeenCalledOnce();

    store.publish(tableRows(SEEDED_ROWS));
    expect(listener).toHaveBeenCalledOnce();

    store.publish([{ ...row(485), estMinutes: 50 }]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("hands the same snapshot back until something changes, so a subscriber compares by identity", () => {
    const store = createSeenRows();
    store.publish(ROWS);

    const before = store.snapshot();
    store.publish(ROWS);

    expect(store.snapshot()).toBe(before);
  });

  it("stops telling a subscriber that unsubscribed", () => {
    const store = createSeenRows();
    const listener = vi.fn();
    const stop = store.subscribe(listener);

    stop();
    store.publish(ROWS);

    expect(listener).not.toHaveBeenCalled();
  });
});
