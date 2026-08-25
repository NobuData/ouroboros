import { NotFoundError } from "../errors/error.envelope";
import { REGISTRY_ERRORS } from "./registry.errors";
import { RegistryRepository } from "./registry.repository";
import { RegistryService } from "./registry.service";
import type { AliasResolutionRow } from "./resolution";

/**
 * The three decisions this layer exists to make once — see `registry.service.ts`'s header.
 *
 * The repository is mocked here, and that is the right call for once: what is under test is
 * *what the service does with an answer*, and the statements themselves have their own suite
 * beside this one where mocking a method would have proved nothing.
 */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const CONNECTION = "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c";

/** One row, as the resolution join hands it back. */
const ROW = {
  alias: "coder-max",
  model_id: "claude-fable-5",
  params: { thinking: "max" },
  connection_id: CONNECTION,
  kind: "anthropic",
  display_name: "Anthropic",
  base_url: null,
  status: "active",
} satisfies AliasResolutionRow;

describe("the registry service", () => {
  let repository: jest.Mocked<Pick<RegistryRepository, keyof RegistryRepository>>;
  let registry: RegistryService;

  beforeEach(() => {
    repository = {
      resolveAlias: jest.fn(),
      listAliases: jest.fn(),
      aliasesForConnection: jest.fn(),
      // CH.2's (#585) three reads and CH.4's (#587) two batched twins of them. Stubbed but
      // never answered here: this service does not call them — `ParamSchemaService` does — and
      // a mock that satisfies the whole repository is what keeps *this suite* honest about
      // which methods it is exercising.
      findConnection: jest.fn(),
      discoveredModelMeta: jest.fn(),
      catalogModelMeta: jest.fn(),
      discoveredModelMetaMany: jest.fn(),
      catalogModelMetaMany: jest.fn(),
    };
    registry = new RegistryService(repository as unknown as RegistryRepository);
  });

  describe("resolve", () => {
    it("turns a name into a model on a connection", async () => {
      repository.resolveAlias.mockResolvedValue(ROW);

      await expect(registry.resolve(WORKSPACE, "coder-max")).resolves.toEqual({
        alias: "coder-max",
        modelId: "claude-fable-5",
        params: { thinking: "max" },
        connection: {
          id: CONNECTION,
          kind: "anthropic",
          displayName: "Anthropic",
          baseUrl: null,
          status: "active",
        },
      });
    });

    it("carries the workspace and the name to the statement", async () => {
      repository.resolveAlias.mockResolvedValue(ROW);

      await registry.resolve(WORKSPACE, "coder-max");

      expect(repository.resolveAlias).toHaveBeenCalledWith(WORKSPACE, "coder-max");
    });

    it("refuses a name this workspace does not have, rather than answering undefined", async () => {
      // Every caller of this method got the name from a request, a route or a DSL
      // expression, and every one of them would otherwise invent the same refusal.
      repository.resolveAlias.mockResolvedValue(undefined);

      await expect(registry.resolve(WORKSPACE, "no-such-alias")).rejects.toThrow(NotFoundError);
    });

    it("names the alias it refused, exactly as it was asked for", async () => {
      repository.resolveAlias.mockResolvedValue(undefined);

      await expect(registry.resolve(WORKSPACE, "Coder-Max")).rejects.toMatchObject({
        code: REGISTRY_ERRORS.aliasNotFound,
        details: { alias: "Coder-Max" },
      });
    });

    it("does not fold the name before looking it up", async () => {
      repository.resolveAlias.mockResolvedValue(undefined);

      await expect(registry.resolve(WORKSPACE, "Coder-Max")).rejects.toThrow();

      expect(repository.resolveAlias).toHaveBeenCalledWith(WORKSPACE, "Coder-Max");
    });

    it("resolves a local connection with its address", async () => {
      repository.resolveAlias.mockResolvedValue({
        ...ROW,
        alias: "local-docs",
        model_id: "llama-4-maverick",
        kind: "ollama",
        display_name: "Ollama",
        base_url: "http://workstation.local:11434",
        status: "unknown",
      });

      const resolved = await registry.resolve(WORKSPACE, "local-docs");

      expect(resolved.connection.baseUrl).toBe("http://workstation.local:11434");
      // `unknown` reaches the caller as `unknown` — decision M8. A resolution that reported
      // an unchecked provider as active would be the green dot the schema refuses to store.
      expect(resolved.connection.status).toBe("unknown");
    });
  });

  describe("list", () => {
    it("resolves every alias, keeping the statement's order", async () => {
      repository.listAliases.mockResolvedValue([
        ROW,
        { ...ROW, alias: "local-docs", model_id: "llama-4-maverick" },
      ]);

      const listed = await registry.list(WORKSPACE);

      expect(listed.map((entry) => entry.alias)).toEqual(["coder-max", "local-docs"]);
      expect(listed[1].modelId).toBe("llama-4-maverick");
    });

    it("answers with an empty list for a workspace whose registry is empty", async () => {
      // A new workspace, and a swap menu with nothing in it — an ordinary state rather than
      // a failure.
      repository.listAliases.mockResolvedValue([]);

      await expect(registry.list(WORKSPACE)).resolves.toEqual([]);
    });
  });

  describe("dependentAliases", () => {
    it("hands back the names that would block a removal", async () => {
      repository.aliasesForConnection.mockResolvedValue(["coder-max", "local-docs"]);

      await expect(registry.dependentAliases(WORKSPACE, CONNECTION)).resolves.toEqual([
        "coder-max",
        "local-docs",
      ]);
      expect(repository.aliasesForConnection).toHaveBeenCalledWith(WORKSPACE, CONNECTION);
    });

    it("answers with nothing when the removal is safe to offer", async () => {
      repository.aliasesForConnection.mockResolvedValue([]);

      await expect(registry.dependentAliases(WORKSPACE, CONNECTION)).resolves.toEqual([]);
    });
  });

  describe("what it is not", () => {
    it("declares no way to create, change or remove anything", () => {
      // Decision **M2**, as an assertion: provider CRUD is mockup 07's and alias CRUD is
      // mockup 21's. A write method added here is a roadmap being pre-empted, and it should
      // fail this suite on the day it is written rather than be noticed in review.
      const methods = Object.getOwnPropertyNames(RegistryService.prototype).filter(
        (name) => name !== "constructor",
      );

      expect(methods.sort()).toEqual(["dependentAliases", "list", "resolve"]);
    });
  });
});
