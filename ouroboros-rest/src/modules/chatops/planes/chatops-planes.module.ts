/**
 * The planes side of the `/ouro` grammar (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)).
 *
 * ```
 * COMMAND_BINDINGS    one binding per available command — each a call to a plane's own service
 * ARGUMENT_RESOLVERS  `#485` → an issue, `1847` → a run, `q-231` → an item        resolvers.ts
 * COMPLETION_SOURCES  what to offer while an argument is being typed            completions.ts
 * ```
 *
 * `grammar.ports.ts` is the seam: the dispatcher (`ChatopsModule`) imports this module and injects
 * those three tokens, and never imports a plane itself.
 *
 * ---------------------------------------------------------------------------
 * **A command is not a new control path, and this file is where that is visible.** It provides
 * no service of another plane — every one is *imported from the module that owns it*, so there is
 * one instance of the control queue, one of the queue write, one of the estimation limiter, and
 * chat reaches each through the export its own module argues for. The bindings then call the
 * method the UI's route calls. Each binding's spec holds that with a strict double of its plane,
 * and the `chatops-*` rules in `.dependency-cruiser.cjs` hold the rest: no plane's repository but
 * the three read-only lookups, no Slack, no dispatcher.
 *
 * **It imports neither `SlackModule` nor `ChatopsModule`.** The Slack adapter calls the
 * dispatcher and the dispatcher calls these bindings; an import back would be a cycle, and a
 * binding that knew which surface it ran on would not be the same command in the console.
 *
 * `explain pr` has no binding: it is `stage: "v2"` and the dispatcher answers it from the registry.
 */

import { Module } from "@nestjs/common";

import { BacklogModule } from "../../backlog/backlog.module";
import { ControlsModule } from "../../controls/controls.module";
import { DashboardModule } from "../../dashboard/dashboard.module";
import { DecisionsModule } from "../../decisions/decisions.module";
import { DryRunsModule } from "../../dry-runs/dry-runs.module";
import { EstimationModule } from "../../estimation/estimation.module";
import { FarmFleetModule } from "../../farm/fleet/fleet.module";
import { InboxActionsModule } from "../../inbox-actions/inbox-actions.module";
import { LifecycleModule } from "../../lifecycle/lifecycle.module";
import { RegistryModule } from "../../registry/registry.module";
import { RoutingModule } from "../../routing/routing.module";
import { RunsModule } from "../../runs/runs.module";
import { WorkflowsModule } from "../../workflows/workflows.module";
import {
  ARGUMENT_RESOLVERS,
  COMMAND_BINDINGS,
  COMPLETION_SOURCES,
  type CommandBindings,
} from "../grammar.ports";
import type { CommandBinding } from "../grammar.types";
import { AbortLoopBinding } from "./abort-loop.binding";
import { AnswerBinding } from "./answer.binding";
import { PlaneCompletionSources } from "./completions";
import { DryRunBinding } from "./dry-run.binding";
import { EstimateBinding } from "./estimate.binding";
import { PauseAllBinding } from "./pause-all.binding";
import { PauseLoopBinding } from "./pause-loop.binding";
import { QueueBinding } from "./queue.binding";
import { PlaneArgumentResolvers } from "./resolvers";
import { ResumeLoopBinding } from "./resume-loop.binding";
import { RouteBinding } from "./route.binding";
import { StatusBinding } from "./status.binding";

/** Every binding, in mockup 19's order — one per available command. */
export const BINDING_CLASSES = [
  StatusBinding,
  QueueBinding,
  PauseLoopBinding,
  ResumeLoopBinding,
  AbortLoopBinding,
  AnswerBinding,
  DryRunBinding,
  RouteBinding,
  EstimateBinding,
  PauseAllBinding,
] as const;

@Module({
  imports: [
    DashboardModule,
    FarmFleetModule,
    DecisionsModule,
    BacklogModule,
    ControlsModule,
    RunsModule,
    InboxActionsModule,
    DryRunsModule,
    WorkflowsModule,
    RoutingModule,
    RegistryModule,
    EstimationModule,
    LifecycleModule,
  ],
  providers: [
    ...BINDING_CLASSES,
    PlaneArgumentResolvers,
    PlaneCompletionSources,
    {
      provide: COMMAND_BINDINGS,
      useFactory: (...bindings: CommandBinding[]): CommandBindings => bindings,
      inject: [...BINDING_CLASSES],
    },
    { provide: ARGUMENT_RESOLVERS, useExisting: PlaneArgumentResolvers },
    { provide: COMPLETION_SOURCES, useExisting: PlaneCompletionSources },
  ],
  exports: [COMMAND_BINDINGS, ARGUMENT_RESOLVERS, COMPLETION_SOURCES],
})
export class ChatopsPlanesModule {}
