/**
 * Main-content extraction — what the page *says*, without its navigation, its footer or its ads.
 *
 * Readability-style and dependency-free: the HTML is tokenised into a forgiving tree (unclosed tags
 * close themselves, stray end tags are ignored), the boilerplate is dropped, and the block whose
 * paragraphs carry the most text — discounted by how much of it is link text — is taken as the
 * content. An `<article>` or `<main>` that holds a fair share of the page's text is preferred, as
 * the page's author already said where the content is. The result is plain text with paragraph
 * breaks, which is what an excerpt and a model both want.
 *
 * Deliberately not a renderer: no script runs and no style is applied. A page that only renders
 * with JavaScript comes back thin, and the fetcher records it as such (the competitor tracker's
 * `render_required` is the v2 answer, #637).
 */

/** The extractor's name and version, recorded in each source's meta. */
export const EXTRACTOR = "main-content-v1";

/** What extraction found. */
export interface ExtractedPage {
  /** The page's title — `og:title`, else `<title>`, else the first `<h1>`; null when none. */
  readonly title: string | null;
  /** The main content as plain text, paragraphs separated by blank lines. */
  readonly text: string;
}

/** One element of the tolerant tree — exported for readers that scope a page themselves (#616). */
export interface HtmlElement {
  readonly tag: string;
  /** The raw attribute text, as written. */
  readonly attrs: string;
  readonly children: HtmlNode[];
}

/** An element, or a run of text. */
export type HtmlNode = HtmlElement | string;

type Element = HtmlElement;
type Node = HtmlNode;

/** Elements with no end tag. */
const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

/** Elements whose content is never page text. */
const SKIPPED = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "iframe",
  "canvas",
  "head",
  "object",
]);

/** Elements that are page furniture rather than content. */
const FURNITURE = new Set([
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "button",
  "select",
  "dialog",
]);

/** Class or id fragments that mark furniture. */
const FURNITURE_HINT =
  /(^|[\s_-])(nav|navbar|menu|footer|header|sidebar|cookie|consent|banner|share|social|comments?|advert|ads?|promo|breadcrumbs?|related|subscribe|newsletter)([\s_-]|$)/i;

/** Elements that end a line of text. */
const BLOCK = new Set([
  "p",
  "div",
  "section",
  "article",
  "main",
  "li",
  "ul",
  "ol",
  "table",
  "tr",
  "td",
  "th",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "figure",
  "figcaption",
  "dd",
  "dt",
  "br",
  "hr",
]);

/** The named entities a page's prose actually uses. Numeric ones are decoded generally. */
const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  middot: "·",
  bull: "•",
  times: "×",
  minus: "−",
  euro: "€",
};

/**
 * Extract a page's title and main content.
 *
 * @param html - The page's HTML.
 * @returns Its title and main text.
 */
export function extractMainContent(html: string): ExtractedPage {
  const root = parse(html);
  const title = findTitle(root);
  const body = find(root, (element) => element.tag === "body") ?? root;
  const cleaned = strip(body);
  const totalText = textLength(cleaned);
  const preferred = find(
    cleaned,
    (element) =>
      (element.tag === "article" || element.tag === "main") &&
      textLength(element) >= totalText * 0.3,
  );
  const content = preferred ?? bestBlock(cleaned) ?? cleaned;

  return { title, text: render(content) };
}

/**
 * Decode HTML entities.
 *
 * @param text - Text with entities.
 * @returns The text, decoded; an unknown named entity is kept as written.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return codePoint(Number.parseInt(entity.slice(2), 16), whole);
    }
    if (entity.startsWith("#")) return codePoint(Number.parseInt(entity.slice(1), 10), whole);
    return ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

function codePoint(value: number, fallback: string): string {
  return Number.isInteger(value) && value > 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : fallback;
}

/**
 * The page as a forgiving tree — what the competitor tracker's selectors run over (#616).
 *
 * @param html - The document.
 * @returns A synthetic `#root` element holding it. Script, style and similar elements are kept
 *   as empty elements: their content is never text.
 */
export function parseHtml(html: string): HtmlElement {
  return parse(html);
}

/**
 * An attribute's value.
 *
 * @param element - The element.
 * @param name - The attribute, case-insensitively.
 * @returns Its value, entity-decoded; `""` for a bare attribute; null when absent.
 */
export function htmlAttribute(element: HtmlElement, name: string): string | null {
  const value = attribute(element, name);
  if (value !== null) return decodeEntities(value);
  return new RegExp(`(?:^|\\s)${name}(?:\\s|=|/|$)`, "i").test(element.attrs) ? "" : null;
}

/**
 * An element's text, as the extractor renders content — blocks on their own lines.
 *
 * @param element - The element.
 * @returns Its text.
 */
export function renderText(element: HtmlElement): string {
  return render(element);
}

/**
 * The text a reader would see in a page's body, without scripts and page furniture.
 *
 * @param html - The document.
 * @returns The body's text — short for a page whose content a script renders.
 */
export function visibleText(html: string): string {
  const root = parse(html);
  const body = find(root, (element) => element.tag === "body") ?? root;
  return render(strip(body));
}

/**
 * Tokenise HTML into a forgiving tree.
 *
 * @param html - The document.
 * @returns A synthetic root element holding it.
 */
