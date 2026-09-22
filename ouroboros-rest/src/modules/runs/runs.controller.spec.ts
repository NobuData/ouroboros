import { Readable } from "node:stream";

import { StreamableFile } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { POLL_AFTER } from "../dashboard/dashboard.controller";
import type { ConsoleService } from "./console.service";
import { RunsController } from "./runs.controller";
import type { RunsService } from "./runs.service";
import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import { TENANT_OPTIONAL } from "../tenancy/tenant.decorators";

/**
 * The thinnest layer, held to its decorations, its delegation and its headers — the rules live
 * in `runs.service.spec.ts` and `console.service.spec.ts`, the statements in the two repository
 * specs, and the whole pipeline in the integration suites.
 */

const RUN = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";

/** A response that records the headers a handler sets. */
function recordingResponse(): { headers: Record<string, string>; setHeader: jest.Mock } {
  const headers: Record<string, string> = {};

  return {
    headers,
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value;
    }),
  };
}

const TENANT = {
  id: "acme-robotics-id",
  name: "Acme Robotics",
  slug: "acme-robotics",
  logo: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  metadata: null,
};

describe("the runs controller", () => {
  let service: jest.Mocked<RunsService>;
  let console: jest.Mocked<ConsoleService>;
  let controller: RunsController;
  let reflector: Reflector;

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 }),
    } as unknown as jest.Mocked<RunsService>;

    console = {
      read: jest.fn().mockResolvedValue({ asOf: "2026-08-08T14:12:40.000Z" }),
      events: jest.fn().mockResolvedValue({ entries: [], pollAfter: 5 }),
      exportTranscript: jest.fn().mockResolvedValue({
        filename: "loop-1847.jsonl",
        chunks: Readable.from(["# simulated run\n", '{"seq": 1}\n']),
      }),
    } as unknown as jest.Mocked<ConsoleService>;

    controller = new RunsController(service, console);
    reflector = new Reflector();
  });

  it("hands the listing the workspace and the query, untouched", async () => {
    await controller.list(TENANT, { status: "active", repo: undefined, limit: 10 });

    expect(service.list).toHaveBeenCalledWith("acme-robotics-id", {
      status: "active",
      repo: undefined,
      limit: 10,
    });
  });

  it("hands the console page the workspace and the id, and marks it private", async () => {
    const response = recordingResponse();

    await controller.read(TENANT, { id: RUN }, response);

    // The whole tenant, not only its id: the Guardrails footer names the workspace's slug.
    expect(console.read).toHaveBeenCalledWith(TENANT, RUN);
    expect(response.headers["Cache-Control"]).toBe("private, no-cache");
  });

  it("hands the tail its cursor and sets the polling contract's headers", async () => {
    const response = recordingResponse();

    const page = await controller.events(TENANT, { id: RUN }, { after: 7, limit: 50 }, response);

    expect(console.events).toHaveBeenCalledWith("acme-robotics-id", RUN, { after: 7, limit: 50 });
    expect(response.headers[POLL_AFTER]).toBe(String(page.pollAfter));
    expect(response.headers["Cache-Control"]).toBe("private, no-cache");
  });

  it("sets no header when the read is refused", async () => {
    // Set in the handler rather than by @Header(), so a 404 does not go out claiming a cadence.
    console.events.mockRejectedValue(new Error("run_not_found"));
    const response = recordingResponse();

    await expect(controller.events(TENANT, { id: RUN }, {}, response)).rejects.toThrow();
    expect(response.setHeader).not.toHaveBeenCalled();
  });

  it("streams the export as JSONL, inline, under the run's loop number", async () => {
    const response = recordingResponse();

    const file = await controller.transcript(TENANT, { id: RUN }, response);

    expect(console.exportTranscript).toHaveBeenCalledWith("acme-robotics-id", RUN);
    expect(file).toBeInstanceOf(StreamableFile);
    expect(file.getHeaders()).toEqual({
      type: "application/x-ndjson; charset=utf-8",
      disposition: 'inline; filename="loop-1847.jsonl"',
      length: undefined,
    });
    expect(response.headers["Cache-Control"]).toBe("private, no-cache");

    const chunks: string[] = [];
    for await (const chunk of file.getStream()) chunks.push(String(chunk));
    expect(chunks.join("")).toBe('# simulated run\n{"seq": 1}\n');
  });

  it("requires a workspace, by saying nothing", () => {
    // No @TenantOptional() anywhere: a session acting in no workspace is a 400 before
    // either handler runs, which is what "both under the tenant context" means.
    expect(reflector.get<boolean>(TENANT_OPTIONAL, RunsController)).toBeUndefined();
    expect(reflector.get<boolean>(TENANT_OPTIONAL, controller.list)).toBeUndefined();
    expect(reflector.get<boolean>(TENANT_OPTIONAL, controller.read)).toBeUndefined();
    expect(reflector.get<boolean>(TENANT_OPTIONAL, controller.events)).toBeUndefined();
    expect(reflector.get<boolean>(TENANT_OPTIONAL, controller.transcript)).toBeUndefined();
  });

  it("names no roles, because reading runs is every member's", () => {
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.list)).toBeUndefined();
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.read)).toBeUndefined();
    // The console's three reads are member-readable, the export included (#304).
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.events)).toBeUndefined();
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.transcript)).toBeUndefined();
  });

  it("offers no writes", () => {
    // The read-model's writer is the ingestion bridge (#91); a POST here would be a second
    // write path to rows the engine owns.
    expect(controller).not.toHaveProperty("create");
    expect(controller).not.toHaveProperty("update");
    expect(controller).not.toHaveProperty("remove");
  });
});
