import { Reflector } from "@nestjs/core";

import type { Organization } from "../../db/schema";
import { REQUIRED_ROLES } from "../../tenancy/roles.guard";
import { POLL_AFTER } from "../../dashboard/dashboard.controller";
import { FarmLogsController } from "./logs.controller";
import type { BuildLogResource } from "./logs.resources";
import type { FarmLogsService } from "./logs.service";

/** The log route (#253): every member reads it, and the polling contract's headers are set. */
describe("the build log route", () => {
  const TENANT = { id: "org-farm" } as Organization;
  const JOB = "5eed0028-0000-4000-8000-000000000479";
  const PAGE: BuildLogResource = {
    jobId: JOB,
    offset: 0,
    nextOffset: 5,
    end: 5,
    bytes: "hello",
    live: true,
    elisions: [],
    tail: null,
    retained: true,
    pollAfter: 2,
  };

  function subject() {
    const logs = {
      read: jest.fn().mockResolvedValue(PAGE),
    } as unknown as jest.Mocked<FarmLogsService>;
    const headers = new Map<string, string>();
    const response = { setHeader: (name: string, value: string) => headers.set(name, value) };
    return { controller: new FarmLogsController(logs), logs, headers, response };
  }

  it("is every member's to read — no role beyond membership", () => {
    expect(new Reflector().get(REQUIRED_ROLES, FarmLogsController.prototype.read)).toBeUndefined();
  });

  it("reads from the start when no offset is given, in the session's workspace", async () => {
    const { controller, logs, response } = subject();

    await controller.read(TENANT, JOB, {}, response);

    expect(logs.read).toHaveBeenCalledWith("org-farm", JOB, 0);
  });

  it("sets the polling contract's headers from the page", async () => {
    const { controller, headers, response } = subject();

    expect(await controller.read(TENANT, JOB, { after: 5 }, response)).toBe(PAGE);
    expect(headers.get("Cache-Control")).toBe("private, no-cache");
    expect(headers.get(POLL_AFTER)).toBe("2");
  });

  it("sets no headers on a refusal", async () => {
    const { controller, logs, headers, response } = subject();
    logs.read.mockRejectedValue(new Error("no such job"));

    await expect(controller.read(TENANT, JOB, {}, response)).rejects.toThrow("no such job");
    expect(headers.size).toBe(0);
  });
});
