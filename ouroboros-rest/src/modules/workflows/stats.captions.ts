/**
 * The rail's captions, as functions over facts — P.4
 * ([#135](https://github.com/NobuData/ouroboros/issues/135)).
 *
 * Mockup 04 prints five strings this file is responsible for: `6 stages · auto-merge`,
 * `5 stages · needs review`, `5 stages · paused`, the head's `used by 61% of runs`, and the
 * honest `no runs yet` that replaces it in a workspace nothing has run.
 *
 * **Every one of them is computed, and none of them is stored.** V029 says so from the other
 * side — *"a stored count would be a number that drifts from the document it counts"* — and it
 * is the whole of this ticket: a caption written down at publish time is wrong the moment
 * somebody adds a stage, and a stored usage percentage is a number nobody can audit. So the
 * inputs are a definition and a count of runs, and the strings are derived on every read.
 *
 * **Pure, and separate from the statement that fetches the facts**, because a rule about what
 * a caption says is worth reading and testing without a database — `queue.resources.ts`' own
 * argument. `stats.repository.ts` asks PostgreSQL for the two facts a definition yields;
 * everything the rail *renders* is decided here.
 *
 * ---------------------------------------------------------------------------
 * ## Where the two published numbers come from
 *
 * **A stage is a node.** The issue's own diagram says so — `nodes.count = 6 · term.action =
 * open_pr_automerge` → `6 stages · auto-merge` — and so does the rest of the product's
 * vocabulary: the canvas toolbar's **Add stage ▾** adds a node, the inspector's **Delete
 * stage** deletes one, and mockup 20's draft panel numbers `01 trigger` … `09 open PR` and
 * captions the list *9 stages*. So the count is `nodes.length`, and it needs no walk of the
 * graph and no guess about which terminal is the important one.
 *
 * **The mockup's own rail disagrees with its own canvas, and this is the disagreement.**
 * `standard-fix`'s caption reads `6 stages` beside a canvas of twelve nodes
 * (`schemas/workflow-dsl/fixtures/valid/standard-fix.json` is that canvas, node for node).
 * Six is what the *primary path* holds — `analyze · plan · implement · build · test · review`,
 * with the trigger, the two forks, the two terminals and the `> M` branch's `split` left out —
 * so the rail caption was written for a walk of the happy path and the canvas grew past it.
 * That reading is not taken here: "the stages on the path that does not branch" needs a
 * privileged terminal to walk towards, it changes when an author adds a branch that touches
 * nothing else, and it would make `9 stages` in mockup 20 wrong. Which number the *seeded*
 * `standard-fix` shows is therefore #136's to settle — the caption is honest about whatever
 * document is published — and this file counts nodes.
 *
 * **A workflow with no version in force has no stage count at all.** `current_version` is null
 * for a workflow that has only ever had a draft, which is what **+ New workflow** leaves
 * behind: there is no definition in force to count, and `0 stages` would be a number about a
 * document nobody published. {@link NOT_PUBLISHED_CAPTION} is what the rail reads instead.
 */

import { TERM_ACTIONS } from "./dsl.schema";
import type { WorkflowStatus } from "../db/schema";

/** One of the `action` values a `term` node may carry — `dsl.schema.ts`' vocabulary as a type. */
export type TerminalAction = (typeof TERM_ACTIONS)[number];

/**
 * The word the rail prints for each terminal behaviour.
 *
 * The mockup's own strings: `auto-merge` and `needs review` are on the rail as written, and
 * `back to queue` is the third action's — the mini pill the canvas draws on `Back to queue`,
 * in the same lower-case prose as the other two.
 *
 * Exhaustive by type. Adding an action to the DSL is a compile error here, which is the point:
 * a fourth terminal behaviour must be given a word rather than silently caption nothing.
 */
export const TERMINAL_CAPTIONS: Readonly<Record<TerminalAction, string>> = Object.freeze({
  open_pr_automerge: "auto-merge",
  needs_review: "needs review",
  back_to_queue: "back to queue",
});

/**
 * Which terminal a caption names when a definition has more than one.
 *
 * A document may legally end in several places — `standard-fix` ends at `Open PR & auto-merge`
 * *and* at `Back to queue`, because the `> M` branch splits the work and hands it back — so
 * "the term node's action" needs a rule, and the mockup states the answer rather than the
 * rule: that workflow's caption is `auto-merge`.
 *
 * The rule is **the furthest outcome the workflow can reach**, which is the question a rail
 * caption answers — *what does this workflow do when it works?*
 *
 *   1. `open_pr_automerge` — it finishes on its own.
 *   2. `needs_review` — it finishes, and stops for a person.
 *   3. `back_to_queue` — it hands the work back, which is a re-entry rather than a completion.
 *
 * Precedence rather than a graph walk, for {@link TERMINAL_CAPTIONS}' neighbour's reason: a
 * walk needs a privileged path, and a caption that changed because an author added an
 * unrelated branch would be a caption nobody trusts.
 */
export const TERMINAL_PRECEDENCE: readonly TerminalAction[] = Object.freeze([
  "open_pr_automerge",
  "needs_review",
  "back_to_queue",
]);

