/**
 * The GitHub mark that sits inside "Continue with GitHub".
 *
 * The path is the mockup's own (`docs/mockups/01-login.html`), inline rather than a file in
 * `public/`, for two reasons: it is drawn in `currentColor` so it takes the button's ink in
 * both palettes without a second asset, and it is part of the button rather than content —
 * an `<img>` would be a second request for sixteen pixels that must not arrive late.
 *
 * `aria-hidden` because the button says "Continue with GitHub" in words. An accessible name
 * on the icon would have a screen reader announce the word twice.
 *
 * It carries no class: the button primitive styles the icons inside it by element
 * (`app/ui/ui.css`), so an icon does not have to know a button's internals to sit in one.
 *
 * @returns The 16px mark, taking its colour from the element around it.
 */
export function GithubMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path
        fill="currentColor"
        d="M8 2.6a5.4 5.4 0 0 0-5.4 5.5c0 2.6 1.7 4.6 3.9 5.3v-1.5c-.5-.5-.7-1.1-.6-1.8.1-.9.7-1.6 1.5-1.9-.4-.5-.5-1.2-.2-1.8l.6-1c.2-.4.7-.4 1 0l.3.5c.6-.2 1.2-.2 1.8 0l.3-.5c.3-.4.8-.4 1 0l.6 1c.3.6.2 1.3-.2 1.8.8.3 1.4 1 1.5 1.9.1.7-.1 1.3-.6 1.8v1.5c2.2-.7 3.9-2.7 3.9-5.3A5.4 5.4 0 0 0 8 2.6Z"
      />
    </svg>
  );
}
