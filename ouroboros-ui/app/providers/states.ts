/**
 * Every state the `/models/providers` page can be in that is not *populated* — decided
 * here, as functions with inputs and outputs, and drawn by the screen (AE.6,
 * [#232](https://github.com/NobuData/ouroboros/issues/232)).
 *
 * Mockup 07 draws five cards and nothing else. A fresh organization has no providers, no
 * keys and no spend — and that is the state every new tenant sees first, so it has to guide
 * rather than blank. A member sees the same cards and may change none of them, and a page
 * that quietly drew fewer controls would look broken rather than scoped. And a read that
 * failed is a different fact from a workspace that is empty, and the two must not share a
 * treatment. Each is a **judgement** about the reads the page makes, so each lives here as a
 * rule with a unit test rather than as a branch inside a component — the shape
 * `app/models/states.ts` gave the routing page.
 *
 * **Framework-free and pure**: nothing here imports React, `next/*` or the server-only
 * client. The imports beyond the reads' shape are types.
 *
 * ### The states, and why there are exactly these
 *
 * | State | What is true | What the page draws |
 * |---|---|---|
 * | `failed` | the listing was refused | the retry banner, and a seat that says so once |
 * | `empty` | the listing answered no connections | *Connect your first provider*, with a role-aware call to action |
 * | `populated` | at least one connection | the cards, and the dashed card after them |
 *
 * The four grid-wide reads beside the listing — the catalog, the health strip, the month's
 * spend, the registry's aliases — are a second question, answered by {@link degradedReads}:
 * each failing degrades one region of every card (`app/providers/data.ts` says how), and
 * DASH-I.7's rule ([#86](https://github.com/NobuData/ouroboros/issues/86)) is that the
 * *reason* is said once, in a banner, with the retry — never once per card.
 */

import type { Role } from "@/app/api/membership";
import { article } from "@/app/format";

import type { ProvidersReadings } from "./data";

/* ------------------------------------------------------------------ the page's state */

/** Which of the page's states the listing puts it in. */
export type ProvidersState =
  /** The listing was refused; `reason` is the service's own sentence. */
  | { readonly kind: "failed"; readonly reason: string }
  /** The listing answered, and the workspace has connected nothing. */
  | { readonly kind: "empty" }
  /** At least one connection: the grid draws. */
  | { readonly kind: "populated" };

/**
 * Decide the page's state from its listing.
 *
 * Only the listing decides, because it is the one read the grid cannot survive: every other
 * read degrades a region of a card that is still drawn.
 *
 * @param readings Everything the reader was able to read, and why not for the rest.
 * @returns The state.
 */
export function providersState(readings: ProvidersReadings): ProvidersState {
  if (!readings.connections.ok) return { kind: "failed", reason: readings.connections.reason };
  if (readings.connections.value.length === 0) return { kind: "empty" };

  return { kind: "populated" };
}

/* ------------------------------------------------------------------ degraded reads */

/** One grid-wide read that failed: what it was, in the page's words, and what the service said. */
export interface DegradedRead {
  /** The read, named for a reader — *The provider catalog*. */
  readonly what: string;
  /** The service's own sentence. */
  readonly reason: string;
}

/** The catalog's name in the banner — every card's schema and capabilities. */
export const CATALOG_READ = "The provider catalog";

/** The health strip's — every card's pill detail and error class. */
export const HEALTH_READ = "The health strip";

/** The month's — every card's meter. */
export const SPEND_READ = "This month's spend";

/** The registry's — every switch's and delete's dependent routes. */
export const ALIASES_READ = "The registry's aliases";

/**
 * The grid-wide reads that failed, in the order the reader makes them.
 *
 * The per-connection reads — each card's models and pulls — are deliberately not here: the
 * models region prints its own reason on the card it belongs to, and a banner that repeated
 * it would be the nine-times-over problem DASH-I.7 was written against.
 *
 * @param readings The readings.
 * @returns What failed. Empty when nothing did — which is what decides whether the banner
 *   is drawn at all.
 */
