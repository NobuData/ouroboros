/**
 * Every decision the `/models/registry` frame makes, as functions with inputs and outputs,
 * and every sentence it says.
 *
 * CI.1 ([#591](https://github.com/NobuData/ouroboros/issues/591)) is a page frame: a head, two
 * actions and the section's tab set. Only one thing on it is a *judgement* — whether **Import
 * from provider** can act, and what to say when it cannot — and it lives here so that its
 * acceptance criteria are a unit test on a small object rather than an assertion about
 * rendered text. The copy lives here for the reason `app/providers/view.ts`'s does: a sentence
 * in one named place is a sentence a designer can be pointed at.
 *
 * **Framework-free and pure.** Nothing here imports React, `next/*` or the server-only client,
 * the same way `app/models/view.ts` and `app/dashboard/view.ts` are pure. The one import
 * beyond the contract's types is `app/paths.ts`, which is value-only for exactly this reason.
 *
 * ---------------------------------------------------------------------------
 * ### The rule this module exists to keep
 *
 * A control that cannot act **says why**, and the *why* has to be the true one.
 * `docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.5 asks for the label; what this module adds is that
 * there are three different reasons this particular control might be inert and they are not
 * interchangeable:
 *
 * 1. **the reader's role** — a member may not create aliases, and no amount of connecting
 *    providers changes that;
 * 2. **no provider is connected** — an admin can fix this, in one link, which is why that
 *    state is the only one that carries one; and
 * 3. **the provider list could not be read** — nothing is wrong with the workspace and
 *    nothing is worth doing about it but trying again.
 *
 * Collapsing them into one *"unavailable"* would send an admin looking for a permission they
 * already have, or a member to a page that will refuse them. {@link importState} is what keeps
 * them apart, and it settles the order deliberately: **role first**, because a member offered
 * *"connect a provider first →"* is being pointed at a page that would also refuse them.
 *
 * ---------------------------------------------------------------------------
 * ### …and the one place the three reasons collapse on purpose
 *
 * CI.4 ([#594](https://github.com/NobuData/ouroboros/issues/594)) added the two flows behind the
 * head's actions, and the create dialog asks the provider read a *different* question: not
 * *what can I import from* but *what can I bind to*. For that question there are only two
 * answers — some connections, or none — because the dialog's second mode works either way. So
 * {@link aliasSources} deliberately flattens what {@link importState} deliberately keeps apart,
 * and the distinction is the question rather than the reader: the same failed read is three
 * different sentences on the import control and one empty select on the dialog, and both are
 * honest. {@link aliasNames} is the other fact both flows take from this page, off the same
 * read the table draws, so nothing on the screen can disagree about which names are taken.
 */

import type { Role } from "@/app/api/membership";
import type { ProviderConnection } from "@/app/api/providers";
import type { Reading } from "@/app/api/reading";
import type { RegistryAlias } from "@/app/api/registry";
import type { RoutingTaskKind } from "@/app/api/routing";
import { article } from "@/app/format";
import {
  CONNECT_PROVIDER,
  type ReadOnlyNote,
  type StepStatus,
  connectedNote,
} from "@/app/models/states";
import { PROVIDERS_PATH } from "@/app/paths";

import { type TableRow, UNBOUND_STATE, ownersAndAdmins, tableRows } from "./table";

/* ------------------------------------------------------------------ what the page reads */

/**
 * Everything the registry page was able to read, and why it could not read the rest.
 *
 * It lives in this pure module rather than beside the calls that produce it
 * (`app/registry/data.ts`, which is server-only) for the reason `ModelsReadings` does: the
 * screen and its tests can then name the shape without pulling `server-only`, `next/headers`
 * and a configured environment in behind it.
 *
 * Two reads since CI.2 ([#592](https://github.com/NobuData/ouroboros/issues/592)). CI.3–CI.5
 * add the inspector's own reads and the chain card beside them, and the property that has to
 * survive them is the one `app/models/data.ts` established — **one failed read is one
 * degraded region, never a blank page**: a refused registry read is a captioned card where the
 * table would be, under a head and a tab set that still work.
 */
