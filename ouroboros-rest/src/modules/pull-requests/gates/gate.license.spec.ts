import {
  describeFinding,
  parseExcerpt,
  parseExpression,
  scanLicenses,
  type LicenseFinding,
} from "./gate.license";
import { DEFAULT_LICENSE_ALLOW_LIST, unknownLicenseIds, type LicensePolicy } from "./gate.policy";
import {
  canonicalException,
  canonicalLicense,
  isKnownLicense,
  SPDX_LIST_VERSION,
} from "./gate.spdx";

/**
 * The V7 license layer (AX.2, [#358](https://github.com/NobuData/ouroboros/issues/358)) — SPDX
 * headers on changed files and license resolution in a manifest delta, over the diff sample.
 */

const POLICY: LicensePolicy = { allow: DEFAULT_LICENSE_ALLOW_LIST, deny: [] };

/**
 * A diff sample in `diffExcerptOf`'s shape.
 *
 * @param files - Each file's path and patch.
 * @returns The sample, and the paths.
 */
function sample(files: Record<string, string[]>): { excerpt: string; paths: string[] } {
  return {
    excerpt: Object.entries(files)
      .map(([path, lines]) => [`--- ${path}`, ...lines].join("\n"))
      .join("\n"),
    paths: Object.keys(files),
  };
}

/**
 * Scan a sample with the default policy.
 *
 * @param files - The sample's files.
 * @param policy - The allow-list.
 * @returns The findings.
 */
function findings(files: Record<string, string[]>, policy = POLICY): readonly LicenseFinding[] {
  const { excerpt, paths } = sample(files);

  return scanLicenses(excerpt, paths, policy).findings;
}

describe("the bundled SPDX list", () => {
  it("knows current, deprecated and or-later ids case-insensitively", () => {
    expect(SPDX_LIST_VERSION).toMatch(/^\d+\.\d+/);
    expect(canonicalLicense("mit")).toBe("MIT");
    expect(canonicalLicense("GPL-2.0")).toBe("GPL-2.0");
    expect(canonicalLicense("apache-2.0+")).toBe("Apache-2.0+");
    expect(canonicalLicense("LicenseRef-acme-proprietary")).toBe("LicenseRef-acme-proprietary");
    expect(isKnownLicense("Not-A-License-9")).toBe(false);
    expect(canonicalException("classpath-exception-2.0")).toBe("Classpath-exception-2.0");
  });

  it("holds the default allow-list to ids it knows", () => {
    expect(unknownLicenseIds({ allow: DEFAULT_LICENSE_ALLOW_LIST, deny: [] })).toEqual([]);
    expect(unknownLicenseIds({ allow: ["MIT", "MTI"], deny: ["GLP-3.0"] })).toEqual([
      "MTI",
      "GLP-3.0",
    ]);
  });
});

describe("parseExpression", () => {
  it("binds AND tighter than OR and keeps a WITH on its license", () => {
    expect(parseExpression("MIT OR Apache-2.0 AND BSD-3-Clause")).toEqual({
      op: "or",
      left: { op: "id", id: "MIT" },
      right: {
        op: "and",
        left: { op: "id", id: "Apache-2.0" },
        right: { op: "id", id: "BSD-3-Clause" },
      },
    });
    expect(parseExpression("(GPL-2.0-only WITH Classpath-exception-2.0)")).toEqual({
      op: "id",
      id: "GPL-2.0-only",
    });
  });

  it("refuses what does not parse", () => {
    expect(parseExpression("MIT OR")).toBeUndefined();
    expect(parseExpression("(MIT")).toBeUndefined();
    expect(parseExpression("")).toBeUndefined();
  });
});

describe("parseExcerpt", () => {
  it("splits on the revision's own paths only, so a deleted SQL comment is not a boundary", () => {
    const { excerpt, paths } = sample({
      "db/seed.sql": ["@@ -1,2 +1,1 @@", "--- a comment that was removed", "+select 1;"],
    });
    const files = parseExcerpt(excerpt, paths);

    expect(files).toHaveLength(1);
    expect(files[0].added).toEqual([{ line: 1, text: "select 1;" }]);
  });

  it("numbers added lines from the hunk's new start, counting context", () => {
    const { excerpt, paths } = sample({
      "src/a.c": ["@@ -10,2 +12,3 @@", " int a;", "+int b;", "-int c;", "+int d;"],
    });

    expect(parseExcerpt(excerpt, paths)[0].added).toEqual([
      { line: 13, text: "int b;" },
      { line: 14, text: "int d;" },
    ]);
  });
});

