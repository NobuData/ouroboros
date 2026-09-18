/**
 * What the farm's three writes may contain, as `class-validator` classes.
 *
 * AH.2 ([#250](https://github.com/NobuData/ouroboros/issues/250)). Two of these bodies arrive
 * from a browser under a session; one arrives from an unauthenticated machine, and that one
 * is why the bounds here are stated rather than assumed.
 *
 * **Every bound restates a rule that exists somewhere else, deliberately.** `name` restates
 * V040's `runners_name_shape`, `arch` restates `runners_arch`, and `maxUses` restates
 * `enrollment_tokens_max_uses_positive` together with `farm.policy.ts`'s ceiling. The schema
 * is the thing that cannot be bypassed and is therefore the guarantee; these are what turn a
 * violation into a `422` naming the field instead of a `500` naming a constraint — and, on
 * the registration path, what stops a megabyte of nonsense reaching a certificate parser.
 *
 * `!`-asserted rather than initialised, as everywhere in this service: `class-transformer`
 * assigns to these objects, and a default written here would be a value the pipe kept for a
 * field the client never sent.
 */

import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";

import { MAX_TOKEN_USES, MAX_TOKEN_TTL_MS, MIN_TOKEN_TTL_MS } from "./farm.policy";
import { MAX_REQUEST_BYTES } from "./x509/csr";
import { TOKEN_PREFIX } from "./farm.tokens";

/** Milliseconds in a second — the unit the TTL bounds are published in is seconds. */
const SECOND_MS = 1000;

/** The shortest TTL a mint may ask for, in seconds. */
export const MIN_TTL_SECONDS = MIN_TOKEN_TTL_MS / SECOND_MS;

/** The longest. */
export const MAX_TTL_SECONDS = MAX_TOKEN_TTL_MS / SECOND_MS;

/**
 * The longest a pool name may be.
 *
 * V040's `runner_pools` name is slug-shaped with the same 64-character ceiling `runners` has;
 * restated so an over-long name is a `422` rather than a constraint violation.
 */
const NAME_MAX = 64;

/** V040's `runners_name_shape`, restated. A slug that may not begin or end in punctuation. */
const NAME_SHAPE = /^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/;

/** V040's `runners_arch`, restated — the three architectures AG.6 builds the agent for. */
export const RUNNER_ARCHITECTURES = ["linux/arm64", "linux/x86_64", "darwin/arm64"] as const;

/** The two security modes a registration may ask for. */
export const SECURITY_MODES = ["mtls", "bearer_fallback"] as const;

/** The body of `POST /api/v1/farm/enrollment-tokens`. */
export class MintEnrollmentTokenDto {
  /**
   * Which pool a runner enrolled with this token joins — the mockup's `--pool pool-a`.
   *
   * Required, and the whole of what "scoped" means: there is no token that enrols into
   * whichever pool the runner asks for.
   */
  @IsString()
  @MaxLength(NAME_MAX)
  @Matches(NAME_SHAPE, { message: "pool must be a lower-case slug" })
  pool!: string;

  /**
   * How long the token lives, in seconds. Defaults to a day — the mockup's `ttl 24h`.
   *
   * Bounded above by `farm.policy.ts`, which argues the ceiling: a token good for a year is a
   * password with extra steps.
   */
  @IsOptional()
  @IsInt()
  @Min(MIN_TTL_SECONDS)
  @Max(MAX_TTL_SECONDS)
  ttlSeconds?: number;

  /** How many machines it may enrol. Defaults to one; bounded, because a rack is not a fleet. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_TOKEN_USES)
  maxUses?: number;
}

/**
 * The body of `POST /api/v1/farm/registrations` — the one body an unauthenticated caller
 * sends.
 *
 * **There is no workspace field, and that is the organization-isolation criterion.** The
 * workspace is read from the token's own row; a body that could name one would be a body that
 * could name somebody else's, and the check that this is not happening would then be
 * something a service has to remember rather than something the shape makes unaskable.
 */
export class RegisterRunnerDto {
  /** The `orb_enroll_…` value. Shape-checked here; verified against its row by the service. */
  @IsString()
  @MaxLength(256)
  @Matches(new RegExp(`^${TOKEN_PREFIX}`), { message: "token must be an enrollment token" })
  token!: string;

  /** What the machine is called — `forge-01`. Unique per workspace, by V040. */
  @IsString()
  @MaxLength(NAME_MAX)
  @Matches(NAME_SHAPE, { message: "name must be a lower-case slug" })
  name!: string;

  /** Which of the three architectures it is. */
  @IsIn([...RUNNER_ARCHITECTURES])
  arch!: (typeof RUNNER_ARCHITECTURES)[number];

  /**
   * The pool the agent was told to join, if it was told one.
   *
   * Optional, and **checked against the token's scope when present** — a token scoped to
   * `pool-a` refuses a registration that names `pool-b` rather than quietly enrolling into
   * `pool-a`. Silently overriding would make the `--pool` flag a lie on the one command an
   * operator reads most carefully.
   */
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX)
  @Matches(NAME_SHAPE, { message: "pool must be a lower-case slug" })
  pool?: string;

  /**
   * The certificate request, PEM.
   *
   * Required for an `mtls` registration, which is every registration a workspace has not
   * switched the fallback on for. Bounded by `csr.ts`'s own cap, restated here so the refusal
   * is a `422` naming the field.
   */
  @ValidateIf((body: RegisterRunnerDto) => body.securityMode !== "bearer_fallback")
  @IsString()
  @MaxLength(MAX_REQUEST_BYTES)
  csr?: string;

  /**
   * Which mode the agent is asking for. Defaults to `mtls`.
   *
   * A request for `bearer_fallback` is refused unless the workspace has switched it on — see
   * `farm.errors.ts`. Asked for rather than inferred from the absence of a CSR, because
   * *my proxy strips client certificates* is a claim an operator should have to make.
   */
  @IsOptional()
  @IsIn([...SECURITY_MODES])
  securityMode?: (typeof SECURITY_MODES)[number];

  /** The agent build that is enrolling, if it says. Rendered by AI.2 as an out-of-date agent. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  agentVersion?: string;

  /** Whether the machine can run containers — AG.1's `hello`, asked at enrollment. */
  @IsOptional()
  @IsBoolean()
  docker?: boolean;

  /** How many cores it has. Bounded generously; a negative or absurd count is a `422`. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4096)
  cpuCount?: number;
}

/**
 * The body of `POST /api/v1/farm/registrations/renewal`.
 *
 * One field, because the runner's identity is the client certificate it is already presenting
 * rather than anything it can put in a body — which is the issue's *renewal over the
 * already-authenticated channel*, made structural. There is no token field, and a renewal
 * therefore cannot be performed by anything holding only a token.
 */
export class RenewCertificateDto {
  /** A fresh certificate request. A new keypair every renewal is the agent's to generate. */
  @IsString()
  @MaxLength(MAX_REQUEST_BYTES)
  csr!: string;
}
