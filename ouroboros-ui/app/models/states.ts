/**
 * Every state the `/models` page can be in that is not *populated* — decided here, as
 * functions with inputs and outputs, and drawn by the screen (AA.6,
 * [#205](https://github.com/NobuData/ouroboros/issues/205)).
 *
 * Mockup 06 draws the busy state and nothing else. A real workspace spends its first week in
 * the other four — nothing connected, nothing routed, a read that failed, a reader who may
 * only look — and the seeded demo workspace hides every one of them, which is exactly why they
 * are the states the first real tenant discovers. Each is a **judgement** about the two reads
 * the page makes, so each lives here as a rule with a unit test rather than as a branch inside
 * a component.
 *
 * **Framework-free and pure**, the way `app/models/view.ts` is: nothing here imports React,
 * `next/*` or the server-only client. The only import beyond the reads' shape is a `.d.ts`,
 * for the role's four spellings.
 *
 * ### The states, and why there are exactly these
 *
 * | State | What is true | What the page draws |
 * |---|---|---|
 * | `failed` | the matrix read was refused | the retry banner, and a seat that says so once |
 * | `no-providers` | read fine, no kinds, no connection | guidance: *connect a provider* is the next step |
 * | `no-routes` | read fine, no kinds, a connection (or an unreadable strip) | guidance: *seed the default routes* is the next step |
 * | `populated` | at least one task kind | the matrix, the inspector, the two cards |
 *
 * The line between the two guidance states is the **provider strip's** read, because that is
 * the fact that decides what a fresh workspace should do next: an alias needs a provider
 * behind it, so a workspace with none has one job before routing can mean anything. A strip
 * that could not be read leaves that fact unknown, and the page says *unknown* rather than
 * guessing either way — the same honesty the strip itself keeps (decision **M8**).
 *
 * A workspace whose kinds exist but whose routes are all `null` is **populated**: the matrix
 * draws every kind as a row with an empty cell (hiding a kind would hide the very kind
 * somebody came here to configure), and the inspector says the selected kind has no route.
 * The guidance is for the workspace with *nothing to draw*, which is the state the personal
 * organization's seed leaves it in.
 */

import type { Role } from "@/app/api/membership";
import { article } from "@/app/format";

import type { ModelsReadings } from "./view";

/* ------------------------------------------------------------------ the page's state */

/** Which of the page's states the two reads put it in. */
export type RoutingState =
  /** The matrix read was refused; `reason` is the service's own sentence. */
  | { readonly kind: "failed"; readonly reason: string }
  /** Nothing to route and no provider to route to. */
  | { readonly kind: "no-providers" }
  /**
   * Nothing to route, but a provider is connected — or the strip could not be read and
   * `connected` is `null`, which is *unknown* rather than *none*.
   */
  | { readonly kind: "no-routes"; readonly connected: number | null }
  /** At least one task kind: the matrix draws. */
  | { readonly kind: "populated" };

/** The two states the guidance card is drawn for. */
export type GuidanceState = Extract<RoutingState, { kind: "no-providers" | "no-routes" }>;

/**
 * Decide the page's state from its two reads.
 *
 * The matrix decides first, because a refused matrix has no answer to *is anything routed*;
 * the strip decides between the two guidance states, because it is the only read that says
 * whether a provider exists.
 *
 * @param readings Everything the reader was able to read, and why not for the rest.
 * @returns The state.
 */
export function routingState(readings: ModelsReadings): RoutingState {
  if (!readings.matrix.ok) return { kind: "failed", reason: readings.matrix.reason };
  if (readings.matrix.value.taskKinds.length > 0) return { kind: "populated" };

  const connected = readings.providers.ok ? readings.providers.value.length : null;
  if (connected === 0) return { kind: "no-providers" };

  return { kind: "no-routes", connected };
}

/* ------------------------------------------------------------------ read-only */

