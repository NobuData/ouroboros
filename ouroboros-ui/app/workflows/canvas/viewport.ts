/**
 * Where a reader is on the canvas, remembered per workflow (S.2,
 * [#148](https://github.com/NobuData/ouroboros/issues/148)) — and the zoom ladder the
 * toolbar's three presets climb.
 *
 * ### Per workflow, in the browser
 *
 * The ticket's *viewport persists per workflow across navigation* is a fact about the reader's
 * browser, not about the workflow: two people opening `standard-fix` should see the same picture
 * (the document carries the positions, `docs/WORKFLOW_DSL.md`), but each is entitled to their
 * own place on it. So the viewport is kept in `localStorage`, one key per workflow id, the way
 * the theme (`app/theme.ts`) and the sidebar's width are kept — and through the same guarded
 * accessor, because reaching storage can throw and a reader in a private window still gets a
 * canvas; it opens at home instead.
 *
 * ### Home is the mockup's picture
 *
 * A canvas with nothing stored opens at the origin at 100%, which is where the document's
 * positions were written: `left: 24px; top: 40px` in the mockup is `{x: 24, y: 40}` in the
 * seed, and at home the trigger node sits exactly there. The toolbar's **100%** returns to
 * home rather than resetting the zoom about wherever the reader has panned to, so there is
 * always one press that brings the picture back.
 *
 * **Framework-free**, the way `app/workflows/view.ts` is.
 */

import type { Viewport } from "@xyflow/react";

import { safeStorage } from "@/app/browser";

/** How far out the canvas zooms — React Flow's own floor, and the ladder's first rung. */
export const MIN_ZOOM = 0.5;

/** How far in — React Flow's own ceiling, and the ladder's last rung. */
export const MAX_ZOOM = 2;

/**
 * The presets the toolbar's **−** and **+** step between, smallest first.
 *
 * A ladder rather than a factor, so that pressing **+** from 100% lands on a number a reader
 * would name — 125%, not 120% — and so that **−** then **+** returns to where it started.
 */
export const ZOOM_PRESETS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** The origin at 100%: where a canvas with nothing remembered opens, and what **100%** returns to. */
export const HOME_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

/** The `localStorage` key prefix; the workflow's id follows it. */
export const VIEWPORT_STORAGE_PREFIX = "ouro-studio-viewport:";

/** Floating-point slack when comparing a zoom to a rung — `zoomTo(1.25)` reads back as `1.25` and nothing else, but the ladder should not depend on it. */
const EPSILON = 1e-6;

/**
 * The key a workflow's viewport is stored under.
 *
 * @param workflowId The workflow's id — `workflows.id`, never its slug, which is what a link
 *   carries and what a rename cannot change either; the id is simply the one that is a key.
 * @returns The key.
 */
export function viewportKey(workflowId: string): string {
  return `${VIEWPORT_STORAGE_PREFIX}${workflowId}`;
}

/**
 * Narrow an untrusted string to a viewport.
 *
 * @param value What storage held, typically straight out of `localStorage`.
 * @returns The viewport, when the value is a JSON object with finite `x`, `y` and `zoom` and
 *   the zoom is within the canvas's range; `null` for anything else — a key edited by hand,
 *   one written by a build with a different range, or none at all — which opens at home.
 */
export function parseViewport(value: string | null | undefined): Viewport | null {
  if (typeof value !== "string") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const { x, y, zoom } = parsed as Record<string, unknown>;
  if (![x, y, zoom].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  if ((zoom as number) < MIN_ZOOM || (zoom as number) > MAX_ZOOM) return null;

  return { x: x as number, y: y as number, zoom: zoom as number };
}

/**
 * The viewport a reader left a workflow at.
 *
 * @param workflowId The workflow's id.
 * @param storage Where to read from. Defaults to `window.localStorage`, guarded.
 * @returns The viewport, or `null` when none is remembered or storage cannot be reached — both
 *   of which open the canvas at {@link HOME_VIEWPORT}.
 */
export function readViewport(
  workflowId: string,
  storage: Storage | undefined = safeStorage(),
): Viewport | null {
  try {
    return parseViewport(storage?.getItem(viewportKey(workflowId)));
  } catch {
    return null;
  }
}

/**
 * Remember where a reader is on a workflow.
 *
 * @param workflowId The workflow's id.
 * @param viewport Where they are.
 * @param storage Where to write. Defaults to `window.localStorage`, guarded.
 * @returns Nothing. A storage that refuses the write is not an error a reader can act on: the
 *   place applies to this visit and simply will not be remembered.
 */
export function storeViewport(
  workflowId: string,
  viewport: Viewport,
  storage: Storage | undefined = safeStorage(),
): void {
  try {
    storage?.setItem(
      viewportKey(workflowId),
      JSON.stringify({ x: viewport.x, y: viewport.y, zoom: viewport.zoom }),
    );
  } catch {
    /* private mode, or a full quota — the place just will not be remembered. */
  }
}

/**
 * The next rung of the ladder in a direction.
 *
 * From between two rungs, the nearer one in that direction; from the last rung, the same rung
 * again, so the buttons clamp rather than wrap.
 *
 * @param zoom Where the canvas is now.
 * @param direction `1` to zoom in, `-1` to zoom out.
 * @returns The zoom to go to.
 */
export function nextZoom(zoom: number, direction: 1 | -1): number {
  if (direction === 1) {
    return ZOOM_PRESETS.find((rung) => rung > zoom + EPSILON) ?? MAX_ZOOM;
  }

  return [...ZOOM_PRESETS].reverse().find((rung) => rung < zoom - EPSILON) ?? MIN_ZOOM;
}

/**
 * A zoom as the toolbar prints it.
 *
 * @param zoom The zoom, `1` being actual size.
 * @returns `100%` — whole percent, because the readout is a control's label and not a measurement.
 */
export function zoomPercent(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}
