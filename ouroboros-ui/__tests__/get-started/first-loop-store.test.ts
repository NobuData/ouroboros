import { describe, expect, it } from "vitest";

import {
  durationKey,
  readReviewedAt,
  recordDuration,
  recordReviewed,
  reviewedKey,
  type FirstLoopStorage,
} from "@/app/get-started/first-loop-store";

import { FIRST_RUN_ID, after } from "../helpers/first-loop";

/** What the first loop keeps in this browser only (BD.1, #396). */

/** A storage in memory. */
function memory(): FirstLoopStorage & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();

  return { items, getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value) };
}

/** A storage that refuses every call. */
const BROKEN: FirstLoopStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("the review acknowledgement", () => {
  it("is nothing until recorded, then the instant, per run", () => {
    const storage = memory();

    expect(readReviewedAt(FIRST_RUN_ID, storage)).toBeNull();
    recordReviewed(FIRST_RUN_ID, after(600), storage);
    expect(readReviewedAt(FIRST_RUN_ID, storage)).toBe(after(600));
    expect(storage.items.get(reviewedKey(FIRST_RUN_ID))).toBe(after(600));
    expect(readReviewedAt("another-run", storage)).toBeNull();
  });

  it("reads a garbled value, or storage that throws, as nothing", () => {
    const storage = memory();
    storage.items.set(reviewedKey(FIRST_RUN_ID), "yesterday-ish");

    expect(readReviewedAt(FIRST_RUN_ID, storage)).toBeNull();
    expect(readReviewedAt(FIRST_RUN_ID, BROKEN)).toBeNull();
    expect(() => recordReviewed(FIRST_RUN_ID, after(1), BROKEN)).not.toThrow();
    expect(readReviewedAt(FIRST_RUN_ID, null)).toBeNull();
  });
});

describe("the duration", () => {
  it("keeps start-to-PR seconds once, and never overwrites it", () => {
    const storage = memory();

    expect(recordDuration(FIRST_RUN_ID, after(0), after(191), storage)).toBe(191);
    expect(recordDuration(FIRST_RUN_ID, after(0), after(500), storage)).toBeNull();
    expect(storage.items.get(durationKey(FIRST_RUN_ID))).toBe("191");
  });

  it("writes nothing without storage, and survives storage that throws", () => {
    expect(recordDuration(FIRST_RUN_ID, after(0), after(191), null)).toBeNull();
    expect(recordDuration(FIRST_RUN_ID, after(0), after(191), BROKEN)).toBeNull();
  });
});
