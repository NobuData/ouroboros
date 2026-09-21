/**
 * The build farm's states — what the page says before there is a fleet, to a reader who may not
 * change one, while it loads, and when much of the fleet is down
 * (AI.7, [#262](https://github.com/NobuData/ouroboros/issues/262)).
 *
 * This page is unusual in that its empty state is the **first thing every new workspace sees**:
 * a fresh organization has no runners at all, and the whole point of the page is that somebody has
 * to go and install something on a machine. So the empty state is designed rather than defaulted —
 * it promotes the enroll card and frames it as step one — and each judgement behind it lives here,
 * so its acceptance criterion is a unit test on a small value rather than an assertion about
 * markup.
 *
 * **Framework-free and pure**, the way `app/farm/view.ts` is: nothing here imports React,
 * `next/*` or the server-only client. The drawing is `app/farm/farm-first-run.tsx`'s,
 * `app/farm/farm-grid.tsx`'s, `app/farm/farm-readonly-note.tsx`'s,
 * `app/farm/farm-fleet-warning.tsx`'s and `app/farm/farm-skeleton.tsx`'s.
 *
 * ### Unread is not empty
 *
 * Every rule below answers `null` for a page that could not be read. *The farm could not be read*
 * is the banner's, once, with the retry (`app/farm/farm-banner.tsx`); guidance telling a reader to
 * enrol a first runner over a fleet nobody could count would be the page inventing a zero.
 */

import type { FarmPage, FarmStats, RunnerPool } from "@/app/api/farm";
import type { Role } from "@/app/api/membership";
import { article } from "@/app/format";

/* ------------------------------------------------------------------ the first run */

/**
 * Which first-run state the page is in.
 *
 * - `no-pools` — nothing is enrolled **and** there is no pool to enrol into. A token always names
 *   the pool a runner joins, so the pool comes first and the guidance says so.
 * - `no-runners` — there is a pool, and no machine yet: enrolment is step one.
 */
export type FarmFirstRun = "no-pools" | "no-runners";

/**
 * Decide the first-run state.
 *
 * The fleet is what decides: a workspace with even one runner is past its first run, whatever its
 * pools say, because the table has a row to draw. `no-pools` takes precedence over `no-runners`
 * when both are empty — a runner enrols *into* a pool, so offering the command first would be
 * offering a step that cannot be taken.
 *
 * @param page The page, or `null` when nothing has been read.
 * @param pools The pools as the screen draws them (`app/farm/pool-store.tsx`), which hold a pool
 *   created a moment ago before the page has caught up — or `null` to read the page's own.
 * @returns The state, or `null` for a page that could not be read and for a fleet with a runner
 *   in it.
 */
export function farmFirstRun(
  page: FarmPage | null,
  pools: readonly RunnerPool[] | null = null,
): FarmFirstRun | null {
  if (page === null || page.runners.length > 0) return null;

  return (pools ?? page.pools).length === 0 ? "no-pools" : "no-runners";
}

/** One step of the first-run guidance. */
export interface FirstRunStep {
  /** What to do, as a short imperative. */
  readonly title: string;
  /** Why, and what happens — one sentence. */
  readonly body: string;
}

/** The step a workspace with no pool starts at. */
export const STEP_CREATE_POOL: FirstRunStep = {
  title: "Create a pool",
  body:
    "A runner always enrols into a pool, and the pool says how its builds run — in a container " +
    "image, or in the machine's own shell.",
};

/** The step the enroll card serves. */
export const STEP_COPY_COMMAND: FirstRunStep = {
  title: "Copy the enroll command",
  body:
    "The Enroll a runner card mints a single-use token and hands the whole command to your " +
    "clipboard. Treat it as a secret.",
};

/** The step that happens on the machine, not on this page. */
export const STEP_RUN_COMMAND: FirstRunStep = {
  title: "Run it on the machine",
  body:
    "The agent installs, connects outbound over mTLS and registers itself — no inbound ports. " +
    "Its row appears here within a few seconds.",
};

/**
 * The steps left, in order — the numbering is the list's own.
 *
 * **Enrolment is step one wherever it can be**: with a pool in place the list starts at the
 * command. Only a workspace with no pool is shown the pool first, because that is the one case in
 * which the command cannot be minted.
 *
 * @param state The first-run state.
 * @returns The steps.
 */
export function firstRunSteps(state: FarmFirstRun): readonly FirstRunStep[] {
  return state === "no-pools"
    ? [STEP_CREATE_POOL, STEP_COPY_COMMAND, STEP_RUN_COMMAND]
    : [STEP_COPY_COMMAND, STEP_RUN_COMMAND];
}

/** What the guidance says under its title, to a reader who can act on it. */
export const FIRST_RUN_NOTE =
  "A build farm is your own machines. Nothing is listed here until an agent has enrolled — " +
  "these are the steps, and the first is in the card marked Step one.";

/**
 * What a reader who may not enrol is told instead of the steps' control.
 *
 * An explanation rather than an inert button, as `app/providers/states.ts` argues for its own
 * empty state: this is the first thing a new member sees, and a disabled control with a tooltip
 * is a worse first sentence than one that says who can act and what will appear once they have.
 */
export const FIRST_RUN_MEMBER_NOTE =
  "Creating a pool and enrolling a runner are for workspace owners and admins. Ask one of them " +
  "to enrol the first machine — its row will be readable here the moment it connects.";

/** The create-pool call to action — on the pools card, and on the guidance when it is step one. */
export const CREATE_POOL = "Create a pool";

