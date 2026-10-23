import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Administration → Live execution (DK.3, [#1325](https://github.com/NobuData/ouroboros/issues/1325))
 * against the code it describes: the prerequisite list is DK.1's readiness checks, one for one
 * and in order; the page says what is **not** protected at the same heading level as what is;
 * and the deployment pages carry the engine's way back to REST.
 */

/** The repository root, two levels above this file (`ouroboros-docs/tests/`). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Reads a file of the repository.
 *
 * @param path the file's path segments, from the repository root.
 * @returns its text.
 */
function source(...path: string[]): string {
  return readFileSync(join(REPO_ROOT, ...path), "utf8");
}

/** The page, as written. */
const PAGE = source("ouroboros-docs", "docs", "administration", "live-execution.mdx");

/**
 * DK.1's checks, in order — `READINESS_CHECK_IDS` in `ouroboros-rest/src/modules/loop/readiness.ts`,
 * the one list the readiness route answers and the wizard draws.
 */
function readinessCheckIds(): string[] {
  const code = source("ouroboros-rest", "src", "modules", "loop", "readiness.ts");
  const list = /export const READINESS_CHECK_IDS = \[([^\]]*)\]/.exec(code);

  if (list === null) throw new Error("READINESS_CHECK_IDS not found in readiness.ts");

  return [...list[1]!.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]!);
}

/**
 * The check ids the page's Prerequisites table names, in its order.
 *
 * @returns the first cell of each data row, unquoted.
 */
function prerequisiteRows(): string[] {
  const section = /## Prerequisites\n([\s\S]*?)\n## /.exec(PAGE);

  if (section === null) throw new Error("no Prerequisites section");

  return [...section[1]!.matchAll(/^\| `([a-z_]+)` \|/gm)].map((match) => match[1]!);
}

describe("the live-execution page", () => {
  it("lists DK.1's readiness checks as its prerequisites, one for one and in order", () => {
    const ids = readinessCheckIds();

    expect(ids.length).toBeGreaterThan(0);
    expect(prerequisiteRows()).toEqual(ids);
  });

  it("says what is not protected at the same prominence as what the loop can do", () => {
    expect(PAGE).toMatch(/^## What the loop can do$/m);
    expect(PAGE).toMatch(/^## What it cannot protect you from$/m);
    expect(PAGE).toContain("Issue text is untrusted input");
    expect(PAGE).toContain("ROADMAP_AGENT_RUNTIME_SECURITY.md");
  });

  it("names the switch, the engine's REST address and the run volume under Turning it on", () => {
    const section = /## Turning it on\n([\s\S]*?)\n## /.exec(PAGE)?.[1] ?? "";

    expect(section).toContain('<EnvVar name="OURO_LIVE_EXECUTION_ENABLED" />');
    expect(section).toContain('<EnvVar name="OURO_REST_URL" />');
    expect(section).toContain('<EnvVar name="OURO_ENGINE_RUN_DIR" />');
  });

  it("keeps the engine's REST address on the containers page, the checklist and HOSTING.md", () => {
    const containers = source("ouroboros-docs", "docs", "administration", "deploy", "containers.mdx");
    const engine = /## `ouroboros-engine`\n([\s\S]*?)\n## /.exec(containers)?.[1] ?? "";

    expect(engine).toContain('<EnvVar name="OURO_REST_URL" />');
    expect(source("ouroboros-docs", "docs", "administration", "deploy", "checklist.mdx")).toContain(
      "## Live execution",
    );
    expect(source("HOSTING.md")).toMatch(/\| `OURO_REST_URL` \| live execution \|/);
  });

  it("states that a subscription credential is refused, with the code the service answers", () => {
    const errors = source("ouroboros-rest", "src", "modules", "provider-connections", "provider-connections.errors.ts");

    expect(errors).toContain('"provider_credential_refused"');
    expect(PAGE).toContain("`provider_credential_refused`");
  });
});
