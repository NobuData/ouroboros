/**
 * Every decision the `/models` frame makes, as functions with inputs and outputs.
 *
 * The page ([#200](https://github.com/NobuData/ouroboros/issues/200)) is a head, a tab set
 * and a health strip. Three of those four things are judgements rather than markup — which
 * treatment a provider's status earns, what its chip says, why an action cannot act — and
 * they live here so that each one's acceptance criteria are a unit test on a small object
 * rather than an assertion about rendered text.
 *
 * **Framework-free and pure.** Nothing here imports React, `next/*` or the server-only
 * client, the same way `app/dashboard/view.ts` and `app/login/view.ts` are pure. The reads
 * are `app/models/data.ts`'s and the drawing is the screen's. The one import beyond the
 * contract's types is `app/paths.ts`, which is value-only for exactly this reason: the tab
 * set names routes, and a route typed out here as a string would be a second spelling of one.
 *
 * Since AE.1 ([#227](https://github.com/NobuData/ouroboros/issues/227)) the tab set at the
 * foot of this file is the **section's** rather than this page's — `/models/providers` draws
 * the same list through `app/models/models-subnav.tsx` — which is why it holds a route for
 * every built surface rather than a marker for the one surface that happened to be this page.
 *
 * ### The rule this module exists to keep
 *
 * The health strip's whole value is that it is trustworthy, and there are exactly three
 * ways a strip like this lies:
 *
 * 1. **It renders an unmeasured state as a healthy one.** Decision **M8**: `unknown` is what
 *    a connection is before anything checked it, and the honest rendering is a chip that is
 *    distinguishable from a green one *without colour vision* — so {@link providerChip}
 *    gives it a ring rather than a disc and a word rather than a hue.
 * 2. **It prints a number nobody measured.** `latencyMs` and `models` are `null` exactly
 *    when no check produced them, and nothing here supplies a default. `0ms` is an excellent
 *    latency for a provider nothing has ever called.
 * 3. **It composes its own sentence.** The service serves `meta` already assembled —
 *    `workstation · 3 models`, `42ms`, `elevated latency` — so that the strip and the route
 *    inspector cannot draw two different sentences from one row. This module renders that
 *    line and adds nothing to it but the state's own word.
 */

import type { Reading } from "@/app/api/reading";
import type {
  ProviderCheck,
  ProviderHealth,
  ProviderStatus,
  RoutingMatrix,
} from "@/app/api/routing";
import { MODELS_PATH, PROVIDERS_PATH, REGISTRY_PATH } from "@/app/paths";

/* ------------------------------------------------------------------ what the page reads */

/**
 * Everything the routing page was able to read, and why it could not read the rest.
 *
 * It lives in this pure module rather than beside the calls that produce it
 * (`app/models/data.ts`, which is server-only) for the reason `DashboardReadings` does: the
 * screen and its tests can then name the shape without pulling `server-only`, `next/headers`
 * and a configured environment in behind it.
 */
export interface ModelsReadings {
  /**
   * The provider health strip ([#196](https://github.com/NobuData/ouroboros/issues/196)),
   * or why it could not be read.
   *
   * A workspace that has configured no providers reads successfully and answers an empty
   * array — an empty strip and a strip nobody could read are different facts, and the page
   * says something different for each.
   */
  readonly providers: Reading<readonly ProviderHealth[]>;
  /**
   * The matrix, the escalation rules and the spend card
   * ([#195](https://github.com/NobuData/ouroboros/issues/195),
   * [#198](https://github.com/NobuData/ouroboros/issues/198)) — or why none of them could be
   * read.
   *
   * One reading for all three because the service serves them in one payload, and that is a
   * correctness property rather than an economy: the matrix's escalation column and the rules
   * card render the same rows, and its `$/run avg` and the spend card's totals are aggregates
   * over the same ledger over the same window. Two readings would be two instants.
   *
   * Independent of {@link ModelsReadings.providers}, which is the rule this whole type is
   * built on — **one failed read is one degraded region, never a blank page**. A workspace
   * whose health strip is unreadable still gets its matrix, and the other way round.
   */
  readonly matrix: Reading<RoutingMatrix>;
}

/* ------------------------------------------------------------------ the health strip */

