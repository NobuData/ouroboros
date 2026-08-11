/**
 * The scaffold's placeholder home page.
 *
 * Its only job is to be something `yarn dev` renders, in all three faces, so that
 * "the toolchain is up" is a thing you can see rather than infer. It now renders inside
 * the app shell (#41), which is the chrome around it. The dashboard (#45) replaces it
 * at this route.
 *
 * @returns The placeholder screen.
 */
export default function Page() {
  return (
    <main className="placeholder">
      <p className="placeholder__eyebrow">ouroboros-ui</p>
      <h1 className="placeholder__title">Infinity in autonomy</h1>
      <p className="placeholder__body">
        The application scaffold is up: App Router, TypeScript, and the lint, typecheck,
        test and build pipeline <code>ci/ui</code> runs. This page is a placeholder — it
        renders in Chakra Petch, IBM Plex Sans and IBM Plex Mono, which is how you can
        tell the three faces loaded, and in whichever palette your system asks for until
        you choose one. The chrome around it is the app shell.
      </p>
      <ul className="placeholder__next">
        <li>#42 — the visible light / dark / system switcher</li>
        <li>#45 — the dashboard, at this route</li>
      </ul>
    </main>
  );
}
