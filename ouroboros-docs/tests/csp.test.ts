import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  contentSecurityPolicy,
  inlineScripts,
  nginxInclude,
  scriptHash,
  themeScriptHashes,
} from "../scripts/csp.ts";

/** The theme script, as a stand-in: the text varies by Docusaurus release. */
const THEME = "!function(){document.documentElement.setAttribute('data-theme','dark')}()";

/**
 * Builds a page with the given extra `<head>` content.
 *
 * @param head the markup to put in `<head>`.
 * @returns the page's HTML.
 */
function page(head: string): string {
  return `<!doctype html><html><head><script>${THEME}</script>${head}</head><body></body></html>`;
}

describe("inlineScripts", () => {
  it("returns the text of each executable inline script", () => {
    expect(inlineScripts(page(""))).toEqual([THEME]);
  });

  it("skips scripts loaded from a file, whatever their attributes", () => {
    expect(inlineScripts(page('<script src="/assets/js/main.js" defer></script>'))).toEqual([
      THEME,
    ]);
  });

  it("skips structured data, which is not executed", () => {
    expect(
      inlineScripts(page('<script type="application/ld+json">{"@type":"WebSite"}</script>')),
    ).toEqual([THEME]);
  });

  it("counts a module or an explicitly typed JavaScript block", () => {
    expect(inlineScripts(page('<script type="module">a()</script>'))).toEqual([THEME, "a()"]);
    expect(inlineScripts(page("<script type=text/javascript>b()</script>"))).toEqual([
      THEME,
      "b()",
    ]);
  });
});

describe("scriptHash", () => {
  it("is the quoted base64 SHA-256 of the exact text", () => {
    const digest = createHash("sha256").update(THEME).digest("base64");
    expect(scriptHash(THEME)).toBe(`'sha256-${digest}'`);
  });
});

describe("themeScriptHashes", () => {
  it("returns the theme script's hash once, however many pages carry it", () => {
    expect(themeScriptHashes([page(""), page(""), page("")])).toEqual([scriptHash(THEME)]);
  });

  it("refuses a build with a second inline script, as D8 allows only the theme script", () => {
    expect(() => themeScriptHashes([page(""), page("<script>insertBanner()</script>")])).toThrow(
      /2 distinct inline scripts[\s\S]*insertBanner/,
    );
  });

  it("refuses a build with no inline script at all", () => {
    expect(() => themeScriptHashes(["<html><head></head></html>"])).toThrow(
      /theme script is missing/,
    );
  });
});

describe("contentSecurityPolicy", () => {
  const policy = contentSecurityPolicy([scriptHash(THEME)]);

  it("admits scripts from the site and the theme script by hash, and nothing inline else", () => {
    expect(policy).toContain(`script-src 'self' ${scriptHash(THEME)}`);
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it("forbids framing, plugins and other origins", () => {
    for (const directive of [
      "default-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ]) {
      expect(policy).toContain(directive);
    }
  });
});

describe("nginxInclude", () => {
  it("sends the policy on every answer", () => {
    expect(nginxInclude("default-src 'self'")).toContain(
      `add_header Content-Security-Policy "default-src 'self'" always;`,
    );
  });

  it("refuses a policy that would end nginx's string early", () => {
    expect(() => nginxInclude('default-src "x"')).toThrow(/double quote/);
  });
});

describe("gen-csp", () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "gen-csp.ts");

  it("refuses a call without exactly one output file, with exit code 2", () => {
    for (const args of [[], ["a", "b"], ["--help"]]) {
      const result = spawnSync("node", [script, ...args], { encoding: "utf8" });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("usage: node scripts/gen-csp.ts OUT_FILE");
    }
  });
});
