import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hostileStorage, memoryStorage } from "./helpers/match-media";

/**
 * The font-scale engine (#649): the five steps, the mirror, the stamp, the store, and the
 * boot script — every rule `app/font-scale.ts` states, held without a DOM beyond jsdom.
 *
 * A fresh module instance per case, for the reason `sidebar-state.test.ts` gives: the
 * module reads the mirror lazily once, and the property that matters most — a scale chosen
 * last week is the scale this session boots at — is only observable on a first read.
 */

/** The module under test, re-imported per case. */
let fontScale: typeof import("@/app/font-scale");

beforeEach(async () => {
  vi.resetModules();
  window.localStorage.clear();
  fontScale = await import("@/app/font-scale");
  document.documentElement.removeAttribute(fontScale.FONT_SCALE_ATTRIBUTE);
});

afterEach(() => {
  document.documentElement.removeAttribute(fontScale.FONT_SCALE_ATTRIBUTE);
  window.localStorage.clear();
});

describe("the vocabulary", () => {
  it("is § 4's five steps, smallest first", () => {
    // The same five as the contract's FontScale enum and V007's CHECK — the type import
    // in the module is what holds this list to the schema at compile time.
    expect(fontScale.FONT_SCALES).toEqual(["87.5", "100", "112.5", "125", "150"]);
    expect(fontScale.DEFAULT_FONT_SCALE).toBe("100");
  });

  it.each(["87.5", "100", "112.5", "125", "150"] as const)("parses the step %s", (step) => {
    expect(fontScale.parseFontScale(step)).toBe(step);
  });

  it.each([null, undefined, "", "90", "100.0", "1.5", "large", "150%"])(
    "reads %p as no mirrored value at all — not as the default",
    (value) => {
      // "Unreadable" and "chose 100" are different facts, even though they paint the same:
      // the boot script must stamp nothing for one and "100" for the other.
      expect(fontScale.parseFontScale(value)).toBeNull();
    },
  );
});

describe("the mirror", () => {
  it("stores a step and reads it back", () => {
    const storage = memoryStorage();

    fontScale.storeFontScale("125", storage);

    expect(storage.getItem(fontScale.FONT_SCALE_STORAGE_KEY)).toBe("125");
    expect(fontScale.readStoredFontScale(storage)).toBe("125");
  });

  it("stores '100' as a value, never as an absence", () => {
    // The server distinguishes "never chose" from "chose 100"; the mirror does not need to,
    // but deleting the key for '100' would make a reader who returned to the default boot
    // as "never reconciled".
    const storage = memoryStorage({ [fontScale.FONT_SCALE_STORAGE_KEY]: "150" });

    fontScale.storeFontScale("100", storage);

    expect(storage.getItem(fontScale.FONT_SCALE_STORAGE_KEY)).toBe("100");
  });

  it("survives a storage that throws", () => {
    // Private mode, a full quota: the scale applies to this session and the next boot just
    // will not know. Nothing to assert beyond "no throw" — which is the assertion.
    expect(() => fontScale.storeFontScale("125", hostileStorage())).not.toThrow();
    expect(fontScale.readStoredFontScale(hostileStorage())).toBeNull();
  });
});

describe("the stamp", () => {
  it("puts the step on the element the stylesheet reads", () => {
    fontScale.stampFontScale("112.5");

    expect(document.documentElement.getAttribute(fontScale.FONT_SCALE_ATTRIBUTE)).toBe(
      "112.5",
    );
  });

  it("stamps nowhere when there is no document", () => {
    expect(() => fontScale.stampFontScale("125", undefined)).not.toThrow();
  });
});

describe("the store", () => {
  it("boots from the mirror on the first read", () => {
    window.localStorage.setItem(fontScale.FONT_SCALE_STORAGE_KEY, "150");

    expect(fontScale.currentFontScale()).toBe("150");
  });

  it("boots at the default when the mirror is empty or unreadable", () => {
    window.localStorage.setItem(fontScale.FONT_SCALE_STORAGE_KEY, "gibberish");

    expect(fontScale.currentFontScale()).toBe("100");
  });

  it("applies a step everywhere at once: stamp, mirror, subscribers", () => {
    const heard = vi.fn();
    fontScale.subscribeFontScale(heard);

    fontScale.setFontScale("125");

    expect(fontScale.currentFontScale()).toBe("125");
    expect(document.documentElement.getAttribute(fontScale.FONT_SCALE_ATTRIBUTE)).toBe("125");
    expect(window.localStorage.getItem(fontScale.FONT_SCALE_STORAGE_KEY)).toBe("125");
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("tells nobody about a step that changes nothing", () => {
    const heard = vi.fn();
    fontScale.setFontScale("125");
    fontScale.subscribeFontScale(heard);

    fontScale.setFontScale("125");

    expect(heard).not.toHaveBeenCalled();
  });

  it("stops telling a listener that unsubscribed", () => {
    const heard = vi.fn();
    const stop = fontScale.subscribeFontScale(heard);

    stop();
    fontScale.setFontScale("87.5");

    expect(heard).not.toHaveBeenCalled();
  });
});

describe("the boot script", () => {
  it("is generated from the module's own constants", () => {
    // The containment assertions the theme's and the sidebar's tests make: the script and
    // the module that reads it back cannot drift, because the script is built from the
    // constants it would drift from. The vocabulary is inlined as a literal — the script
    // stands alone in <head> — so it is held to FONT_SCALES here.
    expect(fontScale.FONT_SCALE_BOOTSTRAP).toContain(
      JSON.stringify(fontScale.FONT_SCALE_STORAGE_KEY),
    );
    expect(fontScale.FONT_SCALE_BOOTSTRAP).toContain(
      JSON.stringify(fontScale.FONT_SCALE_ATTRIBUTE),
    );
    expect(fontScale.FONT_SCALE_BOOTSTRAP).toContain(
      JSON.stringify([...fontScale.FONT_SCALES]),
    );
  });

  it("cannot terminate the tag it is inlined into", () => {
    expect(fontScale.FONT_SCALE_BOOTSTRAP).not.toMatch(/<\/script/i);
  });

  it("stays small enough to be free", () => {
    expect(fontScale.FONT_SCALE_BOOTSTRAP.length).toBeLessThan(300);
  });

  it("stamps a mirrored step before anything else runs", () => {
    window.localStorage.setItem(fontScale.FONT_SCALE_STORAGE_KEY, "150");

    new Function(fontScale.FONT_SCALE_BOOTSTRAP)();

    expect(document.documentElement.getAttribute(fontScale.FONT_SCALE_ATTRIBUTE)).toBe("150");
  });

  it.each(["90", "100.0", "gibberish", ""])(
    "stamps nothing for the unreadable mirror %p",
    (value) => {
      window.localStorage.setItem(fontScale.FONT_SCALE_STORAGE_KEY, value);

      new Function(fontScale.FONT_SCALE_BOOTSTRAP)();

      expect(document.documentElement.hasAttribute(fontScale.FONT_SCALE_ATTRIBUTE)).toBe(
        false,
      );
    },
  );

  it("stamps nothing when the mirror is empty", () => {
    new Function(fontScale.FONT_SCALE_BOOTSTRAP)();

    expect(document.documentElement.hasAttribute(fontScale.FONT_SCALE_ATTRIBUTE)).toBe(false);
  });
});
