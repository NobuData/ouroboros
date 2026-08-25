/**
 * Every decision chain editing makes, as functions with inputs and outputs.
 *
 * AA.3 ([#202](https://github.com/NobuData/ouroboros/issues/202)) is the first thing on
 * `/models` that can *change* a route, and the ticket is mostly about the states that creates:
 * what *2 routes changed* counts, what **Discard** restores to, which edits are refused before
 * they are made, and how a server that refused a batch names the row it refused. Every one of
 * those is a judgement over a small object, and they live here so each acceptance criterion is
 * a unit test rather than an assertion about a drag.
 *
 * **Framework-free and pure**, like `app/models/matrix.ts` and `app/models/rules.ts` beside it:
 * nothing here imports React, `next/*` or the server-only client. The state is
 * `app/models/route-editor.tsx`'s, the write is `app/models/route-actions.ts`'s, and the
 * drawing is `app/models/chain-editor.tsx`'s. The result types those exchange live here rather
 * than beside the action, because a `"use server"` module may export nothing but async
 * functions.
 *
 * ### Edits are staged, and the staging is a diff
 *
 * The mockup's **Save routes** is a batch commit, so the editor holds *edits* rather than a
 * second copy of the matrix: a draft per changed route, and nothing for a route nobody touched.
 * That is what makes three of the ticket's states structural rather than bookkept —
 *
 * - *N routes changed* is the number of drafts that differ from what the server holds
 *   ({@link sameChain}); a hop dragged away and dragged back is not a change.
 * - **Discard** is the empty set of edits, so it restores the last saved state *exactly*,
 *   because the saved state was never modified — it is the baseline every draft is measured
 *   against, and the policy edits AA.4
 *   ([#203](https://github.com/NobuData/ouroboros/issues/203)) makes on the same draft are
 *   discarded by the same emptying.
 * - The batch **Save routes** sends is the drafts and only the drafts ({@link toSaveInput}),
 *   so a route nobody edited is a route the server is not asked to rewrite — and cannot
 *   refuse.
 *
 * ### Refusals are decided before the edit, not after
 *
 * A chain that would be empty and a chain shorter than its floor are the two states the
 * contract refuses (`RoutePolicy`'s `hops` is never empty; `floorHopIndex` is measured against
 * the chain in the same body). {@link removalReason} decides both from the draft alone, which
 * is what lets the control be inert *with its reason* rather than a press that is answered
 * with a `422`. The server still checks — a check in the browser is a check anybody can skip —
 * and {@link batchProblems} is what reads its answer back into the matrix, keyed by task kind
 * exactly as `details.routes` is.
 */

import type { RoutingTaskKind, SaveRouteInput } from "@/app/api/routing";

import { type AliasCell, type MatrixRow, aliasCell } from "./matrix";

/* ------------------------------------------------------------------ the draft */

/**
 * One hop as the editor holds it: the alias, what it resolves to, and the operator's note.
 *
 * `resolution` is carried rather than looked up, because the two places a hop comes from —
 * the saved chain and the registry list a swap menu offers — both already know it, and the
 * matrix's cell for a changed route is drawn from the draft. A hop that had to look its
 * resolution up would need the registry read before the matrix could redraw.
 */
export interface DraftHop {
  /**
   * The hop's identity while it is being edited — the React key and the element focus is
   * kept on across a move.
   *
   * Not the position: a hop that is dragged from 2 to 3 is the same hop at a new position,
   * and a key that was the position would remount every hop below it on every move, taking
   * focus with it. {@link savedRoute} derives it from the saved position, so the same hop has
   * the same id on the server render and after hydration.
   */
  readonly id: string;
  /** The alias the hop names — `coder-max`. */
  readonly alias: string;
  /** What it resolves to — `claude-fable-5 · Anthropic Claude`. The matrix's own line. */
  readonly resolution: string;
  /** The inspector's hop-meta line, or `null` for a hop with none. */
  readonly note: string | null;
  /**
   * The connection the alias is bound to, or `null` for an alias bound to none.
   *
   * Carried so the inspector can draw the hop's health dot (AA.4,
   * [#203](https://github.com/NobuData/ouroboros/issues/203)) by looking the connection up
   * in the strip's own read, rather than by carrying a status of its own — `RouteHop.provider`
   * publishes no status, and the contract says why. Not sent: nothing about where an alias
   * runs is the client's to say.
   */
  readonly providerId: string | null;
}