/**
 * Which treatment a chip takes — one per status the contract publishes.
 *
 * Deliberately *not* the four hues of the token sheet's status family: `unknown` is not a
 * hue, it is the absence of a measurement, and giving it one would make it a fifth kind of
 * claim about the outside world. It carries a shape (a ring) and a word instead, which is
 * why it is named for the state rather than for a colour.
 */
export type ProviderTone =
  /** `active` — a check found it usable. The mockup's green disc. */
  | "ok"
  /** `paused` — an operator switched it off. Intent, not a measurement. */
  | "paused"
  /** `error` — the last check failed, and the chip says how. */
  | "err"
  /** `unknown` — nothing has checked it. Never drawn as healthy. */
  | "unknown";

/**
 * The shape of a chip's dot, which is the signal a reader who cannot separate two hues is
 * left with.
 *
 * The same distinction the {@link "@/app/ui".Chip} primitive draws and for the same reason:
 * filled is a state something *reported*, a ring is a state nobody could report.
 */
export type ProviderDot = "filled" | "ring";

/** One chip on the strip, decided. */
export interface ProviderChip {
  /** The connection's id — the React key, and how every other surface addresses it. */
  readonly id: string;
  /** The chip's name: free text the workspace chose, drawn as it was given. */
  readonly name: string;
  /** Which treatment it takes. */
  readonly tone: ProviderTone;
  /** Whether its dot is a disc or a ring. */
  readonly dot: ProviderDot;
  /**
   * The state, in a word — always present, so hue is never the only signal.
   *
   * The screen shows it beside the name for every state but `ok`, where the mockup draws a
   * bare `Anthropic ●` and the word is left to the accessibility tree. That is a rendering
   * decision; what this module guarantees is that the word exists at all.
   */
  readonly state: string;
  /**
   * The service's composed meta line — `42ms`, `workstation · 3 models` — or `null` when
   * nothing measured is worth printing.
   *
   * Passed through rather than re-derived. `null` rather than `""`, so the screen renders
   * *no element* rather than an empty one: the meta span has its own colour and spacing,
   * and an empty one is a gap that reads as a bug.
   */
  readonly meta: string | null;
  /** The hover line: when it was last checked, which question was asked, and the reason. */
  readonly detail: string;
}

/** The treatment each status earns. */
const TONE: Record<ProviderStatus, ProviderTone> = {
  active: "ok",
  paused: "paused",
  error: "err",
  unknown: "unknown",
};

/**
 * The word each status carries.
 *
 * `error` rather than the mockup's *degraded*, deliberately — see this module's note in
 * `docs/ROADMAP_MOCKUP_06_MODEL_ROUTING.md`. `degraded` is a traffic-derived state that
 * arrives with AB.2 ([#208](https://github.com/NobuData/ouroboros/issues/208)) and no check
 * this product performs today can produce it; V015 defines `error` as *the last check
 * failed, and `health` says how*, which is what the seeded Copilot row actually holds. A
 * screen that printed the nicer word would be naming a state the database does not have.
 */
const STATE_WORD: Record<ProviderStatus, string> = {
  active: "healthy",
  paused: "paused",
  error: "error",
  unknown: "unknown",
};

/** The dot each status takes. A ring is reserved for the state nobody reported. */
const DOT: Record<ProviderStatus, ProviderDot> = {
  active: "filled",
  paused: "filled",
  error: "filled",
  unknown: "ring",
};

/** What the hover calls each kind of check. */
const CHECK_WORD: Record<NonNullable<ProviderCheck>, string> = {
  reachability: "reachability check",
  key_validation: "key validation",
};

/** What separates the parts of a composed line — the mockup's own separator. */
export const SEPARATOR = " · ";

/** What the hover says about a connection nothing has looked at. */
export const NEVER_CHECKED = "Never checked";

/**
 * One provider, as the strip draws it.
 *
 * @param provider The connection and what the last check found, from
 *   `GET /api/v1/routing/providers`.
 * @returns The chip.
 */
export function providerChip(provider: ProviderHealth): ProviderChip {
  return {
    id: provider.id,
    name: provider.displayName,
    tone: TONE[provider.status],
    dot: DOT[provider.status],
    state: STATE_WORD[provider.status],
    meta: provider.meta,
    detail: providerDetail(provider),
  };
}

