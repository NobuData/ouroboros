/**
 * The template tiles' words and pure rules (BC.3,
 * [#392](https://github.com/NobuData/ouroboros/issues/392), mockup 13's *"Choose a starting
 * workflow"*).
 *
 * **The lock is a computation, the caption is a sentence, the selection is a workflow.** Every
 * tile is the service's (BB.3, #386): its gate is evaluated there against the workspace's merged
 * loops, and selecting it publishes a real workflow through the studio's own gate (decision
 * **O4**). This module decides only how a tile is drawn — which pill the head wears, which chips
 * an effort range becomes, what a locked tile says to a screen reader — and what the card says
 * after a selection.
 *
 * **No caption carries a statistic** (decision **O8**). The mockup's *"92% of teams start here"*
 * is a cross-tenant figure nothing collects, so {@link captionOf} drops any caption shaped like
 * one, on top of the service's own gate. It is a review gate, not a comment: the module's own
 * copy is scanned for a percent sign by its suite.
 *
 * Framework-free and pure.
 */

import type {
  OnboardingInstantiatedWorkflow,
  OnboardingStep,
  OnboardingTemplateSelection,
  OnboardingTemplateTile,
  OnboardingTemplateTiles,
  OnboardingTemplateUnlock,
} from "@/app/api/onboarding";
import type { Effort } from "@/app/ui";

/** The card's title, as the mockup sets it. */
export const TEMPLATES_TITLE = "Choose a starting workflow";

/** The head's pill while step 3 is the one to do, and once it is done. */
export const YOU_ARE_HERE = "step 3 · you are here";
export const STEP_DONE_TAG = "✓ step 3 done";

/** The head's corner link — the studio's root. */
export const STUDIO_LINK = "Open Workflow Studio →";

/** The grid's accessible name. */
export const GRID_LABEL = "Starting workflows";

/** The selected tile's mark, as the mockup prints it. */
export const SELECTED_MARK = "✓ selected";

/** The footer's promise — true because a selection publishes a workflow (O4). */
export const FOOTER_BEFORE = "All templates are editable later in the ";
export const FOOTER_LINK = "Workflow Studio";
export const FOOTER_AFTER = " — visually or as code.";

/** A tile's own studio link, once a workflow was made from it. */
export const TILE_STUDIO_LINK = "Open in the Studio →";

/** The selection's progress and success. */
export const SELECTING = "Creating your workflow…";
export const OPEN_IN_STUDIO = "Open it in the Workflow Studio →";

/** Why a person cannot select. */
export const ADMIN_REASON = "Only an owner or admin can create a workflow from a template.";

/** What the designed error says above the gate's findings. */
export const INVALID_NOTHING_CREATED =
  "Nothing was created — no workflow, no draft, and the choice did not change.";

/** What the card says when the workspace is offered no template. */
export const NO_TEMPLATES = "No starting workflow is offered to this workspace yet.";

/** What the card says when it could not be read. */
export const UNREACHABLE_TEMPLATES =
  "The starting workflows could not be reached. They will be read again shortly.";
export const UNREADABLE_TEMPLATES =
  "The starting workflows answered with something that could not be read.";

/** What a write says for a template name that is not shaped like one. */
export const NOT_A_TEMPLATE = "That is not a template.";

/** The re-selection dialog's cancel. */
export const RESELECT_CANCEL = "Keep the current choice";

/**
 * What a caption may not contain: a digit or a percent sign — the shape of an invented
 * statistic (decision O8). The service's `qualitativeCaption` holds the same rule.
 */
export const FABRICATED_STATISTIC = /[0-9%]/;

/** V068's template slug grammar — what a selection may name. */
const TEMPLATE_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** One finding of the publish gate, as the designed error lists it. */
export interface TemplateFinding {
  /** Which validator said so — `dsl`, `registry`, `engine`. */
  readonly source: string;
  /** Which rule broke, in that validator's vocabulary. */
  readonly code: string;
  /** What a person should read. */
  readonly message: string;
  /** Where in the definition, when the gate said. */
  readonly path: string | null;
}

/**
 * The head's pill for step 3's state on the rail.
 *
 * @param status Step 3's status, or null when the rail is not known.
 * @returns The pill's text and tone, or null when step 3 is still ahead.
 */
export function stepPill(
  status: OnboardingStep["status"] | null,
): { readonly text: string; readonly tone: "accent" | "ok" } | null {
  if (status === "active") return { text: YOU_ARE_HERE, tone: "accent" };
  if (status === "done") return { text: STEP_DONE_TAG, tone: "ok" };

  return null;
}

/**
 * A caption as the tile prints it — or nothing, when it carries the shape of a statistic (O8).
 *
 * @param caption The service's caption.
 * @returns The caption, or null.
 */
export function captionOf(caption: string | null): string | null {
  if (caption === null || caption.trim() === "" || FABRICATED_STATISTIC.test(caption)) return null;

  return caption;
}

/**
 * An effort chip for one of the tile's sizes — the service spells them lower-case.
 *
 * @param effort `xs` … `xl`.
 * @returns The chip's size, or null for anything the chip set does not have.
 */
export function effortOf(effort: string): Effort | null {
  switch (effort.toLowerCase()) {
    case "xs":
      return "XS";
    case "s":
      return "S";
    case "m":
      return "M";
    case "l":
      return "L";
    case "xl":
      return "XL";
    default:
      return null;
  }
}

/**
 * Whether a tile is gated shut.
 *
 * @param tile The tile.
 * @returns True while its tier is locked.
 */
export function isLocked(tile: OnboardingTemplateTile): boolean {
  return tile.unlock?.locked === true;
}

