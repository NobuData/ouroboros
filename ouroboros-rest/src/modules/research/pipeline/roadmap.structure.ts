/**
 * A roadmap version's structure, and the three things done to it (CM.5,
 * [#624](https://github.com/NobuData/ouroboros/issues/624)): **merge** a skill's answer over the
 * version before it, **write back** what was filed, and **project** it as Markdown.
 *
 * The structure is V113's (`roadmap_doc_versions.structure`), stored as written here:
 *
 * ```
 * {milestones: [{key, name, target_date,
 *                items: [{key, title, draft_id, ticket_id, ticket_key, mvp, effort, checked}]}]}
 * ```
 *
 * **Who owns which field.** `create-roadmap` owns what the roadmap *says* — milestones, their
 * dates, items, titles, MVP flags, efforts. This service owns what only it can know: the Planning
 * draft and the ticket an item became, and whether that ticket is closed. So a re-run's answer is
 * merged by **item key**: an item that survives keeps its draft and its issue; one the skill
 * dropped loses nothing but its place in the document; a new one starts with neither.
 *
 * **The Markdown is a projection.** {@link renderRoadmap} is the only writer of `ROADMAP.md`'s
 * text, and it is a pure function of the title and the structure — which is what lets the drift
 * check compare a repository's file with a version byte for byte.
 */

import type { EngineRoadmap } from "../../engine/engine.skills";
import { isCalendarDate } from "../../ticket-sources/ticket-source.write";

/** An item's effort chip. */
export type RoadmapEffort = "xs" | "s" | "m" | "l" | "xl";

/** One item, as stored. */
export interface StoredItem {
  key: string;
  title: string;
  /** The Planning draft it became, or null before `create-issues`. */
  draft_id: string | null;
  /** The canonical ticket, once pushed. */
  ticket_id: string | null;
  /** That ticket's display key — `#742` — present exactly with {@link ticket_id}. */
  ticket_key: string | null;
  mvp: boolean;
  effort: RoadmapEffort | null;
  /** Whether the ticket is closed. */
  checked: boolean;
}

/** One milestone, as stored. */
export interface StoredMilestone {
  key: string;
  name: string;
  /** `YYYY-MM-DD`, or null. */
  target_date: string | null;
  items: StoredItem[];
}

/** A version's structure, as stored. */
export interface RoadmapStructure {
  milestones: StoredMilestone[];
}

/** A ticket as the tracker's mirror holds it — what an item is compared with and mirrored from. */
export interface TrackerTicket {
  readonly id: string;
  /** `#742`. */
  readonly key: string;
  readonly title: string;
  readonly state: "open" | "closed";
  readonly labels: readonly string[];
}

/** What an item became in Planning. */
export interface ItemFiling {
  readonly draftId: string;
  /** The ticket the draft was pushed as, or null while unpushed. */
  readonly ticket: { readonly id: string; readonly key: string } | null;
}

/** The label a roadmap item's MVP flag travels to the tracker as. */
export const MVP_LABEL = "mvp";

/** V113's key grammar, for milestones and items alike. */
export const ROADMAP_KEY = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** V113's bounds. */
export const MAX_MILESTONES = 50;
export const MAX_ITEMS = 500;
export const MAX_TITLE_LENGTH = 200;
export const MAX_ITEM_TITLE_LENGTH = 512;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Every item of a structure, in reading order.
 *
 * @param structure - The structure.
 * @returns Each item with the milestone it sits in.
 */
export function itemsOf(
  structure: RoadmapStructure,
): { readonly milestone: StoredMilestone; readonly item: StoredItem }[] {
  return structure.milestones.flatMap((milestone) =>
    milestone.items.map((item) => ({ milestone, item })),
  );
}

/**
 * Everything about a skill's roadmap that V113 would refuse — checked here so a bad answer is a
 * named refusal rather than a constraint violation.
 *
 * @param roadmap - The answer, as the engine validated and this service parsed it.
 * @returns One sentence per problem; empty when the roadmap can be stored.
 */
