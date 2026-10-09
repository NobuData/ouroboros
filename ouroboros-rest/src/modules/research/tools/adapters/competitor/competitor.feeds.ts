/**
 * RSS 2.0 and Atom, read into the lines a watch diffs (CL.3,
 * [#616](https://github.com/NobuData/ouroboros/issues/616)).
 *
 * A feed is fetched through the page reader like any page — robots.txt, pacing and the address
 * policy apply — and parsed here with `saxes`, a streaming XML parser that resolves no external
 * entities. Each item becomes a few lines: its title, its date, its link and its summary as text.
 * The diff then reads `+ 6.2 — Gust-adaptive final approach` when an item arrives.
 */

import { SaxesParser } from "saxes";

import { parseHtml, renderText } from "../web/web.extract";

/** One feed item. */
export interface FeedItem {
  readonly title: string;
  readonly link: string | null;
  readonly published: string | null;
  /** The summary or content, as plain text. */
  readonly summary: string;
}

/** The most items a snapshot keeps — a feed's head is where changes appear. */
export const MAX_FEED_ITEMS = 50;

/** The longest summary kept per item, in characters. */
const MAX_SUMMARY_CHARS = 2000;

/**
 * Parse an RSS or Atom document.
 *
 * @param xml - The document.
 * @returns Its items in feed order (at most {@link MAX_FEED_ITEMS}), or null when it is not a
 *   well-formed RSS or Atom feed.
 */
export function parseFeed(xml: string): FeedItem[] | null {
  const parser = new SaxesParser({ xmlns: false });
  const items: FeedItem[] = [];
  const path: string[] = [];
  let root: string | null = null;
  let current: {
    title: string;
    link: string | null;
    published: string | null;
    summary: string;
  } | null = null;
  let text = "";

  parser.on("opentag", (tag) => {
    const name = localName(tag.name);
    root ??= name;
    path.push(name);
    text = "";

    if (name === "item" || name === "entry") {
      current = { title: "", link: null, published: null, summary: "" };
    } else if (current !== null && name === "link") {
      const href = tag.attributes.href;
      const rel = tag.attributes.rel;
      if (
        typeof href === "string" &&
        (rel === undefined || rel === "alternate") &&
        current.link === null
      ) {
        current.link = href.trim();
      }
    }
  });
  parser.on("text", (chunk) => {
    text += chunk;
  });
  parser.on("cdata", (chunk) => {
    text += chunk;
  });
  parser.on("closetag", (tag) => {
    const name = localName(tag.name);
    path.pop();
    const value = text.trim();

    if (current !== null) {
      if (name === "item" || name === "entry") {
        if (items.length < MAX_FEED_ITEMS) items.push(current);
        current = null;
      } else if (name === "title" && current.title === "") {
        current.title = value;
      } else if (name === "link" && current.link === null && value !== "") {
        current.link = value;
      } else if (
        (name === "pubdate" || name === "published" || name === "updated" || name === "date") &&
        current.published === null &&
        value !== ""
      ) {
        current.published = value;
      } else if (
        (name === "description" ||
          name === "summary" ||
          name === "content" ||
          name === "encoded") &&
        current.summary === ""
      ) {
        current.summary = value;
      }
    }
    text = "";
  });

  try {
    parser.write(xml).close();
  } catch {
    return null;
  }

  if (root !== "rss" && root !== "feed" && root !== "rdf") return null;

  return items.map((item) => ({
    title: oneLine(item.title),
    link: item.link,
    published: item.published,
    summary: summaryText(item.summary),
  }));
}

/**
 * A feed's items as the lines a snapshot archives.
 *
 * @param items - The items.
 * @returns One block per item: title, date, link, summary.
 */
export function feedText(items: readonly FeedItem[]): string {
  return items
    .map((item) =>
      [item.title, item.published, item.link, item.summary]
        .filter((line): line is string => line !== null && line !== "")
        .join("\n"),
    )
    .join("\n\n");
}

function localName(name: string): string {
  const colon = name.indexOf(":");
  return (colon === -1 ? name : name.slice(colon + 1)).toLowerCase();
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function summaryText(summary: string): string {
  const text = /<[a-z!/]/i.test(summary) ? renderText(parseHtml(summary)) : summary;
  return text.length > MAX_SUMMARY_CHARS ? `${text.slice(0, MAX_SUMMARY_CHARS)}…` : text;
}
