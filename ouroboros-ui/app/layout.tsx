import type { Metadata } from "next";
import { Chakra_Petch, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

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
 * @param children The route segment being rendered, supplied by Next.js.
 * @returns The document every screen in the product is rendered inside.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${mono.variable}`}>
      {/*
        Theme bootstrap slot. The runtime theme engine (#17) adds a <head> script here
        that stamps `data-theme` on this element before first paint; until then nothing
        is stamped, which the token sheet reads as "system" and resolves with
        prefers-color-scheme.
      */}
      <body>{children}</body>
    </html>
  );
}
