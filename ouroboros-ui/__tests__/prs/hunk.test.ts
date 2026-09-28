import { describe, expect, it } from "vitest";

import { PR_HUNK_PARAM } from "@/app/paths";
import {
  MAX_HUNK_LINE,
  MAX_HUNK_PATH,
  hunkParam,
  hunkRange,
  hunkValue,
  isHunk,
  isHunkLine,
  sameHunk,
  withHunk,
} from "@/app/prs/hunk";

/**
 * A cited hunk and its address (#366): what the matrix's hunk references are, how `?hunk=` states
 * one, and everything the address refuses to read as one.
 */

const HUNK = { path: "drivers/can/telemetry_buf.c", lineStart: 41, lineEnd: 66 };

describe("isHunk", () => {
  it("accepts a path and a range whose last line is not before its first", () => {
    expect(isHunk(HUNK)).toBe(true);
    expect(isHunk({ ...HUNK, lineEnd: 41 })).toBe(true);
  });

  it.each([
    ["a range that ends before it starts", { ...HUNK, lineEnd: 40 }],
    ["a line below 1", { ...HUNK, lineStart: 0 }],
    ["a fractional line", { ...HUNK, lineStart: 41.5 }],
    ["a line past the service's bound", { ...HUNK, lineEnd: MAX_HUNK_LINE + 1 }],
    ["an empty path", { ...HUNK, path: "" }],
    ["a padded path", { ...HUNK, path: " a.c" }],
    ["an over-long path", { ...HUNK, path: "a".repeat(MAX_HUNK_PATH + 1) }],
    ["a reference with no range", { path: "a.c", lineStart: null, lineEnd: null }],
    ["nothing", null],
    ["a string", "a.c:1-2"],
  ])("refuses %s", (_name, value) => {
    expect(isHunk(value)).toBe(false);
  });

  it("reads a line as a whole number from 1 to the bound", () => {
    expect(isHunkLine(1)).toBe(true);
    expect(isHunkLine(MAX_HUNK_LINE)).toBe(true);
    expect(isHunkLine("41")).toBe(false);
    expect(isHunkLine(Number.NaN)).toBe(false);
  });
});

describe("the words", () => {
  it("names a range, and a single line as one line", () => {
    expect(hunkRange(HUNK)).toBe("lines 41–66");
    expect(hunkRange({ ...HUNK, lineEnd: 41 })).toBe("line 41");
  });
});

describe("the address", () => {
  it("states a hunk as its path and range", () => {
    expect(hunkValue(HUNK)).toBe("drivers/can/telemetry_buf.c:41-66");
    expect(hunkValue({ ...HUNK, lineEnd: 41 })).toBe("drivers/can/telemetry_buf.c:41");
  });

  it("reads back what it states", () => {
    expect(hunkParam(hunkValue(HUNK))).toEqual(HUNK);
    expect(hunkParam("a.c:7")).toEqual({ path: "a.c", lineStart: 7, lineEnd: 7 });
  });

  it("reads a path that holds a colon itself", () => {
    expect(hunkParam("C:/src/a.c:3-4")).toEqual({ path: "C:/src/a.c", lineStart: 3, lineEnd: 4 });
  });

  it.each([
    ["absent", undefined],
    ["null", null],
    ["repeated", ["a.c:1-2", "b.c:3-4"]],
    ["without a range", "a.c"],
    ["with a range that is not numbers", "a.c:x-y"],
    ["with a backwards range", "a.c:9-3"],
    ["with a zero line", "a.c:0-3"],
    ["with no path", ":1-2"],
    ["empty", ""],
  ])("reads nothing from a parameter that is %s", (_name, value) => {
    expect(hunkParam(value)).toBeNull();
  });

  it("sets the parameter and keeps the rest of the query", () => {
    const next = new URLSearchParams(withHunk("?from=dashboard&rev=1", HUNK));

    expect(next.get(PR_HUNK_PARAM)).toBe("drivers/can/telemetry_buf.c:41-66");
    expect(next.get("from")).toBe("dashboard");
    expect(next.get("rev")).toBe("1");
  });

  it("removes the parameter, and says nothing when nothing is left", () => {
    expect(withHunk(`?${PR_HUNK_PARAM}=a.c%3A1-2&from=dashboard`, null)).toBe("?from=dashboard");
    expect(withHunk(`?${PR_HUNK_PARAM}=a.c%3A1-2`, null)).toBe("");
    expect(withHunk("", null)).toBe("");
  });
});

describe("sameHunk", () => {
  it("compares the path and the range, and treats two absences as the same", () => {
    expect(sameHunk(HUNK, { ...HUNK })).toBe(true);
    expect(sameHunk(HUNK, { ...HUNK, lineEnd: 67 })).toBe(false);
    expect(sameHunk(HUNK, { ...HUNK, path: "other.c" })).toBe(false);
    expect(sameHunk(null, null)).toBe(true);
    expect(sameHunk(HUNK, null)).toBe(false);
  });
});
