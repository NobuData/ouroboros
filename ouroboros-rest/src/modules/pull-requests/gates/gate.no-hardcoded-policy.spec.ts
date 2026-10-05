import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * BQ.2 ([#481](https://github.com/NobuData/ouroboros/issues/481)), the #358 amendment: the gate
 * engine holds **no** org rule of its own. *"Anything labeled refactor needs a human"* is the
 * published policy's `human_review` rule and nothing else's, so switching the rule off lets a
 * refactor-labelled PR through, and no hard-coded row survives to keep enforcing yesterday's
 * configuration. This is the grep the issue's acceptance criterion asks for, over every
 * production file of the engine and the merge executor.
 */

const PLANES = [__dirname, join(__dirname, "..", "merge")];

/** Every production TypeScript file of the two planes, with its text. */
const SOURCES = PLANES.flatMap((dir) =>
  readdirSync(dir)
    .filter((name) => name.endsWith(".ts") && !/\.(spec|integration-spec|fixture)\.ts$/.test(name))
    .map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") })),
);

/** Code only — comments stripped, so the prose that explains the rule may name it. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("the gate engine and merge executor hold no org rule of their own", () => {
  it("reads the engine and the executor", () => {
    expect(SOURCES.map((source) => source.name)).toEqual(
      expect.arrayContaining(["gate.service.ts", "gate.definitions.ts", "merge.executor.ts"]),
    );
  });

  it.each(SOURCES.map((source) => [source.name, source.text] as const))(
    "%s names no refactor label and no effort threshold in code",
    (_name, text) => {
      const body = code(text);

      expect(body).not.toMatch(/["'`]refactor["'`]/);
      expect(body).not.toMatch(/effort_(gte|lte)\s*:/);
    },
  );
});