/** What the stage segment reads for a workflow with no published version in force. */
export const NOT_PUBLISHED_CAPTION = "not published";

/** What the head reads for a workspace whose window holds no runs at all. */
export const NO_RUNS_CAPTION = "no runs yet";

/** The separator the mockup's captions are joined with — a middle dot, spaced. */
export const CAPTION_SEPARATOR = " · ";

/**
 * Which behaviour the caption names, given every terminal action the definition holds.
 *
 * @param actions - The `action` of every `term` node in the definition in force, in any order
 *   and with duplicates allowed — which is what the statement returns. Values outside the
 *   DSL's vocabulary are ignored rather than rendered: `workflow_versions.definition` is
 *   CHECKed to be an object and no further, so a stored document may say anything, and a
 *   caption is not the place to discover it.
 * @returns The winning action by {@link TERMINAL_PRECEDENCE}, or `null` when the definition
 *   names no terminal this build knows — an unpublished workflow, an empty `{}` draft, or a
 *   document written in a DSL version this build does not implement.
 */
export function terminalBehaviour(actions: readonly string[]): TerminalAction | null {
  return TERMINAL_PRECEDENCE.find((action) => actions.includes(action)) ?? null;
}

/**
 * The caption's first segment — how many stages the definition in force holds.
 *
 * @param stageCount - The node count of the version in force, or `null` when there is no
 *   version in force or its definition is not one this build can count nodes in.
 * @returns `6 stages`, `1 stage` for the singular, or {@link NOT_PUBLISHED_CAPTION}.
 */
export function stageSegment(stageCount: number | null): string {
  if (stageCount === null) return NOT_PUBLISHED_CAPTION;

  return `${stageCount} ${stageCount === 1 ? "stage" : "stages"}`;
}

/** What one rail caption is composed from. */
export interface RailCaptionFacts {
  /** The node count of the version in force, or `null` when nothing is in force. */
  readonly stageCount: number | null;
  /** `workflows.status` — `paused` is what the mockup's err-dot and its caption both read. */
  readonly status: WorkflowStatus;
  /** Every `term` node's action in the definition in force. */
  readonly terminalActions: readonly string[];
}

/**
 * The rail caption, as the mockup writes it.
 *
 * Two segments joined by a middle dot: how many stages, then what the workflow *does*.
 *
 * **`paused` replaces the behaviour rather than joining it**, which is the mockup's own
 * choice: `hotfix-p0` reads `5 stages · paused` and says nothing about its terminal. That is
 * the honest ordering — a paused workflow's terminal behaviour is not what a reader needs to
 * know about it — and the err-dot beside the name is the same fact drawn twice.
 *
 * @param facts - The definition's two derived numbers and the workflow's status.
 * @returns `6 stages · auto-merge`, `5 stages · paused`, `not published`, or — for a published
 *   document naming no terminal this build knows — the stage segment alone.
 */
export function railCaption(facts: RailCaptionFacts): string {
  const behaviour =
    facts.status === "paused"
      ? "paused"
      : (() => {
          const action = terminalBehaviour(facts.terminalActions);
          return action === null ? null : TERMINAL_CAPTIONS[action];
        })();

  return [stageSegment(facts.stageCount), behaviour]
    .filter((segment): segment is string => segment !== null)
    .join(CAPTION_SEPARATOR);
}

/**
 * What share of the window's runs carried this workflow's slug, as a whole percent.
 *
 * Rounded rather than truncated, because the mockup's `61%` is a share presented to a person
 * and the nearest whole number is what a person means by one.
 *
 * @param runs - How many runs in the window carried this slug.
 * @param total - How many runs the window holds in all, for this workspace.
 * @returns The percentage, `0`–`100`, or **`null` when the window holds no runs at all** —
 *   which is the ticket's honesty rule as a return type rather than as a caption: there is no
 *   share of nothing, so there is no number to hand a caller who might render it.
 */
export function usageShare(runs: number, total: number): number | null {
  if (total <= 0) return null;

  return Math.round((runs / total) * 100);
}

/**
 * The head's subline, as the mockup writes it: `used by 61% of runs`.
 *
 * Three answers, and the differences are the point:
 *
 *   * **No runs in the window at all** — {@link NO_RUNS_CAPTION}. *"An org with no runs shows
 *     `no runs yet` — never a fabricated percentage"*, and never `used by 0% of runs` either,
 *     which is a number about a denominator that does not exist.
 *   * **Runs, but fewer than half a percent of them are this workflow's** — `used by <1% of
 *     runs`. `used by 0% of runs` beside a workflow that demonstrably ran is the one reading a
 *     rounded share can make that is worse than the precision it hides.
 *   * **Otherwise** — the rounded share.
 *
 * @param runs - How many runs in the window carried this slug.
 * @param total - How many runs the window holds in all, for this workspace.
 * @returns The subline.
 */
export function usageCaption(runs: number, total: number): string {
  const share = usageShare(runs, total);

  if (share === null) return NO_RUNS_CAPTION;
  if (share === 0 && runs > 0) return "used by <1% of runs";

  return `used by ${share}% of runs`;
}
