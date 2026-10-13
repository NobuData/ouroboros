import { describe, expect, it, vi } from "vitest";

import type { ApiClient } from "@/app/api/client";

import { TICKETS, completions, grammar, record, result } from "../helpers/console";

/**
 * The command plane's calls (#539): each names the route the contract does, the completions
 * carry the text in the query, a line is sent as the body, and a command is read by its id.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/server", () => ({ api: () => ({}) }));

const { consoleApi } = await import("@/app/api/console");

/**
 * A client whose every verb answers one body and records how it was called.
 *
 * @param data What every call answers.
 * @returns The client and its verbs.
 */
function client(data: unknown) {
  const call = () => vi.fn().mockResolvedValue({ data, response: new Response() });
  const verbs = { GET: call(), POST: call() };

  return { verbs, client: verbs as unknown as ApiClient };
}

describe("the grammar", () => {
  it("is read from BZ.3's route, with what the caller may run on it", async () => {
    const one = client(grammar());

    expect(await consoleApi.grammar(one.client)).toEqual(grammar());
    expect(one.verbs.GET.mock.calls[0]![0]).toBe("/api/v1/chat/grammar");
  });

  it("can be aborted", async () => {
    const one = client(grammar());
    const { signal } = new AbortController();

    await consoleApi.grammar(one.client, signal);

    expect(one.verbs.GET.mock.calls[0]![1]).toEqual({ signal });
  });
});

describe("the completions", () => {
  it("are asked for with the text as typed, trailing space and all", async () => {
    const one = client(completions("queue", "ticket", TICKETS));

    expect(await consoleApi.completions("queue ", one.client)).toEqual(
      completions("queue", "ticket", TICKETS),
    );
    expect(one.verbs.GET.mock.calls[0]).toEqual([
      "/api/v1/chat/completions",
      { params: { query: { text: "queue " } }, signal: undefined },
    ]);
  });
});

describe("running a line", () => {
  it("posts what was typed after the prefix", async () => {
    const one = client(result());

    expect(await consoleApi.run("status", {}, one.client)).toEqual(result());
    expect(one.verbs.POST.mock.calls[0]).toEqual([
      "/api/v1/chat/commands",
      { body: { text: "status" } },
    ]);
  });
});

describe("a command read back", () => {
  it("is read by its id", async () => {
    const one = client(record());

    expect(await consoleApi.command("command-1", one.client)).toEqual(record());
    expect(one.verbs.GET.mock.calls[0]).toEqual([
      "/api/v1/chat/commands/{id}",
      { params: { path: { id: "command-1" } }, signal: undefined },
    ]);
  });

  it("refuses an answer with no body, as every call here does", async () => {
    const one = client(undefined);

    await expect(consoleApi.command("command-1", one.client)).rejects.toMatchObject({
      code: "client_empty_response",
    });
  });
});
