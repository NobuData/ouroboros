/**
 * The `protected_paths` rule pack — `boot/, keys/ suggested`
 * ([#384](https://github.com/NobuData/ouroboros/issues/384)).
 *
 * **The one row that writes.** Its suggestions are handed back as globs, and the detection service
 * stores them as `suggested` rows of `protected_path_policies` (#380) — which AP.3's
 * `allowed_paths` check reads, so a change touching one fails. A person edits them from there, and
 * an `edited` row is never overwritten by a re-scan.
 *
 * Heuristics over directory names in the tree: bootloaders, key and secret material, and
 * infrastructure definitions — the places where an agent's change is the most expensive mistake.
 */

import type { PackConclusion, ProbeResults, ProbeSpec, RulePack } from "../detection.pack";
import { basename, depth, ownDirs } from "./pack.helpers";

/** The heuristics: directory names, and why each is worth protecting. */
export const PROTECTED_DIRECTORIES: readonly (readonly [names: readonly string[], why: string])[] =
  [
    [["boot", "bootloader", "mcuboot"], "bootloader"],
    [["keys", "secrets", "certs", "certificates"], "key and secret material"],
    [["infra", "terraform"], "infrastructure"],
  ];

/** How deep a directory may sit and still be suggested — `boot/` and `src/boot/`, not deeper. */
export const MAX_PROTECTED_DEPTH = 2;

/** The most suggestions one scan writes. */
export const MAX_SUGGESTIONS = 10;

export const PROTECTED_PATHS_PACK: RulePack = {
  key: "protected_paths",
  version: "1.0.0",
  rows: ["protected_paths"],

  probes(): ProbeSpec[] {
    return [{ kind: "tree" }];
  },

  conclude(seen: ProbeResults): PackConclusion {
    const matches = ownDirs(seen.tree()?.entries ?? [])
      .filter((dir) => depth(dir) <= MAX_PROTECTED_DEPTH)
      .flatMap((dir) => {
        const rule = PROTECTED_DIRECTORIES.find(([names]) =>
          names.includes(basename(dir).toLowerCase()),
        );

        return rule === undefined ? [] : [{ dir, why: rule[1] }];
      })
      .slice(0, MAX_SUGGESTIONS);

    if (matches.length === 0) {
      return {
        rows: [
          {
            rowKey: "protected_paths",
            verdict: "missing",
            value: "No protected paths suggested",
            evidence: { suggested: [] },
            confidence: "medium",
          },
        ],
        protectedPaths: [],
      };
    }

    return {
      rows: [
        {
          rowKey: "protected_paths",
          verdict: "ok",
          value: `${matches.map(({ dir }) => `${dir}/`).join(", ")} suggested`,
          evidence: { suggested: matches.map(({ dir, why }) => ({ glob: `${dir}/**`, why })) },
          confidence: "medium",
        },
      ],
      protectedPaths: matches.map(({ dir }) => `${dir}/**`),
    };
  },
};