function parse(html: string): Element {
  const root: Element = { tag: "#root", attrs: "", children: [] };
  const stack: Element[] = [root];
  const token =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!(?:doctype|DOCTYPE)[^>]*>|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|[^<]+|</g;
  let match: RegExpExecArray | null;

  while ((match = token.exec(html)) !== null) {
    const [whole, closing, rawTag, attrs] = match;
    const top = stack[stack.length - 1];

    if (rawTag === undefined) {
      if (!whole.startsWith("<!")) top.children.push(whole);
      continue;
    }

    const tag = rawTag.toLowerCase();

    if (closing === "/") {
      const index = stack.map((element) => element.tag).lastIndexOf(tag);
      if (index > 0) stack.length = index;
      continue;
    }

    const element: Element = { tag, attrs: attrs ?? "", children: [] };
    top.children.push(element);

    if (SKIPPED.has(tag) && tag !== "head") {
      // Raw text elements: their content is not markup, so skip to the matching end tag.
      const end = html.toLowerCase().indexOf(`</${tag}`, token.lastIndex);
      token.lastIndex = end === -1 ? html.length : end;
      continue;
    }

    if (!VOID.has(tag) && !(attrs ?? "").trim().endsWith("/")) stack.push(element);
  }

  return root;
}

function find(element: Element, predicate: (element: Element) => boolean): Element | null {
  for (const child of element.children) {
    if (typeof child === "string") continue;
    if (predicate(child)) return child;
    const found = find(child, predicate);
    if (found !== null) return found;
  }
  return null;
}

function attribute(element: Element, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(
    element.attrs,
  );
  return match === null ? null : (match[2] ?? match[3] ?? match[4] ?? null);
}

function findTitle(root: Element): string | null {
  const og = find(
    root,
    (element) => element.tag === "meta" && attribute(element, "property") === "og:title",
  );
  const candidates = [
    og === null ? null : attribute(og, "content"),
    textOf(find(root, (element) => element.tag === "title")),
    textOf(find(root, (element) => element.tag === "h1")),
  ];

  for (const candidate of candidates) {
    const cleaned = candidate === null ? "" : decodeEntities(candidate).replace(/\s+/g, " ").trim();
    if (cleaned !== "") return cleaned;
  }
  return null;
}

function textOf(element: Element | null): string | null {
  if (element === null) return null;
  return element.children
    .map((child) => (typeof child === "string" ? child : (textOf(child) ?? "")))
    .join("");
}

/**
 * The tree without anything that is never content.
 *
 * @param element - A subtree.
 * @returns A copy with skipped elements and furniture removed.
 */
function strip(element: Element): Element {
  const children: Node[] = [];

  for (const child of element.children) {
    if (typeof child === "string") {
      children.push(child);
      continue;
    }
    if (SKIPPED.has(child.tag) || FURNITURE.has(child.tag)) continue;

    const hints = `${attribute(child, "class") ?? ""} ${attribute(child, "id") ?? ""} ${attribute(child, "role") ?? ""}`;
    if (
      FURNITURE_HINT.test(hints) &&
      child.tag !== "body" &&
      child.tag !== "main" &&
      child.tag !== "article"
    )
      continue;
    if (
      /(?:^|\s)hidden(?:\s|=|\/|$)/i.test(child.attrs) ||
      attribute(child, "aria-hidden") === "true"
    )
      continue;

    children.push(strip(child));
  }

  return { tag: element.tag, attrs: element.attrs, children };
}

function textLength(node: Node): number {
  if (typeof node === "string") return decodeEntities(node).replace(/\s+/g, " ").trim().length;
  return node.children.reduce((total, child) => total + textLength(child), 0);
}

function linkTextLength(node: Node, inLink = false): number {
  if (typeof node === "string") return inLink ? textLength(node) : 0;
  return node.children.reduce(
    (total, child) => total + linkTextLength(child, inLink || node.tag === "a"),
    0,
  );
}

/**
 * The container whose paragraphs carry the most text, discounted by link density.
 *
 * @param root - The cleaned tree.
 * @returns The best block, or null when no block holds a paragraph.
 */
function bestBlock(root: Element): Element | null {
  let best: Element | null = null;
  let bestScore = 0;

  const visit = (element: Element): void => {
    if (["div", "section", "article", "main", "td", "body"].includes(element.tag)) {
      let paragraphText = 0;
      let commas = 0;

      for (const child of element.children) {
        if (
          typeof child !== "string" &&
          (child.tag === "p" || child.tag === "pre" || child.tag === "blockquote")
        ) {
          paragraphText += textLength(child);
          commas += (textOf(child) ?? "").split(",").length - 1;
        }
      }

      const total = textLength(element);
      const linkDensity = total === 0 ? 1 : linkTextLength(element) / total;
      const score = (paragraphText + commas * 10) * (1 - linkDensity);

      if (score > bestScore) {
        best = element;
        bestScore = score;
      }
    }
    for (const child of element.children) if (typeof child !== "string") visit(child);
  };

  visit(root);
  return best;
}

/**
 * Plain text, with blocks on their own lines and paragraphs separated by a blank line.
 *
 * @param root - The content.
 * @returns The text.
 */
function render(root: Element): string {
  const parts: string[] = [];

  const walk = (node: Node, preformatted: boolean): void => {
    if (typeof node === "string") {
      parts.push(preformatted ? decodeEntities(node) : decodeEntities(node).replace(/\s+/g, " "));
      return;
    }
    const block = BLOCK.has(node.tag);
    if (block) parts.push("\n\n");
    if (node.tag === "li") parts.push("• ");
    for (const child of node.children) walk(child, preformatted || node.tag === "pre");
    if (block) parts.push("\n\n");
  };

  walk(root, false);

  return parts
    .join("")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
