import type { Metadata } from "next";
import { Chakra_Petch, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

import { FONT_SCALE_BOOTSTRAP } from "./font-scale";
import { SIDEBAR_BOOTSTRAP } from "./shell/sidebar-state";
import { ThemeProvider } from "./theme-provider";
import { THEME_BOOTSTRAP } from "./theme";

import "./globals.css";

/**
 * The three faces the design system names, self-hosted by `next/font` so no request
 * ever leaves for fonts.google.com and no layout shift is possible.
 *
 * Each one publishes a CSS custom property rather than a class, and each is named for
 * the face rather than for the token it feeds: app/globals.css maps `--font-display`,
 * `--font-ui` and `--font-mono` onto the sheet's `--f-disp`, `--f-ui` and `--f-mono`.
 * Mapping there rather than writing the token names here is what makes the override
 * deterministic — both this class and the sheet's `:root` block target `<html>` with
 * equal specificity, so writing the same names in both places would leave which one
 * wins to stylesheet order.
 *
 * Weights are the ones the mockups actually use (docs/mockups/assets/ouroboros.css);
 * asking for more would ship files nothing renders.
 */
const display = Chakra_Petch({
  weight: ["500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const ui = IBM_Plex_Sans({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-ui",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ouroboros",
  description: "Autonomous development loops: issue in, verified pull request out.",
};

/**
 * The root layout — the one place `<html>` and `<body>` exist.
 *
 * `suppressHydrationWarning` is on `<html>` because the boot script below changes this
 * element before React hydrates. Without it React would treat the attribute it did not
 * render as a mismatch and re-render from the nearest boundary, which both flashes and
 * discards the correction. With it, the DOM wins — which is the point: the DOM is where
 * the user's stored choice was applied.
 *
 * @param children The route segment being rendered, supplied by Next.js.
 * @returns The document every screen in the product is rendered inside.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${ui.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/*
          The theme bootstrap (#17). A plain inline script, in <head>, executed
          synchronously while the browser parses the HTML — before the first paint and
          before any React module loads. That timing is the whole feature: on a slow
          connection the browser paints the server's HTML long before hydration, so
          anything that runs later is a visible flash of the wrong theme.

          Not next/script: `beforeInteractive` is preloaded rather than parser-blocking
          and its own documentation says it does not block hydration, which is a weaker
          guarantee than this needs. The bundled guide for this version of Next
          (02-guides/preventing-flash-before-hydration.md) uses exactly the form below.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />

        {/*
          The sidebar bootstrap (CP.2, #644), here for exactly the reason above it is: the
          collapse choice is a custom property the shell grid reads, so applying it from React
          would be the reader watching the sidebar collapse on every load. Kept as a second
          script rather than folded into the first because the two belong to different modules,
          and each is generated from its own constants so neither can drift from the code that
          reads it back.
        */}
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_BOOTSTRAP }} />

        {/*
          The font-scale bootstrap (CQ.2, #649), third of the family and here for the
          strongest version of the reason: a 150% reader whose scale arrived with React
          would watch small text jump on every single load. In the ROOT layout deliberately
          — /login has no session but has this script, which is § 4's "anonymous screens
          honor the local mirror" implemented by placement. The server truth reconciles
          later, from the shell (app/shell/font-scale-sync.tsx).
        */}
        <script dangerouslySetInnerHTML={{ __html: FONT_SCALE_BOOTSTRAP }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