/**
 * An alias as the swap and add menus offer it: the matrix's cell, plus the connection it runs
 * on — what a hop made from it needs to carry.
 *
 * The registry list (`app/models/rules.ts`'s `ruleTarget`) produces these, so a hop picked
 * from a menu knows its connection exactly as a saved hop does.
 */
export interface HopTarget extends AliasCell {
  /** The connection's id, or `null` for an alias bound to no provider. */
  readonly providerId: string | null;
}

/**
 * One route as the editor holds it: its chain, and the policy triple the contract requires
 * beside it.
 *
 * The policy fields are the inspector's controls (AA.4,
 * [#203](https://github.com/NobuData/ouroboros/issues/203)) and are edited *here*, on this
 * draft, by {@link setAllowLocal}, {@link setFloor} and {@link setMaxCost} — which is how a
 * policy edit joins the same dirty batch as a chain edit and commits with the same **Save
 * routes**. `PUT /api/v1/routing/routes` has no leave-this-alone case, so a chain edit sends
 * the floor and the cap it did not touch, and a policy edit sends the chain.
 */
export interface ChainDraft {
  /** The task kind — the matrix row's identity, and the batch entry's key. */
  readonly kind: string;
  /** The route's tag — `implement-primary` — for the inspector's title. */
  readonly tag: string;
  /** The chain, primary first. Never empty on a draft that can be saved. */
  readonly hops: readonly DraftHop[];
  /** Mockup 06's **Allow fallback to local models**. */
  readonly allowLocalFallback: boolean;
  /** The deepest hop the route may run on, 1-based, or `null` for no floor. */
  readonly floorHopIndex: number | null;
  /** The cap in integer cents, or `null` for no cap. */
  readonly maxCostCentsPerRun: number | null;
}

/**
 * What the server holds for one route — the baseline every draft is measured against.
 *
 * The same shape as a draft on purpose: **Discard** is *the draft becomes this again*, and a
 * second type would need a conversion in both directions that could disagree.
 */
export type SavedRoute = ChainDraft;

/**
 * A hop's id on the server render, from its saved position.
 *
 * @param kind The route's task kind.
 * @param position The hop's saved position, from 1.
 * @returns The id.
 */
function savedHopId(kind: string, position: number): string {
  return `${kind}:${position.toString()}`;
}

/**
 * A hop's id when it is added in the browser.
 *
 * Distinct from every saved id by its prefix, so an added hop can never collide with a saved
 * one however many times the chain is saved and reloaded.
 *
 * @param kind The route's task kind.
 * @param serial A number the editor has not used before for this page.
 * @returns The id.
 */
export function addedHopId(kind: string, serial: number): string {
  return `${kind}:+${serial.toString()}`;
}

/**
 * One matrix row's route, as the editor's baseline — or `null` for a kind with no route.
 *
 * @param kind The row, from `GET /api/v1/routing`.
 * @returns The saved route, its hops in position order, or `null`.
 */
export function savedRoute(kind: RoutingTaskKind): SavedRoute | null {
  const route = kind.route;
  if (route === null) return null;

  return {
    kind: kind.name,
    tag: route.tag,
    hops: [...route.hops]
      .sort((a, b) => a.position - b.position)
      .map((hop) => ({
        id: savedHopId(kind.name, hop.position),
        alias: hop.alias,
        resolution: aliasCell(hop).resolution,
        note: hop.note,
        providerId: hop.provider?.id ?? null,
      })),
    allowLocalFallback: route.allowLocalFallback,
    floorHopIndex: route.floorHopIndex,
    maxCostCentsPerRun: route.maxCostCentsPerRun,
  };
}

