import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { OpenPullRequestDto } from "./run-pull-request.dto";

/** The draft pull-request request's shape (DI.3, #1311). */

/** The properties a body is refused on. */
function refusedOn(body: Record<string, unknown>): string[] {
  return validateSync(plainToInstance(OpenPullRequestDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).map((error) => error.property);
}

describe("an open-pull-request request", () => {
  const ASK = { idempotency_key: "run-1-pull-request-1", epoch: 1 };

  it("accepts the documented body, and one without an epoch", () => {
    expect(refusedOn(ASK)).toEqual([]);
    expect(refusedOn({ idempotency_key: "k" })).toEqual([]);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ["no key", { idempotency_key: undefined }, "idempotency_key"],
    ["an empty key", { idempotency_key: "" }, "idempotency_key"],
    ["a padded key", { idempotency_key: " k" }, "idempotency_key"],
    ["a key that is too long", { idempotency_key: "k".repeat(129) }, "idempotency_key"],
    ["a zero epoch", { epoch: 0 }, "epoch"],
    ["a fractional epoch", { epoch: 1.5 }, "epoch"],
  ])("refuses %s", (_name, override, property) => {
    expect(refusedOn({ ...ASK, ...override })).toContain(property);
  });

  it.each(["draft", "title", "body", "base", "branch"])(
    "has no %s field: the control plane decides every part of the PR",
    (field) => {
      expect(refusedOn({ ...ASK, [field]: field === "draft" ? false : "x" })).toContain(field);
    },
  );
});
