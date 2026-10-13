import type { CommandContext, ResolvedArgument } from "../grammar.types";
import { argument, optionalArgument, requesterOf, ticketReference } from "./binding.arguments";
import { APP_URL, INVOKER, LOOP, TICKET, WORKSPACE } from "./planes.fixture";

/**
 * Reading a binding's arguments (#537). A mismatch between what the registry hands over and
 * what a binding is written against is a wiring fault, never something a person typed — so it
 * is a plain `Error`, which the dispatcher records as its own failure instead of replying with.
 */

/**
 * An invocation carrying the given arguments — deliberately not held to the registry, because
 * the mismatches are what this suite is about.
 *
 * @param args - The arguments by name.
 * @returns The context.
 */
function contextWith(args: Readonly<Record<string, ResolvedArgument>>): CommandContext {
  return { organizationId: WORKSPACE, invoker: INVOKER, surface: "slack", appUrl: APP_URL, args };
}

describe("the /ouro binding arguments", () => {
  describe("argument", () => {
    it("returns the argument registered under the name", () => {
      expect(argument(contextWith({ ticket: TICKET }), "ticket", "ticket")).toBe(TICKET);
      expect(argument(contextWith({ loop: LOOP }), "loop", "loop")).toBe(LOOP);
    });

    it("throws a plain Error naming the argument when it is absent", () => {
      const read = (): unknown => argument(contextWith({}), "ticket", "ticket");

      expect(read).toThrow('The /ouro binding expected a ticket argument named "ticket".');
      expect(read).toThrow(Error);
    });

    it("throws when another type is registered under the name", () => {
      expect(() => argument(contextWith({ ticket: LOOP }), "ticket", "ticket")).toThrow(
        'The /ouro binding expected "ticket" to be a ticket argument, not loop.',
      );
    });
  });

  describe("optionalArgument", () => {
    it("is undefined for an argument that was not typed", () => {
      expect(
        optionalArgument(contextWith({ ticket: TICKET }), "workflow", "workflow"),
      ).toBeUndefined();
    });

    it("returns the argument when it was typed", () => {
      const workflow: ResolvedArgument = { type: "workflow", slug: "standard-fix" };

      expect(optionalArgument(contextWith({ workflow }), "workflow", "workflow")).toBe(workflow);
    });

    it("still refuses another type under the name: optional is not untyped", () => {
      expect(() =>
        optionalArgument(contextWith({ workflow: TICKET }), "workflow", "workflow"),
      ).toThrow('The /ouro binding expected "workflow" to be a workflow argument, not ticket.');
    });
  });

  describe("requesterOf", () => {
    it("names the person — their id, display name and roles — and never the app", () => {
      expect(requesterOf(INVOKER)).toEqual({
        id: "user-mira",
        name: "Mira Okafor",
        roles: ["admin"],
      });
    });

    it("carries nothing else of the invoker into the plane", () => {
      expect(Object.keys(requesterOf({ ...INVOKER, canApproveLoops: true })).sort()).toEqual([
        "id",
        "name",
        "roles",
      ]);
    });
  });

  describe("ticketReference", () => {
    it("names a ticket by its number, as a reply prints it", () => {
      expect(ticketReference(TICKET)).toBe("#485");
    });
  });
});
