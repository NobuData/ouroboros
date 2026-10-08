// @ts-check

/**
 * Stylelint config for ouroboros-docs (CY.3, #1166).
 *
 * One job: keep colour literals out of the site's own CSS (roadmap decision D7). Every
 * colour is a token from `src/css/tokens.css` — the synced copy of
 * `docs/design/tokens.css`, the one sheet allowed to hold literals, and so the one sheet
 * ignored here. Hex, named colours and the colour functions are all refused, so a literal
 * cannot slip back in under another spelling. Layout and formatting are left to review and
 * Prettier.
 *
 * @type {import("stylelint").Config}
 */
export default {
  ignoreFiles: ["src/css/tokens.css", "build/**", ".docusaurus/**", "node_modules/**"],
  rules: {
    "color-no-hex": true,
    "color-named": "never",
    "function-disallowed-list": [
      "rgb",
      "rgba",
      "hsl",
      "hsla",
      "hwb",
      "lab",
      "lch",
      "oklab",
      "oklch",
      "color",
    ],
  },
};
