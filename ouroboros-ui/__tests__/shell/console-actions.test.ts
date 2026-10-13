import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { TICKETS, completions, grammar, record, result } from "../helpers/console";

/**
 * The console's four server hops (#539): each answers the payload, and a refusal comes back as
 * `{ error, code }` carrying the service's own sentence — never as a throw the palette would
 * have to catch.
 */

const read = vi.fn();
const complete = vi.fn();
const run = vi.fn();
const command = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/console", () => ({
  consoleApi: {
    grammar: () => read(),
    completions: (text: unknown) => complete(text),
    run: (text: unknown) => run(text),
    command: (id: unknown) => command(id),
  },
}));

const { readConsoleCommand, readConsoleCompletions, readConsoleGrammar, runConsoleCommand } =
  await import("@/app/shell/console-actions");

beforeEach(() => {
  for (const mock of [read, complete, run, command]) mock.mockReset();
});

describe("the console's calls", () => {
  it("answer the payload the service returned", async () => {
    read.mockResolvedValueOnce(grammar());
    complete.mockResolvedValueOnce(completions("queue", "ticket", TICKETS));
    run.mockResolvedValueOnce(result());
    command.mockResolvedValueOnce(record());

    expect(await readConsoleGrammar()).toEqual(grammar());
    expect(await readConsoleCompletions("queue #4")).toEqual(completions("queue", "ticket", TICKETS));
    expect(await runConsoleCommand("status")).toEqual(result());
    expect(await readConsoleCommand("command-1")).toEqual(record());

    expect(complete).toHaveBeenCalledWith("queue #4");
    expect(run).toHaveBeenCalledWith("status");
    expect(command).toHaveBeenCalledWith("command-1");
  });

  it("turn the service's refusal into its sentence and its code", async () => {
    read.mockRejectedValueOnce(new ApiError(500, "internal_error", "The service itself failed."));
    complete.mockRejectedValueOnce(new ApiError(500, "internal_error", "The service itself failed."));
    run.mockRejectedValueOnce(
      new ApiError(422, "validation_failed", "A command may be at most 2000 characters."),
    );
    command.mockRejectedValueOnce(new ApiError(404, "chat_command_not_found", "No such command."));

    expect(await readConsoleGrammar()).toEqual({
      error: "The service itself failed.",
      code: "internal_error",
    });
    expect(await readConsoleCompletions("queue ")).toEqual({
      error: "The service itself failed.",
      code: "internal_error",
    });
    expect(await runConsoleCommand("x")).toEqual({
      error: "A command may be at most 2000 characters.",
      code: "validation_failed",
    });
    expect(await readConsoleCommand("gone")).toEqual({
      error: "No such command.",
      code: "chat_command_not_found",
    });
  });

  it("answer a caller that is not a person in the service's words", async () => {
    run.mockRejectedValueOnce(
      new ApiError(403, "chat_person_required", "Commands are run by people, not by service tokens."),
    );

    expect(await runConsoleCommand("status")).toEqual({
      error: "Commands are run by people, not by service tokens.",
      code: "chat_person_required",
    });
  });

  it("rethrow anything that was not an answer from the service", async () => {
    run.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(runConsoleCommand("status")).rejects.toThrow("fetch failed");
  });
});
