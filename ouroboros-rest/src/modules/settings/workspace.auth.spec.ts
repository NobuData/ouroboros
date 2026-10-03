import type { AuthService as BetterAuth } from "@thallesp/nestjs-better-auth";

import type { Auth } from "../../auth/auth.factory";
import { BetterAuthWorkspaceNames } from "./workspace.auth";

describe("the BetterAuth workspace rename", () => {
  it("updates the library's organization row through its adapter, by id", async () => {
    const update = jest.fn().mockResolvedValue({});
    const betterAuth = {
      instance: { $context: Promise.resolve({ adapter: { update } }) },
    } as unknown as BetterAuth<Auth>;

    await new BetterAuthWorkspaceNames(betterAuth).rename("org-1", "Acme Robotics");

    expect(update).toHaveBeenCalledWith({
      model: "organization",
      where: [{ field: "id", value: "org-1" }],
      update: { name: "Acme Robotics" },
    });
  });
});
