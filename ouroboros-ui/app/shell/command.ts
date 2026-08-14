import type { LucideIcon } from "lucide-react";

import type { ResolvedTheme, Theme } from "@/app/theme";

import type { NavEntry } from "./nav";

/**
 * The command palette's *model*: what an action is, what a source is, and how a query picks
 * between them ([#79](https://github.com/NobuData/ouroboros/issues/79)).
 *
 * This is the half of H.3 that holds no state and renders nothing —
 * `app/shell/command-registry.ts` is the registry sources write into,
 * `app/shell/command-sources.ts` seeds it with the ones the shell itself can offer, and
 * `app/shell/command-palette.tsx` draws whatever comes back. The split is `app/shell/nav.ts`'s,
 * for the same reason: every rule below is a pure function of a list somebody else owns, so
 * the matching can be tested without a registry, a DOM or a route.
 *
 * **Framework-free apart from three type imports**, all of which disappear at build time.
 * Nothing here reaches for `next/*` or React.
 *
 * ### The scope MVP ships, and the seam that keeps it honest
 *
 * The palette navigates and nothing else. That is the issue's own decision, and the reason is
 * in its problem statement: content search needs issue and run data that only partly exists,
 * so a search shipped now would be a search that finds nothing. What this file therefore has
 * to get right is not the searching but the **seam** — {@link CommandSource} has two halves,
 * and only one of them is used today:
 *
 * | | Answers | Called | Filtered by |
 * |---|---|---|---|
 * | {@link CommandSource.list} | synchronously, from what the shell already knows | on every keystroke | {@link matchCommandActions}, here |
 * | {@link CommandSource.find} | asynchronously, over the wire | debounced, abortable | the source itself |
 *
 * [#93](https://github.com/NobuData/ouroboros/issues/93) adds issues, runs and the queue by
 * registering a source with a `find`, and edits nothing in the palette. The asynchronous half
 * is plumbed and tested from the day it is declared — `__tests__/shell/use-command-actions.test.tsx`
 * exercises it through a fixture source — because a seam nothing has ever been passed through
 * is a seam that does not work yet and nobody has found out.
 */

/** What every action carries, whether or not it can be run. */
interface CommandActionBase {
  /**
   * Stable identifier, unique across every source's contribution.
   *
   * Prefixed by its source (`navigation:issues`), which is what keeps two sources naming the
   * same thing apart — the palette uses this as a React key and as the `aria-activedescendant`
   * target, and two rows sharing one id would be one row the keyboard cannot leave.
   */
  readonly id: string;
  /** The sentence the row shows, written as the thing pressing it does: *Go to Issues*. */
  readonly label: string;
  /** The heading its group is drawn under. Groups appear in the order they first occur. */
  readonly group: string;
  /** The lucide icon at the head of the row, from the same set the sidebar draws. */
  readonly icon?: LucideIcon;
  /** A quiet detail at the end of the row — what a press will settle on, where it leads. */
  readonly hint?: string;
  /**
   * Extra words a query may match, beyond the label.
   *
   * For the words a reader reaches for that the label does not contain: a route (`/issues`),
   * a synonym (*log out*), the spelling from another dialect (*color*). Scored **below** the
   * label, so a row named by the query outranks one merely tagged with it.
   */
  readonly keywords?: readonly string[];
}

/** An action the palette can carry out. */
export interface RunnableCommandAction extends CommandActionBase {
  /** What activating it does. The palette closes itself immediately afterwards. */
  readonly run: () => void;
  /** Never both — a runnable action has no reason to give. */
  readonly unavailable?: never;
}

/**
 * A row the palette lists but cannot activate, which says why instead.
 *
 * The design system's honesty rule (§ 3.5) is what makes this a shape rather than an
 * omission: ten of the eleven navigation destinations are screens nobody has built, and a
 * palette that simply dropped them would answer *Issues* with "no matches" — a claim that the
 * screen does not exist rather than the truth, which is that it is not built yet. So it is
 * listed, marked, and out of the keyboard's ring, exactly as the sidebar draws the same
 * entries (`app/shell/sidebar-nav.tsx`).
 */
export interface UnavailableCommandAction extends CommandActionBase {
  /** Never both — an unavailable action has nothing to run. */
  readonly run?: never;
  /** Why it cannot be run, in a sentence naming what it waits for. */
  readonly unavailable: string;
}

/**
 * One row of the palette.
 *
 * A union rather than two optional fields, so the compiler enforces the honesty rule instead
 * of a runtime assertion: an action either does something or says why it cannot, and there is
 * no way to write one that does neither.
 */
export type CommandAction = RunnableCommandAction | UnavailableCommandAction;

/**
 * What the shell knows and a source cannot ask for itself.
 *
 * A source is a plain object registered at module scope — the shape `app/shell/nav-modules.ts`
 * established — so it has no hooks and no access to the router, the theme engine or the
 * navigation registry. Those are handed to it here, once per render, by the palette.
 *
 * It is deliberately the shell's *capabilities* and not a bag of state: everything on it is
 * something a source might need in order to build an action's `run`, and nothing on it is
 * there to be displayed.
 */
