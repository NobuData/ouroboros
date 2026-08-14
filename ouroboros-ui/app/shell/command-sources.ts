import { LogOut, Moon, Sun } from "lucide-react";

import type { CommandAction, CommandContext, CommandSource } from "./command";
import { registerCommandSource } from "./command-registry";
import { type NavEntry, navStatus } from "./nav";

/**
 * The sources the shell itself can offer, registering themselves at load
 * ([#79](https://github.com/NobuData/ouroboros/issues/79)).
 *
 * This file is the *seed*, not the mechanism — `app/shell/nav-modules.ts` is the same file for
 * the sidebar, and the same sentence applies: `app/shell/command-registry.ts` is the registry
 * and `app/shell/command-palette.tsx` renders whatever is in it, so a surface arriving later
 * registers its own source from its own directory and touches nothing here.
 *
 * What these two have in common is only that they are the shell's own: every action below is
 * something the shell can already do, which is exactly the scope H.3 decided on — *navigation
 * only*, because content search needs data that does not exist yet
 * ([#93](https://github.com/NobuData/ouroboros/issues/93) adds it, and adds it as a third
 * source).
 */

/** The heading the navigation actions are drawn under. */
export const NAVIGATION_GROUP = "Navigation";

/** The heading the shell's own commands are drawn under. */
export const ACTIONS_GROUP = "Actions";

/**
 * One navigation entry, as a palette row.
 *
 * The live/soon split is the sidebar's, drawn through the palette's own honesty pair: a built
 * route becomes an action that navigates, and an unbuilt one becomes a row carrying the note
 * that names the issue building it. The alternative — listing only the one built screen —
 * would answer *Issues* with "no matches", which reads as *there is no such screen* rather
 * than *it is not built yet*.
 *
 * @param entry The registered entry.
 * @param context See {@link CommandContext}.
 * @returns The row.
 */
function navigationAction(entry: NavEntry, context: CommandContext): CommandAction {
  const row = {
    id: `navigation:${entry.id}`,
    // "Go to Issues" rather than "Issues", so the row says what pressing it does and reads
    // the same way in a list beside "Sign out" — the mockup's own phrasing (§ H.3's sketch).
    label: `Go to ${entry.label}`,
    group: NAVIGATION_GROUP,
    icon: entry.icon,
    // The route, for the reader who types `/issues` because that is what they know the screen
    // by. The label already carries the name, so nothing else needs repeating here.
    keywords: [entry.route],
  } as const;

  return navStatus(entry) === "soon"
    ? {
        ...row,
        // The registry refuses a `soon` entry with no note (`app/shell/nav-registry.ts`), so
        // the fallback is unreachable; it exists because the entry type pairs `status` and
        // `soonNote` by assertion rather than by union, and cannot say so to the compiler.
        unavailable: entry.soonNote ?? `${entry.label} is not built yet.`,
      }
    : { ...row, run: () => context.navigate(entry.route) };
}

/**
 * The product's screens, from the sidebar's own registry.
 *
 * It reads `context.nav` rather than `navRegistry()` for the reason `CommandContext` gives:
 * the palette subscribes to the registry, and a source reading it behind the palette's back
 * would show a list that stops changing when the registry does.
 */
export const navigationCommands: CommandSource = {
  id: "navigation",
  sort: 10,
  list: (context) => context.nav.map((entry) => navigationAction(entry, context)),
};

/**
 * The two things the shell can do that are not going somewhere: the palette, and the session.
 *
 * **The theme action toggles between the two explicit palettes and does not offer *system*.**
 * That is the issue's own wording ("theme toggle") and it is the honest reading of a palette
 * row: a command is a thing that happens when you press it, and the three-way choice —
 * including the one that follows the OS — is a *setting*, which the account menu draws as
 * three radios because a menu row has room to show which is on. The hint says which palette
 * the press lands on, so the row is never ambiguous about what it is about to do.
 */
export const sessionCommands: CommandSource = {
  id: "session",
  sort: 20,
  list(context) {
    /** The palette a press would move to — the opposite of whatever is on the screen now. */
    const next = context.theme === "dark" ? "light" : "dark";

    return [
      {
        id: "session:theme",
        label: "Toggle theme",
        group: ACTIONS_GROUP,
        icon: next === "dark" ? Moon : Sun,
        hint: `to ${next}`,
        // Both spellings of the word, and both palettes by name: a reader typing "dark"
        // means this row whichever palette they are currently in.
        keywords: ["dark", "light", "appearance", "colour", "color"],
        run: () => context.setTheme(next),
      },
      {
        id: "session:sign-out",
        label: "Sign out",
        group: ACTIONS_GROUP,
        icon: LogOut,
        keywords: ["log out", "logout", "leave", "session", "exit"],
        run: context.signOut,
      },
    ];
  },
};

/** The shell's own sources, in the order they are registered. */
export const SEEDED_COMMAND_SOURCES: readonly CommandSource[] = [
  navigationCommands,
  sessionCommands,
];

/**
 * The registrations themselves, run once when this module is first imported — which is what
 * "sources register themselves at load" means, and why `command-palette.tsx` imports this file
 * for its effect rather than for a value.
 *
 * Re-running it is harmless: registration replaces by id, so a hot reload re-seeds rather than
 * doubling the palette.
 */
for (const source of SEEDED_COMMAND_SOURCES) registerCommandSource(source);
