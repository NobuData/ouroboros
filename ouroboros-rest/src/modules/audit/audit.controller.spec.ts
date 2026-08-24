import { PATH_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import type { Organization } from "../db/schema";
import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { AuditController } from "./audit.controller";
import type { AuditService } from "./audit.service";

/**
 * The route's declarations, which are this half of the ticket.
 *
 * Three of them carry the whole of AD.4's endpoint criteria: the **path**, because
 * `/api/v1/providers/audit` has to be the trail rather than a connection whose id is the
 * word *audit*; the **role**, because this is the one read in the providers surface that
 * administrators alone may make; and the **workspace**, which comes from the guard rather
 * than from anything a caller wrote — *another organization's events are unreachable* is a
 * property of that and nothing else.
 *
 * The guard honouring the metadata is `roles.guard.spec.ts`. The whole pipeline refusing a
 * member, and the router matching this path before `{id}`, are
 * `audit.integration-spec.ts`.
 */

const WORKSPACE = { id: "5eed0001-0000-4000-8000-000000000001" } as Organization;

describe("the audit controller", () => {
  let audit: jest.Mocked<AuditService>;
  let controller: AuditController;

  beforeEach(() => {
    audit = {
      list: jest.fn().mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 }),
    } as unknown as jest.Mocked<AuditService>;

    controller = new AuditController(audit);
  });

  it("serves the path AD.4 named", () => {
    // Under `providers` rather than a surface of its own, because the trail this endpoint
    // pages is the one mockup 07's page head opens.
    expect(Reflect.getMetadata(PATH_METADATA, AuditController)).toBe("providers");
    expect(new Reflector().get<string>(PATH_METADATA, controller.list)).toBe("audit");
  });

  it("is for administrators, unlike the two reads beside it", () => {
    // `provider-connections.controller.ts` leaves its `GET`s bare — every field they show is
    // masked, and *which providers does this workspace have* is a question a viewer may ask.
    // *Maya revealed the Anthropic key at 14:02 from 198.51.100.61* is a fact about a
    // colleague, and belongs in front of the people accountable for the workspace.
    expect(new Reflector().get<string[]>(REQUIRED_ROLES, controller.list)).toEqual([
      ...ADMINISTRATORS,
    ]);
  });

  it("scopes the page to the workspace the guard established", async () => {
    // There is no `{orgId}` in this path to be substituted, which is what makes another
    // organization's events unreachable rather than merely unlisted.
    await controller.list(WORKSPACE, {});

    expect(audit.list).toHaveBeenCalledWith(WORKSPACE.id, {});
  });

  it("passes the filters and the window through untouched", async () => {
    const query = {
      connectionId: "5eed000c-0000-4000-8000-000000000001",
      actorId: "5eed0003-0000-4000-8000-000000000002",
      action: "provider.revealed",
      limit: 10,
      offset: 20,
    };

    await controller.list(WORKSPACE, query);

    expect(audit.list).toHaveBeenCalledWith(WORKSPACE.id, query);
  });

  it("answers with the page the service assembled", async () => {
    await expect(controller.list(WORKSPACE, {})).resolves.toEqual({
      items: [],
      total: 0,
      limit: 25,
      offset: 0,
    });
  });
});
