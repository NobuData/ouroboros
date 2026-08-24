import { Button, Eyebrow } from "@/app/ui";

import { AuditTrail } from "@/app/providers/audit-trail";

import "./workshop.css";

/**
 * The credential trail's story ([#225](https://github.com/NobuData/ouroboros/issues/225)) —
 * the second page of the component workshop
 * ([#48](https://github.com/NobuData/ouroboros/issues/48)).
 *
 * AD.4 requires that the **Audit log** sheet renders seeded history in both themes, and the
 * page it belongs to does not exist yet: `/providers` is AE.1's
 * ([#227](https://github.com/NobuData/ouroboros/issues/227)). A criterion with nowhere to be
 * observed is a criterion nobody can check, so the trail ships as a mountable head action
 * (`app/providers/audit-trail.tsx`) and this is where it is mounted until that page arrives —
 * the same role `chrome-story.tsx` plays for contracts every subnav-owning roadmap builds
 * against.
 *
 * ### It draws mockup 07's page head, and only that
 *
 * The mockup puts **Audit log** in the head beside **+ Add provider**, and *that arrangement*
 * is the thing worth demonstrating: the ghost action must not compete with the primary one,
 * and the sheet must open over the pane rather than inside it. So the head below is the
 * mockup's, and everything under it is deliberately absent — the provider cards are AE.2's
 * (#228) and drawing invented ones here would be a mock-up of a page somebody else is
 * building.
 *
 * `+ Add provider` carries a `reason` rather than being omitted, per the design system's
 * honesty rule (§ 3.5): a control that cannot act explains itself, and a head with one button
 * would not show what the other one has to sit beside.
 *
 * ### The data is real
 *
 * The sheet reads `GET /api/v1/providers/audit` for the session's own workspace through its
 * Server Action, exactly as it will from AE.1's page. In a development stack that is
 * `R__dev_seed_audit.sql`'s fourteen events — every action in the vocabulary, a refused
 * rotation, and a lease grant with no actor — which is the fixture the sheet's own tests are
 * written against. Both themes and every font scale come free, the way they do for every
 * screen: the sheet is drawn from tokens, and the profile menu switches both live.
 */

/** Why the mockup's primary action is inert here. */
const ADD_PROVIDER_REASON =
  "Connecting a provider is AE.2 (#228). This story is the head's other action.";

/**
 * The story.
 *
 * @returns Mockup 07's page head, with the real trail behind its ghost action.
 */
export function AuditStory() {
  return (
    <div className="wk-page">
      <header className="wk-head">
        <Eyebrow>Workshop</Eyebrow>
        <h1 className="wk-title">Credential audit log</h1>
        <p className="wk-sub">
          Mockup 07&rsquo;s page head, and the sheet behind its <strong>Audit log</strong>{" "}
          action. The rows are this workspace&rsquo;s own credential trail — every operation,
          refusals included, and never a key.
        </p>
      </header>

      <section className="wk-section">
        <h2 className="wk-heading">The head</h2>
        <p className="wk-prose">
          The ghost action sits beside the primary one and opens the trail over the pane. Press
          Escape, or anywhere outside the sheet, to close it — focus returns to the button.
        </p>

        <div className="wk-bar-actions">
          <AuditTrail />
          <Button reason={ADD_PROVIDER_REASON} tone="primary">
            + Add provider
          </Button>
        </div>
      </section>
    </div>
  );
}
