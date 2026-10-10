/**
 * Proposed from gaps — the epic, ticket stubs and effort roll-up a gap analysis proposes, derived
 * from its matrix (CM.2, [#621](https://github.com/NobuData/ouroboros/issues/621)).
 *
 * Mockup 22's chip row reads
 *
 *   Proposed from gaps:  [EPIC · Docking parity] [DOCK-1 wind-feedforward MPC]
 *                        [DOCK-2 re-planned retry] [+3 more]  L
 *
 * and **Draft epic from gaps →** (#624) turns the same thing into Planning drafts. So there is
 * one derivation, here, and both call it — the chips cannot preview something the button will
 * not create.
 *
 * The stubs are the investigation's own: the `gap_analysis@1` playbook writes, beside the matrix
 * rows, an `epic` name and `tickets`, each naming the `capability` row it closes:
 *
 *   {"epic": "Docking parity",
 *    "tickets": [{"key": "DOCK-1", "title": "wind-feedforward MPC", "effort": "m",
 *                 "capability": "Docking in >8 m/s gusts", "sources": [id…]}]}
 *
 * **A stub survives only if its row's stored severity is `high` or `med`** — the severity the
 * rule derived, not the one proposed. A stub for a row we lead on, one in flight, or a capability
 * the matrix does not have, is dropped. Stubs keep the order the investigation gave them.
 *
 * **Effort rolls up by points:** `xs` 1 · `s` 2 · `m` 3 · `l` 5 · `xl` 8, summed over the
 * surviving stubs that carry an effort, then read back as a size: up to 1 `xs`, up to 3 `s`, up
 * to 8 `m`, up to 20 `l`, beyond that `xl` — and never smaller than the largest stub. RS-127's
 * five stubs, `m m m l s`, are 16 points — `l`.
 *
 * Reading is lenient where the matrix's is strict: a malformed stub is skipped, not refused,
 * because a proposal is a suggestion and the matrix is evidence.
 */

import type { EstimateEffort, MatrixGapSeverity } from "../../db/schema";
import { isRecord, key } from "./matrix.input";

/** How many ticket stubs the chip row names before `+N more`. */
export const TOP_TICKETS = 2;

/** The most stubs a proposal carries. */
export const MAX_TICKETS = 50;

const MAX_TITLE = 200;
const TICKET_KEY = /^[A-Z][A-Z0-9]{0,9}-[1-9][0-9]{0,3}$/;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** What each effort size is worth when rolled up. */
export const EFFORT_POINTS: Readonly<Record<EstimateEffort, number>> = {
  xs: 1,
  s: 2,
  m: 3,
  l: 5,
  xl: 8,
};

/** The most points each size covers, smallest first; above the last is `xl`. */
const EFFORT_CEILINGS: readonly (readonly [EstimateEffort, number])[] = [
  ["xs", 1],
  ["s", 3],
  ["m", 8],
  ["l", 20],
];

/** A matrix row, as the derivation needs it. */
export interface GapRow {
  readonly capability: string;
  readonly severity: MatrixGapSeverity;
}

/** One proposed ticket. */
export interface ProposedTicket {
  /** `DOCK-1`. */
  readonly key: string;
  readonly title: string;
  /** `DOCK-1 wind-feedforward MPC` — the chip. */
  readonly label: string;
  readonly effort: EstimateEffort | null;
  /** The matrix row it closes. */
  readonly capability: string;
  /** That row's stored severity. */
  readonly severity: "high" | "med";
  /** `source_records` ids the stub cites; empty when it cites none of its own. */
  readonly sources: readonly string[];
}

/** The proposal a gap analysis makes. */
export interface GapProposals {
  /** The epic's name, and its chip — `EPIC · Docking parity`. */
  readonly epic: { readonly title: string; readonly label: string };
  /** Every surviving stub, in the investigation's order. */
  readonly tickets: readonly ProposedTicket[];
  /** The first {@link TOP_TICKETS} — the stubs the chip row names. */
  readonly top: readonly ProposedTicket[];
  /** How many more there are — the `+3 more` chip. */
  readonly more: number;
  /** The roll-up; null when no surviving stub carries an effort. */
  readonly effort: EstimateEffort | null;
}