/** What the page says to a reader who may look and not change — a head and a body. */
export interface ReadOnlyNote {
  /** The role, named: *Viewing routing as a member.* */
  readonly head: string;
  /** What that means here, in one sentence. */
  readonly body: string;
}

/** The sentence every read-only reader gets, whatever their role is called. */
export const READ_ONLY_BODY =
  "Routes, policies and escalation rules are changed by an owner or an admin. Everything " +
  "here can be read; nothing here can be edited.";

/**
 * Explain the role rather than silently omitting its controls.
 *
 * A member's page has no handles, no switches, no builder and no dirty bar — read-only is a
 * rendering mode, not a page of disabled controls — and a page that quietly draws less looks
 * broken rather than scoped. So the page names the role once, near the top, and says what
 * the role means on this page.
 *
 * Total over every role the contract publishes, so the sentence cannot fail to form; the
 * screen draws it only for a role `app/api/membership.ts`'s `mayAdminister` refuses, which is
 * the one place deciding what a role may do.
 *
 * @param role The reader's strongest role, from `primaryRole`.
 * @returns The two sentences.
 */
export function readOnlyNote(role: Role): ReadOnlyNote {
  return { head: `Viewing routing as ${article(role)} ${role}.`, body: READ_ONLY_BODY };
}

/* ------------------------------------------------------------------ the failed read */

/** The banner's headline for a refused matrix — the state, in words. */
export const ROUTING_FAILED_HEADLINE = "Routing could not be read.";

/**
 * What the matrix's seat says under the banner.
 *
 * The reason is the banner's and is said **once** (DASH-I.7's rule): the seat says what is
 * missing and where the explanation is, and repeats neither the sentence nor the retry.
 */
export const MATRIX_FAILED_NOTE =
  "Nothing below the strip could be read. The banner above carries the service's reason, " +
  "and the retry.";

/* ------------------------------------------------------------------ the guidance card */

/** The card's title — what the two steps add up to. */
export const FOUNDATIONS_TITLE = "Set up routing";

/** What a workspace with no provider is told, first. */
export const NO_PROVIDERS_TITLE = "Routing needs a provider connection";

/** …and why. */
export const NO_PROVIDERS_NOTE =
  "Routes resolve to aliases, and an alias needs a provider behind it. Nothing can be " +
  "routed until this workspace has connected one.";

/** What a workspace with a provider and nothing routed is told, first. */
export const NO_ROUTES_TITLE = "No routes yet";

/** …and what the one step would give it. */
export const NO_ROUTES_NOTE =
  "This workspace has no task kinds and no routes. The eight default kinds and their " +
  "routes are the one-step way to a working matrix rather than eight rows by hand.";

/**
 * Where a step's status is announced, in a word. `next` rather than *current*, because the
 * step is what the reader does next; `unknown` for the step the strip could not report on.
 */
export type StepStatus = "done" | "current" | "pending" | "unknown";

/** The word each status carries — never a hue alone (§ 3.4). */
export const STEP_WORD: Record<StepStatus, string> = {
  done: "done",
  current: "next",
  pending: "then",
  unknown: "unknown",
};

/** One step of the path from nothing to a working matrix. */
export interface FoundationStep {
  /** Which step — the React key, and what its action is. */
  readonly key: "provider" | "routes";
  /** What to do. */
  readonly title: string;
  /** How, or what was found. */
  readonly note: string;
  /** Where the reader is relative to it. */
  readonly status: StepStatus;
}

/** The first step's title. */
export const CONNECT_PROVIDER = "Connect a provider";

/** The first step's note while it is the next thing to do. */
export const CONNECT_PROVIDER_NOTE =
  "API keys and local hosts are added on the Providers & keys tab, and a connection " +
  "appears on the health strip above once it is made.";

/** The first step's note when the strip could not say whether it is done. */
export const PROVIDERS_UNREAD_NOTE =
  "Provider health could not be read, so whether a provider is connected is unknown. The " +
  "strip above says why.";

