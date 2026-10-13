import type { SlackConnection } from "@/app/api/chatops";
import { Button, Card, CardHead } from "@/app/ui";

import {
  INSTALL_LABEL,
  INSTALL_NOTE,
  INSTALL_ROLE_NOTE,
  type Journey,
  NOT_CONFIGURED_MISSING,
  NOT_CONFIGURED_TITLE,
  NOT_CONFIGURED_WHO,
  NOT_CONNECTED_LEAD,
  NOT_CONNECTED_MISSING,
  NOT_CONNECTED_TITLE,
  REGISTRATION_NOTE,
  SETUP_GUIDE_HREF,
  SETUP_GUIDE_LABEL,
  SETUP_STEPS,
  SETUP_STEPS_LABEL,
  installHref,
} from "./view";

/** What the journey takes. */
export interface InstallJourneyProps {
  /** Which journey: no app on the deployment, or an app this workspace has not installed. */
  readonly journey: Journey;
  /** The connection — where its install starts. */
  readonly connection: SlackConnection;
  /** Whether this reader may install — an owner or an admin. */
  readonly mayAdminister: boolean;
  /** The id the card's title takes, so the card is named by it. */
  readonly titleId: string;
}

/**
 * The no-connection journey (CA.1, [#541](https://github.com/NobuData/ouroboros/issues/541)) —
 * what the page *is* on day one.
 *
 * **It is not a Connect button**, because the architecture is per-deployment registration: there
 * is no shared Slack app to connect to. So the page says that, and then says what to do.
 *
 * - **No app on the deployment** (`not_configured`): what registering one involves, in four
 *   steps, what is missing, who supplies it, and the setup guide. **No Install action** — there
 *   is nothing to install yet, and a button that could only fail would teach nothing.
 * - **An app nobody installed here** (`not_connected`): the same explanation and guide, and
 *   **Install** — a plain link to the install route, which sends the browser to Slack's consent
 *   screen — for an owner or an admin. Everyone else reads what is missing and who can fix it.
 *
 * @param props See {@link InstallJourneyProps}.
 * @returns The journey's card.
 */
export function InstallJourney({ journey, connection, mayAdminister, titleId }: InstallJourneyProps) {
  const install = installHref(connection, mayAdminister);
  const guide = (
    <a className="chatops__link" href={SETUP_GUIDE_HREF} rel="noreferrer" target="_blank">
      {SETUP_GUIDE_LABEL}
    </a>
  );

  if (journey === "not_configured") {
    return (
      <Card aria-labelledby={titleId} as="section" className="chatops__journey">
        <CardHead title={NOT_CONFIGURED_TITLE} titleId={titleId} />
        <p className="chatops__lead">{REGISTRATION_NOTE}</p>
        <ol aria-label={SETUP_STEPS_LABEL} className="chatops__steps">
          {SETUP_STEPS.map((step) => (
            <li className="chatops__step" key={step}>
              {step}
            </li>
          ))}
        </ol>
        <p className="chatops__missing">
          {NOT_CONFIGURED_MISSING} {NOT_CONFIGURED_WHO}
        </p>
        <div className="chatops__journey-actions">{guide}</div>
      </Card>
    );
  }

  return (
    <Card aria-labelledby={titleId} as="section" className="chatops__journey">
      <CardHead title={NOT_CONNECTED_TITLE} titleId={titleId} />
      <p className="chatops__lead">{REGISTRATION_NOTE}</p>
      <p className="chatops__lead">
        {NOT_CONNECTED_LEAD} {install !== null && INSTALL_NOTE}
      </p>
      {install === null && (
        <p className="chatops__missing">
          {NOT_CONNECTED_MISSING} {INSTALL_ROLE_NOTE}
        </p>
      )}
      <div className="chatops__journey-actions">
        {install !== null && (
          <Button href={install} tone="primary">
            {INSTALL_LABEL}
          </Button>
        )}
        {guide}
      </div>
    </Card>
  );
}