export interface CommandContext {
  /**
   * The navigation entries this reader may see, in the sidebar's own order.
   *
   * Passed rather than read from `app/shell/nav-registry.ts` directly, even though that
   * singleton is reachable from anywhere: the palette subscribes to the registry and would
   * not re-render for a change a source read behind its back.
   */
  readonly nav: readonly NavEntry[];
  /**
   * Go to a route on this origin, without a full page load.
   *
   * @param route The path, rooted at `/`.
   */
  readonly navigate: (route: string) => void;
  /** The palette in force right now, with *system* already resolved against the OS. */
  readonly theme: ResolvedTheme;
  /**
   * Choose a palette, through the #17 engine.
   *
   * @param theme The choice.
   */
  readonly setTheme: (theme: Theme) => void;
  /** End the session. Redirects, so nothing runs after it. */
  readonly signOut: () => void;
}

/**
 * A contributor of actions.
 *
 * Both halves are optional and a source with neither is refused at registration — see
 * `app/shell/command-registry.ts` — because a source contributing nothing is a registration
 * that silently does nothing.
 */
export interface CommandSource {
  /** Stable identifier, unique across the registry, and the prefix its action ids carry. */
  readonly id: string;
  /**
   * Where this source's actions sit relative to other sources' — ascending, ties broken by
   * id. Registration order is import order and therefore a bundler's business, so a palette
   * that fell back to it would reorder itself between builds.
   */
  readonly sort: number;
  /**
   * The actions this source offers whatever is typed.
   *
   * Called on every keystroke and filtered by {@link matchCommandActions}, so it must be
   * cheap and must not fetch. It is the shape everything in MVP scope takes: the actions are
   * a function of what the shell already knows.
   *
   * @param context See {@link CommandContext}.
   * @returns The actions, in the order this source wants them ranked among equals.
   */
  readonly list?: (context: CommandContext) => readonly CommandAction[];
  /**
   * The actions this source finds for a query, over the wire.
   *
   * Called only for a non-empty query, **debounced** by the palette and handed an
   * `AbortSignal` that fires when the query moves on or the palette closes — so a source owns
   * the request and not the timing. Its results are **not** re-filtered here: a source that
   * searched has already decided what matches, and a second opinion from a matcher that never
   * saw the data would only remove rows.
   *
   * A rejection contributes nothing. Saying so is the source's own business, and the shape
   * for it is an {@link UnavailableCommandAction} carrying the reason — the only way the
   * palette can draw a failure without inventing copy about somebody else's service.
   *
   * @param query What the reader typed, trimmed and non-empty.
   * @param context See {@link CommandContext}.
   * @param signal Aborted when the answer is no longer wanted.
   * @returns The actions found.
   */
  readonly find?: (
    query: string,
    context: CommandContext,
    signal: AbortSignal,
  ) => Promise<readonly CommandAction[]>;
}

/** One heading and the actions under it. */
export interface CommandGroup {
  /** The heading, as the actions named it. */
  readonly name: string;
  /** Its actions, in the order they arrived. */
  readonly actions: readonly CommandAction[];
}

/** Points for a character matched at all. */
const CHARACTER_POINTS = 1;

/** Points added when a character continues the previous one — a contiguous run. */
const RUN_BONUS = 4;

/** Points added when a character starts a word, which is where a reader aims. */
const BOUNDARY_BONUS = 6;

/**
 * Points lost per character skipped between one match and the next.
 *
 * Without it the boundary bonus alone decides, and a query is answered by whichever text
 * happens to contain its letters at the front of *some* three words: `set` would rank
 * **Sign out — end the session** above **Settings**, which is the one ranking a reader would
 * call broken. A gap is what separates *the word I meant* from *three words that happen to
 * start with my letters*.
 */
const GAP_PENALTY = 1;

/**
 * Points added to a match found in the label rather than in a keyword.
 *
 * Large enough that any label match outranks any keyword match: a query is nearly always the
 * beginning of the name of the thing, and a row merely *tagged* with the word appearing above
 * one actually called it reads as the palette having misunderstood.
 */
const LABEL_BONUS = 1000;

/** What counts as the end of a word for {@link BOUNDARY_BONUS}. */
const SEPARATOR = /[^a-z0-9]/;

