import { requireWorkspace } from "@/app/api/access";

/**
 * The scaffold's placeholder home page — now behind the gate.
 *
 * Its original job was to be something `yarn dev` renders, in all three faces, so that "the
 * toolchain is up" is a thing you can see rather than infer. #44 adds the other half of that
 * sentence: this is a screen in `(app)`, so it is reachable only by somebody signed in who
 * has chosen a workspace, and `requireWorkspace()` is what makes "unauthenticated `(app)`
 * routes redirect to the login screen" true rather than intended. The call is here rather
 * than in the layout for the reason `app/(app)/layout.tsx` sets out.
 *
 * It also demonstrates the shape every screen in this group takes: the gate returns the
 * workspace, so naming it costs nothing and forgetting it costs the data. The dashboard
 * (#45) replaces this page at this route and reads the rest of what it needs the same way.
 *
 * @returns The placeholder screen, naming the workspace it is being rendered for.
 */
export default async function Page() {
  const { session, membership } = await requireWorkspace();

  return (
    <main className="placeholder">
      <p className="placeholder__eyebrow">ouroboros-ui · {membership.slug}</p>
      <h1 className="placeholder__title">Infinity in autonomy</h1>
      <p className="placeholder__body">
        Signed in as {session.user.displayName}, in {membership.displayName} as{" "}
        {membership.role}. The application scaffold is up: App Router, TypeScript, and the
        lint, typecheck, test and build pipeline <code>ci/ui</code> runs. This page is a
        placeholder — it renders in Chakra Petch, IBM Plex Sans and IBM Plex Mono, which is
        how you can tell the three faces loaded, and in whichever palette you ask for — the
        switcher is in the header. The chrome around it is the app shell.
      </p>
      <ul className="placeholder__next">
        <li>#45 — the dashboard, at this route</li>
      </ul>
    </main>
  );
}