export interface RegistryReadings {
  /**
   * The workspace's provider connections, credentials masked, or why they could not be read.
   *
   * Three things on this page are drawn from this one list: the rows **Import from provider**
   * offers, the connections the create dialog may bind to, and — since CI.3
   * ([#593](https://github.com/NobuData/ouroboros/issues/593)) — the inspector's provider
   * select, which needs the **mask** to tell two connections of one kind apart.
   *
   * A workspace that has connected none reads successfully and answers an empty array. *No
   * providers* and *nobody could read the providers* are different facts, and this page says
   * something different for each — see {@link importState}.
   */
  readonly providers: Reading<readonly ProviderConnection[]>;
  /**
   * Every alias in the workspace with every cell composed — CH.5's payload
   * ([#588](https://github.com/NobuData/ouroboros/issues/588)) — or why it could not be read.
   *
   * A workspace with no aliases reads successfully and answers an empty array; the table's
   * empty state and its failed state are different facts — see {@link tableState}.
   */
  readonly aliases: Reading<readonly RegistryAlias[]>;
  /**
   * The routing matrix's task kinds — every route and its chain — or why they could not be read.
   *
   * Since CI.5 ([#595](https://github.com/NobuData/ouroboros/issues/595)): the chain card
   * simulates an alias that no run has resolved through yet, and Simulate asks about a **task
   * kind**, so the page needs to know which route an alias sits in (`app/registry/chain.ts`'s
   * `primaryTaskKind`). A refused read degrades that card alone: it says it cannot tell rather
   * than claiming nothing routes through the alias.
   */
  readonly routes: Reading<readonly RoutingTaskKind[]>;
  /**
   * Why the price column is blank, or `null`/absent when pricing answered.
   *
   * Since CI.6 ([#596](https://github.com/NobuData/ouroboros/issues/596)): the registry read
   * degrades around a pricing failure rather than failing (`degraded.pricing` on CH.5's payload),
   * so the rows arrive with every price `—` and this is the sentence that says it is an outage
   * rather than a catalog with nothing in it. Optional, because only the registry read carries it.
   */
  readonly pricing?: string | null;
}

/* ------------------------------------------------------------------ the table's seat */

/**
 * What stands where the allowed-models table goes: the table, or one of the two honest
 * reasons there is not one.
 *
 * A discriminated union for the reason `ImportState` is one: the seat renders exactly one of
 * three things, and a shape that could hold *rows and a reason at once* would let it render
 * both. The rows arrive already decided (`app/registry/table.ts`), so the screen is handed
 * cells rather than a payload.
 */
export type TableState =
  /** There are aliases, and these are their rows. */
  | { readonly kind: "populated"; readonly rows: readonly TableRow[] }
  /** The read succeeded and the workspace has no aliases yet. */
  | { readonly kind: "empty" }
  /** The read was refused, with the service's own sentence. */
  | { readonly kind: "failed"; readonly reason: string };

/**
 * Which of the three the seat draws.
 *
 * @param aliases The registry read, or why it failed.
 * @returns The state. *Empty* and *failed* are kept apart deliberately — a workspace that has
 *   created nothing and a read that was refused are different facts, and drawing one as the
 *   other would either hide an outage behind *no aliases yet* or accuse an empty workspace of
 *   an error it has not had.
 */
export function tableState(aliases: Reading<readonly RegistryAlias[]>): TableState {
  if (!aliases.ok) return { kind: "failed", reason: aliases.reason };

  const rows = tableRows(aliases.value);

  return rows.length === 0 ? { kind: "empty" } : { kind: "populated", rows };
}

/* ------------------------------------------------------------------ the page head */

/**
 * The page's `<h1>` — mockup 21's, **verbatim**.
 *
 * It is the product's argument rather than a heading: *every model gets a name, and every
 * route points at the name* is the sentence the whole registry defends, and paraphrasing it in
 * implementation would quietly weaken it. `__tests__/registry/view.test.ts` reads the mockup
 * and compares, so a change to one that is not a change to both fails the suite.
 */
export const REGISTRY_TITLE = "Every model gets a name. Every route points at the name.";

/**
 * The subline under it — mockup 21's, verbatim, for the same reason.
 *
 * Three clauses, and the third is the point: an alias is an indirection, so the provider
 * behind a name can be replaced without touching a single route or workflow. That is what
 * bring-your-own-key buys, and it is why this page exists.
 */
