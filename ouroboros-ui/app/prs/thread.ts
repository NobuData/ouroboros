/**
 * The Review thread card, as data ([#368](https://github.com/NobuData/ouroboros/issues/368)) —
 * mockup 12's thread, decided here and drawn by `thread-card.tsx`.
 *
 * ```
 * REVIEW THREAD                                                 3 entries · 0 open
 * claude-fable-5      [self-review] ⌁simulated⌁                          14:29:50
 *   ISR path is allocation-free; verified priority ceiling unchanged. …
 *   ✓ resolved
 * cursor/composer-2   [second opinion · rev 1] (was blocking) ⌁simulated⌁ 14:29:30
 *   ┃ PID velocity sample now lags by one telemetry period — …
 *   │ Addressed in attempt 4 — sampling decoupled from telemetry drain.
 *   ✓ resolved
 * ouroboros policy bot [policy]                                          14:32:32
 *   Auto-merge eligible: standard-fix policy — no human review required …
 * ```
 *
 * **The header is counted from the rows.** `N entries · M open` is the entries on screen, and
 * *open* is `blocking and not resolved` — the payload's own counts are not read, so a card
 * claiming zero open items is claiming it about the rows beneath it.
 *
 * **Provenance is a condition of rendering.** An entry is drawn only when it says who wrote it —
 * a kind this page knows and a name — and a model's entry only when it carries the `simulated`
 * watermark: until AZ.1 ([#371](https://github.com/NobuData/ouroboros/issues/371)) produces real
 * votes, an unwatermarked model entry is an invented reviewer, and {@link entryStanding} refuses
 * it. What is refused is **withheld and said to be**, and still counted: a blocking entry this
 * page will not draw is still open.
 *
 * **The arc is the row's lifecycle.** `was blocking` is `blocking and resolved`; the reply beneath
 * it is the entry's resolving reply; nothing here is composed from a summary.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type {
  PrThread,
  PrThreadAuthorKind,
  PrThreadEntry,
  PrThreadResolution,
  PullRequestPage,
} from "@/app/api/pull-requests";
import { clockOf } from "@/app/test-results/timeline";

import { standing } from "./criteria";
import { httpUrl, latestRevision } from "./view";

/** The card's title — the mockup's `REVIEW THREAD`. */
export const THREAD_TITLE = "Review thread";

/** What the card says for a PR with no entry — the honest state for most PRs in the MVP. */
export const NO_ENTRIES = "No review entries yet";

/** The accessible name of the entries' own scrolling wrapper. */
export const THREAD_ENTRIES_LABEL = "Review thread entries";

/** The pill of an entry that objects to merging and has not been answered. */
export const BLOCKING_PILL = "blocking";

/** The pill of an entry that objected to merging and has been resolved. */
export const WAS_BLOCKING_PILL = "was blocking";

/** The line beneath a resolved entry. */
export const RESOLVED_LINE = "✓ resolved";

/** The watermark a seeded or simulated entry wears (decision R4). */
export const SIMULATED_MARK = "simulated";

/** What the watermark means, as its tooltip and its description. */
export const SIMULATED_NOTE =
  "Seeded for demonstration — no model wrote this entry. Real second-model reviews arrive with the provider stack.";

/** The button on an open entry. */
export const RESOLVE_LABEL = "Reply & resolve";

/** Why the buttons wait while a resolution is being sent. */
export const RESOLVE_SENDING = "The resolution is being sent.";

/** What is said when the entry a dialog was opened for is no longer on the page. */
export const ENTRY_GONE = "That entry is no longer on this PR's thread.";

/** What the card says after an entry was resolved. */
export const ENTRY_RESOLVED = "Entry resolved.";

/** What the card says after an entry was resolved and its reply posted on the host. */
export const ENTRY_RESOLVED_MIRRORED = "Entry resolved · reply posted on the PR";

/** The link beside {@link ENTRY_RESOLVED_MIRRORED}, when the host said where the comment is. */
export const MIRROR_LINK = "view the comment";

/** Who wrote an entry, in words — what the author's hue also says. */
export const AUTHOR_KINDS: Record<PrThreadAuthorKind, string> = {
  model: "model",
  policy_bot: "policy bot",
  human: "person",
};

/** Whether an entry may be drawn, and why not when it may not. */
export type EntryStanding = "drawn" | "unknown_author" | "unwatermarked_model";

