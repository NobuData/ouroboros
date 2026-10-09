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
const PAGE = source("ouroboros-docs/docs/cli/index.mdx");

/** The runner agent's entry point, which holds its usage text and defaults. */
const RUNNER_MAIN = source("ouroboros-runner/cmd/ouroboros-runner/main.go");

/** The runner installer. */
const INSTALL_SH = source("ouroboros-runner/install.sh");

/**
 * Reads a shell assignment's value, e.g. `BIN_DIR=/usr/local/bin`.
 *
 * @param text the script.
 * @param name the variable assigned.
 * @returns the assigned value.
 * @throws {Error} when the script does not assign the variable.
 */
function shellValue(text: string, name: string): string {
  const match = new RegExp(`^${name}=(\\S+)$`, "m").exec(text);
  if (!match) throw new Error(`${name} is not assigned in the script`);
  return match[1];
}

/**
 * Lists the agent's flag/variable pairs from the "Environment" block of its usage text, where
 * each variable is followed (on its line or the next) by the flag it backs.
 *
 * @returns `[variable, flag]` pairs, in usage order.
 */
function runnerEnvironment(): [string, string][] {
  const block = RUNNER_MAIN.slice(RUNNER_MAIN.indexOf("Environment (each a fallback"));
  return [...block.matchAll(/(OURO_RUNNER_[A-Z_]+)\s+(--[a-z-]+)/g)].map((match) => [
    match[1],
    match[2],
  ]);
}

describe("the CLI overview page (#1201)", () => {
  it("pairs every runner variable with its flag, as the agent's usage does", () => {
    const pairs = runnerEnvironment();
    expect(pairs.length).toBeGreaterThanOrEqual(7);
    for (const [variable, flag] of pairs) {
      expect(PAGE).toContain(`| \`${flag}\` | <EnvVar name="${variable}" /> |`);
    }
  });

  it("names the token as the installer's only environment setting", () => {
    expect(INSTALL_SH).toMatch(/^token=\$\{OURO_RUNNER_TOKEN:-\}$/m);
    expect(PAGE).toContain("only one\nsetting from the environment: `OURO_RUNNER_TOKEN`");
  });

  it("gives the runner's default state directory", () => {
    const fallback = /const DefaultStateDir = "([^"]+)"/.exec(RUNNER_MAIN)?.[1];
    expect(fallback).toBeDefined();
    expect(PAGE).toContain(`\`${fallback}\` unless you set \`--state-dir\``);
  });

  it("gives every path the installer writes", () => {
    expect(PAGE).toContain(`\`${shellValue(INSTALL_SH, "BIN_DIR")}/ouroboros-runner\``);
    for (const name of ["SYSTEMD_UNIT", "LAUNCHD_PLIST"]) {
      expect(PAGE).toContain(`\`${shellValue(INSTALL_SH, name)}\``);
    }
    expect(PAGE).toContain(`\`${shellValue(INSTALL_SH, "CONFIG_DIR")}/\``);
  });

  it("states the installer's exit statuses", () => {
    expect(INSTALL_SH).toMatch(/-h \| --help\) usage; exit 0 ;;/);
    expect(INSTALL_SH).toMatch(/^die\(\) \{[\s\S]*?\n {2}exit 1\n\}/m);
    expect(PAGE).toContain(
      "| `install.sh` | Installed, upgraded or uninstalled; or `--help`. | `1`",
    );
  });

  it("states yarn setup's exit statuses as setup.sh documents them", () => {
    const setup = source("scripts/setup.sh");
    for (const status of ["0", "1", "2"]) {
      expect(setup).toMatch(new RegExp(`^#\\s+${status}\\s+\\S`, "m"));
    }
    expect(PAGE).toMatch(/\| `yarn setup` \|[^\n]*\| `1`[^\n]*`2`: bad command-line usage\. \|/);
  });

  it("names only stack commands the repository defines", () => {
    const scripts = Object.keys(
      (JSON.parse(source("package.json")) as { scripts: Record<string, string> }).scripts,
    );
    const named = [...PAGE.matchAll(/`yarn ([a-z:]+)`/g)].map((match) => match[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) expect(scripts).toContain(name);
  });

  it("describes chat commands as not available yet", () => {
    expect(PAGE).toMatch(/:::info\[Not available yet\]\n\nChat commands \(`\/ouro …`/);
  });
});