/**
 * How well a query matches a piece of text, as a subsequence.
 *
 * Subsequence rather than substring, which is what makes it *fuzzy* and is the behaviour a
 * palette is judged on: `gtd` reaches **Go to Dashboard**, and `iss` reaches **Go to Issues**
 * without the reader having to know the label starts with *Go*. Every character of the query
 * must appear, in order, and the score says how well they clustered:
 *
 * - a character that continues the previous one scores {@link RUN_BONUS}, so `dash` beats
 *   `dsh` on the same label;
 * - a character starting a word scores {@link BOUNDARY_BONUS}, so `gtd` — three initials —
 *   outranks an accidental scatter of the same three letters;
 * - every character skipped between two matches costs {@link GAP_PENALTY}, which is what
 *   keeps *the word I meant* ahead of *a sentence containing my letters*.
 *
 * **Greedy, and deliberately not optimal.** The first position a character can be matched at
 * is the one taken, so a text whose best alignment lies further along scores lower than an
 * exhaustive search would give it. The exhaustive version is a dynamic program over the two
 * lengths for a ranking nobody can see the difference in, against a list of a dozen rows.
 *
 * @param query The query, already trimmed and lowercased by {@link scoreCommandAction}.
 * @param text The text to match against.
 * @returns The score, higher being better, or `null` when the query is not a subsequence of
 *   the text at all. An empty query matches everything with a score of `0`, which is what
 *   makes the unfiltered palette the same code path as the filtered one.
 */
export function fuzzyScore(query: string, text: string): number | null {
  if (query === "") return 0;

  const haystack = text.toLowerCase();

  let score = 0;
  /** Where the next character may be looked for — one past the last one matched. */
  let from = 0;
  /** Where the last character was matched, so a run can be recognised. */
  let previous = -1;

  for (const character of query) {
    const at = haystack.indexOf(character, from);
    if (at < 0) return null;

    score += CHARACTER_POINTS;
    if (at === previous + 1) score += RUN_BONUS;
    if (at === 0 || SEPARATOR.test(haystack[at - 1])) score += BOUNDARY_BONUS;
    // Only between matches: how far into the text the *first* one sits is already spoken for
    // by the boundary bonus, and charging for it as well would rank a label by its length.
    if (previous >= 0) score -= GAP_PENALTY * (at - previous - 1);

    previous = at;
    from = at + 1;
  }

  return score;
}

/**
 * How well a query matches an action — its label, or failing that its keywords.
 *
 * @param query The query, trimmed and lowercased.
 * @param action The action.
 * @returns The score, or `null` when neither the label nor any keyword contains the query as
 *   a subsequence.
 */
export function scoreCommandAction(query: string, action: CommandAction): number | null {
  const label = fuzzyScore(query, action.label);
  if (label !== null) return label + LABEL_BONUS;

  let best: number | null = null;

  for (const keyword of action.keywords ?? []) {
    const score = fuzzyScore(query, keyword);
    if (score !== null && (best === null || score > best)) best = score;
  }

  return best;
}

/**
 * The actions a query matches, best first.
 *
 * @param query What the reader typed. Trimmed and lowercased here, once, rather than in the
 *   scorer — a query is compared against every action, and the palette re-runs this on every
 *   keystroke.
 * @param actions The actions to choose from, in the order their sources want them ranked
 *   among equals.
 * @returns A new array of the matches. **Ties keep the given order**, stated as an explicit
 *   comparison rather than left to the sort's stability, because that ordering is the whole
 *   of what a source's `sort` buys it.
 */
export function matchCommandActions(
  query: string,
  actions: readonly CommandAction[],
): CommandAction[] {
  const asked = query.trim().toLowerCase();

  const scored: { action: CommandAction; score: number; at: number }[] = [];

  actions.forEach((action, at) => {
    const score = scoreCommandAction(asked, action);
    if (score !== null) scored.push({ action, score, at });
  });

  scored.sort((left, right) => right.score - left.score || left.at - right.at);

  return scored.map((entry) => entry.action);
}

/**
 * The actions the keyboard may land on.
 *
 * The arrow ring walks these and not the rendered rows, which is the sidebar's rule for the
 * same reason (`app/shell/sidebar-nav.tsx`): a row that cannot be activated is a row Enter
 * would do nothing on, and stopping there teaches a reader that the palette is broken.
 *
 * @param actions The actions, matched and ordered.
 * @returns Those that can be run, in the same order.
 */
export function runnableCommandActions(
  actions: readonly CommandAction[],
): RunnableCommandAction[] {
  return actions.filter((action): action is RunnableCommandAction => action.run !== undefined);
}

/**
 * The actions gathered under their headings.
 *
 * Groups come out in the order they **first occur**, so the group order is decided by the
 * sources' own `sort` and by the ranking above rather than by a second list to keep in step
 * with either.
 *
 * @param actions The actions, matched and ordered.
 * @returns The groups. Empty in, empty out — the palette draws its own empty state.
 */
export function groupCommandActions(actions: readonly CommandAction[]): CommandGroup[] {
  const groups = new Map<string, CommandAction[]>();

  for (const action of actions) {
    const gathered = groups.get(action.group);
    if (gathered === undefined) groups.set(action.group, [action]);
    else gathered.push(action);
  }

  return [...groups].map(([name, gathered]) => ({ name, actions: gathered }));
}