/**
 * Every route the matrix holds, as the editor's baseline.
 *
 * Kinds with no route are left out rather than carried as empty drafts: there is no chain to
 * edit, and `PUT /api/v1/routing/routes` refuses a kind with no route to save onto. The
 * inspector says so for a selected kind instead ({@link NO_ROUTE_NOTE}).
 *
 * @param taskKinds The matrix's rows.
 * @returns The routes, in the matrix's order.
 */
export function savedRoutes(taskKinds: readonly RoutingTaskKind[]): readonly SavedRoute[] {
  return taskKinds
    .map(savedRoute)
    .filter((route): route is SavedRoute => route !== null);
}

/* ------------------------------------------------------------------ the edits */

/**
 * The chain with one hop moved.
 *
 * @param draft The route.
 * @param from The index of the hop to move, from 0.
 * @param to Where it goes, from 0. Clamped to the chain, so a keyboard move past either end
 *   is the same draft rather than a hop that vanished.
 * @returns The draft with the hop at its new index — or the same draft when nothing moves.
 */
export function moveHop(draft: ChainDraft, from: number, to: number): ChainDraft {
  const last = draft.hops.length - 1;
  const target = Math.min(Math.max(to, 0), last);

  if (from < 0 || from > last || from === target) return draft;

  const hops = [...draft.hops];
  const [hop] = hops.splice(from, 1);
  hops.splice(target, 0, hop);

  return { ...draft, hops };
}

/**
 * The chain with one hop pointing at a different alias.
 *
 * The hop keeps its id and its note: a swap changes *what* a hop names, not which hop it is,
 * and the operator's sentence about the hop's role — *Fallback on 5xx / timeouts* — is about
 * the role.
 *
 * @param draft The route.
 * @param index Which hop, from 0.
 * @param target The alias to use, with the resolution line and the connection the registry
 *   list carries for it.
 * @returns The draft, or the same draft for an index the chain does not have or an alias the
 *   hop already names.
 */
export function swapHop(draft: ChainDraft, index: number, target: HopTarget): ChainDraft {
  const hop = draft.hops[index];
  if (hop === undefined || hop.alias === target.alias) return draft;

  const hops = draft.hops.map((candidate, at) =>
    at === index
      ? {
          ...candidate,
          alias: target.alias,
          resolution: target.resolution,
          providerId: target.providerId,
        }
      : candidate,
  );

  return { ...draft, hops };
}

/**
 * The chain with a hop appended.
 *
 * Appended rather than inserted: a new hop is a new *last resort*, and a reader who wants it
 * higher moves it — which keeps this one function and the move the only two ways a chain's
 * order changes.
 *
 * @param draft The route.
 * @param target The alias to add.
 * @param id The new hop's id, from {@link addedHopId}.
 * @returns The draft, one hop longer, the new hop carrying no note.
 */
export function addHop(draft: ChainDraft, target: HopTarget, id: string): ChainDraft {
  return {
    ...draft,
    hops: [
      ...draft.hops,
      {
        id,
        alias: target.alias,
        resolution: target.resolution,
        note: null,
        providerId: target.providerId,
      },
    ],
  };
}

/** Why a hop cannot be removed: it is the chain's only one. */
export const LAST_HOP_REASON =
  "A route needs at least one hop — swap this one for another alias instead of removing it.";

/**
 * Why a hop cannot be removed: the chain would be shorter than the route's floor.
 *
 * The floor is a policy field, and the control that moves it is the inspector's switch
 * (AA.4, [#203](https://github.com/NobuData/ouroboros/issues/203)), a few lines below the
 * chain; the sentence names the floor, says what it protects, and points at the switch.
 *
 * @param floor The route's floor, 1-based.
 * @returns The reason.
 */
export function floorReason(floor: number): string {
  return (
    `This route fails a run rather than degrading below hop ${floor.toString()}, so its ` +
    `chain cannot be shorter than ${floor.toString()} ${floor === 1 ? "hop" : "hops"}. ` +
    "Lower the floor before removing a hop."
  );
}

