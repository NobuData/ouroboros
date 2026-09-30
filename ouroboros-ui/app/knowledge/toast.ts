/**
 * The toast the knowledge head's two actions leave under it
 * (BG.1, [#417](https://github.com/NobuData/ouroboros/issues/417)).
 *
 * **Framework-free and pure.** The component is `knowledge-toast.tsx`; `create.ts` and `import.ts`
 * compose one each. It is a value rather than a call because both actions run in dialogs the screen
 * owns, and the screen is what holds the one toast the page shows at a time.
 */

/** Where a toast's link leads — an anchor on this page, or a route. */
export interface ToastLink {
  /** The link's text. */
  readonly label: string;
  /** Its destination. */
  readonly href: string;
}

/** One toast: what happened, and where to look. */
export interface KnowledgeToast {
  /** The sentence. */
  readonly text: string;
  /** The places it points at — the review states an import fills, or none. */
  readonly links: readonly ToastLink[];
}

/** The dismissal's accessible name. */
export const DISMISS_TOAST = "Dismiss";
