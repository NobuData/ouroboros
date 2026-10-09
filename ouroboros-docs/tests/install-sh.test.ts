import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The repository root, two levels above this file (`ouroboros-docs/tests/`). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The page under test. */
const PAGE = readFileSync(
  join(REPO_ROOT, "ouroboros-docs", "docs", "cli", "install-sh.mdx"),
  "utf8",
);

/** The installer the page documents. */
const SCRIPT = readFileSync(join(REPO_ROOT, "ouroboros-runner", "install.sh"), "utf8");

/**
 * Lists the long options `install.sh` parses: every `--name)` arm of `parse_arguments`'s case.
 *
 * @returns the option names, e.g. `--server`, in script order.
 */
function scriptOptions(): string[] {
  const body = SCRIPT.slice(SCRIPT.indexOf("parse_arguments() {"));
  const parser = body.slice(0, body.indexOf("\n}\n"));
  return [...parser.matchAll(/^\s+(?:-h \| )?(--[a-z-]+)\)/gm)].map((match) => match[1]);
}

/**
 * Lists the options the page's Options table documents, from each row's first cell.
 *
 * @returns the option names, e.g. `--server`, in table order.
 */
function pageOptions(): string[] {
  const table = PAGE.slice(PAGE.indexOf("## Options"), PAGE.indexOf("## What an install does"));
  return [...table.matchAll(/^\| `(?:-h`, `)?(--[a-z-]+)[^`]*` \|/gm)].map((match) => match[1]);
}

/**
 * Reads a shell assignment's value, e.g. `BIN_DIR=/usr/local/bin`, or a systemd directive
 * written into the unit, e.g. `'RestartSec=10'`.
 *
 * @param name the variable or directive.
 * @returns its value.
 * @throws {Error} when the script assigns no such name.
 */
function assigned(name: string): string {
  const match = new RegExp(`^\\s*'?${name}=([^'\\s]+)'?`, "m").exec(SCRIPT);
  if (!match) throw new Error(`${name} is not in install.sh`);
  return match[1];
}

/**
 * Reads a launchd plist integer the script writes after a `<key>`.
 *
 * @param key the plist key, e.g. `ThrottleInterval`.
 * @returns the integer, as text.
 * @throws {Error} when the script writes no such key.
 */
function plistInteger(key: string): string {
  const match = new RegExp(`<key>${key}</key>' \\\\\\n\\s+'\\s*<integer>(\\d+)</integer>`).exec(
    SCRIPT,
  );
  if (!match) throw new Error(`${key} is not in the plist install.sh writes`);
  return match[1];
}

describe("the install.sh page (#1202)", () => {
  it("documents exactly the options the script parses", () => {
    expect(scriptOptions().length).toBeGreaterThanOrEqual(15);
    expect([...pageOptions()].sort()).toEqual([...scriptOptions()].sort());
  });

  it("names every option the issue lists", () => {
    for (const option of [
      "--server",
      "--version",
      "--download-url",
      "--tenant",
      "--pool",
      "--token",
      "--name",
      "--server-ca",
      "--bearer-fallback",
      "--no-shell",
      "--user",
      "--state-dir",
      "--uninstall",
      "--purge",
    ]) {
      expect(pageOptions()).toContain(option);
    }
  });

  it("names the token variable as the one environment setting", () => {
    expect(SCRIPT).toMatch(/^token=\$\{OURO_RUNNER_TOKEN:-\}$/m);
    expect(PAGE).toContain(
      'reads one setting from the environment: <EnvVar name="OURO_RUNNER_TOKEN" />',
    );
  });

  it("gives every path the script writes", () => {
    expect(PAGE).toContain(`\`${assigned("BIN_DIR")}/ouroboros-runner\``);
    expect(PAGE).toContain(`\`${assigned("CONFIG_DIR")}/server-ca.pem\``);
    expect(PAGE).toContain(`defaults to \`${assigned("DEFAULT_STATE_DIR")}\``);
    expect(PAGE).toContain(`\`${assigned("SYSTEMD_UNIT")}\``);
    expect(PAGE).toContain(`\`${assigned("LAUNCHD_PLIST")}\``);
    expect(PAGE).toContain(`system/${assigned("LAUNCHD_LABEL")}`);
    expect(PAGE).toContain(`\`tail -f ${assigned("MACOS_LOG_DIR")}/runner.log\``);
  });

  it("states the systemd unit's restart and stop timings", () => {
    expect(assigned("RestartSec")).toBe("10");
    expect(assigned("StartLimitBurst")).toBe("5");
    expect(assigned("StartLimitIntervalSec")).toBe("300");
    expect(assigned("TimeoutStopSec")).toBe("30");
    expect(PAGE).toContain("restarts the agent 10 seconds after a crash");
    expect(PAGE).toContain("fails five times in five minutes");
  });

  it("states the launchd daemon's restart and stop timings", () => {
    expect(plistInteger("ThrottleInterval")).toBe("10");
    expect(plistInteger("ExitTimeOut")).toBe("30");
    expect(PAGE).toContain("restarts the agent 10 seconds after any exit that is not a clean stop");
  });

  it("supports exactly the platforms the page lists", () => {
    expect(SCRIPT).toContain("Linux/x86_64 | Linux/amd64) os=linux platform=linux-amd64");
    expect(SCRIPT).toContain("Linux/aarch64 | Linux/arm64) os=linux platform=linux-arm64");
    expect(SCRIPT).toContain("Darwin/arm64) os=darwin platform=darwin-arm64");
    expect(PAGE).toContain("Linux on x86-64 and arm64, and macOS on Apple\n   silicon");
  });

  it("quotes only refusals the script really prints", () => {
    const section = PAGE.slice(PAGE.indexOf("## What can go wrong"));
    const quoted = [...section.matchAll(/^- \*\*`([^`]+)`/gm)].map((match) => match[1]);
    expect(quoted.length).toBeGreaterThanOrEqual(6);
    for (const line of quoted) {
      // The page writes `…` where the script interpolates a value.
      const pattern = line
        .split("…")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^\\n]*");
      expect(SCRIPT, line).toMatch(
        new RegExp(pattern.replace("/var/lib/ouroboros-runner", "\\$state_dir")),
      );
    }
  });

  it("states the exit statuses the script uses", () => {
    expect(SCRIPT).toContain("-h | --help) usage; exit 0 ;;");
    expect(SCRIPT).toMatch(
      /die\(\) \{\n {2}printf 'install\.sh: %s\\n' "\$\*" >&2\n {2}exit 1\n\}/,
    );
    expect(PAGE).toContain(
      "| `1` | Refused or failed. The reason is on standard error, starting `install.sh:`. |",
    );
  });
});
