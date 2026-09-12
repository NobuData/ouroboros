import { NO_DRAFT, draftEtag, ifMatchAdmits, type DraftIdentity } from "./draft.etag";

/**
 * The conflict guard, at the level where it is decidable: what an etag is a function of, and
 * what an `If-Match` header is allowed to mean.
 *
 * The integration suite is where two real requests race; this is where the two properties that
 * make that race decidable are asserted — **the etag moves when the document does**, and it
 * does *not* move for anything else.
 */

const AT = new Date("2026-09-12T10:00:00.000Z");

/** A draft, with whatever a test changes about it. */
function draft(overrides: Partial<DraftIdentity> = {}): DraftIdentity {
  return {
    id: "7c2f5a19-1b34-4c8d-9e07-5a6b3c2d1e0f",
    updated_at: AT,
    definition: { dsl_version: "1.0", nodes: [] },
    ...overrides,
  };
}

describe("draftEtag", () => {
  it("is the same token for the same draft, read twice", () => {
    expect(draftEtag(draft())).toBe(draftEtag(draft()));
  });

  it("moves when the document changes", () => {
    // The property the whole guard rests on: a save that changed the canvas invalidates every
    // etag handed out before it.
    expect(draftEtag(draft({ definition: { dsl_version: "1.0", nodes: [{ id: "a" }] } }))).not.toBe(
      draftEtag(draft()),
    );
  });

  it("moves within the same millisecond, because the stamp is not what it is made of", () => {
    // `updated_at` reaches this service as a `Date`, whose resolution is a millisecond. Two
    // autosaves that close together would share a stamp — and, if the stamp were the etag,
    // would share an etag, which is one edit silently lost.
    const first = draft({ definition: { nodes: [1] } });
    const second = draft({ definition: { nodes: [2] } });

    expect(first.updated_at).toEqual(second.updated_at);
    expect(draftEtag(first)).not.toBe(draftEtag(second));
  });

  it("distinguishes a re-created draft holding the same document", () => {
    expect(draftEtag(draft({ id: "0b1c2d3e-4f50-4a6b-8c9d-0e1f2a3b4c5d" }))).not.toBe(
      draftEtag(draft()),
    );
  });

  it("gives the empty slot an etag of its own", () => {
    // So that a client's first write is the same three lines as its hundredth.
    expect(draftEtag(undefined)).toBe(NO_DRAFT);
    expect(draftEtag(draft())).not.toBe(NO_DRAFT);
  });

  it("is a hex digest, and reveals nothing about the document", () => {
    expect(draftEtag(draft())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("ifMatchAdmits", () => {
  const current = draftEtag(draft());

  it.each([
    ["the token as this API publishes it", current],
    ["the token quoted, as RFC 9110 writes one", `"${current}"`],
    ["a weak tag, whose weakness means nothing here", `W/"${current}"`],
    ["one of several", `"deadbeef", ${current}`],
    ["surrounding whitespace", `  ${current}  `],
    ["the wildcard", "*"],
  ])("admits %s", (_name, header) => {
    expect(ifMatchAdmits(header, current)).toBe(true);
  });

  it.each([
    ["a token from an earlier read", draftEtag(draft({ definition: {} }))],
    ["the empty-slot token when a draft exists", NO_DRAFT],
    ["the empty string", ""],
    ["a quoted token that is not this one", '"deadbeef"'],
  ])("refuses %s", (_name, header) => {
    expect(ifMatchAdmits(header, current)).toBe(false);
  });

  it("refuses an absent header, which the caller answers differently", () => {
    // Forgetting the guard and losing a race are different mistakes: the service turns this
    // into `workflow_draft_etag_required`, not into a conflict.
    expect(ifMatchAdmits(undefined, current)).toBe(false);
  });

  it("admits the empty-slot token exactly when there is no draft", () => {
    expect(ifMatchAdmits(NO_DRAFT, NO_DRAFT)).toBe(true);
    expect(ifMatchAdmits(current, NO_DRAFT)).toBe(false);
  });
});
