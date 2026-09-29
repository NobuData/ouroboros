/**
 * The `conventions` rule pack — the card's warn row, *"No CONTRIBUTING.md — we'll learn your
 * conventions from merged PRs instead."* ([#384](https://github.com/NobuData/ouroboros/issues/384)).
 *
 * Existence checks only, all answered by the tree: a contributing guide, a `CODEOWNERS`, and the
 * files that declare a commit convention. No file is read — whether a guide exists is the
 * question, not what it says.
 */

import type { PackConclusion, ProbeResults, ProbeSpec, RulePack } from "../detection.pack";

/** Where GitHub looks for a guide or an owners file: the root, `.github/`, `docs/`. */
const LOCATIONS = ["", ".github/", "docs/"] as const;

/** A contributing guide, any of the extensions GitHub renders. */
const CONTRIBUTING = /^contributing(\.(md|rst|txt|adoc))?$/i;

/** The files that declare a commit convention, at the root. */
const COMMIT_CONVENTION = [
  /^\.commitlintrc(\.(json|ya?ml|js|cjs|mjs|ts))?$/,
  /^commitlint\.config\.[cm]?[jt]s$/,
  /^\.czrc$/,
  /^\.gitmessage$/,
];

/** The warn line, as the mockup prints it. */
export const NO_CONTRIBUTING =
  "No CONTRIBUTING.md — we'll learn your conventions from merged PRs instead.";

export const CONVENTIONS_PACK: RulePack = {
  key: "conventions",
  version: "1.0.0",
  rows: ["conventions"],

  probes(): ProbeSpec[] {
    return [{ kind: "tree" }];
  },

  conclude(seen: ProbeResults): PackConclusion {
    const paths = [...seen.paths()];

    if (paths.length === 0) {
      return {
        rows: [
          {
            rowKey: "conventions",
            verdict: "missing",
            value: "Empty repository — no conventions to read yet",
            evidence: { contributing: null, codeowners: null, commitConvention: null },
            confidence: "high",
          },
        ],
      };
    }

    const contributing = located(paths, (name) => CONTRIBUTING.test(name));
    const codeowners = located(paths, (name) => name === "CODEOWNERS");
    const commitConvention =
      paths.find((path) => !path.includes("/") && COMMIT_CONVENTION.some((re) => re.test(path))) ??
      null;
    const evidence = { contributing, codeowners, commitConvention };

    if (contributing === null) {
      return {
        rows: [
          {
            rowKey: "conventions",
            verdict: "warn",
            value: NO_CONTRIBUTING,
            evidence,
            confidence: "high",
          },
        ],
      };
    }

    const found = [contributing, codeowners, commitConvention].filter(
      (path): path is string => path !== null,
    );

    return {
      rows: [
        {
          rowKey: "conventions",
          verdict: "ok",
          value: `found ${found.join(" · ")}`,
          evidence,
          confidence: "high",
        },
      ],
    };
  },
};

/**
 * The first path in GitHub's search locations whose file name passes a test.
 *
 * @param paths - The tree's file paths.
 * @param matches - The file-name test.
 * @returns The path, or null.
 */
function located(paths: readonly string[], matches: (name: string) => boolean): string | null {
  for (const location of LOCATIONS) {
    const hit = paths.find(
      (path) =>
        path.startsWith(location) &&
        !path.slice(location.length).includes("/") &&
        matches(path.slice(location.length)),
    );

    if (hit !== undefined) {
      return hit;
    }
  }

  return null;
}
