import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { OrgPolicyController } from "./org-policy.controller";
import { OrgPolicyRepository } from "./org-policy.repository";
import { OrgPolicyService } from "./org-policy.service";
import { PoliciesModule } from "./policies.module";
import { PolicyController } from "./policy.controller";
import { PolicyPublishService } from "./policy-publish.service";
import { PolicyResolutionService } from "./policy-resolution.service";

/** The wiring (BA.3, #382; the org policy document, BQ.2, #481). Nothing connects: `pg` connects lazily. */

describe("the policies module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), PoliciesModule],
    }).compile();

    expect(moduleRef.get(OrgPolicyController)).toBeInstanceOf(OrgPolicyController);
    expect(moduleRef.get(OrgPolicyService)).toBeInstanceOf(OrgPolicyService);
    expect(moduleRef.get(OrgPolicyRepository)).toBeInstanceOf(OrgPolicyRepository);
    expect(moduleRef.get(PolicyController)).toBeInstanceOf(PolicyController);
    expect(moduleRef.get(PolicyPublishService)).toBeInstanceOf(PolicyPublishService);
    expect(moduleRef.get(PolicyResolutionService)).toBeInstanceOf(PolicyResolutionService);

    await moduleRef.close();
  });

  it("exports the dry-run policy and the resolver — enforcement sits below the surfaces", () => {
    expect(Reflect.getMetadata("exports", PoliciesModule)).toEqual([
      OrgPolicyService,
      PolicyResolutionService,
    ]);
  });
});
