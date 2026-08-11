import { Injectable, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { AppModule } from "../app/app.module";
import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { DbModule } from "./db.module";
import { DatabaseService } from "./db.service";

/**
 * What the module contributes, and what it deliberately does not.
 *
 * The convention this module exists to set — repositories live with their feature module,
 * `DbModule` provides only the connection — is a rule about who imports what, so it is
 * checked the way a rule about wiring can be: by building a feature module that looks like
 * the ones [#31](https://github.com/NobuData/ouroboros/issues/31) and
 * [#33](https://github.com/NobuData/ouroboros/issues/33) will be, and resolving it.
 */

jest.mock("pg");

/** A repository the way a feature module is expected to write one: it injects and queries. */
@Injectable()
class ExampleRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * The statement this repository would send.
   *
   * @returns The compiled SQL, so the test needs no database to see it.
   */
  findBySlugSql(): string {
    return this.database.db.selectFrom("tenants").selectAll().where("slug", "=", "acme").compile()
      .sql;
  }
}

/** A feature module the way the epic's remaining modules are expected to be written. */
@Module({ imports: [DbModule], providers: [ExampleRepository] })
class ExampleFeatureModule {}

describe("DbModule", () => {
  it("provides the database connection", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), DbModule],
    }).compile();

    expect(moduleRef.get(DatabaseService)).toBeInstanceOf(DatabaseService);
  });

  it("satisfies a repository that lives in another module", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), ExampleFeatureModule],
    }).compile();

    // The convention, resolved: the repository is the feature's, the connection is this
    // module's, and the feature said so by importing it.
    expect(moduleRef.get(ExampleRepository).findBySlugSql()).toBe(
      'select * from "ouroboros"."tenants" where "slug" = $1',
    );
  });

  it("keeps the connection to itself, so an import is a stated dependency", async () => {
    // Not global, unlike configuration. A module that has not imported DbModule cannot
    // reach the database, which is what makes the `imports` lists the answer to "who can
    // query the tenancy schema".
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration())],
    }).compile();

    expect(() => moduleRef.get(DatabaseService)).toThrow();
  });

  it("is in the application's module tree, so the shutdown hook is real", async () => {
    // A provider Nest never instantiates has no `onApplicationShutdown` to call. The
    // acceptance criterion is about the running service, so the module has to be in it —
    // and it is imported by `AppModule` rather than by whatever first needs a repository.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(testConfiguration())],
    }).compile();

    expect(moduleRef.get(DatabaseService, { strict: false })).toBeInstanceOf(DatabaseService);
  });
});
