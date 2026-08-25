/**
 * Every decision the routing matrix makes, as functions with inputs and outputs.
 *
 * The matrix ([#201](https://github.com/NobuData/ouroboros/issues/201)) is mockup 06's
 * densest region — eight rows, each carrying two levels of type across two model columns, a
 * rule summary and two figures — and almost none of that density is markup. Which hop is the
 * primary, what a resolution line says when its alias has no provider, which rules touch a
 * row, and what a cell prints when nobody measured the number are all *judgements*, and they
 * live here so each one's acceptance criteria are a unit test on a small object rather than
 * an assertion about rendered text.
 *
 * **Framework-free and pure**, like `app/models/view.ts` beside it: nothing here imports
 * React, `next/*` or the server-only client. The read is `app/models/data.ts`'s and the
 * drawing is `app/models/routing-matrix.tsx`'s.
 *
 * ### The three ways a matrix like this lies, and what stops each
 *
 * 1. **It prints a figure nobody measured.** Roadmap decision **M7**: `costCentsPerRunAvg`
 *    and `latencyP50Ms` are `null` exactly when the ledger holds nothing to average or take
 *    a median of, and {@link costCell} and {@link latencyCell} render {@link EM_DASH} for
 *    that rather than a zero. A workspace that has run nothing has not spent `$0.00` per
 *    run — and `0.0s` is an excellent latency for a call nobody made. Half this matrix's
 *    cells can legitimately be empty, so the em-dash is the ordinary case, not the edge one.
 * 2. **It composes its own sentence about a rule.** The escalation summaries are the
 *    database's generated `display` strings (V018), passed through by {@link escalationFor}
 *    and never assembled here. That is what makes *the matrix and the rules card cannot
 *    disagree* a property of the schema rather than a promise two components make apart.
 * 3. **It hides a row it has nothing to say about.** A task kind with no route is a legal
 *    state the contract publishes on purpose, and {@link matrixRows} draws it with empty
 *    cells — hiding it would hide the very kind somebody opened this page to configure.
 *
 * ### Which rules a row shows
 *
 * A rule is drawn on the row **it names**: `use_alias` and `add_vote` both carry a
 * `task_kind`, and that kind's row is where the sentence belongs. `route_local` carries
 * none — the server's own `targetTaskKind()` returns null for it, meaning *every* kind — and
 * it is deliberately **not** repeated across all eight rows. A workspace-wide rule is a fact
 * about the workspace rather than about a task kind, it belongs to the **ESCALATION RULES**
 * card (AA.5, [#204](https://github.com/NobuData/ouroboros/issues/204)), and eight copies of
 * one sentence would drown the two summaries that really are per-row. The em-dash in this
 * column therefore means *no rule names this kind*, which is the question the column is
 * answering.
 *
 * **Disabled rules are excluded.** The column describes what routing does, and a rule whose
 * switch is off does nothing; the card is where a disabled rule keeps its place, its sentence
 * and its switch. Drawing it here would claim an escalation that cannot fire.
 */

import type {
  EscalationRule,
  Route,
  RouteHop,
  RouteStats,
  RoutingTaskKind,
} from "@/app/api/routing";
import { latencyOfMs, moneyOfCents } from "@/app/format";

// The separator the health strip's composed lines already use, imported rather than typed
// again: two constants holding `" · "` are two things that can come to differ, on one page
// where every composed line is meant to read as one product's.
import { SEPARATOR } from "./view";

/* ------------------------------------------------------------------ what an absence reads as */

/**
 * What a cell prints when there is nothing to print — the mockup's own `—`.
 *
 * An em-dash rather than an empty cell, and one shared constant rather than a character
 * typed into four components: a blank cell reads as a rendering bug, and the row's rhythm
 * and the column's alignment both depend on every cell having *something* in it.
 */
export const EM_DASH = "—";

/**
 * What a resolution line says where the provider would be, for an alias with no provider
 * bound yet.
 *
 * The hop keeps its place in the chain (the contract insists on it), so the cell is drawn
 * either way; what it must not do is print the model as though it were reachable. This is
 * the registry's `gpt5-experiments` case — a name created ahead of its key — seen from the
 * routing side.
 */
export const NO_PROVIDER = "no provider";

