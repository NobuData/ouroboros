/**
 * `ContextAssemblyModule` — closest-wins resolution, manifests, previews and injection records
 * under `/api/v1/knowledge/context` (BF.5, [#414](https://github.com/NobuData/ouroboros/issues/414)).
 *
 * ```
 * context-assembly.resolve     the one implementation of K8 + the trim policy + the hash (pure)
 * context-assembly.profiles    each consumer's budget, fact cap and what it injects
 * context-assembly.resources   the manifest and injection-record shapes
 * context-assembly.repository  the workspace's candidates; the context_injections append
 * context-assembly.service     assemble / record — the service header documents every consumer
 * context-assembly.controller  preview + injections
 * ```
 *
 * **It exports the service and nothing else**, so every consumer — the estimator now, AR.1's
 * execution later — reaches the same resolution, and none can read the candidates around it.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { ContextAssemblyController } from "./context-assembly.controller";
import { ContextAssemblyRepository } from "./context-assembly.repository";
import { ContextAssemblyService } from "./context-assembly.service";

@Module({
  imports: [DbModule],
  controllers: [ContextAssemblyController],
  providers: [ContextAssemblyService, ContextAssemblyRepository],
  exports: [ContextAssemblyService],
})
export class ContextAssemblyModule {}
