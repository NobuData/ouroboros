import { describe, expect, it } from "vitest";

import {
  HOME_VIEWPORT,
  MAX_ZOOM,
  MIN_ZOOM,
  VIEWPORT_STORAGE_PREFIX,
  ZOOM_PRESETS,
  nextZoom,
  parseViewport,
  readViewport,
  storeViewport,
  viewportKey,
  zoomPercent,
} from "@/app/workflows/canvas/viewport";

import { hostileStorage, memoryStorage } from "../../helpers/match-media";

/**
 * Where a reader is on the canvas, remembered per workflow (#148), and the ladder the toolbar
 * climbs. Every case is a value in, a value out; the canvas that calls these is
 * `studio-canvas.test.tsx`'s.
 */

describe("home", () => {
  it("is the origin at actual size — where the document's positions were written", () => {
    expect(HOME_VIEWPORT).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});

describe("the ladder", () => {
  it("runs from the floor to the ceiling through 100%, ascending", () => {
    expect(ZOOM_PRESETS[0]).toBe(MIN_ZOOM);
    expect(ZOOM_PRESETS[ZOOM_PRESETS.length - 1]).toBe(MAX_ZOOM);
    expect(ZOOM_PRESETS).toContain(1);
    expect([...ZOOM_PRESETS].sort((a, b) => a - b)).toEqual(ZOOM_PRESETS);
  });

  it("steps to the next rung in either direction", () => {
    expect(nextZoom(1, 1)).toBe(1.25);
    expect(nextZoom(1.25, 1)).toBe(1.5);
    expect(nextZoom(1, -1)).toBe(0.75);
    expect(nextZoom(0.75, -1)).toBe(0.5);
  });

  it("steps to the nearer rung from between two", () => {
    // Pinch zoom leaves the canvas between rungs; a press lands on a number a reader would name.
    expect(nextZoom(1.1, 1)).toBe(1.25);
    expect(nextZoom(1.1, -1)).toBe(1);
    expect(nextZoom(1.749, 1)).toBe(2);
  });

  it("clamps at the ends rather than wrapping", () => {
    expect(nextZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(nextZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
    expect(nextZoom(3, 1)).toBe(MAX_ZOOM);
    expect(nextZoom(0.1, -1)).toBe(MIN_ZOOM);
  });

  it("does not stick on a rung reached through floating-point noise", () => {
    expect(nextZoom(1.25 + 1e-9, 1)).toBe(1.5);
    expect(nextZoom(1.25 - 1e-9, -1)).toBe(1);
  });

  it("prints a zoom as a whole percent", () => {
    expect(zoomPercent(1)).toBe("100%");
    expect(zoomPercent(1.25)).toBe("125%");
    expect(zoomPercent(0.5)).toBe("50%");
    expect(zoomPercent(1.2345)).toBe("123%");
  });
});

describe("the key", () => {
  it("is the prefix and the workflow's id", () => {
    expect(viewportKey("5eed001b-0000-4000-8000-000000000001")).toBe(
      `${VIEWPORT_STORAGE_PREFIX}5eed001b-0000-4000-8000-000000000001`,
    );
    expect(VIEWPORT_STORAGE_PREFIX).toMatch(/^ouro-/);
  });
});

describe("parsing what storage held", () => {
  it("accepts a JSON object with finite coordinates and a zoom in range", () => {
    expect(parseViewport('{"x":40,"y":-20,"zoom":1.5}')).toEqual({ x: 40, y: -20, zoom: 1.5 });
    expect(parseViewport(JSON.stringify({ x: 0, y: 0, zoom: MIN_ZOOM }))).toEqual({ x: 0, y: 0, zoom: MIN_ZOOM });
    expect(parseViewport(JSON.stringify({ x: 0, y: 0, zoom: MAX_ZOOM }))).toEqual({ x: 0, y: 0, zoom: MAX_ZOOM });
  });

  it("refuses everything else, so a bad key opens the canvas at home", () => {
    expect(parseViewport(null)).toBeNull();
    expect(parseViewport(undefined)).toBeNull();
    expect(parseViewport("")).toBeNull();
    expect(parseViewport("not json")).toBeNull();
    expect(parseViewport("[0,0,1]")).toBeNull();
    expect(parseViewport("null")).toBeNull();
    expect(parseViewport('{"x":"40","y":0,"zoom":1}')).toBeNull();
    expect(parseViewport('{"x":0,"y":0}')).toBeNull();
    expect(parseViewport('{"x":0,"y":0,"zoom":null}')).toBeNull();
  });

  it("refuses a zoom outside the canvas's range — a key written by a build with a different one", () => {
    expect(parseViewport(JSON.stringify({ x: 0, y: 0, zoom: MAX_ZOOM + 0.01 }))).toBeNull();
    expect(parseViewport(JSON.stringify({ x: 0, y: 0, zoom: MIN_ZOOM - 0.01 }))).toBeNull();
    expect(parseViewport(JSON.stringify({ x: 0, y: 0, zoom: 0 }))).toBeNull();
  });
});

describe("reading and writing", () => {
  it("writes under the workflow's key and reads it back", () => {
    const storage = memoryStorage();

    storeViewport("w1", { x: 40, y: -20, zoom: 1.5 }, storage);

    expect(storage.getItem(viewportKey("w1"))).toBe('{"x":40,"y":-20,"zoom":1.5}');
    expect(readViewport("w1", storage)).toEqual({ x: 40, y: -20, zoom: 1.5 });
    expect(readViewport("w2", storage)).toBeNull();
  });

  it("stores the three numbers and nothing else React Flow may have put on the object", () => {
    const storage = memoryStorage();

    storeViewport("w1", { x: 1, y: 2, zoom: 1, extra: true } as never, storage);

    expect(storage.getItem(viewportKey("w1"))).toBe('{"x":1,"y":2,"zoom":1}');
  });

  it("reads nothing where nothing is stored, or where storage cannot be reached", () => {
    expect(readViewport("w1", memoryStorage())).toBeNull();
    expect(readViewport("w1", undefined)).toBeNull();
    expect(readViewport("w1", hostileStorage())).toBeNull();
  });

  it("does not throw when storage refuses the write", () => {
    // Safari's private mode: the place applies to this visit and is not remembered.
    expect(() => storeViewport("w1", HOME_VIEWPORT, hostileStorage())).not.toThrow();
    expect(() => storeViewport("w1", HOME_VIEWPORT, undefined)).not.toThrow();
  });
});
