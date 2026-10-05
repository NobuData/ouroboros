/**
 * Where a decision card's links lead (BO.2, [#467](https://github.com/NobuData/ouroboros/issues/467))
 * — pure.
 *
 * A card is rendered from its kind's declaration and nothing else (X1), so a link's destination
 * cannot live in the card: a kind added tomorrow would need the component edited. It is resolved
 * here instead, from what the declaration and the item already say:
 *
 * ```
 * ref tag      run → the run console · pr → PR verification · ticket → intake, filtered to it
 *              path → the diff on the item's run (no run ref → not a link)
 * link action  handler_binding `navigate.<target>` + the item's refs / source ref
 *              pr_verification · pr_evidence · run_console · run_plan · run_diff
 *              protected_paths_settings · knowledge_fact · planning_batch · ticket
 * ```
 *
 * Every answer is an **origin-relative path on the UI** — the same routes `ouroboros-ui/app/paths.ts`
 * writes down, restated in {@link UI_ROUTES} because the two modules cannot import each other. A
 * target this table does not know, or one whose ref the item does not carry, resolves to `null`:
 * the card then shows the action as unavailable rather than linking somewhere plausible.
 */

import type { DecisionRef, DecisionRefType } from "./decision.types";

/** What makes a `handler_binding` a link rather than an answer (V093). */
export const NAVIGATE_PREFIX = "navigate.";

/** The label prefix a ticket ref carries — `issue #465` (`decision.refs.ts`). */
const TICKET_LABEL_PREFIX = /^issue /;

/**
 * The UI's routes, as `ouroboros-ui/app/paths.ts` and its screens name them. A route renamed
 * there is renamed here; `inbox.links.spec.ts` holds each to a literal so the change is seen.
 */
export const UI_ROUTES = {
  /** The run console — `runPath`. */
  run: (runId: string): string => `/runs/${encodeURIComponent(runId)}`,
  /** The run console's *Changes so far* card — `RUN_CHANGES_HASH`. */
  runChanges: (runId: string): string => `/runs/${encodeURIComponent(runId)}#run-changes`,
  /** The PR verification page — `prPath`. */
  pr: (prId: string): string => `/prs/${encodeURIComponent(prId)}`,
  /** Its acceptance-criteria card, where each claim's evidence is cited — `CRITERIA_ID`. */
  prCriteria: (prId: string): string => `/prs/${encodeURIComponent(prId)}#criteria`,
  /** Issue intake, searched for one ticket's key — `ISSUES_PATH` and the bar's `q`. */
  intake: (key: string): string => `/issues?q=${encodeURIComponent(key)}`,
  /** The planning page on one batch — `PLANNING_PATH` and `BATCH_PARAM`. */
  planningBatch: (batchId: string): string => `/planning?batch=${encodeURIComponent(batchId)}`,
  /** Knowledge's facts awaiting review — `FACTS_REGION_ID`. */
  knowledgeFacts: "/knowledge#facts-awaiting",
  /** Knowledge's repo profile, where protected paths are edited — `KNOWLEDGE_ENV_PATH`. */
  protectedPaths: "/knowledge#repo-profile",
} as const;

/** What a link is resolved from: the item's refs and where it came from. */
export interface LinkContext {
  /** The item's typed refs, in the emitter's order. */
  readonly refs: readonly DecisionRef[];
  /** The item's `source_ref` — `planning:batch:<uuid>`, `fact:<uuid>`, … */
  readonly sourceRef: string;
}

/** A ref with where its tag leads. */
export interface LinkedRef extends DecisionRef {
  /** An origin-relative UI path, or null for a tag that has no page to open. */
  readonly href: string | null;
}

/**
 * The id of the first ref of a type.
 *
 * @param refs - The item's refs.
 * @param type - The type wanted.
 * @returns The ref's id, or `undefined` when the item carries none.
 */
