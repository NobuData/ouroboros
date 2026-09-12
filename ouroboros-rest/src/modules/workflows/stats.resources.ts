/**
 * What one workflow's statistics are, as the studio reads them — P.4
 * ([#135](https://github.com/NobuData/ouroboros/issues/135)).
 *
 * Mockup 04 renders these numbers twice and the two renderings must agree: the `.wf-list`
 * rail's caption under each name, and the page head's subline for the *active* workflow. So
 * there is one shape, produced once per workflow, carrying both the facts and the strings —
 * and the rail entry for `standard-fix` is literally the object the head is drawn from.
 *
 * ---------------------------------------------------------------------------
 * ## Why the captions are composed here rather than in the browser
 *
 * The roadmap's own sketch of the rail payload says so — `[{slug, name, status, caption
 * "6 stages · auto-merge", usage%}]` — and the reason is the honesty rule this ticket exists
 * to serve. *`no runs yet`* is not a formatting choice: it is the answer, and a client handed
 * `{runs: 0, total: 0}` has to be told not to divide. Shipping the sentence removes the one
 * place a second implementation could invent `0%`.
 *
 * **The facts travel beside the strings**, because a caption is not a data source. `#147`'s
 * rail needs `status` to draw the err-dot and `stageCount` to decide whether an entry has
 * anything to say; a surface that had to parse `5 stages · paused` to learn either would be a
 * surface that breaks when the wording changes.
 *
 * ## `usagePercent` is nullable, and that is the contract
 *
 * `null` means *this workspace has no runs in the window* — not zero, not unknown, and not
 * something to render as a percentage. The string beside it already says `no runs yet`;
 * the null is what stops a client composing its own subline from the number.
 */

import {
  railCaption,
  terminalBehaviour,
  usageCaption,
  usageShare,
  type TerminalAction,
} from "./stats.captions";
import type { WorkflowRegistryRow } from "./stats.repository";
import type { WorkflowStatus } from "../db/schema";

/** One workflow's computed statistics — a rail entry, and the head's subline for the active one. */
export interface WorkflowStats {
  /** `workflows.id`. */
  readonly id: string;
  /** The slug — what a `workflow_tag` resolves through, and what the assign menu sends. */
  readonly slug: string;
  /** The human title the rail and the page head print. */
  readonly name: string;
  /** `active` or `paused`. The err-dot beside the mockup's `hotfix-p0` is this field. */
  readonly status: WorkflowStatus;
  /** The `v14` chip's number, or `null` for a workflow that has only ever had a draft. */
  readonly currentVersion: number | null;
  /**
   * How many stages the definition in force holds — its node count.
   *
   * `null` when there is no version in force, which is the state **+ New workflow** leaves a
   * workflow in. Not `0`: a workflow nobody has published has no stage count, and zero would
   * be a claim about a document that does not exist.
   */
  readonly stageCount: number | null;
  /**
   * What the workflow does when it finishes, from the definition's terminals.
   *
   * `null` when nothing is published, or when the published document names no terminal action
   * this build knows. The word the rail prints for it is inside {@link caption}.
   */
  readonly terminal: TerminalAction | null;
  /** The rail's caption: `6 stages · auto-merge`, `5 stages · paused`, `not published`. */
  readonly caption: string;
  /** How many of the window's runs carried this slug. */
  readonly runs: number;
  /**
   * That as a whole percent of every run in the window, or `null` when the window holds none.
   *
   * See this file's header: the null is the honesty rule as a type, and it is never `0` for a
   * workspace with nothing to divide by.
   */
  readonly usagePercent: number | null;
  /** The head's subline: `used by 61% of runs`, `used by <1% of runs`, or `no runs yet`. */
  readonly usageCaption: string;
}

/**
 * One row and its run count, as the studio reads them.
 *
 * @param row - The workflow and the two facts its definition in force yielded.
 * @param runs - How many runs in the window carried this workflow's slug. `0` when none did,
 *   which is a real answer and distinct from the workspace having no runs at all.
 * @param totalRuns - How many runs the window holds for this workspace, across every tag —
 *   including tags that resolve to no workflow, because those are still runs it performed.
 * @returns The statistics, facts and captions together.
 */
export function workflowStats(
  row: WorkflowRegistryRow,
  runs: number,
  totalRuns: number,
): WorkflowStats {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    currentVersion: row.current_version,
    stageCount: row.stage_count,
    terminal: terminalBehaviour(row.terminal_actions),
    caption: railCaption({
      stageCount: row.stage_count,
      status: row.status,
      terminalActions: row.terminal_actions,
    }),
    runs,
    usagePercent: usageShare(runs, totalRuns),
    usageCaption: usageCaption(runs, totalRuns),
  };
}