export const REGISTRY_SUBLINE =
  "Registry aliases bind a provider key to a model id. Workflows and routing only ever see " +
  "the alias — swap the provider behind it and nothing else changes. That's the point of " +
  "bring-your-own-key.";

/**
 * The ghost action's label, **without the mockup's caret**.
 *
 * The mockup draws `Import from provider ▾`, and the caret is a picture of a menu rather than
 * a word in a name: a screen reader announcing *"Import from provider down-pointing triangle,
 * menu"* would be reading the decoration twice, once badly. So the caret is drawn beside this
 * as `aria-hidden` (`app/registry/import-menu.tsx`) and the accessible name is the sentence.
 */
export const IMPORT_LABEL = "Import from provider";

/** The caret the mockup draws after it. Decoration, and hidden from the accessibility tree. */
export const IMPORT_CARET = "▾";

/** The menu's own accessible name, which is what a screen reader announces when it opens. */
export const IMPORT_MENU_LABEL = "Import from a connected provider";

/** The head's primary action, as the mockup labels it. */
export const NEW_ALIAS_LABEL = "+ New alias";

/**
 * Why neither head action may be used by a member or a viewer.
 *
 * A member who can see a control they may not use should learn that from the control, not from
 * a `403` after filling in a dialog. Worded through `ownersAndAdmins` since CI.6
 * ([#596](https://github.com/NobuData/ouroboros/issues/596)), so every write affordance on the
 * page gives the same explanation after naming itself.
 */
export const MEMBER_REASON = ownersAndAdmins("Creating and importing aliases");

/** Why the import action is inert for a workspace that has connected no provider. */
export const NO_PROVIDERS_REASON =
  "No provider is connected yet — there is nothing to import from.";

/** …and the link that fixes it, which is the only blocked state with something to do. */
export const CONNECT_PROVIDER_LABEL = "Connect a provider →";

/** Where that link goes. Spelled from `app/paths.ts`, never typed out. */
export const CONNECT_PROVIDER_HREF = PROVIDERS_PATH;

/** Why the import action is inert when the provider list could not be read at all. */
export const PROVIDERS_UNREADABLE_REASON =
  "The connected providers could not be read just now — nothing is wrong with the registry, " +
  "try again in a moment.";

/*
 * What the space below the tab set is waiting for is no longer this module's: since CI.2 the
 * table is there, and the seat beneath it names the issues that fill the rest of the page —
 * `app/registry/table.ts`'s `INSPECTOR_NEXT_NOTE`.
 */

/* ------------------------------------------------------------------ the import action */

/** One provider the import menu offers — a connection this workspace has. */
export interface ImportSource {
  /** The connection's id, which is the React key and what CI.4's wizard is scoped by. */
  readonly id: string;
  /** What the row says: the connection's display name, drawn as the workspace wrote it. */
  readonly name: string;
  /**
   * `••••Xq4A`, or `null` for a connection that stores no credential.
   *
   * Not drawn by the import menu, which lists connections by name; read by CI.3's inspector
   * ([#593](https://github.com/NobuData/ouroboros/issues/593)), whose provider select is the
   * mockup's *Anthropic — key sk-ant-…Xq4A* and would otherwise offer two connections of one
   * kind under one name.
   */
  readonly mask: string | null;
}

/**
 * Whether **Import from provider** can offer anything, and what to say when it cannot.
 *
 * A discriminated union rather than a bag of optional fields, for the reason
 * `app/providers/view.ts`'s `AuditReading` is one: the control renders exactly one of two
 * things, and a shape that could hold *sources and a reason at once* would let it render both.
 */
export type ImportState =
  /** There is something to import from. The menu lists these. */
  | { readonly kind: "ready"; readonly sources: readonly ImportSource[] }
  /**
   * There is not, and the control is inert with this sentence.
   *
   * `connect` is true for the one blocked state a reader can act on — no provider connected,
   * by somebody who may connect one — and is what puts the link to Providers & keys on the
   * page. Offering it in the other two would send a member to a page that would refuse them,
   * or offer a fix for a failed read that fixes nothing.
   */
  | { readonly kind: "blocked"; readonly reason: string; readonly connect: boolean };

