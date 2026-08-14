import { ETAG_DIGEST_LENGTH, matchesIfNoneMatch, strongEtag } from "./etag";

/**
 * The tag, and the two ways a conditional request is got wrong.
 *
 * A tag that changes when nothing did costs a payload on every poll; a tag that *does not*
 * change when something did is worse — a dashboard frozen on numbers that have moved, with
 * nothing in the response to say so. Both are properties of the encoding, so both are
 * asserted here without a database.
 */

describe("the entity tag", () => {
  it("is a quoted, strong tag of a fixed length", () => {
    const tag = strongEtag(["a", 1]);

    expect(tag).toMatch(new RegExp(`^"[0-9a-f]{${ETAG_DIGEST_LENGTH}}"$`));
    // Not `W/`: this is a hash of the state the body is derived from, so byte equality is
    // exactly what it claims and claiming less would describe the service as less
    // predictable than it is.
    expect(tag.startsWith("W/")).toBe(false);
  });

  it("gives the same state the same tag", () => {
    expect(strongEtag(["org", "2026-08-13", "3 x"])).toBe(strongEtag(["org", "2026-08-13", "3 x"]));
  });

  it("changes when any part of the state does", () => {
    const base = ["org", "2026-08-13", "3 x"];

    expect(strongEtag(["org2", "2026-08-13", "3 x"])).not.toBe(strongEtag(base));
    expect(strongEtag(["org", "2026-08-14", "3 x"])).not.toBe(strongEtag(base));
    expect(strongEtag(["org", "2026-08-13", "4 x"])).not.toBe(strongEtag(base));
  });

  it("does not confuse one part ending where the next begins", () => {
    // The classic hash-of-a-join bug: `["ab", "c"]` and `["a", "bc"]` are different states
    // and a naïve concatenation gives them one tag. Two workspaces' dashboards would then
    // revalidate into each other's payloads.
    expect(strongEtag(["ab", "c"])).not.toBe(strongEtag(["a", "bc"]));
  });

  it("does not confuse a number with its text, or absence with the word for it", () => {
    expect(strongEtag([1])).not.toBe(strongEtag(["1"]));
    expect(strongEtag([null])).not.toBe(strongEtag(["null"]));
    // A table that was empty and a table holding a row with no timestamp are different
    // states — this is the one the version source can actually produce.
    expect(strongEtag([null])).not.toBe(strongEtag([undefined, undefined]));
  });

  it("distinguishes an instant from any other", () => {
    expect(strongEtag([new Date("2026-08-13T00:00:00.000Z")])).not.toBe(
      strongEtag([new Date("2026-08-13T00:00:00.001Z")]),
    );
  });

  it("depends on the order of the state, not only on its contents", () => {
    expect(strongEtag(["a", "b"])).not.toBe(strongEtag(["b", "a"]));
  });

  it("publishes nothing about the workspace it describes", () => {
    // A tag built by joining row counts and timestamps would tell whoever reads a log or a
    // browser's network panel how many runs a workspace has.
    expect(strongEtag(["acme-robotics", "53 2026-08-13T09:00:00.000Z"])).not.toContain("53");
  });
});

describe("If-None-Match", () => {
  const TAG = '"abc123"';

  it("does not match when the request carried none", () => {
    expect(matchesIfNoneMatch(undefined, TAG)).toBe(false);
    expect(matchesIfNoneMatch("", TAG)).toBe(false);
    expect(matchesIfNoneMatch("   ", TAG)).toBe(false);
  });

  it("matches the same tag", () => {
    expect(matchesIfNoneMatch(TAG, TAG)).toBe(true);
  });

  it("does not match a different one", () => {
    expect(matchesIfNoneMatch('"def456"', TAG)).toBe(false);
  });

  it("matches weakly, which is what RFC 9110 § 8.8.3.2 requires of this header", () => {
    // A proxy that stored a transformed body is allowed to weaken the tag on the way past.
    // Refusing the match would turn its correct behaviour into a full payload every poll.
    expect(matchesIfNoneMatch(`W/${TAG}`, TAG)).toBe(true);
    expect(matchesIfNoneMatch(TAG, `W/${TAG}`)).toBe(true);
  });

  it("matches any entry of a list", () => {
    // A client holding several representations sends them all, and Node folds a repeated
    // header into exactly this shape too.
    expect(matchesIfNoneMatch(`"old", ${TAG}, "older"`, TAG)).toBe(true);
    expect(matchesIfNoneMatch('"old", "older"', TAG)).toBe(false);
  });

  it("matches `*`, which asks for anything but a repeat", () => {
    expect(matchesIfNoneMatch("*", TAG)).toBe(true);
  });

  it("does not match on the digest alone, unquoted", () => {
    // The quotes are part of the tag, and a client sending the bare digest is a client that
    // built the header rather than echoed it. Answering `304` to it would be honouring a
    // header this service never issued.
    expect(matchesIfNoneMatch("abc123", TAG)).toBe(false);
  });
});
