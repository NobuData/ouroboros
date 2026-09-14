/**
 * Every decision mockup 21's two right-hand cards make, and every sentence they say — the
 * **WHY ALIASES** explainer and the **RESOLUTION CHAIN** card
 * ([#595](https://github.com/NobuData/ouroboros/issues/595)).
 *
 * These two cards are the only place the page explains itself, and both can become dishonest
 * very easily. This module is where that is prevented, as functions with inputs and outputs:
 *
 * - **The why-card makes three promises in the present tense.** The third — *raw model strings
 *   are rejected at publish time* — is only true because CH.6
 *   ([#589](https://github.com/NobuData/ouroboros/issues/589)) shipped the publish gate. The
 *   row is gated on {@link GOVERNANCE_ENFORCED}, so the copy and the enforcement are one
 *   decision in one place rather than a sentence that can outlive the behaviour it describes.
 * - **The chain card looks like evidence.** A rail ending in `● resolved · 42ms` under a run
 *   number reads as *this happened*. So a run number is printed **only** from a persisted
 *   snapshot; without one the card asks Z.4's Simulate
 *   ([#197](https://github.com/NobuData/ouroboros/issues/197)) and labels the answer
 *   {@link SIMULATED_LABEL} (decision **R9**). There is no path here that composes a run tag
 *   from anything but `snapshot.run.issueNumber`.
 * - **A chain that only renders the happy path teaches the wrong thing.** A dropped hop is
 *   drawn struck, with the resolution's own sentence under it — `alias disabled by …`,
 *   `alias unbound — no provider` — and an alias nothing routes through says so rather than
 *   drawing an empty rail.
 *
 * **Framework-free and pure**, like `app/registry/table.ts` and `app/models/simulation.ts`:
 * nothing here imports React, `next/*` or the server-only client, so every one of those
 * properties is a unit test on a small object.
 *
 * **It renders and never narrates routing.** Every explanation the card prints is the
 * resolution's own, verbatim — a client that wrote its own sentence about why a hop dropped
 * would be a second implementation of routing semantics and would drift from the first
 * (Z.1, [#194](https://github.com/NobuData/ouroboros/issues/194)).
 */

import type { Reading } from "@/app/api/reading";
import type { ResolutionSnapshot } from "@/app/api/registry";
import type { Resolution, RoutingTaskKind } from "@/app/api/routing";
import { outcomeLabel } from "@/app/models/simulation";
import { KIND_LABELS } from "@/app/providers/catalog";

import { NO_PROVIDER, type TableRow } from "./table";

/* ------------------------------------------------------------------ the why-aliases card */

/** The why-card's title, as the mockup writes it. The card head uppercases it. */
export const WHY_TITLE = "Why aliases — the BYOK point";

/** One ✓ row: the claim, and the sentence that makes it concrete. */
export interface WhyRow {
  /** The claim — mockup 21's `<strong>`. */
  readonly title: string;
  /** The example under it, verbatim. */
  readonly body: string;
}

/**
 * Whether publish-time rejection of raw model strings is live.
 *
 * **True since CH.6 ([#589](https://github.com/NobuData/ouroboros/issues/589)) merged**: the
 * workflow publish gate (`ouroboros-rest/src/modules/workflows/publish.gate.ts`) refuses a raw
 * model id or an unknown alias, and routes have only ever been able to name aliases. The flag
 * exists so the governance row's present-tense claim is tied to that fact by name — if the gate
 * were ever withdrawn, this is the one line that takes the sentence down with it.
 */
export const GOVERNANCE_ENFORCED = true;

/** Point an alias somewhere else, and nothing that names it has to change. */
export const WHY_SWAP: WhyRow = {
  title: "Swap providers, keep everything",
  body: "Point coder-max at Bedrock tomorrow; zero workflow or route edits.",
};

/** One model, two keys, two budgets. */
export const WHY_KEYS: WhyRow = {
  title: "Same model, different keys",
  body: "coder-max (prod key, $600 cap) vs coder-max-dev (dev key, $50 cap).",
};

