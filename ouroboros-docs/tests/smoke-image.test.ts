import { spawnSync } from "node:child_process";
import { accessSync, constants, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { COPYRIGHT } from "../site.constants";

/** The module directory (`ouroboros-docs/`). */
const MODULE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The smoke script under test. */
const SCRIPT = join(MODULE_DIR, "scripts", "smoke-image.sh");

/** Its text. */
const TEXT = readFileSync(SCRIPT, "utf8");

/**
 * Runs the script with no docker or curl needed: only its argument checks are reached.
 *
 * @param args the arguments.
 * @returns the exit status and standard error.
 */
function run(...args: string[]): { status: number | null; stderr: string } {
  const result = spawnSync("sh", [SCRIPT, ...args], { encoding: "utf8" });
  return { status: result.status, stderr: result.stderr };
}

describe("scripts/smoke-image.sh (#1208)", () => {
  it("is executable, as ci/docs runs it directly", () => {
    expect(() => accessSync(SCRIPT, constants.X_OK)).not.toThrow();
  });

  it("checks for the copyright line the footer really prints", () => {
    expect(TEXT).toContain(`COPYRIGHT='${COPYRIGHT}'`);
  });

  it("probes the health check, the three section roots, a deep page and a 404", () => {
    expect(TEXT).toContain("fetch /healthz");
    expect(TEXT).toContain("for path in / /user-guide /administration /cli; do");
    expect(TEXT).toContain("fetch /cli/runner/enroll");
    expect(TEXT).toContain("check 'an unknown path answers 404' status_is 404");
  });

  it("probes a deep page that exists", () => {
    expect(() => accessSync(join(MODULE_DIR, "docs", "cli", "runner", "enroll.mdx"))).not.toThrow();
  });

  it("always removes its container", () => {
    expect(TEXT).toContain("trap cleanup EXIT");
    expect(TEXT).toMatch(/cleanup\(\) \{\n {2}docker rm -f "\$NAME"/);
  });

  it("refuses a call without an image, with exit status 2", () => {
    const { status, stderr } = run();
    expect(status).toBe(2);
    expect(stderr).toContain("usage: scripts/smoke-image.sh IMAGE [PORT]");
  });

  it("refuses a port that is not a number, or an option for an image", () => {
    expect(run("ouroboros-docs:smoke", "80a").status).toBe(2);
    expect(run("--help").status).toBe(2);
    expect(run("a", "1", "extra").status).toBe(2);
  });
});