describe("headers", () => {
  it("goes red for a new source file with no SPDX header", () => {
    expect(findings({ "src/new.c": ["@@ -0,0 +1,2 @@", "+#include <x.h>", "+int x;"] })).toEqual([
      { kind: "missing_header", path: "src/new.c" },
    ]);
  });

  it("accepts a new source file whose header is allowed, in any comment style", () => {
    expect(
      findings({
        "src/new.c": ["@@ -0,0 +1,2 @@", "+/* SPDX-License-Identifier: Apache-2.0 */", "+int x;"],
        "tools/gen.py": ["@@ -0,0 +1,1 @@", "+# SPDX-License-Identifier: MIT OR GPL-2.0-only"],
      }),
    ).toEqual([]);
  });

  it("goes red for a disallowed header, and for an id the list does not know", () => {
    expect(
      findings({
        "drivers/x.c": [
          "@@ -1,1 +1,1 @@",
          "-// SPDX-License-Identifier: Apache-2.0",
          "+// SPDX-License-Identifier: GPL-2.0-only",
        ],
        "drivers/y.c": ["@@ -1,1 +1,1 @@", "+// SPDX-License-Identifier: Apachee-2.0"],
      }),
    ).toEqual([
      { kind: "disallowed_header", path: "drivers/x.c", license: "GPL-2.0-only" },
      { kind: "unknown_id", path: "drivers/y.c", license: "Apachee-2.0" },
    ]);
  });

  it("needs every side of an AND, and lets a deny win over an allow", () => {
    expect(
      findings({
        "src/a.c": ["@@ -1,0 +1,1 @@", "+// SPDX-License-Identifier: MIT AND GPL-3.0-only"],
      }),
    ).toHaveLength(1);
    expect(
      findings(
        { "src/a.c": ["@@ -1,0 +1,1 @@", "+// SPDX-License-Identifier: MIT"] },
        { allow: ["MIT"], deny: ["mit"] },
      ),
    ).toHaveLength(1);
  });

  it("does not ask data or docs for a header, and does not judge a modified file's untouched top", () => {
    expect(
      findings({
        "docs/README.md": ["@@ -0,0 +1,1 @@", "+# Title"],
        "boards/x.dts": ["@@ -0,0 +1,1 @@", "+/ { };"],
        "src/old.c": ["@@ -40,1 +40,1 @@", "-a", "+b"],
      }),
    ).toEqual([]);
  });

  it("wants the header within the first lines of a new file", () => {
    const body = Array.from({ length: 12 }, (_, index) => `+line ${String(index)}`);

    expect(
      findings({ "src/late.c": ["@@ -0,0 +1,13 @@", ...body, "+// SPDX-License-Identifier: MIT"] }),
    ).toEqual([{ kind: "missing_header", path: "src/late.c" }]);
  });
});

describe("manifest delta", () => {
  it("goes red for a GPL dependency added to package-lock.json, naming the package", () => {
    expect(
      findings({
        "package-lock.json": [
          "@@ -20,2 +20,7 @@",
          '     "node_modules/left-pad": {',
          '+      "license": "WTFPL"',
          "     },",
          '+    "node_modules/@acme/readline": {',
          '+      "version": "1.0.0",',
          '+      "license": "GPL-3.0-or-later"',
          "+    },",
        ],
      }),
    ).toEqual([
      {
        kind: "disallowed_dependency",
        path: "package-lock.json",
        license: "WTFPL",
        dependency: "left-pad",
      },
      {
        kind: "disallowed_dependency",
        path: "package-lock.json",
        license: "GPL-3.0-or-later",
        dependency: "@acme/readline",
      },
    ]);
  });

  it("ignores a license line that was only context or deleted", () => {
    expect(
      findings({
        "package-lock.json": [
          "@@ -1,3 +1,2 @@",
          '     "node_modules/x": {',
          '       "license": "GPL-3.0-only"',
          '-      "license": "AGPL-3.0-only"',
        ],
      }),
    ).toEqual([]);
  });

  it("reads composer.lock's license arrays, one line or many, as an OR", () => {
    expect(
      findings({
        "composer.lock": [
          "@@ -1,0 +1,8 @@",
          '+            "name": "acme/gpl-lib",',
          '+            "license": ["GPL-3.0-only"],',
          '+            "name": "acme/dual",',
          '+            "license": [',
          '+                "GPL-3.0-only",',
          '+                "MIT"',
          "+            ],",
        ],
      }),
    ).toEqual([
      {
        kind: "disallowed_dependency",
        path: "composer.lock",
        license: "GPL-3.0-only",
        dependency: "acme/gpl-lib",
      },
    ]);
  });

  it("checks a package.json's own license change", () => {
    expect(
      findings({
        "package.json": ["@@ -3,1 +3,1 @@", '-  "license": "MIT",', '+  "license": "SSPL-1.0",'],
      }),
    ).toEqual([
      {
        kind: "disallowed_dependency",
        path: "package.json",
        license: "SSPL-1.0",
        dependency: "the package",
      },
    ]);
  });
});

describe("scanLicenses", () => {
  it("says it checked nothing when there is no diff sample", () => {
    expect(scanLicenses(null, [], POLICY)).toEqual({ checked: false, findings: [] });
    expect(scanLicenses("  ", [], POLICY)).toEqual({ checked: false, findings: [] });
  });

  it("orders findings by path, so the evidence line is the same every time", () => {
    const { excerpt, paths } = sample({
      "z/new.c": ["@@ -0,0 +1,1 @@", "+int z;"],
      "a/new.c": ["@@ -0,0 +1,1 @@", "+int a;"],
    });

    expect(scanLicenses(excerpt, paths, POLICY).findings.map((finding) => finding.path)).toEqual([
      "a/new.c",
      "z/new.c",
    ]);
  });
});

describe("describeFinding", () => {
  it("writes each kind as the evidence line reads it", () => {
    expect(describeFinding({ kind: "missing_header", path: "src/a.c" })).toBe(
      "missing SPDX header in src/a.c",
    );
    expect(describeFinding({ kind: "unknown_id", path: "src/a.c", license: "Foo" })).toBe(
      "unknown SPDX id Foo in src/a.c",
    );
    expect(
      describeFinding({
        kind: "unknown_id",
        path: "package-lock.json",
        license: "Foo",
        dependency: "x",
      }),
    ).toBe("unknown SPDX id Foo via x (package-lock.json)");
    expect(
      describeFinding({ kind: "disallowed_header", path: "src/a.c", license: "GPL-2.0-only" }),
    ).toBe("GPL-2.0-only header in src/a.c is not on the allow-list");
  });
});