/** The link into mockup 07's surface — a live tab since AE.1 (#227), so a link and not a *soon*. */
export const PROVIDERS_LINK = "Providers & keys →";

/**
 * The first step's note once it is done.
 *
 * @param connected How many connections the strip listed. Never zero here.
 * @returns *1 provider connected*, *3 providers connected*.
 */
export function connectedNote(connected: number): string {
  return `${connected} ${connected === 1 ? "provider" : "providers"} connected`;
}

/** The second step's title. */
export const SEED_ROUTES_TITLE = "Seed the default routes";

/** The second step's note: what the template holds. */
export const SEED_ROUTES_NOTE =
  "Eight task kinds — analyze, estimate, plan, implement, test-gen, review, docs and " +
  "commit-msg — each routed to a primary alias with ordered fallbacks, from the same " +
  "template the development seed uses.";

/** The second step's control. */
export const SEED_ROUTES = "Seed default routes";

/**
 * Why the control cannot act.
 *
 * A task kind is a row of `task_kinds`, and nothing in `ouroboros-rest`'s contract writes
 * one: `PUT /api/v1/routing/routes` refuses a kind the workspace does not have, and the
 * eight defaults are written today by `R__dev_seed_routing.sql` and nothing else. So the
 * control is drawn where it belongs and says what is missing (`docs/DESIGN_SYSTEM_APP_SHELL.md`
 * § 3.5) rather than opening a flow that would end in a `422`. The sentence names the
 * service rather than an issue, because no issue owns the endpoint yet.
 */
export const SEED_ROUTES_REASON =
  "The routing API has no way to create task kinds yet, so the default routes cannot be " +
  "seeded from here — today only the development seed writes them.";

/**
 * The note for somebody exploring on a development stack.
 *
 * The ticket asks for it by name: the seeded demo workspace is where mockup 06's full matrix
 * can be seen, and a developer landing on a personal workspace's guidance should be told
 * where the populated page is rather than left thinking the product has nothing to show.
 */
export const DEV_SEED_NOTE =
  "Exploring locally? The development seed's acme-robotics workspace carries the full " +
  "routing matrix.";

/**
 * The guidance's headline for a state.
 *
 * @param state Which of the two.
 * @returns The title.
 */
export function guidanceTitle(state: GuidanceState): string {
  return state.kind === "no-providers" ? NO_PROVIDERS_TITLE : NO_ROUTES_TITLE;
}

/**
 * The guidance's one-line explanation for a state.
 *
 * @param state Which of the two.
 * @returns The note.
 */
export function guidanceNote(state: GuidanceState): string {
  return state.kind === "no-providers" ? NO_PROVIDERS_NOTE : NO_ROUTES_NOTE;
}

/**
 * The path, with the reader's place on it marked.
 *
 * Two steps, always both, in order — the point of drawing the path rather than one message
 * per state is that a reader on step one can see step two coming, and a reader on step two
 * can see step one behind them. What varies is each step's status and, for the first, its
 * note: *how to do it*, *what was found*, or *nobody could tell*.
 *
 * @param state Which of the two guidance states the page is in.
 * @returns The two steps.
 */
export function foundationSteps(state: GuidanceState): readonly FoundationStep[] {
  const provider: FoundationStep =
    state.kind === "no-providers"
      ? { key: "provider", title: CONNECT_PROVIDER, note: CONNECT_PROVIDER_NOTE, status: "current" }
      : state.connected === null
        ? { key: "provider", title: CONNECT_PROVIDER, note: PROVIDERS_UNREAD_NOTE, status: "unknown" }
        : {
            key: "provider",
            title: CONNECT_PROVIDER,
            note: connectedNote(state.connected),
            status: "done",
          };

  const routes: FoundationStep = {
    key: "routes",
    title: SEED_ROUTES_TITLE,
    note: SEED_ROUTES_NOTE,
    status: state.kind === "no-providers" ? "pending" : "current",
  };

  return [provider, routes];
}
