/**
 * The service-account create body ([#485](https://github.com/NobuData/ouroboros/issues/485)).
 */

import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsString,
  Matches,
} from "class-validator";

import { SERVICE_SCOPES, type ServiceScopeName } from "../auth/service.scopes";

/** V091's `service_accounts_name_grammar`: lower-case, digits and hyphens, 3–40 characters. */
export const SERVICE_ACCOUNT_NAME_PATTERN = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

/** `POST /settings/service-accounts`. */
export class CreateServiceAccountDto {
  /** `devops-bot` — what the audit trail prints after `service:`. */
  @IsString({ message: "name must be text" })
  @Matches(SERVICE_ACCOUNT_NAME_PATTERN, {
    message:
      "name must be 3–40 lower-case letters, digits or hyphens, starting with a letter and not ending with a hyphen",
  })
  name!: string;

  /** At least one scope from the registered allow-list. */
  @IsArray({ message: "scopes must be a list" })
  @ArrayMinSize(1, { message: "scopes must name at least one scope" })
  @ArrayMaxSize(SERVICE_SCOPES.length, { message: "scopes must not repeat" })
  @ArrayUnique({ message: "scopes must not repeat" })
  @IsIn(SERVICE_SCOPES, {
    each: true,
    message: `each scope must be one of ${SERVICE_SCOPES.join(", ")}`,
  })
  scopes!: ServiceScopeName[];
}
