/**
 * `TestResultsModule` — the result parser SPI and parse orchestration (AT.1,
 * [#329](https://github.com/NobuData/ouroboros/issues/329)).
 *
 * It declares no route: the upload path (#330) calls {@link TestResultIngestService} when a
 * manifest completes, and the read APIs (#333) land beside it.
 *
 * **{@link TEST_RESULT_PARSERS} is the registration point, and this is the file that changes when
 * a build gains a result format.** TAP, ctest JSON or pytest-json each add one entry to the list —
 * nothing in the registry or the orchestrator changes. Order matters only as a tie-break: the first
 * parser whose `detect` accepts a file reads it.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { CoverageParser } from "./coverage.parser";
import { HilParser } from "./hil.parser";
import { JunitParser } from "./junit.parser";
import { TEST_RESULT_PARSERS, TestResultParserRegistry } from "./parser.registry";
import type { TestResultParser } from "./parser.spi";
import { TestResultsRepository } from "./test-results.repository";
import { TestResultIngestService } from "./test-results.service";

@Module({
  imports: [DbModule],
  providers: [
    {
      provide: TEST_RESULT_PARSERS,
      // The registration point. See this module's header.
      useFactory: (): TestResultParser[] => [
        new HilParser(),
        new CoverageParser(),
        new JunitParser(),
      ],
    },
    TestResultParserRegistry,
    TestResultsRepository,
    TestResultIngestService,
  ],
  exports: [TestResultIngestService, TestResultParserRegistry],
})
export class TestResultsModule {}
