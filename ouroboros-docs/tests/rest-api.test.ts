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

/** The page under test. */
const PAGE = source("ouroboros-docs/docs/cli/rest-api.mdx");

/** An OpenAPI parameter, as far as these tests read one. */
interface Parameter {
  $ref?: string;
  name?: string;
  schema?: { enum?: string[]; minimum?: number; maximum?: number; default?: unknown };
}

/** The REST service's committed specification, as far as these tests read it. */
interface Specification {
  info: { version: string };
  paths: Record<string, Record<string, { parameters?: Parameter[] }>>;
  components: { parameters: Record<string, Parameter> };
}

/** The committed specification the service serves at `/api/openapi.json`. */
const SPEC = JSON.parse(source("ouroboros-rest/openapi.json")) as Specification;

/**
 * Finds one parameter of an operation, following a `$ref` into the shared components.
 *
 * @param path the operation's path, e.g. `/api/v1/runs`.
 * @param name the parameter's name.
 * @returns the parameter.
 * @throws {Error} when the operation has no such parameter.
 */
function parameter(path: string, name: string): Parameter {
  for (const entry of SPEC.paths[path].get.parameters ?? []) {
    const resolved = entry.$ref
      ? SPEC.components.parameters[entry.$ref.split("/").at(-1) ?? ""]
      : entry;
    if (resolved.name === name) return resolved;
  }
  throw new Error(`GET ${path} has no ${name} parameter`);
}

/** The service's source files that hold the errors the page quotes. */
const ERRORS = [
  "ouroboros-rest/src/modules/auth/service.scopes.ts",
  "ouroboros-rest/src/modules/auth/auth.errors.ts",
  "ouroboros-rest/src/modules/tenancy/tenancy.errors.ts",
  "ouroboros-rest/src/modules/errors/validation.ts",
]
  .map(source)
  .join("\n");

describe("the REST API from the shell page (#1205)", () => {
  it("calls only operations the specification describes, with the right method", () => {
    const calls = [...PAGE.matchAll(/"\$API(\/[a-z/0-9-]+)[?"]/g)].map((match) => match[1]);
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const call of calls) {
      const path = `/api/v1${call.replace(/\/5eed[0-9a-f-]+$/, "/{id}")}`;
      expect(SPEC.paths, path).toHaveProperty([path, "get"]);
    }
    expect(SPEC.paths).toHaveProperty(["/api/v1/backlog/queue", "post"]);
  });

  it("states the runs list's required family and its paging bounds", () => {
    expect(parameter("/api/v1/runs", "status").schema?.enum).toEqual(["active", "terminal"]);
    const limit = parameter("/api/v1/runs", "limit").schema;
    expect([limit?.minimum, limit?.maximum, limit?.default]).toEqual([1, 100, 25]);
    expect(PAGE).toContain("`limit` sets the page size, from 1 to 100 (default 25)");
  });

  it("states the insights ranges and their default", () => {
    const range = parameter("/api/v1/insights", "range").schema;
    expect(range?.enum).toEqual(["7d", "30d", "90d"]);
    expect(range?.default).toBe("30d");
    expect(PAGE).toContain("`range` is `7d`, `30d` (the default) or\n`90d`");
  });

  it("names the token scopes the service registers", () => {
    expect(ERRORS).toContain('export const SERVICE_SCOPES = ["api.read", "farm.submit"] as const;');
    expect(PAGE).toContain("`api.read`");
    expect(PAGE).toContain("`farm.submit`");
  });

  it("lists only error codes the service raises", () => {
    const table = PAGE.slice(PAGE.indexOf("| Status | `code` |"));
    const codes = [...table.matchAll(/^\| `\d{3}` \| `([a-z_]+)` \|/gm)].map((match) => match[1]);
    expect(codes.length).toBe(6);
    for (const code of codes) expect(ERRORS, code).toContain(`"${code}"`);
  });

  it("quotes the service's refusal messages word for word", () => {
    for (const message of [
      "Service accounts cannot call this route; it needs a person's session.",
      "This service token is not valid. It may have been rotated or revoked.",
    ]) {
      expect(ERRORS).toContain(message);
      expect(PAGE).toContain(message);
    }
  });

  it("names the polling header the dashboard sends", () => {
    expect(source("ouroboros-rest/src/modules/dashboard/dashboard.controller.ts")).toContain(
      "X-Ouro-Poll-After",
    );
    expect(PAGE).toContain("`X-Ouro-Poll-After`");
  });

  it("gives the addresses the specification is published at", () => {
    const application = source("ouroboros-rest/src/application.ts");
    expect(application).toContain('export const API_PREFIX = "api";');
    for (const [constant, path] of [
      ["OPENAPI_JSON_PATH", "openapi.json"],
      ["OPENAPI_YAML_PATH", "openapi.yaml"],
      ["DOCS_PATH", "docs"],
    ]) {
      expect(application).toContain(`export const ${constant} = \`/\${API_PREFIX}/${path}\`;`);
      expect(PAGE).toContain(`| \`/api/${path}\` |`);
    }
  });

  it("uses no shell variable zsh reserves, so every snippet runs in bash and zsh", () => {
    const snippets = [...PAGE.matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1]);
    expect(snippets.length).toBeGreaterThan(0);
    for (const snippet of snippets) {
      for (const reserved of ["status", "path", "pipestatus"]) {
        expect(snippet).not.toMatch(new RegExp(`(^|[\\s;(])${reserved}=`, "m"));
      }
    }
  });
});
