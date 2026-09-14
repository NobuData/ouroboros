/**
 * Every state the studio frame can be in that is not *populated* — decided here, as functions
 * with inputs and outputs, and drawn by the screen (S.1,
 * [#147](https://github.com/NobuData/ouroboros/issues/147)).
 *
 * Mockup 04 draws the busy state and nothing else. A real workspace meets the others first —
 * no workflows yet, a rail nobody could read, a link to a workflow that was archived last week,
 * a reader who may only look — and each is a **judgement** about the two reads the page makes,
 * so each lives here as a rule with a unit test rather than as a branch inside a component.
 * S.7 ([#153](https://github.com/NobuData/ouroboros/issues/153)) is where the studio's states
 * are *designed* in full; what is here is what the frame cannot ship without.
 *
 * **Framework-free and pure**, the way `app/workflows/view.ts` is: nothing here imports React,
 * `next/*` or the server-only client. The only import beyond the reads' shape is a `.d.ts`,
 * for the role's four spellings.
 *
 * ### The states, and why there are exactly these
 *
 * | State | What is true | What the head prints |
 * |---|---|---|
 * | `failed` | the rail read was refused | the failure, and the banner's retry below |
 * | `empty` | read fine, no workflows | *No workflows yet*, and the rail's tile is the way out |
 * | `missing` | read fine, the URL names a slug the rail does not hold | *No such workflow*, naming the slug |
 * | `unread` | the rail has it, the workflow itself was refused | the entry's name, version and usage; the banner says why |
 * | `populated` | both reads answered | the name, and the composed subline |
 *
 * `unread` is the one worth a sentence. The head's name, version and usage are the **rail's**
 * facts and are still true when the second read failed, so the page prints them and says what
 * it could not read rather than blanking a head it could have drawn — *one failed read is one
 * degraded region* (`app/api/reading.ts`), applied to a page whose two reads are nested.
 */

import type { Role } from "@/app/api/membership";
import type { WorkflowDetail, WorkflowRailEntry } from "@/app/api/workflows";
import { article } from "@/app/format";

import {
  SEPARATOR,
  type StudioReadings,
  studioSubline,
  versionWord,
} from "./view";

/* ------------------------------------------------------------------ the page's state */

/** Which of the page's states the two reads put it in. */
export type StudioState =
  /** The rail read was refused; `reason` is the service's own sentence. */
  | { readonly kind: "failed"; readonly reason: string }
  /** The workspace has no workflows. */
  | { readonly kind: "empty" }
  /**
   * The rail holds no workflow with the slug the URL named — `slug` is what it named. `null`
   * cannot happen from a route (the landing selects the rail's first entry) and is carried so
   * the type is total rather than trusted.
   */
  | { readonly kind: "missing"; readonly slug: string | null }
  /** The rail has the workflow; the read of the workflow itself was refused. */
  | { readonly kind: "unread"; readonly entry: WorkflowRailEntry; readonly reason: string }
  /** Both reads answered: the frame draws the workflow. */
  | {
      readonly kind: "populated";
      readonly entry: WorkflowRailEntry;
      readonly workflow: WorkflowDetail;
    };

/**
 * Decide the page's state from its reads.
 *
 * The rail decides first, because a refused rail has no answer to *which workflows exist*;
 * then whether there is anything on it; then whether the one asked for is; then whether it
 * could be read.
 *
 * @param readings Everything the reader was able to read, and why not for the rest.
 * @returns The state.
 */
export function studioState(readings: StudioReadings): StudioState {
  if (!readings.rail.ok) return { kind: "failed", reason: readings.rail.reason };
  if (readings.rail.value.length === 0) return { kind: "empty" };

  const { selected } = readings;
  if (selected === null) return { kind: "missing", slug: readings.requested };
  if (!selected.detail.ok) {
    return { kind: "unread", entry: selected.entry, reason: selected.detail.reason };
  }

  return { kind: "populated", entry: selected.entry, workflow: selected.detail.value };
}

