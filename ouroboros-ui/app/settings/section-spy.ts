/**
 * Which section the reader is in — the section nav's scroll-spy, against the pane
 * (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491)).
 *
 * Mockup 17's nav underlines the section being read. The hazard the issue names is where that
 * is measured: anchors plus a scroll-spy inside a **content-pane scroll container** rather than
 * the window is the kind of thing that works in development and breaks the day the shell's
 * scroll containment applies — `window.scrollY` is always `0` here, and an observer rooted at
 * the viewport measures against a box that never moves. So everything below is asked of the
 * element that actually scrolls, found the way the sticky chrome finds it
 * (`app/ui/chrome.ts`'s `chromeScrollContainer`): the nearest scrolling ancestor, which is the
 * shell's pane in the product and whatever a fixture scrolls in a test.
 *
 * ### The reading line
 *
 * A section is *current* once its top edge has reached the line an anchor jump lands it on:
 * the pane's own `scroll-padding-top`, which `app/shell/shell.css` computes from the measured
 * heights of the chrome stuck there. Reading the padding rather than restating it is what keeps
 * the two agreeing at every font-scale step — a jump to **Policies** puts Policies exactly on
 * the line, so the tab that was pressed is the tab that lights.
 *
 * ### Two sections in one row, and a section the page cannot scroll to
 *
 * The line alone cannot answer two cases. Policies and Audit share a row at desktop widths, so
 * both are on the line at once; and the Danger zone is the last card, usually shorter than the
 * pane, so the page ends before it reaches the line at all. Two rules cover them:
 *
 * - **The end of the page is the last section.** A pane scrolled as far as it goes is showing
 *   the bottom of the page, whatever is on the line — so the last section is current there, and
 *   the Danger zone lights for a reader who simply scrolled down to it.
 * - **A section the reader named is held.** They pressed its tab, or arrived on its link, so
 *   that answer stands ({@link SectionPin}) for as long as the section stays where the jump
 *   put it on screen — which is what lights Audit beside Policies, or Integrations one row
 *   above the end — and is released the moment they scroll, when geometry speaks again. It is
 *   the section's place that is remembered rather than the pane's offset, because the offset
 *   moves without the reader: a bar mounting above the cards shifts the page, the browser's
 *   scroll anchoring adjusts `scrollTop` to keep what is being read still, and the section has
 *   not gone anywhere.
 *
 * ### A press is heard wherever the link is
 *
 * Any link on the page whose address is a fragment of this page naming a section — a tab, the
 * head's *Export audit CSV* — is a way of naming it. The tabs are router links (so the history
 * entries they make are ones Back can return to), and a router's hash navigation fires no
 * `hashchange`; so the watcher listens for the press itself, and for `hashchange` only as the
 * signal of a traversal.
 *
 * **Framework-free.** {@link sectionAtLine}, {@link scrolledToEnd} and {@link pinHolds} are
 * pure; {@link watchSections} is the DOM half; `app/settings/use-section-spy.ts` is the React
 * face.
 */

import { fragmentId, landOn } from "@/app/shell/pane-anchor";
import { chromeScrollContainer } from "@/app/ui/chrome";
import { isPlainClick } from "@/app/workflows/mode-switch";

/** How far a measurement may be off before it counts, in CSS pixels — sub-pixel layout, not a gap. */
export const SPY_TOLERANCE = 1;

/** Where one section's top edge is, measured from the scrollport's top edge. */
export interface SectionTop<T extends string> {
  readonly id: T;
  /** Pixels below the scrollport's top edge. Negative once the section has scrolled past it. */
  readonly top: number;
}

