import { Readable } from "node:stream";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import type { Organization } from "../db/schema";
import { ArtifactParams, ResultsController } from "./results.controller";
import type { ArtifactDownload, ResultsService } from "./results.service";

/** The routes' own work (#333): parameters, and the download's headers. The reads are the service's. */

const TENANT = { id: "org-1" } as Organization;

describe("ResultsController", () => {
  it("streams a download with its type, disposition, length and safety headers", async () => {
    const download: ArtifactDownload = {
      body: Readable.from([Buffer.from("boot ok\n")]),
      sizeBytes: 8,
      presentation: {
        contentType: "text/plain; charset=utf-8",
        disposition: "inline",
        contentDisposition:
          "inline; filename=\"serial-console.log\"; filename*=UTF-8''serial-console.log",
      },
    };
    const service = { download: jest.fn().mockResolvedValue(download) };
    const headers: Record<string, string> = {};
    const controller = new ResultsController(service as unknown as ResultsService);

    const file = await controller.download(
      TENANT,
      { id: "5eed0038-0000-4000-8000-000000048233" },
      { setHeader: (name, value) => (headers[name] = value) },
    );

    expect(service.download).toHaveBeenCalledWith("org-1", "5eed0038-0000-4000-8000-000000048233");
    expect(file.getHeaders()).toEqual({
      type: "text/plain; charset=utf-8",
      disposition: download.presentation.contentDisposition,
      length: 8,
    });
    expect(file.getStream()).toBe(download.body);
    expect(headers).toEqual({
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cache-Control": "private, no-cache",
    });
  });

  it("sends no header when the download is refused", async () => {
    const service = { download: jest.fn().mockRejectedValue(new Error("refused")) };
    const setHeader = jest.fn();
    const controller = new ResultsController(service as unknown as ResultsService);

    await expect(controller.download(TENANT, { id: "x" }, { setHeader })).rejects.toThrow(
      "refused",
    );
    expect(setHeader).not.toHaveBeenCalled();
  });

  it("passes the reads through with the session's workspace", async () => {
    const service = {
      timeline: jest.fn().mockResolvedValue("timeline"),
      page: jest.fn().mockResolvedValue("page"),
      failure: jest.fn().mockResolvedValue("failure"),
    };
    const controller = new ResultsController(service as unknown as ResultsService);

    expect(await controller.timeline(TENANT, { id: "run" })).toBe("timeline");
    expect(await controller.page(TENANT, { id: "attempt" })).toBe("page");
    expect(await controller.failure(TENANT, { id: "attempt", caseId: "case" })).toBe("failure");
    expect(service.timeline).toHaveBeenCalledWith("org-1", "run");
    expect(service.page).toHaveBeenCalledWith("org-1", "attempt");
    expect(service.failure).toHaveBeenCalledWith("org-1", "attempt", "case");
  });

  it("takes only a uuid as an artifact id", async () => {
    expect(
      await validate(
        plainToInstance(ArtifactParams, { id: "5eed0038-0000-4000-8000-000000048233" }),
      ),
    ).toHaveLength(0);
    expect(await validate(plainToInstance(ArtifactParams, { id: "../etc/passwd" }))).toHaveLength(
      1,
    );
  });
});
