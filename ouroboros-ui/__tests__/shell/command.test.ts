import { describe, expect, it } from "vitest";

import { commandAction } from "../helpers/command";
import {
  fuzzyScore,
  groupCommandActions,
  matchCommandActions,
  runnableCommandActions,
  scoreCommandAction,
} from "@/app/shell/command";

/**
 * The palette's model — the half of H.3
 * ([#79](https://github.com/NobuData/ouroboros/issues/79)) that holds no state.
 *
 * Everything here is a pure function, so every rule is asserted without a registry, a DOM or
 * a route — which is the whole reason `app/shell/command.ts` is separate from the palette
 * that renders it. What the browser adds (focus, the ring, Enter) is
 * `__tests__/shell/command-palette.test.tsx`.
 */

describe("matching a query against text", () => {
  it("matches a prefix", () => {
    expect(fuzzyScore("dash", "Dashboard")).not.toBeNull();
  });

  it("matches letters scattered in order, which is what makes it fuzzy", () => {
    // The behaviour a palette is judged on: three initials reach a three-word label.
    expect(fuzzyScore("gtd", "go to dashboard")).not.toBeNull();
  });

  it("refuses letters that are not in order", () => {
    expect(fuzzyScore("hsad", "dashboard")).toBeNull();
  });

  it("refuses a letter that is not there at all", () => {
    expect(fuzzyScore("dashz", "dashboard")).toBeNull();
  });

  it("matches everything when nothing has been typed", () => {
    // The unfiltered palette is the same code path as the filtered one, which is why an
    // empty query is a match rather than a special case anybody has to remember.
    expect(fuzzyScore("", "anything at all")).toBe(0);
  });

  it("ranks a contiguous run above the same letters scattered", () => {
    const together = fuzzyScore("set", "settings");
    const apart = fuzzyScore("set", "sign out — end the session");

    expect(together).toBeGreaterThan(apart ?? 0);
  });

  it("ranks letters that start words above letters inside them", () => {
    const initials = fuzzyScore("bf", "build farm");
    const inside = fuzzyScore("bf", "brief");

    expect(initials).toBeGreaterThan(inside ?? 0);
  });
});

describe("matching a query against an action", () => {
  it("reads the label", () => {
    expect(scoreCommandAction("issues", commandAction({ label: "Go to Issues" }))).not.toBeNull();
  });

  it("reads the keywords, for the words the label does not carry", () => {
    const action = commandAction({ label: "Sign out", keywords: ["log out"] });

    expect(scoreCommandAction("log out", action)).not.toBeNull();
  });

  it("ranks a label match above a keyword match, whatever either scores", () => {
    // A query is nearly always the beginning of the name of the thing, so a row merely
    // tagged with the word must never appear above one actually called it.
    const named = commandAction({ label: "Toggle theme" });
    const tagged = commandAction({ label: "Go to Settings", keywords: ["theme"] });

    expect(scoreCommandAction("theme", named)).toBeGreaterThan(
      scoreCommandAction("theme", tagged) ?? 0,
    );
  });

  it("says nothing matched when neither the label nor a keyword does", () => {
    const action = commandAction({ label: "Sign out", keywords: ["leave"] });

    expect(scoreCommandAction("dashboard", action)).toBeNull();
  });
});

describe("choosing the actions for a query", () => {
  /** Three actions whose labels a query can tell apart. */
  const ACTIONS = [
    commandAction({ id: "a", label: "Go to Dashboard" }),
    commandAction({ id: "b", label: "Go to Issues" }),
    commandAction({ id: "c", label: "Sign out" }),
  ];

  it("keeps everything, in the given order, when nothing has been typed", () => {
    expect(matchCommandActions("", ACTIONS).map((action) => action.id)).toEqual(["a", "b", "c"]);
  });

  it("drops what does not match", () => {
    expect(matchCommandActions("sign", ACTIONS).map((action) => action.id)).toEqual(["c"]);
  });

  it("puts the best match first", () => {
    // "Go to Issues" carries the query as a run at a word boundary; "Go to Dashboard" only
    // scatters the same three letters.
    expect(matchCommandActions("iss", ACTIONS)[0].id).toBe("b");
  });

  it("leaves ties in the order the sources gave them", () => {
    // Which is the whole of what a source's `sort` buys it: two equally good matches keep
    // the order the registry put them in rather than one a sort happened to land on.
    expect(matchCommandActions("go to", ACTIONS).map((action) => action.id)).toEqual(["a", "b"]);
  });

  it("ignores the spaces around a query, which are a keystroke and not a term", () => {
    expect(matchCommandActions("  sign  ", ACTIONS).map((action) => action.id)).toEqual(["c"]);
  });

  it("does not care about case", () => {
    expect(matchCommandActions("DASHBOARD", ACTIONS).map((action) => action.id)).toEqual(["a"]);
  });
});

describe("the rows the keyboard may land on", () => {
  it("keeps the runnable ones and drops the rest", () => {
    // A row that cannot be activated is a row Enter would do nothing on, and stopping there
    // teaches a reader that the palette is broken.
    const actions = [
      commandAction({ id: "live" }),
      { id: "soon", label: "Go to Issues", group: "Navigation", unavailable: "Arrives with #115." },
      commandAction({ id: "also-live" }),
    ] as const;

    expect(runnableCommandActions(actions).map((action) => action.id)).toEqual([
      "live",
      "also-live",
    ]);
  });
});

describe("gathering actions under headings", () => {
  it("groups them, keeping each group's own order", () => {
    const actions = [
      commandAction({ id: "a", group: "Navigation" }),
      commandAction({ id: "b", group: "Actions" }),
      commandAction({ id: "c", group: "Navigation" }),
    ];

    expect(groupCommandActions(actions)).toEqual([
      { name: "Navigation", actions: [actions[0], actions[2]] },
      { name: "Actions", actions: [actions[1]] },
    ]);
  });

  it("orders the groups by where each one first appears", () => {
    // So the heading order follows the sources' `sort` and the ranking, rather than a second
    // list of group names to keep in step with either.
    const actions = [
      commandAction({ id: "a", group: "Actions" }),
      commandAction({ id: "b", group: "Navigation" }),
    ];

    expect(groupCommandActions(actions).map((group) => group.name)).toEqual([
      "Actions",
      "Navigation",
    ]);
  });

  it("has nothing to draw for nothing", () => {
    expect(groupCommandActions([])).toEqual([]);
  });
});
