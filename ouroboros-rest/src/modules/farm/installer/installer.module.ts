import { Module } from "@nestjs/common";

import { InstallScriptController, RunnerReleaseController } from "./installer.controller";
import { InstallerService } from "./installer.service";

/**
 * The runner installer, served from this deployment's own origin (AG.6,
 * [#248](https://github.com/NobuData/ouroboros/issues/248)): `GET /install.sh` and the release
 * files beside it.
 *
 * A module of its own rather than more of `FarmModule`, because it shares nothing with it but
 * the subject. It reads no table, holds no secret and signs nothing — its whole input is two
 * settings and a directory of released files — so importing the CA's module to serve a shell
 * script would give the script's routes a dependency on the vault for no reason.
 */
@Module({
  controllers: [InstallScriptController, RunnerReleaseController],
  providers: [InstallerService],
  // Exported for AH.6 ([#254](https://github.com/NobuData/ouroboros/issues/254)) and nothing
  // else: the enroll card renders a command that has to name this deployment's origin and the
  // release it would install, and those are the two facts this service already resolves for
  // `GET /install.sh`. A second resolution of them would be a card whose one-liner pinned a
  // version the installer route does not serve.
  exports: [InstallerService],
})
export class FarmInstallerModule {}
