import { decodeCursor, encodeCursor } from "./audit-plane.cursor";

/** The keyset cursor (#486): opaque, microsecond-exact, and refused when foreign. */
describe("the audit plane's cursor", () => {
  const CURSOR = { at: "2026-10-05T14:31:07.123456Z", id: "5eed0074-0000-4000-8000-000000000001" };

  it("round-trips a position exactly — microseconds included", () => {
    expect(decodeCursor(encodeCursor(CURSOR))).toEqual(CURSOR);
  });

  it("is opaque base64url", () => {
    expect(encodeCursor(CURSOR)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ["not base64 json", "!!!"],
    ["a JSON scalar", Buffer.from("7").toString("base64url")],
    ["null", Buffer.from("null").toString("base64url")],
    ["a millisecond instant", encodeCursor({ ...CURSOR, at: "2026-10-05T14:31:07.123Z" })],
    ["a non-uuid id", encodeCursor({ ...CURSOR, id: "1; drop table" })],
    ["a missing id", Buffer.from(JSON.stringify({ at: CURSOR.at })).toString("base64url")],
  ])("refuses %s", (_label, token) => {
    expect(decodeCursor(token)).toBeUndefined();
  });
});
