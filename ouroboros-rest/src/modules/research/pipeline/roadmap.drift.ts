/**
 * Document versus tracker: what differs, and how it is said (CM.5,
 * [#624](https://github.com/NobuData/ouroboros/issues/624)).
 *
 * *"The file and the tracker never drift"* is kept by comparing them, not by assuming it. An item
 * that has been filed is compared with its ticket in the tracker's mirror on three things the
 * document states — the **title**, whether it is **done**, and the **MVP** flag (the `mvp` label)
 * — and the repository's `ROADMAP.md` is compared with the version's projection byte for byte.
 *
 * A difference is never repaired here. It becomes one suggestion, whose text names every
 * difference and whose hint carries them, and applying that suggestion is a re-run like any
 * other.
 */

import { MVP_LABEL, itemsOf, type RoadmapStructure, type TrackerTicket } from "./roadmap.structure";

/** Which side of the round trip a difference is on, and what differs. */
export type DriftField = "missing" | "title" | "state" | "mvp" | "file";

/** One difference. */
export interface DriftDifference {
  readonly field: DriftField;
  /** The item, or null for the file as a whole. */
  readonly itemKey: string | null;
  /** `#744`, or null for the file. */
  readonly ticketKey: string | null;
  /** What the document says. */
  readonly document: string;
  /** What the tracker — or the repository's file — says. */
  readonly tracker: string;
}

/** The agent a drift suggestion is raised by (`doc_suggestions.author_agent`). */
export const DRIFT_AGENT = "drift-detector";

/** The most differences a suggestion's text spells out; the rest are counted. */
export const MAX_NAMED_DIFFERENCES = 8;

/**
 * Compare a version's filed items with the tracker.
 *
 * @param structure - The version's structure.
 * @param tickets - The tracker's mirror, by ticket id.
 * @returns Every difference, in reading order. Items not yet filed are not compared.
 */
export function compareWithTracker(
  structure: RoadmapStructure,
  tickets: ReadonlyMap<string, TrackerTicket>,
): DriftDifference[] {
  const differences: DriftDifference[] = [];

  for (const { item } of itemsOf(structure)) {
    if (item.ticket_id === null) continue;

    const ticket = tickets.get(item.ticket_id);
    const base = { itemKey: item.key, ticketKey: item.ticket_key };

    if (ticket === undefined) {
      differences.push({ ...base, field: "missing", document: "filed", tracker: "no such ticket" });
      continue;
    }

    if (ticket.title !== item.title) {
      differences.push({ ...base, field: "title", document: item.title, tracker: ticket.title });
    }

    const done = ticket.state === "closed";

    if (done !== item.checked) {
      differences.push({
        ...base,
        field: "state",
        document: item.checked ? "done" : "open",
        tracker: done ? "done" : "open",
      });
    }

    const flagged = ticket.labels.includes(MVP_LABEL);

    if (flagged !== item.mvp) {
      differences.push({
        ...base,
        field: "mvp",
        document: item.mvp ? "MVP" : "not MVP",
        tracker: flagged ? "MVP" : "not MVP",
      });
    }
  }

  return differences;
}

/**
 * The difference a hand-edited file is.
 *
 * @param path - The file.
 * @param commitSha - The commit the edit was seen at, or null.
 * @returns The difference.
 */
export function fileDifference(path: string, commitSha: string | null): DriftDifference {
  return {
    field: "file",
    itemKey: null,
    ticketKey: null,
    document: `${path} as generated`,
    tracker: commitSha === null ? "edited in the repository" : `edited at ${commitSha.slice(0, 7)}`,
  };
}

/**
 * One difference as a clause of the suggestion.
 *
 * @param difference - The difference.
 * @returns A clause such as `#744 is done in the tracker and open in the document`.
 */
export function differenceText(difference: DriftDifference): string {
  const name = difference.ticketKey ?? difference.itemKey ?? "the file";

  switch (difference.field) {
    case "missing":
      return `${name} is in the document but no longer in the tracker`;
    case "title":
      return `${name} is titled "${difference.tracker}" in the tracker and "${difference.document}" in the document`;
    case "state":
      return `${name} is ${difference.tracker} in the tracker and ${difference.document} in the document`;
    case "mvp":
      return `${name} is ${difference.tracker} in the tracker and ${difference.document} in the document`;
    case "file":
      return `the file was ${difference.tracker} and no longer matches the document`;
  }
}

/**
 * The suggestion a drift raises.
 *
 * @param differences - At least one difference.
 * @returns Its text — every difference named, up to {@link MAX_NAMED_DIFFERENCES} — and the hint a
 *   re-run is given.
 */
export function driftSuggestion(differences: readonly DriftDifference[]): {
  readonly text: string;
  readonly hint: Record<string, unknown>;
} {
  const named = differences.slice(0, MAX_NAMED_DIFFERENCES).map(differenceText);
  const more = differences.length - named.length;

  return {
    text:
      `Tracker drift — ${named.join("; ")}` +
      (more > 0 ? `; and ${String(more)} more` : "") +
      ". Apply to regenerate the roadmap from what the tracker and the repository now say.",
    hint: {
      drift: differences.map((difference) => ({
        field: difference.field,
        item: difference.itemKey,
        ticket: difference.ticketKey,
        document: difference.document,
        tracker: difference.tracker,
      })),
    },
  };
}