/**
 * Whether an entry says enough about who wrote it to be drawn.
 *
 * @param entry The entry, as the payload states it.
 * @returns `drawn`; `unknown_author` for a kind this page does not know or a blank name; and
 *   `unwatermarked_model` for a model's entry without the `simulated` watermark — refused until
 *   #371 gives a real vote provenance to show.
 */
export function entryStanding(entry: PrThreadEntry): EntryStanding {
  if (!Object.hasOwn(AUTHOR_KINDS, entry.authorKind) || entry.authorName.trim() === "") {
    return "unknown_author";
  }

  return entry.authorKind === "model" && entry.simulated !== true
    ? "unwatermarked_model"
    : "drawn";
}

/**
 * Whether an entry is open.
 *
 * @param entry The entry.
 * @returns `true` when it objects to merging and nobody has resolved it. A non-blocking entry is
 *   never open, resolved or not.
 */
export function isOpen(entry: PrThreadEntry): boolean {
  return entry.blocking && !entry.resolved;
}

/**
 * The card's header.
 *
 * @param entries The entries on screen — withheld ones included.
 * @returns `3 entries · 0 open`, counted here.
 */
export function threadHeader(entries: readonly PrThreadEntry[]): string {
  const count = entries.length;

  return `${count} ${count === 1 ? "entry" : "entries"} · ${entries.filter(isOpen).length} open`;
}

/**
 * What the card says about the entries it will not draw.
 *
 * @param count How many were withheld.
 * @returns The sentence, or `null` when none was.
 */
export function withheldNote(count: number): string | null {
  if (count === 0) return null;

  return count === 1
    ? "1 entry is withheld: it does not say who wrote it in a way this page can show. It is still counted above."
    : `${count} entries are withheld: they do not say who wrote them in a way this page can show. They are still counted above.`;
}

/**
 * The tag beside the author.
 *
 * @param entry The entry.
 * @param latestSeq The PR's latest revision, or `null` when it has none.
 * @returns `second opinion · rev 1` for an entry about an earlier revision, and the bare tag for
 *   one about the latest revision or the PR as a whole.
 */
export function entryTag(entry: PrThreadEntry, latestSeq: number | null): string {
  return entry.revisionSeq === null || entry.revisionSeq === latestSeq
    ? entry.tag
    : `${entry.tag} · rev ${entry.revisionSeq}`;
}

/** The pill beside an entry's tag. */
export interface EntryPill {
  /** {@link BLOCKING_PILL} or {@link WAS_BLOCKING_PILL}. */
  readonly label: string;
}

/** One entry, ready to draw. */
export interface ThreadEntryView {
  /** The entry's id. */
  readonly id: string;
  /** The mono author label — `cursor/composer-2`. */
  readonly author: string;
  /** Who wrote it — `model`, `policy_bot` or `human`. */
  readonly kind: PrThreadAuthorKind;
  /** {@link AUTHOR_KINDS}' word for the kind. */
  readonly kindLabel: string;
  /** `second opinion · rev 1`. */
  readonly tag: string;
  /** Whether the entry wears the watermark. */
  readonly simulated: boolean;
  /** When it was said, as the payload states it. */
  readonly at: string;
  /** `14:12:44`, in UTC — or `null` for a moment that is not a date. */
  readonly time: string | null;
  /** What was said. */
  readonly body: string;
  /** Whether the entry objects, or objected, to merging — the accent left border. */
  readonly blocking: boolean;
  /** The blocking pill, or `null` on an entry that never blocked. */
  readonly pill: EntryPill | null;
  /** The resolving reply, or `null`. */
  readonly reply: string | null;
  /** Whether the entry is resolved. */
  readonly resolved: boolean;
  /** Whether *Reply & resolve* is offered. */
  readonly resolve: boolean;
}

/** The card, ready to draw. */
export interface ThreadCardView {
  /** `3 entries · 0 open`. */
  readonly header: string;
  /** The entries drawn, oldest first. */
  readonly rows: readonly ThreadEntryView[];
  /** What is said about the entries withheld, or `null`. */
  readonly withheld: string | null;
  /** Whether the PR has no entry at all. */
  readonly empty: boolean;
}

/** What the card is decided from. */
export interface ThreadCardInput {
  /** The page. */
  readonly page: PullRequestPage;
  /** The entries on screen — the page's, with what this page just resolved (`withResolved`). */
  readonly entries: readonly PrThreadEntry[];
  /** Whether the reader may reply and resolve — owner, admin or member. */
  readonly mayContribute: boolean;
}