export function roadmapProblems(roadmap: EngineRoadmap): string[] {
  const problems: string[] = [];
  const title = roadmap.title.trim();

  if (title === "" || title.length > MAX_TITLE_LENGTH) {
    problems.push(`the title must be 1–${String(MAX_TITLE_LENGTH)} characters`);
  }

  if (roadmap.milestones.length < 1 || roadmap.milestones.length > MAX_MILESTONES) {
    problems.push(`a roadmap has 1–${String(MAX_MILESTONES)} milestones`);
  }

  const milestoneKeys = new Set<string>();
  const itemKeys = new Set<string>();

  for (const milestone of roadmap.milestones) {
    if (!ROADMAP_KEY.test(milestone.key))
      problems.push(`milestone key "${milestone.key}" is malformed`);
    if (milestoneKeys.has(milestone.key)) problems.push(`milestone key "${milestone.key}" repeats`);
    milestoneKeys.add(milestone.key);

    if (milestone.name.trim() === "" || milestone.name.length > MAX_TITLE_LENGTH) {
      problems.push(
        `milestone "${milestone.key}" needs a name of at most ${String(MAX_TITLE_LENGTH)} characters`,
      );
    }

    if (milestone.targetDate !== null && !isCalendarDate(milestone.targetDate)) {
      problems.push(`milestone "${milestone.key}" has a target date that is not a calendar date`);
    }

    for (const item of milestone.items) {
      if (!ROADMAP_KEY.test(item.key)) problems.push(`item key "${item.key}" is malformed`);
      if (itemKeys.has(item.key)) problems.push(`item key "${item.key}" repeats`);
      itemKeys.add(item.key);

      if (item.title.trim() === "" || item.title.length > MAX_ITEM_TITLE_LENGTH) {
        problems.push(
          `item "${item.key}" needs a title of at most ${String(MAX_ITEM_TITLE_LENGTH)} characters`,
        );
      }
    }
  }

  if (itemKeys.size > MAX_ITEMS)
    problems.push(`a roadmap holds at most ${String(MAX_ITEMS)} items`);

  return problems;
}

/**
 * A skill's answer as the next version's structure: what the roadmap says from the answer, and
 * each surviving item's draft, ticket and done state from the version before.
 *
 * @param roadmap - The answer.
 * @param previous - The version it replaces, or null for a first version.
 * @returns The structure to store.
 */
export function mergeRoadmap(
  roadmap: EngineRoadmap,
  previous: RoadmapStructure | null,
): RoadmapStructure {
  const before = new Map(
    previous === null ? [] : itemsOf(previous).map(({ item }) => [item.key, item] as const),
  );

  return {
    milestones: roadmap.milestones.map((milestone) => ({
      key: milestone.key,
      name: milestone.name.trim(),
      target_date: milestone.targetDate,
      items: milestone.items.map((item) => {
        const kept = before.get(item.key);

        return {
          key: item.key,
          title: item.title.trim(),
          draft_id: kept?.draft_id ?? null,
          ticket_id: kept?.ticket_id ?? null,
          ticket_key: kept?.ticket_key ?? null,
          mvp: item.mvp,
          effort: item.effort,
          checked: kept?.checked ?? false,
        };
      }),
    })),
  };
}

/**
 * The **writeback**: a structure with what Planning and the tracker now know about items that
 * were not filed before.
 *
 * An item gains the draft it became. An item whose draft was pushed gains its ticket and the
 * ticket's key, and — only then, at the moment it is first filed — takes its MVP flag from the
 * ticket's `mvp` label and its done state from the ticket. An item that was **already** filed is
 * left exactly as it is: if the tracker has since moved, that is a drift to report
 * (`roadmap.drift.ts`), never something a writeback quietly absorbs.
 *
 * @param structure - The structure to start from. Not modified.
 * @param filings - What each item became, by item key. An item absent here keeps what it has.
 * @param tickets - The tracker's mirror, by ticket id.
 * @returns A new structure.
 */
