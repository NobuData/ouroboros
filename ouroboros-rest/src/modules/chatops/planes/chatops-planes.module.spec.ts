import { Test } from "@nestjs/testing";

import { AuthModule } from "../../auth/auth.module";
import { ConfigurationModule } from "../../config/config.module";
import { testConfiguration } from "../../config/configuration.fixture";
import {
  ARGUMENT_RESOLVERS,
  COMMAND_BINDINGS,
  COMPLETION_SOURCES,
  type CommandBindings,
} from "../grammar.ports";
import { bindingProblems, GRAMMAR } from "../grammar.registry";
import type { CommandBinding } from "../grammar.types";
import { BINDING_CLASSES, ChatopsPlanesModule } from "./chatops-planes.module";
import { PlaneCompletionSources } from "./completions";
import { PlaneArgumentResolvers } from "./resolvers";

/**
 * The planes side of the `/ouro` grammar, as a module (#537). Two promises are visible here
 * and nowhere else: **the registry and the bindings agree** — one binding for every available
 * command and none for anything else — and **every plane service is imported from the module
 * that owns it**, so a command reaches the one instance the UI's route reaches.
 */

/** The commands the grammar says run today, in its own order. */
const AVAILABLE = GRAMMAR.commands
  .filter((command) => command.stage === "available")
  .map((command) => command.id);

/**
 * Each binding class's command, read off an instance built with no planes — `command` is a
 * field, and no constructor here does anything but hold what it is given.
 *
 * @returns The command ids, in `BINDING_CLASSES`' order.
 */
function boundCommands(): string[] {
  return BINDING_CLASSES.map((Binding) => {
    const construct = Binding as unknown as new (...planes: undefined[]) => CommandBinding;

    return new construct().command;
  });
}

describe("ChatopsPlanesModule", () => {
  it("has one binding for every available command of the grammar, in the grammar's order", () => {
    expect(boundCommands()).toEqual(AVAILABLE);
    expect(AVAILABLE).toEqual([
      "status",
      "queue",
      "pause loop",
      "resume loop",
      "abort loop",
      "answer",
      "dry-run",
      "route",
      "estimate",
      "pause all",
    ]);
  });

  it("has no binding for a command outside the grammar, or for one that is not available yet", () => {
    const commands = boundCommands();

    expect(
      bindingProblems(
        GRAMMAR,
        commands.map((command) => ({ command })),
      ),
    ).toEqual([]);

    for (const command of GRAMMAR.commands.filter((candidate) => candidate.stage !== "available")) {
      expect(commands).not.toContain(command.id);
    }
    // `explain pr` is the one v2 command today: listed, answered from the registry, never bound.
    expect(commands).not.toContain("explain pr");
    for (const command of commands) expect(AVAILABLE).toContain(command);
  });

  it("resolves every binding from the modules that own the planes, and hands them over as one list", async () => {
    // A plane service its module stopped exporting fails here, at boot, rather than on the
    // first `/ouro` command that needs it.
    const moduleRef = await Test.createTestingModule({
      // Configuration and BetterAuth are global in the running application (`AppModule` imports
      // both first); a testing container has to be given them. The lifecycle plane's step-up
      // is what needs the second.
      imports: [ConfigurationModule.forRoot(testConfiguration()), AuthModule, ChatopsPlanesModule],
    }).compile();

    const bindings = moduleRef.get<CommandBindings>(COMMAND_BINDINGS);

    expect(bindings.map((binding) => binding.command)).toEqual(AVAILABLE);
    expect(bindingProblems(GRAMMAR, bindings)).toEqual([]);
    bindings.forEach((binding, index) => {
      expect(binding).toBeInstanceOf(BINDING_CLASSES[index]);
      // The same instance the class token resolves to: one binding, not a copy of it.
      expect(binding).toBe(moduleRef.get(BINDING_CLASSES[index]));
    });
    expect(moduleRef.get(ARGUMENT_RESOLVERS)).toBe(moduleRef.get(PlaneArgumentResolvers));
    expect(moduleRef.get(COMPLETION_SOURCES)).toBe(moduleRef.get(PlaneCompletionSources));

    await moduleRef.close();
  });

  it("exports the three ports of the seam and nothing else", () => {
    expect(Reflect.getMetadata("exports", ChatopsPlanesModule)).toEqual([
      COMMAND_BINDINGS,
      ARGUMENT_RESOLVERS,
      COMPLETION_SOURCES,
    ]);
  });

  it("imports each plane's own module, and neither the dispatcher nor Slack", () => {
    const imports = (
      Reflect.getMetadata("imports", ChatopsPlanesModule) as { name?: string }[]
    ).map((imported) => imported.name);

    expect(imports).toEqual([
      "DashboardModule",
      "FarmFleetModule",
      "DecisionsModule",
      "BacklogModule",
      "ControlsModule",
      "RunsModule",
      "InboxActionsModule",
      "DryRunsModule",
      "WorkflowsModule",
      "RoutingModule",
      "RegistryModule",
      "EstimationModule",
      "LifecycleModule",
    ]);
    expect(imports).not.toContain("ChatopsModule");
    expect(imports).not.toContain("SlackModule");
  });

  it("provides no plane's service itself: only the bindings, the resolvers and the completions", () => {
    const providers = (Reflect.getMetadata("providers", ChatopsPlanesModule) as unknown[]).filter(
      (provider): provider is new (...args: never[]) => unknown => typeof provider === "function",
    );

    expect(providers).toEqual([...BINDING_CLASSES, PlaneArgumentResolvers, PlaneCompletionSources]);
  });
});
