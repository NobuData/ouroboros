import { Reflector } from "@nestjs/core";

import type { Organization } from "../db/schema";
import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import type { Resolution } from "./resolution";
import { ResolutionService } from "./resolution.service";
import { SimulateController } from "./simulate.controller";
import type { SimulateRoutingDto } from "./simulate.dto";

/**
 * **Simulate routing**'s declarations, and the one structural claim the ticket is measured on
 * ([#197](https://github.com/NobuData/ouroboros/issues/197)).
 *
 * The acceptance criterion reads *"simulation calls the same `ResolutionService` as execution
 * will — verified structurally, not by comment"*, and a criterion phrased that way cannot be
 * satisfied by a test that mocks a service and checks it was called: that proves the handler
 * calls *something*. What proves it calls the **only** thing is the dependency list — a
 * controller with one injected token has nowhere to keep a second answer — so this suite reads
 * the constructor's design-time parameter types and asserts they are exactly
 * `[ResolutionService]`. A repository injected here to "make the panel faster" fails it.
 *
 * Beside that, the two things a controller spec in this service is for
 * (`routing.controller.spec.ts` carries the argument): **the role gate** — simulating is
 * reading, so this route carries no `@Roles()` and any member may — and **the workspace**,
 * which is the guard's and never the body's.
 */

const WORKSPACE = { id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10" } as Organization;

/** What the service answers with. Its shape is `resolve.spec.ts`'s business, not this file's. */
const RESOLVED = { taskKind: "review", outcome: "resolved" } as Resolution;

describe("the simulate controller", () => {
  let resolution: jest.Mocked<ResolutionService>;
  let controller: SimulateController;

  beforeEach(() => {
    resolution = {
      resolve: jest.fn().mockResolvedValue(RESOLVED),
    } as unknown as jest.Mocked<ResolutionService>;

    controller = new SimulateController(resolution);
  });

  describe("what it is wired to", () => {
    it("injects the resolution service and nothing else", () => {
      // The ticket's structural criterion. `design:paramtypes` is what Nest itself reads to
      // construct this class, so this is the dependency graph rather than a description of it.
      const injected = Reflect.getMetadata("design:paramtypes", SimulateController) as unknown[];

      expect(injected).toEqual([ResolutionService]);
    });
  });

  describe("simulating", () => {
    it("resolves the asked-for kind under the workspace the guard established", async () => {
      const body: SimulateRoutingDto = { taskKind: "review", ctx: { labels: ["security"] } };

      await expect(controller.simulate(WORKSPACE, body)).resolves.toBe(RESOLVED);

      expect(resolution.resolve).toHaveBeenCalledWith(WORKSPACE.id, "review", {
        labels: ["security"],
      });
    });

    it("asks with an empty context when the body carries none", async () => {
      // Absence is a real question — it means *no escalation rule fires* — so it is asked as
      // `{}` rather than left to a default a caller cannot see.
      await controller.simulate(WORKSPACE, { taskKind: "docs" });

      expect(resolution.resolve).toHaveBeenCalledWith(WORKSPACE.id, "docs", {});
    });

    it("returns what the service answered, unchanged", async () => {
      // Not `toEqual`: the resolution is served as it is, and an identity check is what says
      // there is no mapper between the engine's answer and the endpoint's.
      const answer = await controller.simulate(WORKSPACE, { taskKind: "review" });

      expect(answer).toBe(RESOLVED);
    });
  });

  describe("who may ask", () => {
    it("asks for no role at all, because simulating is reading", () => {
      // A bare route is any of the four roles, per the roles guard's own rule — which is the
      // ticket's *"member role can simulate"*, enforced by the absence being deliberate.
      expect(new Reflector().get<string[]>(REQUIRED_ROLES, controller.simulate)).toBeUndefined();
    });
  });
});