/**
 * The chip's hover line: *when* it was last checked, *what* was asked, and *why* it is in
 * this state.
 *
 * Three facts and every one of them optional, joined by the same separator the meta line
 * uses. A connection nothing has checked says so in words — {@link NEVER_CHECKED} — rather
 * than showing an empty tooltip, because the reader hovering a ringed dot is asking exactly
 * that question.
 *
 * **The timestamp is UTC and absolute.** A relative *2 minutes ago* would be wrong the
 * moment it was rendered — this page is server-rendered and does not tick — and a localised
 * one would be a second answer to what time it is, differing between the render and any
 * later hydration. `app/dashboard/elapsed.tsx` is where a *moving* duration is done properly
 * and what it costs; a hover is not worth a clock.
 *
 * @param provider The connection and what the last check found.
 * @returns The line. Never empty: the first part always says something.
 */
export function providerDetail(provider: ProviderHealth): string {
  const stamp = utcStamp(provider.checkedAt);

  return [
    stamp === null ? NEVER_CHECKED : `Last checked ${stamp}`,
    provider.check === null ? null : CHECK_WORD[provider.check],
    provider.detail,
  ]
    .filter((part): part is string => part !== null)
    .join(SEPARATOR);
}

/**
 * An instant as `2026-08-23 09:59 UTC`.
 *
 * Built from `toISOString()` rather than from `toLocaleString()` so that the same input
 * produces the same output on every machine that renders it — the reason
 * `app/format.ts` writes its own formatters rather than delegating to `Intl`.
 *
 * @param iso The contract's `date-time`, or `null` when no check has finished.
 * @returns The stamp, or `null` when there was no timestamp or it did not parse. A value
 *   that does not parse is treated as absent rather than thrown on: a strip that failed to
 *   render because one row carried a malformed date would say nothing about the four
 *   providers that are fine.
 */
export function utcStamp(iso: string | null): string | null {
  if (iso === null) return null;

  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;

  const [date, time] = at.toISOString().split("T");
  return `${date} ${time.slice(0, 5)} UTC`;
}

/* ------------------------------------------------------------------ the page head */

/**
 * Why **Save routes** cannot act, or `undefined` when it can.
 *
 * The acceptance criterion is that the control is **disabled while there are no pending
 * changes**, and it is a rule rather than a constant for a reason worth stating: a save
 * button that is always enabled teaches its reader nothing about whether there is anything
 * to save, and one that is always *disabled* teaches them the page is broken. So the number
 * of staged changes decides. AA.1 wrote the rule with nothing to count; the number is the
 * route editor's `pending` since AA.3 ([#202](https://github.com/NobuData/ouroboros/issues/202))
 * — client state, read by `app/models/save-routes-button.tsx` — and the rule did not change.
 *
 * The string is the *explanation*, because that is how a control is switched off in this
 * product: `Button`'s `reason` sets `aria-disabled` and becomes the tooltip, so an inert
 * control cannot exist without saying what is missing (`docs/DESIGN_SYSTEM_APP_SHELL.md`
 * § 3.5).
 *
 * @param pending How many routes have been changed and not yet saved.
 * @returns The reason it is inert, or `undefined` when there is something to save.
 */
export function saveRoutesReason(pending: number): string | undefined {
  return pending > 0 ? undefined : "Nothing to save — no route has been changed.";
}

/** Why **Simulate routing** cannot act: there is no task kind to ask about. */
export const NO_KINDS_TO_SIMULATE =
  "Nothing to simulate — this workspace has no task kinds to route.";

/**
 * Why **Simulate routing** cannot act, or `undefined` when it can.
 *
 * AA.1 held this as a constant naming the issue that would build the panel; since AA.4
 * ([#203](https://github.com/NobuData/ouroboros/issues/203)) the panel exists and the rule is
 * the same shape as {@link saveRoutesReason}'s: a number decides. The number is how many task
 * kinds the matrix has — a workspace whose routing foundations are not seeded, or whose matrix
 * could not be read, has no route to ask about, and the control says so rather than opening a
 * panel with an empty select in it.
 *
 * @param kinds How many task kinds the page holds.
 * @returns The reason it is inert, or `undefined` when there is something to simulate.
 */
