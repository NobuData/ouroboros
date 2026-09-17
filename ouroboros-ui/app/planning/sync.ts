/**
 * Every decision the **Tracker Sync** card makes, and every sentence it says
 * (AM.3, [#285](https://github.com/NobuData/ouroboros/issues/285)).
 *
 * Mockup 09's side column opens with three rows and a cadence tag, and the whole point of the
 * card is that **each of those is a claim somebody could check**, not a label somebody typed.
 * This module is where each claim is composed, so its acceptance criterion is a unit test on a
 * small value rather than an assertion about markup.
 *
 * **Framework-free and pure**, the way `generator.ts` and `gantt.ts` are: nothing here imports
 * React, `next/*` or the server-only client.
 *
 * ### `two-way sync` is a capability, and it is asserted from one
 *
 * The mockup's GitHub row reads `two-way sync · 42 issues`. GitHub earns *two-way* only because
 * AL.2 ([#278](https://github.com/NobuData/ouroboros/issues/278)) gave its provider a write
 * declaration and AL.3 ([#279](https://github.com/NobuData/ouroboros/issues/279)) implemented it —
 * so {@link syncRows} reads `capabilities.write.createTicket` off the catalog entry and says
 * `read sync · N issues` where it is false. A source that can only read must never read
 * *two-way*, because the generator card's push button would contradict it a moment later.
 *
 * There are two further states the mockup does not draw and this card has to, because they are
 * real in this build:
 *
 * - **A kind the catalog does not list at all** has no provider here, so the loop skips it rather
 *   than syncing it (`ticket-source.registry.ts`). The seeded Jira source is exactly this, and
 *   claiming *two-way sync* — or even *read sync* — of it would be the card's one outright lie.
 *   It says so instead, in {@link NO_PROVIDER_DIRECTION}, and the sibling generator card already
 *   disables the same kind for the same reason (`generator.ts`'s `unsupportedReason`).
 * - **A catalog that could not be read** leaves the direction unknown, which is a different fact
 *   from read-only. The row says `sync` with neither adjective and carries the reason.
 *
 * ### The count is the canonical backlog's, not the mirror's
 *
 * `openTicketCount` counts `tickets` — the canonical backlog #285's seed builds — and *not* the
 * `github_issues` mirror mockup 03 counts. The two are different tables on purpose, so the figure
 * is taken from the contract's field rather than recomputed from anything on this page.
 *
 * ### The cadence tag is configuration
 *
 * `every 60s` in the mockup is a *default that has since changed*: the real knob is
 * `OURO_BACKLOG_SYNC_INTERVAL_SECONDS`, whose default is 300 seconds, and 60 is only its minimum.
 * So {@link cadenceTag} formats whatever the listing published and the tag reads `every 5m` on a
 * default deployment — the criterion being that it reflects real poll configuration, not that it
 * reproduces the mockup's number.
 */

import type { Reading } from "@/app/api/reading";
import type {
  TicketSource,
  TicketSourceCatalog,
  TicketSourceCatalogEntry,
  TicketSourceKind,
  TicketSourcePage,
} from "@/app/api/sources";
import type { ChipDot, ChipTone } from "@/app/ui";

import { KIND_FACE, MOCKUP_KINDS, type TrackerTint, unsupportedReason } from "./generator";

/* ------------------------------------------------------------------ the card */

/** The card's heading id — its region's `aria-labelledby` target. */
export const SYNC_TITLE_ID = "planning-sync-title";

/** The card's title, as the mockup names it (the card head upper-cases it). */
export const SYNC_TITLE = "Tracker sync";

/** The row list's accessible name. */
export const SYNC_LIST_LABEL = "Tracker sync status";

/** What the card says when the workspace's sources could not be read. */
export const SYNC_UNREAD = "Tracker sync could not be read.";

/* ------------------------------------------------------------------ the cadence tag */

/** Seconds in a minute, and in an hour — the two the tag ever divides by. */
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;

/**
 * The card head's cadence tag — the mockup's `every 60s`, from real configuration.
 *
 * Spelled in the largest unit that divides evenly, because a cadence is a round number somebody
 * configured: 300 is `every 5m`, not `every 300s`, and 90 stays `every 90s` rather than becoming
 * a fraction of a minute nobody typed.
 *
 * @param seconds The deployment's `pollIntervalSeconds`.
 * @returns The tag's text. A value that is not a positive finite number — which the contract
 *   forbids and a stub could still produce — answers `null`, and the card draws no tag rather
 *   than one reading `every 0s`.
 */
export function cadenceTag(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;

  const whole = Math.round(seconds);

  if (whole % SECONDS_PER_HOUR === 0) return `every ${String(whole / SECONDS_PER_HOUR)}h`;
  if (whole % SECONDS_PER_MINUTE === 0) return `every ${String(whole / SECONDS_PER_MINUTE)}m`;

  return `every ${String(whole)}s`;
}

