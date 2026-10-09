import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The module directory (`ouroboros-docs/`). */
const MODULE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Reads a file of this module.
 *
 * @param name the file's path under `ouroboros-docs/`.
 * @returns its text.
 */
function file(name: string): string {
  return readFileSync(join(MODULE_DIR, name), "utf8");
}

/** The image's Dockerfile, without its comments. */
const DOCKERFILE = file("Dockerfile").replace(/^\s*#.*$/gm, "");

/** The nginx server configuration. */
const NGINX = file("nginx.conf");

/**
 * Returns the body of one nginx `location` block.
 *
 * @param opening the block's opening, e.g. `location /assets/`.
 * @returns the text between its braces.
 * @throws {Error} when the configuration has no such block.
 */
function location(opening: string): string {
  const start = NGINX.indexOf(`${opening} {`);
  if (start < 0) throw new Error(`nginx.conf has no "${opening}" block`);
  return NGINX.slice(start, NGINX.indexOf("\n    }", start));
}

describe("the Dockerfile (#1206)", () => {
  it("has the deps, build and runtime stages, in order", () => {
    const stages = [...DOCKERFILE.matchAll(/^FROM (\S+) AS (\w+)$/gm)].map(([, image, name]) => [
      name,
      image,
    ]);
    expect(stages).toEqual([
      ["deps", "node:24-alpine"],
      ["build", "node:24-alpine"],
      ["runtime", expect.stringMatching(/^nginxinc\/nginx-unprivileged:\d+\.\d+\.\d+-alpine$/)],
    ]);
  });

  it("installs immutably from the module's own lockfile", () => {
    expect(DOCKERFILE).toContain("RUN corepack enable");
    expect(DOCKERFILE).toContain("COPY package.json yarn.lock .yarnrc.yml ./");
    expect(DOCKERFILE).toContain("RUN yarn install --immutable");
  });

  it("builds with the site URL argument, then writes the CSP from the built pages", () => {
    expect(DOCKERFILE).toMatch(/^ARG DOCS_SITE_URL$/m);
    expect(DOCKERFILE).toContain("RUN yarn build && node scripts/gen-csp.ts /app/csp.conf");
  });

  it("reads nothing outside its own directory", () => {
    expect(DOCKERFILE).not.toContain("../");
  });

  it("serves the build with nginx, as a non-root user, on 8080, with a health check", () => {
    expect(DOCKERFILE).toContain("COPY --from=build /app/build /usr/share/nginx/html");
    expect(DOCKERFILE).toContain("COPY nginx.conf /etc/nginx/conf.d/default.conf");
    expect(DOCKERFILE).toContain("COPY nginx-headers.conf /etc/nginx/ouroboros/headers.conf");
    expect(DOCKERFILE).toContain("COPY --from=build /app/csp.conf /etc/nginx/ouroboros/csp.conf");
    expect(DOCKERFILE).toMatch(/^USER 101$/m);
    expect(DOCKERFILE).toMatch(/^EXPOSE 8080$/m);
    expect(DOCKERFILE).toMatch(/HEALTHCHECK[\s\S]*http:\/\/127\.0\.0\.1:8080\/healthz/);
  });

  it("labels the image with the OCI keys the issue names", () => {
    for (const [key, value] of [
      ["title", '"ouroboros-docs"'],
      ["vendor", '"NobuData LLC"'],
      ["licenses", '"Apache-2.0"'],
      ["source", '"${SOURCE}"'],
      ["version", '"${VERSION}"'],
      ["revision", '"${REVISION}"'],
    ]) {
      expect(DOCKERFILE).toContain(`org.opencontainers.image.${key}=${value}`);
    }
    for (const arg of ["VERSION", "REVISION", "SOURCE"]) {
      expect(DOCKERFILE).toMatch(new RegExp(`^ARG ${arg}=`, "m"));
    }
  });
});

describe("nginx.conf (#1206, roadmap decision D8)", () => {
  it("listens on 8080 and serves the build", () => {
    expect(NGINX).toContain("listen 8080;");
    expect(NGINX).toContain("root /usr/share/nginx/html;");
  });

  it("tries the page's .html before its directory, so /cli is cli.html and not a 403", () => {
    expect(location("location /")).toContain("try_files $uri $uri.html $uri/ =404;");
  });

  it("answers an unknown path with Docusaurus' 404 page and status 404", () => {
    expect(NGINX).toContain("error_page 404 /404.html;");
    expect(location("location = /404.html")).toContain("internal;");
  });

  it("caches hashed assets forever and revalidates HTML", () => {
    expect(location("location /assets/")).toContain(
      'add_header Cache-Control "public, max-age=31536000, immutable" always;',
    );
    expect(location("location /")).toContain('add_header Cache-Control "no-cache" always;');
  });

  it("answers /healthz with 200", () => {
    expect(location("location = /healthz")).toContain('return 200 "ok\\n";');
  });

  it("compresses text", () => {
    expect(NGINX).toContain("gzip on;");
    expect(NGINX).toMatch(/gzip_types[^;]*application\/javascript/);
  });

  it("sends the security headers from every location that sets a header of its own", () => {
    const blocks = NGINX.split(/\n {4}location /).slice(1);
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    for (const block of blocks) {
      if (!block.includes("add_header") && !block.includes("return 301")) continue;
      expect(block, block.split("\n")[0]).toContain("include /etc/nginx/ouroboros/headers.conf;");
    }
  });

  it("redirects a trailing slash to the slashless address", () => {
    expect(NGINX).toContain("return 301 $slashless$is_args$args;");
    expect(NGINX).toContain("absolute_redirect off;");
  });
});

describe("nginx-headers.conf", () => {
  const headers = file("nginx-headers.conf");

  it("sends the security headers on every answer and includes the generated CSP", () => {
    for (const header of [
      "X-Content-Type-Options",
      "Referrer-Policy",
      "X-Frame-Options",
      "Permissions-Policy",
    ]) {
      expect(headers).toMatch(new RegExp(`^add_header ${header} "[^"]+" always;$`, "m"));
    }
    expect(headers).toContain("include /etc/nginx/ouroboros/csp.conf;");
  });
});

describe(".dockerignore", () => {
  it("keeps dependencies, output, caches, the saved session and secrets out", () => {
    const ignored = file(".dockerignore").split("\n");
    for (const entry of [
      "node_modules",
      "build",
      ".docusaurus",
      "screenshots/test-results",
      "screenshots/.auth",
      ".env*",
    ]) {
      expect(ignored).toContain(entry);
    }
  });
});

describe("the site config", () => {
  it("leaves out the baseUrl banner, the one inline script besides the theme's", () => {
    expect(file("docusaurus.config.ts")).toContain("baseUrlIssueBanner: false,");
  });
});
