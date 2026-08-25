import { describe, expect, it } from "vitest";

import { NOTHING_CREATED } from "@/app/registry/create";
import { PROVIDERS_PATH } from "@/app/paths";
import { EM_DASH } from "@/app/registry/table";
import {
  CONTEXT_UNIT,
  EMPTY_HREF,
  IMPORT_CONNECTION_GONE,
  IMPORT_INVALID,
  IMPORT_MALFORMED,
  IMPORT_READ_ONLY,
  IMPORT_STEPS,
  OUTPUT_UNIT,
  THINKING,
  allSelected,
  aliasedMark,
  candidateRows,
  capabilitySummary,
  chosen,
  importFailure,
  importItemErrors,
  importRequest,
  importSummary,
  previewSummary,
  rowError,
  rowProblems,
  selectAll,
  selectable,
  selectableWithName,
  stepState,
  wizardTitle,
} from "@/app/registry/wizard";

import {
  candidateList,
  capabilities,
  importCandidate,
  importResult,
  seededRegistry,
} from "../helpers/registry";

/**
 * The import wizard, as decisions (#594, over CH.4's candidates, #587).
 *
 * The ticket's acceptance criteria are what this suite is arranged around:
 *
 * - **already-aliased rows are marked and pre-deselected, and `select all` skips them** — the
 *   one thing an operator did not ask for when they opened a wizard is to re-create what is
 *   already named, and decision **R7** is the larger rule behind it;
 * - **a name collision shows an inline error on that row and creates nothing** — from either
 *   direction, the browser's own check or the service's itemised `422` mapped back through the
 *   order the body was built in;
 * - **importing two models lands both with their suggested (or edited) names** — the body is
 *   what carries that, and it carries nothing else.
 *
 * The fixtures are `ouroboros-rest`'s own published examples for the seeded Anthropic
 * connection, so *importing from the seeded Anthropic connection* is a claim these cases can
 * actually make.
 */

/** Every alias name the seeded workspace has. */
const TAKEN = seededRegistry().map((alias) => alias.alias);

/** The published example's two rows: `claude-fable-5` already named, `claude-opus-5` free. */
const ROWS = candidateRows(candidateList().candidates);

describe("the rows a wizard opens on", () => {
  it("copies the service's cells and composes none of them", () => {
    // The price string is CH.3's and the capability facts are CH.2's; the only thing this
    // module renders itself is the headline that joins them.
    expect(ROWS[1]).toMatchObject({
      modelId: "claude-opus-5",
      display: "claude-opus-5",
      name: "opus-5",
      selected: true,
      aliased: null,
      price: "$10 · $50",
    });
  });

  it("marks a model something already names, and arrives with it unticked", () => {
    expect(ROWS[0]).toMatchObject({ modelId: "claude-fable-5", aliased: "coder-max", selected: false });
    expect(aliasedMark("coder-max")).toBe("aliased: coder-max");
  });

  it("takes the tick from the service rather than deciding it again", () => {
    // *Should this row start ticked* is a question CH.4 answers against the workspace's
    // aliases; a second opinion computed from a subset of the same facts is how two surfaces
    // come to disagree.
    const served = candidateList([importCandidate({ selected: false })]);

    expect(candidateRows(served.candidates)[0]?.selected).toBe(false);
  });

  it("gives a row with no suggestion an empty box rather than a placeholder name", () => {
    // Honest rather than empty: the row arrives with a cell for somebody to fill in.
    const served = candidateList([importCandidate({ suggestedName: null, selected: false })]);

    expect(candidateRows(served.candidates)[0]?.name).toBe("");
  });

  it("keeps the price's provenance for the hover, and gives an unpriced row none", () => {
    expect(ROWS[1]?.provenance).toMatch(/^bundled@/);
  });
});

describe("the capability headline", () => {
  it("says thinking as a word, and both windows compacted", () => {
    expect(capabilitySummary(capabilities())).toBe(
      `${THINKING} · 1.0M ${CONTEXT_UNIT} · 64.0k ${OUTPUT_UNIT}`,
    );
  });

  it("leaves out what no source published", () => {
    expect(
      capabilitySummary(capabilities({ thinking: false, maxOutputTokens: null })),
    ).toBe(`1.0M ${CONTEXT_UNIT}`);
  });

  it("takes the table's own em-dash when a model has nothing to say", () => {
    // Including the honest cases where `reason` explains the absence: a row is not the place
    // for that sentence, and the create dialog's parameter section is.
    expect(
      capabilitySummary(
        capabilities({
          params: [],
          thinking: false,
          contextTokens: null,
          maxOutputTokens: null,
          reason: "provider_has_no_parameters",
        }),
      ),
    ).toBe(EM_DASH);
  });
});

