/**
 * Every decision the allowed-models table makes, as functions with inputs and outputs, and
 * every sentence it says.
 *
 * The table (CI.2, [#592](https://github.com/NobuData/ouroboros/issues/592)) is mockup 21's
 * centre of gravity: eight columns, each one a different subsystem's truth. Almost none of
 * that is decided here, and that is the point — CH.5's payload
 * ([#588](https://github.com/NobuData/ouroboros/issues/588)) arrives with the chips derived,
 * the health state named, the price rendered and the referrers counted, so what this module
 * decides is only what a payload with *no colour, no severity and no tone* deliberately left
 * to the surface that owns the classes: which dot a state takes, what a provenance reads as
 * on hover, how a count is worded, which row is the dimmed one, and what the switch has to
 * say before it takes routes down.
 *
 * **Framework-free and pure**, like `app/registry/view.ts` beside it and `app/models/matrix.ts`
 * before it: nothing here imports React, `next/*` or the server-only client. The read is
 * `app/registry/data.ts`'s and the drawing is `app/registry/registry-table.tsx`'s.
 *
 * ### The three ways this table would lie, and what stops each
 *
 * 1. **It re-derives a cell.** The chips, the price string and the health note are the
 *    server's, rendered verbatim — {@link tableRows} copies them and composes nothing. Three
 *    surfaces read this payload (the table, the inspector's prefill, routing's swap menus),
 *    and a rule re-implemented in any of them is a cell that disagrees with the other two.
 * 2. **It draws `unknown` as healthy.** {@link HEALTH_CELLS} maps every one of the six states
 *    the contract publishes, and `unknown` takes the warn hue **and a ring** rather than a
 *    disc — decision **M8**: a state nobody reported is distinguishable from one somebody did
 *    without colour vision. A seventh state added to the service is a build error here.
 * 3. **It confuses `$0`, `—` and `seat-based`.** Three different answers, and the cell prints
 *    whichever the payload resolved. What this module adds is the *provenance* on hover
 *    ({@link priceProvenance}), so the number is auditable: `bundled@2026-08-15+…` or
 *    `org override`, and nothing at all for a model the catalog does not cover.
 */

import type {
  AliasHealth,
  AliasHealthState,
  ModelAliasReference,
  ModelPrice,
  RegistryAlias,
  RegistryBinding,
} from "@/app/api/registry";
import { EM_DASH, NO_PROVIDER } from "@/app/models/matrix";
import { type Monogram, monogramFor } from "@/app/providers/cards";

// The em-dash and *no provider* are the routing page's, re-exported rather than typed again:
// the registry's orphan row and the matrix's unbound hop are the same alias seen from two
// pages, and two constants holding one word are two things that can come to differ.
export { EM_DASH, NO_PROVIDER };

/* ------------------------------------------------------------------ the provider cell */

/**
 * The provider cell: the shared AE.2 monogram and the connection's name.
 *
 * The **letters are the server's** (`binding.monogram`) — the payload computes them so this
 * page and mockup 07's cards cannot pick different letters for one connection — and the
 * **tint is AE.2's** (`app/providers/cards.ts`, `monogramFor`), because the payload carries
 * no colour by design and the tint map is the cards'. Looking both up in one place is what
 * keeps the two surfaces one vocabulary.
 */
export interface ProviderCell {
  /** The square, as `app/providers/provider-monogram.tsx` draws it. */
  readonly monogram: Monogram;
  /** The connection's display name — what mockup 07's card calls it. */
  readonly name: string;
}

/**
 * The provider cell for a binding.
 *
 * @param binding The alias's binding, as served.
 * @returns The monogram and the name.
 */
export function providerCell(binding: RegistryBinding): ProviderCell {
  return {
    monogram: {
      letters: binding.monogram,
      tint: monogramFor(binding.kind, binding.displayName).tint,
    },
    name: binding.displayName,
  };
}

