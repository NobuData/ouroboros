import { Readable } from "node:stream";

import { StreamableFile } from "@nestjs/common";
import { PATH_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import type { HeaderResponse } from "../farm/logs/logs.controller";
import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { AUDIT_EXPORT_ROWS_HEADER, AuditPlaneController } from "./audit-plane.controller";
import type { AuditPlaneService } from "./audit-plane.service";

/**
 * The audit plane's routes (#486): the path, administrators only, the workspace from the guard,
 * and the export as a streamed, uncached attachment that names its row count.
 */
describe("the audit plane controller", () => {
  const WORKSPACE = { id: "5eed0001-0000-4000-8000-000000000001" } as Organization;
  const KEN = { user: { id: "user-ken" } } as Principal;
  let plane: jest.Mocked<Pick<AuditPlaneService, "list" | "today" | "exportCsv">>;
  let controller: AuditPlaneController;

  beforeEach(() => {
    plane = {
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: null, limit: 50 }),
      today: jest.fn().mockResolvedValue({ rows: [] }),
      exportCsv: jest.fn().mockResolvedValue({
        filename: "audit-2026-10-01-2026-10-05.csv",
        rows: 3,
        chunks: (async function* chunks() {
          await Promise.resolve();
          yield "header\r\n";
        })(),
      }),
    };
    controller = new AuditPlaneController(plane as unknown as AuditPlaneService);
  });

  it("serves /settings/audit, /today and /export.csv", () => {
    const reflector = new Reflector();

    expect(Reflect.getMetadata(PATH_METADATA, AuditPlaneController)).toBe("settings/audit");
    expect(reflector.get<string>(PATH_METADATA, controller.list)).toBe("/");
    expect(reflector.get<string>(PATH_METADATA, controller.today)).toBe("today");
    expect(reflector.get<string>(PATH_METADATA, controller.exportCsv)).toBe("export.csv");
  });

  it("is for administrators on every route — which also keeps service tokens out", () => {
    const reflector = new Reflector();

    for (const handler of [controller.list, controller.today, controller.exportCsv]) {
      expect(reflector.get<string[]>(REQUIRED_ROLES, handler)).toEqual([...ADMINISTRATORS]);
    }
  });

  it("scopes every read to the workspace the guard established", async () => {
    await controller.list(WORKSPACE, { actorKind: "bot" });
    await controller.today(WORKSPACE, { tz: "UTC" });

    expect(plane.list).toHaveBeenCalledWith(WORKSPACE.id, { actorKind: "bot" });
    expect(plane.today).toHaveBeenCalledWith(WORKSPACE.id, { tz: "UTC" });
  });

  it("exports as the session's person, streamed, uncached, with its row count", async () => {
    const headers = new Map<string, string>();
    const response = {
      setHeader: (name: string, value: string) => headers.set(name, value),
    } as unknown as HeaderResponse;
    const query = { from: "2026-10-01T00:00:00Z", to: "2026-10-06T00:00:00Z" };

    const file = await controller.exportCsv(WORKSPACE, KEN, query, response);

    expect(plane.exportCsv).toHaveBeenCalledWith(WORKSPACE.id, query, "user-ken");
    expect(file).toBeInstanceOf(StreamableFile);
    expect(file.getStream()).toBeInstanceOf(Readable);
    expect(file.getHeaders()).toMatchObject({
      type: "text/csv; charset=utf-8",
      disposition: 'attachment; filename="audit-2026-10-01-2026-10-05.csv"',
    });
    expect(headers.get("Cache-Control")).toBe("private, no-store");
    expect(headers.get(AUDIT_EXPORT_ROWS_HEADER)).toBe("3");
  });
});
