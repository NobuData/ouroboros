"use client";

import { useSyncExternalStore } from "react";

/**
 * Reading something only the browser knows, without lying to the server
 * ([#643](https://github.com/NobuData/ouroboros/issues/643)).
 *
 * Two pieces of the shell need a value that does not exist during a server render: the
 * overlay's portal target is a DOM node, and the search pill's shortcut hint depends on the
 * keyboard in front of the reader. Both have the same shape of problem and the same three
 * wrong answers:
 *
 * - **Read it during render.** The server produces one value, the browser another, and React
 *   resolves the disagreement by throwing away the markup around it.
 * - **Read it in an effect and `setState`.** Correct, and a cascading render every time —
 *   which is what `react-hooks/set-state-in-effect` reports, rightly: the component renders
 *   once with a value it knows is wrong, then again with the right one.
 * - **`typeof document === "undefined"`.** Works only while nothing renders open on the
 *   server, and fails silently the day something does.
 *
 * `useSyncExternalStore` is React's own answer: it takes a server snapshot and a client
 * snapshot and uses each where it belongs, so hydration matches by construction and the
 * correction lands in the same pass rather than in a second one. The store here has no
 * subscription because neither value changes after mount — a keyboard is not swapped mid-
 * session, and the overlay layer is markup the shell always renders.
 */

/**
 * A subscription to nothing: these values do not change while the page is up.
 *
 * Declared once at module scope rather than inline, because `useSyncExternalStore`
 * re-subscribes whenever this identity changes — a fresh arrow per render would subscribe and
 * unsubscribe on every one.
 *
 * @returns The unsubscribe function, which likewise does nothing.
 */
const NO_SUBSCRIPTION = () => () => {};

/**
 * A value the browser can answer and the server cannot.
 *
 * @param read How to read it in the browser. Called on every render, so it must return a
 *   **stable identity** for an unchanged value — a primitive or an existing DOM node, never a
 *   freshly built object, which React would read as a change and re-render on forever.
 * @param onServer What to use where there is no browser: the server render, and the hydration
 *   pass that has to match it.
 * @returns `onServer` until the component is hydrated, and the browser's answer thereafter.
 */
export function useClientValue<T>(read: () => T, onServer: T): T {
  return useSyncExternalStore(NO_SUBSCRIPTION, read, () => onServer);
}
