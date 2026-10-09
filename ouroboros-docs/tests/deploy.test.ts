import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The repository root, two levels above this file (`ouroboros-docs/tests/`). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Reads a file relative to the repository root.
 *
 * @param path the file's path under the repository root.
 * @returns its text.
 */
function source(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

/**
 * Reads one of the deploy pages.
 *
 * @param name the page's file name under `docs/administration/deploy/`, without `.mdx`.
 * @returns its text.
 */
function page(name: string): string {
  return source(`ouroboros-docs/docs/administration/deploy/${name}.mdx`);
}

/**
 * Returns the n-th fenced code block of a language on a page.
 *
 * @param text the page.
 * @param lang the fence's language, e.g. `yaml`.
 * @param index which block, from 0.
 * @returns the block's text.
 * @throws {Error} when the page has no such block.
 */
function fence(text: string, lang: string, index = 0): string {
  const blocks = [...text.matchAll(new RegExp("```" + lang + "\\n([\\s\\S]*?)```", "g"))];
  if (!blocks[index]) throw new Error(`no ${lang} block #${index}`);
  return blocks[index][1];
}

/** The compose file the compose page gives. */
const COMPOSE = fence(page("compose"), "yaml");

/** The variables the compose file's `rest` service sets. */
const REST_ENV = (() => {
  const start = COMPOSE.indexOf("\n  rest:\n");
  const end = COMPOSE.indexOf("\n  ui:\n", start);
  return [...COMPOSE.slice(start, end).matchAll(/^ {6}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]);
})();

describe("the deploy pages (#1190)", () => {
  it("name every image the publish workflows push, from the one registry", () => {
    const images = [...COMPOSE.matchAll(/image: (\S+)/g)].map((m) => m[1]);
    for (const module of ["db", "engine", "rest", "ui"]) {
      expect(images).toContain(`registry.apiome.dev/ouroboros-${module}:latest`);
      expect(source(`.github/workflows/${module}.yml`)).toContain(`/ouroboros-${module}:latest`);
    }
    expect(images).toContain(source("docker-compose.yml").match(/image: (postgres:\S+)/)?.[1]);
  });

  it("set every variable the REST service refuses to start without", () => {
    const schema = source("ouroboros-rest/src/modules/config/configuration.ts");
    const required = [
      ...schema.matchAll(
        /^ {2}([A-Z][A-Z0-9_]+): (?:secret,|z\n? *\.string\(\{ error: "is required" \})/gm,
      ),
    ].map((m) => m[1]);
    expect(required).toContain("OURO_DATABASE_URL");
    expect(required).toContain("OURO_VAULT_MASTER_KEY");
    for (const variable of required) {
      if (variable === "OURO_RUN_SIMULATOR_SECRET") continue; // `secret.optional()`
      expect(REST_ENV, variable).toContain(variable);
      expect(page("containers")).toContain(`<EnvVar name="${variable}" />`);
    }
  });

  it("gives the migrations the variables the image's entrypoint reads", () => {
    const entrypoint = source("ouroboros-db/docker-entrypoint.sh");
    const start = COMPOSE.indexOf("\n  migrate:\n");
    const migrate = COMPOSE.slice(start, COMPOSE.indexOf("\n  engine:\n", start));
    for (const variable of ["OURO_DB_HOST", "OURO_DB_USER", "OURO_DB_PASSWORD"]) {
      expect(entrypoint).toContain(variable);
      expect(migrate).toContain(`${variable}:`);
    }
    expect(migrate).not.toContain("flyway.seed.toml");
  });

  it("publish a port on the proxy and on no other service", () => {
    const services = COMPOSE.split(/\n {2}(?=[a-z]+:\n)/).slice(1);
    const withPorts = services.filter((s) => /^ {4}ports:/m.test(s)).map((s) => s.split(":")[0]);
    expect(withPorts).toEqual(["proxy"]);
  });

  it("state the ports and health paths each image really uses", () => {
    const containers = page("containers");
    for (const [module, port, probe] of [
      ["engine", "8000", "/healthz"],
      ["rest", "4000", "/health/live"],
      ["ui", "3000", "/"],
    ]) {
      const dockerfile = source(`ouroboros-${module}/Dockerfile`);
      expect(dockerfile).toContain(`EXPOSE ${port}`);
      // The instruction, not a comment that mentions it: comments are stripped first.
      const code = dockerfile.replace(/^\s*#.*$/gm, "");
      const healthcheck = code.slice(code.indexOf("HEALTHCHECK "));
      expect(healthcheck).toContain(probe === "/" ? '${PORT}/"' : probe);
      expect(containers).toContain(`Listens on \`${port}\``);
      expect(containers).toContain(`\`GET ${probe}\``);
    }
  });

  it("forward exactly the farm paths the end-to-end gateway forwards", () => {
    const locations = (conf: string) =>
      [...conf.matchAll(/^\s*location\s+(.*?)\s*\{/gm)].map((m) => m[1]).sort();
    const reference = locations(source("tests/e2e/fixtures/farm-gateway/nginx.conf")).filter(
      (l) => l !== "= /healthz", // the fixture's own container probe
    );
    expect(locations(fence(page("farm-gateway"), "nginx"))).toEqual(reference);
  });

  it("name the client-certificate header the compose file sets", () => {
    expect(REST_ENV).toContain("OURO_FARM_CLIENT_CERT_HEADER");
    expect(COMPOSE).toContain("OURO_FARM_CLIENT_CERT_HEADER: x-ouro-client-cert");
    expect(fence(page("farm-gateway"), "nginx")).toContain(
      "proxy_set_header X-Ouro-Client-Cert $ssl_client_escaped_cert;",
    );
  });

  it("give the OAuth callback the UI's auth proxy answers", () => {
    expect(source("ouroboros-ui/proxy.ts")).toContain('const AUTH_PREFIX = "/api/auth";');
    for (const name of ["app-host", "containers"]) {
      expect(page(name)).toContain("https://app.example.com/api/auth/callback/github");
    }
    expect(fence(page("app-host"), "nginx")).toContain("proxy_pass http://ui:3000;");
    expect(fence(page("app-host"), "nginx")).not.toContain("rest:4000");
  });

  it("agree with the overview on which services are public", () => {
    const overview = page("overview");
    expect(overview).toMatch(/`ouroboros-ui` \| `3000` \| \*\*Public\*\*/);
    for (const module of ["rest", "engine"]) {
      expect(overview).toMatch(
        new RegExp(`\`ouroboros-${module}\` \\| \`\\d+\` \\| \\*\\*Internal\\*\\*`),
      );
    }
  });

  it("link every checklist item to a page that exists", () => {
    const links = [...page("checklist").matchAll(/\]\((\.\.?\/[^)#]+\.mdx)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(5);
    for (const link of links) {
      expect(() =>
        readFileSync(join(REPO_ROOT, "ouroboros-docs", "docs", "administration", "deploy", link)),
      ).not.toThrow();
    }
  });

  it("are pointed to from HOSTING.md, which stays the engineering source", () => {
    expect(source("HOSTING.md")).toContain(
      "ouroboros-docs/docs/administration/deploy/overview.mdx",
    );
  });
});
