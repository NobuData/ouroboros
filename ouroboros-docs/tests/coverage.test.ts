import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { checkRoutes, parseCoverage, routeOf, routesOf } from "../scripts/coverage.ts";

/** The module directory (`ouroboros-docs/`). */
const MODULE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The repository root. */
const REPO_ROOT = join(MODULE_DIR, "..");

/** The command under test. */
const SCRIPT = join(MODULE_DIR, "scripts", "check-coverage.ts");

describe("routeOf", () => {
  it("drops the route group and the file name", () => {
    expect(routeOf("(app)/dashboard/page.tsx")).toBe("/dashboard");
    expect(routeOf("(auth)/login/page.tsx")).toBe("/login");
    expect(routeOf("(wizard)/get-started/page.tsx")).toBe("/get-started");
  });

  it("drops a nested group and keeps dynamic segments", () => {
    expect(routeOf("(app)/models/(routing)/page.tsx")).toBe("/models");
    expect(routeOf("(app)/runs/[id]/tests/page.tsx")).toBe("/runs/[id]/tests");
  });

  it("serves the root from the group's own page", () => {
    expect(routeOf("(app)/page.tsx")).toBe("/");
  });

  it("ignores files that are not a page, and pages outside the route groups", () => {
    expect(routeOf("(app)/dashboard/table.tsx")).toBeUndefined();
    expect(routeOf("(app)/dashboard/layout.tsx")).toBeUndefined();
    expect(routeOf("api/farm/page.tsx")).toBeUndefined();
    expect(routeOf("page.tsx")).toBeUndefined();
  });
});

describe("routesOf", () => {
  it("sorts and deduplicates", () => {
    expect(routesOf(["(app)/b/page.tsx", "(app)/a/page.tsx", "(app)/(x)/a/page.tsx"])).toEqual([
      "/a",
      "/b",
    ]);
  });
});

describe("parseCoverage", () => {
  it("reads page ids and undocumented reasons", () => {
    const parsed = parseCoverage(
      '{"routes": {"/a": "user-guide/a", "/workshop/x": {"undocumented": "a workshop"}}}',
    );
    expect(parsed.get("/a")).toEqual({ page: "user-guide/a" });
    expect(parsed.get("/workshop/x")).toEqual({ undocumented: "a workshop" });
  });

  it("refuses anything but that shape, naming the fault", () => {
    expect(() => parseCoverage("nope")).toThrow(/not JSON/);
    expect(() => parseCoverage("[]")).toThrow(/object with a routes member/);
    expect(() => parseCoverage("{}")).toThrow(/needs a routes object/);
    expect(() => parseCoverage('{"routes": {"a": "x"}}')).toThrow(/must start with \//);
    expect(() => parseCoverage('{"routes": {"/a": ""}}')).toThrow(/empty page id/);
    expect(() => parseCoverage('{"routes": {"/a": {"undocumented": " "}}}')).toThrow(
      /page id or to \{"undocumented"/,
    );
    expect(() => parseCoverage('{"routes": {"/a": 1}}')).toThrow(/page id or to/);
  });
});

describe("checkRoutes", () => {
  const exists = (id: string) => id === "user-guide/a";

  it("passes when every route is mapped to a page that exists, or excused", () => {
    const coverage = parseCoverage(
      '{"routes": {"/a": "user-guide/a", "/workshop/x": {"undocumented": "a workshop"}}}',
    );
    expect(checkRoutes(["/a", "/workshop/x"], coverage, exists)).toEqual([]);
  });

  it("reports a route with no entry", () => {
    expect(
      checkRoutes(["/a", "/b"], parseCoverage('{"routes": {"/a": "user-guide/a"}}'), exists),
    ).toEqual([
      { route: "/b", message: expect.stringContaining("no entry in docs-coverage.json") },
    ]);
  });

  it("reports an entry naming a page that does not exist", () => {
    expect(
      checkRoutes(["/a"], parseCoverage('{"routes": {"/a": "user-guide/gone"}}'), exists),
    ).toEqual([
      {
        route: "/a",
        message: "maps to user-guide/gone, and docs/user-guide/gone.mdx does not exist",
      },
    ]);
  });

  it("reports an entry for a route that no longer exists", () => {
    expect(checkRoutes([], parseCoverage('{"routes": {"/a": "user-guide/a"}}'), exists)).toEqual([
      { route: "/a", message: "is in docs-coverage.json but no page.tsx serves it" },
    ]);
  });

  it("requires a workshop route to be undocumented", () => {
    expect(
      checkRoutes(
        ["/workshop/x"],
        parseCoverage('{"routes": {"/workshop/x": "user-guide/a"}}'),
        exists,
      ),
    ).toEqual([
      { route: "/workshop/x", message: expect.stringContaining("workshop route must be") },
    ]);
  });
});

describe("docs-coverage.json", () => {
  const coverage = parseCoverage(readFileSync(join(MODULE_DIR, "docs-coverage.json"), "utf8"));

  it("names only pages that exist, as ids", () => {
    for (const [route, mapping] of coverage) {
      if ("page" in mapping) {
        expect(existsSync(join(MODULE_DIR, "docs", `${mapping.page}.mdx`)), route).toBe(true);
      }
    }
  });

  it("excuses every workshop route, and only with a reason", () => {
    for (const [route, mapping] of coverage) {
      if (route.startsWith("/workshop/")) expect(mapping, route).toHaveProperty("undocumented");
    }
  });
});

describe("check-coverage", () => {
  /** A route added for one test, removed afterwards. */
  const stray = join(REPO_ROOT, "ouroboros-ui", "app", "(app)", "zz-coverage-probe");

  afterEach(() => rmSync(stray, { recursive: true, force: true }));

  it("passes on the committed tree", () => {
    expect(execFileSync("node", [SCRIPT], { encoding: "utf8" })).toMatch(
      /^check:coverage: \d+ routes, every variable and every flag are documented/m,
    );
  });

  it("fails on a page.tsx with no entry, naming the route", () => {
    mkdirSync(stray, { recursive: true });
    writeFileSync(join(stray, "page.tsx"), "export default function Page() { return null; }\n");
    const result = spawnSync("node", [SCRIPT], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("route /zz-coverage-probe: no entry in docs-coverage.json");
  });

  it("refuses an argument with exit code 2", () => {
    const result = spawnSync("node", [SCRIPT, "--fix"], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("it takes none");
  });
});