/* ------------------------------------------------------------------ the health cell */

/** Which of the three status hues a health cell takes. */
export type HealthTone = "ok" | "warn" | "err";

/** The shape of the dot: a disc for a state that was reported, a ring for one nobody could. */
export type HealthDot = "filled" | "ring";

/**
 * How one health state is drawn: its hue, its dot's shape, and the word beside the dot.
 *
 * `word` is `null` for the one state whose note *is* the word — `no_key`, whose note is the
 * mockup's own `no key — connect a provider` — so the cell prints the note alone rather than
 * *no key · no key — connect a provider*.
 */
export interface HealthTreatment {
  readonly tone: HealthTone;
  readonly dot: HealthDot;
  readonly word: string | null;
}

/**
 * The treatment each of the six states takes. Total over the contract's union, so a state the
 * service adds is a build error here rather than a row that draws as healthy.
 *
 * - `ok` — the mockup's `● ok`.
 * - `degraded` — the mockup's `⚠ degraded`, with the check's own note beside it.
 * - `model_missing` — a warning: the binding still works, discovery no longer lists the model.
 * - `unknown` — **warn, and a ring**: nothing has checked the provider, and that is never
 *   drawn as green (decision **M8**).
 * - `provider_disabled` — an error: the connection is switched off or paused, which is intent,
 *   and the fix is one page away.
 * - `no_key` — the mockup's `✗ no key — connect a provider`.
 */
export const HEALTH_CELLS: Readonly<Record<AliasHealthState, HealthTreatment>> = {
  ok: { tone: "ok", dot: "filled", word: "ok" },
  degraded: { tone: "warn", dot: "filled", word: "degraded" },
  model_missing: { tone: "warn", dot: "filled", word: "model missing" },
  unknown: { tone: "warn", dot: "ring", word: "unknown" },
  provider_disabled: { tone: "err", dot: "filled", word: "provider off" },
  no_key: { tone: "err", dot: "filled", word: null },
};

/** The health cell, decided. */
export interface HealthCell {
  /** The state, for anything that wants to branch on it rather than on a hue. */
  readonly state: AliasHealthState;
  /** Which hue. */
  readonly tone: HealthTone;
  /** Which dot. */
  readonly dot: HealthDot;
  /** The words beside the dot — the state's word, or the note where the note is the word. */
  readonly label: string;
  /** The server's note, where it says something the label does not — `elevated latency`. */
  readonly detail: string | null;
  /** Whether the **Fix in Providers →** button is drawn: the server said there is a fix there. */
  readonly fix: boolean;
}

/**
 * The health cell for one alias.
 *
 * @param health The cell as served — a state, a note and a fix pointer.
 * @returns The treatment, the label, and the note where it adds something.
 */
export function healthCell(health: AliasHealth): HealthCell {
  const treatment = HEALTH_CELLS[health.state];

  return {
    state: health.state,
    tone: treatment.tone,
    dot: treatment.dot,
    label: treatment.word ?? health.note ?? health.state,
    detail: treatment.word === null ? null : health.note,
    fix: health.fix !== null,
  };
}

/** The ghost button in the health cell, as the mockup labels it. */
export const FIX_IN_PROVIDERS = "Fix in Providers →";

/* ------------------------------------------------------------------ the price cell */

/** The price cell: the rendered figure, and where it came from. */
export interface PriceCell {
  /** The server's `display` — `$10 · $50`, `seat-based`, `usage-based`, `$0` or `—`. */
  readonly display: string;
  /** The hover: source and catalog version, or `null` for a price that does not exist. */
  readonly provenance: string | null;
}

/** What an override's provenance reads as. */
export const ORG_OVERRIDE = "org override";

/**
 * A price's provenance, for the hover — the figure's audit trail in a few characters.
 *
 * `bundled@<catalogVersion>` names the vendored snapshot the number came from, and
 * {@link ORG_OVERRIDE} says this workspace wrote it. A model the catalog does not cover has
 * no provenance, because there is no number to audit; the cell's `—` says so on its own.
 *
 * @param price The price as served.
 * @returns The provenance line, or `null` where there is no price.
 */
