import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  checkFlags,
  expectations,
  frontMatterFlags,
  installerFlags,
  installerUsage,
  type PageExpectation,
  runnerCommandFlags,
  runnerUsage,
} from "../scripts/cli-flags.ts";

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

/** A runner usage text in the shape `main.go` writes it, with a flag mentioned in prose. */
const USAGE = `ouroboros-runner — the agent.

Usage:
  ouroboros-runner enroll --server URL --token TOKEN
                          [--name NAME] [--state-dir DIR]
      Spend a token. Unlike --no-shell, this is not a flag of enroll.

  ouroboros-runner version   Print the build.
  ouroboros-runner hello [--no-shell]
      Print the hello.

Environment (each a fallback for its flag):
  OURO_RUNNER_SERVER      --server     the control plane
`;

/** An installer script with a usage heredoc in the shape `install.sh` writes it. */
const SCRIPT = `#!/bin/sh
usage() {
  cat <<'USAGE'
Install it.

  curl … | sh -s -- --tenant <workspace>

Options:
  --server URL        the deployment
  --purge             with --uninstall: remove it
  -h, --help          this text
USAGE
}
`;

/**
 * Builds a page with front matter.
 *
 * @param frontMatter the lines between the `---` fences.
 * @returns the page's text.
 */
function page(frontMatter: string): string {
  return `---\ntitle: "A page"\n${frontMatter}\n---\n\nBody.\n`;
}

describe("runnerUsage", () => {
  it("reads the usage constant between its backquotes", () => {
    expect(runnerUsage("package main\n\nconst usage = `the text`\n")).toBe("the text");
  });

  it("refuses a file with no usage constant rather than reading nothing", () => {
    expect(() => runnerUsage("package main\n")).toThrow(/no `const usage/);
  });
});

describe("runnerCommandFlags", () => {
  it("reads each command's synopsis, continuation lines included", () => {
    expect(runnerCommandFlags(USAGE)).toEqual(
      new Map([
        ["enroll", ["--server", "--token", "--name", "--state-dir"]],
        ["version", []],
        ["hello", ["--no-shell"]],
      ]),
    );
  });

  it("does not take a flag mentioned in a description for one the command accepts", () => {
    expect(runnerCommandFlags(USAGE).get("enroll")).not.toContain("--no-shell");
  });

  it("refuses a text that names no command", () => {
    expect(() => runnerCommandFlags("Usage: nothing\n")).toThrow(/names no command/);
  });
});

describe("installerUsage and installerFlags", () => {
  it("reads the options from the usage heredoc, --help included", () => {
    expect(installerFlags(installerUsage(SCRIPT))).toEqual(["--server", "--purge", "--help"]);
  });

  it("ignores flags in the synopsis line, which is indented further", () => {
    expect(installerFlags(installerUsage(SCRIPT))).not.toContain("--tenant");
  });

  it("refuses a script with no usage heredoc", () => {
    expect(() => installerUsage("#!/bin/sh\necho hi\n")).toThrow(/no usage\(\) heredoc/);
  });

  it("refuses a usage text with no option", () => {
    expect(() => installerFlags("Install it.\n")).toThrow(/lists no option/);
  });
});

describe("frontMatterFlags", () => {
  it("reads a block list of quoted items", () => {
    expect(frontMatterFlags(page('flags:\n  - "--server"\n  - "--pool"'))).toEqual([
      "--server",
      "--pool",
    ]);
  });

  it("reads plain items", () => {
    expect(frontMatterFlags(page("flags:\n  - --server"))).toEqual(["--server"]);
  });

  it("stops at the next key", () => {
    expect(frontMatterFlags(page('flags:\n  - "--server"\nsidebar_position: 2'))).toEqual([
      "--server",
    ]);
  });

  it("reads flags: [] as no flags", () => {
    expect(frontMatterFlags(page("flags: []"))).toEqual([]);
  });

  it("returns undefined for a page with no flags: key, or no front matter", () => {
    expect(frontMatterFlags(page('sidebar_label: "x"'))).toBeUndefined();
    expect(frontMatterFlags("No front matter.\n")).toBeUndefined();
  });

  it("refuses any other shape, so a typo cannot read as empty", () => {
    expect(() => frontMatterFlags(page("flags: --server"))).toThrow(/block list or \[\]/);
    expect(() => frontMatterFlags(page("flags:\nsidebar_position: 2"))).toThrow(/has no items/);
  });
});

describe("checkFlags", () => {
  const known = new Set(["--server", "--pool", "--name"]);
  const wanted: PageExpectation[] = [
    { page: "cli/runner/enroll.mdx", required: ["--server", "--pool"], known },
  ];

  it("passes a page that lists every flag", () => {
    const pages = new Map([
      ["cli/runner/enroll.mdx", page('flags:\n  - "--server"\n  - "--pool"')],
    ]);
    expect(checkFlags(wanted, pages)).toEqual([]);
  });

  it("allows a known flag the command's synopsis does not name", () => {
    const pages = new Map([
      ["cli/runner/enroll.mdx", page('flags:\n  - "--server"\n  - "--pool"\n  - "--name"')],
    ]);
    expect(checkFlags(wanted, pages)).toEqual([]);
  });

  it("reports a flag the tool accepts and the page does not list", () => {
    const pages = new Map([["cli/runner/enroll.mdx", page('flags:\n  - "--server"')]]);
    expect(checkFlags(wanted, pages)).toEqual([
      {
        page: "cli/runner/enroll.mdx",
        message: "--pool is accepted but not in the page's flags: list",
      },
    ]);
  });

  it("reports a listed flag the tool does not accept", () => {
    const pages = new Map([
      ["cli/runner/enroll.mdx", page('flags:\n  - "--server"\n  - "--pool"\n  - "--gone"')],
    ]);
    expect(checkFlags(wanted, pages)).toEqual([
      {
        page: "cli/runner/enroll.mdx",
        message: "--gone is in flags: but the tool accepts no such flag",
      },
    ]);
  });

  it("reports a flag listed twice", () => {
    const pages = new Map([
      ["cli/runner/enroll.mdx", page('flags:\n  - "--server"\n  - "--pool"\n  - "--pool"')],
    ]);
    expect(checkFlags(wanted, pages).map(({ message }) => message)).toEqual([
      "--pool is listed twice in flags:",
    ]);
  });

  it("reports a missing page, a missing list and a malformed list", () => {
    expect(checkFlags(wanted, new Map())[0].message).toBe("the page does not exist");
    expect(checkFlags(wanted, new Map([["cli/runner/enroll.mdx", page("x: y")]]))[0].message).toBe(
      "the front matter has no flags: list",
    );
    expect(
      checkFlags(wanted, new Map([["cli/runner/enroll.mdx", page("flags: nope")]]))[0].message,
    ).toMatch(/block list or \[\]/);
  });
});

describe("expectations", () => {
  it("maps each runner command, help included, and install.sh to its page", () => {
    const pages = expectations(`const usage = \`${USAGE}\``, SCRIPT).map(({ page: path }) => path);
    expect(pages).toEqual([
      "cli/runner/enroll.mdx",
      "cli/runner/version.mdx",
      "cli/runner/hello.mdx",
      "cli/runner/help.mdx",
      "cli/install-sh.mdx",
    ]);
  });

  it("knows a runner flag from any command, and an installer flag only for install.sh", () => {
    const [enroll, , , , installer] = expectations(`const usage = \`${USAGE}\``, SCRIPT);
    expect(enroll.known.has("--no-shell")).toBe(true);
    expect(installer.known.has("--no-shell")).toBe(false);
  });
});

