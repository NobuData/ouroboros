import { DIGEST_GRACE_MS, dueDigestSlot, latestDailySlot, nextDigestSlot } from "./digest.schedule";

const at = (iso: string) => new Date(iso);

describe("the daily digest's schedule (#463)", () => {
  describe("latestDailySlot", () => {
    it("is today's slot once it has passed", () => {
      expect(latestDailySlot(at("2026-10-04T09:30:00Z"), "09:00")).toEqual(
        at("2026-10-04T09:00:00Z"),
      );
    });

    it("is today's slot at the very minute", () => {
      expect(latestDailySlot(at("2026-10-04T09:00:00Z"), "09:00")).toEqual(
        at("2026-10-04T09:00:00Z"),
      );
    });

    it("is yesterday's before today's has come", () => {
      expect(latestDailySlot(at("2026-10-04T08:59:59Z"), "09:00")).toEqual(
        at("2026-10-03T09:00:00Z"),
      );
    });

    it.each(["9:00", "24:00", "09:60", "", "09:00:00"])("refuses %p", (time) => {
      expect(() => latestDailySlot(at("2026-10-04T09:00:00Z"), time)).toThrow(RangeError);
    });
  });

  describe("dueDigestSlot", () => {
    it("is due at the slot when nothing was ever sent", () => {
      expect(dueDigestSlot(at("2026-10-04T09:00:30Z"), "09:00", undefined)).toEqual(
        at("2026-10-04T09:00:00Z"),
      );
    });

    it("is not due again once that slot was sent", () => {
      expect(
        dueDigestSlot(at("2026-10-04T09:05:00Z"), "09:00", at("2026-10-04T09:00:00Z")),
      ).toBeUndefined();
    });

    it("is still due a few hours late, after a process was down across the slot", () => {
      expect(dueDigestSlot(at("2026-10-04T14:00:00Z"), "09:00", undefined)).toEqual(
        at("2026-10-04T09:00:00Z"),
      );
    });

    it("is stale past the grace", () => {
      const late = new Date(at("2026-10-04T09:00:00Z").getTime() + DIGEST_GRACE_MS + 1);

      expect(dueDigestSlot(late, "09:00", undefined)).toBeUndefined();
    });

    it("does not send twice in a day when the time is moved after the day's digest left", () => {
      expect(
        dueDigestSlot(at("2026-10-04T10:00:30Z"), "10:00", at("2026-10-04T09:00:00Z")),
      ).toBeUndefined();
    });

    it("sends the next day at the new time", () => {
      expect(
        dueDigestSlot(at("2026-10-05T10:00:30Z"), "10:00", at("2026-10-04T09:00:00Z")),
      ).toEqual(at("2026-10-05T10:00:00Z"));
    });
  });

  describe("nextDigestSlot", () => {
    it("is later today before the slot", () => {
      expect(nextDigestSlot(at("2026-10-04T08:00:00Z"), "09:00", undefined)).toEqual(
        at("2026-10-04T09:00:00Z"),
      );
    });

    it("is the due slot while it is due", () => {
      expect(nextDigestSlot(at("2026-10-04T09:30:00Z"), "09:00", undefined)).toEqual(
        at("2026-10-04T09:00:00Z"),
      );
    });

    it("is tomorrow once today's was sent", () => {
      expect(
        nextDigestSlot(at("2026-10-04T09:30:00Z"), "09:00", at("2026-10-04T09:00:00Z")),
      ).toEqual(at("2026-10-05T09:00:00Z"));
    });

    it("moves when the time changes — the acceptance criterion", () => {
      const now = at("2026-10-04T07:00:00Z");

      expect(nextDigestSlot(now, "09:00", undefined)).toEqual(at("2026-10-04T09:00:00Z"));
      expect(nextDigestSlot(now, "08:15", undefined)).toEqual(at("2026-10-04T08:15:00Z"));
    });

    it("skips a slot the gap forbids", () => {
      // Sent at 22:00 yesterday; moved to 06:00 — 8 h later is inside the 20 h gap.
      expect(
        nextDigestSlot(at("2026-10-04T05:00:00Z"), "06:00", at("2026-10-03T22:00:00Z")),
      ).toEqual(at("2026-10-05T06:00:00Z"));
    });
  });
});