function refId(refs: readonly DecisionRef[], type: DecisionRefType): string | undefined {
  return refs.find((ref) => ref.type === type)?.id;
}

/**
 * A ticket ref's key, as intake's search box takes it.
 *
 * @param ref - A `ticket` ref.
 * @returns `#465` for the label `issue #465`.
 */
function ticketKey(ref: DecisionRef): string {
  return ref.label.replace(TICKET_LABEL_PREFIX, "");
}

/**
 * A segment of a source ref — `batch` of `planning:batch:<uuid>`.
 *
 * @param sourceRef - The item's source ref.
 * @param label - The segment's name.
 * @returns The value after it, or `undefined`.
 */
function sourceSegment(sourceRef: string, label: string): string | undefined {
  const parts = sourceRef.split(":");
  const index = parts.indexOf(label);
  const value = index < 0 ? undefined : parts[index + 1];

  return value === undefined || value === "" ? undefined : value;
}

/**
 * Apply a route to a value the item may not carry.
 *
 * @param value - A ref's id, or `undefined`.
 * @param route - The route over it.
 * @returns The path, or null without the value.
 */
function through(value: string | undefined, route: (id: string) => string): string | null {
  return value === undefined ? null : route(value);
}

/**
 * Where one ref's tag leads.
 *
 * @param ref - The ref.
 * @param refs - Every ref of the item — a path's diff is on the item's run.
 * @returns The path, or null when the tag has no page (a path on an item with no run).
 */
export function refHref(ref: DecisionRef, refs: readonly DecisionRef[]): string | null {
  switch (ref.type) {
    case "run":
      return UI_ROUTES.run(ref.id);
    case "pr":
      return UI_ROUTES.pr(ref.id);
    case "ticket":
      return UI_ROUTES.intake(ticketKey(ref));
    case "path":
      return through(refId(refs, "run"), UI_ROUTES.runChanges);
    default:
      return null;
  }
}

/**
 * An item's refs, each with where its tag leads.
 *
 * @param refs - The item's refs.
 * @returns The same refs, in order, with `href`.
 */
export function linkedRefs(refs: readonly DecisionRef[]): LinkedRef[] {
  return refs.map((ref) => ({ ...ref, href: refHref(ref, refs) }));
}

/** Each `navigate.<target>`, resolved against an item. */
const TARGETS: Readonly<Record<string, (context: LinkContext) => string | null>> = {
  pr_verification: ({ refs }) => through(refId(refs, "pr"), UI_ROUTES.pr),
  pr_evidence: ({ refs }) => through(refId(refs, "pr"), UI_ROUTES.prCriteria),
  run_console: ({ refs }) => through(refId(refs, "run"), UI_ROUTES.run),
  run_plan: ({ refs }) => through(refId(refs, "run"), UI_ROUTES.run),
  run_diff: ({ refs }) => through(refId(refs, "run"), UI_ROUTES.runChanges),
  protected_paths_settings: () => UI_ROUTES.protectedPaths,
  knowledge_fact: () => UI_ROUTES.knowledgeFacts,
  planning_batch: ({ sourceRef }) =>
    through(sourceSegment(sourceRef, "batch"), UI_ROUTES.planningBatch),
  ticket: ({ refs }) => {
    const ticket = refs.find((ref) => ref.type === "ticket");

    return ticket === undefined ? null : UI_ROUTES.intake(ticketKey(ticket));
  },
};

/**
 * Where a link action leads.
 *
 * @param binding - The action's `handler_binding`.
 * @param context - The item's refs and source ref.
 * @returns The path; null for an action that answers (not a link), for a target this table does
 *   not know, and for one whose ref the item does not carry.
 */
export function navigationHref(binding: string, context: LinkContext): string | null {
  if (!binding.startsWith(NAVIGATE_PREFIX)) {
    return null;
  }

  return TARGETS[binding.slice(NAVIGATE_PREFIX.length)]?.(context) ?? null;
}
