import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { CONTRIBUTORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { DryRunsController, type DryRunEventsResponse } from "./dry-runs.controller";
import type { DryRunsService } from "./dry-runs.service";
import { formatDryRunEvent, type DryRunStreamEvent } from "./dry-runs.stream";

const TENANT = {
  id: "acme-robotics-id",
  name: "Acme Robotics",
  slug: "acme-robotics",
  logo: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  metadata: null,
};
const WORKFLOW = "5eed0089-0000-4000-8000-000000000001";
const DRY_RUN = "5eed008b-0000-4000-8000-000000000001";
const PARAMS = { id: WORKFLOW, dryRunId: DRY_RUN };

type Handler = keyof DryRunsController;

describe("the dry-runs controller", () => {
  let service: jest.Mocked<
    Pick<
      DryRunsService,
      "start" | "history" | "candidates" | "safety" | "detail" | "events" | "cancel" | "rerun"
    >
  >;
  let controller: DryRunsController;
  const reflector = new Reflector();

  beforeEach(() => {
    service = {
      start: jest.fn().mockResolvedValue({ id: DRY_RUN }),
      history: jest.fn().mockResolvedValue({ count: 1 }),
      candidates: jest.fn().mockResolvedValue({ candidates: [] }),
      safety: jest.fn().mockResolvedValue({ columns: [] }),
      detail: jest.fn().mockResolvedValue({ id: DRY_RUN }),
      events: jest.fn(),
      cancel: jest.fn().mockResolvedValue({ id: DRY_RUN, status: "cancelled" }),
      rerun: jest.fn().mockResolvedValue({ id: "next" }),
    };
    controller = new DryRunsController(service as unknown as DryRunsService);
  });

  function handler(name: Handler) {
    return DryRunsController.prototype[name] as (...args: never[]) => unknown;
  }

  it("mounts under the workflow, with the literal routes ahead of the dry run's id", () => {
    expect(Reflect.getMetadata(PATH_METADATA, DryRunsController)).toBe("workflows/:id/dry-runs");

    const declared = Object.getOwnPropertyNames(DryRunsController.prototype)
      .filter((name) => name !== "constructor")
      .map((name) => [
        RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler(name as Handler)) as number],
        Reflect.getMetadata(PATH_METADATA, handler(name as Handler)) as string,
      ]);

    expect(declared).toEqual([
      ["POST", "/"],
      ["GET", "/"],
      ["GET", "candidates"],
      ["GET", "safety"],
      ["GET", ":dryRunId"],
      ["GET", ":dryRunId/events"],
      ["POST", ":dryRunId/cancel"],
      ["POST", ":dryRunId/rerun"],
    ]);
  });

  it("keeps starting, cancelling and re-running to contributors, and leaves the reads to every member", () => {
    const roles = (name: Handler) =>
      reflector.get<string[] | undefined>(REQUIRED_ROLES, handler(name));

    for (const name of ["start", "cancel", "rerun"] as const) {
      expect(roles(name)).toEqual([...CONTRIBUTORS]);
    }
    expect(CONTRIBUTORS).not.toContain("viewer");
    for (const name of ["history", "candidates", "safety", "detail", "events"] as const) {
      expect(roles(name)).toBeUndefined();
    }
  });

  it("answers a start and a re-run with 201, and a cancel with 200", () => {
    const status = (name: Handler) =>
      Reflect.getMetadata(HTTP_CODE_METADATA, handler(name)) as number;

    expect(status("start")).toBe(201);
    expect(status("rerun")).toBe(201);
    expect(status("cancel")).toBe(200);
  });

  it("passes the workspace, the workflow and the dry run to the service", async () => {
    const body = { ticketId: "t", draftRev: 3 };

    await controller.start(TENANT, { id: WORKFLOW }, body);
    await controller.history(TENANT, { id: WORKFLOW });
    await controller.candidates(TENANT, { id: WORKFLOW }, { limit: 5 });
    await controller.safety(TENANT, { id: WORKFLOW });
    await controller.detail(TENANT, PARAMS);
    await controller.cancel(TENANT, PARAMS);
    await controller.rerun(TENANT, PARAMS);

    expect(service.start).toHaveBeenCalledWith(TENANT.id, WORKFLOW, body);
    expect(service.history).toHaveBeenCalledWith(TENANT.id, WORKFLOW);
    expect(service.candidates).toHaveBeenCalledWith(TENANT.id, WORKFLOW, 5);
    expect(service.safety).toHaveBeenCalledWith(TENANT.id, WORKFLOW);
    expect(service.detail).toHaveBeenCalledWith(TENANT.id, WORKFLOW, DRY_RUN);
    expect(service.cancel).toHaveBeenCalledWith(TENANT.id, WORKFLOW, DRY_RUN);
    expect(service.rerun).toHaveBeenCalledWith(TENANT.id, WORKFLOW, DRY_RUN);
  });

  it("writes the events as a stream, and tells the service when the client has gone", async () => {
    const event: DryRunStreamEvent = {
      kind: "stage_started",
      seq: 1,
      stageKey: "analyze",
      displayName: "analyze",
    };
    let seen: AbortSignal | undefined;
    service.events.mockImplementation(async function* (_org, _workflow, _run, signal) {
      seen = signal;
      await Promise.resolve();
      yield event;
    });
    const written: string[] = [];
    let close: () => void = () => undefined;
    const response: DryRunEventsResponse = {
      setHeader: () => undefined,
      write: (chunk) => written.push(chunk),
      end: () => undefined,
      on: (_name, listener) => {
        close = listener;
      },
    };

    await controller.events(TENANT, PARAMS, response);

    expect(service.events).toHaveBeenCalledWith(
      TENANT.id,
      WORKFLOW,
      DRY_RUN,
      expect.any(AbortSignal),
    );
    expect(written).toEqual([formatDryRunEvent(event)]);
    expect(seen?.aborted).toBe(false);
    close();
    expect(seen?.aborted).toBe(true);
  });
});
