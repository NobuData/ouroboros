/**
 * The two globals that are not always there, read in the one way that cannot throw.
 *
 * Both of these were private to `app/theme.ts` until CP.2
 * ([#644](https://github.com/NobuData/ouroboros/issues/644)) gave the sidebar a second
 * preference to remember — the collapse state — with exactly the same two problems the theme
 * has:
 *
 * - **The server has no `window`.** Every module that persists a preference is imported by a
 *   Server Component somewhere up the tree, so reaching for `window` at module scope is a
 *   build that fails on a page nobody expected to break.
 * - **Reaching `localStorage` can throw.** Safari's private mode and a browser configured to
 *   block storage both raise on the *property access*, not on the read — which is why
 *   {@link safeStorage} is a function with a `try` rather than a constant.
 *
 * A preference that cannot be stored is not an error a reader can act on: the choice applies
 * to this session and is simply not remembered. Both functions return `undefined` instead, and
 * every caller treats that as "there is nowhere to write".
 *
 * **Framework-free**, in the way `app/paths.ts` is: no `next/*`, no React. It is imported by
 * the inline boot scripts' modules, which run before React exists.
 */

/**
 * The global `window`, where there is one.
 *
 * @returns `window` in the browser, `undefined` during a server render.
 */
export function safeWindow(): Window | undefined {
  return typeof window === "undefined" ? undefined : window;
}

/**
 * `window.localStorage`, where it can be reached.
 *
 * @returns Local storage, or `undefined` on the server and wherever storage is blocked.
 */
export function safeStorage(): Storage | undefined {
  try {
    return safeWindow()?.localStorage;
  } catch {
    return undefined;
  }
}
