import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { MAX_LOG_OFFSET, ReadLogQuery } from "./logs.dto";

/** `?after=` (#253): a whole, non-negative offset within V040's largest log, or nothing. */
describe("the log query", () => {
  function read(query: Record<string, unknown>) {
    const value = plainToInstance(ReadLogQuery, query);
    return { value, failures: validateSync(value).map((error) => error.property) };
  }

  it("is optional", () => {
    expect(read({}).failures).toEqual([]);
  });

  it("reads a query-string offset as a number", () => {
    expect(read({ after: "18122" })).toEqual({ value: { after: 18122 }, failures: [] });
  });

  it.each(["abc", "-1", "1.5", String(MAX_LOG_OFFSET + 1)])("refuses %s", (after) => {
    expect(read({ after }).failures).toEqual(["after"]);
  });
});
