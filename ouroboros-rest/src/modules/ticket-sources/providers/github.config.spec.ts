import {
  partitionSourceSubmission,
  sourceConfigViolations,
  sourceSchemaViolations,
  sourceSecretField,
} from "../ticket-source.config";
import { TicketSourceError } from "../ticket-source.errors";
import {
  GITHUB_SOURCE_SCHEMA,
  GITHUB_TOKEN_FIELD,
  MAX_ENABLED_REPOS,
  readGithubConfig,
} from "./github.config";

/**
 * The `github` kind's grammar, which is this provider's and nobody else's
 * ([#140](https://github.com/NobuData/ouroboros/issues/140)).
 *
 * Two things are under test and they are different claims. The first is that the shape
 * `R__dev_seed_sources.sql` writes is the shape this reads — a development database Q.4's
 * settings surface could not open would be a grammar with two authors. The second is that a
 * value which would change *which resource a request addresses* is refused before a request
 * exists, which is why the login and repository patterns are anchored rather than searched.
 */

/** The seeded configuration, as the migration writes it. */
const SEEDED = {
  login: "acme-robotics",
  repos: ["helios-firmware", "helios-console", "helios-telemetry", "atlas-scheduler"],
};

describe("a GitHub source's configuration", () => {
  it("reads the shape the dev seed writes", () => {
    // The migration's own JSON. If this ever stops passing, one of the two moved.
    expect(readGithubConfig(SEEDED)).toStrictEqual({
      login: "acme-robotics",
      repos: ["helios-firmware", "helios-console", "helios-telemetry", "atlas-scheduler"],
    });
  });

  it("keeps the repositories in the order somebody listed them", () => {
    // Observable rather than incidental: a sync walks them in this order and divides its page
    // budget across them.
    expect(readGithubConfig(SEEDED).repos).toStrictEqual(SEEDED.repos);
  });

  it("de-duplicates a repository listed twice, rather than polling it twice", () => {
    const settings = readGithubConfig({ login: "acme-robotics", repos: ["helios", "helios"] });

    expect(settings.repos).toStrictEqual(["helios"]);
  });

  it("ignores a key it does not know, so a rollback does not delete a workspace's intake", () => {
    // A source configured by a later build of this provider still polls under this one.
    const settings = readGithubConfig({ ...SEEDED, include_archived: true });

    expect(settings.login).toBe("acme-robotics");
  });

  it("accepts a repository name with the three separators GitHub allows", () => {
    const settings = readGithubConfig({
      login: "acme-robotics",
      repos: [".github", "docs.example.com", "helios_firmware", "helios-firmware"],
    });

    expect(settings.repos).toHaveLength(4);
  });

  describe("refuses, as not_found", () => {
    /**
     * Read a configuration and return the refusal.
     *
     * @param config - What to read.
     * @returns The error it threw.
     */
    function refusal(config: unknown): TicketSourceError {
      try {
        readGithubConfig(config);
      } catch (error) {
        return error as TicketSourceError;
      }

      throw new Error("readGithubConfig accepted a configuration it should have refused");
    }

    it.each([
      ["not an object at all", "acme-robotics/helios"],
      ["null", null],
      ["no login", { repos: ["helios"] }],
      ["no repos", { login: "acme-robotics" }],
      ["repos that are not strings", { login: "acme-robotics", repos: [{ name: "helios" }] }],
      ["an empty repo list", { login: "acme-robotics", repos: [] }],
      ["a login with a slash in it", { login: "acme/robotics", repos: ["helios"] }],
      ["a login with a double hyphen", { login: "acme--robotics", repos: ["helios"] }],
      ["a login that is only a hyphen", { login: "-", repos: ["helios"] }],
      ["a repository with a slash in it", { login: "acme-robotics", repos: ["a/b"] }],
      ["a repository that traverses", { login: "acme-robotics", repos: [".."] }],
      ["a repository that is a dot", { login: "acme-robotics", repos: ["."] }],
      ["a repository with a space", { login: "acme-robotics", repos: ["helios firmware"] }],
      ["an empty repository name", { login: "acme-robotics", repos: [""] }],
    ])("%s", (_case, config) => {
      // One class for every refusal, because §4 of docs/TICKET_SOURCES.md argues the taxonomy
      // has no `config` member: a source row cannot tell a mistyped name from a repository that
      // was deleted, and `validateConfig` — which runs while somebody is looking at the form —
      // is what can.
      expect(refusal(config).errorClass).toBe("not_found");
    });

    it("a login longer than GitHub allows", () => {
      expect(refusal({ login: "a".repeat(40), repos: ["helios"] }).errorClass).toBe("not_found");
    });

    it("more repositories than one source may hold", () => {
      const repos = Array.from(
        { length: MAX_ENABLED_REPOS + 1 },
        (_unused, i) => `repo-${String(i)}`,
      );

      expect(refusal({ login: "acme-robotics", repos }).detail).toContain(
        String(MAX_ENABLED_REPOS),
      );
    });

    it("and says which key was wrong, because a form has to render something", () => {
      // The detail reaches a log and, through `validateConfig`, the Test connection panel. A
      // refusal that said only "invalid" would leave somebody to guess between two fields.
      expect(refusal({ login: "acme/robotics", repos: ["helios"] }).detail).toContain(
        "config.login",
      );
      expect(refusal({ login: "acme-robotics", repos: [] }).detail).toContain("config.repos");
    });
  });

  it("accepts exactly as many repositories as the bound allows", () => {
    // The boundary from the other side: a bound nobody tested at the edge is a bound that is
    // off by one in whichever direction nobody looked.
    const repos = Array.from({ length: MAX_ENABLED_REPOS }, (_unused, i) => `repo-${String(i)}`);

    expect(readGithubConfig({ login: "acme-robotics", repos }).repos).toHaveLength(
      MAX_ENABLED_REPOS,
    );
  });
});

