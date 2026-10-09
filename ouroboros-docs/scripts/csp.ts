/**
 * The documentation image's Content-Security-Policy (DD.1, roadmap decision D8).
 *
 * D8 allows **no inline script beyond Docusaurus' theme script** — the few lines in every page's
 * `<head>` that set the colour mode before the first paint, so a dark-mode reader never sees a
 * white flash. A CSP admits an inline script only by the SHA-256 of its exact text, and that
 * text is Docusaurus' to change between releases, so the hash is read from the built pages at
 * image-build time rather than written down here. `scripts/gen-csp.ts` is the command; this
 * file is the reading and the policy, as pure functions.
 */
import { createHash } from "node:crypto";

/**
 * Script types a browser executes. A `<script>` with any other `type` — the pages'
 * `application/ld+json` structured data — is data, which CSP does not govern.
 */
const EXECUTABLE_TYPES = new Set(["", "text/javascript", "application/javascript", "module"]);

/** An inline `<script>` element: everything between its tags, with its attributes. */
const INLINE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

/**
 * Lists the executable inline scripts in one page.
 *
 * @param html the page's HTML.
 * @returns the text of each `<script>` that has no `src` and an executable type, in page order.
 */
export function inlineScripts(html: string): string[] {
  const scripts: string[] = [];
  for (const [, attributes, body] of html.matchAll(INLINE_SCRIPT)) {
    if (/\bsrc\s*=/i.test(attributes)) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attributes)?.[1]?.toLowerCase() ?? "";
    if (!EXECUTABLE_TYPES.has(type)) continue;
    scripts.push(body);
  }
  return scripts;
}

/**
 * The CSP source expression for one inline script: `'sha256-<base64>'` over its exact text.
 *
 * @param script the script's text, exactly as it appears between its tags.
 * @returns the hash source, quotes included.
 */
export function scriptHash(script: string): string {
  return `'sha256-${createHash("sha256").update(script, "utf8").digest("base64")}'`;
}

/**
 * Collects the distinct inline scripts across every page, and holds them to D8.
 *
 * @param pages each page's HTML.
 * @returns the hash sources of the inline scripts, sorted; one for a site that keeps to D8.
 * @throws {Error} when no page has an inline script (the theme script is missing, so this is not
 *   a Docusaurus build), or when there is more than one distinct inline script — a second one
 *   would need its own exception, which D8 does not allow. The message shows how each begins.
 */
export function themeScriptHashes(pages: readonly string[]): string[] {
  const distinct = new Map<string, string>();
  for (const page of pages) {
    for (const script of inlineScripts(page)) distinct.set(scriptHash(script), script);
  }
  if (distinct.size === 0) {
    throw new Error("no page has an inline script: the theme script is missing from the build");
  }
  if (distinct.size > 1) {
    const starts = [...distinct.values()].map((script) => `  ${script.slice(0, 80)}…`);
    throw new Error(
      `the build has ${distinct.size} distinct inline scripts, and D8 allows only the theme ` +
        `script:\n${starts.join("\n")}`,
    );
  }
  return [...distinct.keys()].sort();
}

/**
 * The policy the image sends with every answer.
 *
 * Scripts come from the site's own origin, plus the theme script by hash. Styles allow inline
 * `style` attributes and `<style>` elements, which React components and rendered Mermaid
 * diagrams both write — D8 constrains scripts, not styles. Images and fonts may be `data:`
 * URIs, which the theme's icons use. Nothing may frame the site, and nothing is fetched from
 * another origin: search reads its index from this one.
 *
 * @param hashes the inline scripts' hash sources, from {@link themeScriptHashes}.
 * @returns the `Content-Security-Policy` header value.
 */
export function contentSecurityPolicy(hashes: readonly string[]): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * The nginx include that sends the policy: one `add_header` line, sent on every answer
 * (`always`), errors included.
 *
 * @param policy the header value, from {@link contentSecurityPolicy}.
 * @returns the include file's text.
 * @throws {Error} when the policy holds a double quote, which would end nginx's string early.
 */
export function nginxInclude(policy: string): string {
  if (policy.includes('"')) throw new Error("the policy cannot contain a double quote");
  return (
    "# Generated at image build by scripts/gen-csp.ts from the built pages. Do not edit.\n" +
    `add_header Content-Security-Policy "${policy}" always;\n`
  );
}