/**
 * Why a hop cannot be removed, or `null` when it can.
 *
 * The two refusals the contract would answer with, decided before the press: an empty chain
 * (`RoutePolicy.hops` is never empty) and a floor past the end of the chain (measured against
 * the chain *in the same body*, which is the chain this draft would send).
 *
 * @param draft The route.
 * @param index Which hop, from 0. Every hop of a chain answers the same — a chain one hop
 *   long cannot lose *any* hop — so the index is taken for the signature's honesty and read
 *   only to refuse one the chain does not have.
 * @returns The reason, or `null`.
 */
export function removalReason(draft: ChainDraft, index: number): string | null {
  if (index < 0 || index >= draft.hops.length) return null;

  const remaining = draft.hops.length - 1;

  if (remaining === 0) return LAST_HOP_REASON;
  if (draft.floorHopIndex !== null && remaining < draft.floorHopIndex) {
    return floorReason(draft.floorHopIndex);
  }

  return null;
}

/** What removing a hop produces: the shorter chain, or the reason it stays. */
export type Removal =
  | { readonly ok: true; readonly draft: ChainDraft }
  | { readonly ok: false; readonly reason: string };

/**
 * The chain with one hop removed — when it may be.
 *
 * @param draft The route.
 * @param index Which hop, from 0.
 * @returns The shorter draft, or the reason from {@link removalReason}. An index the chain
 *   does not have is answered with the same draft rather than a refusal, because nothing was
 *   attempted.
 */
export function removeHop(draft: ChainDraft, index: number): Removal {
  if (index < 0 || index >= draft.hops.length) return { ok: true, draft };

  const reason = removalReason(draft, index);
  if (reason !== null) return { ok: false, reason };

  return { ok: true, draft: { ...draft, hops: draft.hops.filter((_hop, at) => at !== index) } };
}

/* ------------------------------------------------------------------ the policy edits */

/**
 * The route with **Allow fallback to local models** in a position.
 *
 * @param draft The route.
 * @param allow The position.
 * @returns The draft, or the same draft when the switch is already there.
 */
export function setAllowLocal(draft: ChainDraft, allow: boolean): ChainDraft {
  return draft.allowLocalFallback === allow ? draft : { ...draft, allowLocalFallback: allow };
}

/**
 * The floor the switch sets when it is turned on: one above the last resort.
 *
 * The deepest floor that still refuses something — on a three-hop chain, hop 2, which is
 * mockup 06's *fallback 2*; on a two-hop chain, the primary. A floor at the last hop would be
 * a switch that changes nothing, and a switch that changes nothing is not what a reader who
 * turned it on asked for.
 *
 * @param draft The route.
 * @returns The hop, from 1. `1` for a chain one hop long.
 */
export function floorDefault(draft: ChainDraft): number {
  return Math.max(1, draft.hops.length - 1);
}

/**
 * The route with its floor moved — or switched off.
 *
 * Measured against the chain in this draft, as the contract measures it against the chain in
 * the same body: a floor past the end of the chain is refused here rather than sent, and so
 * is one below the primary.
 *
 * @param draft The route.
 * @param floor The deepest hop the route may run on, from 1 — or `null` for no floor.
 * @returns The draft, or the same draft for a floor the chain does not have or one already set.
 */
export function setFloor(draft: ChainDraft, floor: number | null): ChainDraft {
  if (floor !== null && (!Number.isInteger(floor) || floor < 1 || floor > draft.hops.length)) {
    return draft;
  }

  return draft.floorHopIndex === floor ? draft : { ...draft, floorHopIndex: floor };
}

/**
 * The route with its cost cap moved — or removed.
 *
 * The contract's own rule: a cap is a positive integer of cents, and `null` is no cap. A zero
 * is refused here for the reason the contract gives — *a cap of zero is not a cap, it is a
 * route that can never run* — and `app/models/inspector.ts`'s `parseMaxCost` is what turns
 * typed text into a number this will take.
 *
 * @param draft The route.
 * @param cents The cap in whole cents, or `null` for none.
 * @returns The draft, or the same draft for a cap that is not a positive whole number of cents
 *   or one already set.
 */
export function setMaxCost(draft: ChainDraft, cents: number | null): ChainDraft {
  if (cents !== null && (!Number.isInteger(cents) || cents < 1)) return draft;

  return draft.maxCostCentsPerRun === cents ? draft : { ...draft, maxCostCentsPerRun: cents };
}

