/**
 * The CLI flag drift check's reading and comparing (DC.3): which flags the command-line tools
 * accept, and which flags their reference pages say they document.
 *
 * The tools' own usage texts are the truth. `ouroboros-runner`'s is the `usage` constant in
 * `cmd/ouroboros-runner/main.go`; `install.sh`'s is the heredoc its `usage` function prints.
 * Each reference page lists the flags it documents in a `flags:` front matter list, and
 * {@link checkFlags} reports every disagreement. `scripts/check-cli-flags.ts` is the command.
 *
 * Pure functions only — no file system — so every rule is testable from strings.
 */

/** A flag as a usage text writes it, with its leading dashes: `--state-dir`. */
export type Flag = string;

/** One page the check holds to a usage text. */
export interface PageExpectation {
  /** The page's path under `docs/`, e.g. `cli/runner/enroll.mdx`. */
  page: string;
  /** The flags the usage text gives this page's command, which the page must list. */
  required: readonly Flag[];
  /** Every flag the tool accepts; a listed flag outside this set is stale. */
  known: ReadonlySet<Flag>;
}

/** One disagreement between a page and its usage text. */
export interface FlagProblem {
  /** The page's path under `docs/`. */
  page: string;
  /** What is wrong, as one line naming the fix. */
  message: string;
}

/** A long flag inside a usage line: `--server`, `--keep-workspace-on-failure`. */
const FLAG_PATTERN = /--[a-z][a-z-]*/g;

/**
 * Extracts the `usage` constant from the runner's `main.go`.
 *
 * @param goSource the text of `cmd/ouroboros-runner/main.go`.
 * @returns the usage text, between its backquotes.
 * @throws {Error} when the file declares no `const usage = \`…\`` — the check would otherwise
 *   pass by reading nothing.
 */
