/**
 * Mockup 05's listing, against what the printer really writes — U.4
 * ([#168](https://github.com/NobuData/ouroboros/issues/168)).
 *
 * The listing in `docs/mockups/05-workflow-code.html` is the design, and
 * `schemas/workflow-dsl/fixtures/code/standard-fix.loop.ts` is the parity fixture U.1 committed
 * against it. The fixture is the real print of the seeded `standard-fix`, because the mockup's 32
 * lines can't be printed from that document without losing most of it (`WORKFLOW_CODE_DSL.md` §10).
 * This suite keeps the two honest with each other in CI:
 *
 * * **The fixture is byte-exact.** The seed's `standard-fix` v14, the draft the code view opens,
 *   prints exactly the committed file. A printer change that doesn't update the fixture fails the
 *   build, and the diff a reviewer then reads is the code view's own.
 * * **§10 accounts for every line of the mockup.** Each non-blank line is either printed verbatim,
 *   and those appear in the fixture in the mockup's order, or is one §10 records as printed
 *   differently. An edit to the mockup's listing, or a printer change that loses one of its verbatim
 *   lines, fails here until §10 says what happened.
 *
 * `code.printer.spec.ts` holds every valid fixture to its own golden file. This file is about the
 * one the design is drawn from.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { printWorkflowCode } from "./code.printer";
import { validDocument } from "./code.recover.fixture";
import { FIXTURES_DIR } from "./dsl.golden.fixture";
import { seededDocuments } from "./dsl.seed.fixture";

/** The design the code view is drawn from. */
const MOCKUP_PATH = resolve(__dirname, "../../../../docs/mockups/05-workflow-code.html");

/** The parity fixture: the seeded `standard-fix`, as the code view shows it. */
const PARITY_FIXTURE_PATH = join(FIXTURES_DIR, "code", "standard-fix.loop.ts");

/**
 * The mockup's lines §10 records as printed byte for byte: the `defineLoop` line, the trigger,
 * `stages: [`, the call's close, and the round-trip comment's first line.
 */
const VERBATIM = [4, 5, 6, 7, 8, 9, 26, 27, 29];

/**
 * The lines §10 records as printed differently: both imports, the stage calls from `analyze` to
 * `openPr`, and the round-trip comment's last two lines.
 */
const DIFFERING = [1, 2, ...Array.from({ length: 16 }, (_, index) => 10 + index), 30, 31];

/** One row of the mockup's listing: its number and its highlighted text. */
const LISTING_ROW =
  /^<div class="ln[^"]*"><span class="no">(\d+)<\/span><span class="tx">(.*)<\/span><\/div>$/;

/** The entities the listing uses. A blank row holds a lone `&nbsp;`, which is an empty line. */
const ENTITIES: Readonly<Record<string, string>> = {
  "&nbsp;": "",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&amp;": "&",
};

/**
 * The mockup's code listing, as the text it shows.
 *
 * @returns One string per numbered row, from row 1 to the last row numbered in sequence, with the
 *   highlighting markup removed and entities decoded.
 */
function mockupListing(): string[] {
  const listing: string[] = [];

  for (const row of readFileSync(MOCKUP_PATH, "utf8").split("\n")) {
    const match = LISTING_ROW.exec(row);
    if (match === null) continue;
    if (Number(match[1]) !== listing.length + 1) break;

    listing.push(
      match[2]
        .replace(/<[^>]*>/g, "")
        .replace(/&(?:nbsp|lt|gt|quot|#39|amp);/g, (entity) => ENTITIES[entity]),
    );
  }

  return listing;
}

describe("the parity fixture", () => {
  it("is what the seeded standard-fix v14 prints, byte for byte", () => {
    const document = validDocument(seededDocuments("standard_fix_v14")[0]);

    expect(printWorkflowCode("standard-fix", document).text).toBe(
      readFileSync(PARITY_FIXTURE_PATH, "utf8"),
    );
  });
});

describe("mockup 05's listing, line by line against WORKFLOW_CODE_DSL.md §10", () => {
  const listing = mockupListing();
  const fixture = readFileSync(PARITY_FIXTURE_PATH, "utf8").split("\n");

  it("is the 32 lines §10 was written against", () => {
    expect(listing).toHaveLength(32);
  });

  it("has every non-blank line recorded as either verbatim or differing", () => {
    const nonBlank = listing.flatMap((line, index) => (line === "" ? [] : [index + 1]));

    expect(nonBlank).toEqual([...VERBATIM, ...DIFFERING].sort((a, b) => a - b));
  });

  it("finds every verbatim line in the fixture, in the mockup's order", () => {
    let searchFrom = 0;

    for (const row of VERBATIM) {
      const text = listing[row - 1];
      const at = fixture.indexOf(text, searchFrom);

      expect({ row, text, printed: at !== -1 }).toEqual({ row, text, printed: true });
      searchFrom = at + 1;
    }
  });
});
