import { ResearchToolError } from "../tools/research-tool.errors";
import { MAX_WINDOW_DAYS, dayOf, daySpan, parseWindow, type RangeWindow } from "./telemetry.window";

/**
 * Windows (#619): three ways to name one, and one way to cite it — absolute, so the citation
 * means the same stretch of time tomorrow.
 */

const NOW = new Date("2026-10-10T02:47:47.512Z");

/**
 * Parse a window that must be a range.
 *
 * @param input - The window.
 * @param grain - The grain.
 * @returns The range.
 */
function range(input: string, grain: "day" | "instant"): RangeWindow {
  const window = parseWindow(input, NOW, grain);

  if (window.kind !== "range") throw new Error("expected a range");

  return window;
}

describe("a relative window", () => {
  it("is written back as the absolute days it resolved to, on the day grain", () => {
    const window = range("30d", "day");

    // Today and the twenty-nine days before it — the Insights page's own "30d".
    expect(window.text).toBe("2026-09-11..2026-10-10");
    expect(daySpan(window)).toEqual({ from: "2026-09-11", to: "2026-10-10" });
  });

  it("is written back as absolute instants, to the second, on the instant grain", () => {
    const window = range("7d", "instant");

    expect(window.text).toBe("2026-10-03T02:47:47Z..2026-10-10T02:47:47Z");
    expect(window.from.toISOString()).toBe("2026-10-03T02:47:47.000Z");
    expect(window.to.toISOString()).toBe("2026-10-10T02:47:47.000Z");
  });

  it.each([
    ["36h", "2026-10-08T14:47:47Z..2026-10-10T02:47:47Z"],
    ["2w", "2026-09-26T02:47:47Z..2026-10-10T02:47:47Z"],
    ["1d", "2026-10-09T02:47:47Z..2026-10-10T02:47:47Z"],
  ])("resolves %s to %s", (input, text) => {
    expect(range(input, "instant").text).toBe(text);
  });

  it("counts a week as seven days on the day grain", () => {
    expect(range("2w", "day").text).toBe("2026-09-27..2026-10-10");
    expect(range("1d", "day").text).toBe("2026-10-10..2026-10-10");
  });

  it("names the same stretch when its own citation is parsed a week later", () => {
    const cited = range("7d", "instant").text;
    const later = parseWindow(cited, new Date("2026-10-17T09:00:00Z"), "instant") as RangeWindow;

    expect(later.text).toBe(cited);
    expect(later.from.toISOString()).toBe("2026-10-03T02:47:47.000Z");
    expect(later.to.toISOString()).toBe("2026-10-10T02:47:47.000Z");
  });

  it("refuses hours on the day grain — the insights plane has no hours", () => {
    expect(() => parseWindow("36h", NOW, "day")).toThrow(/kept per UTC day/);
  });
});

describe("a written range", () => {
  it("includes its last day when written as days", () => {
    const window = range("2026-08-01..2026-08-08", "instant");

    expect(window.text).toBe("2026-08-01..2026-08-08");
    expect(window.from.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(window.to.toISOString()).toBe("2026-08-09T00:00:00.000Z");
    expect(daySpan(range("2026-08-01..2026-08-08", "day"))).toEqual({
      from: "2026-08-01",
      to: "2026-08-08",
    });
  });

  it("is half-open when written as instants", () => {
    const window = range("2026-09-01T00:00Z..2026-09-02T12:30:15Z", "instant");

    expect(window.from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(window.to.toISOString()).toBe("2026-09-02T12:30:15.000Z");
  });

  it("is one day when both ends are the same day", () => {
    const window = range("2026-08-08..2026-08-08", "day");

    expect(daySpan(window)).toEqual({ from: "2026-08-08", to: "2026-08-08" });
  });

  it("refuses times on the day grain", () => {
    expect(() => parseWindow("2026-09-01T00:00Z..2026-09-02T00:00Z", NOW, "day")).toThrow(
      /whole days/,
    );
  });

  it.each(["2026-08-08..2026-08-01", "2026-08-01T10:00Z..2026-08-01T10:00Z"])(
    "refuses %s, which ends before it starts",
    (input) => {
      expect(() => parseWindow(input, NOW, "instant")).toThrow(/ends before it starts/);
    },
  );

  it("refuses a window longer than the bound, and accepts one at it", () => {
    expect(() => parseWindow("2025-01-01..2026-10-01", NOW, "instant")).toThrow(
      new RegExp(`at most ${String(MAX_WINDOW_DAYS)} days`),
    );
    expect(() => parseWindow("9999d", NOW, "instant")).toThrow(/at most/);
    expect(range("2025-10-10..2026-10-10", "day").kind).toBe("range");
  });

  it.each(["2026-02-31..2026-03-01", "2026-13-01..2026-13-02", "2026-08-01..2026-08-32"])(
    "refuses %s — a day that does not exist",
    (input) => {
      expect(() => parseWindow(input, NOW, "day")).toThrow(/is not a window/);
    },
  );
});

describe("a baseline window", () => {
  it("names a release's captured window by its tag", () => {
    expect(parseWindow("baseline:v2.0.4", NOW, "instant")).toEqual({
      kind: "baseline",
      text: "baseline:v2.0.4",
      tag: "v2.0.4",
    });
    expect(parseWindow("baseline:v2.1.0-rc1", NOW, "day")).toMatchObject({ tag: "v2.1.0-rc1" });
  });

  it("refuses an empty or spaced tag", () => {
    expect(() => parseWindow("baseline:", NOW, "day")).toThrow(ResearchToolError);
    expect(() => parseWindow("baseline:v2 0", NOW, "day")).toThrow(ResearchToolError);
  });
});

describe("what is not a window", () => {
  it.each([
    undefined,
    null,
    30,
    {},
    "",
    "last-month",
    "30",
    "0d",
    "d",
    "30m",
    "2026-08-01",
    "2026-08-01..",
    "a..b",
    "2026-08-01..2026-08-02..2026-08-03",
    "x".repeat(201),
  ])("refuses %p as unsupported, saying what a window looks like", (input) => {
    expect(() => parseWindow(input, NOW, "instant")).toThrow(ResearchToolError);
    try {
      parseWindow(input, NOW, "instant");
    } catch (error) {
      expect((error as ResearchToolError).errorClass).toBe("unsupported");
      expect((error as ResearchToolError).detail).toMatch(/baseline:<release tag>/);
    }
  });

  it("names a UTC day", () => {
    expect(dayOf(new Date("2026-10-09T23:59:59Z"))).toBe("2026-10-09");
  });
});
