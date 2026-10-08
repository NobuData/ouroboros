// Values the site config reads and the tests assert. They live here rather than as named
// exports of docusaurus.config.ts because Docusaurus rejects any export of that file it
// does not recognise as a config field.

/**
 * The public address the site is built for. Docusaurus needs it at build time for canonical
 * links, the sitemap and (from CY.4) the search index. `DOCS_SITE_URL` exists only so a
 * local or preview build can point somewhere else (roadmap decision D10).
 */
export const DEFAULT_SITE_URL = "https://docs.ouroboros.build";

/** The footer copyright, exactly as roadmap decision D3 states it. */
export const COPYRIGHT = "Copyright © 2025-2026 NobuData LLC";
