import { describe, expect, it } from "vitest";

import { analyzerOrigin, analyzerQuery } from "@/app/analyzer/analyzer-origin";
import { analyzerUrl } from "@/app/analyzer/analyzer-poll";

/**
 * The one data origin the analyzer page reads (#2022): the dashboard's choice, with `all` read as
 * live, because an analysis never mixes origins.
 */

const HELIOS = "acme-robotics/helios-firmware";

describe("the analyzer's origin", () => {
  it.each(["live", "simulated", "seeded"] as const)(
    "reads %s as itself",
    (origin) => {
      expect(analyzerOrigin(origin)).toBe(origin);
    },
  );

  it.each([["all"], [null], [undefined], [""], ["demo"]])(
    "reads %s as live",
    (filter) => {
      expect(analyzerOrigin(filter)).toBe("live");
    },
  );
});

describe("the service's query", () => {
  it("leaves a live origin out, so a live read asks what it always asked", () => {
    expect(analyzerQuery(HELIOS)).toEqual({ repo: HELIOS });
    expect(analyzerQuery(HELIOS, "live")).toEqual({ repo: HELIOS });
  });

  it("names any other origin", () => {
    expect(analyzerQuery(HELIOS, "seeded")).toEqual({
      repo: HELIOS,
      origin: "seeded",
    });
  });
});

describe("the poll's address", () => {
  it("carries a non-live origin and nothing for live", () => {
    expect(analyzerUrl(HELIOS, "live")).toBe(
      "/api/analyzer?repo=acme-robotics%2Fhelios-firmware",
    );
    expect(analyzerUrl(HELIOS, "seeded")).toBe(
      "/api/analyzer?repo=acme-robotics%2Fhelios-firmware&origin=seeded",
    );
  });
});
