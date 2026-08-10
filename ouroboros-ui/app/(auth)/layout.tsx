/**
 * Layout for the screens a signed-out visitor can reach.
 *
 * The counterpart to `(app)`: a route group holding the sign-in and tenancy-selection
 * flow (#44), which is deliberately outside the app shell because a visitor who has not
 * signed in has no workspace for the shell to describe.
 *
 * The group has no pages yet, so nothing renders through this layout — it exists so the
 * structure the screens land into is already decided.
 *
 * @param children The route segment being rendered, supplied by Next.js.
 * @returns The segment, unwrapped, until the sign-in frame lands.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
