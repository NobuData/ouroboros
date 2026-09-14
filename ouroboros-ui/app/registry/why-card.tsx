import { Card, CardHead } from "@/app/ui";

import { GOVERNANCE_ENFORCED, WHY_TITLE, whyRows } from "./chain";

import "./registry.css";

/**
 * Mockup 21's **WHY ALIASES — THE BYOK POINT** card
 * ([#595](https://github.com/NobuData/ouroboros/issues/595)): the three ✓ rows, verbatim.
 *
 * It is the page's argument, and it is copy rather than data, so everything it says lives in
 * `app/registry/chain.ts` beside the rule that decides whether the third row may say it: the
 * governance row claims publish-time rejection in the present tense, and is shown only while
 * {@link GOVERNANCE_ENFORCED} says that claim is true.
 *
 * No hooks and no state, so it renders wherever it is placed — inside the table's client
 * boundary beside the inspector, or in the page's own seat when there is no table.
 *
 * @param props.enforced Whether publish-time rejection is live. Defaults to the shipped fact;
 *   a test passes `false` to hold the gate.
 * @returns The card.
 */
export function WhyCard({ enforced = GOVERNANCE_ENFORCED }: Readonly<{ enforced?: boolean }>) {
  return (
    <Card aria-labelledby={WHY_TITLE_ID} as="section" fill>
      <CardHead title={WHY_TITLE} titleId={WHY_TITLE_ID} />
      <ul className="registry-why">
        {whyRows(enforced).map((row) => (
          <li className="registry-why__row" key={row.title}>
            {/* Decoration: the list already says these are claims, and a ✓ read aloud is noise. */}
            <span aria-hidden="true" className="registry-why__tick">
              ✓
            </span>
            <div>
              <strong className="registry-why__title">{row.title}</strong>
              <p className="registry-why__body">{row.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The id the card's `aria-labelledby` points at. */
const WHY_TITLE_ID = "registry-why-title";