/**
 * What the import action may do, given who is reading and what could be read.
 *
 * The order is the judgement — see this module's header. Role first, then the read, then
 * emptiness: each answer is about something the *previous* question has already ruled out, so
 * a reader is never told about a problem behind one they have.
 *
 * @param providers The provider read, or why it failed.
 * @param mayAdminister Whether this reader's role may create aliases —
 *   `app/api/membership.ts`'s `mayAdminister`, decided at the gate.
 * @returns The state, ready or blocked with its reason.
 */
export function importState(
  providers: Reading<readonly ProviderConnection[]>,
  mayAdminister: boolean,
): ImportState {
  if (!mayAdminister) {
    return { kind: "blocked", reason: MEMBER_REASON, connect: false };
  }

  if (!providers.ok) {
    return { kind: "blocked", reason: PROVIDERS_UNREADABLE_REASON, connect: false };
  }

  const sources = importSources(providers.value);

  return sources.length === 0
    ? { kind: "blocked", reason: NO_PROVIDERS_REASON, connect: true }
    : { kind: "ready", sources };
}

/**
 * The workspace's connections, as menu rows.
 *
 * **Health is deliberately not a filter.** A paused or unreachable connection is still a
 * connection this workspace has, and hiding it would make the menu answer a different question
 * from the one it is asked — *which providers do I have* rather than *which providers are up
 * right now*. Whether an import can actually read a catalog from a paused provider is CI.4's
 * to decide, at the point where it tries; a menu that had quietly decided in advance would
 * leave a reader wondering where their provider went. The same holds for the inspector's
 * rebind select since CI.3: an alias may be pointed at a connection that is switched off, and
 * the table's health cell is where that is then said out loud.
 *
 * The order is the service's, which is by display name (`GET /api/v1/providers`), so the menu
 * is scanned the same way mockup 07's own grid is.
 *
 * @param providers Every connection in the workspace, as the contract serves them.
 * @returns One row per connection, in the order given.
 */
export function importSources(
  providers: readonly ProviderConnection[],
): readonly ImportSource[] {
  return providers.map((provider) => ({
    id: provider.id,
    name: provider.displayName,
    mask: provider.mask,
  }));
}

/**
 * Why **+ New alias** cannot act, or `undefined` when it can.
 *
 * A rule rather than a constant, and since CI.4
 * ([#594](https://github.com/NobuData/ouroboros/issues/594)) built the dialog it opens there is
 * exactly one reason left: the reader's role. The *not built yet* sentence this used to carry
 * is gone, which is the shape a frame's placeholder is supposed to take when the thing it named
 * arrives — deleted, not amended.
 *
 * It stays a function rather than becoming the bare constant so the call sites do not have to
 * change again, and so the one question a caller asks is still *may this reader press it*.
 *
 * @param mayAdminister Whether this reader's role may create aliases.
 * @returns The reason it is inert, or `undefined` when it may be pressed.
 */
export function newAliasReason(mayAdminister: boolean): string | undefined {
  return mayAdminister ? undefined : MEMBER_REASON;
}

/**
 * The connections a create dialog may bind to, whatever the read did.
 *
 * The import control keeps *no provider connected* and *the providers could not be read* apart,
 * because it has something different to say for each ({@link importState}). The create dialog
 * does not: either way there is nothing to bind to, and its *bind later* mode still works — so
 * a failed read answers an empty list rather than a state of its own, and the dialog's provider
 * select says the one true sentence for both.
 *
 * @param providers The provider read, or why it failed.
 * @returns The connections, or none.
 */
export function aliasSources(
  providers: Reading<readonly ProviderConnection[]>,
): readonly ImportSource[] {
  return providers.ok ? importSources(providers.value) : [];
}

/**
 * Every alias name this workspace has, for the create dialog's live uniqueness check and the
 * import wizard's row-level one.
 *
 * Taken from the same read the table draws, so the two cannot disagree about what is taken —
 * and *the read failed* answers an empty list, which is the safe direction: the browser then
 * proposes nothing, and CH.1's `model_alias_name_taken` is what decides, as it is anyway.
 *
 * @param aliases The registry read, or why it failed.
 * @returns The names, in the payload's order.
 */
export function aliasNames(aliases: Reading<readonly RegistryAlias[]>): readonly string[] {
  return aliases.ok ? aliases.value.map((alias) => alias.alias) : [];
}

