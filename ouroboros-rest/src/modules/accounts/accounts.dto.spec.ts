import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { AddPreapprovedEmailDto, ListAccountsQuery, MAX_NOTE_LENGTH } from "./accounts.dto";

/** The admin routes' validation: V149's constraints restated as `422`s that name the field. */

/** The messages validating a body produces, by property. */
function failures<T extends object>(type: new () => T, body: object): Record<string, string[]> {
  const errors = validateSync(plainToInstance(type, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  return Object.fromEntries(
    errors.map((error) => [error.property, Object.values(error.constraints ?? {})]),
  );
}

describe("the list query", () => {
  it.each(["pending", "denied", "approved", undefined])("accepts status %s", (status) => {
    expect(failures(ListAccountsQuery, status === undefined ? {} : { status })).toEqual({});
  });

  it("refuses a status V149 does not hold", () => {
    expect(failures(ListAccountsQuery, { status: "waiting" }).status).toEqual([
      "status must be one of approved, pending, denied",
    ]);
  });
});

describe("pre-approving an address", () => {
  it("trims and lower-cases the address", () => {
    const dto = plainToInstance(AddPreapprovedEmailDto, { email: "  Lee@Acme-Robotics.dev " });

    expect(dto.email).toBe("lee@acme-robotics.dev");
    expect(validateSync(dto)).toEqual([]);
  });

  it.each(["not-an-address", "Lee <lee@acme.dev>", "a b@acme.dev", "", 42])(
    "refuses %p",
    (email) => {
      expect(failures(AddPreapprovedEmailDto, { email }).email).toContain(
        "email must be an email address",
      );
    },
  );

  it("refuses an address longer than 320 characters", () => {
    expect(failures(AddPreapprovedEmailDto, { email: `${"a".repeat(320)}@x.dev` }).email).toContain(
      "email must be at most 320 characters",
    );
  });

  it("takes an optional note of at most 200 characters", () => {
    expect(failures(AddPreapprovedEmailDto, { email: "a@b.dev", note: "starts Monday" })).toEqual(
      {},
    );
    expect(failures(AddPreapprovedEmailDto, { email: "a@b.dev", note: null })).toEqual({});
    expect(
      failures(AddPreapprovedEmailDto, { email: "a@b.dev", note: "n".repeat(MAX_NOTE_LENGTH + 1) })
        .note,
    ).toEqual(["note must be at most 200 characters"]);
  });

  it("refuses a field it does not know", () => {
    expect(failures(AddPreapprovedEmailDto, { email: "a@b.dev", role: "owner" })).toHaveProperty(
      "role",
    );
  });
});