/* ------------------------------------------------------------------ the alias cells */

/**
 * One of the two model columns: the alias pill, and the resolution line under it.
 *
 * Two fields rather than one composed string, because they are two levels of type in the
 * mockup and two different claims: the alias is what the route *names*, and the resolution
 * is what that name currently *means*. A route points at aliases and never at raw model ids
 * (decision M1), so the pill is the stable half and the line beneath it is the half that
 * moves when the registry does.
 */
export interface AliasCell {
  /** The alias the hop names — `coder-max`. The pill. */
  readonly alias: string;
  /** What it resolves to — `claude-fable-5 · Anthropic`. The dim line beneath. */
  readonly resolution: string;
}

/**
 * One hop, as a cell.
 *
 * @param hop The hop, from the route's chain.
 * @returns The pill and its resolution line. An unbound alias resolves to its model and
 *   {@link NO_PROVIDER} rather than to the model alone — a line that stopped at the model id
 *   would read exactly like a bound one.
 */
export function aliasCell(hop: RouteHop): AliasCell {
  return {
    alias: hop.alias,
    resolution: `${hop.modelId}${SEPARATOR}${hop.provider?.displayName ?? NO_PROVIDER}`,
  };
}

/** Where the primary sits in a chain. Dense from 1 by database constraint. */
const PRIMARY_POSITION = 1;

/** Where the first fallback sits — the one hop of the chain this matrix has a column for. */
const FALLBACK_POSITION = 2;

/**
 * The hop at one position, or `null` when the chain does not reach that far.
 *
 * Found by `position` rather than by array index, deliberately. The index would be right for
 * every payload the service sends today and wrong the moment one arrived in another order,
 * and *which hop is the primary* is exactly the fact this matrix must not get wrong.
 *
 * @param route The route, or `null` for a task kind that has none.
 * @param position Which hop — 1 is the primary.
 * @returns The hop, or `null`.
 */
export function hopAt(route: Route | null, position: number): RouteHop | null {
  return route?.hops.find((hop) => hop.position === position) ?? null;
}

/* ------------------------------------------------------------------ the escalation column */

/**
 * The task kind a rule names, or `null` for one that names none.
 *
 * The same three-shape discrimination the service performs (`routing/rules.ts`), because the
 * `then` document is a closed union of exactly three actions and both of the ones that
 * modify a single kind carry it in the same field name.
 *
 * @param rule The rule.
 * @returns The kind's name, or `null` for `route_local`, which modifies every kind and is
 *   therefore drawn on none — see this module's note.
 */
export function ruleTaskKind(rule: EscalationRule): string | null {
  const then = rule.then;

  if ("use_alias" in then) return then.use_alias.task_kind;

  return "add_vote" in then ? then.add_vote.task_kind : null;
}

/**
 * The sentences one row's escalation cell prints.
 *
 * @param rules Every rule in the workspace, enabled and disabled alike, in evaluation order.
 * @param taskKind The row's kind.
 * @returns The `display` strings of the enabled rules naming this kind, in the order they
 *   are evaluated in. Empty for a row no rule names — the cell draws {@link EM_DASH}.
 */
export function escalationFor(
  rules: readonly EscalationRule[],
  taskKind: string,
): readonly string[] {
  return rules
    .filter((rule) => rule.enabled && ruleTaskKind(rule) === taskKind)
    .map((rule) => rule.display);
}

/* ------------------------------------------------------------------ the numeric columns */

/**
 * The `$/run avg` cell.
 *
 * **A zero is drawn and a null is not**, which is the whole of decision M7 in one function.
 * `costCentsPerRunAvg: 0` is calls that were priced, at nothing — a `docs` pass on a model
 * running on hardware the workspace already owns — and `$0.00` is the truth about them.
 * `null` is nobody priced these calls, and no amount of money is the truth about that.
 *
 * @param stats The row's measured figures, or `null` for a kind with no route to measure.
 * @returns The amount, or {@link EM_DASH}.
 */
export function costCell(stats: RouteStats | null): string {
  const cents = stats?.costCentsPerRunAvg;
  return cents === null || cents === undefined ? EM_DASH : moneyOfCents(cents);
}

