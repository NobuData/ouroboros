import type { Metadata } from "next";
import { Chakra_Petch, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const chakra = Chakra_Petch({
  weight: ["500", "600", "700"],
  subsets: ["latin"],
  variable: "--f-disp",
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--f-ui",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--f-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://ouroboros.build"),
  title: "Ouroboros — Infinity in Autonomy",
  description:
    "Ouroboros points autonomous coding loops at your backlog: it sizes every issue, writes the fix, builds on your own hardware, proves the PR does what the ticket says — and merges it.",
  openGraph: {
    title: "Ouroboros — Infinity in Autonomy",
    description:
      "Autonomous development loops: issue in, verified pull request out. On your models, your build farm, your rules.",
    url: "https://ouroboros.build",
    siteName: "Ouroboros",
    images: [{ url: "/logo-lockup.png", width: 571, height: 443 }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${chakra.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