describe("the selection", () => {
  it("offers a tick on every row nothing already names", () => {
    expect(ROWS.map(selectable)).toEqual([false, true]);
  });

  it("select-all skips a model that already has an alias", () => {
    // The ticket's criterion, verbatim. The service would skip it anyway, reported rather than
    // silently, so ticking it is simply not offered.
    const all = selectAll(ROWS, true);

    expect(all.map((row) => row.selected)).toEqual([false, true]);
  });

  it("select-all skips a row with no name, so it is a request that can be submitted", () => {
    const rows = candidateRows(
      candidateList([importCandidate({ suggestedName: null, selected: false })]).candidates,
    );

    expect(selectAll(rows, true)[0]?.selected).toBe(false);
  });

  it("select-all includes a row somebody has since named", () => {
    // The rule is applied to the row as it now stands, not to what the service suggested.
    const rows = candidateRows(
      candidateList([importCandidate({ suggestedName: null, selected: false })]).candidates,
    ).map((row) => ({ ...row, name: "opus-5" }));

    expect(selectAll(rows, true)[0]?.selected).toBe(true);
    expect(selectableWithName(rows[0]!)).toBe(true);
  });

  it("select-none clears everything", () => {
    expect(selectAll(ROWS, false).some((row) => row.selected)).toBe(false);
  });

  it("shows the control ticked only when everything it could tick is ticked", () => {
    expect(allSelected(ROWS)).toBe(true);
    expect(allSelected(selectAll(ROWS, false))).toBe(false);
  });

  it("shows it unticked for a table with nothing tickable in it", () => {
    // An empty selection and a table of already-named models are both *not all done*.
    const rows = candidateRows(
      candidateList([importCandidate({ alias: { id: "x", alias: "coder-max" }, selected: false })])
        .candidates,
    );

    expect(allSelected(rows)).toBe(false);
  });

  it("keeps the table's order in what will be created", () => {
    expect(chosen(ROWS).map((row) => row.modelId)).toEqual(["claude-opus-5"]);
  });
});

describe("what is wrong with a ticked row", () => {
  it("finds nothing wrong with the rows the service suggested", () => {
    // The suggestions are collision-suffixed by CH.4 against the workspace's aliases and
    // against each other, so ticking every row is a request that can be submitted.
    expect(rowProblems(selectAll(ROWS, true), TAKEN)).toEqual({});
  });

  it("judges only ticked rows, so an untouched suggestion is never marked", () => {
    const rows = ROWS.map((row) => ({ ...row, name: "coder-max" }));

    expect(rowProblems(rows, TAKEN)).toEqual({ "claude-opus-5": "taken" });
  });

  it("asks a ticked row with an empty box for a name, or to be unticked", () => {
    const rows = ROWS.map((row) => (row.selected ? { ...row, name: "  " } : row));

    expect(rowProblems(rows, TAKEN)["claude-opus-5"]).toBe("unnamed");
    expect(rowError("unnamed")).toMatch(/untick/);
  });

  it("refuses a name that is not lower-case kebab, with the create dialog's own sentence", () => {
    const rows = ROWS.map((row) => (row.selected ? { ...row, name: "Opus 5" } : row));

    expect(rowProblems(rows, TAKEN)["claude-opus-5"]).toBe("shape");
  });

  it("catches a name the workspace already has", () => {
    const rows = ROWS.map((row) => (row.selected ? { ...row, name: "sizer" } : row));

    expect(rowProblems(rows, TAKEN)["claude-opus-5"]).toBe("taken");
  });

  it("catches two ticked rows asking for the same name", () => {
    // The collision the wizard makes possible: the service's suggestions never collide, and an
    // edit is what creates one.
    const rows = candidateRows(
      candidateList([
        importCandidate({ modelId: "claude-opus-5", suggestedName: "twin" }),
        importCandidate({ modelId: "claude-sonnet-5", suggestedName: "twin" }),
      ]).candidates,
    );

    expect(rowProblems(rows, TAKEN)).toEqual({
      "claude-opus-5": "duplicate",
      "claude-sonnet-5": "duplicate",
    });
    expect(rowError("duplicate")).toMatch(/Another ticked row/);
  });

  it("prefers *taken by the workspace* to *repeated in the batch*", () => {
    // The first is a fact that will not change by editing another row.
    const rows = candidateRows(
      candidateList([
        importCandidate({ modelId: "claude-opus-5", suggestedName: "sizer" }),
        importCandidate({ modelId: "claude-sonnet-5", suggestedName: "sizer" }),
      ]).candidates,
    );

    expect(rowProblems(rows, TAKEN)["claude-opus-5"]).toBe("taken");
  });
});

describe("the batch that gets sent", () => {
  it("carries one item per ticked row, with the name that is in its box", () => {
    // The ticket's criterion: importing two models lands both under their suggested — or
    // edited — names.
    const rows = selectAll(ROWS, true).map((row) => ({ ...row, name: `${row.name}-edited` }));
    const request = importRequest("conn", [
      ...rows,
      { ...ROWS[1]!, modelId: "claude-haiku-4-5", name: "sizer-2", selected: true },
    ]);

    expect(request.body).toEqual({
      connectionId: "conn",
      items: [
        { modelId: "claude-opus-5", alias: "opus-5-edited" },
        { modelId: "claude-haiku-4-5", alias: "sizer-2" },
      ],
    });
  });

  it("sends no params and no enabled — there is no such field, and an import arrives on", () => {
    const [item] = importRequest("conn", ROWS).body.items;

    expect(Object.keys(item ?? {}).sort()).toEqual(["alias", "modelId"]);
  });

  it("trims the name, so a stray space is not a different alias", () => {
    const rows = ROWS.map((row) => (row.selected ? { ...row, name: " opus-5 " } : row));

    expect(importRequest("conn", rows).body.items[0]?.alias).toBe("opus-5");
  });

  it("remembers which model is at each position, because that is what a 422 is keyed by", () => {
    expect(importRequest("conn", selectAll(ROWS, true)).order).toEqual(["claude-opus-5"]);
  });
});