/** The guidance's call to action once there is a pool: it moves the reader to the enroll card. */
export const GO_TO_ENROLL = "Go to the enroll command";

/** The accessible name of the guidance's list. */
export const FIRST_RUN_STEPS_LABEL = "How to enroll your first runner";

/** The eyebrow over the promoted card. */
export const STEP_ONE = "Step one";

/** The eyebrow over the card that comes after it. */
export const STEP_TWO = "Step two";

/** The two cards of the right-hand column a first run marks. */
export type FirstRunCard = "enroll" | "pools";

/**
 * The eyebrow a card carries during a first run.
 *
 * | state | pools card | enroll card |
 * |---|---|---|
 * | `no-pools` | {@link STEP_ONE} | {@link STEP_TWO} |
 * | `no-runners` | — | {@link STEP_ONE} |
 *
 * The card carrying {@link STEP_ONE} is the promoted one ({@link isPromoted}).
 *
 * @param state The first-run state, or `null` outside one.
 * @param card Which card is asking.
 * @returns The eyebrow, or `null` for a card the state does not mark.
 */
export function stepEyebrow(state: FarmFirstRun | null, card: FirstRunCard): string | null {
  if (state === null) return null;
  if (state === "no-pools") return card === "pools" ? STEP_ONE : STEP_TWO;

  return card === "enroll" ? STEP_ONE : null;
}

/**
 * Whether a card is the promoted one — the card a first run starts at.
 *
 * @param state The first-run state, or `null` outside one.
 * @param card Which card is asking.
 * @returns `true` for the card carrying {@link STEP_ONE}.
 */
export function isPromoted(state: FarmFirstRun | null, card: FirstRunCard): boolean {
  return stepEyebrow(state, card) === STEP_ONE;
}

/* ------------------------------------------------------------------ the offline-heavy fleet */

/** What the warning strip says. */
export interface FleetWarning {
  /** How much of the fleet is down — the state, in words. */
  readonly headline: string;
  /** What that means for a build submitted now. */
  readonly body: string;
}

/** Under a fleet with nothing connected at all. */
export const FLEET_DOWN_BODY =
  "Nothing can build until a runner reconnects: submitted builds wait in the queue. Each row " +
  "says when its machine was last seen.";

/** Under a fleet that is thin rather than gone. */
export const FLEET_THIN_BODY =
  "Builds queue on the runners still connected. Each offline row says when its machine was last " +
  "seen.";

/**
 * The offline-heavy warning — said at the top of the page rather than left to be inferred from
 * dimmed rows.
 *
 * **Heavy is half.** A fleet with at least half its machines away gets the strip; mockup 08's
 * `4/5` does not, because one machine in five going quiet is an ordinary afternoon and the
 * runners tile already says `forge-03 offline · 2h`. An empty fleet gets none either: that is the
 * first run's state, not a warning.
 *
 * `online` is the stat row's own count — `online`, `building` and `draining`, the three statuses
 * the fleet can vouch for — so the strip and the `4/5` above the table cannot disagree.
 *
 * @param runners The payload's `stats.runnersOnline`.
 * @returns The strip's two sentences, or `null` when most of the fleet is connected.
 */
export function fleetWarning(runners: FarmStats["runnersOnline"]): FleetWarning | null {
  const { online, total } = runners;

  if (total <= 0 || online * 2 > total) return null;

  const offline = total - online;

  if (offline >= total) {
    return {
      headline: total === 1 ? "The only runner is offline." : `All ${total} runners are offline.`,
      body: FLEET_DOWN_BODY,
    };
  }

  return {
    headline: `${offline} of ${total} runners ${offline === 1 ? "is" : "are"} offline.`,
    body: FLEET_THIN_BODY,
  };
}

/* ------------------------------------------------------------------ read-only */

/** What the page says to a reader who may look and not change — a head and a body. */
export interface FarmReadOnlyNote {
  /** The role, named: *Viewing the build farm as a member.* */
  readonly head: string;
  /** What that means here. */
  readonly body: string;
}

/**
 * The sentences every read-only reader gets, whatever their role is called.
 *
 * They state the rule each region keeps rather than leaving a page of missing controls to
 * explain itself: a control that **shows a state** is drawn in its real position, switched off,
 * with its reason as the tooltip (a pool's switches, the head's **+ Enroll runner**); an
 * affordance that exists **only to write** is not drawn at all (a runner's drain, undrain and
 * remove, **Submit build**, the copy and the token sheet).
 */
export const FARM_READ_ONLY_BODY =
  "Runners are enrolled, drained and removed, pools are created and switched, and builds are " +
  "submitted by an owner or an admin. Everything here can be read: each pool's switches are " +
  "drawn in their real positions, switched off with the reason; the enroll card shows the " +
  "command's shape and mints nothing; and a runner's menu holds View details alone.";

/**
 * Explain the role rather than leaving absent controls to explain themselves.
 *
 * Total over every role the contract publishes, so the sentence cannot fail to form; the screen
 * draws it only for a role `app/api/membership.ts`'s `mayAdminister` refuses, which is the one
 * place deciding what a role may do.
 *
 * @param role The reader's strongest role, from `primaryRole`.
 * @returns The two parts.
 */
export function farmReadOnlyNote(role: Role): FarmReadOnlyNote {
  return {
    head: `Viewing the build farm as ${article(role)} ${role}.`,
    body: FARM_READ_ONLY_BODY,
  };
}

/* ------------------------------------------------------------------ loading */

/** What the `<main>` is named while the first read is in flight. */
export const FARM_LOADING_LABEL = "Loading the build farm";