/* ------------------------------------------------------------------ read-only (CI.6) */

/**
 * The sentence every read-only reader of the registry gets, whatever their role is called.
 *
 * *Nothing hidden* is the point (CI.6, [#596](https://github.com/NobuData/ouroboros/issues/596)):
 * a member is not a spectator — routing decisions and prices are exactly what a team member
 * should be able to read and discuss — so every control stays in its place, inert with its
 * reason, and this says once, near the top, what that means.
 */
export const REGISTRY_READ_ONLY_BODY =
  "Aliases are created, rebound and switched by an owner or an admin. Everything here — the " +
  "table, the inspector and both cards — can be read; nothing here can be changed.";

/**
 * Explain the role rather than leaving a page of inert controls to explain itself.
 *
 * The shape is `app/models/states.ts`'s `readOnlyNote`, so the routing page and this one name a
 * member the same way. Total over every role; the screen draws it only for a role
 * `mayAdminister` refuses.
 *
 * @param role The reader's strongest role, from `primaryRole`.
 * @returns The head naming the role, and the body saying what it means here.
 */
export function registryReadOnlyNote(role: Role): ReadOnlyNote {
  return {
    head: `Viewing the registry as ${article(role)} ${role}.`,
    body: REGISTRY_READ_ONLY_BODY,
  };
}

/* ------------------------------------------------------------------ the failed read (CI.6) */

/**
 * The banner's headline when the registry read was refused — the state, in words.
 *
 * DASH-I.7's rule ([#86](https://github.com/NobuData/ouroboros/issues/86)): the banner says
 * why, once, with the page's only retry; the table's seat says what is missing and points up.
 * The two other reads have their own honest degraded surfaces already — the import control for
 * the providers, the chain card for the routes — and are not repeated here.
 */
export const REGISTRY_FAILED_HEADLINE = "The registry could not be read.";

/**
 * Why the page's banner is drawn, or `null` when it is not.
 *
 * @param aliases The registry read.
 * @returns The service's sentence when the read was refused, otherwise `null`.
 */
export function registryFailure(aliases: Reading<readonly RegistryAlias[]>): string | null {
  return aliases.ok ? null : aliases.reason;
}

/* ------------------------------------------------------------------ the empty registry (CI.6) */

/** The guidance card's title — the product's argument, as an instruction. */
export const GUIDANCE_CARD_TITLE = "Name your first model";

/**
 * Which guidance a registry with no aliases gets.
 *
 * Decided by the provider read, because *which of the two ways in is possible yet* is the
 * whole difference: with a connection, a model can be imported; without one, only a name can be
 * reserved. `readOnly` rides along rather than being a fourth kind — a member sees the same
 * explanation and the same path, only without the controls.
 */
export type GuidanceState =
  /** At least one connection: both ways in are open. */
  | { readonly kind: "has-providers"; readonly connected: number; readonly readOnly: boolean }
  /** No connection at all: the guidance leads with Providers & keys. */
  | { readonly kind: "no-providers"; readonly readOnly: boolean }
  /** The provider read failed, so whether a connection exists is unknown. */
  | { readonly kind: "providers-unknown"; readonly readOnly: boolean };

/**
 * The guidance for a registry with no aliases.
 *
 * @param providers The provider read, or why it failed.
 * @param mayAdminister Whether this reader may create aliases.
 * @returns The state.
 */
export function guidanceState(
  providers: Reading<readonly ProviderConnection[]>,
  mayAdminister: boolean,
): GuidanceState {
  const readOnly = !mayAdminister;

  if (!providers.ok) return { kind: "providers-unknown", readOnly };

  return providers.value.length === 0
    ? { kind: "no-providers", readOnly }
    : { kind: "has-providers", connected: providers.value.length, readOnly };
}

/** The headline for a workspace with a connection and no aliases. */
export const NO_ALIASES_TITLE = "No aliases yet";

/** …and why naming a model matters. */
export const NO_ALIASES_NOTE =
  "Every route points at an alias, never at a raw model id — so naming a model is where " +
  "routing starts. Create one by hand, or import what a connected provider already offers.";

/** The headline for a workspace with no connection at all. */
export const NO_PROVIDERS_TITLE = "Connect a provider first";

