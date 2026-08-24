import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { fieldMessages } from "../errors/validation";
import { MAX_MODEL_ID_LENGTH, MODEL_ID_MESSAGE, ParamSchemaQuery } from "./params.dto";

/**
 * What the query may contain, and the one rule between its two parameters: `model` is required
 * and `connection` is not, because an unbound alias is a state mockup 21 draws rather than a
 * malformed request.
 *
 * The pipe is configured once in `errors/validation.ts` and its behaviour is that file's to
 * prove; this asserts the decorators, which is what the pipe reads.
 */

/** The complaints about one query, keyed the way a `422`'s `details` keys them. */
function complaints(query: Record<string, unknown>): Record<string, string[]> {
  return fieldMessages(
    validateSync(plainToInstance(ParamSchemaQuery, query), {
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
}

describe("ParamSchemaQuery", () => {
  it("accepts a model on a connection", () => {
    expect(
      complaints({ connection: "9c4a5f6e-7d8c-4b10-8f43-5a6b7c8d9e01", model: "claude-fable-5" }),
    ).toEqual({});
  });

  it("accepts a model with no connection — the unbound question", () => {
    expect(complaints({ model: "gpt-5.2-preview" })).toEqual({});
  });

  it("requires a model even when there is no connection", () => {
    // `gpt5-experiments` has a model id and no provider, so the question is still well formed —
    // but only because it names a model. Without one there is nothing to ask about.
    expect(Object.keys(complaints({}))).toEqual(["model"]);
  });

  it("takes the vendor's own spelling, unfolded", () => {
    // Vendors disagree about case and punctuation, and a pattern tighter than the column's
    // would refuse a model this workspace has an alias for.
    for (const model of ["qwen3-coder:32b", "openai/gpt-oss-120b", "Claude-Fable-5", "gpt-5.2"]) {
      expect(complaints({ model })).toEqual({});
    }
  });

  it("refuses a model that is blank or padded", () => {
    // A shape no lookup could match: the column stores the identifier exactly as sent, so a
    // padded one asked about a model no connection lists.
    for (const model of ["", " ", " claude-fable-5", "claude-fable-5 "]) {
      expect(complaints({ model })).toEqual({ model: [MODEL_ID_MESSAGE] });
    }
  });

  it("refuses a model longer than the columns will hold", () => {
    // Bounded at the edge rather than after two index lookups that could not have matched.
    expect(complaints({ model: "m".repeat(MAX_MODEL_ID_LENGTH + 1) })).toEqual({
      model: [`model must be at most ${MAX_MODEL_ID_LENGTH} characters`],
    });
    expect(complaints({ model: "m".repeat(MAX_MODEL_ID_LENGTH) })).toEqual({});
  });

  it("refuses a connection that is not a uuid", () => {
    // Checked here so a caller that sent a display name is told which field was wrong, rather
    // than being answered `404` for a connection that does exist under another spelling.
    expect(complaints({ connection: "Anthropic", model: "claude-fable-5" })).toEqual({
      connection: ["connection must be the uuid of a provider connection"],
    });
  });

  it("refuses a parameter nobody declared", () => {
    // `forbidNonWhitelisted` is on globally, and this is what it stops: a client believing a
    // `?tier=priority` it invented is being honoured.
    expect(Object.keys(complaints({ model: "claude-fable-5", tier: "priority" }))).toEqual([
      "tier",
    ]);
  });
});
