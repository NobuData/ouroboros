import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  StreamableFile,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { Response } from "express";

import { releaseNotFound } from "../farm.errors";
import { INSTALL_SCRIPT_ROUTE, RELEASE_FILE_ROUTE, RELEASES_ROUTE } from "./installer.paths";
import { SHELL_SCRIPT_MEDIA_TYPE } from "./installer.release";
import { InstallerService } from "./installer.service";

/**
 * The response header both installer routes set: the release's version, so a person running
 * `curl -I` can see what a command would install without reading the script.
 */
export const RELEASE_VERSION_HEADER = "X-Ouro-Runner-Version";

/**
 * `GET /install.sh` — the build farm's one-liner (AG.6,
 * [#248](https://github.com/NobuData/ouroboros/issues/248)).
 *
 * `curl -fsSL 'https://<deployment>/install.sh?version=<v>' | sh -s -- --tenant … --pool …
 * --token …` — the command the enroll card renders
 * ([#258](https://github.com/NobuData/ouroboros/issues/258)), with this deployment's own origin
 * and a pinned version, so two runners enrolled a month apart are the same build.
 *
 * **`@AllowAnonymous()`, and it has to be.** The caller is `curl` on a machine that is about to
 * become a runner: it holds no session and could not be given one. Nothing here is worth
 * protecting — the script is a released file, public in the repository, with this deployment's
 * public address written into it — and what enrols the machine afterwards is the enrollment
 * token in the command, spent against `POST /api/v1/farm/registrations`. See
 * `route.table.fixture.ts`, where making it public is recorded.
 *
 * `VERSION_NEUTRAL` and outside `/api` for the reason `installer.paths.ts` gives.
 */
@AllowAnonymous()
@Controller({ path: INSTALL_SCRIPT_ROUTE, version: VERSION_NEUTRAL })
export class InstallScriptController {
  /** @param installer - Reads the release and fills the origin in. */
  constructor(private readonly installer: InstallerService) {}

  /**
   * The installer, filled in with this deployment's origin.
   *
   * @param version - `?version=`, the release to install; the newest stable one when absent.
   *   Anything but one string is not a version this could serve.
   * @param response - For the headers, set once the release is known.
   * @returns The script, as `text/x-shellscript`.
   */
  @Get()
  async script(
    @Query("version") version: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    if (version !== undefined && typeof version !== "string") {
      throw releaseNotFound(JSON.stringify(version));
    }

    const script = await this.installer.script(version);
    // Set here, once there is a script, rather than by `@Header()`: a decorator's headers are
    // on the response before the handler runs, so a refusal would go out as JSON labelled a
    // shell script.
    response.setHeader("Content-Type", SHELL_SCRIPT_MEDIA_TYPE);
    response.setHeader(RELEASE_VERSION_HEADER, script.version);
    // Not cached: without `?version=` the answer changes the moment a release is copied in.
    response.setHeader("Cache-Control", "no-cache");

    return script.body;
  }
}

/**
 * `GET /runner/<version>/<file>` — one file of a release, as the release holds it (AG.6,
 * [#248](https://github.com/NobuData/ouroboros/issues/248)).
 *
 * What the installer downloads: this platform's binary and `SHA256SUMS`, which it verifies
 * the binary against before running anything. Served from this deployment rather than from a
 * public host, so a build machine behind a firewall needs a route to nothing but the control
 * plane it is about to connect to anyway. Every file is served unchanged, so each one is the
 * file `SHA256SUMS` names.
 *
 * `@AllowAnonymous()` for {@link InstallScriptController}'s reason: the reader is `curl`, and
 * a release is public.
 */
@AllowAnonymous()
@Controller({ path: RELEASES_ROUTE, version: VERSION_NEUTRAL })
export class RunnerReleaseController {
  /** @param installer - Finds the file. */
  constructor(private readonly installer: InstallerService) {}

  /**
   * One release file.
   *
   * @param version - The release, a semantic version.
   * @param file - One of the five files a release holds.
   * @param response - For the headers that depend on which file it is.
   * @returns The file, streamed.
   */
  @Get(RELEASE_FILE_ROUTE)
  async file(
    @Param("version") version: string,
    @Param("file") file: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const release = await this.installer.releaseFile(version, file);
    response.setHeader(RELEASE_VERSION_HEADER, version);
    // Revalidated rather than cached for a year: ci/runner never replaces a published
    // release, but an operator can overwrite a directory here, and a cache holding the old
    // binary beside the new SHA256SUMS is an install that fails its own checksum.
    response.setHeader("Cache-Control", "no-cache");

    return new StreamableFile(release.open(), {
      type: release.mediaType,
      length: release.size,
      disposition: `attachment; filename="${release.name}"`,
    });
  }
}