export function simulateReason(kinds: number): string | undefined {
  return kinds > 0 ? undefined : NO_KINDS_TO_SIMULATE;
}

/* ------------------------------------------------------------------ the tab set */

/**
 * The Models surfaces that are built — the ids a page may claim as the tab it *is*.
 *
 * A type rather than a list, so the tab set below cannot link to a surface that does not
 * exist: a live tab's id must be one of these and a *soon* tab's must not, and a page asks for
 * its active tab by one of these names. `"registry"` joined the union with CI.1
 * ([#591](https://github.com/NobuData/ouroboros/issues/591)) — and the compiler named the tab
 * that had to change with it, which is exactly what the union is for. `"spend"` is the one
 * left, and AB.4 ([#210](https://github.com/NobuData/ouroboros/issues/210)) is what moves it.
 */
export type ModelsSurface = "routing" | "registry" | "providers";

/** Every tab's id, built or not. */
export type ModelsTabId = ModelsSurface | "registry" | "spend";

/** What every tab carries: a stable id, which is also the React key, and what it says. */
interface ModelsTabBase {
  readonly id: ModelsTabId;
  readonly label: string;
}

/** A tab whose surface exists. It links there. */
export interface LiveModelsTab extends ModelsTabBase {
  readonly id: ModelsSurface;
  /** Where it goes — one of `app/paths.ts`'s, so the tab and the route are one fact. */
  readonly href: string;
}

/**
 * A tab whose surface does not exist yet. It names its owner instead of linking.
 *
 * `note` is required here and impossible on a live tab, which is the honesty pair `NavEntry`
 * already uses for the sidebar's rows: a surface that is not ready is **labelled**, never dead
 * and never a link to a `404`.
 */
export interface SoonModelsTab extends ModelsTabBase {
  readonly id: Exclude<ModelsTabId, ModelsSurface>;
  /** Why it is not reachable — which surface owns it, and when it arrives. */
  readonly note: string;
}

/** One tab of the Models tab set: built and linking, or unbuilt and saying so. */
export type ModelsTab = LiveModelsTab | SoonModelsTab;

/**
 * Whether a tab leads somewhere.
 *
 * @param tab The tab.
 * @returns `true` for a built surface, narrowing the type to the one that carries an `href`.
 */
export function isLiveTab(tab: ModelsTab): tab is LiveModelsTab {
  return "href" in tab;
}

/**
 * The Models tab set, in the order mockup 06 draws it.
 *
 * **One list for every page in the section**, rendered by `app/models/models-subnav.tsx`.
 * That is what makes the tab states correct from both directions: `/models` and
 * `/models/providers` draw the same four tabs and differ only in which one carries
 * `aria-current`. Two pages each keeping a list of their own would be two lists that drift —
 * one linking a surface the other still calls *soon*.
 *
 * **Three of the four are built.** Routing is this roadmap's own; Providers & keys went live
 * with AE.1 ([#227](https://github.com/NobuData/ouroboros/issues/227)), the amendment AA.1 was
 * filed expecting; and Model registry went live with CI.1
 * ([#591](https://github.com/NobuData/ouroboros/issues/591)), which is the second half of the
 * same amendment and mirrors AE.1's change in its own direction. Because the list is one list,
 * the registry becoming a link is one edit here rather than an edit on each of the three pages
 * that draw the row — which is the property that keeps them from disagreeing about it.
 *
 * The spend report is AB.4's ([#210](https://github.com/NobuData/ouroboros/issues/210)) and
 * stays an honest *soon* tab naming its owner rather than linking somewhere that would answer
 * a `404`. Rendering it as a live link would be worse than not rendering it at all; rendering
 * it as a labelled stub tells the reader the shape of the product without lying about its
 * state.
 */
export const MODELS_TABS: readonly ModelsTab[] = [
  { id: "routing", label: "Routing", href: MODELS_PATH },
  { id: "registry", label: "Model registry", href: REGISTRY_PATH },
  { id: "providers", label: "Providers & keys", href: PROVIDERS_PATH },
  {
    id: "spend",
    label: "Spend",
    note: "The full spend report arrives with #210.",
  },
];
