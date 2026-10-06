import { FontScaleSync } from "@/app/shell/font-scale-sync";

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
 * **One thing of the shell's rides along: the font-scale sync** (BC.6,
 * [#395](https://github.com/NobuData/ouroboros/issues/395)). The onboarding roadmap's shell
 * addendum has the standalone screens honour the reader's font-size preference; the root layout's
 * bootstrap paints the browser's mirror of it before anything else, and `FontScaleSync` is what
 * reads the *person's* stored preference back and stamps it — the half a fresh browser cannot
 * get from a mirror it does not have. It renders nothing, so the frame stays the page's.
 *
 * @param children The route segment, supplied by Next.js.
 * @returns The segment, unwrapped, with the preference sync beside it.
 */
export default function WizardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {children}
      <FontScaleSync />
    </>
  );
}
