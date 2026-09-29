/**
 * The `language` rule pack — the card's first row, `C 92% · Zephyr RTOS 4.1`
 * ([#384](https://github.com/NobuData/ouroboros/issues/384)).
 *
 * The host's languages endpoint gives the percentage; a framework hint is read from the one
 * manifest that names it — `west.yml` for Zephyr (with the revision it pins), `package.json` for
 * the Node frameworks, `pyproject.toml` for the Python ones.
 */

import {
  type PackConclusion,
  type ProbeResults,
  type ProbeSpec,
  type RulePack,
} from "../detection.pack";
import { packageDependencies } from "./pack.helpers";

/** Node frameworks, most specific first — the first dependency present names the framework. */
const NODE_FRAMEWORKS: readonly (readonly [dependency: string, name: string])[] = [
  ["@nestjs/core", "NestJS"],
  ["next", "Next.js"],
  ["nuxt", "Nuxt"],
  ["@angular/core", "Angular"],
  ["svelte", "Svelte"],
  ["vue", "Vue"],
  ["react", "React"],
  ["express", "Express"],
];

/** Python frameworks, matched as a dependency name in `pyproject.toml`. */
const PYTHON_FRAMEWORKS: readonly (readonly [pattern: RegExp, name: string])[] = [
  [/["'\s]django\b/i, "Django"],
  [/["'\s]fastapi\b/i, "FastAPI"],
  [/["'\s]flask\b/i, "Flask"],
];

/** The manifests a hint can come from. */
const HINT_FILES = ["west.yml", "package.json", "pyproject.toml"] as const;

/** A framework hint, and the file that gave it. */
interface FrameworkHint {
  readonly name: string;
  readonly from: string;
}

export const LANGUAGE_PACK: RulePack = {
  key: "language",
  version: "1.0.0",
  rows: ["language"],

  probes(seen: ProbeResults): ProbeSpec[] {
    const paths = seen.paths();

    return [
      { kind: "languages" },
      { kind: "tree" },
      ...HINT_FILES.filter((file) => paths.has(file)).map(
        (path) => ({ kind: "file", path }) as const,
      ),
    ];
  },

  conclude(seen: ProbeResults): PackConclusion {
    const languages = Object.entries(seen.languages() ?? {}).filter(([, bytes]) => bytes > 0);
    const total = languages.reduce((sum, [, bytes]) => sum + bytes, 0);

    if (total === 0) {
      return {
        rows: [
          {
            rowKey: "language",
            verdict: "missing",
            value: "No source code found",
            evidence: { languages: {} },
            confidence: "high",
          },
        ],
      };
    }

    const [top, bytes] = languages.reduce((best, entry) => (entry[1] > best[1] ? entry : best));
    const percent = Math.round((bytes / total) * 100);
    const hint = frameworkHint(seen);

    return {
      rows: [
        {
          rowKey: "language",
          verdict: "ok",
          value: hint === undefined ? `${top} ${percent}%` : `${top} ${percent}% · ${hint.name}`,
          evidence: {
            languages: Object.fromEntries(languages),
            top: { language: top, percent },
            ...(hint === undefined ? {} : { framework: hint }),
          },
          confidence: "high",
        },
      ],
    };
  },
};

/**
 * The framework the manifests name, if any — Zephyr before Node before Python.
 *
 * @param seen - The outcomes.
 * @returns The hint, or undefined.
 */
function frameworkHint(seen: ProbeResults): FrameworkHint | undefined {
  const west = seen.file("west.yml");

  if (west != null) {
    const version = zephyrVersion(west.content);

    return {
      name: version === undefined ? "Zephyr RTOS" : `Zephyr RTOS ${version}`,
      from: "west.yml",
    };
  }

  const dependencies = packageDependencies(seen.file("package.json")?.content);
  const node = NODE_FRAMEWORKS.find(([dependency]) => dependencies.has(dependency));

  if (node !== undefined) {
    return { name: node[1], from: "package.json" };
  }

  const pyproject = seen.file("pyproject.toml")?.content;
  const python = PYTHON_FRAMEWORKS.find(
    ([pattern]) => pyproject !== undefined && pattern.test(pyproject),
  );

  return python === undefined ? undefined : { name: python[1], from: "pyproject.toml" };
}

/**
 * The Zephyr release a `west.yml` pins — `revision: v4.1.0` on the `zephyr` project → `4.1`.
 *
 * @param manifest - `west.yml`'s contents.
 * @returns `major.minor`, or undefined when no `zephyr` project pins a release tag.
 */
export function zephyrVersion(manifest: string): string | undefined {
  const start = manifest.search(/^\s*-\s*name:\s*zephyr\s*$/m);

  if (start === -1) {
    return undefined;
  }

  const rest = manifest.slice(start).split("\n");
  // The project's own lines: up to the next list item, however it is indented.
  const next = rest.findIndex((line, index) => index > 0 && /^\s*-\s/.test(line));
  const block = (next === -1 ? rest : rest.slice(0, next)).join("\n");
  const match = /^\s*revision:\s*["']?v?(\d+)\.(\d+)/m.exec(block);

  return match === null ? undefined : `${match[1]}.${match[2]}`;
}