/**
 * One entry's row.
 *
 * @param entry The entry — one {@link entryStanding} draws.
 * @param latestSeq The PR's latest revision, or `null`.
 * @param mayContribute Whether the reader may reply and resolve.
 * @returns The row. *Reply & resolve* is offered on an unresolved entry to a reader who may
 *   contribute — never on the policy bot's, which states a rule rather than an objection.
 */
export function entryRow(
  entry: PrThreadEntry,
  latestSeq: number | null,
  mayContribute: boolean,
): ThreadEntryView {
  return {
    id: entry.id,
    author: entry.authorName,
    kind: entry.authorKind,
    kindLabel: AUTHOR_KINDS[entry.authorKind],
    tag: entryTag(entry, latestSeq),
    simulated: entry.simulated,
    at: entry.createdAt,
    time: clockOf(entry.createdAt),
    body: entry.body,
    blocking: entry.blocking,
    pill: !entry.blocking
      ? null
      : { label: entry.resolved ? WAS_BLOCKING_PILL : BLOCKING_PILL },
    reply: entry.resolved ? entry.resolutionBody : null,
    resolved: entry.resolved,
    resolve: mayContribute && !entry.resolved && entry.authorKind !== "policy_bot",
  };
}

/**
 * The card.
 *
 * @param input See {@link ThreadCardInput}.
 * @returns The card: the header counted from every entry, the rows of those that may be drawn,
 *   and what is said about the rest.
 */
export function threadCard(input: ThreadCardInput): ThreadCardView {
  const { page, entries, mayContribute } = input;
  const latestSeq = latestRevision(page)?.seq ?? null;
  const drawn = entries.filter((entry) => entryStanding(entry) === "drawn");

  return {
    header: threadHeader(entries),
    rows: drawn.map((entry) => entryRow(entry, latestSeq, mayContribute)),
    withheld: withheldNote(entries.length - drawn.length),
    empty: entries.length === 0,
  };
}

// --- what this page just resolved ----------------------------------------------------------

/** An entry as an answer on this page stated it, and when. */
export interface LocalEntry {
  readonly entry: PrThreadEntry;
  /** When the answer arrived, in epoch milliseconds. */
  readonly at: number;
}

/**
 * The entries on screen: the page's thread, with what this page just resolved.
 *
 * @param thread The page's thread.
 * @param locals What this page's answers stated, oldest first.
 * @param readAt When the page was last read, in epoch milliseconds, or `null`.
 * @returns The thread's entries in order, each replaced by its standing local when it has one. A
 *   local the thread does not hold is dropped: resolving never adds an entry.
 */
export function withResolved(
  thread: PrThread,
  locals: readonly LocalEntry[],
  readAt: number | null,
): readonly PrThreadEntry[] {
  const newest = new Map<string, PrThreadEntry>();
  for (const local of standing(locals, readAt)) newest.set(local.entry.id, local.entry);

  return thread.entries.map((each) => newest.get(each.id) ?? each);
}

// --- what an answer did --------------------------------------------------------------------

/** What became of a press, said on the card. */
export interface ThreadOutcome {
  readonly text: string;
  readonly failed: boolean;
  /** The mirrored comment on the host, or `null`. */
  readonly link: { readonly label: string; readonly href: string } | null;
}

/**
 * What a resolution did.
 *
 * @param answer The resolution's answer.
 * @returns {@link ENTRY_RESOLVED}; {@link ENTRY_RESOLVED_MIRRORED} with the comment's link when
 *   the host said where it is; or, for a host that refused, that the entry is resolved and the
 *   reply was not posted, with the host's reason — drawn as a failure, because half of what was
 *   asked for did not happen.
 */
export function resolveOutcome(answer: PrThreadResolution): ThreadOutcome {
  const { mirror } = answer;

  if (mirror.state === "failed") {
    const reason = mirror.error?.message ?? "the host did not say why";

    return {
      text: `Entry resolved · the reply was not posted on the PR: ${reason}`,
      failed: true,
      link: null,
    };
  }

  if (mirror.state === "not_requested") {
    return { text: ENTRY_RESOLVED, failed: false, link: null };
  }

  const href = httpUrl(mirror.url);

  return {
    text: ENTRY_RESOLVED_MIRRORED,
    failed: false,
    link: href === null ? null : { label: MIRROR_LINK, href },
  };
}
