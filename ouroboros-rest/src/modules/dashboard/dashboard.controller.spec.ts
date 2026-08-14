import { Reflector } from "@nestjs/core";

import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import { TENANT_OPTIONAL } from "../tenancy/tenant.decorators";
import {
  CACHE_CONTROL,
  DashboardController,
  ETAG,
  type ConditionalResponse,
} from "./dashboard.controller";
import type { DashboardService } from "./dashboard.service";
import { dashboardWindows } from "./windows";

/**
 * The conditional request, which is the whole of what this handler decides.
 *
 * Everything else about the route is a decoration — no workspace in the path, no roles — and
 * the numbers are the service's. What only a spec here can hold is the exchange: the tag on
 * both answers, no body on a `304`, and the version read *before* the payload so that a poll
 * which changes nothing does not pay for one.
 */

const WORKSPACE = { id: "acme-robotics-id", slug: "acme-robotics" };
const TAG = '"abc123"';
const PAYLOAD = { stats: {} } as never;

/** A response that writes down what was written to it. */
function recordingResponse(): ConditionalResponse & {
  headers: Record<string, string>;
  statusCode?: number;
  body?: unknown;
  ended: boolean;
} {
  const written = {
    headers: {} as Record<string, string>,
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    ended: false,
    setHeader(name: string, value: string) {
      written.headers[name] = value;
    },
    status(code: number) {
      written.statusCode = code;
      return {
        end: () => (written.ended = true),
        json: (body: unknown) => (written.body = body),
      };
    },
  };

  return written;
}

describe("the dashboard controller", () => {
  let service: jest.Mocked<DashboardService>;
  let controller: DashboardController;

  beforeEach(() => {
    service = {
      windows: jest.fn().mockReturnValue(dashboardWindows(new Date("2026-08-13T14:37:41.532Z"))),
      etag: jest.fn().mockResolvedValue(TAG),
      read: jest.fn().mockResolvedValue(PAYLOAD),
    } as unknown as jest.Mocked<DashboardService>;

    controller = new DashboardController(service);
  });

  it("answers a first request with the payload and its tag", async () => {
    const response = recordingResponse();

    await controller.read(WORKSPACE as never, {}, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(PAYLOAD);
    expect(response.headers[ETAG]).toBe(TAG);
  });

  it("answers a request that already holds the tag with 304 and no body at all", async () => {
    const response = recordingResponse();

    await controller.read(WORKSPACE as never, { headers: { "if-none-match": TAG } }, response);

    expect(response.statusCode).toBe(304);
    expect(response.ended).toBe(true);
    expect(response.body).toBeUndefined();
    // The tag travels on the `304` too: it is how a client learns that what it holds is
    // still current rather than merely unrefused.
    expect(response.headers[ETAG]).toBe(TAG);
  });

  it("does not read the payload at all when it answers 304", async () => {
    // The point of the whole exchange. A handler that assembled the payload and then threw
    // it away would save the bytes and none of the cost.
    await controller.read(
      WORKSPACE as never,
      { headers: { "if-none-match": TAG } },
      recordingResponse(),
    );

    expect(service.etag).toHaveBeenCalledTimes(1);
    expect(service.read).not.toHaveBeenCalled();
  });

  it("sends the payload when the tag the caller holds is a different one", async () => {
    const response = recordingResponse();

    await controller.read(
      WORKSPACE as never,
      { headers: { "if-none-match": '"stale"' } },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(service.read).toHaveBeenCalled();
  });

  it("reads the clock once and measures the tag and the body against the same moment", async () => {
    const response = recordingResponse();

    await controller.read(WORKSPACE as never, {}, response);

    const windows = service.windows.mock.results[0].value as unknown;
    expect(service.windows).toHaveBeenCalledTimes(1);
    expect(service.etag).toHaveBeenCalledWith(WORKSPACE.id, windows);
    expect(service.read).toHaveBeenCalledWith(WORKSPACE.id, windows);
  });

  it("takes the workspace from the tenant context and from nowhere else", async () => {
    // There is no `{orgId}` in the path and no workspace in the body: a dashboard that took
    // one from a client is one where reading somebody else's numbers is a matter of typing.
    await controller.read(WORKSPACE as never, {}, recordingResponse());

    expect(service.etag).toHaveBeenCalledWith(WORKSPACE.id, expect.anything());
    expect(service.read).toHaveBeenCalledWith(WORKSPACE.id, expect.anything());
  });

  it("tells a browser to revalidate rather than reuse, and no shared cache to store", async () => {
    const response = recordingResponse();

    await controller.read(WORKSPACE as never, {}, response);

    expect(response.headers["Cache-Control"]).toBe(CACHE_CONTROL);
    expect(CACHE_CONTROL).toContain("private");
    expect(CACHE_CONTROL).toContain("no-cache");
  });

  it("ignores a header the adapter did not give it as a string", async () => {
    // Node folds a repeated header into one comma-separated value, so an array here means
    // something unusual happened; a full payload is the safe reading of it.
    const response = recordingResponse();

    await controller.read(WORKSPACE as never, { headers: { "if-none-match": [TAG] } }, response);

    expect(response.statusCode).toBe(200);
  });

  it("requires a workspace, unlike the two routes that do not", () => {
    // The polarity `tenant.decorators.ts` states: every authenticated route is scoped unless
    // it says otherwise, and this one has nothing to say — which is what makes the tenant
    // guard resolve the session's active organization before the handler runs.
    expect(new Reflector().get<boolean>(TENANT_OPTIONAL, DashboardController)).toBeUndefined();
  });

  it("names no role, because every member may look at the dashboard", () => {
    // Reading the numbers is not an administrative act. The one write on this page — the
    // auto-merge switch — is #74's, and that is where a role gate belongs.
    expect(new Reflector().get<string[]>(REQUIRED_ROLES, controller.read)).toBeUndefined();
  });

  it("writes no tag onto an answer it could not assemble", async () => {
    // A `500` carrying an `ETag` is a tag a client would send back and be answered `304` on,
    // for a representation it never received — a dashboard frozen for as long as nothing
    // else changes.
    (service.read as jest.Mock).mockRejectedValue(new Error("the database said no"));
    const response = recordingResponse();

    await expect(controller.read(WORKSPACE as never, {}, response)).rejects.toThrow(
      "the database said no",
    );

    expect(response.headers[ETAG]).toBeUndefined();
    expect(response.statusCode).toBeUndefined();
  });

  it("offers one handler, and it reads", () => {
    // Enumerated rather than sampled: the dashboard writes nothing at all — the auto-merge
    // switch it reports is #74's to change — so a second handler appearing here should be a
    // decision somebody makes on purpose. `freshness` is a private helper, not a route.
    expect(Object.getOwnPropertyNames(DashboardController.prototype)).toEqual([
      "constructor",
      "read",
      "freshness",
    ]);
  });
});
