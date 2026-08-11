/**
 * The shared pieces the integration suites are built out of, without a database.
 *
 * They are test support rather than application code, which is exactly why they are checked:
 * a bug in the *application* announces itself as a failing test, and a bug here announces
 * itself as a suite that passes for the wrong reason. Two of them are load-bearing in that
 * way — the guard that refuses to run against no database, and the switch that decides
 * whether the harness may empty one.
 */

import {
  containing,
  databaseIsDisposable,
  DISPOSABLE,
  integrationDatabaseUrl,
  IS_DISPOSABLE,
  matching,
  uniqueEmail,
  uniqueName,
} from "./integration.fixture";

/** A prefix of the shape the migrations' format constraints admit. */
const PREFIX = "ouro-spec";

describe("the database the suites are pointed at", () => {
  const original = process.env.OURO_DATABASE_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.OURO_DATABASE_URL;
    } else {
      process.env.OURO_DATABASE_URL = original;
    }
  });

  it("is whatever the run published", () => {
    process.env.OURO_DATABASE_URL = "postgresql://ouroboros@localhost:5432/ouroboros";

    expect(integrationDatabaseUrl()).toBe("postgresql://ouroboros@localhost:5432/ouroboros");
  });

  it("is a failure rather than a skip when there is none", () => {
    delete process.env.OURO_DATABASE_URL;

    // The oldest decision in these suites: a run that silently passes having connected to
    // nothing reports that the schema matches, having compared nothing.
    expect(() => integrationDatabaseUrl()).toThrow(/needs a migrated database/);
  });

  it("treats an empty value as no value", () => {
    // `OURO_DATABASE_URL= yarn test:integration` is a plausible typo, and an empty
    // connection string reaches `pg` as "connect to whatever the environment implies".
    process.env.OURO_DATABASE_URL = "";

    expect(() => integrationDatabaseUrl()).toThrow(/needs a migrated database/);
  });
});

describe("whether the harness may empty the database", () => {
  const original = process.env[DISPOSABLE];

  afterEach(() => {
    if (original === undefined) {
      delete process.env[DISPOSABLE];
    } else {
      process.env[DISPOSABLE] = original;
    }
  });

  it("is no unless something says so", () => {
    // The safe default, and the one that matters: an unset variable must never be read as
    // permission to truncate a developer's development stack.
    delete process.env[DISPOSABLE];

    expect(databaseIsDisposable()).toBe(false);
  });

  it("is yes when the run declared the database disposable", () => {
    process.env[DISPOSABLE] = IS_DISPOSABLE;

    expect(databaseIsDisposable()).toBe(true);
  });

  it.each(["", "false", "1", "yes", "TRUE"])("is no for %p", (value) => {
    // One spelling, exactly. A near-miss that was read as consent is the whole failure this
    // switch exists to prevent, and `1`/`yes` are the near-misses somebody would try.
    process.env[DISPOSABLE] = value;

    expect(databaseIsDisposable()).toBe(false);
  });
});

describe("the names the suites invent", () => {
  it("fit the format constraints the migrations declare", () => {
    // `tenants_slug_format` and `github_orgs_login_format` admit lower-case alphanumerics in
    // single-hyphen-separated groups, so a helper that produced anything else would fail as a
    // 422 in a suite that was asserting about something else entirely.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      expect(uniqueName(PREFIX)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("start with the prefix a suite's cleanup matches on", () => {
    expect(uniqueName(PREFIX).startsWith(`${PREFIX}-`)).toBe(true);
    expect(uniqueEmail(PREFIX).startsWith(`${PREFIX}-`)).toBe(true);
  });

  it("are addresses in a domain reserved for tests", () => {
    // `.test` is reserved by RFC 2606, so nothing here can resolve to somebody's mailbox.
    expect(uniqueEmail(PREFIX)).toMatch(/^[a-z0-9-]+@example\.test$/);
  });

  it("do not repeat", () => {
    const names = new Set(Array.from({ length: 500 }, () => uniqueName(PREFIX)));

    expect(names.size).toBe(500);
  });
});

describe("the typed matchers", () => {
  it("carry Jest's asymmetric matchers into a typed literal", () => {
    // The point of them: `toEqual` stays exhaustive — every field listed — while a field the
    // database chose is still matched by shape. Typing them as `string` is what lets the
    // literal be checked against the resource rather than degenerating to `any`.
    expect({ id: "9f1c0a5e", message: "no route for /api/v1/nope" }).toEqual({
      id: matching(/^[0-9a-f]+$/),
      message: containing("/api/v1/nope"),
    });
  });
});