describe("the declared schema", () => {
  it("is in the dialect, so the registry admits it at boot", () => {
    expect(sourceSchemaViolations(GITHUB_SOURCE_SCHEMA)).toStrictEqual([]);
  });

  it("declares the two keys the seed writes, and the token beside them", () => {
    // The seed is the contract: a form drawn from this schema stores exactly the object the
    // provider's own parse reads.
    expect(Object.keys(GITHUB_SOURCE_SCHEMA.properties)).toStrictEqual([
      "login",
      "repos",
      GITHUB_TOKEN_FIELD,
    ]);
    expect(GITHUB_SOURCE_SCHEMA.required).toStrictEqual(["login", "repos", GITHUB_TOKEN_FIELD]);
  });

  it("marks the token as the one field routed to the vault", () => {
    expect(sourceSecretField(GITHUB_SOURCE_SCHEMA)).toBe(GITHUB_TOKEN_FIELD);
  });

  it("holds the form to the same grammar the parse enforces", () => {
    // A login with a `/`, a repository of `..` and an empty list are refused by the schema
    // before a request exists — the same three the parse would refuse a stored row for.
    expect(
      sourceConfigViolations(GITHUB_SOURCE_SCHEMA, {
        login: "acme/robotics",
        repos: [".."],
        [GITHUB_TOKEN_FIELD]: "ghp_x",
      }),
    ).toStrictEqual({
      login: ["GitHub account is not in the expected format"],
      repos: ["Repositories is not in the expected format"],
    });
    expect(
      sourceConfigViolations(GITHUB_SOURCE_SCHEMA, {
        login: "acme-robotics",
        repos: [],
        [GITHUB_TOKEN_FIELD]: "ghp_x",
      }),
    ).toStrictEqual({ repos: ["Repositories is required"] });
  });

  it("accepts what the parse accepts — `.github` included — and bounds the list where it does", () => {
    expect(
      sourceConfigViolations(GITHUB_SOURCE_SCHEMA, {
        ...SEEDED,
        repos: [...SEEDED.repos, ".github"],
        [GITHUB_TOKEN_FIELD]: "ghp_x",
      }),
    ).toStrictEqual({});
    expect(GITHUB_SOURCE_SCHEMA.properties.repos).toMatchObject({
      type: "array",
      minItems: 1,
      maxItems: MAX_ENABLED_REPOS,
    });
  });

  it("round-trips a form's submission into the object the parse reads", () => {
    const parts = partitionSourceSubmission(GITHUB_SOURCE_SCHEMA, {
      ...SEEDED,
      [GITHUB_TOKEN_FIELD]: "ghp_x",
    });

    expect(readGithubConfig(parts.config)).toStrictEqual(SEEDED);
    expect(parts.secret).toBe("ghp_x");
  });
});
