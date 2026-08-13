"use client";

import { useSyncExternalStore } from "react";

import {
  DEFAULT_FONT_SCALE,
  type FontScale,
  currentFontScale,
  subscribeFontScale,
} from "@/app/font-scale";

/**
 * The one place the font-scale store meets React
 * ([#649](https://github.com/NobuData/ouroboros/issues/649)) — the same thin seam
 * `app/shell/use-shell-nav.ts` is for the sidebar, kept apart from `app/font-scale.ts` so
 * the engine stays importable by the root layout (a Server Component) for its boot script.
 *
 * `useSyncExternalStore` for the reason `app/shell/client-value.ts` lays out at length: the
 * server snapshot is the default, the browser corrects it in the same pass hydration runs
 * in, and every subscriber — the menu's stepper (CP.3), Settings → Appearance (#492), and
 * the session reconciler — re-renders from one value the moment any of them moves it.
 */

/**
 * The step the reader is looking at, live.
 *
 * @returns The current {@link FontScale}. On the server, the default — the boot script has
 *   already stamped the real one on `<html>` before hydration, so the correction here
 *   changes what components *render*, never what the reader sees painted.
 */
export function useFontScale(): FontScale {
  return useSyncExternalStore(subscribeFontScale, currentFontScale, () => DEFAULT_FONT_SCALE);
}
