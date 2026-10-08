import React, { type ReactNode } from "react";
import Layout from "@theme/Layout";
import Link from "@docusaurus/Link";
import ThemedImage from "@theme/ThemedImage";
import useBaseUrl from "@docusaurus/useBaseUrl";

import SectionCards from "../components/SectionCards";
import { BRAND_ASSETS } from "../../site.constants";
import styles from "./index.module.css";

/**
 * The site's home page at `/` (CY.6, #1169): what Ouroboros is, which section to open, and
 * the three things most visitors come to do.
 *
 * A dashboard screenshot (`home.dashboard`) belongs below the quick links. It arrives once
 * the capture harness (CZ.1, #1170) and the `<Screenshot>` component (CZ.2, #1171) exist,
 * as `<Screenshot id="home.dashboard" />` in the slot marked below.
 */

/** The page's `<title>` suffix and meta description. */
export const HOME_TITLE = "Ouroboros documentation";
export const HOME_DESCRIPTION =
  "Guides for using, administering and scripting Ouroboros — issues in, verified pull requests out.";

/** A quick link: a task most visitors arrive to do, and the page that starts it. */
export interface QuickLink {
  /** The task, as a verb phrase. */
  label: string;
  /** One line on what the page covers. */
  description: string;
  /** The site route that starts it. */
  to: string;
}

/** The three quick links, in the order a new deployment needs them. */
export const QUICK_LINKS: readonly QuickLink[] = [
  {
    label: "Get started",
    description: "Sign in, set up a workspace and run your first loop.",
    to: "/user-guide/getting-started",
  },
  {
    label: "Deploy",
    description: "Bring up Ouroboros on your own infrastructure.",
    to: "/administration/deploy/overview",
  },
  {
    label: "Enrol a runner",
    description: "Connect a build machine to your build farm.",
    to: "/cli/runner/enroll",
  },
];

/**
 * The hero: the lockup in the treatment for the current theme, the tagline, and one
 * paragraph on the loop.
 *
 * @returns the page's header.
 */
function Hero(): ReactNode {
  return (
    <header className={styles.hero}>
      <ThemedImage
        className={styles.lockup}
        alt="Ouroboros"
        width={320}
        height={236}
        sources={{
          light: useBaseUrl(BRAND_ASSETS.lockupLight),
          dark: useBaseUrl(BRAND_ASSETS.lockupDark),
        }}
      />
      <h1 className={styles.title}>Ouroboros documentation</h1>
      <p className={styles.tagline}>Infinity in Autonomy</p>
      <p className={styles.lead}>
        Ouroboros is an autonomous software delivery loop: issues in, verified pull requests out,
        continuously. It picks up an issue from your tracker, sizes it, and runs a workflow that
        writes the change. Your own build farm builds and tests it, and Ouroboros verifies the pull
        request against the issue&apos;s acceptance criteria before anything merges. When the loop
        needs a decision, it asks you in the needs-you inbox and waits.
      </p>
    </header>
  );
}

/**
 * The quick links, as a list of linked tasks.
 *
 * @returns the quick-links section.
 */
function QuickLinks(): ReactNode {
  return (
    <section className={styles.section} aria-labelledby="quick-links">
      <h2 id="quick-links" className={styles.sectionTitle}>
        Quick links
      </h2>
      <ul className={styles.quickLinks}>
        {QUICK_LINKS.map((link) => (
          <li key={link.to}>
            <Link to={link.to} className={styles.quickLink}>
              <span className={styles.quickLinkLabel}>{link.label} →</span>
              <span className={styles.quickLinkDescription}>{link.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The home page.
 *
 * @returns the page, inside the site's layout (navbar, footer).
 */
export default function Home(): ReactNode {
  return (
    <Layout title={HOME_TITLE} description={HOME_DESCRIPTION}>
      <main className={styles.page}>
        <Hero />
        <section className={styles.section} aria-labelledby="sections">
          <h2 id="sections" className={styles.sectionTitle}>
            Find your way
          </h2>
          <SectionCards />
        </section>
        <QuickLinks />
        {/* home.dashboard — <Screenshot id="home.dashboard" /> once CZ.1/CZ.2 land. */}
      </main>
    </Layout>
  );
}
