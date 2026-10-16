import {
  SOURCE_TICKET_PREFIX,
  bearerTicket,
  hashSourceTicket,
  mintSourceTicket,
  sourceTicketMatches,
} from "./source-credential.token";

/**
 * The single-use ticket (#991): minted under its prefix, kept as a hash, matched in constant
 * time — the artifact upload token's shape, for the same reasons.
 */

describe("minting", () => {
  it("mints a prefixed ticket in the header-safe alphabet, with its sha-256", () => {
    const { token, hash } = mintSourceTicket();

    expect(token.startsWith(SOURCE_TICKET_PREFIX)).toBe(true);
    expect(token).toMatch(/^[A-Za-z0-9._~-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(hash).toBe(hashSourceTicket(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never mints the same ticket twice", () => {
    expect(mintSourceTicket().token).not.toBe(mintSourceTicket().token);
  });
});

describe("matching", () => {
  const minted = mintSourceTicket();

  it("accepts the ticket the ledger hashed", () => {
    expect(sourceTicketMatches(minted.hash, minted.token)).toBe(true);
  });

  it.each([
    ["another ticket", mintSourceTicket().token],
    ["a prefix of it", minted.token.slice(0, -1)],
    ["nothing", undefined],
    ["the empty string", ""],
  ])("refuses %s", (_label, presented) => {
    expect(sourceTicketMatches(minted.hash, presented)).toBe(false);
  });

  it("refuses when the stored hash is not a sha-256 at all", () => {
    expect(sourceTicketMatches("abc", minted.token)).toBe(false);
  });
});

describe("the bearer header", () => {
  it("reads `Bearer <ticket>` and nothing else", () => {
    expect(bearerTicket("Bearer ouro_src_abc.def-ghi~jkl")).toBe("ouro_src_abc.def-ghi~jkl");
    expect(bearerTicket("Basic dXNlcjpwYXNz")).toBeUndefined();
    expect(bearerTicket("Bearer ")).toBeUndefined();
    expect(bearerTicket("Bearer two words")).toBeUndefined();
    expect(bearerTicket(["Bearer x"])).toBeUndefined();
    expect(bearerTicket(undefined)).toBeUndefined();
  });
});