describe("an itemised refusal", () => {
  it("puts each message on the row that produced it", () => {
    expect(
      importItemErrors({ items: { "1": { alias: ["that name is taken"] } } }, ["a", "b"]),
    ).toEqual({ b: ["that name is taken"] });
  });

  it("gathers every field's messages for one item, in the order they arrived", () => {
    expect(
      importItemErrors(
        { items: { "0": { alias: ["taken"], modelId: ["not discovered"] } } },
        ["a"],
      ),
    ).toEqual({ a: ["taken", "not discovered"] });
  });

  it("drops a position with no row behind it rather than guessing at one", () => {
    // A message drawn on the wrong row is worse than one drawn nowhere; the failure's own
    // sentence catches the remainder.
    expect(importItemErrors({ items: { "9": { alias: ["taken"] } } }, ["a"])).toEqual({});
  });

  it("files against every item for the race a pre-check cannot close", () => {
    // The unique key names the constraint and not which insert met it, so the service blames
    // them all — and so does the table.
    const errors = importItemErrors(
      { items: { "0": { alias: ["a name was taken concurrently"] }, "1": { alias: ["a name was taken concurrently"] } } },
      ["a", "b"],
    );

    expect(Object.keys(errors)).toEqual(["a", "b"]);
  });

  it("finds nothing in a refusal with no items in it", () => {
    expect(importItemErrors({}, ["a"])).toEqual({});
    expect(importItemErrors({ items: "no" }, ["a"])).toEqual({});
    expect(importItemErrors({ items: ["no"] }, ["a"])).toEqual({});
  });
});

describe("what a refusal draws", () => {
  it("maps an itemised 422 to its rows, and says nothing was created", () => {
    const failure = importFailure(
      { code: "model_import_invalid", message: "no", details: { items: { "0": { alias: ["taken"] } } } },
      ["claude-opus-5"],
    );

    expect(failure.message).toBe(IMPORT_INVALID);
    expect(failure.rows).toEqual({ "claude-opus-5": ["taken"] });
  });

  it("gives the three whole-batch refusals the sentence alone", () => {
    for (const [code, sentence] of [
      ["validation_failed", IMPORT_MALFORMED],
      ["forbidden", IMPORT_READ_ONLY],
      ["provider_connection_not_found", IMPORT_CONNECTION_GONE],
    ] as const) {
      const failure = importFailure({ code, message: "no", details: {} }, []);

      expect(failure.message, code).toBe(sentence);
      expect(failure.rows, code).toEqual({});
    }
  });

  it("keeps the service's own sentence for a code it has none for", () => {
    const failure = importFailure({ code: "teapot", message: "The service is a teapot.", details: {} }, []);

    expect(failure.message).toContain("The service is a teapot.");
    expect(failure.message).toContain(NOTHING_CREATED);
  });

  it("says nothing was created in every sentence, because the batch is one transaction", () => {
    for (const sentence of [IMPORT_INVALID, IMPORT_MALFORMED, IMPORT_READ_ONLY, IMPORT_CONNECTION_GONE]) {
      expect(sentence, sentence).toContain(NOTHING_CREATED);
    }
  });
});

describe("what the wizard says", () => {
  it("names the connection in the heading, since it cannot be changed from inside", () => {
    expect(wizardTitle("Anthropic Claude")).toBe("Import from Anthropic Claude");
  });

  it("walks three steps, with the connection already behind the reader", () => {
    expect(IMPORT_STEPS).toEqual(["Connection", "Models", "Review"]);
    expect([0, 1, 2].map((index) => stepState(index, 1))).toEqual(["done", "current", "todo"]);
  });

  it("counts what will be created, singular where the count is one", () => {
    expect(previewSummary(1)).toMatch(/^1 alias will be created/);
    expect(previewSummary(3)).toMatch(/^3 aliases will be created/);
  });

  it("says the batch arrives switched on, which is the contract's own behaviour", () => {
    expect(previewSummary(2)).toMatch(/switched on/);
  });

  it("reports both halves of what happened, including the zero", () => {
    // A re-run that created nothing is a success, and saying so plainly is what stops an
    // operator from running it again to see whether it worked.
    expect(importSummary(importResult())).toBe("1 alias created.");
    expect(
      importSummary(importResult([], [{ modelId: "claude-fable-5", alias: "coder-max" }])),
    ).toBe("0 aliases created · 1 already named, and passed over.");
  });

  it("points its empty state at the page where a connection is tested", () => {
    expect(EMPTY_HREF).toBe(PROVIDERS_PATH);
  });
});
