import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { MAX_LIMIT } from "../tenancy/pagination";
import { ListAuditQuery, MAX_ACTOR_ID_LENGTH } from "./audit.dto";

/**
 * The trail's query grammar, and the one decision worth defending in it.
 *
 * **A filter naming an event this service never writes is a `422`, not an empty page.** The
 * two are the same answer to a client and very different answers to a person:
 * `?action=provider.reveal` is a misspelling, and a trail that returned nothing for it would
 * be telling somebody a workspace is clean when it has not been asked the right question.
 *
 * The window parameters are `PageQuery`'s and are asserted here only where this class extends
 * it, because the #31 convention has its own suite.
 */

/** Validate a query the way the pipe would, and report which fields were refused. */
async function refusalsOf(query: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(ListAuditQuery, query));

  return errors.map((error) => error.property).sort();
}

describe("the trail's query", () => {
  it("accepts an empty one, which is what the sheet asks for", async () => {
    await expect(refusalsOf({})).resolves.toEqual([]);
  });

  it("accepts the three filters AD.4 names", async () => {
    await expect(
      refusalsOf({
        connectionId: "5eed000c-0000-4000-8000-000000000001",
        actorId: "5eed0003-0000-4000-8000-000000000001",
        action: "provider.revealed",
      }),
    ).resolves.toEqual([]);
  });

  it("refuses a connection filter that could not name a row", async () => {
    // A uuid check for the reason `ConnectionParams.id` has one: a value that cannot name a
    // row is refused before a statement is issued.
    await expect(refusalsOf({ connectionId: "the-anthropic-one" })).resolves.toEqual([
      "connectionId",
    ]);
  });

  it("accepts an actor id that is not a uuid, because BetterAuth does not promise one", async () => {
    // A `"user".id` is text the library mints. It preserved uuids at the V006 cut-over and
    // does not undertake to keep doing so, and a uuid rule here would be this module
    // inventing a constraint the library does not make.
    await expect(refusalsOf({ actorId: "aBcD1234eFgH5678iJkL9012mNoP3456" })).resolves.toEqual([]);
  });

  it("bounds the actor id, because a filter is not a place to send a megabyte", async () => {
    await expect(refusalsOf({ actorId: "" })).resolves.toEqual(["actorId"]);
    await expect(refusalsOf({ actorId: "x".repeat(MAX_ACTOR_ID_LENGTH + 1) })).resolves.toEqual([
      "actorId",
    ]);
  });

  it("refuses an action outside the vocabulary", async () => {
    // The decision this suite exists for. See the header.
    await expect(refusalsOf({ action: "provider.reveal" })).resolves.toEqual(["action"]);
    await expect(refusalsOf({ action: "provider.everything" })).resolves.toEqual(["action"]);
    await expect(refusalsOf({ action: "Provider.Revealed" })).resolves.toEqual(["action"]);
  });

  it("accepts every action the service can write", async () => {
    // The other half: a name this service writes and this filter refuses would be an event
    // recorded and unfindable.
    for (const action of [
      "provider.added",
      "provider.revealed",
      "provider.rotated",
      "provider.enabled",
      "provider.disabled",
      "provider.cap_changed",
      "provider.updated",
      "provider.deleted",
      "provider.tested",
      "credential.lease_granted",
    ]) {
      await expect(refusalsOf({ action })).resolves.toEqual([]);
    }
  });

  it("still carries the #31 window, with its ceiling", async () => {
    // `?limit=1000000` is a client asking this service to hold a table in memory and
    // serialise it, and the request that does it is indistinguishable from a mistake in a
    // loop.
    await expect(refusalsOf({ limit: MAX_LIMIT })).resolves.toEqual([]);
    await expect(refusalsOf({ limit: MAX_LIMIT + 1 })).resolves.toEqual(["limit"]);
    await expect(refusalsOf({ offset: -1 })).resolves.toEqual(["offset"]);
  });

  it("reads the window's numbers out of a query string", async () => {
    // A query string carries strings, and `@Type(() => Number)` is what makes `@IsInt` about
    // the number. Without it every numeric parameter would fail its own validation.
    await expect(refusalsOf({ limit: "10", offset: "20" })).resolves.toEqual([]);
  });
});