export function priceProvenance(price: ModelPrice): string | null {
  if (price.price === null) return null;

  const { source, catalogVersion } = price.price.provenance;

  return source === "override" ? ORG_OVERRIDE : `bundled@${catalogVersion ?? "unversioned"}`;
}

/**
 * The price cell for one alias.
 *
 * @param price The price as served.
 * @returns The cell.
 */
export function priceCell(price: ModelPrice): PriceCell {
  return { display: price.display, provenance: priceProvenance(price) };
}

/* ------------------------------------------------------------------ the used-by cell */

/**
 * The `Used by` cell — the mockup's `4 routes`.
 *
 * The word is *routes* for every reference kind, because that is the word the mockup uses and
 * the one a reader scanning the column has: an escalation rule that names the alias is, to
 * the question *what breaks if I switch this off*, a route. The inspector's chips (CI.3) are
 * where each reference is named for what it is.
 *
 * @param count The server's `usedBy`.
 * @returns The cell, singular where the count is one.
 */
export function usedByCell(count: number): string {
  return `${count} route${count === 1 ? "" : "s"}`;
}

/* ------------------------------------------------------------------ the row */

/** One row of the table, decided. */
export interface TableRow {
  /** `model_aliases.id` — what the switch writes to. */
  readonly id: string;
  /** The alias — the pill, the React key, and what the URL carries. */
  readonly alias: string;
  /** The **On** switch's position. Always false for an unbound alias. */
  readonly enabled: boolean;
  /** The provider cell, or `null` for the mockup's faint *no provider*. */
  readonly provider: ProviderCell | null;
  /** The raw model id — the only place in the product one renders (decision **M1**). */
  readonly modelId: string;
  /** The server-derived chips. Empty is the mockup's `—`. */
  readonly chips: readonly string[];
  /** The health cell. */
  readonly health: HealthCell;
  /** The price cell. */
  readonly price: PriceCell;
  /** The `Used by` cell, already worded. */
  readonly usedBy: string;
  /** What references the alias — what a switch-off names before it happens. */
  readonly references: readonly ModelAliasReference[];
  /**
   * Whether the row is drawn dimmed — mockup 21's `tr.dim`, on the unbound row and nowhere
   * else. The health cell is exempt, because on that row it is the one cell that says what to
   * do.
   */
  readonly dim: boolean;
}

/**
 * The table, decided row by row.
 *
 * **The server's order is kept** — by alias name, which is how the payload is published and
 * how a reader scans a list of names. Sorting again here would be a second opinion.
 *
 * @param aliases Every alias in the workspace, as served.
 * @returns One row per alias, every cell already a string or a small object — nothing left
 *   for the component to decide.
 */
export function tableRows(aliases: readonly RegistryAlias[]): readonly TableRow[] {
  return aliases.map((alias) => ({
    id: alias.id,
    alias: alias.alias,
    enabled: alias.enabled,
    provider: alias.binding === null ? null : providerCell(alias.binding),
    modelId: alias.modelId,
    chips: alias.chips,
    health: healthCell(alias.health),
    price: priceCell(alias.price),
    usedBy: usedByCell(alias.usedBy),
    references: alias.references,
    dim: alias.binding === null,
  }));
}

/* ------------------------------------------------------------------ the selection */

/**
 * Which row a URL asks for, if the table has it.
 *
 * A URL is input, and this is the validation: an `?alias=` naming an alias this workspace does
 * not have selects nothing rather than putting a name nobody can act on into the inspector's
 * title. `null` and an unknown name are the same answer deliberately — both mean *no row is
 * selected*, which is the state the page opens in. The parameter itself is `app/paths.ts`'s
 * `ALIAS_PARAM`, which the provider card's *not listed upstream* flag already writes.
 *
 * @param rows The table's rows.
 * @param requested What the URL carried, or `null` when it carried nothing. An array — which
 *   is what a repeated parameter produces — is refused for the same reason: two answers to
 *   *which row* is not an answer.
 * @returns The alias to select, or `null`.
 */
