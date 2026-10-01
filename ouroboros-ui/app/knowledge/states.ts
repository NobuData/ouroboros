/**
 * The states mockup 14 cannot show, and every sentence they say
 * (BG.6, [#422](https://github.com/NobuData/ouroboros/issues/422)).
 *
 * The mockup draws a mature org: six skills, five facts, three playbooks. Every real org starts
 * with none of that, and the empty page is the one that decides whether they engage. **Framework-free
 * and pure**, like `app/knowledge/view.ts` and `app/prs/states.ts`: the cards and their suites read
 * from here, so a sentence the reader sees is the sentence the suite asserts.
 *
 * ### An empty state teaches; it does not apologise
 *
 * Each one says what the thing is, how it arrives, and — where the reader may act — holds the
 * action itself rather than pointing at one elsewhere on the page:
 *
 * | State | Says | Holds |
 * |---|---|---|
 * | no skills | what a skill is, and that either way in lands as a draft | **+ New skill** and **Import** — the head's two, for the roles that have them |
 * | no facts | *the loop proposes facts as it works* (`facts.ts`) | **+ Add fact**, as the state's own action |
 * | no playbooks | what a playbook keeps (`playbooks.ts`) | the create-from-a-past-run tile, primary |
 * | no environment recipe | what runs before the first stage (`profile.ts`) | **Add environment recipe** |
 *
 * The last three were drawn by #419 and #420 and are certified here; the first gains its actions
 * and its explanation, and the facts card's and the recipe's adds move into the states they
 * belong to. **The page keeps one accent-filled action** — the head's **+ New skill**, which the
 * empty table repeats — beside the playbooks card's tile, which #420 drew primary: a state's own
 * add is a raised control, so a cold page does not open on five competing calls to action.
 *
 * ### Pending is not failed
 *
 * A `repo-map` that has never generated is not broken, and the page says which: the service
 * answers each enabled repository's map as `generated`, `pending` or `failed`
 * (`GET /api/v1/knowledge/repo-map`), and {@link repoMapNotices} draws the two that have no row
 * in the skills table — a neutral ring for a map nobody has generated yet, the error hue for one
 * whose generation was refused, with why and when.
 *
 * ### A failed read is one card's
 *
 * Each card's read is its own `Reading` (`app/api/reading.ts`), so one refused service degrades
 * one card. {@link TRY_AGAIN} is what every card's unread state offers: the page re-reads, and the
 * cards that could be read stay as they are.
 */

import type { RepoMapStatus, RepoMapStatusList } from "@/app/api/repo-map";
import type { Reading } from "@/app/api/reading";
import { coarseAgo } from "@/app/format";
import type { ChipDot, ChipTone } from "@/app/ui";

/* ------------------------------------------------------------------ no skills */

/** What a skill is, for a reader who has never seen one — the empty skills table's first sentence. */
export const SKILL_EXPLAINER =
  "A skill is a page of instructions in markdown — conventions, safety rules, how this repository " +
  "is built — that the loop is handed at the start of every run in its scope.";

/** How one arrives, for a reader who may bring one: the two head actions, here as well. */
export const NO_SKILLS_ADMIN_NOTE =
  `${SKILL_EXPLAINER} Write one, or import the rules you already keep in CLAUDE.md or ` +
  ".cursorrules. Either lands here as a draft, and nothing reaches a run until you publish it.";

/** The same explanation for a reader who may not: who brings one, and that it will appear here. */
export const NO_SKILLS_READER_NOTE =
  `${SKILL_EXPLAINER} An owner or an admin writes one or imports the rules files a repository ` +
  "already keeps; each appears here as a draft, and then as a row every run in its scope carries.";

/** The name of the group the empty table's two actions form. */
export const NO_SKILLS_ACTIONS = "Add the first skill";

/**
 * The note under *No skills yet.*
 *
 * @param mayAdminister Whether the reader is an `owner` or an `admin`.
 * @returns The explanation with the two ways in, or with who has them.
 */
export function noSkillsNote(mayAdminister: boolean): string {
  return mayAdminister ? NO_SKILLS_ADMIN_NOTE : NO_SKILLS_READER_NOTE;
}

/* ------------------------------------------------------------------ a failed read */

/** What every card's unread state offers. */
export const TRY_AGAIN = "Try again";

/** The same action while the page re-reads. */
export const TRYING_AGAIN = "Reading again…";

/** What stands in for the service's reason when it gave none. */
export const NO_REASON = "The service gave no reason.";

/* ------------------------------------------------------------------ repo-map: pending, failed */

/** The list's name in the accessibility tree. */
export const REPO_MAPS_NAME = "Repository maps not generated yet";

/** The pending chip — a map nobody has generated yet. */
export const MAP_PENDING = "pending first generation";

/** The failed chip — a first generation that was refused. */
export const MAP_FAILED = "generation failed";

/**
 * What a pending map is waiting on, and that the reader need not wait — said **once** under the
 * list rather than in every row: it is the same sentence for each, and a workspace with a dozen
 * repositories would otherwise read it a dozen times.
 */
export const MAP_PENDING_ADMIN_NOTE =
  "Pending is not broken: the nightly job has not come round to that repository yet. It writes " +
  "the first version, or generate it now with ↻.";