/**
 * The section at the reading line.
 *
 * The section that most recently reached the line: of those whose top is at or above it, the
 * lowest. Two that share a row share a top, and the first in the given order wins — the one on
 * the left, which is the one a reader meets first. Before any section has reached the line (the
 * page is at its head), the answer is the first section drawn; with the pane at the end of its
 * scroll, it is the last one.
 *
 * @param tops Every section's position, in the nav's order.
 * @param line The reading line, in pixels below the scrollport's top edge.
 * @param atEnd Whether the pane is scrolled as far as it goes — see {@link scrolledToEnd}.
 * @returns The current section's id, or `null` when there are no sections to choose from.
 */
export function sectionAtLine<T extends string>(
  tops: readonly SectionTop<T>[],
  line: number,
  atEnd = false,
): T | null {
  let current: SectionTop<T> | null = null;
  let first: SectionTop<T> | null = null;
  let last: SectionTop<T> | null = null;

  for (const section of tops) {
    if (first === null || section.top < first.top - SPY_TOLERANCE) first = section;
    if (last === null || section.top > last.top + SPY_TOLERANCE) last = section;
    if (section.top > line + SPY_TOLERANCE) continue;
    if (current === null || section.top > current.top + SPY_TOLERANCE) current = section;
  }

  return (atEnd ? last : (current ?? first))?.id ?? null;
}

