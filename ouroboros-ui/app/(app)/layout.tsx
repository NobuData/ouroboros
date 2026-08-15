import { DashboardSummaryProvider } from "@/app/dashboard/summary-store";
import { AppShell } from "@/app/shell/app-shell";

/**
 * Layout for the signed-in half of the product.
 *
 * A route group — the `(app)` in the directory name is organisational and contributes
 * nothing to the URL, so this layout wraps `/` and every screen added beside it without
 * pushing them under an `/app` prefix.
 *
 * Everything it renders is the app shell (#41) and the store that keeps it fresh, which is
 * why this file is still short: the shell is a component (`app/shell/app-shell.tsx`) rather
 * than markup written here, so it can be rendered and asserted on without Next.js's routing
 * around it.
 *
 * **The summary store is provided here and nowhere lower**
 * ([#87](https://github.com/NobuData/ouroboros/issues/87)). This is the one node above both
 * of the things that read the dashboard aggregate — the topbar's live and needs-you pills,
 * which are chrome on *every* signed-in screen, and the dashboard's own cards. Provided
 * inside the dashboard route instead, the pills would need a poll of their own, and the
 * contract's *one request per interval* would become two loops that disagree on one screen
 * about how many loops are live (`docs/ARCHITECTURE.md` § 5.4).
 *
 * It wraps the shell rather than being wrapped by it because the header is part of what
 * reads it, and a provider inside the shell would have to be inside the header too.
 *
 * **There is no session check here, deliberately.** A layout does not re-render on a
 * client-side navigation between sibling routes and does not control whether the rest of the
 * route renders anyway, so a check in one is a check that can be true when the page beneath
 * it is reached and stale when it is reached again
 * (`node_modules/next/dist/docs/01-app/02-guides/authentication.md` § Layouts and auth
 * checks). The gate is `requireWorkspace()` in `app/api/access.ts`, called by each page in
 * this group — which is also how a page obtains the workspace it renders, so the page that
 * skipped the check is the page with nothing to draw.
 *
 * @param children The route segment being rendered, supplied by Next.js.
 * @returns The segment, inside the shell's content pane.
 */
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <DashboardSummaryProvider>
      <AppShell>{children}</AppShell>
    </DashboardSummaryProvider>
  );
}
