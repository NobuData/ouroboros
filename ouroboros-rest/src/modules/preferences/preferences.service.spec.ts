import type { UserPreferences } from "../db/schema";
import type { PreferencesRepository } from "./preferences.repository";
import { PreferencesService } from "./preferences.service";
import { FIXTURE_USER } from "../auth/principal.fixture";
import { runWithTenantContext, setTenantContext } from "../tenancy/tenant.context";

/**
 * The three rules of the surface, held where they live.
 *
 * The statements are the repository's and the wire shape is the controller's; what is left
 * here is exactly what could go quietly wrong: reading the wrong person, inventing a row
 * for somebody who never chose, and treating an empty PATCH as an error instead of a
 * question.
 */

/** A stored row for the fixture user, as the repository would return it. */
function row(fontScale: UserPreferences["font_scale"]): UserPreferences {
  return {
    user_id: FIXTURE_USER.id,
    font_scale: fontScale,
    created_at: new Date("2026-08-01T00:00:00Z"),
    updated_at: new Date("2026-08-13T00:00:00Z"),
  };
}

describe("the preferences service", () => {
  let repository: jest.Mocked<PreferencesRepository>;
  let service: PreferencesService;

  beforeEach(() => {
    repository = {
      findFor: jest.fn().mockResolvedValue(undefined),
      upsertFontScale: jest.fn(),
    } as unknown as jest.Mocked<PreferencesRepository>;

    service = new PreferencesService(repository);
  });

  /** Run `work` as the fixture user, the way the guard establishes a request's person. */
  function asFixtureUser<T>(work: () => T): T {
    return runWithTenantContext(() => {
      setTenantContext({ user: FIXTURE_USER });
      return work();
    });
  }

  it("reads the caller's row and nobody else's", async () => {
    repository.findFor.mockResolvedValue(row("125"));

    await expect(asFixtureUser(() => service.read())).resolves.toEqual({ fontScale: "125" });

    expect(repository.findFor).toHaveBeenCalledWith(FIXTURE_USER.id);
  });

  it("answers the defaults for a person who has never chosen, without writing a row", async () => {
    // Absence is an answer: no 404, and no written-on-read row — the table holds choices,
    // so `count(*)` over it stays "how many people changed a setting".
    await expect(asFixtureUser(() => service.read())).resolves.toEqual({ fontScale: "100" });

    expect(repository.upsertFontScale).not.toHaveBeenCalled();
  });

  it("stores a step and answers with the row as the database returned it", async () => {
    repository.upsertFontScale.mockResolvedValue(row("150"));

    await expect(asFixtureUser(() => service.update({ fontScale: "150" }))).resolves.toEqual({
      fontScale: "150",
    });

    expect(repository.upsertFontScale).toHaveBeenCalledWith(FIXTURE_USER.id, "150");
  });

  it("treats an empty patch as a question, not an error", async () => {
    // PATCH means "what is present changed". Nothing present changes nothing, and the
    // honest answer is the current state.
    repository.findFor.mockResolvedValue(row("112.5"));

    await expect(asFixtureUser(() => service.update({}))).resolves.toEqual({
      fontScale: "112.5",
    });

    expect(repository.upsertFontScale).not.toHaveBeenCalled();
  });

  it("fails loudly with no signed-in person, on both verbs", async () => {
    // Unreachable through the pipeline — the routes are authenticated — and precisely
    // because it is unreachable it must not be survivable: a preferences row scoped to
    // nobody would be one everybody shares.
    await expect(runWithTenantContext(() => service.read())).rejects.toThrow(/no signed-in person/);
    await expect(runWithTenantContext(() => service.update({ fontScale: "125" }))).rejects.toThrow(
      /no signed-in person/,
    );

    expect(repository.findFor).not.toHaveBeenCalled();
    expect(repository.upsertFontScale).not.toHaveBeenCalled();
  });
});
