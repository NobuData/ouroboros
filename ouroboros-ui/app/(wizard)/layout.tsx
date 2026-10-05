/**
 * Layout for the standalone wizard (BC.1, [#390](https://github.com/NobuData/ouroboros/issues/390)).
 *
 * `/get-started` renders **outside the app shell** — design system § 5 puts it beside login: no
 * shell header and no sidebar, because the shell describes a workspace that is not set up yet.
 * A route group of its own rather than `(auth)`, because unlike sign-in it needs a signed-in
 * person with a chosen workspace (the page's `requireWorkspace()` holds it to that).
 *
 * A pass-through, for `(auth)`'s reason: the frame is the page's, and the one rule the group
 * shares is that **the page owns its scroll container** — the document is locked in
 * `app/globals.css`, so the wizard scrolls its step content in a container of its own.
 *
 * @param children The route segment, supplied by Next.js.
 * @returns The segment, unwrapped.
 */
export default function WizardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
