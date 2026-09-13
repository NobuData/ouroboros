/**
 * Every state the ticket-sources page can be in that is not *a list of sources* — decided
 * here, as functions with inputs and outputs, and drawn by the screen
 * ([#141](https://github.com/NobuData/ouroboros/issues/141)).
 *
 * A fresh workspace has no sources, and that is the state every new tenant sees first, so it
 * has to guide rather than blank. A member sees the same rows and may change none of them,
 * and a page that quietly drew fewer controls would look broken rather than scoped. And a
 * read that failed is a different fact from a workspace that is empty. Each is a judgement
 * about the reads the page makes — the shape `app/providers/states.ts` gave its page.
 *
 * **Framework-free and pure.**
 *
 * | State | What is true | What the page draws |
 * |---|---|---|
 * | `failed` | the listing was refused | the retry banner, and a seat that says so once |
 * | `empty` | the listing answered no sources | *Connect your first ticket source*, with a role-aware call to action |
 * | `populated` | at least one source | the rows |
 *
 * The catalog beside the listing is a second question, answered by {@link degradedReads}: it
 * failing degrades every row's summary to the stored config's own keys and the add dialog to
 * its own retry, and DASH-I.7's rule ([#86](https://github.com/NobuData/ouroboros/issues/86))
 * is that the *reason* is said once, in a banner, with the retry.
 */

import type { Role } from "@/app/api/membership";
import { article } from "@/app/format";

import type { SourcesReadings } from "./data";

/* ------------------------------------------------------------------ the page's state */

/** Which of the page's states the listing puts it in. */
export type SourcesState =
  /** The listing was refused; `reason` is the service's own sentence. */
  | { readonly kind: "failed"; readonly reason: string }
  /** The listing answered, and the workspace has configured nothing. */
  | { readonly kind: "empty" }
  /** At least one source: the rows draw. */
  | { readonly kind: "populated" };

/**
 * Decide the page's state from its listing.
 *
 * @param readings Everything the reader was able to read, and why not for the rest.
 * @returns The state.
 */
export function sourcesState(readings: SourcesReadings): SourcesState {
  if (!readings.sources.ok) return { kind: "failed", reason: readings.sources.reason };
  if (readings.sources.value.length === 0) return { kind: "empty" };

  return { kind: "populated" };
}

/* ------------------------------------------------------------------ degraded reads */

/** One page-wide read that failed: what it was, in the page's words, and what the service said. */
export interface DegradedRead {
  /** The read, named for a reader. */
  readonly what: string;
  /** The service's own sentence. */
  readonly reason: string;
}

/** The catalog's name in the banner — every row's field labels, and the add dialog's forms. */
export const CATALOG_READ = "The source catalog";

/**
 * The page-wide reads that failed.
 *
 * The per-source status reads are deliberately not here: a row whose status could not be
 * read prints its own line from the listing's columns, which carry the same `status`,
 * `statusReason` and `syncedAt`, and a banner that repeated it would be the nine-times-over
 * problem DASH-I.7 was written against.
 *
 * @param readings The readings.
 * @returns What failed. Empty when nothing did.
 */
export function degradedReads(readings: SourcesReadings): readonly DegradedRead[] {
  return readings.catalog.ok ? [] : [{ what: CATALOG_READ, reason: readings.catalog.reason }];
}

/**
 * The banner's reason for a degraded page.
 *
 * @param reads What failed. Never empty when this is called; an empty list answers an empty
 *   string rather than throwing.
 * @returns *The source catalog: <reason>*.
 */
export function degradedReason(reads: readonly DegradedRead[]): string {
  return reads.map((read) => `${read.what}: ${read.reason}`).join(" · ");
}

/** The banner's headline when the listing answered and the catalog did not. */
export const DEGRADED_HEADLINE = "Part of every row could not be read.";

/* ------------------------------------------------------------------ the failed read */

/** The banner's headline for a refused listing. */
export const SOURCES_FAILED_HEADLINE = "The ticket sources could not be read.";

/** What the list's seat says under the banner, in place of the rows. */
export const LIST_FAILED_TITLE = "Nothing here could be read";

/** …and the note under it. The reason is the banner's and is said once. */
export const LIST_FAILED_NOTE =
  "The banner above carries the service's reason, and the retry. A source can still be " +
  "added from the head's action.";

/* ------------------------------------------------------------------ the empty workspace */

/** The guidance's title — the one step a fresh workspace has. */
export const EMPTY_TITLE = "Connect your first ticket source";

/** …and what connecting one gives it. */
export const EMPTY_NOTE =
  "No trackers are connected, so there is nothing to mirror yet. Adding a source — a GitHub " +
  "account and its repositories today — draws the first row here, and its tickets appear in " +
  "the backlog the moment the first sync runs.";

/**
 * What a reader who may not add one is told instead of the button.
 *
 * An explanation rather than an inert control: a disabled button with a tooltip is a worse
 * first sentence than one that says who can act.
 */
export const EMPTY_MEMBER_NOTE =
  "Adding a ticket source is for workspace owners and admins. Ask one of them to connect the " +
  "first one — its row will be readable here the moment it exists.";

/* ------------------------------------------------------------------ read-only */

/** What the page says to a reader who may look and not change — a head and a body. */
export interface ReadOnlyNote {
  /** The role, named: *Viewing ticket sources as a member.* */
  readonly head: string;
  /** What that means here. */
  readonly body: string;
}

/**
 * The sentences every read-only reader gets, whatever their role is called.
 *
 * They state the rule the rows keep: a control that would write — test, sync, pause,
 * configure — is **drawn**, switched off, with its reason as the tooltip, and the add action
 * is drawn inert the same way.
 */
export const READ_ONLY_BODY =
  "Sources are added, configured, tested, synced and paused by an owner or an admin. Every " +
  "row here can be read; each control that would write is drawn switched off with its reason.";

/**
 * Explain the role rather than leaving a page of switched-off controls to explain itself.
 *
 * @param role The reader's strongest role, from `primaryRole`.
 * @returns The two parts.
 */
export function readOnlyNote(role: Role): ReadOnlyNote {
  return { head: `Viewing ticket sources as ${article(role)} ${role}.`, body: READ_ONLY_BODY };
}
