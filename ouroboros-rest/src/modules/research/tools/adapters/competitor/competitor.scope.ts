/**
 * The region of a page a watch diffs, and whether the page can be read at all without a script
 * running (CL.3, [#616](https://github.com/NobuData/ouroboros/issues/616)).
 *
 * A selector picks the region; without one, the page reader's main content is the region — the
 * extractor already drops navigation, banners and footers. A selector's matches are taken
 * outermost-first in document order, so `main, .release` does not count a release twice.
 */

import {
  matchesSelector,
  parseSelector,
  type SelectorList,
  type SelectorNode,
} from "../../../competitors/competitor.selector";
import {
  htmlAttribute,
  parseHtml,
  renderText,
  visibleText,
  type HtmlElement,
} from "../web/web.extract";

/** What a selector found. */
export interface ScopedRegion {
  /** The matched regions' text, joined; empty when nothing matched. */
  readonly text: string;
  /** How many outermost elements matched. */
  readonly matches: number;
}

/** Below this much visible text, a page that runs scripts is taken to render with them. */
export const RENDERED_TEXT_THRESHOLD = 200;

/** The mount points single-page applications render into, empty until their script runs. */
const APP_SHELL =
  /<(?:div|main|section)\b[^>]*\b(?:id\s*=\s*["']?(?:root|app|__next|__nuxt|svelte|___gatsby)["'\s>]|data-reactroot|ng-app|ng-version)/i;

/** A `<noscript>` asking for JavaScript. */
const NOSCRIPT_PLEA =
  /<noscript\b[^>]*>[\s\S]*?(?:enable|requires?|turn on)\s+javascript[\s\S]*?<\/noscript>/i;

/**
 * The region a selector names.
 *
 * @param html - The page.
 * @param selector - The watch's selector.
 * @returns The region's text and how many elements it came from.
 */
export function scopeHtml(html: string, selector: string): ScopedRegion {
  const parsed = parseSelector(selector);
  const parts: string[] = [];

  collect(parseHtml(html), null, parsed, parts);
  return { text: parts.join("\n\n"), matches: parts.length };
}

/**
 * Whether a page looks like it renders its content with JavaScript — so an empty region means
 * "needs the render tier", not "nothing there".
 *
 * @param html - The page.
 * @returns `true` for an application shell, a `<noscript>` asking for JavaScript, or a page with
 *   scripts and almost no visible text.
 */
export function looksScriptRendered(html: string): boolean {
  if (NOSCRIPT_PLEA.test(html)) return true;

  const scripts = (html.match(/<script\b/gi) ?? []).length;
  const visible = visibleText(html).length;

  if (visible >= RENDERED_TEXT_THRESHOLD) return false;
  return (
    scripts > 0 && (APP_SHELL.test(html) || visible < RENDERED_TEXT_THRESHOLD / 4 || scripts >= 3)
  );
}

function collect(
  element: HtmlElement,
  parent: SelectorNode | null,
  selector: SelectorList,
  parts: string[],
): void {
  for (const child of element.children) {
    if (typeof child === "string") continue;

    const node: SelectorNode = {
      tag: child.tag,
      parent,
      attribute: (name) => htmlAttribute(child, name),
    };

    if (matchesSelector(selector, node)) {
      const text = renderText(child);
      if (text !== "") parts.push(text);
      continue;
    }
    collect(child, node, selector, parts);
  }
}
