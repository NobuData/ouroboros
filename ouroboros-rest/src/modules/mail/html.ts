/**
 * The one HTML rule every mail and mail-linked page in this service needs (#440): text that
 * came from data is escaped before it is put between tags or inside an attribute.
 */

/** The five characters that mean something to an HTML parser, and what stands in for each. */
const ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escape text for an HTML text node or a quoted attribute value.
 *
 * @param text - Anything: a workspace name, a test's name, a URL.
 * @returns The same text with `& < > " '` replaced by entities.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ENTITIES[character]);
}
