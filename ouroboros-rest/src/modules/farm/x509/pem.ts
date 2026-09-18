/**
 * PEM — the textual wrapper a certificate travels and is stored in.
 *
 * AH.2 ([#250](https://github.com/NobuData/ouroboros/issues/250)). DER is what gets signed;
 * PEM is what goes in a column, in a JSON response and in a file on a runner. Two functions,
 * and the only interesting thing about either is that the encoder is strict about line
 * length while the decoder is not strict about whitespace: what this service *writes* has to
 * be the canonical form, and what it *reads* arrives from a Go agent, a shell heredoc and a
 * copy-paste out of a terminal.
 *
 * Nothing here interprets the bytes. A label is carried through rather than validated
 * against a list, because the caller that asked for a `CERTIFICATE REQUEST` and got a
 * `CERTIFICATE` has a type error this file cannot see — `csr.ts` is where that is caught,
 * against a parser rather than against a string.
 */

/** RFC 7468's line length for the base64 body. Not advisory — some parsers enforce it. */
const LINE_LENGTH = 64;

/**
 * Wrap DER as PEM.
 *
 * @param label - What the block is, uppercase and without the dashes — `CERTIFICATE`.
 * @param der - The bytes.
 * @returns The block, ending in a newline, with the body wrapped at 64 characters.
 */
export function toPem(label: string, der: Buffer): string {
  const body = der.toString("base64");
  const lines: string[] = [];

  for (let at = 0; at < body.length; at += LINE_LENGTH) {
    lines.push(body.slice(at, at + LINE_LENGTH));
  }

  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

/**
 * Read the DER out of a PEM block.
 *
 * Tolerant of the things that happen to a PEM block in transit — CRLF, a missing trailing
 * newline, leading indentation, and text before or after the block — and intolerant of the
 * one thing that matters: the block has to be the label the caller asked for. A response
 * that returned somebody's certificate where a request was expected would otherwise be
 * decoded happily and fail much later.
 *
 * @param label - The block expected, uppercase and without the dashes.
 * @param pem - The text.
 * @returns The decoded bytes.
 * @throws {Error} If no block with that label is present, or its body is not base64. The
 *   message names the label and never the content — a malformed key is still a key.
 */
export function fromPem(label: string, pem: string): Buffer {
  const block = new RegExp(
    `-----BEGIN ${label}-----([A-Za-z0-9+/=\\s]*?)-----END ${label}-----`,
  ).exec(pem);

  if (!block?.[1]) {
    throw new Error(`No ${label} block.`);
  }

  const body = block[1].replace(/\s+/g, "");
  const der = Buffer.from(body, "base64");

  // `Buffer.from(…, "base64")` never throws — it stops at the first character it cannot read
  // and returns what it had, so a body with a typo in the middle decodes to a short buffer
  // rather than to an error. Re-encoding and comparing is what turns that into a refusal.
  if (der.toString("base64").replace(/=+$/, "") !== body.replace(/=+$/, "")) {
    throw new Error(`The ${label} block is not base64.`);
  }

  return der;
}
