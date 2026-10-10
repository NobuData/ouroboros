import { describe, expect, it, vi } from "vitest";

import {
  isProgressReading,
  progressUrl,
  readEventData,
  watchInvestigation,
} from "@/app/research/progress";

import { FakeProgressSource, openFakeSource, progress } from "../helpers/research";

/**
 * Following a run from the browser (#628): the stream's three events, the one that ends the
 * watch, and the two things called `error`.
 */

const ID = "5eed0084-0000-4000-8000-000000000128";

function handlers() {
  return { onProgress: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
}

describe("progressUrl", () => {
  it("is this origin's pass-through for the investigation, the id encoded", () => {
    expect(progressUrl(ID)).toBe(`/api/research/investigations/${ID}/progress`);
    expect(progressUrl("a/b")).toBe("/api/research/investigations/a%2Fb/progress");
  });
});

describe("readEventData", () => {
  it("parses the data line, and answers null for a connection event or a line that is not JSON", () => {
    expect(readEventData({ data: '{"kind":"progress"}' })).toEqual({ kind: "progress" });
    expect(readEventData({})).toBeNull();
    expect(readEventData({ data: "not json" })).toBeNull();
    expect(readEventData({ data: "42" })).toBeNull();
  });

  it("recognises a reading by its status and source count", () => {
    expect(isProgressReading({ ...progress() })).toBe(true);
    expect(isProgressReading({ kind: "error", code: "x", message: "y" })).toBe(false);
  });
});

describe("watchInvestigation", () => {
  it("opens the source on the pass-through and hands each reading on", () => {
    FakeProgressSource.reset();
    const told = handlers();

    watchInvestigation(ID, told, openFakeSource);
    const source = FakeProgressSource.latest();
    source.emit("progress", { kind: "progress", ...progress({ sources: 12 }) });

    expect(source.url).toBe(progressUrl(ID));
    expect(told.onProgress).toHaveBeenCalledExactlyOnceWith({ kind: "progress", ...progress({ sources: 12 }) });
    expect(source.closed).toBe(false);
  });

  it("closes the source on done — the service would answer done again for ever — then tells", () => {
    FakeProgressSource.reset();
    const told = handlers();
    told.onDone.mockImplementation(() => {
      expect(FakeProgressSource.latest().closed).toBe(true);
    });

    watchInvestigation(ID, told, openFakeSource);
    FakeProgressSource.latest().emit("done", { kind: "done", ...progress({ status: "brief_ready" }) });

    expect(told.onDone).toHaveBeenCalledExactlyOnceWith({ kind: "done", ...progress({ status: "brief_ready" }) });
  });

  it("ends the watch on a served error, with the service's code and sentence", () => {
    FakeProgressSource.reset();
    const told = handlers();

    watchInvestigation(ID, told, openFakeSource);
    FakeProgressSource.latest().emit("error", { kind: "error", code: "investigation_not_found", message: "Gone." });

    expect(told.onError).toHaveBeenCalledExactlyOnceWith({ code: "investigation_not_found", message: "Gone." });
    expect(FakeProgressSource.latest().closed).toBe(true);
  });

  it("leaves the browser's own connection error to the browser's reconnect", () => {
    FakeProgressSource.reset();
    const told = handlers();

    watchInvestigation(ID, told, openFakeSource);
    FakeProgressSource.latest().emit("error");

    expect(told.onError).not.toHaveBeenCalled();
    expect(FakeProgressSource.latest().closed).toBe(false);
  });

  it("fills in the words for a served error that carries none", () => {
    FakeProgressSource.reset();
    const told = handlers();

    watchInvestigation(ID, told, openFakeSource);
    FakeProgressSource.latest().emit("error", { kind: "error" });

    expect(told.onError).toHaveBeenCalledExactlyOnceWith({
      code: "investigation_progress_failed",
      message: "The progress stream stopped unexpectedly. Reload to read the investigation's state.",
    });
  });

  it("ignores a line that is not a reading, and one that is not JSON", () => {
    FakeProgressSource.reset();
    const told = handlers();

    watchInvestigation(ID, told, openFakeSource);
    FakeProgressSource.latest().emit("progress", { kind: "progress" });
    FakeProgressSource.latest().emitRaw("progress", "{not json");
    FakeProgressSource.latest().emitRaw("done", "{not json");

    expect(told.onProgress).not.toHaveBeenCalled();
    expect(told.onDone).not.toHaveBeenCalled();
    // A malformed done still ends the watch: the service closes after it either way.
    expect(FakeProgressSource.latest().closed).toBe(true);
  });

  it("stops when the caller says so, once", () => {
    FakeProgressSource.reset();
    const stop = watchInvestigation(ID, handlers(), openFakeSource);
    const source = FakeProgressSource.latest();
    const close = vi.spyOn(source, "close");

    stop();
    stop();

    expect(source.closed).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
