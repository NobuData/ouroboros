import { describe, expect, it } from "vitest";

import { ROLES } from "@/app/api/membership";
import {
  CATALOG_READ,
  DEGRADED_HEADLINE,
  EMPTY_MEMBER_NOTE,
  EMPTY_NOTE,
  EMPTY_TITLE,
  READ_ONLY_BODY,
  SOURCES_FAILED_HEADLINE,
  degradedReads,
  degradedReason,
  readOnlyNote,
  sourcesState,
} from "@/app/sources/states";

import { readings } from "../helpers/sources";

/**
 * The page's states ([#141](https://github.com/NobuData/ouroboros/issues/141)): decided from
 * the listing alone, with the catalog as a second question.
 */

describe("the page's state", () => {
  it("is populated when the listing answered at least one source", () => {
    expect(sourcesState(readings())).toEqual({ kind: "populated" });
  });

  it("is empty when the listing answered none — a guidance, not a failure", () => {
    expect(sourcesState(readings({ sources: { ok: true, value: [] } }))).toEqual({ kind: "empty" });
  });

  it("is failed, with the service's sentence, when the listing was refused", () => {
    expect(sourcesState(readings({ sources: { ok: false, reason: "Boom." } }))).toEqual({
      kind: "failed",
      reason: "Boom.",
    });
  });

  it("is decided by the listing alone: a failed catalog does not fail the page", () => {
    expect(sourcesState(readings({ catalog: { ok: false, reason: "no" } }))).toEqual({
      kind: "populated",
    });
  });
});

describe("the degraded reads", () => {
  it("names the catalog when it failed, and nothing when it did not", () => {
    expect(degradedReads(readings())).toEqual([]);
    expect(degradedReads(readings({ catalog: { ok: false, reason: "no" } }))).toEqual([
      { what: CATALOG_READ, reason: "no" },
    ]);
  });

  it("leaves the per-source statuses out, because each row explains its own", () => {
    const statuses = new Map([["x", { ok: false as const, reason: "no" }]]);

    expect(degradedReads(readings({ statuses }))).toEqual([]);
  });

  it("composes one sentence per failed read", () => {
    expect(degradedReason([{ what: CATALOG_READ, reason: "no" }])).toBe(`${CATALOG_READ}: no`);
    expect(degradedReason([])).toBe("");
  });
});

describe("the copy", () => {
  it("guides an empty workspace rather than blanking it", () => {
    expect(EMPTY_TITLE).toBe("Connect your first ticket source");
    expect(EMPTY_NOTE).toContain("GitHub");
    expect(EMPTY_MEMBER_NOTE).toContain("owners and admins");
  });

  it("names the state in the banners' headlines", () => {
    expect(SOURCES_FAILED_HEADLINE).toContain("could not be read");
    expect(DEGRADED_HEADLINE).toContain("could not be read");
  });

  it("names the reader's role once, with the right article, for every role", () => {
    for (const role of ROLES) {
      const note = readOnlyNote(role);

      expect(note.head).toMatch(new RegExp(`^Viewing ticket sources as an? ${role}\\.$`));
      expect(note.body).toBe(READ_ONLY_BODY);
    }

    expect(readOnlyNote("admin").head).toContain("as an admin");
    expect(readOnlyNote("member").head).toContain("as a member");
  });
});