/**
 * Whether two drafts would send the same body.
 *
 * Compared on what the save carries — the aliases and notes in order, and the policy triple —
 * and not on hop ids or resolution lines, which are the editor's own. A hop dragged to 3 and
 * back to 2 is not a change, and a resolution that moved because the registry did is not one
 * either.
 *
 * @param a One draft.
 * @param b The other.
 * @returns `true` when a save of either would write the same route.
 */
export function sameChain(a: ChainDraft, b: ChainDraft): boolean {
  return (
    a.hops.length === b.hops.length &&
    a.hops.every((hop, at) => hop.alias === b.hops[at].alias && hop.note === b.hops[at].note) &&
    a.allowLocalFallback === b.allowLocalFallback &&
    a.floorHopIndex === b.floorHopIndex &&
    a.maxCostCentsPerRun === b.maxCostCentsPerRun
  );
}

/**
 * One draft as a batch entry — what `PUT /api/v1/routing/routes` takes for it.
 *
 * The chain is the array: there are no positions in the request, and the server numbers the
 * hops densely from 1 in the order sent. Nothing but the alias and the note travels for a hop,
 * because nothing else about a hop is the client's to say.
 *
 * @param draft The route.
 * @returns The entry.
 */
export function toSaveInput(draft: ChainDraft): SaveRouteInput {
  return {
    taskKind: draft.kind,
    hops: draft.hops.map((hop) => ({ alias: hop.alias, note: hop.note })),
    allowLocalFallback: draft.allowLocalFallback,
    floorHopIndex: draft.floorHopIndex,
    maxCostCentsPerRun: draft.maxCostCentsPerRun,
  };
}

/**
 * The hop at one position, as the matrix's cell.
 *
 * @param draft The route.
 * @param position Which hop — 1 is the primary.
 * @returns The pill and its resolution line, or `null` where the chain does not reach.
 */
export function cellAt(draft: ChainDraft, position: number): AliasCell | null {
  const hop = draft.hops[position - 1];
  return hop === undefined ? null : { alias: hop.alias, resolution: hop.resolution };
}

/* ------------------------------------------------------------------ what is announced */

/**
 * What is said when a hop moves — by drag or by key.
 *
 * The position *and* the count, because a reader who cannot see the rail needs both to know
 * whether the hop is now the primary, the last resort, or somewhere between.
 *
 * @param alias The hop's alias.
 * @param position Where it now sits, from 1.
 * @param count How many hops the chain has.
 * @returns The sentence.
 */
export function moveAnnouncement(alias: string, position: number, count: number): string {
  return `${alias} moved to hop ${position.toString()} of ${count.toString()}.`;
}

/**
 * What is said when a hop's alias changes.
 *
 * @param position Which hop, from 1.
 * @param from The alias it named.
 * @param to The alias it names now.
 * @returns The sentence.
 */
export function swapAnnouncement(position: number, from: string, to: string): string {
  return `Hop ${position.toString()} now uses ${to} instead of ${from}.`;
}

/**
 * What is said when a hop is added.
 *
 * @param alias The new hop's alias.
 * @param position Where it landed, from 1.
 * @returns The sentence.
 */
export function addAnnouncement(alias: string, position: number): string {
  return `${alias} added as hop ${position.toString()}.`;
}

/**
 * What is said when a hop is removed.
 *
 * @param alias The removed hop's alias.
 * @param count How many hops remain.
 * @returns The sentence.
 */
export function removeAnnouncement(alias: string, count: number): string {
  return `${alias} removed. The chain has ${count.toString()} ${count === 1 ? "hop" : "hops"}.`;
}

/* ------------------------------------------------------------------ the save's answer */

/** One route's complaints, keyed by the field of the request they are about. */
export type RouteProblems = Readonly<Record<string, readonly string[]>>;

/** Every complaint in a refused batch, keyed by task kind — `details.routes`, as published. */
export type BatchProblems = Readonly<Record<string, RouteProblems>>;

/** The `code` the contract answers when a batch could not be saved. */
export const ROUTE_SAVE_INVALID_CODE = "route_save_invalid";