/** The same for a reader who may not generate. */
export const MAP_PENDING_READER_NOTE =
  "Pending is not broken: the nightly job has not come round to that repository yet. It writes " +
  "the first version.";

/** What the list says when the status could not be read — it claims neither state. */
export const MAPS_UNREAD = "Whether each repository's repo-map has generated could not be read";

/** Why a generation was skipped, as a sentence's subject. */
const MAP_FAILURE: Record<NonNullable<NonNullable<RepoMapStatus["lastReport"]>["reason"]>, string> = {
  no_source: "No connected source covers this repository",
  rate_limit: "The host rate-limited the read",
  host_error: "The host refused the read",
};

/** What a failed generation asks of an administrator, by why it failed. */
const MAP_REMEDY: Record<keyof typeof MAP_FAILURE, string> = {
  no_source: "Connect a source that covers it under Settings → Sources.",
  rate_limit: "The nightly job retries once the limit resets.",
  host_error: "The nightly job retries; check the source's credential under Settings → Sources if it keeps failing.",
};

/** One repository's map that has no row in the table: what to call it, and what to say. */
export interface RepoMapNotice {
  /** The repository, `owner/name`. */
  readonly repo: string;
  /** Which of the two states it is in. */
  readonly state: "pending" | "failed";
  /** The chip's text. */
  readonly chip: string;
  /** The chip's hue — neutral for pending, the error hue for failed. */
  readonly tone: ChipTone;
  /** The chip's dot — a ring for a state nobody has reported yet, filled for one that was. */
  readonly dot: ChipDot;
  /**
   * The sentence under a failed map — why, when, and what happens next, which is its own for
   * each. `null` for a pending one, whose explanation is {@link pendingMapsNote}'s, said once.
   */
  readonly detail: string | null;
}

/**
 * The sentence beside a failed map: why, when, on whose request, and what happens next.
 *
 * @param status The failed status.
 * @param now The instant the page was read.
 * @returns The sentence.
 */
function failedDetail(status: RepoMapStatus, now: Date): string {
  const report = status.lastReport;

  if (report === null) return "The last generation did not publish a map.";

  const reason = report.reason ?? "host_error";
  const asked = report.trigger === "nightly" ? "the nightly run" : "a run on request";

  return `${MAP_FAILURE[reason]} on ${asked}, ${coarseAgo(report.generatedAt, now)}. ${MAP_REMEDY[reason]}`;
}

/**
 * The maps that have no row in the skills table, each with what to say about it.
 *
 * @param maps The status reading.
 * @param now The instant the page was read.
 * @returns One notice per repository whose map is pending or failed, in the service's order;
 *   none when every map is generated, and none when the status could not be read — an unread
 *   status claims neither state, and {@link mapsUnreadNote} says so instead.
 */
export function repoMapNotices(maps: Reading<RepoMapStatusList>, now: Date): readonly RepoMapNotice[] {
  if (!maps.ok) return [];

  return maps.value.items.flatMap((status): RepoMapNotice[] => {
    if (status.state === "pending") {
      return [{ repo: status.repo, state: "pending", chip: MAP_PENDING, tone: "neutral", dot: "ring", detail: null }];
    }

    if (status.state === "failed") {
      return [
        { repo: status.repo, state: "failed", chip: MAP_FAILED, tone: "err", dot: "filled", detail: failedDetail(status, now) },
      ];
    }

    return [];
  });
}

/**
 * What is said once under the list while any map is pending: that pending is not broken, what
 * writes the first version, and — for a reader who may — that they need not wait for it.
 *
 * @param notices The list's rows.
 * @param mayAdminister Whether the reader may generate a map now.
 * @returns The sentence, or `null` when no map is pending.
 */
export function pendingMapsNote(notices: readonly RepoMapNotice[], mayAdminister: boolean): string | null {
  if (!notices.some((notice) => notice.state === "pending")) return null;

  return mayAdminister ? MAP_PENDING_ADMIN_NOTE : MAP_PENDING_READER_NOTE;
}

/**
 * What the list says in place of its rows when the status could not be read.
 *
 * @param maps The status reading.
 * @returns The sentence with the service's reason, or `null` when it was read.
 */
export function mapsUnreadNote(maps: Reading<RepoMapStatusList>): string | null {
  return maps.ok ? null : `${MAPS_UNREAD}: ${maps.reason}`;
}

/**
 * The accessible name of a notice's generate action.
 *
 * @param repo The repository.
 * @returns `Generate repo-map for acme-robotics/helios-console now`.
 */
export function generateName(repo: string): string {
  return `Generate repo-map for ${repo} now`;
}

/* ------------------------------------------------------------------ the skeleton */

/** How many rows the skeleton's skills table draws — the mockup's six. */
export const SKELETON_SKILLS = 6;

/** How many rows its facts card draws — the mockup's five. */
export const SKELETON_FACTS = 5;

/** How many rows its playbooks card draws — the mockup's three. */
export const SKELETON_PLAYBOOKS = 3;

/** How many rows its repo profile draws — language, platform, build, devcontainer, protected paths. */
export const SKELETON_PROFILE_ROWS = 5;

/** How many steps its scope ladder draws — Org, Repo, Workflow. */
export const SKELETON_STEPS = 3;
