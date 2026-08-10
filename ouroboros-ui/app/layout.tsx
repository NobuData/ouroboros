import type { Metadata } from "next";
import { Chakra_Petch, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

import "./globals.css";

/**
 * The three faces the design system names, self-hosted by `next/font` so no request
 * ever leaves for fonts.google.com and no layout shift is possible.
 *
 * Each one publishes a CSS custom property rather than a class, because the token sheet
 * (#16) already declares `--f-disp`, `--f-ui` and `--f-mono` with their fallback stacks
 * and every rule in the product reads those. Redefining the three variables here is the
 * only override the application makes to the sheet — see docs/DESIGN_TOKENS.md — and it
 * is why no component names a font.
 *
 * Weights are the ones the mockups actually use (docs/mockups/assets/ouroboros.css);
 * asking for more would ship files nothing renders.
 */
const display = Chakra_Petch({
  weight: ["500", "600", "700"],
  subsets: ["latin"],
  variable: "--f-disp",
  display: "swap",
});

const ui = IBM_Plex_Sans({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--f-ui",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--f-mono",
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
