/**
 * The `devcontainer` rule pack — `found .devcontainer.json → image …`
 * ([#384](https://github.com/NobuData/ouroboros/issues/384), decision **O2** option 2-A).
 *
 * Detection sees that a devcontainer exists and parses, and summarises its image and features.
 * It does **not** build it: the mockup's `env ready in 38s (snapshotted)` is something the farm
 * measures (BD.4), so this row is always `detected` and says only what the file says.
 */

import type { PackConclusion, ProbeResults, ProbeSpec, RulePack } from "../detection.pack";
import { basename, clampValue, parseJsonc, recordOf } from "./pack.helpers";

/** Where a devcontainer lives, in the order the spec resolves them. */
export const DEVCONTAINER_FILES = [
  ".devcontainer.json",
  ".devcontainer/devcontainer.json",
] as const;

export const DEVCONTAINER_PACK: RulePack = {
  key: "devcontainer",
  version: "1.0.0",
  rows: ["devcontainer"],

  probes(seen: ProbeResults): ProbeSpec[] {
    const file = present(seen);

    return [
      { kind: "tree" },
      ...(file === undefined ? [] : [{ kind: "file", path: file } as const]),
    ];
  },

  conclude(seen: ProbeResults): PackConclusion {
    const file = present(seen);

    if (file === undefined) {
      return {
        rows: [
          {
            rowKey: "devcontainer",
            verdict: "missing",
            value: "No devcontainer found",
            evidence: { checked: DEVCONTAINER_FILES },
            confidence: "high",
          },
        ],
      };
    }

    const parsed = parseJsonc(seen.file(file)?.content ?? "");

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {
        rows: [
          {
            rowKey: "devcontainer",
            verdict: "warn",
            value: `found ${file}, but it does not parse`,
            evidence: { hit: file, parsed: false },
            confidence: "high",
          },
        ],
      };
    }

    const summary = summarise(recordOf(parsed));
    const found =
      summary.environment === undefined
        ? `found ${file}`
        : `found ${file} → ${summary.environment}`;
    const features =
      summary.features.length === 0 ? "" : ` · features: ${summary.features.join(", ")}`;

    return {
      rows: [
        {
          rowKey: "devcontainer",
          verdict: "ok",
          value: clampValue(found + features),
          evidence: { hit: file, parsed: true, ...summary },
          confidence: "high",
        },
      ],
    };
  },
};

/**
 * The devcontainer the tree holds, if any.
 *
 * @param seen - The outcomes.
 * @returns Its path, or undefined.
 */
function present(seen: ProbeResults): string | undefined {
  const paths = seen.paths();

  return DEVCONTAINER_FILES.find((file) => paths.has(file));
}

/**
 * What the file says about the environment — an image, a Dockerfile or a compose file — and the
 * short names of its features.
 *
 * @param config - The parsed file.
 * @returns The summary.
 */
function summarise(config: Record<string, unknown>): {
  environment: string | undefined;
  features: string[];
} {
  const build = recordOf(config.build);
  const compose = config.dockerComposeFile;
  let environment: string | undefined;

  if (typeof config.image === "string") {
    environment = `image ${config.image}`;
  } else if (typeof build.dockerfile === "string") {
    environment = `Dockerfile ${build.dockerfile}`;
  } else if (typeof compose === "string" || Array.isArray(compose)) {
    environment = "docker compose";
  }

  // `ghcr.io/devcontainers/features/python:1` → `python`.
  const features = Object.keys(recordOf(config.features)).map(
    (feature) => basename(feature).split(":")[0] ?? feature,
  );

  return { environment, features };
}