/** The promise CH.6 made true — shown only while {@link GOVERNANCE_ENFORCED} says it is. */
export const WHY_GOVERNANCE: WhyRow = {
  title: "Governance",
  body:
    "Routes and workflows may ONLY reference registry aliases — raw model strings are rejected " +
    "at publish time.",
};

/**
 * The why-card's rows, in the mockup's order.
 *
 * @param enforced Whether publish-time rejection is live. Defaults to
 *   {@link GOVERNANCE_ENFORCED}; a test passes `false` to hold the gate.
 * @returns The three rows — or the first two, because a present-tense claim about behaviour
 *   that has not shipped is not shown at all rather than softened.
 */
export function whyRows(enforced: boolean = GOVERNANCE_ENFORCED): readonly WhyRow[] {
  return enforced ? [WHY_SWAP, WHY_KEYS, WHY_GOVERNANCE] : [WHY_SWAP, WHY_KEYS];
}

/* ------------------------------------------------------------------ which task kind to simulate */

/**
 * What the page knows about the routes an alias sits in — the input the chain card needs to
 * choose a simulation when there is no snapshot.
 */
export type RouteLookup =
  /** A route names the alias; this is the task kind to simulate. */
  | { readonly kind: "routed"; readonly taskKind: string }
  /** The routes were read and none names the alias — there is nothing to simulate. */
  | { readonly kind: "unrouted" }
  /** The routes could not be read, and why — *unrouted* would be a guess. */
  | { readonly kind: "unknown"; readonly reason: string };

/** Why the page cannot say which route an alias sits in, when the lookup has no entry for it. */
export const ROUTES_UNREAD = "The routes could not be read, so there is nothing to simulate.";

/**
 * The alias's **primary task kind**: the task kind the chain card simulates for it.
 *
 * The first kind, in the matrix's own order, whose route has the alias as its **primary** hop —
 * that is the work the alias is for. An alias that is only ever a fallback falls back to the
 * first route that names it anywhere, so a fallback alias still gets a chain rather than a
 * shrug.
 *
 * @param taskKinds The workspace's task kinds, in the order the matrix serves them.
 * @param alias The alias.
 * @returns The task kind's name, or `null` when no route names the alias at all.
 */
export function primaryTaskKind(taskKinds: readonly RoutingTaskKind[], alias: string): string | null {
  const names = (kind: RoutingTaskKind, primaryOnly: boolean): boolean =>
    kind.route?.hops.some((hop) => hop.alias === alias && (!primaryOnly || hop.position === 1)) ??
    false;

  const kind =
    taskKinds.find((candidate) => names(candidate, true)) ??
    taskKinds.find((candidate) => names(candidate, false));

  return kind?.name ?? null;
}

/**
 * Every alias's route lookup, computed once where the page's reads are.
 *
 * @param routes The routing matrix's task kinds, or why they could not be read.
 * @param aliases Every alias name on the page.
 * @returns One lookup per alias. A refused routes read makes every alias `unknown` with the
 *   service's own sentence — never `unrouted`, which would be a claim nobody checked.
 */
export function routeLookups(
  routes: Reading<readonly RoutingTaskKind[]>,
  aliases: readonly string[],
): Readonly<Record<string, RouteLookup>> {
  return Object.fromEntries(
    aliases.map((alias): [string, RouteLookup] => {
      if (!routes.ok) return [alias, { kind: "unknown", reason: routes.reason }];

      const taskKind = primaryTaskKind(routes.value, alias);

      return [alias, taskKind === null ? { kind: "unrouted" } : { kind: "routed", taskKind }];
    }),
  );
}

/**
 * One alias's lookup.
 *
 * @param lookups The page's lookups.
 * @param alias The alias.
 * @returns Its lookup, or `unknown` for an alias the page did not compute one for.
 */
