/**
 * The px ban ([#648](https://github.com/NobuData/ouroboros/issues/648)).
 *
 * The font-size preference (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 4) works by moving the root
 * percentage, and anything typed in an absolute unit simply ignores it — one `px` heading is
 * the one thing still unreadable at 150%, and the reader concludes the setting is broken.
 * The token sheet is already rem throughout; this rule is what keeps the *next* component
 * that way, because the next mockup conversion will paste `font-size: 12px` unless the build
 * says no.
 *
 * ### The allowlist is the shape of the rule, not a list of exceptions
 *
 * Only the two type properties (and the `font` shorthand that can smuggle both) are banned.
 * Everything px is *correct* for — hairline borders, shadow offsets, the 1px boxes of
 * `.sr-only` (`app/globals.css`, deliberately unscalable) — is untouched because those
 * properties are not named here. That keeps the allowlist exactly as short as #648 asks:
 * empty, with the rationale carried by the rule's own scope.
 *
 * Every absolute unit CSS has, not just `px` — the same seven `ABSOLUTE_TYPE_SIZE` matches in
 * `__tests__/styles.test.ts`, which remains in force: that test proves the *shipped sheets*
 * are clean on every `yarn test`, while this rule is the answer at the moment the offending
 * line is written. `__tests__/stylelint.test.ts` holds the two to the same vocabulary.
 */

/** The units a type size must never be written in: everything the reader's preference cannot move. */
const ABSOLUTE_UNITS = ["px", "pt", "pc", "in", "cm", "mm", "Q"];

/** @type {import("stylelint").Config} */
const config = {
  rules: {
    "declaration-property-unit-disallowed-list": [
      {
        "font-size": ABSOLUTE_UNITS,
        "line-height": ABSOLUTE_UNITS,
        font: ABSOLUTE_UNITS,
      },
      {
        message: (property) =>
          `Unexpected absolute unit in "${property}" — type is rem-based so the font-size preference scales it (docs/CONVENTIONS.md § 6, #648)`,
      },
    ],
  },
};

export default config;
