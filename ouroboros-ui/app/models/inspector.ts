/**
 * Every decision the route inspector makes, as functions with inputs and outputs.
 *
 * The inspector ([#203](https://github.com/NobuData/ouroboros/issues/203)) is mockup 06's
 * **ROUTE — implement-primary** card told in full: each hop's health beside its resolution,
 * the hop-meta line under it, the two policy switches, the cost cap and the registry footnote.
 * Almost none of that is markup. *Which dot a hop wears*, *what its meta line says when the
 * operator wrote none*, *what `$2.5` means in cents* and *what the floor switch's sentence
 * reads* are judgements, and they live here so each acceptance criterion is a unit test on a
 * small object rather than an assertion about rendered text.
 *
 * **Framework-free and pure**, like `app/models/chain.ts` beside it: nothing here imports
 * React, `next/*` or the server-only client. The edits are `chain.ts`'s, the state is
 * `app/models/route-editor.tsx`'s, and the drawing is `app/models/chain-editor.tsx`'s and
 * `app/models/route-policy.tsx`'s.
 *
 * ### The dot is the strip's, not a second opinion
 *
 * A hop's health is the health of the connection its alias is bound to, and that is a fact
 * `GET /api/v1/routing/providers` publishes once (Z.3,
 * [#196](https://github.com/NobuData/ouroboros/issues/196)) — `RouteHop.provider` carries **no
 * status**, and the contract says why: *a status published twice is a status that can be
 * shown two ways at once*. So the inspector looks the hop's provider up in the same read the
 * strip is drawn from, and {@link hopHealth} answers with the strip's own treatment
 * (`providerChip`) rather than one of its own. The chip above the matrix and the dot beside
 * the hop cannot disagree, because they are one decision.
 *
 * Decision **M8** holds here as it holds on the strip: `unknown` is a state, it is a ring
 * rather than a disc, and it is never drawn as healthy. Three more absences get the same ring
 * and their own words — an alias bound to no provider, a strip that could not be read, and a
 * connection the strip does not list — because each is *nothing has reported*, not *fine*.
 *
 * ### The meta line is the operator's, or it is the health's
 *
 * Mockup 06's hop 1 reads *"Primary · API key valid, 42ms to us-east"*, and the seed
 * deliberately stores no such note: *Primary* is the position, *key valid* is the connection's
 * state and `42ms` is a measurement minutes old, and a note that froze those would disagree
 * with the chip the first time a check ran (`R__dev_seed_routing.sql`). So a hop with no note
 * prints its **health line** — the role, the state's word and the strip's composed `meta`,
 * joined by the strip's own separator — which is the shape Z.1's kept-hop explanation takes
 * (`Primary · healthy · 42ms`), so the inspector and the simulate panel read alike. A hop with
 * a note prints the note: the operator's sentence about the hop's *role* outranks a line about
 * its state, and the dot beside it carries the state either way.
 *
 * ### The cap is parsed, never rounded
 *
 * {@link parseMaxCost} turns what a person types into the contract's integer cents by string
 * arithmetic rather than by `Number(text) * 100`, which is a binary float a hair off for most
 * amounts. It refuses a third decimal rather than rounding it — a cap is a promise about money,
 * and a promise the page rounded is not the one that was typed — and it refuses `$0.00`, which
 * the contract defines as *a route that can never run* rather than as no cap.
 */

import type { Reading } from "@/app/api/reading";
import type { ProviderHealth } from "@/app/api/routing";
import { moneyOfCents } from "@/app/format";

import type { DraftHop } from "./chain";
import { NO_PROVIDER } from "./matrix";
import { type ProviderChip, SEPARATOR, providerChip } from "./view";

/* ------------------------------------------------------------------ the health dots */

/**
 * One hop's health, as the dot draws it: the strip's treatment for its connection.
 *
 * The chip's own fields less its identity — the dot has no name to print and addresses no
 * connection of its own. `meta` is carried because the hop's health line prints it.
 */
export type HopHealth = Pick<ProviderChip, "tone" | "dot" | "state" | "meta" | "detail">;

/**
 * The strip, indexed by connection id — or the reason there is no strip.
 *
 * Formed on the server from the page's own health read and handed to the inspector as a
 * plain object rather than a `Map`, because it crosses into a Client Component and a `Map`
 * does not survive the crossing. *Could not be read* is kept as a state rather than as an
 * empty index: a hop looked up in an empty index would read as *not on the strip*, which is a
 * different fact with a different sentence.
 */
export type HopHealthIndex =
  | { readonly ok: true; readonly byProvider: Readonly<Record<string, HopHealth>> }
  | { readonly ok: false; readonly reason: string };

/**
 * The strip as the inspector looks it up.
 *
 * @param providers The page's health read — `GET /api/v1/routing/providers`, or why not.
 * @returns Every connection's treatment by id, or the reason none could be decided.
 */
