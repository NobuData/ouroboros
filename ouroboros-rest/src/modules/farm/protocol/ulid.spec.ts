import { newPrefixedId, newUlid, uuidOf, wireId, ULID_PATTERN } from "./ulid";

describe("the protocol's ids", () => {
  describe("newUlid", () => {
    it("mints 26 Crockford characters whose first ten are the millisecond", () => {
      const id = newUlid(Date.UTC(2026, 8, 18, 12));

      expect(id).toMatch(ULID_PATTERN);
      expect(newUlid(Date.UTC(2026, 8, 18, 12) + 1).slice(0, 10) > id.slice(0, 10)).toBe(true);
    });

    it("is strictly increasing within one millisecond", () => {
      const at = Date.UTC(2026, 8, 18, 12, 0, 1);
      const ids = Array.from({ length: 50 }, () => newUlid(at));

      expect([...ids].sort()).toEqual(ids);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("sorts by time across milliseconds", () => {
      const earlier = newUlid(1_000);
      const later = newUlid(2_000);

      expect(later > earlier).toBe(true);
    });

    it("prefixes a compound id", () => {
      expect(newPrefixedId("sess")).toMatch(/^sess_[0-9A-HJKMNP-TV-Z]{26}$/);
    });
  });

  describe("wireId and uuidOf", () => {
    const uuid = "7f000002-0000-4000-8000-000000000001";

    it("re-spells a UUID as a protocol id and back, losslessly", () => {
      const id = wireId("rnr", uuid);

      expect(id).toMatch(/^rnr_[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(uuidOf("rnr", id)).toBe(uuid);
    });

    it("accepts a UUID in either case and answers lowercase", () => {
      const upper = "9E7BD403-4C1F-4B2A-8D8E-0F5C7A9B3D1E";

      expect(uuidOf("job", wireId("job", upper))).toBe(upper.toLowerCase());
    });

    it("round-trips the extremes", () => {
      for (const extreme of [
        "00000000-0000-0000-0000-000000000000",
        "ffffffff-ffff-ffff-ffff-ffffffffffff",
      ]) {
        expect(uuidOf("job", wireId("job", extreme))).toBe(extreme);
      }
    });

    it("answers undefined for a well-formed id that encodes more than 128 bits", () => {
      // A first character above 7 sets one of the two bits a UUID does not have.
      expect(uuidOf("job", "job_8ZZZZZZZZZZZZZZZZZZZZZZZZZ")).toBeUndefined();
      expect(uuidOf("job", "job_7ZZZZZZZZZZZZZZZZZZZZZZZZZ")).toBe(
        "ffffffff-ffff-ffff-ffff-ffffffffffff",
      );
    });

    it("answers undefined for the wrong prefix or shape", () => {
      const id = wireId("job", uuid);

      expect(uuidOf("rnr", id)).toBeUndefined();
      expect(uuidOf("job", "job_short")).toBeUndefined();
      expect(uuidOf("job", "job_01KE7J4EZ3204KQXMHJRPQPWQI")).toBeUndefined();
    });

    it("refuses to spell something that is not a UUID", () => {
      expect(() => wireId("rnr", "not-a-uuid")).toThrow(TypeError);
    });
  });
});
