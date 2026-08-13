import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MODULE_ROOT, SCHEMA_PATH, SPEC_PATH, main, render } from "@/scripts/api-sync.mjs";

/**
 * The generated client, and the check that keeps it honest.
 *
 * `app/api/schema.d.ts` is committed, which is what makes a contract change reviewable —
 * and what makes staleness possible. This suite is the answer to that: it runs the same
 * `--check` a developer runs, in a subprocess, so the verb documented in the README is
 * exercised rather than trusted. `ci/ui` runs `yarn test`, and `.github/workflows/ui.yml`
 * watches `ouroboros-rest/openapi.json`, so a pull request that changes the contract and
 * forgets `yarn api:sync` fails here rather than in a browser.
 */

/** How the script is invoked, exactly as `yarn api:check` invokes it. */
const SCRIPT = join(MODULE_ROOT, "scripts", "api-sync.mjs");

/**
 * Run the script the way a shell does.
 *
 * @param args Arguments to pass.
 * @returns The exit status and what it wrote to stdout and stderr.
 */
function run(args: string[]): { status: number; output: string } {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: MODULE_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output: stdout };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? -1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

describe("the committed types", () => {
  it("are current — run `yarn api:sync` if this fails", async () => {
    // The assertion the whole arrangement exists for. It runs in-process as well as in
    // the subprocess below because this is the one whose failure message should say what
    // to do about it.
    expect(readFileSync(SCHEMA_PATH, "utf8")).toBe(await render(SPEC_PATH));
  });

  it("are generated from the document ouroboros-rest commits", () => {
    expect(SPEC_PATH).toContain(join("ouroboros-rest", "openapi.json"));
    expect(readFileSync(SPEC_PATH, "utf8").length).toBeGreaterThan(0);
  });

  it("say where they came from and how to rewrite them", () => {
    const header = readFileSync(SCHEMA_PATH, "utf8").slice(0, 400);

    expect(header).toContain("ouroboros-rest/openapi.json");
    expect(header).toContain("do not edit");
    expect(header).toContain("yarn api:sync");
  });

  it("describe the operations the contract publishes", async () => {
    // A generator that silently produced an empty module would satisfy every check above.
    const generated = await render(SPEC_PATH);

    expect(generated).toContain('"/api/v1/orgs"');
    expect(generated).toContain("listOrgs");
    expect(generated).toContain("OrgRowPage:");
  });
});

describe("yarn api:check", () => {
  it("passes while the committed file matches the contract", () => {
    const { status, output } = run(["--check"]);

    expect(status).toBe(0);
    expect(output).toContain("current");
  });

  it("fails, naming the fix, when the file has drifted", () => {
    // Drift is arranged for real rather than described: the committed file is edited,
    // the check is run against it, and the original is put back whatever happens. That
    // is the only way to prove the exit code CI depends on.
    const original = readFileSync(SCHEMA_PATH, "utf8");
    let result;
    try {
      writeFileSync(SCHEMA_PATH, `${original}\nexport type Drift = never;\n`, "utf8");
      result = run(["--check"]);
    } finally {
      writeFileSync(SCHEMA_PATH, original, "utf8");
    }

    expect(result.status).toBe(1);
    expect(result.output).toContain("yarn api:sync");
    expect(readFileSync(SCHEMA_PATH, "utf8")).toBe(original);
  });

  it("writes nothing, so a check can run on a read-only tree", () => {
    const before = readFileSync(SCHEMA_PATH, "utf8");

    run(["--check"]);

    expect(readFileSync(SCHEMA_PATH, "utf8")).toBe(before);
  });

  it("refuses an argument it does not understand rather than guessing", () => {
    const { status, output } = run(["--force"]);

    expect(status).toBe(2);
    expect(output).toContain("usage: api-sync [--check]");
  });
});

describe("yarn api:sync", () => {
  it("is a no-op when the file is already current, so it is safe to run twice", async () => {
    const before = readFileSync(SCHEMA_PATH, "utf8");

    expect(await main([])).toBe(0);

    expect(readFileSync(SCHEMA_PATH, "utf8")).toBe(before);
  });

  it("rewrites the file when it has drifted", async () => {
    const original = readFileSync(SCHEMA_PATH, "utf8");
    let status;
    try {
      writeFileSync(SCHEMA_PATH, "// stale\n", "utf8");
      status = await main([]);
    } finally {
      writeFileSync(SCHEMA_PATH, original, "utf8");
    }

    expect(status).toBe(0);
  });
});

describe("the wiring that makes staleness fail CI", () => {
  it("gives the module both verbs, named as the README names them", () => {
    const manifest = JSON.parse(
      readFileSync(join(MODULE_ROOT, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(manifest.scripts["api:sync"]).toBe("node scripts/api-sync.mjs");
    expect(manifest.scripts["api:check"]).toBe("node scripts/api-sync.mjs --check");
  });

  it("runs this module's checks when only the contract changes", () => {
    // Without this path, `ci/ui` never runs on the pull request that renames a field —
    // the change is entirely inside ouroboros-rest, and the stale types here would reach
    // main unnoticed. It is the one line that makes "CI fails on stale generated types"
    // true rather than merely intended.
    const workflow = readFileSync(
      join(MODULE_ROOT, "..", ".github", "workflows", "ui.yml"),
      "utf8",
    );

    const watched = workflow.match(/- "ouroboros-rest\/openapi\.json"/g) ?? [];
    // Once for `pull_request`, once for `push`: GitHub's parser does not resolve YAML
    // anchors, so the two filter lists are written out separately.
    expect(watched).toHaveLength(2);
  });
});