describe("the repository's CLI pages", () => {
  it("document every flag the runner and the installer accept", () => {
    const wanted = expectations(
      source("ouroboros-runner/cmd/ouroboros-runner/main.go"),
      source("ouroboros-runner/install.sh"),
    );
    const pages = new Map(
      wanted.map(({ page: path }) => [path, source(`ouroboros-docs/docs/${path}`)]),
    );
    expect(checkFlags(wanted, pages)).toEqual([]);
  });

  it("cover all six runner commands", () => {
    const wanted = expectations(
      source("ouroboros-runner/cmd/ouroboros-runner/main.go"),
      source("ouroboros-runner/install.sh"),
    );
    for (const command of ["enroll", "run", "version", "hello", "heartbeat", "help"]) {
      expect(wanted.map(({ page: path }) => path)).toContain(`cli/runner/${command}.mdx`);
    }
  });

  it("mention every listed flag in the page body", () => {
    const wanted = expectations(
      source("ouroboros-runner/cmd/ouroboros-runner/main.go"),
      source("ouroboros-runner/install.sh"),
    );
    for (const { page: path } of wanted) {
      const text = source(`ouroboros-docs/docs/${path}`);
      const body = text.slice(text.indexOf("\n---\n", 4));
      for (const flag of frontMatterFlags(text) ?? []) {
        expect(body, `${path} ${flag}`).toContain(`\`${flag}`);
      }
    }
  });
});

describe("check-cli-flags", () => {
  const script = join(REPO_ROOT, "ouroboros-docs", "scripts", "check-cli-flags.ts");

  it("passes while every page documents its tool's flags", () => {
    expect(execFileSync("node", [script], { encoding: "utf8" })).toMatch(
      /^check:cli-flags: 7 pages document all \d+ flags$/m,
    );
  });

  it("refuses an argument with exit code 2", () => {
    const result = spawnSync("node", [script, "--fix"], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("it takes none");
  });
});