/**
 * What a screen reader hears for a locked tile — its state and the computed reason, in the
 * service's words, never only the dimming.
 *
 * @param unlock The evaluated gate.
 * @returns `Locked — 3 of 10 merged loops; unlock after 10 merged loops.`
 */
export function lockedReason(unlock: OnboardingTemplateUnlock): string {
  return `Locked — ${unlock.progress}; ${unlock.rule}.`;
}

/**
 * The stage dots as a sentence, for a screen reader — the dots themselves are decoration.
 *
 * @param stageDots The tile's stages.
 * @returns `Stages: analyze, plan, code, build, test, PR.`
 */
export function stagesSentence(stageDots: readonly string[]): string {
  return stageDots.length === 0 ? "" : `Stages: ${stageDots.join(", ")}.`;
}

/**
 * Whether a selection may name this template — V068's slug grammar.
 *
 * @param slug What was passed.
 * @returns True for a slug.
 */
export function isTemplateSlug(slug: unknown): slug is string {
  return typeof slug === "string" && TEMPLATE_SLUG.test(slug);
}

/**
 * The workflow a re-selection would leave behind: the live workflow of the tile currently
 * selected, when the person is switching to another tile. Null when nothing was created yet —
 * a recorded choice with no workflow behind it has nothing to keep — or when they press the
 * selected tile itself.
 *
 * @param tiles The grid.
 * @param next The tile pressed.
 * @returns The workflow to confirm about, or null.
 */
export function previousWorkflow(
  tiles: OnboardingTemplateTiles,
  next: OnboardingTemplateTile,
): OnboardingInstantiatedWorkflow | null {
  const current = tiles.tiles.find((tile) => tile.selected);

  if (current === undefined || current.slug === next.slug) return null;

  return current.workflow;
}

/**
 * The re-selection dialog's title.
 *
 * @param next The tile pressed.
 * @returns `Switch to Feature builder?`
 */
export function reselectTitle(next: OnboardingTemplateTile): string {
  return `Switch to ${next.name}?`;
}

/**
 * What the re-selection dialog states: the previous workflow remains.
 *
 * @param previous The workflow the current choice created.
 * @returns The sentence.
 */
export function reselectKeeps(previous: OnboardingInstantiatedWorkflow): string {
  return `${previous.name} stays. It is a real workflow of this workspace, not a draft of the wizard, and switching deletes nothing — only this repository's starting workflow changes.`;
}

/**
 * The re-selection dialog's confirm.
 *
 * @param next The tile pressed.
 * @returns `Switch to Feature builder`
 */
export function reselectConfirm(next: OnboardingTemplateTile): string {
  return `Switch to ${next.name}`;
}

/**
 * The link to the workflow a re-selection keeps.
 *
 * @param previous The workflow.
 * @returns `Open Quick fixes in the Workflow Studio →`
 */
export function reselectLink(previous: OnboardingInstantiatedWorkflow): string {
  return `Open ${previous.name} in the Workflow Studio →`;
}

/**
 * What the card says after a selection went through.
 *
 * @param selection The service's answer.
 * @returns `Created Quick fixes.`, or the reuse stated plainly.
 */
export function successLine(selection: OnboardingTemplateSelection): string {
  const { name } = selection.workflow;

  return selection.created
    ? `Created ${name}.`
    : `Using ${name}, the workflow already made from this template.`;
}

/**
 * The designed error's first line for a template the gate refused.
 *
 * @param tile The tile pressed.
 * @returns The sentence.
 */
export function invalidLine(tile: OnboardingTemplateTile): string {
  return `The ${tile.name} template could not be turned into a workflow: its definition did not pass validation.`;
}

/**
 * One finding, as the designed error lists it.
 *
 * @param finding The finding.
 * @returns `dsl · unreachable_node — Stage "review" is unreachable. (at /nodes/3)`
 */
export function findingLine(finding: TemplateFinding): string {
  const where = finding.path === null ? "" : ` (at ${finding.path})`;

  return `${finding.source} · ${finding.code} — ${finding.message}${where}`;
}

/**
 * The gate's findings out of a refusal's details, read defensively — anything that is not a
 * finding is left out rather than guessed.
 *
 * @param details The error envelope's details.
 * @returns The findings, in the gate's order.
 */
export function findingsOf(details: unknown): readonly TemplateFinding[] {
  if (typeof details !== "object" || details === null) return [];

  const { findings } = details as { findings?: unknown };
  if (!Array.isArray(findings)) return [];

  return findings.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];

    const { source, code, message, path } = entry as Record<string, unknown>;
    if (typeof message !== "string" || message === "") return [];

    return [
      {
        source: typeof source === "string" ? source : "gate",
        code: typeof code === "string" ? code : "refused",
        message,
        path: typeof path === "string" && path !== "" ? path : null,
      },
    ];
  });
}

/**
 * The grid with a selection applied — the chosen tile marked and carrying its workflow — for
 * the moment between the service's answer and the poll's next read.
 *
 * @param tiles The grid as last read.
 * @param selection The service's answer.
 * @returns The grid as the next read will show it.
 */
export function withSelection(
  tiles: OnboardingTemplateTiles,
  selection: OnboardingTemplateSelection,
): OnboardingTemplateTiles {
  const slug = selection.workflow.templateSlug;

  return {
    ...tiles,
    selectedTemplate: slug,
    tiles: tiles.tiles.map((tile) =>
      tile.slug === slug
        ? { ...tile, selected: true, workflow: selection.workflow }
        : { ...tile, selected: false },
    ),
  };
}
