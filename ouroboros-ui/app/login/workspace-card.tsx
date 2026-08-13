import type { TenantSuggestion } from "@/app/api/identity";
import { Card, EmptyState, Eyebrow } from "@/app/ui";

import { APP_NOTE, STEP_TWO_ID, STEP_TWO_LEDE, STEP_TWO_TITLE } from "./copy";

/**
 * Step 2 in the two shapes that have no workspaces to draw: the preview a signed-out
 * visitor sees, and the explanation for somebody who belongs nowhere.
 *
 * The third shape — the workspace rows themselves — is `app/login/enablement-card.tsx`,
 * because it is the only one of the three with anything to list, anything to press, or
 * anywhere to go.
 *
 * **The workspace *picker* used to be here too, and it is gone**
 * ([#719](https://github.com/NobuData/ouroboros/issues/719)). It existed because choosing a
 * workspace and enabling organisations inside it were two steps: the picker wrote the
 * `ouro_tenant` cookie and sent the browser on to a second card. `GET /api/v1/orgs` answers
 * both questions in one row model — every workspace, with the counts and the switch state
 * beside it — which is the mockup's own card, three rows and one button under them. Choosing
 * is now the radio on a row rather than a screen of its own, so there is no second step to
 * pick your way to.
 *
 * Both shapes here share a head, and it is the mockup's: the eyebrow, "Choose where the loop
 * runs", and the least-privilege GitHub App note at the foot. The card that cannot act yet
 * recedes where the mockup dims it — onto the well surface, with the quiet eyebrow, holding
 * no control — which says the same thing without taking its prose below AA (`login.css`).
 *
 * Both are drawn with the #46 primitives: the card, the eyebrow, and the empty state that
 * explains a workspace nobody has.
 */

/**
 * The step-2 card as a signed-out visitor sees it: what will be asked, not a list of
 * anything.
 *
 * The mockup fills it with three example organisations. Real ones cannot be known before
 * sign-in and invented ones would be a screen telling somebody they have workspaces they do
 * not, so this says what the step is and leaves the list to the step
 * (design system § 3.5).
 *
 * @returns The dimmed preview card.
 */
export function WorkspacePreview() {
  return (
    <Card as="section" tone="inset" size="lg" aria-labelledby={STEP_TWO_ID}>
      <Eyebrow tone="quiet">After sign-in · Step 2</Eyebrow>
      <h2 className="login-step__title login-step__title--sub" id={STEP_TWO_ID}>
        {STEP_TWO_TITLE}
      </h2>
      <p className="login-step__lede">{STEP_TWO_LEDE}</p>
      <p className="login-note login-note--faint">
        Your workspaces and their organisations appear here once you have signed in.
      </p>
      <p className="login-note login-note--faint">{APP_NOTE}</p>
    </Card>
  );
}

/**
 * The step-2 card for somebody signed in who belongs to no workspace.
 *
 * Two situations, and they are told apart because the contract tells them apart. A
 * `tenantSuggestion` means the domain of this person's address is one some workspace has
 * registered — which grants nothing, and is named so this screen can say "your organisation
 * is already here, ask an owner to add you" instead of dropping a new signee into an empty
 * product. No suggestion means genuinely nowhere, and there is nothing this screen can do
 * about that except say so.
 *
 * **It is a state the service goes out of its way to prevent**, which is why this card lists
 * nothing rather than listing what did not qualify. A first sign-in creates a personal
 * workspace ([#704](https://github.com/NobuData/ouroboros/issues/704)), so reaching this card
 * means either that creation failed or that somebody has since been removed from everything
 * they belonged to — and neither is a list to render. The membership rows this used to draw
 * beside the explanation were workspaces held in a lifecycle the switcher would not offer,
 * and the organization plugin has no lifecycle: `OrgRow` carries no `status`, so a workspace
 * the listing returns is one you can work in, and a workspace it does not return is not this
 * screen's to describe.
 *
 * @param props.suggestion The workspace this person's email domain points at, or `null`.
 * @returns The explanatory card.
 */
export function NoWorkspaceCard({
  suggestion,
}: Readonly<{ suggestion: TenantSuggestion | null }>) {
  return (
    <Card as="section" tone="ground" size="lg" aria-labelledby={STEP_TWO_ID}>
      <Eyebrow>Step 2 · Workspace</Eyebrow>
      <h2 className="login-step__title login-step__title--sub" id={STEP_TWO_ID}>
        No workspace yet
      </h2>

      {suggestion === null ? (
        <EmptyState
          variant="flush"
          className="login-step__empty"
          note="You are signed in, but you do not belong to a workspace yet. Ask whoever runs your organisation's Ouroboros to invite you — an invitation sent to your email address attaches to this account."
        />
      ) : (
        <EmptyState
          variant="flush"
          className="login-step__empty"
          note={
            <>
              <strong>{suggestion.displayName}</strong> is already here — your email domain
              matches it. Matching a domain is not membership, so ask one of its owners to
              add you, and this step will offer it.
            </>
          }
        />
      )}

      <p className="login-note login-note--faint">{APP_NOTE}</p>
    </Card>
  );
}
