import type { Enablement } from "@/app/api/enablement";
import type { Membership } from "@/app/api/membership";
import type { SessionUser, TenantSuggestion } from "@/app/api/session";

import { BrandPanel } from "./brand-panel";
import { EnablementCard } from "./enablement-card";
import { SignInCard } from "./sign-in-card";
import { NoWorkspaceCard, WorkspacePicker, WorkspacePreview } from "./workspace-card";

import "./login.css";

/**
 * The sign-in & tenancy screen (#44) — `docs/mockups/01-login.html` as a working page.
 *
 * The mockup's split: 55% brand, 45% two stacked cards. It renders **outside the app
 * shell**, which the design system § 5 puts login and the onboarding wizard in — a visitor
 * who has not signed in has no workspace for the shell to describe — so this owns its own
 * scroll container, because the document is locked in `globals.css` and a screen outside the
 * shell inherits that lock.
 *
 * It is a component rather than markup written in the route, for the reason the app shell is:
 * everything it does can then be rendered and asserted on without Next.js's routing around
 * it. What the route does is decide *which* state this is in — `app/(auth)/login/page.tsx`
 * reads the request, `app/login/view.ts` decides, and this draws it.
 *
 * @param props.state Which step to draw, and the data that step needs.
 * @param props.user The signed-in person, or `null` while nobody is.
 * @returns The screen.
 */
export function LoginScreen({
  state,
  user,
}: Readonly<{ state: LoginScreenState; user: SessionUser | null }>) {
  return (
    <main className="login">
      <div className="login__split">
        <BrandPanel />
        <section className="login-auth" aria-label="Sign in to Ouroboros">
          <div className="login-auth__col">
            <SignInCard user={user} />
            <StepTwo state={state} />
          </div>
        </section>
      </div>
    </main>
  );
}

/**
 * What the screen draws, and everything each shape needs to draw it.
 *
 * `app/login/view.ts`'s `LoginView` minus its one non-visual outcome (`dashboard`, which is
 * an instruction to redirect) plus the data the enablement step fetches. Keeping it a
 * discriminated union rather than a bag of optional props is what makes the switch below
 * total: there is no state in which a card is rendered without the data it needs, and no
 * `null` for one to guard against.
 */
export type LoginScreenState =
  /** Nobody is signed in. */
  | { readonly step: "sign-in" }
  /** Signed in, with live workspaces to choose between. */
  | { readonly step: "choose"; readonly memberships: readonly Membership[] }
  /** Signed in, belonging to no live workspace. */
  | {
      readonly step: "no-workspace";
      readonly suggestion: TenantSuggestion | null;
      readonly memberships: readonly Membership[];
    }
  /** Signed in, a workspace chosen, its organisations read. */
  | {
      readonly step: "enable";
      readonly membership: Membership;
      readonly enablement: Enablement;
    };

/**
 * The second card, in whichever of its four shapes this request calls for.
 *
 * @param props.state The screen's state.
 * @returns One step-2 card.
 */
function StepTwo({ state }: Readonly<{ state: LoginScreenState }>) {
  switch (state.step) {
    case "sign-in":
      return <WorkspacePreview />;
    case "choose":
      return <WorkspacePicker memberships={state.memberships} />;
    case "no-workspace":
      return (
        <NoWorkspaceCard
          suggestion={state.suggestion}
          memberships={state.memberships}
        />
      );
    case "enable":
      return (
        <EnablementCard membership={state.membership} enablement={state.enablement} />
      );
  }
}