/**
 * The workflow the page is about, in the two states that have one.
 *
 * @param state The page's state.
 * @returns Its rail entry, or `null` when nothing is selected.
 */
export function selectedEntry(state: StudioState): WorkflowRailEntry | null {
  return state.kind === "populated" || state.kind === "unread" ? state.entry : null;
}

/* ------------------------------------------------------------------ the page head */

/** What the head prints: the `<h1>`, and the sentence under it. */
export interface StudioHead {
  readonly title: string;
  readonly subline: string;
}

/** The title for a rail that could not be read. */
export const FAILED_TITLE = "Workflows could not be read";

/** …and its subline: what is missing, and where the explanation is. */
export const FAILED_SUBLINE =
  "Nothing on this page could be read. The banner below carries the service's reason, and " +
  "the retry.";

/** The title for a workspace with no workflows. */
export const EMPTY_TITLE = "No workflows yet";

/** …and its subline: the way out, and the one that is coming. */
export const EMPTY_SUBLINE =
  "This workspace has no workflows. Create one from the rail — or, once the template " +
  "library lands (#159), start from a starter.";

/** The title for a URL naming a workflow the rail does not hold. */
export const MISSING_TITLE = "No such workflow";

/**
 * The subline for a URL naming a workflow the rail does not hold.
 *
 * The slug is printed back, in quotes, because *which* one was asked for is the fact the
 * reader most needs — a link from a run that named a workflow since archived is the ordinary
 * way here. It is text content and nothing else: a value from a URL is rendered, never
 * interpreted.
 *
 * @param slug What the URL named, or `null` — see `StudioState`.
 * @returns The sentence.
 */
export function missingSubline(slug: string | null): string {
  return slug === null
    ? "Nothing is selected. Pick a workflow from the rail."
    : `This workspace has no workflow called "${slug}". Pick one from the rail.`;
}

/** What the subline says first when the workflow's own read was refused. */
export const DEFINITION_UNREAD = "Its definition could not be read — the banner below says why.";

/**
 * The subline for a workflow whose rail entry answered and whose own read did not.
 *
 * The two facts the rail carries — the version in force and the usage share — are printed,
 * because they are true; the trigger and the draft's stamp are the refused read's and are
 * not guessed at.
 *
 * @param entry The rail entry.
 * @returns The subline.
 */
export function unreadSubline(entry: WorkflowRailEntry): string {
  return `${DEFINITION_UNREAD} ${[versionWord(entry.currentVersion), entry.usageCaption].join(SEPARATOR)}.`;
}

/**
 * The head, for a state.
 *
 * @param state The page's state.
 * @param now The instant the page was read — what *Last edited 2h ago* is measured from.
 * @returns The title and the subline.
 */
export function studioHead(state: StudioState, now: Date): StudioHead {
  switch (state.kind) {
    case "failed":
      return { title: FAILED_TITLE, subline: FAILED_SUBLINE };
    case "empty":
      return { title: EMPTY_TITLE, subline: EMPTY_SUBLINE };
    case "missing":
      return { title: MISSING_TITLE, subline: missingSubline(state.slug) };
    case "unread":
      return { title: state.entry.name, subline: unreadSubline(state.entry) };
    case "populated":
      return {
        title: state.workflow.name,
        subline: studioSubline(state.workflow, state.entry, now),
      };
  }
}

/* ------------------------------------------------------------------ the failed banners */

/** The banner's headline for a refused rail — the state, in words. */
export const RAIL_FAILED_HEADLINE = "The workflows could not be read.";

/** The banner's headline for a refused workflow. */
export const WORKFLOW_FAILED_HEADLINE = "This workflow could not be read.";

/* ------------------------------------------------------------------ the canvas's seat */

/**
 * The states in which the seat stands empty — every state but `populated`, which is the canvas
 * (S.2, [#148](https://github.com/NobuData/ouroboros/issues/148)) and no seat at all.
 */
