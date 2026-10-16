import { useId } from "react";

import { signOutOfSession } from "@/app/shell/actions";
import { Button, Eyebrow } from "@/app/ui";

import { ACCOUNT_EYEBROW, type HeldStatus, SIGN_OUT_LABEL, heldCopy, signedInAs } from "./pending";

import "./accounts.css";

/** What {@link PendingScreen} takes. */
export interface PendingScreenProps {
  /** Whether the account is still waiting or was refused. */
  readonly status: HeldStatus;
  /** The account's email. */
  readonly email: string;
}

/**
 * The waiting page (account approval): one card saying the account is on hold, and why, with
 * **Sign out**.
 *
 * Outside the shell, like the recovery screen: a held account can read nothing the shell would
 * show. Nothing on it polls — approval stamps the person's sessions server-side, so a reload
 * after an administrator approves lands in the product.
 *
 * @param props See {@link PendingScreenProps}.
 * @returns The page.
 */
export function PendingScreen({ status, email }: PendingScreenProps) {
  const titleId = useId();
  const copy = heldCopy(status);

  return (
    <main aria-labelledby={titleId} className="accounts-pending">
      <div
        className={
          status === "denied"
            ? "accounts-pending__card accounts-pending__card--denied"
            : "accounts-pending__card"
        }
      >
        <Eyebrow>{ACCOUNT_EYEBROW}</Eyebrow>
        <h1 className="accounts-pending__title" id={titleId}>
          {copy.title}
        </h1>
        <p className="accounts-pending__lead">{copy.lead}</p>
        <p className="accounts-pending__who">{signedInAs(email)}</p>
        <form action={signOutOfSession} className="accounts-pending__actions">
          <Button type="submit">{SIGN_OUT_LABEL}</Button>
        </form>
      </div>
    </main>
  );
}