/**
 * Why the cadence tag is a cadence rather than a countdown — its tooltip.
 *
 * The contract's own caveat, in a sentence: each scheduler jitters its sleep, and a paused or
 * failed source is not polled at all. A tag without this reads as a promise about the next poll.
 */
export const CADENCE_NOTE =
  "How often this deployment polls an active source. Each cycle is jittered, and a paused or " +
  "failed source is not polled until somebody acts.";

/* ------------------------------------------------------------------ the rows */

/** How a row's sync direction stands, which is what decides its sub-line's first phrase. */
export type SyncDirection =
  /** Write capability is live: the tracker can be read *and* filed into. */
  | "two-way"
  /** The provider declares no write: tickets come in, nothing goes out. */
  | "read"
  /** This build has no provider for the kind, so nothing syncs at all. */
  | "no-provider"
  /** The catalog could not be read, so the direction is not known. */
  | "unknown"
  /** Nobody has connected this kind. */
  | "absent";

/** The direction phrase for a source that can be written to. */
export const TWO_WAY_DIRECTION = "two-way sync";

/** …and for one that can only be read. */
export const READ_DIRECTION = "read sync";

/** …and for a kind this build cannot sync at all. */
export const NO_PROVIDER_DIRECTION = "not syncing";

/** …and for one whose direction the catalog could not tell us. */
export const UNKNOWN_DIRECTION = "sync";

/** What the mockup's third row says, verbatim. */
export const NOT_CONNECTED = "not connected";

/** The **connect ↗** control's label, verbatim from the mockup. */
export const CONNECT_LABEL = "connect ↗";

/** Why every kind's direction is unknown when the catalog — which carries it — was unread. */
export const CATALOG_UNREAD_DIRECTION_REASON =
  "Whether this tracker can be written to could not be read.";

/** The phrase each direction contributes to a sub-line. `absent` never reaches it. */
const DIRECTION_PHRASE: Record<SyncDirection, string> = {
  "two-way": TWO_WAY_DIRECTION,
  read: READ_DIRECTION,
  "no-provider": NO_PROVIDER_DIRECTION,
  unknown: UNKNOWN_DIRECTION,
  absent: NOT_CONNECTED,
};

/** One row of the card. */
export interface SyncRow {
  /** A stable React key — the source's id, or `kind:<kind>` for a kind with no source. */
  readonly key: string;
  /** Which tracker. */
  readonly kind: TicketSourceKind;
  /** The two-letter monogram — `GH`. */
  readonly monogram: string;
  /** The monogram's hue, which is `generator.ts`'s so the two cards cannot disagree. */
  readonly tint: TrackerTint;
  /** The row's heading — `GitHub Issues`, or `Jira · PROJ` where the name adds context. */
  readonly name: string;
  /** The sub-line — `two-way sync · 42 issues`, `not connected`. */
  readonly sub: string;
  /** How the direction stands, for a suite to assert without parsing the sub-line. */
  readonly direction: SyncDirection;
  /** The status dot's hue. */
  readonly tone: ChipTone;
  /** The status dot's shape — a ring for a state nobody reported. */
  readonly dot: ChipDot;
  /** The word beside the dot, never the hue alone. */
  readonly state: string;
  /** Why this row reads as it does, where a sentence is owed — the dot's and sub-line's tooltip. */
  readonly reason?: string;
  /** Whether the row offers **connect ↗**. Only a kind nobody connected does. */
  readonly connect: boolean;
}

/**
 * How many issues a row's sub-line reports.
 *
 * @param count The source's `openTicketCount`.
 * @returns `42 issues`, or `1 issue`.
 */
function issuesPhrase(count: number): string {
  return `${String(count)} ${count === 1 ? "issue" : "issues"}`;
}

/**
 * The direction a connected source's sub-line claims, and why when it is not plain.
 *
 * @param kind The source's kind.
 * @param catalog The catalog read, which carries the write capability.
 * @returns The direction, and the sentence the row owes a reader.
 */
function directionOf(
  kind: TicketSourceKind,
  catalog: Reading<TicketSourceCatalog>,
): { direction: SyncDirection; reason?: string } {
  if (!catalog.ok) {
    return { direction: "unknown", reason: CATALOG_UNREAD_DIRECTION_REASON };
  }

  const entry: TicketSourceCatalogEntry | undefined = catalog.value.kinds.find(
    (candidate) => candidate.kind === kind,
  );

  // A kind the catalog does not list has no provider in this build — see the module note.
  if (entry === undefined) {
    return { direction: "no-provider", reason: unsupportedReason(KIND_FACE[kind].label) };
  }

  return entry.capabilities.write.createTicket
    ? { direction: "two-way" }
    : { direction: "read", reason: entry.push.reason ?? undefined };
}

