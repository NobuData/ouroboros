import { HELIOS, KEN, RECIPE, currentRow } from "./env-recipes.fixture";
import { envRecipeResource, readCommands } from "./env-recipes.resources";

/** The row mapper and the defensive jsonb read (#420). */

describe("readCommands", () => {
  it("reads the typed array in order, a missing comment as null", () => {
    expect(readCommands([{ command: "a", comment: "one" }, { command: "b" }])).toEqual([
      { command: "a", comment: "one" },
      { command: "b", comment: null },
    ]);
  });

  it.each([null, undefined, "west update", 42, {}])("answers an empty list for %p", (value) => {
    expect(readCommands(value)).toEqual([]);
  });

  it("skips an entry that is not an object with a string command", () => {
    expect(readCommands([{ command: "a" }, "b", { comment: "c" }, { command: 4 }, null])).toEqual([
      { command: "a", comment: null },
    ]);
  });
});

describe("envRecipeResource", () => {
  it("maps the seed's row to the card's recipe, the editor named", () => {
    expect(envRecipeResource(currentRow())).toEqual(RECIPE);
  });

  it("names nobody for a detected draft", () => {
    expect(
      envRecipeResource(currentRow({ source: "detected", updated_by: null, editor_name: null })),
    ).toMatchObject({ repo: HELIOS, source: "detected", updatedBy: null });
  });

  it("falls back to the id when the person's row is gone but the reference is not", () => {
    expect(envRecipeResource(currentRow({ editor_name: null }))).toMatchObject({
      updatedBy: { id: KEN.id, name: KEN.id },
    });
  });
});
