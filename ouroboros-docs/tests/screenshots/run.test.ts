import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { USAGE, parseArgs } from "../../screenshots/run.ts";

/** The module directory. */
const MODULE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Runs `yarn screenshots`' entry point the way the script does.
 *
 * @param args its arguments.
 * @returns the exit status and output.
 */
function run(...args: string[]) {
  return spawnSync(process.execPath, ["screenshots/run.ts", ...args], {
    cwd: MODULE_DIR,
    encoding: "utf8",
  });
}

describe("parseArgs", () => {
  it("reads --only and --theme", () => {
    expect(parseArgs(["--only", "home.*", "--theme", "dark"])).toEqual({
      help: false,
      only: "home.*",
      theme: "dark",
    });
  });

  it("defaults to every entry in both themes", () => {
    expect(parseArgs([])).toEqual({ help: false });
  });

  it.each([
    [["--theme", "blue"], /light or dark/],
    [["--only"], /needs a value/],
    [["--only", "--theme"], /needs a value/],
    [["--fast"], /unknown argument/],
  ])("refuses %j", (args, message) => {
    expect(() => parseArgs(args)).toThrow(message);
  });
});

describe("yarn screenshots", () => {
  it("prints its usage with --help", () => {
    const result = run("--help");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(USAGE.split("\n")[0]);
  });

  it("fails before starting a browser when --only matches nothing", () => {
    const result = run("--only", "nothing.here");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("matches no manifest entry");
  });
});
