/**
 * robots.txt, read the way RFC 9309 says — the `robots-aware` on mockup 22's web tool row.
 *
 * A small parser rather than a dependency, because the part of the standard a reader needs is
 * small and the part that matters is exact:
 *
 * - **Groups** are one or more `user-agent` lines followed by rules. The reader's group is the one
 *   whose agent token matches {@link ROBOTS_AGENT_TOKEN} case-insensitively; failing that, `*`;
 *   failing that, everything is allowed. Groups that name the same agent are merged.
 * - **The longest matching rule wins**, `allow` over `disallow` on a tie. `*` matches any run of
 *   characters and a trailing `$` anchors the end. An empty `disallow` disallows nothing.
 * - **`crawl-delay`** is not in RFC 9309, but sites use it to ask for politeness, so it is honoured
 *   (bounded by the fetcher) when the reader's group sets one.
 *
 * What to do when robots.txt cannot be read is the fetcher's (`web.fetcher.ts`): a 4xx means
 * "no rules", an unreachable or 5xx robots.txt means "assume disallowed", as the RFC requires.
 */

/** The product token sites address the research reader by in robots.txt. */
export const ROBOTS_AGENT_TOKEN = "OuroborosResearch";

/** One allow or disallow line of the reader's group. */
export interface RobotsRule {
  readonly allow: boolean;
  /** The path pattern, as written. */
  readonly pattern: string;
}

/** The rules that apply to the reader, from one robots.txt. */
export interface RobotsPolicy {
  readonly rules: readonly RobotsRule[];
  /** The reader's crawl delay in seconds, when its group asks for one. */
  readonly crawlDelaySeconds: number | null;
}

/** The answer for one path. */
export interface RobotsVerdict {
  readonly allowed: boolean;
  /** The rule that decided it, as `Disallow: /dealers/` — null when no rule matched. */
  readonly rule: string | null;
}

/** The policy of a site with no robots.txt (or a 4xx one): everything allowed, no delay. */
export const ALLOW_ALL: RobotsPolicy = { rules: [], crawlDelaySeconds: null };

/** The policy of a site whose robots.txt could not be read: nothing allowed. */
export const DISALLOW_ALL: RobotsPolicy = {
  rules: [{ allow: false, pattern: "/" }],
  crawlDelaySeconds: null,
};

interface Group {
  agents: string[];
  rules: RobotsRule[];
  crawlDelay: number | null;
}

/**
 * Parse a robots.txt into the policy that applies to {@link ROBOTS_AGENT_TOKEN}.
 *
 * @param text - The file's content.
 * @returns The reader's rules and crawl delay — its own group's when there is one, else `*`'s,
 *   else {@link ALLOW_ALL}.
 */
export function parseRobots(text: string): RobotsPolicy {
  const groups: Group[] = [];
  let current: Group | null = null;
  let collectingAgents = false;

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const colon = line.indexOf(":");

    if (colon <= 0) continue;

    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      if (current === null || !collectingAgents) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      collectingAgents = true;
      continue;
    }

    collectingAgents = false;
    if (current === null) continue;

    if (field === "allow" || field === "disallow") {
      // An empty disallow disallows nothing; an empty allow allows nothing new.
      if (value !== "") current.rules.push({ allow: field === "allow", pattern: value });
    } else if (field === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelay = seconds;
    }
  }

  const token = ROBOTS_AGENT_TOKEN.toLowerCase();
  const mine = groups.filter((group) => group.agents.includes(token));
  const chosen = mine.length > 0 ? mine : groups.filter((group) => group.agents.includes("*"));

  if (chosen.length === 0) return ALLOW_ALL;

  const delays = chosen.map((group) => group.crawlDelay).filter((delay) => delay !== null);

  return {
    rules: chosen.flatMap((group) => group.rules),
    crawlDelaySeconds: delays.length === 0 ? null : Math.max(...delays),
  };
}

/**
 * Whether the policy lets the reader fetch a path.
 *
 * @param policy - The site's policy for the reader.
 * @param pathAndQuery - The URL's path and query — `/dealers/pricing?region=eu`.
 * @returns The verdict and the rule that decided it.
 */
export function robotsAllows(policy: RobotsPolicy, pathAndQuery: string): RobotsVerdict {
  let best: RobotsRule | null = null;
  let bestLength = -1;

  for (const rule of policy.rules) {
    if (!matches(rule.pattern, pathAndQuery)) continue;

    const length = rule.pattern.length;
    if (
      length > bestLength ||
      (length === bestLength && rule.allow && best !== null && !best.allow)
    ) {
      best = rule;
      bestLength = length;
    }
  }

  if (best === null) return { allowed: true, rule: null };

  return { allowed: best.allow, rule: `${best.allow ? "Allow" : "Disallow"}: ${best.pattern}` };
}

/**
 * Whether a robots pattern matches a path — `*` any run, a trailing `$` the end.
 *
 * @param pattern - The rule's pattern.
 * @param path - The path and query.
 * @returns `true` on a match.
 */
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const expression = body
    .split("*")
    .map((part) => escapeRegExp(normalizePercent(part)))
    .join(".*");

  return new RegExp(`^${expression}${anchored ? "$" : ""}`).test(normalizePercent(path));
}

/**
 * Percent-encodings compared case-insensitively, as RFC 9309 asks.
 *
 * @param value - A pattern or a path.
 * @returns The value with every `%xx` upper-cased.
 */
function normalizePercent(value: string): string {
  return value.replace(/%[0-9a-fA-F]{2}/g, (escape) => escape.toUpperCase());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}