export function hopHealthIndex(providers: Reading<readonly ProviderHealth[]>): HopHealthIndex {
  if (!providers.ok) return { ok: false, reason: providers.reason };

  const byProvider: Record<string, HopHealth> = {};

  for (const provider of providers.value) {
    const { tone, dot, state, meta, detail } = providerChip(provider);
    byProvider[provider.id] = { tone, dot, state, meta, detail };
  }

  return { ok: true, byProvider };
}

/** The hover for a hop whose alias is bound to no connection — there is nothing to check. */
export const HEALTH_UNBOUND =
  "No provider is bound to this alias, so there is nothing to check — resolution drops the " +
  "hop and says so.";

/** The hover's first part for a hop whose strip could not be read; the read's reason follows. */
export const HEALTH_NOT_READ = "The provider health strip could not be read";

/** The hover for a hop whose connection the strip does not list. */
export const HEALTH_NOT_ON_STRIP =
  "This connection is not on the provider health strip — reload to read both again.";

/**
 * The index a chain drawn with no strip falls back on — a test, a story, a caller that forgot.
 *
 * *Not read* rather than an empty index, so every dot is a ring whose hover says the page
 * did not read the strip, rather than a ring claiming each connection is missing from it.
 */
export const HEALTH_UNREAD: HopHealthIndex = {
  ok: false,
  reason: "the page did not read it",
};

/** The word for a state nobody reported, matching the strip's. */
const UNKNOWN = "unknown";

/**
 * The ring every unreported state wears — the strip's `unknown` treatment, which is the one
 * treatment M8 permits for *nothing has said*.
 *
 * @param state The word beside it.
 * @param detail The hover.
 * @returns The health.
 */
function unreported(state: string, detail: string): HopHealth {
  return { tone: "unknown", dot: "ring", state, meta: null, detail };
}

/**
 * One hop's health, from the strip.
 *
 * @param providerId The connection the hop's alias is bound to, or `null` for an unbound alias.
 * @param index The strip, indexed — or why there is none.
 * @returns The strip's treatment for that connection; or the ring, with a word and a hover
 *   saying which of the three absences this is. Never a healthy dot for a state nobody
 *   reported.
 */
export function hopHealth(providerId: string | null, index: HopHealthIndex): HopHealth {
  if (providerId === null) return unreported(NO_PROVIDER, HEALTH_UNBOUND);
  if (!index.ok) return unreported(UNKNOWN, `${HEALTH_NOT_READ}${SEPARATOR}${index.reason}`);

  return index.byProvider[providerId] ?? unreported(UNKNOWN, HEALTH_NOT_ON_STRIP);
}

/**
 * The dot's hover and accessible name: the state in a word, then the last-checked detail.
 *
 * The word first, because the hover is what a reader who cannot separate two hues opens to
 * learn the state, and the strip's detail — *Last checked … · key validation · …* — is what
 * the ticket asks the dot's `title` to carry.
 *
 * @param health The hop's health.
 * @returns `healthy · Last checked 2026-08-24 09:58 UTC · key validation`.
 */
export function hopHealthTitle(health: HopHealth): string {
  return `${health.state}${SEPARATOR}${health.detail}`;
}

/* ------------------------------------------------------------------ the meta line */

/**
 * What a hop is called — `Primary`, `Fallback 1`, `Fallback 2`.
 *
 * The server's own naming (`routing/explanations.ts`'s `hopRole`), so the line under a hop
 * here and the kept-hop sentence the simulate panel prints for it use one vocabulary.
 *
 * @param position The hop's place in the chain, from 1.
 * @returns The role.
 */
export function hopRole(position: number): string {
  return position <= 1 ? "Primary" : `Fallback ${(position - 1).toString()}`;
}

/**
 * The health line a hop with no note prints: the role, the state's word, and what the last
 * check measured.
 *
 * Composed the way the strip's chip is composed — the state's word added to the service's
 * `meta`, nothing re-derived — and in the shape Z.1's kept-hop explanation takes, so a reader
 * who opens the simulate panel finds the same line under the same hop.
 *
 * @param position The hop's place in the chain, from 1.
 * @param health The hop's health.
 * @returns `Primary · healthy · 42ms`; `Fallback 1 · unknown` for a state nobody reported.
 */
export function hopHealthLine(position: number, health: HopHealth): string {
  return [hopRole(position), health.state, health.meta]
    .filter((part): part is string => part !== null)
    .join(SEPARATOR);
}

/**
 * The line under a hop: the operator's note when there is one, the health line when not.
 *
 * @param hop The hop.
 * @param position Its place in the chain, from 1.
 * @param health Its health.
 * @returns The line. Never empty — a hop with nothing to say about itself still has a role
 *   and a state.
 */
export function hopMetaLine(hop: DraftHop, position: number, health: HopHealth): string {
  return hop.note ?? hopHealthLine(position, health);
}

/* ------------------------------------------------------------------ the policy controls */