export function selectedAlias(
  rows: readonly TableRow[],
  requested: string | string[] | undefined | null,
): string | null {
  if (typeof requested !== "string") return null;

  return rows.some((row) => row.alias === requested) ? requested : null;
}

/**
 * What is announced when the selection moves.
 *
 * A sentence rather than the bare name, because it is read out of context: a live region that
 * said only *coder-max* would leave the reader to guess whether a row had been selected, a
 * filter applied or a switch pressed.
 *
 * @param alias The selected alias.
 * @returns The announcement.
 */
export function selectionAnnouncement(alias: string): string {
  return `${alias} alias selected.`;
}

/* ------------------------------------------------------------------ the card frame */

/** The card's title, as mockup 21 sets it — `ALLOWED MODELS`. */
export const TABLE_TITLE = "Allowed models";

/**
 * The count beside the title — the mockup's `· 8 ALIASES`.
 *
 * Computed rather than written down, so a workspace with a different number of aliases gets a
 * true count instead of the seeded one — and it is the row count, so the two cannot disagree.
 *
 * @param count How many rows the table has.
 * @returns The chip's label, singular where the count is one.
 */
export function aliasCount(count: number): string {
  return `${count} alias${count === 1 ? "" : "es"}`;
}

/**
 * The table's accessible name.
 *
 * The card's heading names the *card*; a table inside it needs its own name for a reader
 * moving by table rather than by landmark, and this one says what its rows are.
 */
export const TABLE_CAPTION = "Aliases, where each resolves, and whether it is on";

/**
 * The caption line under the table — mockup 21's, **verbatim**.
 *
 * It states the two rules the registry keeps (names are unique, and a referenced alias cannot
 * be deleted), and `__tests__/registry/table.test.ts` reads the mockup and compares, so a
 * paraphrase in implementation fails the suite rather than passing review.
 */
export const TABLE_NOTE =
  "Aliases are unique per workspace. Deleting one is blocked while any route or workflow " +
  "references it.";

/** The card-head link to mockup 07, as the mockup labels it. */
export const MANAGE_PROVIDERS = "Manage providers →";

/* ------------------------------------------------------------------ the table's other states */

/** What the card says when the read behind the table was refused. */
export const TABLE_FAILED_TITLE = "The allowed-models table could not be read";

/**
 * …and what to do about it. The reason is the service's own sentence and is drawn beside this;
 * the page's retry is CI.6's ([#596](https://github.com/NobuData/ouroboros/issues/596)).
 */
export const TABLE_FAILED_NOTE = "Nothing is wrong with the registry — reload the page to try again.";

/** What the card says for a workspace that has no aliases yet. */
export const TABLE_EMPTY_TITLE = "No aliases yet";

/**
 * …and how to get one. The full empty-workspace guidance — the two-step path out, the
 * reader's place on it — is CI.6's ([#596](https://github.com/NobuData/ouroboros/issues/596)).
 */
export const TABLE_EMPTY_NOTE =
  "Create one with + New alias, or import from a connected provider. Every route points at " +
  "an alias, so this is where routing starts.";

/* ------------------------------------------------------------------ the inspector's seat */

/**
 * The inspector card's title while nothing is selected.
 *
 * The mockup's is `EDIT — CODER-MAX`, which is a title about the selected row; with no row
 * selected there is no alias to name, and a card headed `EDIT — ` would be a heading with a
 * hole in it.
 */
export const INSPECTOR_TITLE = "Edit";

