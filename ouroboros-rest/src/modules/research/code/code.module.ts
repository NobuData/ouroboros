/**
 * The code & git mining tool's core — repository resolution, engine reads and the bisect
 * primitive (CL.4, [#617](https://github.com/NobuData/ouroboros/issues/617)).
 *
 * Exported for two callers: `research-tools.module.ts`, whose `code` adapter is a thin layer over
 * {@link CodeReader} and {@link CodeBisectService}, and the regression watch (#623), which starts
 * bisects through {@link CodeBisectService} and cites them with `code.sources.ts`'s
 * `bisectSource`. {@link CodeBisectScheduler} settles bisects as farm jobs complete and resumes
 * them every `OURO_RESEARCH_BISECT_TICK_MS`.
 */

import { Module } from "@nestjs/common";

import { AppConfigService } from "../../config/config.service";
import { DbModule } from "../../db/db.module";
import { EngineModule } from "../../engine/engine.module";
import { FarmDispatchModule } from "../../farm/dispatch/dispatch.module";
import { JobCompletions } from "../../farm/dispatch/job.completions";
import { GithubModule } from "../../github/github.module";
import { CodeBisectRepository } from "./code-bisect.repository";
import { CodeBisectScheduler } from "./code-bisect.scheduler";
import { CodeBisectService } from "./code-bisect.service";
import { CodeReader } from "./code.reader";
import { CodeWorkspace } from "./code.workspace";

@Module({
  imports: [DbModule, EngineModule, GithubModule, FarmDispatchModule],
  providers: [
    CodeWorkspace,
    CodeReader,
    CodeBisectRepository,
    CodeBisectService,
    {
      provide: CodeBisectScheduler,
      inject: [CodeBisectService, JobCompletions, AppConfigService],
      useFactory: (
        bisects: CodeBisectService,
        completions: JobCompletions,
        config: AppConfigService,
      ) => new CodeBisectScheduler(bisects, completions, config.researchBisectTickMs),
    },
  ],
  exports: [CodeWorkspace, CodeReader, CodeBisectService],
})
export class CodeModule {}
