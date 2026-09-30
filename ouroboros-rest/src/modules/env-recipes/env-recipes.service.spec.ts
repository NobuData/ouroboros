import type { AuditRecord } from "../audit/audit.events";
import type { DatabaseFailure } from "../tenancy/constraints";
import { ENV_RECIPE_ERRORS } from "./env-recipes.errors";
import type { EnvRecipeStore } from "./env-recipes.repository";
import { COMMANDS, HELIOS, RECIPE, SAVE_BODY, currentRow } from "./env-recipes.fixture";
import { EnvRecipesService, repoKey, storedCommands } from "./env-recipes.service";

/**
 * The environment recipe's one source (#420): the version in force or an honest 404, a save that
 * is always the next version in the person's name, a race answered as a conflict naming the
 * version taken, and every save audited with the version it followed.
 */

const ORG = "org-helios";
const ACTOR = "user-ken";

/**
 * PostgreSQL refusing a write by a named constraint, as `pg` surfaces it.
 *
 * @param constraint - The constraint's name.
 * @returns The error.
 */
function refusal(constraint: string): DatabaseFailure {
  return Object.assign(new Error(`violates ${constraint}`), {
    code: "23505",
    constraint,
  });
}

describe("the stored form", () => {
  it("keeps the closed-key objects V073 admits, a comment only when one was given", () => {
    expect(JSON.parse(storedCommands(SAVE_BODY.commands))).toEqual([
      {
        command: "west init -m git@github.com:acme-robotics/helios-firmware",
        comment: "manifest repo",
      },
      { command: "west update --narrow -o=--depth=1" },
      {
        command: "zephyr-sdk-install 0.17.3 --toolchains arm-zephyr-eabi",
        comment: "SDK + ARM toolchain",
      },
      { command: "ccache --set-config=max_size=8G", comment: "shared build cache" },
    ]);
  });

  it("keys a repository lower-case, as the host and V067 do", () => {
    expect(repoKey("Acme-Robotics/Helios-Firmware")).toBe(HELIOS);
  });
});

describe("the env-recipe service", () => {
  let store: jest.Mocked<EnvRecipeStore>;
  let audit: { record: jest.Mock<Promise<string>, [AuditRecord]> };
  let service: EnvRecipesService;

  beforeEach(() => {
    store = {
      current: jest.fn().mockResolvedValue(currentRow()),
      insert: jest.fn().mockResolvedValue({ id: "recipe-4", version: 4 }),
    };
    audit = { record: jest.fn<Promise<string>, [AuditRecord]>().mockResolvedValue("event-1") };
    service = new EnvRecipesService(store, audit);
  });

  describe("read", () => {
    it("answers the version in force, with its editor named", async () => {
      await expect(service.read(ORG, HELIOS)).resolves.toEqual(RECIPE);
      expect(store.current).toHaveBeenCalledWith(ORG, HELIOS);
    });

    it("is a 404 for a repository with no recipe — a state, not a failure", async () => {
      store.current.mockResolvedValue(undefined);

      await expect(service.read(ORG, HELIOS)).rejects.toMatchObject({
        code: ENV_RECIPE_ERRORS.notFound,
        details: { repo: HELIOS },
      });
    });

    it("asks for the repository lower-case", async () => {
      await service.read(ORG, "Acme-Robotics/Helios-Firmware");

      expect(store.current).toHaveBeenCalledWith(ORG, HELIOS);
    });
  });

  describe("save", () => {
    it("writes the next version in the person's name and answers what is now in force", async () => {
      const v4 = currentRow({ version: 4, commands: SAVE_BODY.commands });
      store.current.mockResolvedValueOnce(currentRow()).mockResolvedValueOnce(v4);

      await expect(service.save(ORG, ACTOR, SAVE_BODY)).resolves.toMatchObject({
        version: 4,
        commands: [
          {
            command: "west init -m git@github.com:acme-robotics/helios-firmware",
            comment: "manifest repo",
          },
          { command: "west update --narrow -o=--depth=1", comment: null },
          {
            command: "zephyr-sdk-install 0.17.3 --toolchains arm-zephyr-eabi",
            comment: "SDK + ARM toolchain",
          },
          { command: "ccache --set-config=max_size=8G", comment: "shared build cache" },
        ],
      });
      expect(store.insert).toHaveBeenCalledWith(
        ORG,
        HELIOS,
        4,
        storedCommands(SAVE_BODY.commands),
        ACTOR,
      );
    });

    it("writes v1 for a repository that had none", async () => {
      store.current
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(currentRow({ version: 1, commands: COMMANDS }));
      store.insert.mockResolvedValue({ id: "recipe-1", version: 1 });

      await expect(service.save(ORG, ACTOR, SAVE_BODY)).resolves.toMatchObject({ version: 1 });
      expect(store.insert).toHaveBeenCalledWith(ORG, HELIOS, 1, expect.any(String), ACTOR);
      expect(audit.record.mock.calls[0]?.[0].detail).toMatchObject({
        version: 1,
        previous_version: 0,
      });
    });

    it("audits the save with the version it followed", async () => {
      const v4 = currentRow({ version: 4 });
      store.current.mockResolvedValueOnce(currentRow()).mockResolvedValueOnce(v4);

      await service.save(ORG, ACTOR, SAVE_BODY);

      expect(audit.record).toHaveBeenCalledWith({
        organizationId: ORG,
        actorId: ACTOR,
        action: "knowledge.env_recipe_saved",
        subjectType: "repository",
        subjectId: HELIOS,
        at: v4.updated_at,
        detail: { version: 4, previous_version: 3, commands: 4, source: "edited" },
      });
    });

    it.each(["env_recipes_next_version", "env_recipes_repo_version_key"])(
      "answers a race lost on %s as a conflict naming the version taken",
      async (constraint) => {
        store.insert.mockRejectedValue(refusal(constraint));

        await expect(service.save(ORG, ACTOR, SAVE_BODY)).rejects.toMatchObject({
          code: ENV_RECIPE_ERRORS.versionConflict,
          details: { repo: HELIOS, version: 4 },
        });
        expect(audit.record).not.toHaveBeenCalled();
      },
    );

    it("answers V073's shape check as a 422 rather than a crash", async () => {
      store.insert.mockRejectedValue(refusal("env_recipes_commands_typed"));

      await expect(service.save(ORG, ACTOR, SAVE_BODY)).rejects.toMatchObject({
        code: ENV_RECIPE_ERRORS.commandsInvalid,
      });
    });

    it("lets any other failure travel", async () => {
      store.insert.mockRejectedValue(new Error("connection reset"));

      await expect(service.save(ORG, ACTOR, SAVE_BODY)).rejects.toThrow("connection reset");
    });

    it("answers a conflict when a later save landed before the re-read", async () => {
      store.current
        .mockResolvedValueOnce(currentRow())
        .mockResolvedValueOnce(currentRow({ version: 5 }));

      await expect(service.save(ORG, ACTOR, SAVE_BODY)).rejects.toMatchObject({
        code: ENV_RECIPE_ERRORS.versionConflict,
        details: { version: 4 },
      });
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("propagates an audit failure — an unaudited save is not a success", async () => {
      store.current
        .mockResolvedValueOnce(currentRow())
        .mockResolvedValueOnce(currentRow({ version: 4 }));
      audit.record.mockRejectedValue(new Error("audit down"));

      await expect(service.save(ORG, ACTOR, SAVE_BODY)).rejects.toThrow("audit down");
    });
  });
});
