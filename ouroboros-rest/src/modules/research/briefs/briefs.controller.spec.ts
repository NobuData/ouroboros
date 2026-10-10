import { RequestMethod, StreamableFile } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import type { Organization } from "../../db/schema";
import { REQUIRED_ROLES } from "../../tenancy/roles.guard";
import { BriefsController } from "./briefs.controller";
import { InvestigationParams } from "./briefs.dto";
import type { BriefsService } from "./briefs.service";
import { INVESTIGATION } from "./rs127.fixture";

/**
 * The routes (CM.2, #621): three reads, open to every member, in the session's workspace.
 */

const TENANT = { id: "org-acme" } as Organization;

const handler = (name: keyof BriefsController): object =>
  Object.getOwnPropertyDescriptor(BriefsController.prototype, name)!.value as object;

/** Drain a streamed file. */
async function text(file: StreamableFile): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of file.getStream()) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString("utf8");
}

describe("the briefs controller", () => {
  it("serves /research/investigations/:investigationId/{brief,sources,brief/export}", () => {
    expect(Reflect.getMetadata(PATH_METADATA, BriefsController)).toBe(
      "research/investigations/:investigationId",
    );
    expect(
      (["brief", "sources", "export"] as const).map((name): unknown[] => [
        Reflect.getMetadata(METHOD_METADATA, handler(name)) as unknown,
        Reflect.getMetadata(PATH_METADATA, handler(name)) as unknown,
      ]),
    ).toEqual([
      [RequestMethod.GET, "brief"],
      [RequestMethod.GET, "sources"],
      [RequestMethod.GET, "brief/export"],
    ]);
  });

  it("leaves every read to every member", () => {
    for (const name of ["brief", "sources", "export"] as const) {
      expect(Reflect.getMetadata(REQUIRED_ROLES, handler(name))).toBeUndefined();
    }
  });

  it("hands the session's workspace and the investigation to the service", async () => {
    const service = {
      brief: jest.fn().mockResolvedValue({ brief: { version: 1 } }),
      sources: jest.fn().mockResolvedValue({ total: 44 }),
    };
    const controller = new BriefsController(service as unknown as BriefsService);
    const params = { investigationId: INVESTIGATION };

    expect(await controller.brief(TENANT, params)).toEqual({ brief: { version: 1 } });
    expect(await controller.sources(TENANT, params)).toEqual({ total: 44 });
    expect(service.brief).toHaveBeenCalledWith("org-acme", INVESTIGATION);
    expect(service.sources).toHaveBeenCalledWith("org-acme", INVESTIGATION);
  });

  it("serves the export as a Markdown attachment named for the investigation, uncached", async () => {
    const service = {
      export: jest
        .fn()
        .mockResolvedValue({ filename: "RS-127-brief.md", markdown: "# RS-127 — docking ±\n" }),
    };
    const controller = new BriefsController(service as unknown as BriefsService);
    const response = { setHeader: jest.fn() };

    const file = await controller.export(TENANT, { investigationId: INVESTIGATION }, response);

    expect(file).toBeInstanceOf(StreamableFile);
    expect(file.getHeaders()).toMatchObject({
      type: "text/markdown; charset=utf-8",
      disposition: 'attachment; filename="RS-127-brief.md"',
    });
    expect(await text(file)).toBe("# RS-127 — docking ±\n");
    expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-cache");
    expect(service.export).toHaveBeenCalledWith("org-acme", INVESTIGATION);
  });
});

describe("the investigation parameter", () => {
  it("is a UUID", async () => {
    const failures = async (investigationId: unknown): Promise<number> =>
      (await validate(plainToInstance(InvestigationParams, { investigationId }))).length;

    expect(await failures(INVESTIGATION)).toBe(0);
    expect(await failures("RS-127")).toBe(1);
    expect(await failures(undefined)).toBe(1);
  });
});
