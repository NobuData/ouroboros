import type { useMermaidConfig } from "@docusaurus/theme-mermaid/client";

/** Mermaid's config type, as the Docusaurus theme hands it over. */
export type MermaidConfig = ReturnType<typeof useMermaidConfig>;

/**
 * Mermaid's colours, taken from the brand tokens (CY.4, #1167).
 *
 * Mermaid draws SVG with literal colours and derives shades from them, so it cannot read a
 * `var(--token)` itself. Instead the renderer reads each token's current value off the page
 * (`getComputedStyle`) and hands the literals to Mermaid's recolourable `base` theme. The
 * tokens already hold the right palette for the active theme, so the same mapping serves
 * light and dark — and no colour is written down here.
 */

/** Which token feeds each Mermaid theme variable. */
export const MERMAID_TOKEN_MAP = {
  background: "--surface",
  mainBkg: "--raised",
  primaryColor: "--raised",
  primaryTextColor: "--ink",
  primaryBorderColor: "--accent",
  nodeBorder: "--accent",
  secondaryColor: "--inset",
  secondaryTextColor: "--ink",
  secondaryBorderColor: "--line-strong",
  tertiaryColor: "--surface",
  tertiaryTextColor: "--ink",
  tertiaryBorderColor: "--line-strong",
  lineColor: "--ink-mut",
  textColor: "--ink",
  titleColor: "--ink",
  clusterBkg: "--inset",
  clusterBorder: "--line-strong",
  edgeLabelBackground: "--surface",
  noteBkgColor: "--inset",
  noteTextColor: "--ink",
  noteBorderColor: "--line-strong",
  actorBkg: "--raised",
  actorBorder: "--accent",
  actorTextColor: "--ink",
  signalColor: "--ink-mut",
  signalTextColor: "--ink",
  fontFamily: "--f-ui",
} as const;

/** Every token the mapping reads. */
export const MERMAID_TOKENS: readonly string[] = [...new Set(Object.values(MERMAID_TOKEN_MAP))];

/**
 * Builds Mermaid's theme variables from token values.
 *
 * @param readToken returns a token's current value (e.g. `--accent` → `#07708e`), or an
 *   empty string when the token is not defined.
 * @param dark whether the dark palette is active; Mermaid derives its own shades
 *   differently on a dark ground.
 * @returns the `themeVariables` for Mermaid's `base` theme. A token that reads empty is
 *   left out, so Mermaid falls back to its own default rather than to an invalid colour.
 */
export function brandThemeVariables(
  readToken: (name: string) => string,
  dark: boolean,
): Record<string, string | boolean> {
  const variables: Record<string, string | boolean> = { darkMode: dark };
  for (const [variable, token] of Object.entries(MERMAID_TOKEN_MAP)) {
    const value = readToken(token).trim();
    if (value) variables[variable] = value;
  }
  return variables;
}

/**
 * Lays the brand variables over the config Docusaurus built from `themeConfig.mermaid`.
 *
 * @param base the config `useMermaidConfig()` returns (theme name, options).
 * @param readToken see {@link brandThemeVariables}.
 * @param dark whether the dark palette is active.
 * @returns a config for Mermaid's `base` theme carrying the brand variables, with any
 *   `themeVariables` the site config sets explicitly still winning.
 */
export function brandMermaidConfig(
  base: MermaidConfig,
  readToken: (name: string) => string,
  dark: boolean,
): MermaidConfig {
  return {
    ...base,
    theme: "base",
    themeVariables: { ...brandThemeVariables(readToken, dark), ...base.themeVariables },
  };
}