/**
 * The status dot for a connected source.
 *
 * The same three words the settings page's rows use (`app/sources/view.ts`'s `statusPill`), and
 * deliberately so: a reader who has learnt one surface has learnt the other. A source this build
 * cannot sync is drawn `idle` whatever its stored status says, because *active* would be a claim
 * about polling that is not happening.
 *
 * @param source The source.
 * @param direction How its direction stands.
 * @returns The dot's hue, shape and word.
 */
function dotOf(
  source: TicketSource,
  direction: SyncDirection,
): { tone: ChipTone; dot: ChipDot; state: string } {
  if (direction === "no-provider") return { tone: "neutral", dot: "ring", state: "idle" };

  switch (source.status) {
    case "active":
      return { tone: "ok", dot: "filled", state: "ok" };
    case "paused":
      return { tone: "neutral", dot: "ring", state: "paused" };
    case "error":
      return { tone: "err", dot: "filled", state: "error" };
  }
}

/**
 * A connected source's row heading — the mockup's `Jira · ACME workspace`, `Linear · acme-labs`.
 *
 * **The source's own display name**, which is the one thing on the row a person chose: the
 * settings surface (#141) requires it and the seed's are already `GitHub · acme-robotics` and
 * `Jira · PROJ`, so the config context the mockup shows is in it by convention rather than by a
 * rule this module would have to invent. It also keeps this card and the settings list calling
 * the same source the same thing.
 *
 * This is deliberately *not* `trackerOptions`' rule, which prefers the kind's label for a lone
 * source: that is a segmented control where the label is a button and brevity wins, and this is a
 * status row where the context is the point.
 *
 * @param source The source.
 * @returns The heading.
 */
function nameOf(source: TicketSource): string {
  return source.displayName;
}

/**
 * The card's rows — the mockup's three kinds in its order, then any other connected kind.
 *
 * A kind nobody connected is one row saying `not connected`, with **connect ↗** into the sources
 * settings surface (WF-Q.4, [#141](https://github.com/NobuData/ouroboros/issues/141)) — which is
 * what draws the mockup's Linear row. Every connected source is a row of its own, so two GitHub
 * accounts are two rows rather than one summary of both.
 *
 * @param sources The workspace's sources.
 * @param catalog The catalog read, which carries each kind's write capability.
 * @returns The rows, in the mockup's order.
 */
export function syncRows(
  sources: readonly TicketSource[],
  catalog: Reading<TicketSourceCatalog>,
): SyncRow[] {
  const kinds = [
    ...MOCKUP_KINDS,
    ...sources.map((source) => source.kind).filter((kind) => !MOCKUP_KINDS.includes(kind)),
  ].filter((kind, index, all) => all.indexOf(kind) === index);

  return kinds.flatMap((kind): SyncRow[] => {
    const face = KIND_FACE[kind];
    const ofKind = sources.filter((source) => source.kind === kind);

    if (ofKind.length === 0) {
      return [
        {
          key: `kind:${kind}`,
          kind,
          monogram: face.monogram,
          tint: face.tint,
          name: face.label,
          sub: NOT_CONNECTED,
          direction: "absent",
          tone: "neutral",
          dot: "ring",
          state: "idle",
          connect: true,
        },
      ];
    }

    // The kind's direction, decided once: it is a fact about the provider, not about a source,
    // so two GitHub accounts ask the catalog the same question and get the same answer.
    const { direction, reason } = directionOf(kind, catalog);

    return ofKind.map((source): SyncRow => {
      const issues = issuesPhrase(source.openTicketCount);

      return {
        key: source.id,
        kind,
        monogram: face.monogram,
        tint: face.tint,
        name: nameOf(source),
        sub: `${DIRECTION_PHRASE[direction]} · ${issues}`,
        direction,
        ...dotOf(source, direction),
        // A source that is `error` owes the loop's own reason before any capability note: it is
        // the more urgent sentence, and the one a person can act on.
        ...(source.statusReason !== null
          ? { reason: source.statusReason }
          : reason === undefined
            ? {}
            : { reason }),
        connect: false,
      };
    });
  });
}

/**
 * The cadence tag for a page of sources, or nothing when there is none to state.
 *
 * @param page The listing, or a failure. A failed read has no cadence to publish — the card
 *   draws no tag rather than a default it would be inventing.
 * @returns The tag's text, or `null`.
 */
export function cadenceOf(page: Reading<TicketSourcePage>): string | null {
  return page.ok ? cadenceTag(page.value.pollIntervalSeconds) : null;
}