/**
 * The `p50 latency` cell.
 *
 * @param stats The row's measured figures, or `null` for a kind with no route to measure.
 * @returns The duration, or {@link EM_DASH}.
 */
export function latencyCell(stats: RouteStats | null): string {
  const ms = stats?.latencyP50Ms;
  return ms === null || ms === undefined ? EM_DASH : latencyOfMs(ms);
}

/* ------------------------------------------------------------------ the row */

/** One row of the matrix, decided. */
export interface MatrixRow {
  /**
   * The task kind's name — the mono label, the React key, and what the URL carries.
   *
   * A workspace's own list rather than a fixed vocabulary, so it is a string rather than a
   * union; it is unique per workspace, which is what lets it be the row's identity.
   */
  readonly kind: string;
  /** The grey line under the name. */
  readonly description: string;
  /**
   * The route's tag chip — `implement-primary` — or `null` for a kind with no route.
   *
   * The route's own value rather than something derived from the kind: `test-gen` tags
   * `testgen-primary`, and a client that composed the tag would print a name the service
   * does not answer to.
   */
  readonly tag: string | null;
  /** The **Primary model** cell, or `null` when there is no route. */
  readonly primary: AliasCell | null;
  /** The **Fallback** cell, or `null` when the chain is one hop long or there is no route. */
  readonly fallback: AliasCell | null;
  /** The enabled rules naming this kind, as the database's own sentences. */
  readonly escalation: readonly string[];
  /** The `$/run avg` cell, already an amount or an em-dash. */
  readonly cost: string;
  /** The `p50 latency` cell, already a duration or an em-dash. */
  readonly latency: string;
}

/**
 * The matrix, decided row by row.
 *
 * **The server's order is kept.** `taskKinds` arrives in the order the matrix draws them and
 * `sortOrder` is carried on each row for AA.3 ([#202](https://github.com/NobuData/ouroboros/issues/202))
 * to reorder by; sorting again here would be a second opinion about row order, and the two
 * would differ the first time two kinds shared a `sortOrder`.
 *
 * @param taskKinds Every task kind, in the order to draw them.
 * @param rules Every escalation rule in the workspace.
 * @returns One row per kind, every cell already a string or a small object — nothing left
 *   for the component to decide.
 */
export function matrixRows(
  taskKinds: readonly RoutingTaskKind[],
  rules: readonly EscalationRule[],
): readonly MatrixRow[] {
  return taskKinds.map((kind) => {
    const route = kind.route;
    const primary = hopAt(route, PRIMARY_POSITION);
    const fallback = hopAt(route, FALLBACK_POSITION);

    return {
      kind: kind.name,
      description: kind.description,
      tag: route?.tag ?? null,
      primary: primary === null ? null : aliasCell(primary),
      fallback: fallback === null ? null : aliasCell(fallback),
      escalation: escalationFor(rules, kind.name),
      cost: costCell(route?.stats ?? null),
      latency: latencyCell(route?.stats ?? null),
    };
  });
}

/* ------------------------------------------------------------------ the selection */

/**
 * The search parameter the selected row is reflected in — `/models?route=implement`.
 *
 * The **task kind** rather than the route's id or its tag: a kind is what the row *is*, it is
 * stable across a route being deleted and written again, and it is the one identifier a
 * person could type. A uuid in the URL would survive a reload just as well and tell whoever
 * read it nothing.
 */
export const ROUTE_PARAM = "route";

/**
 * Which row a URL asks for, if the matrix has it.
 *
 * A URL is input, and this is the validation: a `?route=` naming a kind this workspace does
 * not have selects nothing rather than putting a name nobody can act on into the inspector's
 * title. `null` and an unknown name are the same answer deliberately — both mean *no row is
 * selected*, which is the state the page opens in.
 *
 * @param rows The matrix's rows.
 * @param requested What the URL carried, or `null` when it carried nothing. An array — which
 *   is what a repeated parameter produces — is refused for the same reason: two answers to
 *   *which row* is not an answer.
 * @returns The task kind to select, or `null`.
 */
export function selectedKind(
  rows: readonly MatrixRow[],
  requested: string | string[] | undefined | null,
): string | null {
  if (typeof requested !== "string") return null;

  return rows.some((row) => row.kind === requested) ? requested : null;
}

