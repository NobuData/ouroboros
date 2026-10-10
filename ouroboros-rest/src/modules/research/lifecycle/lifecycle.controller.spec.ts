import { HttpStatus, RequestMethod } from "@nestjs/common";
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";

import type { Principal } from "../../auth/principal";
import { HUMAN_ONLY } from "../../auth/service.scopes";
import type { Organization } from "../../db/schema";
import { REQUIRED_ROLES } from "../../tenancy/roles.guard";
import type { ActiveMembership } from "../../tenancy/tenant.context";
import { runWithTenantContext, setTenantContext } from "../../tenancy/tenant.context";
import { InvestigationLifecycleController, type ProgressResponse } from "./lifecycle.controller";
import { investigationId } from "./lifecycle.fixture";
import type { InvestigationProgressResource } from "./lifecycle.resources";
import type { InvestigationLifecycleService } from "./lifecycle.service";
import { ResearchSettingsController } from "./research-settings.controller";

/**
 * The routes (CM.6, #625): what each is, who the guards admit, and what each hands the service.
 */

const TENANT = { id: "org-acme" } as Organization;
const MEMBER: ActiveMembership = { tenant: TENANT, roles: ["member"] };
const PRINCIPAL = { user: { id: "user-maya" } } as Principal;
const ID = investigationId(127);

const handler = (type: { prototype: object }, name: string): object =>
  Object.getOwnPropertyDescriptor(type.prototype, name)!.value as object;

const route = (type: { prototype: object }, name: string): unknown[] => [
  Reflect.getMetadata(METHOD_METADATA, handler(type, name)) as unknown,
  Reflect.getMetadata(PATH_METADATA, handler(type, name)) as unknown,
];

function lifecycle() {
  return {
    start: jest.fn().mockResolvedValue("started"),
    list: jest.fn().mockResolvedValue("listed"),
    detail: jest.fn().mockResolvedValue("opened"),
    cancel: jest.fn().mockResolvedValue("cancelled"),
    progress: jest.fn(),
    settings: jest.fn().mockResolvedValue({ startRole: "member" }),
    updateSettings: jest.fn().mockResolvedValue({ startRole: "admin" }),
  };
}

const controller = (service: ReturnType<typeof lifecycle>) =>
  new InvestigationLifecycleController(service as unknown as InvestigationLifecycleService);

