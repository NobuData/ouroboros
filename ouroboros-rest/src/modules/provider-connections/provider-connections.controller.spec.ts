import { HttpStatus } from "@nestjs/common";
import { HEADERS_METADATA, HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import { COOKIE } from "../auth/http";
import { FIXTURE_USER, principalFor } from "../auth/principal.fixture";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { FIXTURE_CONNECTION, FIXTURE_MASK, FIXTURE_WORKSPACE } from "./connection.fixture";
import { ProviderConnectionsController } from "./provider-connections.controller";
import type { ProviderConnectionsService } from "./provider-connections.service";
import type { ProviderConnectionResource } from "./resources";

/**
 * What a controller spec in this service is about — the routes' declarations — and the three
 * declarations that *are* this half of the ticket: `@Roles(...ADMINISTRATORS)` on every write
 * **and on reveal**, nothing on the two reads, and the workspace coming from the guard rather
 * than from anything a caller wrote. The guard honouring the metadata is `roles.guard.spec.ts`;
 * the whole pipeline refusing a member is `provider-connections.integration-spec.ts`.
 */

const WORKSPACE = { id: FIXTURE_WORKSPACE } as Organization;
const PRINCIPAL = principalFor(FIXTURE_USER, FIXTURE_WORKSPACE);
const REQUEST = { headers: { [COOKIE]: "better-auth.session_token=abc" } };
const PARAMS = { id: FIXTURE_CONNECTION };

const CONNECTION: ProviderConnectionResource = {
  id: FIXTURE_CONNECTION,
  kind: "anthropic",
  displayName: "Anthropic Claude",
  baseUrl: null,
  capabilityNote: null,
  status: "active",
  enabled: true,
  monthlyCapCents: 60_000,
  mask: FIXTURE_MASK,
  addedBy: FIXTURE_USER.id,
  lastCheckedAt: "2026-08-23T09:59:41.882Z",
  lastUsedAt: null,
  createdAt: "2026-06-12T16:20:00.000Z",
  updatedAt: "2026-08-23T09:59:41.882Z",
};

describe("the provider connections controller", () => {
  let service: jest.Mocked<ProviderConnectionsService>;
  let controller: ProviderConnectionsController;

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue({ items: [CONNECTION], total: 1, limit: 25, offset: 0 }),
      read: jest.fn().mockResolvedValue(CONNECTION),
      add: jest.fn().mockResolvedValue(CONNECTION),
      reveal: jest.fn().mockResolvedValue({
        connectionId: FIXTURE_CONNECTION,
        value: "sk-ant-api03-x",
        expiresAt: "2026-08-23T10:01:00.000Z",
      }),
      rotate: jest.fn().mockResolvedValue(CONNECTION),
      update: jest.fn().mockResolvedValue(CONNECTION),
      remove: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ProviderConnectionsService>;

    controller = new ProviderConnectionsController(service);
  });

  describe("the workspace is the session's", () => {
    it("scopes the listing to what the guard established", async () => {
      await expect(controller.list(WORKSPACE, { limit: 10 })).resolves.toMatchObject({ total: 1 });

      expect(service.list).toHaveBeenCalledWith(WORKSPACE.id, { limit: 10 });
    });

    it("scopes a read", async () => {
      await expect(controller.read(WORKSPACE, PARAMS)).resolves.toEqual(CONNECTION);

      expect(service.read).toHaveBeenCalledWith(WORKSPACE.id, FIXTURE_CONNECTION);
    });

    it("scopes every write", async () => {
      await controller.add(WORKSPACE, PRINCIPAL, {
        kind: "anthropic",
        displayName: "Anthropic",
        config: {},
      });
      await controller.rotate(WORKSPACE, PRINCIPAL, PARAMS, { secret: "x" });
      await controller.update(WORKSPACE, PRINCIPAL, PARAMS, { enabled: false });
      await controller.remove(WORKSPACE, PRINCIPAL, PARAMS);

      for (const call of [
        service.add.mock.calls[0],
        service.rotate.mock.calls[0],
        service.update.mock.calls[0],
        service.remove.mock.calls[0],
      ]) {
        expect(call[0]).toBe(WORKSPACE.id);
      }
    });
  });

  describe("who did it comes from the session", () => {
    it("attributes an add to the signed-in person rather than to a body field", async () => {
      // *Who added this provider* is a fact about the request; a body field would let a
      // client attribute its own writes to somebody else.
      await controller.add(WORKSPACE, PRINCIPAL, {
        kind: "anthropic",
        displayName: "Anthropic",
        config: {},
      });

      expect(service.add).toHaveBeenCalledWith(WORKSPACE.id, FIXTURE_USER.id, expect.anything());
    });

    it("hands reveal the whole principal, because it is the caller being challenged", async () => {
      await controller.reveal(WORKSPACE, PRINCIPAL, REQUEST, PARAMS, { password: "p" });

      expect(service.reveal).toHaveBeenCalledWith(
        WORKSPACE.id,
        PRINCIPAL,
        REQUEST,
        FIXTURE_CONNECTION,
        { password: "p" },
      );
    });
  });

  describe("the role gate", () => {
    it("asks administrators of every write", () => {
      const reflector = new Reflector();

      for (const handler of [
        controller.add,
        controller.rotate,
        controller.update,
        controller.remove,
      ]) {
        expect(reflector.get<string[]>(REQUIRED_ROLES, handler)).toEqual([...ADMINISTRATORS]);
      }
    });

    it("asks administrators of reveal too", () => {
      // The one classification worth defending: reveal changes nothing, and it is the single
      // operation in this API that hands back a live credential. Filing it with the reads
      // because of its side effects would be filing it by the wrong property.
      expect(new Reflector().get<string[]>(REQUIRED_ROLES, controller.reveal)).toEqual([
        ...ADMINISTRATORS,
      ]);
    });

    it("asks nothing of the two reads", () => {
      // Under the roles guard's own rule a bare route is every member's, and every field a
      // viewer can see here is masked.
      const reflector = new Reflector();

      expect(reflector.get<string[]>(REQUIRED_ROLES, controller.list)).toBeUndefined();
      expect(reflector.get<string[]>(REQUIRED_ROLES, controller.read)).toBeUndefined();
    });
  });

  describe("what the answers declare", () => {
    it("answers a reveal 200 rather than Nest's default 201, because nothing is created", () => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.reveal)).toBe(HttpStatus.OK);
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.rotate)).toBe(HttpStatus.OK);
    });

    it("answers a delete 204 with no body", () => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.remove)).toBe(
        HttpStatus.NO_CONTENT,
      );
    });

    it("forbids storing a revealed credential anywhere in between", () => {
      // `no-store` rather than `no-cache`: the latter permits a stored copy that is
      // revalidated, which for a credential is a stored copy.
      const headers = Reflect.getMetadata(HEADERS_METADATA, controller.reveal) as {
        name: string;
        value: string;
      }[];

      expect(headers).toEqual([{ name: "Cache-Control", value: "no-store" }]);
    });

    it("declares that header on the reveal alone", () => {
      for (const handler of [controller.list, controller.read, controller.rotate]) {
        expect(Reflect.getMetadata(HEADERS_METADATA, handler)).toBeUndefined();
      }
    });
  });

  it("declares the seven operations the ticket names, over four paths, and no eighth", () => {
    // Worth an assertion because the obvious next endpoints — *test this connection*,
    // *discover its models* — are AE.4's (#230), and a slice of them written here is one that
    // ticket would have to negotiate with rather than write.
    const handlers = Object.getOwnPropertyNames(ProviderConnectionsController.prototype).filter(
      (name) => name !== "constructor",
    );

    expect(handlers.sort()).toEqual([
      "add",
      "list",
      "read",
      "remove",
      "reveal",
      "rotate",
      "update",
    ]);
  });
});