export type SeatState = Exclude<StudioState, { kind: "populated" }>;

/** What stands where the canvas would: a title and a note, by state. */
export interface SeatCopy {
  readonly title: string;
  readonly note: string;
}

/** The seat's title for a refused rail. */
export const SEAT_FAILED_TITLE = "Nothing to draw";

/** …and its note, which points at the banner rather than repeating it (DASH-I.7's rule). */
export const SEAT_FAILED_NOTE =
  "Nothing below the head could be read. The banner above carries the service's reason, " +
  "and the retry.";

/** The seat's title for an empty workspace. */
export const SEAT_EMPTY_TITLE = "Nothing to draw yet";

/** …and its note. */
export const SEAT_EMPTY_NOTE =
  "A workflow starts as a blank draft and runs once it is published. The rail's + New " +
  "workflow tile is where one begins.";

/**
 * The note for somebody exploring on a development stack, under the empty seat.
 *
 * The seeded demo workspace is where mockup 04's rail can be seen, and a developer landing on
 * a personal workspace's empty studio should be told where the populated page is rather than
 * left thinking the product has nothing to show — the same note the routing page carries.
 */
export const DEV_SEED_NOTE =
  "Exploring locally? The development seed's acme-robotics workspace carries mockup 04's " +
  "five workflows.";

/** The seat's title for a URL naming a workflow the rail does not hold. */
export const SEAT_MISSING_TITLE = "Nothing selected";

/** …and its note. */
export const SEAT_MISSING_NOTE = "The rail lists every workflow this workspace has.";

/** The seat's title for a workflow whose own read was refused. */
export const SEAT_UNREAD_TITLE = "Nothing to draw";

/** …and its note. */
export const SEAT_UNREAD_NOTE =
  "The definition could not be read, so there is nothing to draw. The banner above says why.";

/**
 * What the seat says, for a state in which it stands empty.
 *
 * Total over {@link SeatState} and not over `StudioState`: a populated page has a canvas where
 * the seat would be, and a sentence for it would be a sentence nothing draws.
 *
 * @param state The page's state, other than populated.
 * @returns The title and the note.
 */
export function seatCopy(state: SeatState): SeatCopy {
  switch (state.kind) {
    case "failed":
      return { title: SEAT_FAILED_TITLE, note: SEAT_FAILED_NOTE };
    case "empty":
      return { title: SEAT_EMPTY_TITLE, note: SEAT_EMPTY_NOTE };
    case "missing":
      return { title: SEAT_MISSING_TITLE, note: SEAT_MISSING_NOTE };
    case "unread":
      return { title: SEAT_UNREAD_TITLE, note: SEAT_UNREAD_NOTE };
  }
}

/* ------------------------------------------------------------------ read-only */

/** What the page says to a reader who may look and not change — a head and a body. */
export interface ReadOnlyNote {
  /** The role, named: *Viewing the studio as a member.* */
  readonly head: string;
  /** What that means here, in one sentence. */
  readonly body: string;
}

/** The sentence every read-only reader gets, whatever their role is called. */
export const READ_ONLY_BODY =
  "Workflows are created, edited and published by an owner or an admin. Everything here " +
  "can be read; nothing here can be changed.";

/**
 * Explain the role rather than silently omitting its controls.
 *
 * A member's studio has no **Publish** and a tile that says why it cannot act — read-only is a
 * rendering mode, not a page of disabled controls — and a page that quietly draws less looks
 * broken rather than scoped. So the page names the role once, near the top, and says what the
 * role means on this page. Total over every role the contract publishes, so the sentence
 * cannot fail to form; the screen draws it only for a role `mayAdminister` refuses.
 *
 * @param role The reader's strongest role, from `primaryRole`.
 * @returns The two sentences.
 */
export function readOnlyNote(role: Role): ReadOnlyNote {
  return { head: `Viewing the studio as ${article(role)} ${role}.`, body: READ_ONLY_BODY };
}
