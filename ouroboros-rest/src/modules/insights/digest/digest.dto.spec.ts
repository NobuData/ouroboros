import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { PatchDigestScheduleDto, PutDigestSubscriptionDto } from "./digest.dto";

/** The properties a body is refused for. */
async function refusalsOf<T extends object>(dto: new () => T, body: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(dto, body));

  return errors.map((error) => error.property);
}

describe("the subscription body", () => {
  it.each([true, false])("accepts subscribed: %s", async (subscribed) => {
    await expect(refusalsOf(PutDigestSubscriptionDto, { subscribed })).resolves.toEqual([]);
  });

  it.each([{}, { subscribed: "true" }, { subscribed: 1 }, { subscribed: null }])(
    "refuses %j, naming the field",
    async (body) => {
      await expect(refusalsOf(PutDigestSubscriptionDto, body)).resolves.toEqual(["subscribed"]);
    },
  );
});

describe("the schedule patch", () => {
  it.each([
    {},
    { weeklyDay: 1 },
    { weeklyDay: 7 },
    { weeklyTime: "00:00" },
    { weeklyTime: "23:59" },
    { weeklyDay: 5, weeklyTime: "16:30" },
  ])("accepts %j", async (body) => {
    await expect(refusalsOf(PatchDigestScheduleDto, body)).resolves.toEqual([]);
  });

  it.each([
    [{ weeklyDay: 0 }, "weeklyDay"],
    [{ weeklyDay: 8 }, "weeklyDay"],
    [{ weeklyDay: 1.5 }, "weeklyDay"],
    [{ weeklyDay: "1" }, "weeklyDay"],
    [{ weeklyDay: null }, "weeklyDay"],
    [{ weeklyTime: "9:00" }, "weeklyTime"],
    [{ weeklyTime: "24:00" }, "weeklyTime"],
    [{ weeklyTime: "09:60" }, "weeklyTime"],
    [{ weeklyTime: "09:00:00" }, "weeklyTime"],
    [{ weeklyTime: 900 }, "weeklyTime"],
    [{ weeklyTime: null }, "weeklyTime"],
  ])("refuses %j, naming %s", async (body, property) => {
    await expect(refusalsOf(PatchDigestScheduleDto, body)).resolves.toEqual([property]);
  });
});
