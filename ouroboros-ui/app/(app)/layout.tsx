import { AppShell } from "@/app/shell/app-shell";

/**
 * Layout for the signed-in half of the product.
 *
 * A route group — the `(app)` in the directory name is organisational and contributes
 * nothing to the URL, so this layout wraps `/` and every screen added beside it without
 * pushing them under an `/app` prefix.
 *
 * Everything it renders is the app shell (#41), which is why this file is one line: the
 * shell is a component (`app/shell/app-shell.tsx`) rather than markup written here, so
 * it can be rendered and asserted on without Next.js's routing around it.
 *
 * @param children The route segment being rendered, supplied by Next.js.
 * @returns The segment, inside the shell's content pane.
 */
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}
