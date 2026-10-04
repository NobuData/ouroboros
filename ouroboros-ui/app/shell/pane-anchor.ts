/**
 * Landing on the fragment a page was opened with
 * (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491)).
 *
 * `docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.3: *"anchor deep-links scroll the pane, not the
 * body."* The browser does that on a full load and the router does it on a client-side
 * navigation — when the target exists at the moment they look. A route with a `loading.tsx`
 * commits its skeleton first, the router looks for the fragment's element in the skeleton,
 * finds nothing, and never looks again; the page that streams in a moment later is left at
 * its top. The settings nav's **Knowledge / env** tab is such a link (`/knowledge#repo-profile`),
 * and so is every link to a playbook's row.
 *
 * So a screen that is a fragment's destination lands on it itself, once it has mounted: by
 * then its content is in the document, which is the one thing the router could not wait for.
 * The scroll is the element's own `scrollIntoView`, so it moves the nearest scroll container —
 * the pane — and honours the `scroll-padding-top` the pane declares for its stuck chrome
 * (`app/shell/shell.css`). Idempotent beside the browser's or the router's jump: all three
 * land the target on the same line.
 *
 * **Framework-free and DOM-only**, the way `app/shell/pane-scroll.ts` is.
 */

/**
 * The element id a fragment names.
 *
 * @param hash A location's `hash`, with or without its `#`.
 * @returns The id, percent-decoded — or the raw text when it is not validly encoded, which
 *   then names nothing. Empty for an address with no fragment.
 */
export function fragmentId(hash: string): string {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;

  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Bring an element to the top of the pane's reading area.
 *
 * @param target The element.
 */
export function landOn(target: Element): void {
  // Absent in jsdom; everywhere else this is the browser's own fragment scroll.
  if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "start" });
}

/**
 * Land on the element the address's fragment names, if it names one.
 *
 * @param doc The document. Defaults to the ambient one; a test passes its own.
 * @returns The element landed on, or `null` when the address has no fragment or it names
 *   nothing on the page.
 */
export function landOnFragment(doc: Document = document): Element | null {
  const id = fragmentId(doc.defaultView?.location.hash ?? "");
  if (id === "") return null;

  const target = doc.getElementById(id);
  if (target !== null) landOn(target);

  return target;
}