/**
 * …and the honest half: a name can still be reserved before its key exists, and what that name
 * will look like until then — the shared unbound sentence, so this is the same story the create
 * dialog, the switch and the inspector tell.
 */
export const NO_PROVIDERS_NOTE =
  "An alias binds a provider key to a model id, so the usual first step is a connection. A " +
  `name can still be reserved now with + New alias → Bind later. ${UNBOUND_STATE}`;

/** What a member is told beneath the path, in place of the controls. */
export const GUIDANCE_READ_ONLY =
  "Naming models is done by a workspace owner or admin — the first alias they create or " +
  "import will appear here.";

/** The first step's note while no provider is connected. */
export const CONNECT_STEP_NOTE =
  "API keys and local hosts are added on the Providers & keys tab.";

/** The first step's note when the provider read failed. */
export const CONNECT_STEP_UNKNOWN_NOTE =
  "The connected providers could not be read just now, so whether this step is done is unknown.";

/** The link that takes the first step. */
export const CONNECT_STEP_LINK = "Connect a provider first →";

/** The second step's title. */
export const NAME_STEP_TITLE = "Name a model";

/** The second step's note. */
export const NAME_STEP_NOTE =
  "Create an alias with + New alias, or import from a connected provider — suggested names, " +
  "reviewed before anything is created.";

/**
 * What a step offers its reader.
 *
 * - `connect` — the link into Providers & keys;
 * - `name` — both ways in: **+ New alias** and **Import from provider**;
 * - `reserve` — **+ New alias** alone, for a workspace with nothing to import from;
 * - `null` — nothing, for a step that is done or behind another, and for every step a member
 *   reads.
 */
export type GuidanceAction = "connect" | "name" | "reserve" | null;

/** One step of the path from an empty registry to a populated one. */
export interface GuidanceStep {
  /** Which step — the React key. */
  readonly key: "provider" | "alias";
  /** What to do. */
  readonly title: string;
  /** How, or what was found. */
  readonly note: string;
  /** Where the reader is relative to it — `app/models/states.ts`'s vocabulary. */
  readonly status: StepStatus;
  /** What the step offers. */
  readonly action: GuidanceAction;
}

/**
 * The guidance's headline.
 *
 * @param state Which guidance.
 * @returns The title.
 */
export function guidanceTitle(state: GuidanceState): string {
  return state.kind === "no-providers" ? NO_PROVIDERS_TITLE : NO_ALIASES_TITLE;
}

/**
 * The guidance's explanation.
 *
 * @param state Which guidance.
 * @returns The note.
 */
export function guidanceNote(state: GuidanceState): string {
  return state.kind === "no-providers" ? NO_PROVIDERS_NOTE : NO_ALIASES_NOTE;
}

/**
 * The path, with the reader's place on it marked — both steps, always, in order.
 *
 * The routing page's arrangement (`app/models/states.ts`'s `foundationSteps`): a reader on step
 * one sees step two coming, and a reader on step two sees what is behind them. That is what
 * makes *empty → connect a provider → import → populated* one walk with the guidance correct at
 * each stop rather than three unrelated messages.
 *
 * @param state Which guidance.
 * @returns The two steps.
 */
export function guidanceSteps(state: GuidanceState): readonly GuidanceStep[] {
  const act = (action: GuidanceAction): GuidanceAction => (state.readOnly ? null : action);

  if (state.kind === "no-providers") {
    return [
      {
        key: "provider",
        title: CONNECT_PROVIDER,
        note: CONNECT_STEP_NOTE,
        status: "current",
        action: act("connect"),
      },
      {
        key: "alias",
        title: NAME_STEP_TITLE,
        note: NAME_STEP_NOTE,
        status: "pending",
        action: act("reserve"),
      },
    ];
  }

  return [
    state.kind === "has-providers"
      ? {
          key: "provider",
          title: CONNECT_PROVIDER,
          note: connectedNote(state.connected),
          status: "done",
          action: null,
        }
      : {
          key: "provider",
          title: CONNECT_PROVIDER,
          note: CONNECT_STEP_UNKNOWN_NOTE,
          status: "unknown",
          action: null,
        },
    {
      key: "alias",
      title: NAME_STEP_TITLE,
      note: NAME_STEP_NOTE,
      status: "current",
      action: act("name"),
    },
  ];
}
