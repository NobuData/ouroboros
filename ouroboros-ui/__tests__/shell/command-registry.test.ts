import { afterEach, describe, expect, it, vi } from "vitest";

import { commandSource } from "../helpers/command";
import {
  commandSources,
  registerCommandSource,
  subscribeCommandSources,
} from "@/app/shell/command-registry";

/**
 * The registry the palette draws from
 * ([#79](https://github.com/NobuData/ouroboros/issues/79)).
 *
 * It is the acceptance criterion *"the action registry API is documented for #93 to extend"*
 * held to by assertion rather than by prose: a source registers, the snapshot it lands in is
 * ordered and stable, and removing it puts the registry back exactly as it was — which is what
 * makes adding content search a change in one new file.
 *
 * Every case cleans up after itself through the remover `registerCommandSource` hands back.
 * There is no reset hook, deliberately, for the reason `nav-registry.test.ts` gives: a hook
 * production never calls is a hook that can drift from the code that does.
 */

/** The removers this case registered, run after it whatever it asserted. */
const cleanup: (() => void)[] = [];

/**
 * Register a source and remember how to take it away again.
 *
 * @param source The source.
 * @returns Nothing — the remover is the suite's business, not the case's.
 */
function register(source: Parameters<typeof registerCommandSource>[0]): void {
  cleanup.push(registerCommandSource(source));
}

afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.();
});

describe("registering a source", () => {
  it("puts it in the snapshot", () => {
    const source = commandSource({ id: "fixture-registered" });

    register(source);

    expect(commandSources().map((entry) => entry.id)).toContain("fixture-registered");
  });

  it("hands back the way to remove it", () => {
    const remove = registerCommandSource(commandSource({ id: "fixture-removable" }));

    remove();

    expect(commandSources().map((entry) => entry.id)).not.toContain("fixture-removable");
  });

  it("ignores a remover called twice", () => {
    const remove = registerCommandSource(commandSource({ id: "fixture-twice" }));
    remove();
    register(commandSource({ id: "fixture-twice" }));

    remove();

    // The second call must not take away whatever replaced it — the remover is tied to the
    // registration it came from, by identity rather than by id.
    expect(commandSources().map((entry) => entry.id)).toContain("fixture-twice");
  });

  it("replaces a source registered under the same id, which is what a hot reload does", () => {
    register(commandSource({ id: "fixture-reloaded", sort: 200 }));
    register(commandSource({ id: "fixture-reloaded", sort: 201 }));

    const found = commandSources().filter((entry) => entry.id === "fixture-reloaded");

    expect(found).toHaveLength(1);
    expect(found[0].sort).toBe(201);
  });

  it("copies what it stored, so a later edit cannot change the palette", () => {
    const source = { id: "fixture-copied", sort: 300, list: () => [] };

    register(source);
    source.sort = 301;

    expect(commandSources().find((entry) => entry.id === "fixture-copied")?.sort).toBe(300);
  });
});

describe("what it refuses", () => {
  it("refuses a source with no id", () => {
    expect(() => registerCommandSource(commandSource({ id: "" }))).toThrow(/needs an id/);
  });

  it("refuses a sort it cannot order by", () => {
    expect(() => registerCommandSource(commandSource({ sort: Number.NaN }))).toThrow(
      /finite sort/,
    );
  });

  it("refuses a source that contributes nothing", () => {
    // Neither half means a registration that silently does nothing, which is a set of
    // commands missing from the palette with nothing anywhere saying why.
    expect(() => registerCommandSource({ id: "fixture-empty", sort: 400 })).toThrow(
      /neither a list nor a find/,
    );
  });
});

describe("the snapshot", () => {
  it("orders sources by sort, then by id", () => {
    register(commandSource({ id: "later", sort: 500 }));
    register(commandSource({ id: "earlier", sort: 500 }));
    register(commandSource({ id: "first", sort: 499 }));

    const order = commandSources()
      .map((entry) => entry.id)
      .filter((id) => ["first", "earlier", "later"].includes(id));

    // Never registration order, which is import order and therefore a bundler's business: a
    // palette that reordered itself between builds is one nobody could learn.
    expect(order).toEqual(["first", "earlier", "later"]);
  });

  it("keeps its identity until something changes", () => {
    // Which is not an optimisation but `useSyncExternalStore`'s contract: a freshly built
    // array per read would re-render forever.
    expect(commandSources()).toBe(commandSources());
  });

  it("replaces its identity when something does", () => {
    const before = commandSources();

    register(commandSource());

    expect(commandSources()).not.toBe(before);
  });

  it("is frozen, so a caller cannot reorder the palette by sorting what it was handed", () => {
    expect(Object.isFrozen(commandSources())).toBe(true);
  });
});

describe("subscribing", () => {
  it("hears about a registration", () => {
    const listener = vi.fn();
    const stop = subscribeCommandSources(listener);

    register(commandSource());
    stop();

    expect(listener).toHaveBeenCalled();
  });

  it("stops when told to", () => {
    const listener = vi.fn();
    subscribeCommandSources(listener)();

    register(commandSource());

    expect(listener).not.toHaveBeenCalled();
  });
});
