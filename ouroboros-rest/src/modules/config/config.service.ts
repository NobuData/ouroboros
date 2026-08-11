import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { listenHost, type Configuration, type NodeEnvironment } from "./configuration";
import { describeConfiguration } from "./redaction";

/**
 * The typed accessor every other module reads configuration through.
 *
 * `@nestjs/config`'s own `ConfigService` is the store underneath — it holds the validated
 * object and is what makes this a `@nestjs/config` module rather than a home-grown one —
 * and this class is the surface. The division is what buys the acceptance criterion: a
 * consumer asks for `config.databaseUrl` and gets a `string`, not `config.get("...")` and
 * a `string | undefined` it has to talk itself out of, and nothing outside this directory
 * ever names an environment variable at all.
 *
 * Everything here is a getter over already-validated data, so nothing can fail: the one
 * moment configuration can be wrong is `loadConfiguration`, in the process entry point,
 * before this provider exists.
 */
@Injectable()
export class AppConfigService {
  /**
   * @param config - Nest's configuration store, holding the validated {@link Configuration}
   *   that `ConfigurationModule.forRoot` loaded into it. The second type parameter is
   *   `true` — "this was validated" — which is what makes every `get` below return a value
   *   rather than a value-or-undefined.
   */
  constructor(private readonly config: ConfigService<Configuration, true>) {}

  /** TCP port to listen on — `PORT`. */
  get port(): number {
    return this.config.getOrThrow<number>("port");
  }

  /** Which environment this is — `NODE_ENV`. */
  get nodeEnv(): NodeEnvironment {
    return this.config.getOrThrow<NodeEnvironment>("nodeEnv");
  }

  /** PostgreSQL connection string for `ouroboros-db` — `OURO_DATABASE_URL`. */
  get databaseUrl(): string {
    return this.config.getOrThrow<string>("databaseUrl");
  }

  /** Base URL of `ouroboros-engine` — `OURO_ENGINE_URL`. */
  get engineUrl(): string {
    return this.config.getOrThrow<string>("engineUrl");
  }

  /** Value sent as `X-Ouro-Internal-Key` — `OURO_ENGINE_SHARED_SECRET`. */
  get engineSharedSecret(): string {
    return this.config.getOrThrow<string>("engineSharedSecret");
  }

  /** Signing key for the session cookie — `OURO_SESSION_SECRET`. */
  get sessionSecret(): string {
    return this.config.getOrThrow<string>("sessionSecret");
  }

  /** GitHub OAuth application, client id — `OURO_GITHUB_CLIENT_ID`. */
  get githubClientId(): string {
    return this.config.getOrThrow<string>("githubClientId");
  }

  /** GitHub OAuth application, client secret — `OURO_GITHUB_CLIENT_SECRET`. */
  get githubClientSecret(): string {
    return this.config.getOrThrow<string>("githubClientSecret");
  }

  /** Browser origins allowed to call this API with credentials — `OURO_CORS_ORIGINS`. */
  get corsOrigins(): readonly string[] {
    return this.config.getOrThrow<readonly string[]>("corsOrigins");
  }

  /**
   * Is this a production deployment?
   *
   * The one derived flag worth naming, because it is asked in several places and asking
   * it as `nodeEnv === "production"` in each of them is how one of them ends up spelling
   * it `"prod"`. It gates the cookie's `Secure` attribute and the development auth bypass
   * ([#33](https://github.com/NobuData/ouroboros/issues/33)).
   */
  get isProduction(): boolean {
    return this.nodeEnv === "production";
  }

  /** Which interface to bind — see `listenHost` in `configuration.ts`. */
  get listenHost(): string {
    return listenHost(this.nodeEnv);
  }

  /**
   * The whole validated set, as one object.
   *
   * @returns A fresh {@link Configuration}. Useful for handing configuration to something
   *   that is not a Nest provider, and for {@link describe}.
   */
  get all(): Configuration {
    return {
      port: this.port,
      nodeEnv: this.nodeEnv,
      databaseUrl: this.databaseUrl,
      engineUrl: this.engineUrl,
      engineSharedSecret: this.engineSharedSecret,
      sessionSecret: this.sessionSecret,
      githubClientId: this.githubClientId,
      githubClientSecret: this.githubClientSecret,
      corsOrigins: this.corsOrigins,
    };
  }

  /**
   * The configuration written down for a log, with every secret redacted.
   *
   * @returns The block {@link describeConfiguration} renders. This is the only supported
   *   way to log configuration — see `redaction.ts`.
   */
  describe(): string {
    return describeConfiguration(this.all);
  }
}
