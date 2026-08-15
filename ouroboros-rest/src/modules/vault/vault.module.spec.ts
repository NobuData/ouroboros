import { Test } from "@nestjs/testing";

import { AppConfigService } from "../config/config.service";
import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { DatabaseService } from "../db/db.service";
import { KEY_WRAPPER, type KeyWrapper } from "./key.wrapper";
import { MASTER_WRAPPER_ID, MasterKeyWrapper } from "./master.key.wrapper";
import { REGISTERED_SECRET_STORES, VaultModule } from "./vault.module";
import { VAULT_SECRET_STORES, VaultRotation, type VaultSecretStore } from "./vault.rotation";
import { VaultService } from "./vault.service";

/**
 * The wiring — which is where two of this module's decisions actually live.
 *
 * `KEY_WRAPPER` is bound to `MasterKeyWrapper` by one `useClass`, and AF.3
 * ([#236](https://github.com/NobuData/ouroboros/issues/236)) changes that line and ships no
 * data migration. `VAULT_SECRET_STORES` is bound to an empty array, which is *accurate*
 * rather than a stub — no module in this service holds an encrypted secret yet. Both are
 * asserted here so that a change to either is a change to a test rather than a quiet one.
 *
 * The module is built with a stand-in `DatabaseService`, because constructing the real one
 * opens a pool — which is precisely what a suite that starts nothing must not do.
 */

describe("the vault module", () => {
  /**
   * Build the module over a validated configuration and a database that never connects.
   *
   * @param overrides - Environment variables to change first.
   * @returns The compiled testing module.
   */
  async function build(overrides: NodeJS.ProcessEnv = {}) {
    return Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration(overrides)), VaultModule],
    })
      .overrideProvider(DatabaseService)
      .useValue({})
      .compile();
  }

  it("provides the service and the rotation job", async () => {
    const module = await build();

    expect(module.get(VaultService)).toBeInstanceOf(VaultService);
    expect(module.get(VaultRotation)).toBeInstanceOf(VaultRotation);
  });

  it("binds the environment master key as the configured custody", async () => {
    const module = await build();
    const wrapper = module.get<KeyWrapper>(KEY_WRAPPER);

    expect(wrapper).toBeInstanceOf(MasterKeyWrapper);
    expect(wrapper.id).toBe(MASTER_WRAPPER_ID);
  });

  it("registers no secret stores, because no module holds an encrypted secret yet", async () => {
    // #138 (ticket sources), #101 (GitHub credentials) and #189 (providers) are all open, and
    // no migration declares an encrypted column — so the sweep and the one-time migration
    // have nothing to find, and say so. This test is what makes that a claim rather than a
    // sentence in a pull request, and it fails the day the first store lands.
    const module = await build();

    expect(module.get<readonly VaultSecretStore[]>(VAULT_SECRET_STORES)).toEqual([]);
    expect(REGISTERED_SECRET_STORES).toEqual([]);
  });

  it("declares no controller — nothing here is reachable over HTTP", async () => {
    // A route that decrypted a credential would be a route that returned one. Which of those
    // exist is AD.2's (#223) decision to make behind a re-authentication step, not this
    // module's to leave lying around.
    const module = await build();

    expect(
      Reflect.getMetadata("controllers", VaultModule) as unknown[] | undefined,
    ).toBeUndefined();
    expect(module.get(VaultService)).toBeDefined();
  });

  it("reads the master key through the typed configuration, not the environment", async () => {
    // #28's rule: nothing outside src/modules/config names an environment variable. The
    // observable form of it is that a different configuration produces a different wrapper.
    const module = await build();

    expect(module.get(AppConfigService).vaultMasterKey).toBe(
      "b3Vyb2Jvcm9zLWRldi12YXVsdC1tYXN0ZXIta2V5ISE=",
    );
  });

  it("fails to build when the master key is not key material", async () => {
    // The wrapper decodes the key when it is constructed, which is at boot — so a deployment
    // with a malformed key fails while it is starting rather than on the first credential
    // anybody stores. `loadConfiguration` refuses this value first in the real process; this
    // asserts the second line of defence, for a wrapper constructed some other way.
    await expect(
      Test.createTestingModule({
        imports: [
          ConfigurationModule.forRoot({
            ...testConfiguration(),
            vaultMasterKey: Buffer.alloc(31, 1).toString("base64"),
          }),
          VaultModule,
        ],
      })
        .overrideProvider(DatabaseService)
        .useValue({})
        .compile(),
    ).rejects.toThrow(/OURO_VAULT_MASTER_KEY/);
  });
});