/** Mockup 06's first switch, as it prints it. The switch's accessible name too. */
export const ALLOW_LOCAL_LABEL = "Allow fallback to local models";

/**
 * Mockup 06's second switch — its phrasing of `floorHopIndex`, and the page's sharpest
 * promise: the difference between a loop that quietly finishes on a worse model and one that
 * stops and says so.
 *
 * `N` is the floor itself, the hop number the rail prints: the run may degrade to hop `N` and
 * fails rather than going below it. The mockup's *fallback 2* on the three-hop `implement`
 * chain is exactly that — hops 1 and 2 may run, hop 3 may not.
 *
 * @param hop The floor, from 1.
 * @returns The sentence.
 */
export function floorSentence(hop: number): string {
  return `Fail run instead of degrading below fallback ${hop.toString()}`;
}

/** The floor select's accessible name — the number inside the sentence, as a control. */
export const FLOOR_HOP_LABEL = "Floor hop";

/** Mockup 06's field label. */
export const MAX_COST_LABEL = "Max cost per run";

/** What the field says under itself while nothing is wrong with it. */
export const MAX_COST_HINT = "Dollars and cents, as $2.50. Leave it empty for no cap.";

/**
 * Why a member's controls are inert — the design system's permission-limited state
 * (§ 3.3), in the words the rules card uses for its own.
 *
 * The switches and the field still render, in their real positions: a route's policy is part
 * of its story, and a card that hid the policy from a reader who may only read it would look
 * like a route with none.
 */
export const POLICY_READ_ONLY = "Only an owner or an admin can change a route's policy.";

/** Mockup 06's footnote, verbatim. */
export const REGISTRY_NOTE = "Aliases resolve in the Model registry — routes never name raw models.";

/**
 * The footnote's link. The mockup's own label, and a real link rather than the *soon* the
 * ticket was filed expecting: the registry surface went live with CI.1
 * ([#591](https://github.com/NobuData/ouroboros/issues/591)) before this card was built.
 */
export const OPEN_REGISTRY = "Open registry →";

/** The inspector's way into the simulate panel, for the route it is showing. */
export const SIMULATE_ROUTE = "Simulate this route";

/* ------------------------------------------------------------------ the cost cap */

/** What parsing the field produces: the cap in cents, no cap, or why the text is not one. */
export type ParsedCost =
  | { readonly ok: true; readonly cents: number | null }
  | { readonly ok: false; readonly reason: string };

/** Why the field's text is refused: it is not an amount. */
export const COST_MALFORMED =
  "Enter an amount in dollars and cents, as $2.50 — or leave the field empty for no cap.";

/** Why the field's text is refused: it names a fraction of a cent. */
export const COST_TOO_PRECISE = "A cap is whole cents — $2.50, not $2.505.";

/**
 * Why the field's text is refused: it is zero.
 *
 * The contract's own sentence about it: *a cap of zero is not a cap, it is a route that can
 * never run*. The honest way to say *no cap* is an empty field, and this says so.
 */
export const COST_ZERO = "A cap of $0.00 is a route that can never run. Leave the field empty for no cap.";

/**
 * An amount as a person types it: an optional dollar sign, whole dollars with or without
 * thousands separators, and an optional fraction. Either part may be absent, not both — the
 * parser refuses the empty match.
 */
const AMOUNT = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d*))?$/;

/** Cents in a dollar. */
const CENTS_PER_DOLLAR = 100;

/**
 * The cap, from what was typed.
 *
 * @param text The field's value, as typed.
 * @returns `cents: null` for an empty field (no cap); the amount in whole cents for
 *   `2.5`, `$2.50`, `1,250.00` or `.99`; or the reason the text is refused.
 */
export function parseMaxCost(text: string): ParsedCost {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, cents: null };

  const match = AMOUNT.exec(trimmed);
  if (match === null) return { ok: false, reason: COST_MALFORMED };

  const [, whole, fraction] = match;
  if (whole === undefined && (fraction === undefined || fraction === "")) {
    return { ok: false, reason: COST_MALFORMED };
  }
  if (fraction !== undefined && fraction.length > 2) return { ok: false, reason: COST_TOO_PRECISE };

  const dollars = Number((whole ?? "0").replaceAll(",", ""));
  const cents = dollars * CENTS_PER_DOLLAR + Number((fraction ?? "").padEnd(2, "0"));

  if (!Number.isSafeInteger(cents)) return { ok: false, reason: COST_MALFORMED };
  if (cents === 0) return { ok: false, reason: COST_ZERO };

  return { ok: true, cents };
}

/**
 * The cap as the field prints it once it has been accepted.
 *
 * @param cents The cap in integer cents, or `null` for no cap.
 * @returns `$2.50`, or the empty string for no cap — an empty field is what *no cap* looks
 *   like, and what {@link parseMaxCost} reads it back as.
 */
export function formatMaxCost(cents: number | null): string {
  return cents === null ? "" : moneyOfCents(cents);
}
