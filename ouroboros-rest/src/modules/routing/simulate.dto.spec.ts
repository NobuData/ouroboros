import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { QUEUE_EFFORTS } from "../db/schema";
import { fieldMessages } from "../errors/validation";
import { MAX_ROUTING_NAME_LENGTH } from "./routing.dto";
import {
  MAX_CONTEXT_LABELS,
  MAX_LABEL_LENGTH,
  MAX_REPO_LENGTH,
  SimulateRoutingDto,
} from "./simulate.dto";

/**
 * What a simulation may ask ([#197](https://github.com/NobuData/ouroboros/issues/197)).
 *
 * The pipe is configured once in `errors/validation.ts` and its behaviour is that file's to
 * prove; this asserts the decorators, which is what the pipe reads. Three of them are about
 * this ticket rather than housekeeping:
 *
 *   * **the four seeded contexts are accepted** — the empty one, and the three the acceptance
 *     criteria name (`{effort: "l"}`, `{labels: ["security"]}`, `{diff_kind: "docs_only"}` as
 *     the contract spells it) — because a rule that cannot be triggered through the endpoint
 *     is a rule the simulate panel cannot demonstrate;
 *   * **a fifth context fact is refused rather than ignored.** V018's predicate grammar is
 *     closed at three conditions, so a `{priority: "high"}` a client invented can never be
 *     read by any rule, and being told beats believing it was honoured; and
 *   * **`null` is refused everywhere**, which is the distinction `simulate.dto.ts`'s header
 *     draws: an absent fact is *unknown* and takes a documented path through `context.ts`; a
 *     `null` is a client saying something a context cannot mean.
 */

/** The complaints about one body, keyed the way a `422`'s `details` keys them. */
function complaints(body: Record<string, unknown>): Record<string, string[]> {
  return fieldMessages(
    validateSync(plainToInstance(SimulateRoutingDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
}

/** A well-formed request, with whatever context the case is about. */
function simulation(ctx?: Record<string, unknown>): Record<string, unknown> {
  return ctx === undefined ? { taskKind: "review" } : { taskKind: "review", ctx };
}

describe("a simulation request", () => {
  it("accepts a kind with no context at all", () => {
    // The DSL's `route.task("docs")` before anything has been sized or labelled. A legitimate
    // question, and it means *no escalation rule fires*.
    expect(complaints(simulation())).toEqual({});
  });

  it("accepts the empty context, which asks the same thing explicitly", () => {
    expect(complaints(simulation({}))).toEqual({});
  });

  it.each([
    ["an effort", { effort: "l" }],
    ["a label", { labels: ["security"] }],
    ["a diff kind", { diffKind: "docs_only" }],
    ["a repository", { repo: "acme-robotics/control-plane" }],
    [
      "all four at once",
      { effort: "xl", labels: ["security", "infra"], diffKind: "docs_only", repo: "acme/x" },
    ],
  ])("accepts a context carrying %s", (_what, ctx) => {
    expect(complaints(simulation(ctx))).toEqual({});
  });

  it.each(QUEUE_EFFORTS)("accepts %s, because the scale is V009's five sizes", (effort) => {
    expect(complaints(simulation({ effort }))).toEqual({});
  });

  it("refuses a size that is not on the scale, naming the field", () => {
    // `xxl` is a size somebody might reasonably expect. It is not one V009 has, and a rule
    // reading `effort_gte` could never be written against it.
    expect(Object.keys(complaints(simulation({ effort: "xxl" })))).toEqual(["ctx.effort"]);
  });

  it("refuses a diff classification nothing computes", () => {
    expect(Object.keys(complaints(simulation({ diffKind: "tests_only" })))).toEqual([
      "ctx.diffKind",
    ]);
  });

  it("refuses a fact no escalation rule could ever read", () => {
    // V018's grammar is closed over three conditions. A fourth is refused rather than dropped,
    // which is what stops a client believing an invented field is being honoured.
    expect(Object.keys(complaints(simulation({ priority: "high" })))).toEqual(["ctx.priority"]);
  });

  it("refuses a body field this endpoint does not take", () => {
    // Notably `organizationId`: the workspace is the session's, and a body that could name one
    // would be a body that could simulate somebody else's routes.
    expect(Object.keys(complaints({ taskKind: "review", organizationId: "other" }))).toEqual([
      "organizationId",
    ]);
  });

  it.each([
    ["effort", { effort: null }],
    ["labels", { labels: null }],
    ["diffKind", { diffKind: null }],
    ["repo", { repo: null }],
  ])("refuses an explicit null %s rather than reading it as absent", (field, ctx) => {
    expect(Object.keys(complaints(simulation(ctx)))).toEqual([`ctx.${field}`]);
  });

  it("refuses a context that is not an object", () => {
    // Without the `@IsObject()` ahead of the nested validator, `"large"` would reach it with
    // none of the declared properties and pass — refused for the wrong reason is still wrong.
    expect(Object.keys(complaints({ taskKind: "review", ctx: "large" }))).toEqual(["ctx"]);
  });

  describe("the task kind", () => {
    it("is required", () => {
      expect(Object.keys(complaints({}))).toEqual(["taskKind"]);
    });

    it("must be the shape a `task_kinds.name` has", () => {
      // V016 constrains the column to lower-case kebab, so `Implement` names something no row
      // could hold — a `422` here rather than a round trip that ends in a `404`.
      expect(Object.keys(complaints({ taskKind: "Implement" }))).toEqual(["taskKind"]);
    });

    it("is bounded by the column's own length", () => {
      expect(
        Object.keys(complaints({ taskKind: "a".repeat(MAX_ROUTING_NAME_LENGTH + 1) })),
      ).toEqual(["taskKind"]);
    });
  });

  describe("labels", () => {
    it("accepts as many as the bound allows", () => {
      const labels = Array.from(
        { length: MAX_CONTEXT_LABELS },
        (_, index) => `label-${String(index)}`,
      );

      expect(complaints(simulation({ labels }))).toEqual({});
    });

    it("refuses more, so one body cannot ask for unbounded comparison", () => {
      const labels = Array.from(
        { length: MAX_CONTEXT_LABELS + 1 },
        (_, index) => `l${String(index)}`,
      );

      expect(Object.keys(complaints(simulation({ labels })))).toEqual(["ctx.labels"]);
    });

    it("refuses a padded label, which could match no rule the database will store", () => {
      expect(Object.keys(complaints(simulation({ labels: [" security"] })))).toEqual([
        "ctx.labels",
      ]);
    });

    it("refuses a label longer than V018 stores", () => {
      expect(
        Object.keys(complaints(simulation({ labels: ["a".repeat(MAX_LABEL_LENGTH + 1)] }))),
      ).toEqual(["ctx.labels"]);
    });

    it("accepts an empty array, which is an issue with no labels", () => {
      expect(complaints(simulation({ labels: [] }))).toEqual({});
    });
  });

  describe("the repository", () => {
    it("is bounded by GitHub's own ceiling for owner/name", () => {
      expect(
        Object.keys(complaints(simulation({ repo: "a".repeat(MAX_REPO_LENGTH + 1) }))),
      ).toEqual(["ctx.repo"]);
    });

    it("is otherwise unshaped, because nothing reads it yet", () => {
      // A pattern here would be this DTO choosing a shape AB.5 (#211) has not chosen, and
      // refusing contexts a consumer holding the repository today is right to send.
      expect(complaints(simulation({ repo: "internal-mirror/acme.control-plane" }))).toEqual({});
    });
  });
});