export function routeFor(lookups: Readonly<Record<string, RouteLookup>>, alias: string): RouteLookup {
  return lookups[alias] ?? { kind: "unknown", reason: ROUTES_UNREAD };
}

/* ------------------------------------------------------------------ the chain card's source */

/** Where the chain card's rail came from — the one fact the card must never blur. */
export type ChainSource =
  /** A run resolved through the alias, and this is what it stored. */
  | { readonly kind: "snapshot"; readonly snapshot: ResolutionSnapshot }
  /** No run has; this is what Simulate says a run *would* resolve to. */
  | { readonly kind: "simulated"; readonly resolution: Resolution }
  /** No run has, and no route names the alias, so there is nothing to simulate. */
  | { readonly kind: "unrouted" };

/**
 * What the card's Server Action answers: a source, or the sentence to show instead.
 *
 * A refusal is a value rather than a throw because it is a state to render inside the card —
 * the rest of the page is still the reader's.
 */
export type ChainReading =
  | { readonly ok: true; readonly source: ChainSource }
  | { readonly ok: false; readonly reason: string };

/** What the card says when the service refused without a sentence of its own. */
export const CHAIN_FAILURE = "How this alias resolves could not be read.";

/**
 * The key a reading is held under.
 *
 * It carries the facts a write on this page can change — the switch and the binding — so
 * **disabling an alias and re-viewing it asks again** rather than redrawing the chain it had
 * before the switch moved.
 *
 * @param row The selected row.
 * @param route Its route lookup.
 * @returns A string unique to the question being asked.
 */
export function chainKey(row: Pick<TableRow, "alias" | "enabled" | "provider">, route: RouteLookup): string {
  const where = route.kind === "routed" ? `routed:${route.taskKind}` : route.kind;

  return [row.alias, row.enabled ? "on" : "off", row.provider?.name ?? "", where].join("|");
}

/* ------------------------------------------------------------------ the chain card's rail */

/** How the rail's last dot and its status read. */
export type ChainTone = "ok" | "err" | "neutral";

/** The tag at the head of the card: a stored run, or the simulation label. */
export type ChainTag =
  | { readonly kind: "run"; readonly label: string }
  | { readonly kind: "simulated"; readonly label: string };

/** The selected alias's hop, as the rail draws it. */
export interface ChainHopView {
  /** Whether the resolution dropped it — the hop is then drawn struck. */
  readonly dropped: boolean;
  /** `Anthropic` — the kind's label — or {@link NO_PROVIDER} for an unbound alias. */
  readonly provider: string;
  /** `(key …Xq4A)`, or `null` where no key suffix was recorded. */
  readonly keyLabel: string | null;
  /** The raw model id. */
  readonly modelId: string;
}

/** Everything the rail draws. */
export interface ChainView {
  /** The head's tag. */
  readonly tag: ChainTag;
  /** `implement` — printed as `route.task("implement")`. */
  readonly taskKind: string;
  /** `implement-primary`. */
  readonly routeTag: string;
  /** The selected alias, in the accent. */
  readonly alias: string;
  /** The alias's hop, or `null` when the chain does not name it. */
  readonly hop: ChainHopView | null;
  /** The status beside the model: `resolved · 42ms`, `dropped`, `kept`. */
  readonly status: { readonly tone: ChainTone; readonly label: string };
  /** The hop's own sentence, verbatim, whenever it is not simply the hop that resolved. */
  readonly explanation: string | null;
  /** Why the whole resolution failed, or `null` when it resolved. */
  readonly failure: string | null;
}

/** The card's title, as the mockup writes it. The card head uppercases it. */
export const CHAIN_TITLE = "Resolution chain";

/** The caption under the rail, verbatim. */
export const CHAIN_CAPTION = "Every hop is inspectable in the run console transcript.";

/** The tag a simulated chain carries instead of a run number — decision **R9**, verbatim. */
export const SIMULATED_LABEL = "simulated — live runs arrive with invocation";

