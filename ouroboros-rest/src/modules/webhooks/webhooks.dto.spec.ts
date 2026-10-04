import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { CreateWebhookDto, ListDeliveriesQuery, UpdateWebhookDto } from "./webhooks.dto";

/** The request shapes (#487): what V094/V098 would refuse is refused here first, in a sentence. */

/** The messages a body is refused with. */
function problems<T extends object>(type: new () => T, body: unknown): string[] {
  return validateSync(plainToInstance(type, body) as object).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
}

const VALID = {
  name: "SIEM · Splunk HEC",
  url: "https://siem.acme.dev/services/collector/event",
  eventFamilies: ["audit.*", "run.merged"],
};

describe("creating an endpoint", () => {
  it("accepts a well-formed body", () => {
    expect(problems(CreateWebhookDto, VALID)).toEqual([]);
    expect(problems(CreateWebhookDto, { ...VALID, description: "Splunk", siem: true })).toEqual([]);
  });

  it.each([
    ["http://siem.acme.dev/hook", "an https:// URL"],
    ["https://user:pass@siem.acme.dev/hook", "no user name or password"],
    ["siem.acme.dev", "an https:// URL"],
  ])("refuses the URL %s", (url, message) => {
    expect(problems(CreateWebhookDto, { ...VALID, url }).join(" ")).toContain(message);
  });

  it("refuses an empty, repeated or unregistered-family subscription", () => {
    expect(problems(CreateWebhookDto, { ...VALID, eventFamilies: [] }).join(" ")).toContain(
      "at least one",
    );
    expect(
      problems(CreateWebhookDto, { ...VALID, eventFamilies: ["audit.*", "audit.*"] }).join(" "),
    ).toContain("must not repeat");
    expect(
      problems(CreateWebhookDto, { ...VALID, eventFamilies: ["billing.*"] }).join(" "),
    ).toContain("audit.*, decision.*, run.*, pr.*");
  });

  it("refuses a padded name", () => {
    expect(problems(CreateWebhookDto, { ...VALID, name: " SIEM" })).not.toEqual([]);
  });

  it("has no field a secret could be sent in", () => {
    const dto = plainToInstance(CreateWebhookDto, { ...VALID, secret: "whsec_mine" });

    expect(Object.keys(new CreateWebhookDto())).not.toContain("secret");
    expect(problems(CreateWebhookDto, { ...VALID, secret: "whsec_mine" })).toEqual([]);
    expect(dto).toBeInstanceOf(CreateWebhookDto);
  });
});

describe("editing an endpoint", () => {
  it("accepts an empty edit, and clearing the description with null", () => {
    expect(problems(UpdateWebhookDto, {})).toEqual([]);
    expect(problems(UpdateWebhookDto, { description: null })).toEqual([]);
  });

  it("refuses a null where a value is required", () => {
    expect(problems(UpdateWebhookDto, { name: null })).not.toEqual([]);
    expect(problems(UpdateWebhookDto, { active: null })).not.toEqual([]);
    expect(problems(UpdateWebhookDto, { registryVersion: 0 })).not.toEqual([]);
  });
});

describe("listing deliveries", () => {
  it("filters by a known status only", () => {
    expect(problems(ListDeliveriesQuery, { status: "dead_lettered" })).toEqual([]);
    expect(problems(ListDeliveriesQuery, { status: "lost" })).not.toEqual([]);
  });
});
