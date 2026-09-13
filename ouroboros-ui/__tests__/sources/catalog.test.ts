import { describe, expect, it } from "vitest";

import { COMING_SOON_LABEL } from "@/app/catalog-tiles";
import {
  ADD_READ_ONLY,
  CONFIG_INVALID,
  COMING_SOON,
  KIND_UNSUPPORTED,
  NAME_FIELD,
  NAME_TAKEN,
  NOTHING_STORED,
  V2_LABEL,
  VALIDATION_FAILED,
  addFailure,
  addedNote,
  arrivesNote,
  catalogTiles,
  configOf,
  credentialNote,
  credentialStored,
  secretFieldOf,
  storedFields,
} from "@/app/sources/catalog";

import { FAKE_KIND, fakeEntry, githubEntry, seededCatalog, source } from "../helpers/sources";

/**
 * The add and configure dialogs' decisions
 * ([#141](https://github.com/NobuData/ouroboros/issues/141)): the tiles derive from the
 * registry and the promised ones say v2; the form's submission is what was typed, a list
 * split per line; a refusal lands under the field it names.
 */

describe("the tiles", () => {
  it("draws one live tile per catalog entry, in the service's order, then the three promised trackers", () => {
    const tiles = catalogTiles(seededCatalog());

    expect(tiles.map((tile) => [tile.kind, tile.live])).toEqual([
      ["github", true],
      ["jira", false],
      ["linear", false],
      ["gitlab", false],
    ]);
    expect(tiles[0]).toMatchObject({
      label: "GitHub",
      monogram: "GI",
      needs: "GitHub account · Repositories · Personal access token",
    });
  });

  it("labels every promised tile v2 and names the ticket it arrives with", () => {
    // The issue: *honest v2 labelling — the tiles must not imply working integrations*.
    expect(COMING_SOON.map((announcement) => announcement.kind)).toEqual(["jira", "linear", "gitlab"]);
    for (const announcement of COMING_SOON) {
      expect(announcement.source).toMatch(/^T\.\d \(#\d+\)$/);
      expect(arrivesNote(announcement.source)).toBe(`Arrives in ${V2_LABEL} with ${announcement.source}`);
    }
    expect(COMING_SOON_LABEL).toBe("coming soon");
  });

  it("retires an announcement the moment the registry answers its kind", () => {
    const jira = { ...githubEntry(), kind: "jira" as const, title: "Connect a Jira site" };
    const tiles = catalogTiles([githubEntry(), jira]);

    expect(tiles.filter((tile) => tile.kind === "jira")).toEqual([
      expect.objectContaining({ live: true, label: "Jira" }),
    ]);
    expect(tiles.map((tile) => tile.kind)).toEqual(["github", "jira", "linear", "gitlab"]);
  });

  it("draws a kind it has never heard of with a working form, which is the whole point", () => {
    const tile = catalogTiles([fakeEntry()])[0];

    expect(tile).toMatchObject({ live: true, kind: FAKE_KIND, label: "Custom" });
    expect(tile?.live && tile.entry.fields.map((field) => field.widget)).toEqual([
      "url",
      "text",
      "select",
      "list",
      "secret",
    ]);
  });
});

describe("the submission", () => {
  it("sends what was typed: a string trimmed, a list one entry per line, the secret among them", () => {
    const values: Record<string, string> = {
      login: "  acme-robotics ",
      repos: "helios-firmware\nhelios-console\n\n",
      token: "ghp_x",
    };

    expect(configOf(githubEntry().fields, (name) => values[name] ?? "")).toEqual({
      login: "acme-robotics",
      repos: ["helios-firmware", "helios-console"],
      token: "ghp_x",
    });
  });

  it("accepts a comma-separated list, because a pasted list arrives that way", () => {
    const values: Record<string, string> = { repos: "a, b,c" };

    expect(configOf(githubEntry().fields, (name) => values[name] ?? "")).toMatchObject({
      repos: ["a", "b", "c"],
    });
  });

  it("leaves an untouched optional field out, and sends a required one empty so the service names it", () => {
    const values: Record<string, string> = { site: "https://t.example", project: "P", boards: "B", apiToken: "" };

    const config = configOf(fakeEntry().fields, (name) => values[name] ?? "");

    expect(config).not.toHaveProperty("region");
    expect(config.apiToken).toBe("");
  });
});

describe("the configure dialog's fields", () => {
  it("draws the entry's fields minus the secret, each starting at what the row holds", () => {
    const fields = storedFields(githubEntry(), source());

    expect(fields.map((field) => field.name)).toEqual(["login", "repos"]);
    expect(fields[0]?.defaultValue).toBe("acme-robotics");
    // A list starts at its entries one per line — what the form primitive reads back.
    expect(fields[1]?.defaultValue).toBe(
      "helios-firmware\nhelios-console\nhelios-telemetry\natlas-scheduler",
    );
  });

  it("starts a field the row does not hold at nothing", () => {
    expect(storedFields(githubEntry(), source({ config: {} })).map((field) => field.defaultValue)).toEqual(
      [null, null],
    );
  });

  it("finds the provider's secret field, or none", () => {
    expect(secretFieldOf(githubEntry())?.name).toBe("token");
    expect(secretFieldOf({ ...githubEntry(), fields: storedFields(githubEntry(), source()) })).toBeNull();
  });

  it("says what is stored without ever saying what it is", () => {
    expect(credentialNote(null)).toContain("No credential is stored");
    expect(credentialNote("••••")).toContain("(••••)");
    expect(credentialStored("••••3210")).toBe("Credential stored (••••3210).");
    expect(credentialStored(null)).toBe("Credential stored.");
  });
});

describe("the refusal", () => {
  it("puts a schema violation under the field it names, and says nothing was stored", () => {
    const failure = addFailure({
      code: "ticket_source_config_invalid",
      message: "The configuration does not satisfy this provider's schema.",
      details: { fields: { repos: ["Repositories needs at least 1 entry"], login: [] } },
    });

    expect(failure.message).toBe(CONFIG_INVALID);
    expect(failure.message).toContain(NOTHING_STORED);
    expect(failure.fields).toEqual({ repos: ["Repositories needs at least 1 entry"] });
  });

  it("puts a validation refusal under the fields it names", () => {
    const failure = addFailure({
      code: "validation_failed",
      message: "The request is not valid.",
      details: { displayName: ["displayName must not be blank"] },
    });

    expect(failure.message).toBe(VALIDATION_FAILED);
    expect(failure.fields).toEqual({ displayName: ["displayName must not be blank"] });
  });

  it("puts a taken name under the name", () => {
    const failure = addFailure({
      code: "ticket_source_name_taken",
      message: "This workspace already has a ticket source with that name.",
      details: { displayName: "GitHub" },
    });

    expect(failure.message).toBe(NAME_TAKEN);
    expect(failure.fields).toEqual({ [NAME_FIELD]: [NAME_TAKEN] });
  });

  it("names the role for a 403 and the reopened catalog for a 501", () => {
    expect(addFailure({ code: "forbidden", message: "", details: {} }).message).toBe(ADD_READ_ONLY);
    expect(
      addFailure({ code: "ticket_source_kind_unsupported", message: "", details: {} }).message,
    ).toBe(KIND_UNSUPPORTED);
  });

  it("prints the service's own sentence for anything else, and a fallback for none", () => {
    expect(addFailure({ code: "internal_error", message: "Boom.", details: {} }).message).toBe("Boom.");
    expect(addFailure({ code: "internal_error", message: "", details: {} }).message).toContain(
      NOTHING_STORED,
    );
  });
});

describe("the done step", () => {
  it("names the source and says what to do next", () => {
    expect(addedNote("GitHub · acme-robotics")).toContain('"GitHub · acme-robotics"');
    expect(addedNote("x")).toContain("Test the connection");
  });
});