/** Why the run tag cannot open the run console yet. */
export const RUN_CONSOLE_SOON =
  "The run console is not built yet — it arrives with its own roadmap (mockup 10), so this " +
  "run cannot be opened from here.";

/** The status word for a dropped hop. The contract's own word. */
export const DROPPED = "dropped";

/** The status word for a kept hop that was not the one that resolved. The contract's own word. */
export const KEPT = "kept";

/** The status for a chain that does not name the selected alias. */
export const NOT_IN_CHAIN = "not in this chain";

/** What the card says while nothing is selected. */
export const CHAIN_EMPTY_TITLE = "No chain to trace";
export const CHAIN_EMPTY_NOTE = "Select a row in the table to see how it resolves.";

/** What the card says about an alias no route names. */
export const UNROUTED_TITLE = "Nothing resolves through this alias yet";
export const UNROUTED_NOTE = "No route names it, so there is no run to show and nothing to simulate.";

/** The unbound reason — the same words the resolution uses for an unbound hop. */
export const ALIAS_UNBOUND = "alias unbound — no provider";

/** The disabled reason, for an alias no route names and so no resolution has described. */
export const ALIAS_DISABLED = "alias disabled";

/**
 * The run tag's text.
 *
 * @param issueNumber The stored run's issue number.
 * @returns `run #482`.
 */
export function runLabel(issueNumber: number): string {
  return `run #${issueNumber.toString()}`;
}

/**
 * The head's tag for a source with a rail.
 *
 * **The only place a run number is composed**, and it is composed from a stored snapshot's run
 * and nothing else — a simulation gets {@link SIMULATED_LABEL} instead, always.
 *
 * @param source A snapshot or a simulation.
 * @returns `run #482`, or the simulated label.
 */
export function chainTag(source: Exclude<ChainSource, { kind: "unrouted" }>): ChainTag {
  return source.kind === "snapshot"
    ? { kind: "run", label: runLabel(source.snapshot.run.issueNumber) }
    : { kind: "simulated", label: SIMULATED_LABEL };
}

/**
 * The key suffix as the card prints it.
 *
 * @param suffix The bare tail — `Xq4A` — or `null`.
 * @returns `(key …Xq4A)`, or `null` when there is no suffix to print. Never a key.
 */
export function keyLabel(suffix: string | null): string | null {
  return suffix === null ? null : `(key …${suffix})`;
}

/**
 * The resolved status.
 *
 * @param durationMs The resolution's duration, or `null` when nobody timed it.
 * @returns `resolved · 42ms`, or `resolved` — never `0ms` as a stand-in for untimed.
 */
export function resolvedLabel(durationMs: number | null): string {
  return durationMs === null ? "resolved" : `resolved · ${durationMs.toString()}ms`;
}

/**
 * The argument of the rail's first line.
 *
 * @param taskKind The task kind.
 * @returns `"implement"`, quoted, as the mockup prints it.
 */
export function taskArgument(taskKind: string): string {
  return `"${taskKind}"`;
}

/**
 * A provider as the rail labels it.
 *
 * The mockup prints `Anthropic` where the stored connection is `Anthropic Claude`; CH.6 carries
 * both `kind` and `displayName` precisely so the label is this card's to choose. The kind's
 * label is mockup 07's own spelling (`app/providers/catalog.ts`), and a kind nobody wrote a
 * label for falls back to the connection's name rather than disappearing.
 *
 * @param provider The hop's provider, or `null`.
 * @returns The label, or {@link NO_PROVIDER}.
 */
export function providerLabel(
  provider: { readonly kind: string; readonly displayName: string } | null,
): string {
  return provider === null ? NO_PROVIDER : (KIND_LABELS[provider.kind] ?? provider.displayName);
}

/** The shape a stored hop and a simulated hop have in common. */
interface AnyHop {
  readonly index: number;
  readonly alias: string;
  readonly modelId: string;
  readonly decision: "kept" | "dropped";
  readonly explanation: string;
  readonly provider: {
    readonly kind: string;
    readonly displayName: string;
    readonly keySuffix?: string | null;
  } | null;
}