describe("the investigation lifecycle controller", () => {
  it("serves the five routes under /research/investigations", () => {
    expect(Reflect.getMetadata(PATH_METADATA, InvestigationLifecycleController)).toBe(
      "research/investigations",
    );
    expect(
      ["start", "list", "detail", "cancel", "progress"].map((name) =>
        route(InvestigationLifecycleController, name),
      ),
    ).toEqual([
      [RequestMethod.POST, "/"],
      [RequestMethod.GET, "/"],
      [RequestMethod.GET, ":investigationId"],
      [RequestMethod.POST, ":investigationId/cancel"],
      [RequestMethod.GET, ":investigationId/progress"],
    ]);
  });

  it("answers a start 201 and a cancel 200", () => {
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, handler(InvestigationLifecycleController, "start")),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, handler(InvestigationLifecycleController, "cancel")),
    ).toBe(HttpStatus.OK);
  });

  it("fixes no role on any route — reads are every member's, writes are decided in the service", () => {
    for (const name of ["start", "list", "detail", "cancel", "progress"]) {
      expect(
        Reflect.getMetadata(REQUIRED_ROLES, handler(InvestigationLifecycleController, name)),
      ).toBeUndefined();
    }
  });

  it("keeps the two writes to people, and lets a service account read", () => {
    const human = (name: string): unknown =>
      Reflect.getMetadata(HUMAN_ONLY, handler(InvestigationLifecycleController, name));

    expect([human("start"), human("cancel")]).toEqual([true, true]);
    expect([human("list"), human("detail"), human("progress")]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("starts as the session's person, in the session's workspace", async () => {
    const service = lifecycle();
    const body = { question: "Why?", kind: "gap_analysis", depth: "quick" as const };

    expect(await controller(service).start(MEMBER, PRINCIPAL, body)).toBe("started");
    expect(service.start).toHaveBeenCalledWith(
      "org-acme",
      { userId: "user-maya", roles: ["member"] },
      body,
    );
  });

  it("lists with the query's filters and its page", async () => {
    const service = lifecycle();
    const query = { kind: "gap_analysis", status: "active", quarter: "current", limit: 10 };

    expect(await controller(service).list(TENANT, query)).toBe("listed");
    expect(service.list).toHaveBeenCalledWith("org-acme", query, { limit: 10, offset: 0 });
  });

  it("opens an investigation for the person reading", async () => {
    const service = lifecycle();

    await runWithTenantContext(async () => {
      setTenantContext({ user: { id: "user-maya" } } as Parameters<typeof setTenantContext>[0]);
      expect(await controller(service).detail(MEMBER, { investigationId: ID })).toBe("opened");
    });

    expect(service.detail).toHaveBeenCalledWith(
      "org-acme",
      { userId: "user-maya", roles: ["member"] },
      ID,
    );
  });

  it("opens an investigation for a service account, which is nobody's starter", async () => {
    const service = lifecycle();

    await controller(service).detail(MEMBER, { investigationId: ID });

    expect(service.detail).toHaveBeenCalledWith(
      "org-acme",
      { userId: null, roles: ["member"] },
      ID,
    );
  });

  it("cancels as the session's person", async () => {
    const service = lifecycle();

    expect(await controller(service).cancel(MEMBER, PRINCIPAL, { investigationId: ID })).toBe(
      "cancelled",
    );
    expect(service.cancel).toHaveBeenCalledWith(
      "org-acme",
      { userId: "user-maya", roles: ["member"] },
      ID,
    );
  });

  describe("progress", () => {
    const reading = (
      overrides: Partial<InvestigationProgressResource>,
    ): InvestigationProgressResource => ({
      status: "running",
      iteration: 1,
      iterations: 2,
      sources: 0,
      spendCents: 0,
      cancelRequested: false,
      updatedAt: "2026-10-10T12:00:00.000Z",
      ...overrides,
    });

    function response() {
      const chunks: string[] = [];
      const listeners: (() => void)[] = [];
      const out: ProgressResponse & { ended: boolean } = {
        ended: false,
        setHeader: jest.fn(),
        write: (chunk: string) => chunks.push(chunk),
        end: () => {
          out.ended = true;
        },
        on: (_event, listener) => listeners.push(listener),
      };
      return { out, chunks, close: () => listeners.forEach((listener) => listener()) };
    }

    it("streams the session workspace's investigation to its end", async () => {
      const service = lifecycle();
      service.progress.mockResolvedValue(reading({ status: "brief_ready", sources: 44 }));
      const { out, chunks } = response();

      await controller(service).progress(TENANT, { investigationId: ID }, out);

      expect(service.progress).toHaveBeenCalledWith("org-acme", ID);
      expect(chunks.map((chunk) => chunk.split("\n")[0])).toEqual([
        "event: progress",
        "event: done",
      ]);
      expect(out.ended).toBe(true);
    });

    it("stops polling when the client goes away", async () => {
      jest.useFakeTimers();
      try {
        const service = lifecycle();
        service.progress.mockResolvedValue(reading({ sources: 3 }));
        const { out, chunks, close } = response();

        const streaming = controller(service).progress(TENANT, { investigationId: ID }, out);
        await jest.advanceTimersByTimeAsync(0);
        close();
        await jest.advanceTimersByTimeAsync(1000);
        await streaming;

        expect(service.progress).toHaveBeenCalledTimes(1);
        expect(chunks).toHaveLength(1);
        expect(out.ended).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});

describe("the research settings controller", () => {
  const settings = (service: ReturnType<typeof lifecycle>) =>
    new ResearchSettingsController(service as unknown as InvestigationLifecycleService);

  it("serves GET and PATCH /research/settings", () => {
    expect(Reflect.getMetadata(PATH_METADATA, ResearchSettingsController)).toBe(
      "research/settings",
    );
    expect(["read", "update"].map((name) => route(ResearchSettingsController, name))).toEqual([
      [RequestMethod.GET, "/"],
      [RequestMethod.PATCH, "/"],
    ]);
  });

  it("lets every member read and only owners and admins change it", () => {
    expect(
      Reflect.getMetadata(REQUIRED_ROLES, handler(ResearchSettingsController, "read")),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(REQUIRED_ROLES, handler(ResearchSettingsController, "update")),
    ).toEqual(["owner", "admin"]);
    expect(Reflect.getMetadata(HUMAN_ONLY, handler(ResearchSettingsController, "update"))).toBe(
      true,
    );
  });

  it("reads and changes the session workspace's setting", async () => {
    const service = lifecycle();

    expect(await settings(service).read(TENANT)).toEqual({ startRole: "member" });
    expect(await settings(service).update(TENANT, PRINCIPAL, { startRole: "admin" })).toEqual({
      startRole: "admin",
    });
    expect(service.settings).toHaveBeenCalledWith("org-acme");
    expect(service.updateSettings).toHaveBeenCalledWith("org-acme", "user-maya", {
      startRole: "admin",
    });
  });
});