/**
 * What is announced when the selection moves.
 *
 * A sentence rather than the bare kind, because it is read out of context: a live region
 * that said only *implement* would leave the reader to guess whether a row had been
 * selected, a filter applied or a run started.
 *
 * @param kind The selected task kind.
 * @returns The announcement.
 */
export function selectionAnnouncement(kind: string): string {
  return `${kind} route selected.`;
}

/* ------------------------------------------------------------------ the copy */

/** The card's title, as mockup 06 sets it. */
export const MATRIX_TITLE = "Routing matrix";

/**
 * The count chip beside the title — the mockup's `8 task kinds`.
 *
 * Computed rather than written down, so a workspace with a different list of kinds gets a
 * true count instead of the seeded one.
 *
 * @param count How many rows the matrix has.
 * @returns The chip's label, singular where the count is one.
 */
export function taskKindCount(count: number): string {
  return `${count} task kind${count === 1 ? "" : "s"}`;
}

/**
 * The table's accessible name.
 *
 * The card's heading names the *card*; a table inside it needs its own name for a reader
 * moving by table rather than by landmark, and this one says what its rows are.
 */
export const MATRIX_CAPTION = "Task kinds and the routes they resolve through";

/**
 * The hint the mockup prints in the card head — *"drag ⠿ to reorder fallback chains"* — as
 * an honest one.
 *
 * The handle column is drawn (AA.3 wires it), so the hint has to say what the handle does
 * *today*, which is nothing. Naming the issue is what makes it a usable answer to *when?*
 * rather than the word *soon* — the same treatment the sidebar gives an unbuilt module
 * (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.5).
 *
 * It is the handle's `title` as well as the card head's line — one sentence, so a reader who
 * hovers a handle and a reader who reads the head are told the same thing.
 */
export const REORDER_HINT = "Reordering fallback chains arrives with #202.";

/** What the matrix says to a workspace whose routing foundations have not been seeded. */
export const NO_KINDS_TITLE = "No task kinds are configured";

/** …and what to do about it, without pretending this page is where it is done. */
export const NO_KINDS_NOTE =
  "Routing resolves a task kind to a chain of aliases, so a workspace with no kinds has " +
  "nothing to route. Seeding the foundations and guiding a fresh workspace through them " +
  "arrives with #205.";

/** What the matrix says when the read behind it was refused. */
export const MATRIX_FAILED_TITLE = "The routing matrix could not be read";

/* ------------------------------------------------------------------ the inspector's seat */

/**
 * The inspector card's title while nothing is selected.
 *
 * The mockup's is `ROUTE — implement-primary`, which is a title about the selected row; with
 * no row selected there is no tag to name, and a card headed `ROUTE — ` would be a heading
 * with a hole in it.
 */
export const INSPECTOR_TITLE = "Route";

/**
 * The inspector card's title for a selected row.
 *
 * @param tag The route's tag, or `null` for a selected kind that has no route.
 * @returns The mockup's `ROUTE — implement-primary`, or the bare title where there is no tag
 *   to name.
 */
export function inspectorTitle(tag: string | null): string {
  return tag === null ? INSPECTOR_TITLE : `${INSPECTOR_TITLE} — ${tag}`;
}

/** What the inspector's seat says before a row has been chosen. */
export const INSPECTOR_EMPTY_TITLE = "Select a route";

/** …and how to choose one, naming both ways in. */
export const INSPECTOR_EMPTY_NOTE =
  "Choose a row in the routing matrix — click it, or move through the rows with the arrow " +
  "keys — and its route appears here.";

/**
 * What the seat says once a row *is* chosen: which route it is holding, and that the panel
 * itself is not built.
 *
 * The selection is real, is reflected in the URL and survives a reload; the chain, the policy
 * switches and the cost cap it will be read against are AA.4's
 * ([#203](https://github.com/NobuData/ouroboros/issues/203)). Drawing an invented chain here
 * would be indistinguishable, in a screenshot, from the real one AA.4 ships.
 *
 * @param kind The selected task kind.
 * @returns The sentence.
 */
export function inspectorNote(kind: string): string {
  return (
    `The chain, policy switches and cost cap for ${kind} arrive with the route inspector ` +
    "(#203). The selection is live: it is in this page's address, so a reload keeps it."
  );
}
