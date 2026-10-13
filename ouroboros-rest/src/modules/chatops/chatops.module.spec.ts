import { Global, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AuthService as BetterAuth } from "@thallesp/nestjs-better-auth";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { ChatopsController } from "./chatops.controller";
import { ChatopsModule } from "./chatops.module";
import { ChatDispatcher } from "./dispatcher.service";
import { COMMAND_BINDINGS, type CommandBindings } from "./grammar.ports";
import { CHAT_GRAMMAR, GRAMMAR } from "./grammar.registry";

/**
 * BetterAuth's service, as the application's global `BetterAuthModule` provides it. `pause all`
 * shares the lifecycle plane's module, whose fresh-credential check injects it; a testing
 * container is given a stand-in because the real one needs a database. Everything else below is
 * the real graph.
 */
@Global()
@Module({
  providers: [{ provide: BetterAuth, useValue: {} }],
  exports: [BetterAuth],
})
class BetterAuthStandInModule {}

describe("ChatopsModule", () => {
  it("resolves the dispatcher over the real grammar and the planes' real bindings", async () => {
    // The dispatcher refuses to be constructed over a binding the grammar does not define, or
    // an available command with no binding — so compiling the module is the proof that the
    // registry and the planes side agree, at boot rather than at the first person who types.
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigurationModule.forRoot(testConfiguration()),
        BetterAuthStandInModule,
        ChatopsModule,
      ],
    }).compile();

    expect(moduleRef.get(ChatDispatcher)).toBeInstanceOf(ChatDispatcher);
    expect(moduleRef.get(ChatopsController)).toBeInstanceOf(ChatopsController);
    expect(moduleRef.get(CHAT_GRAMMAR)).toBe(GRAMMAR);

    const bindings = moduleRef.get<CommandBindings>(COMMAND_BINDINGS, { strict: false });

    expect(bindings.map((binding) => binding.command).sort()).toEqual(
      GRAMMAR.commands
        .filter((command) => command.stage === "available")
        .map((command) => command.id)
        .sort(),
    );

    await moduleRef.close();
  });

  it("exports the dispatcher and nothing else", () => {
    expect(Reflect.getMetadata("exports", ChatopsModule)).toEqual([ChatDispatcher]);
  });

  it("imports no plane and not the Slack adapter — only the store, the audit plane and its own planes side", () => {
    const imports = (Reflect.getMetadata("imports", ChatopsModule) as { name?: string }[]).map(
      (imported) => imported.name,
    );

    expect(imports).toEqual(["DbModule", "AuditModule", "SlackStoreModule", "ChatopsPlanesModule"]);
  });
});