/**
 * The inspector card's title for a selected row.
 *
 * @param alias The selected alias, or `null` for none.
 * @returns The mockup's `Edit — coder-max`, or the bare title where there is nothing to name.
 */
export function inspectorTitle(alias: string | null): string {
  return alias === null ? INSPECTOR_TITLE : `${INSPECTOR_TITLE} — ${alias}`;
}

/** What the inspector's seat says it is waiting for. */
export const INSPECTOR_NEXT_TITLE = "The alias inspector arrives next";

/**
 * …and which issues fill the rest of the page.
 *
 * Named rather than mocked, exactly as the frame's empty state was before the table landed:
 * a mocked-up field stack would be indistinguishable in a screenshot from the real one CI.3
 * ships. The selection this seat follows is real, which is what CI.3 builds on.
 */
export const INSPECTOR_NEXT_NOTE =
  "The alias inspector — its fields, rebind selects and used-by chips — arrives with #593; " +
  "the why-aliases and resolution-chain cards with #595, and the role gating and page states " +
  "with #596. Creating and importing aliases works now, from the two actions in the head.";

/* ------------------------------------------------------------------ the switch */

/**
 * A switch's accessible name: what pressing it governs — *Allow coder-max*, with the position
 * in `aria-checked`. The column is **On** in a card called **ALLOWED MODELS**, and this is the
 * verb that column is short for.
 *
 * @param alias The row's alias.
 * @returns The name.
 */
export function switchLabel(alias: string): string {
  return `Allow ${alias}`;
}

/**
 * Why the unbound row's switch cannot be pressed.
 *
 * The contract refuses to enable an alias with no connection (`model_alias_unbound`), and a
 * switch that let the reader press it and then reported the refusal would be a switch that
 * lied for one round trip. So it is inert with this — and the health cell beside it is where
 * the fix is.
 */
export const SWITCH_UNBOUND =
  "No provider is bound to this alias, so it cannot be switched on. Connect one in " +
  "Providers & keys first.";

/** What every switch says to a role that may not press it. */
export const SWITCH_READ_ONLY = "Switching an alias on or off is for workspace owners and admins.";

/** What a switch says when its press did not persist, for any reason but the ones named. */
export const SWITCH_FAILED =
  "The switch could not be saved. Nothing was changed — try again in a moment.";

/** What a switch says when the alias it belongs to has been removed underneath it. */
export const SWITCH_GONE = "This alias has been removed. Reload the page.";

/**
 * Whether switching an alias off has to be confirmed first.
 *
 * Disabling an alias that routes depend on drops their hops through it at the next
 * resolution — silently, unless this table asks first and names them (CH.6,
 * [#589](https://github.com/NobuData/ouroboros/issues/589)). Switching *on* never asks, and
 * neither does switching off an alias nothing references.
 *
 * @param references What references the alias, as served.
 * @returns Whether to confirm before the press takes.
 */
export function needsConfirmation(references: readonly ModelAliasReference[]): boolean {
  return references.length > 0;
}

/**
 * The confirmation's title.
 *
 * @param alias The row's alias.
 * @returns *Switch off coder-std?*
 */
export function switchOffTitle(alias: string): string {
  return `Switch off ${alias}?`;
}

/**
 * The confirmation's note — the consequence, named.
 *
 * @param count How many things reference the alias.
 * @returns The sentence the issue's diagram sketches: *3 routes reference this alias — their
 *   hops through it will be dropped at the next resolution.*
 */
export function switchOffNote(count: number): string {
  return (
    `${usedByCell(count)} reference this alias — their hops through it will be dropped at ` +
    "the next resolution, and routing will continue with whatever each chain has left:"
  );
}

/** The list of referrers in the confirmation, named for a screen reader. */
export const REFERRERS_LABEL = "Routes and rules that reference this alias";

/** The confirmation's control. */
export const SWITCH_OFF_CONFIRM = "Switch off";

/** Every dialog's way out without acting. */
export const CANCEL_LABEL = "Cancel";
