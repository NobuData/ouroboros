import {
  ACTION_VALUE_VERSION,
  actionValueMessage,
  encodeActionValue,
  newActionNonce,
  parseActionValue,
} from "./chat.action-payload";

/** The signed value on a decision card's button (#536): its shape, and what the MAC covers. */

const VALUE = {
  itemId: "5eed0082-0000-4000-8000-000000000002",
  actionId: "allow_once",
  nonce: "q0V2b3pXc1Z2eGtYc0x5Zw",
  keyRef: "act.0123456789abcdef",
  mac: "a".repeat(64),
};

describe("a button's value", () => {
  it("round-trips its five parts", () => {
    const encoded = encodeActionValue(VALUE);

    expect(encoded.startsWith(`${ACTION_VALUE_VERSION}|`)).toBe(true);
    expect(parseActionValue(encoded)).toEqual(VALUE);
  });

  it("fits a platform's button value with room to spare", () => {
    expect(encodeActionValue(VALUE).length).toBeLessThan(256);
  });

  it.each([
    ["nothing", undefined],
    ["a number", 7],
    ["another version", encodeActionValue(VALUE).replace(ACTION_VALUE_VERSION, "ouro2")],
    ["a missing part", encodeActionValue(VALUE).split("|").slice(0, 5).join("|")],
    ["an extra part", `${encodeActionValue(VALUE)}|x`],
    ["an item that is not a uuid", encodeActionValue({ ...VALUE, itemId: "1 or 1=1" })],
    [
      "an action with a separator's neighbour",
      encodeActionValue({ ...VALUE, actionId: "Allow-Once" }),
    ],
    ["a short MAC", encodeActionValue({ ...VALUE, mac: "abc" })],
    ["a key ref of another shape", encodeActionValue({ ...VALUE, keyRef: "0123" })],
    ["something enormous", "ouro1|".padEnd(600, "a")],
  ])("is not a value: %s", (_label, presented) => {
    expect(parseActionValue(presented)).toBeUndefined();
  });

  it("makes a fresh nonce every time, in the value's own alphabet", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => newActionNonce()));

    expect(nonces.size).toBe(50);
    expect([...nonces].every((nonce) => /^[A-Za-z0-9_-]{16,64}$/.test(nonce))).toBe(true);
  });
});

describe("what the MAC covers", () => {
  it("binds the workspace, the item, the action and the nonce", () => {
    const message = actionValueMessage("org-acme", VALUE);

    expect(message).toBe(`chat-action:v1:org-acme:${VALUE.itemId}:allow_once:${VALUE.nonce}`);
    expect(actionValueMessage("org-other", VALUE)).not.toBe(message);
    expect(actionValueMessage("org-acme", { ...VALUE, actionId: "deny" })).not.toBe(message);
    expect(actionValueMessage("org-acme", { ...VALUE, nonce: "another-nonce-0000" })).not.toBe(
      message,
    );
  });
});
