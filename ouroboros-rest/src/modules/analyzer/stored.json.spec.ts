import { numberOf, objectOf, objectOrNull, textOf } from "./stored.json";

/**
 * Reading stored JSON (#517, #518): the value when it is the type asked for, and nothing — never
 * a default — when it is not.
 */

describe("reading what the analyzer stored", () => {
  it("answers an object as itself, and anything else as null or empty", () => {
    const stored = { sample_size: 14 };

    expect(objectOrNull(stored)).toBe(stored);
    expect(objectOf(stored)).toBe(stored);
    for (const other of [null, undefined, "x", 7, true, [stored]]) {
      expect(objectOrNull(other)).toBeNull();
      expect(objectOf(other)).toEqual({});
    }
  });

  it("answers a finite number, and null for a string of digits, NaN or infinity", () => {
    expect(numberOf(0)).toBe(0);
    expect(numberOf(-0.686)).toBe(-0.686);
    for (const other of ["14", null, undefined, Number.NaN, Number.POSITIVE_INFINITY, {}]) {
      expect(numberOf(other)).toBeNull();
    }
  });

  it("answers a string — an empty one too — and null for anything else", () => {
    expect(textOf("")).toBe("");
    expect(textOf("measured")).toBe("measured");
    for (const other of [14, null, undefined, {}, ["measured"]]) {
      expect(textOf(other)).toBeNull();
    }
  });
});
