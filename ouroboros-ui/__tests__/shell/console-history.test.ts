import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONSOLE_HISTORY_LIMIT,
  CONSOLE_HISTORY_STORAGE_KEY,
  consoleHistoryKey,
  historyStep,
  parseConsoleHistories,
  pushConsoleLine,
  readConsoleHistory,
  recordConsoleLine,
} from "@/app/shell/console-history";

/**
 * The console's history (#539): the lines each person ran, per workspace, newest first, capped,
 * and nothing at all when there is nowhere to keep them.
 */

const KEN = "user-ken";
const MIA = "user-mia";
const ACME = "org-acme";
const OTHER = "org-other";

/**
 * A storage that refuses every write, as a full quota does.
 *
 * @returns The storage.
 */
function refusing(): Storage {
  return {
    getItem: () => null,
    setItem: () => {
      throw new DOMException("QuotaExceededError");
    },
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("whose history it is", () => {
  it("is the person's and the workspace's together", () => {
    expect(consoleHistoryKey(KEN, ACME)).toBe("user-ken/org-acme");
    expect(consoleHistoryKey(KEN, ACME)).not.toBe(consoleHistoryKey(KEN, OTHER));
    expect(consoleHistoryKey(KEN, ACME)).not.toBe(consoleHistoryKey(MIA, ACME));
  });

  it("is nobody's while either is unknown", () => {
    expect(consoleHistoryKey("", ACME)).toBeNull();
    expect(consoleHistoryKey(KEN, "")).toBeNull();
  });
});

describe("one more line", () => {
  it("goes first", () => {
    expect(pushConsoleLine(["status"], "queue #485")).toEqual(["queue #485", "status"]);
  });

  it("is trimmed", () => {
    expect(pushConsoleLine([], "  status  ")).toEqual(["status"]);
  });

  it("is not added again when it repeats the one before it", () => {
    const lines = ["status", "queue #485"];

    expect(pushConsoleLine(lines, "status")).toBe(lines);
  });

  it("is added again when something else was run in between", () => {
    expect(pushConsoleLine(["queue #485", "status"], "status")).toEqual([
      "status",
      "queue #485",
      "status",
    ]);
  });

  it("is not added when it is empty", () => {
    const lines = ["status"];

    expect(pushConsoleLine(lines, "   ")).toBe(lines);
  });

  it("pushes the oldest out past the limit", () => {
    const full = Array.from({ length: CONSOLE_HISTORY_LIMIT }, (_, at) => `estimate #${at}`);
    const after = pushConsoleLine(full, "status");

    expect(CONSOLE_HISTORY_LIMIT).toBe(50);
    expect(after).toHaveLength(CONSOLE_HISTORY_LIMIT);
    expect(after[0]).toBe("status");
    expect(after).not.toContain(`estimate #${CONSOLE_HISTORY_LIMIT - 1}`);
  });
});

describe("what storage holds", () => {
  it.each([
    [null],
    [undefined],
    [""],
    ["not json"],
    ["[]"],
    ['"status"'],
    ["42"],
    ["null"],
  ])("reads %j as nobody's history", (raw) => {
    expect(parseConsoleHistories(raw)).toEqual({});
  });

  it("drops an owner whose value is not a list, and anything in a list that is not a line", () => {
    const raw = JSON.stringify({
      "user-ken/org-acme": ["status", 7, "", null, "  ", "queue #485"],
      "user-mia/org-acme": "status",
      "": ["status"],
      "user-ken/org-other": [],
    });

    expect(parseConsoleHistories(raw)).toEqual({ "user-ken/org-acme": ["status", "queue #485"] });
  });

  it("reads no more than the limit, however much was written", () => {
    const raw = JSON.stringify({
      "user-ken/org-acme": Array.from({ length: 80 }, (_, at) => `estimate #${at}`),
    });

    expect(parseConsoleHistories(raw)["user-ken/org-acme"]).toHaveLength(CONSOLE_HISTORY_LIMIT);
  });
});

describe("remembering and recalling", () => {
  it("keeps each person's lines per workspace", () => {
    recordConsoleLine(KEN, ACME, "status");
    recordConsoleLine(KEN, ACME, "queue #485");
    recordConsoleLine(KEN, OTHER, "estimate #12");
    recordConsoleLine(MIA, ACME, "pause all");

    expect(readConsoleHistory(KEN, ACME)).toEqual(["queue #485", "status"]);
    expect(readConsoleHistory(KEN, OTHER)).toEqual(["estimate #12"]);
    expect(readConsoleHistory(MIA, ACME)).toEqual(["pause all"]);
    expect(readConsoleHistory(MIA, OTHER)).toEqual([]);
  });

  it("writes one key, by owner", () => {
    recordConsoleLine(KEN, ACME, "status");

    expect(JSON.parse(window.localStorage.getItem(CONSOLE_HISTORY_STORAGE_KEY)!)).toEqual({
      "user-ken/org-acme": ["status"],
    });
  });

  it("does not write a consecutive repeat", () => {
    recordConsoleLine(KEN, ACME, "status");
    const before = window.localStorage.getItem(CONSOLE_HISTORY_STORAGE_KEY);

    recordConsoleLine(KEN, ACME, "status");

    expect(window.localStorage.getItem(CONSOLE_HISTORY_STORAGE_KEY)).toBe(before);
  });

  it("keeps nothing for a session that is not known yet", () => {
    recordConsoleLine("", ACME, "status");
    recordConsoleLine(KEN, "", "status");

    expect(window.localStorage.getItem(CONSOLE_HISTORY_STORAGE_KEY)).toBeNull();
    expect(readConsoleHistory("", ACME)).toEqual([]);
  });

  it("ignores a damaged value, and replaces it with the next line that runs", () => {
    window.localStorage.setItem(CONSOLE_HISTORY_STORAGE_KEY, "{not json");

    expect(readConsoleHistory(KEN, ACME)).toEqual([]);

    recordConsoleLine(KEN, ACME, "status");

    expect(readConsoleHistory(KEN, ACME)).toEqual(["status"]);
  });

  it("keeps nothing, and throws nothing, when there is no storage", () => {
    // What a browser with storage switched off does: reading the property itself throws.
    const blocked = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });

    try {
      expect(() => recordConsoleLine(KEN, ACME, "status")).not.toThrow();
      expect(readConsoleHistory(KEN, ACME)).toEqual([]);
    } finally {
      blocked.mockRestore();
    }

    expect(window.localStorage.getItem(CONSOLE_HISTORY_STORAGE_KEY)).toBeNull();
  });

  it("throws nothing when storage refuses the write or the read", () => {
    expect(() => recordConsoleLine(KEN, ACME, "status", refusing())).not.toThrow();

    const unreadable = {
      ...refusing(),
      getItem: () => {
        throw new DOMException("SecurityError");
      },
    };

    expect(readConsoleHistory(KEN, ACME, unreadable)).toEqual([]);
  });
});

describe("walking it", () => {
  it("starts at the newest and stops at the oldest", () => {
    expect(historyStep(null, "older", 3)).toBe(0);
    expect(historyStep(0, "older", 3)).toBe(1);
    expect(historyStep(2, "older", 3)).toBe(2);
  });

  it("walks back towards the newest and then off the history", () => {
    expect(historyStep(2, "newer", 3)).toBe(1);
    expect(historyStep(0, "newer", 3)).toBeNull();
    expect(historyStep(null, "newer", 3)).toBeNull();
  });

  it("goes nowhere when there is none", () => {
    expect(historyStep(null, "older", 0)).toBeNull();
  });
});