/**
 * The rail for one alias, from either source.
 *
 * @param alias The selected alias.
 * @param source A snapshot or a simulation. (An `unrouted` source has no rail; see
 *   {@link unroutedReasons}.)
 * @returns What the rail draws.
 */
export function chainView(
  alias: string,
  source: Exclude<ChainSource, { kind: "unrouted" }>,
): ChainView {
  const facts =
    source.kind === "snapshot"
      ? {
          taskKind: source.snapshot.taskKind,
          routeTag: source.snapshot.routeTag,
          chain: source.snapshot.chain as readonly AnyHop[],
          resolvedIndex: source.snapshot.resolvedHopIndex,
          durationMs: source.snapshot.durationMs,
          // A stored failed run carries no sentence of its own; the outcome's heading is the
          // one the Simulate panel uses for the same outcome, so the two surfaces agree.
          failure: source.snapshot.outcome === "fail_run" ? outcomeLabel("fail_run") : null,
        }
      : {
          taskKind: source.resolution.taskKind,
          routeTag: source.resolution.routeTag,
          chain: source.resolution.chain as readonly AnyHop[],
          resolvedIndex:
            source.resolution.outcome === "resolved"
              ? (source.resolution.chain.find((hop) => hop.decision === "kept")?.index ?? null)
              : null,
          // Simulate times nothing: a simulated chain is never given a duration.
          durationMs: null,
          failure: source.resolution.failure?.explanation ?? null,
        };

  const hop = facts.chain.find((candidate) => candidate.alias === alias) ?? null;

  return {
    tag: chainTag(source),
    taskKind: facts.taskKind,
    routeTag: facts.routeTag,
    alias,
    hop:
      hop === null
        ? null
        : {
            dropped: hop.decision === "dropped",
            provider: providerLabel(hop.provider),
            keyLabel: keyLabel(hop.provider?.keySuffix ?? null),
            modelId: hop.modelId,
          },
    ...hopStatus(hop, facts.resolvedIndex, facts.durationMs),
    failure: facts.failure,
  };
}

/**
 * The status beside the model, and the sentence under the rail.
 *
 * @param hop The alias's hop, or `null`.
 * @param resolvedIndex The hop that resolved, or `null`.
 * @param durationMs The resolution's duration, or `null`.
 * @returns The status and the explanation. The hop that resolved needs no sentence — the rail
 *   is the sentence — and every other hop gets the resolution's own, verbatim.
 */
function hopStatus(
  hop: AnyHop | null,
  resolvedIndex: number | null,
  durationMs: number | null,
): Pick<ChainView, "status" | "explanation"> {
  if (hop === null) return { status: { tone: "err", label: NOT_IN_CHAIN }, explanation: null };

  if (hop.decision === "dropped") {
    return { status: { tone: "err", label: DROPPED }, explanation: hop.explanation };
  }

  if (hop.index === resolvedIndex) {
    return { status: { tone: "ok", label: resolvedLabel(durationMs) }, explanation: null };
  }

  return { status: { tone: "neutral", label: KEPT }, explanation: hop.explanation };
}

/**
 * Why an alias no route names has no chain.
 *
 * @param row The selected row.
 * @returns The reasons, most specific first: unbound, or switched off, and then that nothing
 *   routes through it. Never empty.
 */
export function unroutedReasons(row: Pick<TableRow, "enabled" | "provider">): readonly string[] {
  const state = row.provider === null ? [ALIAS_UNBOUND] : row.enabled ? [] : [ALIAS_DISABLED];

  return [...state, UNROUTED_NOTE];
}

/**
 * What the card says while a chain is being read.
 *
 * @param alias The selected alias.
 * @returns The sentence.
 */
export function chainLoading(alias: string): string {
  return `Reading how ${alias} resolves…`;
}
