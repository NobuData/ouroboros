import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { OrgPolicyController } from "./org-policy.controller";
import { OrgPolicyRepository } from "./org-policy.repository";
import { OrgPolicyService } from "./org-policy.service";
import { PoliciesModule } from "./policies.module";

/** The wiring (BA.3, #382). Nothing connects: `pg` connects lazily. */

describe("the policies module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), PoliciesModule],
    }).compile();

    expect(moduleRef.get(OrgPolicyController)).toBeInstanceOf(OrgPolicyController);
    expect(moduleRef.get(OrgPolicyService)).toBeInstanceOf(OrgPolicyService);
    expect(moduleRef.get(OrgPolicyRepository)).toBeInstanceOf(OrgPolicyRepository);

    await moduleRef.close();
  });

  it("exports the policy service — enforcement sits below the surfaces", () => {
    expect(Reflect.getMetadata("exports", PoliciesModule)).toEqual([OrgPolicyService]);
  });
});
