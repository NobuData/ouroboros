/**
 * Layout for the signed-in half of the product.
 *
 * A route group — the `(app)` in the directory name is organisational and contributes
 * nothing to the URL, so this layout wraps `/` and every screen added beside it without
 * pushing them under an `/app` prefix.
 *
 * It is a pass-through today. The app shell (#41) — top bar, navigation, footer — is
 * the chrome that belongs here, and this is the slot it fills.
 *
 * @param children The route segment being rendered, supplied by Next.js.
 * @returns The segment, unwrapped, until the shell lands.
 */
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
