import { vi } from "vitest";

import type { CommandAction, CommandContext, CommandSource } from "@/app/shell/command";

/**
 * Fixtures for the command palette
 * ([#79](https://github.com/NobuData/ouroboros/issues/79)).
 *
 * Four suites need one — the matcher's rules, the registry's, the seeded sources' and the
 * palette's — and each cares about one or two fields of shapes that have six or seven. A
 * builder means a case names only what it is about, which is the reason `helpers/nav.ts`
 * exists for the sidebar.
 */

/** Distinguishes fixtures within a file, so two built without arguments do not collide. */
let serial = 0;

/** A context and the spies inside it, so a case can assert on what an action reached for. */
export interface ContextFixture {
  /** The context to hand to a source. */
  readonly context: CommandContext;
  /** Where a navigation action sent the browser. */
  readonly navigate: ReturnType<typeof vi.fn>;
  /** What a theme action chose. */
  readonly setTheme: ReturnType<typeof vi.fn>;
  /** Whether the session was ended. */
  readonly signOut: ReturnType<typeof vi.fn>;
}

/**
 * A {@link CommandContext} whose three capabilities are spies.
 *
 * @param overrides The fields this case is about — `nav` and `theme`, in practice.
 * @returns The context and its spies.
 */
export function commandContext(overrides: Partial<CommandContext> = {}): ContextFixture {
  const navigate = vi.fn();
  const setTheme = vi.fn();
  const signOut = vi.fn();

  return {
    context: { nav: [], navigate, theme: "light", setTheme, signOut, ...overrides },
    navigate,
    setTheme,
    signOut,
  };
}

/**
 * A runnable action, with everything the caller did not specify filled in plausibly.
 *
 * @param overrides The fields this case is about.
 * @returns A complete {@link CommandAction}.
 */
export function commandAction(overrides: Partial<CommandAction> = {}): CommandAction {
  serial += 1;

  return {
    id: `fixture:${serial}`,
    label: `Fixture ${serial}`,
    group: "Fixtures",
    run: () => {},
    ...overrides,
  } as CommandAction;
}

/**
 * A source, with everything the caller did not specify filled in plausibly.
 *
 * The default `sort` climbs past the seeded sources' (which stop at 20), so a fixture lands
 * after them unless a case says otherwise — which is what a module registering itself later
 * would do.
 *
 * @param overrides The fields this case is about.
 * @returns A complete {@link CommandSource}.
 */
export function commandSource(overrides: Partial<CommandSource> = {}): CommandSource {
  serial += 1;

  return {
    id: `fixture-${serial}`,
    sort: 100 + serial,
    list: () => [],
    ...overrides,
  };
}