/**
 * Derive the proposal from a matrix input and the matrix's stored rows.
 *
 * @param payload - The stored `matrix` deliverable input; null when the investigation has none.
 * @param rows - The matrix's rows with their stored severities.
 * @returns The proposal, or null when the input names no epic or no stub survives.
 */
export function proposeFromGaps(
  payload: Record<string, unknown> | null,
  rows: readonly GapRow[],
): GapProposals | null {
  if (payload === null) return null;

  const epic = payload["epic"];
  if (typeof epic !== "string" || epic.trim() === "" || epic.trim().length > MAX_TITLE) {
    return null;
  }

  const gaps = new Map<string, GapRow & { severity: "high" | "med" }>();
  for (const row of rows) {
    if (row.severity === "high" || row.severity === "med") {
      gaps.set(key(row.capability), { capability: row.capability, severity: row.severity });
    }
  }

  const listed = Array.isArray(payload["tickets"]) ? payload["tickets"] : [];
  const tickets: ProposedTicket[] = [];
  const seen = new Set<string>();
  for (const candidate of listed.slice(0, MAX_TICKETS)) {
    const stub = readStub(candidate);
    const gap = stub === null ? undefined : gaps.get(key(stub.capability));
    if (stub === null || gap === undefined || seen.has(stub.key)) continue;

    seen.add(stub.key);
    tickets.push({
      key: stub.key,
      title: stub.title,
      label: `${stub.key} ${stub.title}`,
      effort: stub.effort,
      capability: gap.capability,
      severity: gap.severity,
      sources: stub.sources,
    });
  }
  if (tickets.length === 0) return null;

  const title = epic.trim();
  return {
    epic: { title, label: `EPIC · ${title}` },
    tickets,
    top: tickets.slice(0, TOP_TICKETS),
    more: Math.max(0, tickets.length - TOP_TICKETS),
    effort: rollUpEffort(tickets.map((ticket) => ticket.effort)),
  };
}

/**
 * Roll efforts up into one size.
 *
 * @param efforts - Each stub's effort; null where it carries none.
 * @returns The size the summed points read back as, or the largest stub's when that is bigger;
 *   null when no stub carries an effort.
 */
export function rollUpEffort(efforts: readonly (EstimateEffort | null)[]): EstimateEffort | null {
  const sized = efforts.filter((effort): effort is EstimateEffort => effort !== null);
  if (sized.length === 0) return null;

  const points = sized.reduce((sum, effort) => sum + EFFORT_POINTS[effort], 0);
  const summed = EFFORT_CEILINGS.find(([, ceiling]) => points <= ceiling)?.[0] ?? "xl";
  const largest = sized.reduce((top, effort) =>
    EFFORT_POINTS[effort] > EFFORT_POINTS[top] ? effort : top,
  );

  return EFFORT_POINTS[summed] >= EFFORT_POINTS[largest] ? summed : largest;
}

/**
 * @param candidate - A stub as stored.
 * @returns Its key, title, effort, capability and sources; null when it is not a usable stub.
 */
function readStub(candidate: unknown): {
  key: string;
  title: string;
  effort: EstimateEffort | null;
  capability: string;
  sources: string[];
} | null {
  if (!isRecord(candidate)) return null;

  const { key: ticketKey, title, capability, effort, sources } = candidate;
  if (typeof ticketKey !== "string" || !TICKET_KEY.test(ticketKey)) return null;
  if (typeof title !== "string" || title.trim() === "" || title.trim().length > MAX_TITLE) {
    return null;
  }
  if (typeof capability !== "string" || capability.trim() === "") return null;

  return {
    key: ticketKey,
    title: title.trim(),
    effort:
      typeof effort === "string" && effort in EFFORT_POINTS ? (effort as EstimateEffort) : null,
    capability,
    sources: Array.isArray(sources)
      ? [
          ...new Set(
            sources
              .filter((id): id is string => typeof id === "string" && UUID.test(id))
              .map((id) => id.toLowerCase()),
          ),
        ]
      : [],
  };
}
