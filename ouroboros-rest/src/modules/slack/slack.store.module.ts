/**
 * The Slack app's repository as a module of its own (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)) — what lets two modules that need
 * each other's neighbours avoid needing each other.
 *
 * ```
 * SlackModule ──▶ ChatopsModule ──▶ SlackStoreModule ◀── SlackModule
 * ```
 *
 * The Slack adapter hands `/ouro` commands to the dispatcher (`ChatopsModule`), and the
 * dispatcher resolves a Slack user through {@link SlackRepository}. Were the repository still
 * provided by `SlackModule`, that would be a cycle and a `forwardRef`. It depends on the
 * database alone, so it sits here, below both, and each imports it: one instance, no cycle.
 * `SlackModule` re-exports this module, so everything that took the repository from it still
 * does.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { SlackRepository } from "./slack.repository";

@Module({
  imports: [DbModule],
  providers: [SlackRepository],
  exports: [SlackRepository],
})
export class SlackStoreModule {}
