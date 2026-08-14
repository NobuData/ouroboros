import { describe, expect, it } from "vitest";

import { commandContext } from "../helpers/command";
import { navEntry } from "../helpers/nav";
import { commandSources } from "@/app/shell/command-registry";
import {
  ACTIONS_GROUP,
  NAVIGATION_GROUP,
  SEEDED_COMMAND_SOURCES,
  navigationCommands,
  sessionCommands,
} from "@/app/shell/command-sources";

/**
 * The sources the shell itself offers
 * ([#79](https://github.com/NobuData/ouroboros/issues/79)).
 *
 * H.3's scope is *navigation only* — the issue's own decision, because content search needs
 * data that does not exist yet — so what these cases are about is that the palette offers the
 * product's screens and the shell's two commands, and that a screen nobody has built is
 * **listed and labelled** rather than dropped or linked to.
 */

describe("registering", () => {
  it("seeds the registry at import", () => {
    const registered = commandSources().map((source) => source.id);

    for (const source of SEEDED_COMMAND_SOURCES) expect(registered).toContain(source.id);
  });

  it("puts navigation before the shell's own commands", () => {
    const order = commandSources()
      .map((source) => source.id)
      .filter((id) => ["navigation", "session"].includes(id));

    expect(order).toEqual(["navigation", "session"]);
  });
});

describe("the navigation source", () => {
  it("offers a row per entry the reader may see", () => {
    const { context } = commandContext({
      nav: [navEntry({ id: "one" }), navEntry({ id: "two" })],
    });

    expect(navigationCommands.list?.(context)).toHaveLength(2);
  });

  it("says what pressing the row does, rather than only naming the screen", () => {
    const { context } = commandContext({ nav: [navEntry({ label: "Dashboard" })] });

    expect(navigationCommands.list?.(context)[0].label).toBe("Go to Dashboard");
  });

  it("navigates to a built route", () => {
    const { context, navigate } = commandContext({ nav: [navEntry({ route: "/dashboard" })] });

    navigationCommands.list?.(context)[0].run?.();

    expect(navigate).toHaveBeenCalledWith("/dashboard");
  });

  it("takes the route as a keyword, for the reader who types what they know it by", () => {
    const { context } = commandContext({ nav: [navEntry({ route: "/build-farm" })] });

    expect(navigationCommands.list?.(context)[0].keywords).toContain("/build-farm");
  });

  it("lists a screen nobody has built, and says what it waits for", () => {
    // The honesty rule (§ 3.5). Dropping the row would answer "Issues" with no matches — a
    // claim that there is no such screen rather than the truth, which is that it is not built.
    const { context } = commandContext({
      nav: [navEntry({ status: "soon", soonNote: "Issue intake arrives with #115." })],
    });

    const [row] = navigationCommands.list?.(context) ?? [];

    expect(row.run).toBeUndefined();
    expect(row.unavailable).toBe("Issue intake arrives with #115.");
  });

  it("draws every row under one heading", () => {
    const { context } = commandContext({
      nav: [navEntry(), navEntry({ status: "soon", soonNote: "Soon." })],
    });

    for (const row of navigationCommands.list?.(context) ?? []) {
      expect(row.group).toBe(NAVIGATION_GROUP);
    }
  });

  it("prefixes its ids, so no other source can collide with it", () => {
    const { context } = commandContext({ nav: [navEntry({ id: "issues" })] });

    expect(navigationCommands.list?.(context)[0].id).toBe("navigation:issues");
  });

  it("has nothing to offer a reader whose capabilities hid everything", () => {
    const { context } = commandContext({ nav: [] });

    expect(navigationCommands.list?.(context)).toEqual([]);
  });
});

describe("the theme command", () => {
  /**
   * The theme row, for a reader currently looking at one of the two palettes.
   *
   * @param theme The palette in force.
   * @returns The row and the spy it writes through.
   */
  function themeRow(theme: "light" | "dark") {
    const fixture = commandContext({ theme });
    const row = sessionCommands
      .list?.(fixture.context)
      .find((action) => action.label === "Toggle theme");

    return { ...fixture, row };
  }

  it("moves to dark from light", () => {
    const { row, setTheme } = themeRow("light");

    row?.run?.();

    expect(setTheme).toHaveBeenCalledWith("dark");
  });

  it("moves to light from dark", () => {
    const { row, setTheme } = themeRow("dark");

    row?.run?.();

    expect(setTheme).toHaveBeenCalledWith("light");
  });

  it("says which palette the press lands on, so the row is never ambiguous", () => {
    // A command is a thing that happens when you press it; the three-way choice — including
    // the one that follows the OS — is a setting, and the account menu is where it is drawn.
    expect(themeRow("light").row?.hint).toBe("to dark");
  });

  it("is reachable by the palette a reader is not currently in", () => {
    expect(themeRow("light").row?.keywords).toContain("dark");
    expect(themeRow("dark").row?.keywords).toContain("light");
  });
});

describe("the sign-out command", () => {
  it("ends the session", () => {
    const { context, signOut } = commandContext();

    const row = sessionCommands.list?.(context).find((action) => action.label === "Sign out");
    row?.run?.();

    expect(signOut).toHaveBeenCalled();
  });

  it("is reachable by the other name for it", () => {
    const { context } = commandContext();

    const row = sessionCommands.list?.(context).find((action) => action.label === "Sign out");

    expect(row?.keywords).toContain("log out");
  });

  it("sits with the theme command rather than among the screens", () => {
    const { context } = commandContext();

    for (const row of sessionCommands.list?.(context) ?? []) {
      expect(row.group).toBe(ACTIONS_GROUP);
    }
  });
});