/**
 * A refused save's `details`, read back as problems per route.
 *
 * Structural rather than trusting: `details` is typed as an open object, and a shape this
 * function does not recognise is an empty map rather than a thrown error — a `422` that
 * arrived with a body nobody could read is still a `422`, and the bar says so in its own
 * sentence.
 *
 * @param details The error envelope's `details`.
 * @returns The problems, keyed by task kind. Empty when `details.routes` is not the
 *   `{"<taskKind>": {"<field>": ["message"]}}` the contract publishes.
 */
export function batchProblems(details: unknown): BatchProblems {
  if (typeof details !== "object" || details === null) return {};

  const routes = (details as { routes?: unknown }).routes;
  if (typeof routes !== "object" || routes === null) return {};

  const problems: Record<string, RouteProblems> = {};

  for (const [kind, fields] of Object.entries(routes as Record<string, unknown>)) {
    if (typeof fields !== "object" || fields === null) continue;

    const route: Record<string, readonly string[]> = {};

    for (const [field, messages] of Object.entries(fields as Record<string, unknown>)) {
      if (!Array.isArray(messages)) continue;

      const strings = messages.filter((message): message is string => typeof message === "string");
      if (strings.length > 0) route[field] = strings;
    }

    if (Object.keys(route).length > 0) problems[kind] = route;
  }

  return problems;
}

/** The field a complaint about one hop's alias is filed under — `hops.<index>.alias`. */
const HOP_FIELD = /^hops\.(\d+)\.alias$/;

/**
 * One route's problems as the lines the matrix prints under its row.
 *
 * The server keys a complaint by the request field — `hops.1.alias`, `floorHopIndex` — which
 * is right for a client and wrong for a person. This names the hop by its position and the
 * floor by its word, and passes every other message through: the sentence is the server's,
 * and only the address is translated.
 *
 * @param problems The route's problems.
 * @returns The lines, in the order the server listed them.
 */
export function problemLines(problems: RouteProblems): readonly string[] {
  return Object.entries(problems).flatMap(([field, messages]) => {
    const hop = HOP_FIELD.exec(field);
    const prefix =
      hop !== null
        ? `Hop ${(Number(hop[1]) + 1).toString()}: `
        : field === "floorHopIndex"
          ? "Floor: "
          : "";

    return messages.map((message) => `${prefix}${message}`);
  });
}

/**
 * What a save answers with: that it landed, that the server refused the batch and said which
 * routes, or that it failed for a reason the bar prints.
 *
 * Refusals are values rather than throws because they are **states to render** — the drafts
 * stay, the bar stays, and the offending rows are marked — and a throw would replace the page
 * the reader is still editing.
 */
export type SaveRoutesOutcome =
  | { readonly ok: true; readonly revisionId: string | null }
  | { readonly ok: false; readonly kind: "refused"; readonly problems: BatchProblems }
  | { readonly ok: false; readonly kind: "failed"; readonly reason: string };

/** Why a member's press did not take, in the words the page would have used. */
export const ROUTES_FORBIDDEN = "Only an owner or an admin can change routes.";

/** What the bar says when the service refused the batch without a sentence of its own. */
export const ROUTES_SAVE_FAILURE = "The routes could not be saved.";

/**
 * What the bar says when the server refused the batch and named the routes.
 *
 * The bar's sentence is about the *batch* — nothing was saved, and the edits are still here —
 * and the rows say what was wrong with each. Two places because they are two facts.
 */
export const ROUTES_REFUSED =
  "Nothing was saved: the server refused some of these routes. Each refused route says why " +
  "in the matrix.";

/** What is announced when a save lands. */
export const ROUTES_SAVED = "Routes saved.";

/* ------------------------------------------------------------------ the copy */

/** The head's and the bar's commit — the mockup's own label. */
export const SAVE_ROUTES = "Save routes";

/** The bar's other action. */
export const DISCARD = "Discard";

/** What the save control says, and why it is inert, while the batch is in flight. */
export const SAVING = "Saving…";

/**
 * The bar's count — `2 routes changed`.
 *
 * @param count How many drafts differ from what the server holds.
 * @returns The label, singular where the count is one.
 */
