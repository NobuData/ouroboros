/**
 * The signed value a decision card's button carries (BZ.2,
 * [#536](https://github.com/NobuData/ouroboros/issues/536)) — pure.
 *
 * A button press comes back from the platform with whatever value the button was given. That
 * value names a decision and an action, so it must be something only this service could have
 * written: otherwise anybody able to craft a payload could answer any decision. It is therefore
 * an item id, an action id and a nonce, with an HMAC over all three under the workspace's own
 * key (`ActionTokenService.sign`, the key #463's emailed links use).
 *
 * ```
 * ouro1|<item id>|<action id>|<nonce>|<key ref>|<mac>
 * ```
 *
 * **Signed here, verified in #538.** Verifying proves the button is one this service drew; it
 * says nothing about who pressed it. Who may answer is the identity link and the role check the
 * press goes through there.
 */

import { randomBytes } from "node:crypto";

/** The value's version tag. A different shape gets a different tag. */
export const ACTION_VALUE_VERSION = "ouro1";

/** What separates the parts. None of them can contain it. */
const SEPARATOR = "|";

/** The parts a value may carry: a uuid, an action slug, a nonce, a key ref, a hex MAC. */
const SHAPES = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  /^[a-z][a-z0-9_]{0,62}$/,
  /^[A-Za-z0-9_-]{16,64}$/,
  /^[a-z]+\.[0-9a-f]{16}$/,
  /^[0-9a-f]{64}$/,
] as const;

/** A button's value, taken apart. */
export interface ChatActionValue {
  readonly itemId: string;
  readonly actionId: string;
  /** Random per button, so two cards for one decision never carry the same value. */
  readonly nonce: string;
  /** Which of the workspace's keys signed it. */
  readonly keyRef: string;
  readonly mac: string;
}

/**
 * A fresh nonce.
 *
 * @returns 16 random bytes, URL-safe.
 */
export function newActionNonce(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * The bytes the MAC is computed over.
 *
 * Domain-separated from everything else the workspace's key signs, and bound to the workspace:
 * a value signed for one workspace verifies in no other.
 *
 * @param organizationId - The workspace.
 * @param value - The item, action and nonce.
 * @returns The message.
 */
export function actionValueMessage(
  organizationId: string,
  value: Pick<ChatActionValue, "itemId" | "actionId" | "nonce">,
): string {
  return ["chat-action", "v1", organizationId, value.itemId, value.actionId, value.nonce].join(":");
}

/**
 * A value as the button carries it.
 *
 * @param value - Its parts.
 * @returns The string — well under a platform's limit for a button value.
 */
export function encodeActionValue(value: ChatActionValue): string {
  return [
    ACTION_VALUE_VERSION,
    value.itemId,
    value.actionId,
    value.nonce,
    value.keyRef,
    value.mac,
  ].join(SEPARATOR);
}

/**
 * Take a presented value apart. Checks shape only — the MAC is the caller's to verify.
 *
 * @param presented - Whatever the platform sent.
 * @returns The parts, or undefined for anything that is not a value this service writes.
 */
export function parseActionValue(presented: unknown): ChatActionValue | undefined {
  if (typeof presented !== "string" || presented.length > 512) {
    return undefined;
  }

  const [version, ...parts] = presented.split(SEPARATOR);

  if (
    version !== ACTION_VALUE_VERSION ||
    parts.length !== SHAPES.length ||
    !parts.every((part, index) => SHAPES[index].test(part))
  ) {
    return undefined;
  }

  const [itemId, actionId, nonce, keyRef, mac] = parts;

  return { itemId, actionId, nonce, keyRef, mac };
}