/** The parts of a scrollport that say how far it is scrolled. */
export interface ScrollExtent {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/**
 * Whether a pane is scrolled as far as it goes.
 *
 * Only a pane that *has* scrolled: a page short enough to fit is at its start and its end at
 * once, and reading that as the end would light the last tab on arrival.
 *
 * @param pane The scrollport's extent.
 * @returns `true` at the end of a scroll that has somewhere to go.
 */
export function scrolledToEnd(pane: ScrollExtent): boolean {
  return (
    pane.scrollTop > SPY_TOLERANCE &&
    pane.scrollTop + pane.clientHeight >= pane.scrollHeight - SPY_TOLERANCE
  );
}

/** A section the reader named, and where the jump to it put it. */
export interface SectionPin<T extends string> {
  readonly id: T;
  /** The section's top edge after the jump, in pixels below the scrollport's top edge. */
  readonly top: number;
}

/**
 * Whether a held answer still stands.
 *
 * @param pin The section the reader named, or `null` when none is held.
 * @param top Where that section's top edge is now, against the scrollport's — or `null` when
 *   the section is no longer on the page.
 * @returns `true` while the section is where the jump put it — the reader has not scrolled
 *   since, whatever the page around it has done.
 */
export function pinHolds<T extends string>(pin: SectionPin<T> | null, top: number | null): boolean {
  return pin !== null && top !== null && Math.abs(top - pin.top) <= SPY_TOLERANCE;
}

/** What the watcher hands back. */
export interface SectionWatch<T extends string> {
  /**
   * Bring a section to the reading line and hold it as current.
   *
   * What the watcher itself does for a press on a link to the section and for a fragment
   * naming it. Idempotent with the router's or the browser's own fragment scroll: all scroll
   * the section into view against the same `scroll-padding-top`, so calling this beside one
   * moves nothing twice.
   *
   * @param id The section.
   */
  readonly land: (id: T) => void;
  /** Stop watching. Idempotent. */
  readonly stop: () => void;
}

/**
 * The fragment of the page's address, as a section id.
 *
 * @param ids The sections the nav names.
 * @param hash `location.hash`, with or without its `#`.
 * @returns The section the fragment names, or `null` when it names none of them.
 */
export function sectionFromHash<T extends string>(ids: readonly T[], hash: string): T | null {
  const fragment = fragmentId(hash);

  return ids.find((id) => id === fragment) ?? null;
}

/**
 * Watch the pane, and report the current section whenever it changes.
 *
 * On start it honours the address: a fragment naming a section is landed on — which is what
 * makes a deep link correct on first load, because the browser's own jump ran before the sticky
 * chrome had published its height and stopped short by exactly that much. Without a fragment
 * the current section is read from where the pane already is.
 *
 * @param ids The sections the nav names, in its order. Each is the `id` of an element on the page.
 * @param onActive Called with the current section — on start, and on every change after.
 * @param doc The document to look the sections up in. Defaults to the ambient one.
 * @returns The watch: `land` and `stop`. Outside any scrolling ancestor there is nothing to spy
 *   on, and `land` only reports the section it was given.
 */
export function watchSections<T extends string>(
  ids: readonly T[],
  onActive: (id: T) => void,
  doc: Document = document,
): SectionWatch<T> {
  const view = doc.defaultView;
  const anchor = ids.map((id) => doc.getElementById(id)).find((element) => element !== null);
  const container = anchor === undefined || anchor === null ? null : chromeScrollContainer(anchor);

  if (container === null || view === null) {
    return { land: onActive, stop: () => {} };
  }

  let pin: SectionPin<T> | null = null;
  let last: T | null = null;

  /** Report a section, once per change. */
  const report = (id: T | null): void => {
    if (id === null || id === last) return;
    last = id;
    onActive(id);
  };

  /**
   * Where one section's top edge is, against the pane's.
   *
   * @param id The section.
   * @returns Pixels below the pane's top edge, or `null` when the section is not on the page.
   */
  const topOf = (id: T): number | null => {
    const element = doc.getElementById(id);

    return element === null
      ? null
      : element.getBoundingClientRect().top - container.getBoundingClientRect().top;
  };

  /** Where every section is, against the pane's top edge. */
  const measure = (): SectionTop<T>[] =>
    ids.flatMap((id) => {
      const top = topOf(id);

      return top === null ? [] : [{ id, top }];
    });

  /** The reading line: the pane's own anchor offset. `0` where the engine reports none. */
  const line = (): number => {
    const padding = Number.parseFloat(view.getComputedStyle(container).scrollPaddingTop);

    return Number.isFinite(padding) ? padding : 0;
  };

  /** Read the current section — the held one while it holds, the one on the line otherwise. */
  const read = (): void => {
    if (pin !== null && pinHolds(pin, topOf(pin.id))) {
      report(pin.id);
      return;
    }

    pin = null;
    report(sectionAtLine(measure(), line(), scrolledToEnd(container)));
  };

  const land = (id: T): void => {
    const target = doc.getElementById(id);
    if (target === null) return;

    // The browser's own fragment scroll, which honours the pane's `scroll-padding-top`.
    landOn(target);

    pin = { id, top: topOf(id) ?? 0 };
    report(id);
  };

  /** A fragment arrived by a traversal — Back or Forward between two of the page's entries. */
  const onHash = (): void => {
    const named = sectionFromHash(ids, view.location.hash);
    if (named !== null) land(named);
  };

  /**
   * A press on a link to a section of this page — a tab, or any other link that names one.
   *
   * Not prevented: whatever navigates the link (the router, for a tab) still does, and lands on
   * the same line. A modified press opens the link elsewhere and names nothing here.
   */
  const onPress = (event: MouseEvent): void => {
    if (!isPlainClick(event) || !(event.target instanceof view.Element)) return;

    const link = event.target.closest("a[href]");
    if (!(link instanceof view.HTMLAnchorElement)) return;
    if (link.origin !== view.location.origin || link.pathname !== view.location.pathname) return;
    if (link.search !== view.location.search || link.target !== "") return;

    const named = sectionFromHash(ids, link.hash);
    if (named !== null) land(named);
  };

  container.addEventListener("scroll", read, { passive: true });
  view.addEventListener("resize", read);
  view.addEventListener("hashchange", onHash);
  doc.addEventListener("click", onPress);

  const named = sectionFromHash(ids, view.location.hash);
  if (named === null) {
    read();
  } else {
    land(named);
  }

  let watching = true;

  return {
    land,
    stop: () => {
      if (!watching) return;
      watching = false;

      container.removeEventListener("scroll", read);
      view.removeEventListener("resize", read);
      view.removeEventListener("hashchange", onHash);
      doc.removeEventListener("click", onPress);
    },
  };
}
