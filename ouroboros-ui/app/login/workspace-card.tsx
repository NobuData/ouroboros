import type { Membership } from "@/app/api/membership";
import type { TenantSuggestion } from "@/app/api/session";

import { chooseWorkspace } from "./actions";
import { APP_NOTE, STEP_TWO_ID, STEP_TWO_LEDE, STEP_TWO_TITLE } from "./copy";
import { Monogram } from "./monogram";

/**
 * Step 2 of the mockup, in the three shapes that come before an organisation can be
 * enabled: the preview a signed-out visitor sees, the workspace picker, and the explanation
 * for somebody who belongs nowhere.
 *
 * The fourth shape — the organisation and repository list itself — is
 * `app/login/enablement-card.tsx`, because it is the only one of the four that fetches
 * anything.
 *
 * All three share a head, and it is the mockup's: the eyebrow, "Choose where the loop
 * runs", and the least-privilege GitHub App note at the foot. The card that cannot act is
 * dimmed the way the mockup dims it, which is honest here in a way dimming usually is not —
 * it is a description of what happens after sign-in rather than a control that has been
 * switched off.
 */

/** What a workspace's lifecycle is called when it is not `active`. */
const STATUS_LABEL: Record<Membership["status"], string> = {
  active: "active",
  suspended: "suspended",
  deleted: "closed",
};

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
    <section className="login-card login-card--preview" aria-labelledby={STEP_TWO_ID}>
      <p className="login-card__eyebrow login-card__eyebrow--quiet">After sign-in · Step 2</p>
      <h2 className="login-card__title login-card__title--sub" id={STEP_TWO_ID}>
        {STEP_TWO_TITLE}
      </h2>
      <p className="login-card__lede">{STEP_TWO_LEDE}</p>
      <p className="login-note login-note--faint">
        Your workspaces and their organisations appear here once you have signed in.
      </p>
      <p className="login-note login-note--faint">{APP_NOTE}</p>
    </section>
  );
}

/**
 * The step-2 card as somebody who belongs to at least one live workspace sees it: pick one.
 *
 * Each row is itself the control — a submit button spanning the row, in a form of one hidden
 * field — so choosing is one press and needs no JavaScript. The action re-checks the slug
 * against this person's memberships before it writes anything, because the form is a POST
 * endpoint like any other (`app/login/actions.ts`).
 *
 * @param props.memberships The workspaces to offer. Only live ones belong here; the caller
 *   (`app/login/view.ts`) has already filtered them.
 * @returns The picker card.
 */
export function WorkspacePicker({
  memberships,
}: Readonly<{ memberships: readonly Membership[] }>) {
  return (
    <section className="login-card" aria-labelledby={STEP_TWO_ID}>
      <p className="login-card__eyebrow">Step 2 · Workspace</p>
      <h2 className="login-card__title login-card__title--sub" id={STEP_TWO_ID}>
        {STEP_TWO_TITLE}
      </h2>
      <p className="login-card__lede">
        {memberships.length === 1
          ? "Confirm the workspace this browser operates in."
          : "Pick the workspace this browser operates in. You can change it later."}
      </p>

      <ul className="login-rows">
        {memberships.map((membership) => (
          <li key={membership.tenantId}>
            <form action={chooseWorkspace}>
              <input type="hidden" name="workspace" value={membership.slug} />
              <button type="submit" className="login-row">
                <Monogram name={membership.displayName || membership.slug} />
                <span className="login-row__meta">
                  <span className="login-row__name">
                    {membership.displayName}
                    <span className="login-pill">{membership.role}</span>
                  </span>
                  <span className="login-row__detail">{membership.slug}</span>
                </span>
                <span className="login-row__go" aria-hidden>
                  →
                </span>
              </button>
            </form>
          </li>
        ))}
      </ul>

      <p className="login-note login-note--faint">{APP_NOTE}</p>
    </section>
  );
}

/**
 * The step-2 card for somebody signed in who belongs to no live workspace.
 *
 * Two situations, and they are told apart because the contract tells them apart. A
 * `tenantSuggestion` means the domain of this person's address is one some workspace has
 * registered — which grants nothing, and is named so this screen can say "your organisation
 * is already here, ask an owner to add you" instead of dropping a new signee into an empty
 * product. No suggestion means genuinely nowhere, and there is nothing this screen can do
 * about that except say so; creating a workspace is `POST /api/v1/tenants` and a screen for
 * it is not #44's.
 *
 * Memberships that exist but are not live are listed with their status, because "you belong
 * to nothing" and "the one thing you belong to is suspended" are different facts and only
 * one of them is a reason to talk to somebody.
 *
 * @param props.suggestion The workspace this person's email domain points at, or `null`.
 * @param props.memberships Every membership the session reported, live or not.
 * @returns The explanatory card.
 */
export function NoWorkspaceCard({
  suggestion,
  memberships,
}: Readonly<{
  suggestion: TenantSuggestion | null;
  memberships: readonly Membership[];
}>) {
  return (
    <section className="login-card" aria-labelledby={STEP_TWO_ID}>
      <p className="login-card__eyebrow">Step 2 · Workspace</p>
      <h2 className="login-card__title login-card__title--sub" id={STEP_TWO_ID}>
        No workspace yet
      </h2>

      {suggestion === null ? (
        <p className="login-empty">
          You are signed in, but you do not belong to a workspace yet. Ask whoever runs your
          organisation&apos;s Ouroboros to invite you — an invitation sent to your email
          address attaches to this account.
        </p>
      ) : (
        <p className="login-empty">
          <strong>{suggestion.displayName}</strong> is already here — your email domain
          matches it. Matching a domain is not membership, so ask one of its owners to add
          you, and this step will offer it.
        </p>
      )}

      {memberships.length > 0 && (
        <ul className="login-rows">
          {memberships.map((membership) => (
            <li key={membership.tenantId}>
              <span className="login-row">
                <Monogram name={membership.displayName || membership.slug} />
                <span className="login-row__meta">
                  <span className="login-row__name">
                    {membership.displayName}
                    <span className="login-pill login-pill--warn">
                      {STATUS_LABEL[membership.status]}
                    </span>
                  </span>
                  <span className="login-row__detail">{membership.slug}</span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="login-note login-note--faint">{APP_NOTE}</p>
    </section>
  );
}
