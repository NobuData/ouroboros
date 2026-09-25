/**
 * The parser registry — the one place a result format is looked up (AT.1,
 * [#329](https://github.com/NobuData/ouroboros/issues/329)).
 *
 * Parsers are injected under {@link TEST_RESULT_PARSERS} and asked in registration order; the
 * first whose `detect` accepts a file parses it. Adding a format is adding one entry to that list
 * in `test-results.module.ts` — nothing here, and nothing in the orchestrator, changes.
 *
 * A duplicate `id` throws while Nest builds the module, so a second parser claiming `junit` stops
 * the process at boot rather than silently shadowing the first.
 */

import { Inject, Injectable } from "@nestjs/common";

import type { ResultFile, TestResultParser } from "./parser.spi";

/**
 * The DI token the registered parsers are injected under — a `Symbol`, bound in exactly one place:
 * `test-results.module.ts`.
 */
export const TEST_RESULT_PARSERS = Symbol("TEST_RESULT_PARSERS");

/** Every registered {@link TestResultParser}, in the order they are asked. */
@Injectable()
export class TestResultParserRegistry {
  private readonly parsers: readonly TestResultParser[];

  /**
   * @param parsers - The registered parsers, in the order they are asked.
   * @throws {Error} When two parsers share an `id`.
   */
  constructor(@Inject(TEST_RESULT_PARSERS) parsers: readonly TestResultParser[]) {
    const ids = new Set<string>();

    for (const parser of parsers) {
      if (ids.has(parser.id)) {
        throw new Error(`two test result parsers are registered as "${parser.id}"`);
      }
      ids.add(parser.id);
    }
    this.parsers = Object.freeze([...parsers]);
  }

  /**
   * The registered parsers' ids, in the order they are asked.
   *
   * @returns The ids.
   */
  ids(): string[] {
    return this.parsers.map((parser) => parser.id);
  }

  /**
   * The parser for a file.
   *
   * @param file - The file.
   * @returns The first parser whose `detect` accepts it, or null when none does.
   */
  detect(file: ResultFile): TestResultParser | null {
    return this.parsers.find((parser) => parser.detect(file)) ?? null;
  }
}
