/**
 * The strings step 2 shares across its four shapes.
 *
 * The preview, the picker, the "nowhere yet" explanation and the enablement list are four
 * components and one card: they carry the same heading, the same lede and the same
 * least-privilege note, all three of them the mockup's own words. Written down once here,
 * because a promise about GitHub scopes that is typed out four times is a promise that will
 * eventually say four different things.
 *
 * Copy only — no markup, no logic — so a wording change is a one-line diff a reviewer can
 * read as a wording change.
 */

/** Step 2's heading, in every shape of the card. */
export const STEP_TWO_TITLE = "Choose where the loop runs";

/** Its subline, wherever organisations are the thing being enabled. */
export const STEP_TWO_LEDE = "Enable the GitHub orgs Ouroboros may work in.";

/** The least-privilege note at the foot of the card, as the mockup writes it. */
export const APP_NOTE =
  "Ouroboros installs as a GitHub App with least-privilege scopes — contents, issues, " +
  "and pull requests on the repos you enable. Nothing else.";

/** The id every shape of step 2 labels itself with, so the card's heading names it. */
export const STEP_TWO_ID = "login-step-2";