export function dirtyBarLabel(count: number): string {
  return `${count.toString()} route${count === 1 ? "" : "s"} changed`;
}

/** The marker on a matrix row, and in the inspector, whose route has an unsaved edit. */
export const CHANGED = "changed";

/** The mockup's **+ Add rule**, for a hop. */
export const ADD_HOP = "+ Add hop";

/** The add menu's accessible name. */
export const ADD_MENU_LABEL = "Aliases to add as a hop";

/**
 * A swap trigger's accessible name — which hop, and what it names now.
 *
 * @param position The hop, from 1.
 * @param alias Its alias.
 * @returns The name.
 */
export function swapLabel(position: number, alias: string): string {
  return `Swap hop ${position.toString()}: ${alias}`;
}

/**
 * A swap menu's accessible name.
 *
 * @param position The hop, from 1.
 * @returns The name.
 */
export function swapMenuLabel(position: number): string {
  return `Aliases for hop ${position.toString()}`;
}

/** What a menu row prints before the resolution — the ticket's own `→ resolves:`. */
export const RESOLVES = "→ resolves:";

/**
 * A move-up control's accessible name.
 *
 * @param alias The hop's alias.
 * @returns The name.
 */
export function moveUpLabel(alias: string): string {
  return `Move ${alias} up`;
}

/**
 * A move-down control's accessible name.
 *
 * @param alias The hop's alias.
 * @returns The name.
 */
export function moveDownLabel(alias: string): string {
  return `Move ${alias} down`;
}

/**
 * A remove control's accessible name.
 *
 * @param alias The hop's alias.
 * @returns The name.
 */
export function removeLabel(alias: string): string {
  return `Remove ${alias}`;
}

/** Why the primary cannot move up. */
export const AT_TOP_REASON = "Already the primary.";

/** Why the last hop cannot move down. */
export const AT_BOTTOM_REASON = "Already the last hop.";

/** The drag handle's tooltip — the pointer's path; the buttons are the keyboard's. */
export const DRAG_HINT = "Drag to reorder";

/** What the inspector says for a selected kind that has no route. */
export const NO_ROUTE_NOTE =
  "This task kind has no route, so there is no chain to edit. Creating one is the model " +
  "registry's business.";

/** What a swap or add menu says when the registry has nothing in it. */
export const EMPTY_REGISTRY =
  "This workspace has no aliases to choose from — create one in the Model registry.";

/**
 * A matrix row's pointer shortcut into the editor.
 *
 * @param kind The row's task kind.
 * @returns The tooltip.
 */
export function editChainHint(kind: string): string {
  return `Edit the ${kind} chain`;
}

/* ------------------------------------------------------------------ the matrix's row */

/**
 * One matrix row as the editor draws it: the server's row, with the cells of a changed route
 * taken from its draft, and what the last save said about it.
 */
export interface EditedRow extends MatrixRow {
  /** Whether the route differs from what the server holds. */
  readonly changed: boolean;
  /** What the server refused about this route on the last save, as the lines to print. */
  readonly problems: readonly string[];
}

/**
 * A matrix row, with its edit laid over it.
 *
 * The two model columns are the draft's first two hops when the route has an edit and the
 * server's cells when it does not — so a reorder shows in the matrix the moment it is made,
 * and a route nobody touched is drawn exactly as the read decided it. The rest of the row —
 * the escalation summaries, the two figures — is the server's either way: an edit changes
 * nothing about what a route has cost.
 *
 * @param row The row, as `app/models/matrix.ts` decided it from the read.
 * @param edit The route's unsaved draft, or `null` when it has none.
 * @param problems What the server refused about it, or `undefined` when nothing was.
 * @returns The row to draw.
 */
export function editedRow(
  row: MatrixRow,
  edit: ChainDraft | null,
  problems: RouteProblems | undefined,
): EditedRow {
  return {
    ...row,
    changed: edit !== null,
    primary: edit === null ? row.primary : cellAt(edit, 1),
    fallback: edit === null ? row.fallback : cellAt(edit, 2),
    problems: problems === undefined ? [] : problemLines(problems),
  };
}