export function runnerUsage(goSource: string): string {
  const match = /^const usage = `([^`]*)`/m.exec(goSource);
  if (!match) throw new Error("main.go declares no `const usage = `…`` to read the flags from");
  return match[1];
}

/**
 * Reads each command's flags from the runner's usage text.
 *
 * A command's synopsis is its `  ouroboros-runner <command> …` line plus the continuation lines
 * after it that start with `[` (more optional flags). The indented description below is not
 * read, so a flag the prose mentions in passing is not taken for one the command accepts.
 *
 * @param usage the usage text, from {@link runnerUsage}.
 * @returns each command in usage order, mapped to its flags in synopsis order.
 * @throws {Error} when the text names no command at all.
 */
export function runnerCommandFlags(usage: string): Map<string, Flag[]> {
  const commands = new Map<string, Flag[]>();
  let current: string | undefined;
  for (const line of usage.split("\n")) {
    const command = /^ {2}ouroboros-runner ([a-z]+)\b(.*)$/.exec(line);
    if (command) {
      current = command[1];
      commands.set(current, [...(command[2].match(FLAG_PATTERN) ?? [])]);
      continue;
    }
    if (current && /^\s+\[/.test(line)) {
      commands.get(current)?.push(...(line.match(FLAG_PATTERN) ?? []));
      continue;
    }
    current = undefined;
  }
  if (commands.size === 0) throw new Error("the runner's usage text names no command");
  return commands;
}

/**
 * Extracts the text `install.sh` prints for `--help`: its `usage` function's heredoc.
 *
 * @param script the text of `install.sh`.
 * @returns the heredoc's body.
 * @throws {Error} when the script has no `cat <<'USAGE'` heredoc in a `usage` function.
 */
export function installerUsage(script: string): string {
  const match = /^usage\(\) \{\n {2}cat <<'USAGE'\n([\s\S]*?)\nUSAGE\n/m.exec(script);
  if (!match) throw new Error("install.sh has no usage() heredoc to read the flags from");
  return match[1];
}

/**
 * Reads the installer's flags from its usage text: each option line in the `Options:` list,
 * which starts two spaces in with the flag (`  --server URL …`, `  -h, --help …`).
 *
 * @param usage the usage text, from {@link installerUsage}.
 * @returns the long flags, in usage order.
 * @throws {Error} when the text lists no option.
 */
export function installerFlags(usage: string): Flag[] {
  const flags = usage
    .split("\n")
    .map((line) => /^ {2}(?:-[a-z], )?(--[a-z][a-z-]*)/.exec(line)?.[1])
    .filter((flag): flag is Flag => flag !== undefined);
  if (flags.length === 0) throw new Error("install.sh's usage text lists no option");
  return flags;
}

/**
 * Reads a page's `flags:` front matter list.
 *
 * Accepts the two YAML shapes a page uses: a block list of quoted or plain items, and the empty
 * flow list `flags: []` for a command with no flags.
 *
 * @param page the page's text.
 * @returns the listed flags, or `undefined` when the page has no front matter or no `flags:`.
 * @throws {Error} when `flags:` is present in any other shape, so a typo cannot read as empty.
 */
export function frontMatterFlags(page: string): Flag[] | undefined {
  const frontMatter = /^---\n([\s\S]*?)\n---\n/.exec(page)?.[1];
  if (frontMatter === undefined) return undefined;
  const lines = frontMatter.split("\n");
  const start = lines.findIndex((line) => /^flags:/.test(line));
  if (start < 0) return undefined;

  const inline = lines[start].slice("flags:".length).trim();
  if (inline === "[]") return [];
  if (inline !== "") throw new Error(`flags: must be a block list or [], not "${inline}"`);

  const flags: Flag[] = [];
  for (const line of lines.slice(start + 1)) {
    const item = /^ {2}- (?:"([^"]+)"|(\S+))$/.exec(line);
    if (!item) break;
    flags.push(item[1] ?? item[2]);
  }
  if (flags.length === 0) throw new Error("flags: has no items; write flags: [] for none");
  return flags;
}

/**
 * Compares each page's `flags:` list with the flags its usage text gives it.
 *
 * @param expectations what each page must list, from the usage texts.
 * @param pages each page's text, keyed by its path under `docs/`; a missing key is a missing
 *   page.
 * @returns every problem, in expectation order; empty when the pages and the tools agree.
 */
export function checkFlags(
  expectations: readonly PageExpectation[],
  pages: ReadonlyMap<string, string>,
): FlagProblem[] {
  const problems: FlagProblem[] = [];
  for (const { page, required, known } of expectations) {
    const text = pages.get(page);
    if (text === undefined) {
      problems.push({ page, message: "the page does not exist" });
      continue;
    }

    let listed: Flag[] | undefined;
    try {
      listed = frontMatterFlags(text);
    } catch (error) {
      problems.push({ page, message: (error as Error).message });
      continue;
    }
    if (listed === undefined) {
      problems.push({ page, message: "the front matter has no flags: list" });
      continue;
    }

    for (const flag of required) {
      if (!listed.includes(flag)) {
        problems.push({ page, message: `${flag} is accepted but not in the page's flags: list` });
      }
    }
    for (const flag of listed) {
      if (!known.has(flag)) {
        problems.push({ page, message: `${flag} is in flags: but the tool accepts no such flag` });
      }
    }
    const seen = new Set<Flag>();
    for (const flag of listed) {
      if (seen.has(flag)) problems.push({ page, message: `${flag} is listed twice in flags:` });
      seen.add(flag);
    }
  }
  return problems;
}

/**
 * Builds the check's expectations from the two tools' sources.
 *
 * Each runner command maps to `cli/runner/<command>.mdx`; `help`, which prints the usage and
 * takes no flag, is not a synopsis line and is added with none. `install.sh` maps to
 * `cli/install-sh.mdx`. A listed flag is stale only when its tool accepts it nowhere — a page
 * may list a shared flag its command also takes, such as `hello`'s `--state-dir`.
 *
 * @param goSource the text of `cmd/ouroboros-runner/main.go`.
 * @param installScript the text of `install.sh`.
 * @returns one expectation per page.
 */
export function expectations(goSource: string, installScript: string): PageExpectation[] {
  const commands = runnerCommandFlags(runnerUsage(goSource));
  if (!commands.has("help")) commands.set("help", []);
  const runnerKnown = new Set([...commands.values()].flat());
  const installer = installerFlags(installerUsage(installScript));

  return [
    ...[...commands].map(([command, flags]) => ({
      page: `cli/runner/${command}.mdx`,
      required: flags,
      known: runnerKnown,
    })),
    { page: "cli/install-sh.mdx", required: installer, known: new Set(installer) },
  ];
}