export function degradedReads(readings: ProvidersReadings): readonly DegradedRead[] {
  const reads = [
    [CATALOG_READ, readings.catalog],
    [HEALTH_READ, readings.health],
    [SPEND_READ, readings.spend],
    [ALIASES_READ, readings.aliases],
  ] as const;

  return reads.flatMap(([what, reading]) =>
    reading.ok ? [] : [{ what, reason: reading.reason }],
  );
}

/**
 * The banner's reason for a degraded page — each failed read named, with what the service
 * said about it, as one sentence per read.
 *
 * @param reads What failed. Never empty when this is called; an empty list answers an empty
 *   string rather than throwing, because a banner is the wrong place to crash.
 * @returns *The provider catalog: <reason> · This month's spend: <reason>*.
 */
export function degradedReason(reads: readonly DegradedRead[]): string {
  return reads.map((read) => `${read.what}: ${read.reason}`).join(" · ");
}

/** The banner's headline when the listing answered and some other read did not. */
export const DEGRADED_HEADLINE = "Part of every card could not be read.";

/* ------------------------------------------------------------------ the failed read */

/** The banner's headline for a refused listing — the state, in words. */
export const PROVIDERS_FAILED_HEADLINE = "The provider connections could not be read.";

/** What the grid's seat says under the banner, in place of the cards. */
export const GRID_FAILED_TITLE = "Nothing here could be read";

/**
 * …and the note under it.
 *
 * The reason is the banner's and is said **once** (DASH-I.7's rule): the seat says what is
 * missing and where the explanation is, and repeats neither the sentence nor the retry.
 */
export const GRID_FAILED_NOTE =
  "The banner above carries the service's reason, and the retry. A provider can still be " +
  "connected from the card beside this one.";

/* ------------------------------------------------------------------ the empty workspace */

/** The guidance's title — the one step a fresh workspace has. */
export const EMPTY_TITLE = "Connect your first provider";

/** …and what connecting one gives it. */
export const EMPTY_NOTE =
  "No providers, no keys and no spend yet. Connecting a provider — an API key, or a host " +
  "on your own network — draws the first card here and gives routing something to " +
  "resolve to.";

/**
 * What a reader who may not connect one is told instead of the button.
 *
 * An explanation rather than an inert control: the empty state is the first thing a new
 * member sees, and a disabled button with a tooltip is a worse first sentence than one that
 * says who can act and what will appear once they have.
 */
export const EMPTY_MEMBER_NOTE =
  "Connecting a provider is for workspace owners and admins. Ask one of them to connect " +
  "the first one — its card will be readable here the moment it exists.";

/* ------------------------------------------------------------------ read-only */

/** What the page says to a reader who may look and not change — a head and a body. */
export interface ReadOnlyNote {
  /** The role, named: *Viewing providers as a member.* */
  readonly head: string;
  /** What that means here, in two sentences. */
  readonly body: string;
}

/**
 * The sentences every read-only reader gets, whatever their role is called.
 *
 * They say what the page's controls do rather than listing which are missing, and they
 * state the rule the cards keep: a control that would write is **drawn**, switched off, with
 * its reason as the tooltip — the switch, Test connection, Refresh models, Pull latest, the
 * address and the cap — and the two affordances that exist only to write, the key actions
 * and the card menu, are not drawn at all.
 */
export const READ_ONLY_BODY =
  "Providers are connected, switched, tested and capped by an owner or an admin, and " +
  "their keys and addresses are theirs to change. Every card here can be read; each " +
  "control that would write is drawn switched off with its reason, and the key actions " +
  "are not drawn at all.";

/**
 * Explain the role rather than leaving a page of switched-off controls to explain itself.
 *
 * Total over every role the contract publishes, so the sentence cannot fail to form; the
 * screen draws it only for a role `app/api/membership.ts`'s `mayAdminister` refuses, which is
 * the one place deciding what a role may do.
 *
 * @param role The reader's strongest role, from `primaryRole`.
 * @returns The two parts.
 */
export function readOnlyNote(role: Role): ReadOnlyNote {
  return { head: `Viewing providers as ${article(role)} ${role}.`, body: READ_ONLY_BODY };
}
