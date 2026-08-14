import { Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { AppConfigService } from "../config/config.service";
import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import { TENANT_OPTIONAL } from "../tenancy/tenant.decorators";
import {
  CACHE_CONTROL,
  DashboardController,
  ETAG,
  POLL_AFTER,
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

/** The interval the configuration under test hands out, distinct from the default. */
const POLL_SECONDS = 15;

/**
 * A configuration stub carrying only what this controller reads.
 *
 * @param dashboardPollSeconds - What `OURO_DASHBOARD_POLL_SECONDS` is set to.
 * @returns Enough of an `AppConfigService` for the handler.
 */
function configWith(dashboardPollSeconds: number): AppConfigService {
  return { dashboardPollSeconds } as AppConfigService;
}

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

    controller = new DashboardController(service, configWith(POLL_SECONDS));
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

  it("hints when to poll again, on the answer that carries data", async () => {
    const response = recordingResponse();

    await controller.read(WORKSPACE as never, {}, response);

    expect(response.headers[POLL_AFTER]).toBe(String(POLL_SECONDS));
  });

  it("hints when to poll again on a 304 too, which is the answer a backed-off server sends most", async () => {
    const response = recordingResponse();

    await controller.read(WORKSPACE as never, { headers: { "if-none-match": TAG } }, response);

    expect(response.statusCode).toBe(304);
    expect(response.headers[POLL_AFTER]).toBe(String(POLL_SECONDS));
  });

  it("answers with whatever interval the deployment is configured for", async () => {
    // The whole mechanism for slowing clients under load: the operator raises
    // OURO_DASHBOARD_POLL_SECONDS, and every poller hears the new cadence on its next
    // answer. The value is the configuration's, not a constant of this controller's.
    const slowed = new DashboardController(service, configWith(45));
    const response = recordingResponse();

    await slowed.read(WORKSPACE as never, {}, response);

    expect(response.headers[POLL_AFTER]).toBe("45");
  });

  it("writes down that a 304 read the version and nothing else", async () => {
    // #75's acceptance criterion — the fast path serializes no rows, *verified by
    // logging*. The line is written on the branch that returns before `read` is called,
    // so asserting the two together is asserting the criterion itself.
    const debug = jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);

    try {
      await controller.read(
        WORKSPACE as never,
        { headers: { "if-none-match": TAG } },
        recordingResponse(),
      );

      expect(service.read).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalledTimes(1);
      expect(debug.mock.calls[0][0]).toContain("no rows read and none serialized");
      expect(debug.mock.calls[0][0]).toContain(WORKSPACE.id);
      // Measured, not merely claimed: the line carries how long the version probe took.
      expect(debug.mock.calls[0][0]).toMatch(/in \d+(\.\d+)?ms/);
    } finally {
      debug.mockRestore();
    }
  });

  it("logs nothing on the answer that pays full price", async () => {
    // The instrumentation certifies the cheap branch; a line per 200 would be noise that
    // drowns the one signal the criterion asks for.
    const debug = jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);

    try {
      await controller.read(WORKSPACE as never, {}, recordingResponse());

      expect(debug).not.toHaveBeenCalled();
    } finally {
      debug.mockRestore();
    }
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
    // The poll hint travels with the tag or not at all: a `500` is the envelope filter's
    // to answer, and the client's backoff on an error is its own affair.
    expect(response.headers[POLL_AFTER]).toBeUndefined();
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