export function writeback(
  structure: RoadmapStructure,
  filings: ReadonlyMap<string, ItemFiling>,
  tickets: ReadonlyMap<string, TrackerTicket>,
): RoadmapStructure {
  return {
    milestones: structure.milestones.map((milestone) => ({
      ...milestone,
      items: milestone.items.map((item) => {
        const filing = filings.get(item.key);

        if (filing === undefined || item.ticket_id !== null) return item;
        if (filing.ticket === null) return { ...item, draft_id: filing.draftId };

        const ticket = tickets.get(filing.ticket.id);

        return {
          ...item,
          draft_id: filing.draftId,
          ticket_id: filing.ticket.id,
          ticket_key: filing.ticket.key,
          mvp: ticket === undefined ? item.mvp : ticket.labels.includes(MVP_LABEL),
          checked: ticket === undefined ? item.checked : ticket.state === "closed",
        };
      }),
    })),
  };
}

/**
 * A structure with every filed item's done state taken from the tracker — what a **re-run**
 * stores, since whether work is done is the tracker's to say and never the skill's.
 *
 * @param structure - The structure to start from. Not modified.
 * @param tickets - The tracker's mirror, by ticket id.
 * @returns A new structure; an item whose ticket the mirror lacks keeps its state.
 */
export function refreshStates(
  structure: RoadmapStructure,
  tickets: ReadonlyMap<string, TrackerTicket>,
): RoadmapStructure {
  return {
    milestones: structure.milestones.map((milestone) => ({
      ...milestone,
      items: milestone.items.map((item) => {
        const ticket = item.ticket_id === null ? undefined : tickets.get(item.ticket_id);

        return ticket === undefined ? item : { ...item, checked: ticket.state === "closed" };
      }),
    })),
  };
}

/**
 * Whether two structures say the same thing, field for field.
 *
 * @param left - One structure.
 * @param right - Another.
 * @returns True when a new version would add nothing.
 */
export function sameStructure(left: RoadmapStructure, right: RoadmapStructure): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

/**
 * A structure with its keys in one fixed order — what is stored, and what is compared.
 *
 * @param structure - Any structure.
 * @returns The same content, key order fixed.
 */
export function canonical(structure: RoadmapStructure): RoadmapStructure {
  return {
    milestones: structure.milestones.map((milestone) => ({
      key: milestone.key,
      name: milestone.name,
      target_date: milestone.target_date,
      items: milestone.items.map((item) => ({
        key: item.key,
        title: item.title,
        draft_id: item.draft_id,
        ticket_id: item.ticket_id,
        ticket_key: item.ticket_key,
        mvp: item.mvp,
        effort: item.effort,
        checked: item.checked,
      })),
    })),
  };
}

/**
 * A milestone's target as the heading prints it — `Oct 15`.
 *
 * @param date - `YYYY-MM-DD`.
 * @returns The month's English abbreviation and the day, read in UTC.
 */
export function targetLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);

  return `${MONTHS[parsed.getUTCMonth()] ?? ""} ${String(parsed.getUTCDate())}`;
}

/**
 * `ROADMAP.md`, projected from a version.
 *
 * ```
 * # Helios — Q4 Improvement Roadmap
 *
 * ## M1 · Docking parity — target Oct 15
 * - [x] #742 Wind-feedforward MPC in final approach `MVP` `L`
 * - [ ] #743 Re-planned abort & retry vectors `MVP` `M`
 * ```
 *
 * An item prints its issue number once it has one, `MVP` when flagged and its effort when it has
 * one. Deterministic: the same title and structure give the same bytes.
 *
 * @param title - The document's title.
 * @param structure - The version's structure.
 * @returns The Markdown, ending in a newline.
 */
export function renderRoadmap(title: string, structure: RoadmapStructure): string {
  const sections = structure.milestones.map((milestone) => {
    const heading =
      `## ${milestone.key.toUpperCase()} · ${milestone.name}` +
      (milestone.target_date === null ? "" : ` — target ${targetLabel(milestone.target_date)}`);
    const lines = milestone.items.map(
      (item) =>
        `- [${item.checked ? "x" : " "}] ` +
        (item.ticket_key === null ? "" : `${item.ticket_key} `) +
        item.title +
        (item.mvp ? " `MVP`" : "") +
        (item.effort === null ? "" : ` \`${item.effort.toUpperCase()}\``),
    );

    return `${[heading, ...lines].join("\n")}\n`;
  });

  return `# ${title}\n\n${sections.join("\n")}`;
}

export { isCalendarDate };
