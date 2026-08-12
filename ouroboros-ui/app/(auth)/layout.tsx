/**
 * Layout for the screens a signed-out visitor can reach.
 *
 * The counterpart to `(app)`: a route group holding the sign-in and tenancy-selection flow
 * (#44), which is deliberately outside the app shell because a visitor who has not signed in
 * has no workspace for the shell to describe (design system § 5).
 *
 * It is still a pass-through, and that is the decision rather than an omission. `/login` is
 * a full-bleed split — 55% brand, 45% cards — so any frame added here would be a frame that
 * screen has to undo. What the group shares is the *rule* below, not markup.
 *
 * One thing such a screen must decide for itself: **its scroll container**. The document is
 * locked in `app/globals.css` so that the shell's content pane is the only scrolling thing in
 * the product, and a screen rendered outside the shell inherits that lock. A tall sign-in
 * form therefore scrolls in a container of its own, the same way a page inside the shell
 * scrolls in the pane — `app/login/login.css`'s `.login` is where #44 does it.
 *
 * @param children The route segment being rendered, supplied by Next.js.
 * @returns The segment, unwrapped.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
