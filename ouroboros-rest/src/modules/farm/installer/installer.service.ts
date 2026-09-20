import { createReadStream, type ReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { Injectable } from "@nestjs/common";

import { AppConfigService } from "../../config/config.service";
import { enrollCommandUnavailable, installerUnavailable, releaseNotFound } from "../farm.errors";
import {
  INSTALL_SCRIPT_FILE,
  RELEASE_FILES,
  fillServer,
  installerOrigin,
  isReleaseFile,
  isReleaseVersion,
  newestRelease,
} from "./installer.release";

/** The installer, ready to send. */
export interface InstallScript {
  /** The release it came from — the version it installs. */
  readonly version: string;
  /** The script, with this deployment's origin filled in. */
  readonly body: string;
}

/** Where an enroll command points, and at which release. */
export interface EnrollTarget {
  /** The https origin runner machines reach this deployment at. */
  readonly origin: string;
  /** The newest stable release here — what the command pins with `?version=`. */
  readonly version: string;
}

/** One release file, ready to stream. */
export interface ReleaseFile {
  /** Its name, for `Content-Disposition`. */
  readonly name: string;
  /** Its media type, from {@link RELEASE_FILES}. */
  readonly mediaType: string;
  /** Its length in bytes, for `Content-Length`. */
  readonly size: number;
  /** Opens it. Called once the file is known to be there, so a missing one is a `404`. */
  readonly open: () => ReadStream;
}

/**
 * Serves the runner installer and its releases from this deployment's own origin (AG.6,
 * [#248](https://github.com/NobuData/ouroboros/issues/248)).
 *
 * **It reads the releases directory on every request, and holds nothing.** An operator adds a
 * release by copying a directory in, and that should be served at once rather than after a
 * restart; the directory is a handful of entries, and `/install.sh` is called once per machine
 * enrolled, so there is nothing a cache would save.
 *
 * **Nothing a request sends becomes a path.** A version is used only once it parses as SemVer,
 * which has no `/`, and a file only once it is one of the five names a release holds — so the
 * only paths this ever opens are `<releases>/<semver>/<one of five>`.
 */
@Injectable()
export class InstallerService {
  /** @param config - For the releases directory and the origin to fill in. */
  constructor(private readonly config: AppConfigService) {}

  /**
   * The installer, filled in with this deployment's origin.
   *
   * @param version - The release asked for, or `undefined` for the newest stable one. The
   *   rendered enroll command always asks for one, so two machines enrolled a month apart run
   *   the same build unless somebody chose otherwise.
   * @returns The script and the version it installs.
   * @throws {NotFoundError} `farm_installer_unavailable` when this deployment is not set up to
   *   serve it, and `farm_release_not_found` when the release asked for is not here.
   */
  async script(version?: string): Promise<InstallScript> {
    const origin = installerOrigin(this.config.farmPublicUrl, this.config.restUrl);
    if (origin === undefined) {
      throw installerUnavailable(
        "The runner installer needs the https address runner machines reach this deployment at: " +
          "set OURO_FARM_PUBLIC_URL.",
      );
    }

    const root = await this.releasesRoot();
    const chosen = version ?? newestRelease(await this.releaseNames(root));
    if (chosen === undefined) {
      throw installerUnavailable(
        "This deployment has no ouroboros-runner release to install: copy one into OURO_FARM_RELEASES_DIR.",
      );
    }

    const script = await this.readRelease(root, chosen, INSTALL_SCRIPT_FILE);
    const body = fillServer(script, origin);
    if (body === undefined) {
      throw installerUnavailable(
        `The installer in ouroboros-runner release ${chosen} carries no DEFAULT_SERVER line to fill in, ` +
          "so this deployment cannot serve it.",
      );
    }

    return { version: chosen, body };
  }

  /**
   * What an enroll command should point at: this deployment, and the release it would install.
   *
   * The same two facts {@link script} resolves, without reading the script — AH.6's enroll
   * card ([#254](https://github.com/NobuData/ouroboros/issues/254)) needs the origin and the
   * version to render a one-liner, and has no use for the hundreds of lines of shell that
   * one-liner downloads. Resolved through the same helpers, so the version the card pins is
   * the version `GET /install.sh` with no query would have served.
   *
   * **Pinned deliberately.** A command with no `?version=` would install whatever was newest
   * on the day it was *run* rather than the day it was *copied*, and two machines enrolled a
   * month apart from one pasted command would be two different builds.
   *
   * @returns The origin and the release.
   * @throws {NotFoundError} `farm_enroll_command_unavailable` when this deployment has no
   *   https origin to name, or no release to install. Distinct from
   *   `farm_installer_unavailable` because the caller is the enroll card rather than `curl`
   *   on a build machine — `farm.errors.ts` says why that is worth two codes.
   */
  async enrollTarget(): Promise<EnrollTarget> {
    const origin = installerOrigin(this.config.farmPublicUrl, this.config.restUrl);
    if (origin === undefined) {
      throw enrollCommandUnavailable(
        "This deployment cannot render an enroll command: it does not know the https address " +
          "runner machines reach it at. Set OURO_FARM_PUBLIC_URL.",
      );
    }

    const version = newestRelease(await this.releaseNames(await this.releasesRoot()));
    if (version === undefined) {
      throw enrollCommandUnavailable(
        "This deployment has no ouroboros-runner release to install, so an enroll command " +
          "would download nothing. Copy one into OURO_FARM_RELEASES_DIR.",
      );
    }

    return { origin, version };
  }

  /**
   * One file of a release, exactly as the release holds it.
   *
   * Unchanged, the installer included, so that every file here is the one `SHA256SUMS` names
   * and a machine can verify what it downloaded against it.
   *
   * @param version - The release.
   * @param name - The file, one of {@link RELEASE_FILES}.
   * @returns The file, ready to stream.
   * @throws {NotFoundError} `farm_installer_unavailable` when this deployment serves no
   *   releases, and `farm_release_not_found` when the release or the file is not here.
   */
  async releaseFile(version: string, name: string): Promise<ReleaseFile> {
    const root = await this.releasesRoot();
    if (!isReleaseVersion(version)) throw releaseNotFound(version);
    if (!isReleaseFile(name)) throw releaseNotFound(version, name);

    const path = join(root, version, name);
    const size = await fileSize(path);
    if (size === undefined) throw releaseNotFound(version, name);

    return {
      name,
      mediaType: RELEASE_FILES[name],
      size,
      open: () => createReadStream(path),
    };
  }

  /**
   * The releases directory, resolved — or the reason there is none.
   *
   * @returns Its absolute path.
   * @throws {NotFoundError} `farm_installer_unavailable` when it is unset or is not a directory.
   */
  private async releasesRoot(): Promise<string> {
    const configured = this.config.farmReleasesDir;
    if (configured === undefined) {
      throw installerUnavailable(
        "This deployment serves no runner installer: OURO_FARM_RELEASES_DIR is not set.",
      );
    }

    const root = resolve(configured);
    const info = await stat(root).catch(() => undefined);
    if (!info?.isDirectory()) {
      throw installerUnavailable(
        "This deployment serves no runner installer: OURO_FARM_RELEASES_DIR is not a directory it can read.",
      );
    }

    return root;
  }

  /**
   * The names of the release directories under the root.
   *
   * @param root - The releases directory.
   * @returns Every subdirectory whose name is a version.
   */
  private async releaseNames(root: string): Promise<string[]> {
    const entries = await readdir(root, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isDirectory() && isReleaseVersion(entry.name))
      .map((entry) => entry.name);
  }

  /**
   * Read one text file of a release.
   *
   * @param root - The releases directory.
   * @param version - The release; checked here, before it is joined into anything.
   * @param name - The file.
   * @returns Its contents.
   * @throws {NotFoundError} `farm_release_not_found` when the release or the file is not here.
   */
  private async readRelease(root: string, version: string, name: string): Promise<string> {
    if (!isReleaseVersion(version)) throw releaseNotFound(version);

    const text = await readFile(join(root, version, name), "utf8").catch(() => undefined);
    if (text === undefined) throw releaseNotFound(version);

    return text;
  }
}

/**
 * A regular file's size, or nothing.
 *
 * @param path - The file.
 * @returns Its size in bytes, or `undefined` when it is not there or is not a regular file.
 */
async function fileSize(path: string): Promise<number | undefined> {
  const info = await stat(path).catch(() => undefined);

  return info?.isFile() ? info.size : undefined;
}
