/**
 * Where the cursor is, in the words of the code symbol table — W.1
 * ([#177](https://github.com/NobuData/ouroboros/issues/177)).
 *
 * `GET /api/v1/workflows/code-symbols` says what to offer at each **scope** and what a hover
 * card says about each **symbol** (`ouroboros-rest/src/modules/workflows/code.symbols.ts`). This
 * module is the other half: it reads the text before the cursor and names the scope or symbol
 * the cursor is in. Nothing here knows an option key, an enum value or a doc — a key added to the
 * grammar produces a scope name this module already computes.
 *
 * ```
 * defineLoop("standard-fix", {           loop.options       · loop.<key> in a value
 *   trigger: { when: (i) => i.           trigger.options    · condition.subjects after `i.`
 *   stages: [ llm("implement", {         loop.stages        · stage.llm.options
 *     model: route.task("…"),            route.methods      · route.task inside the string
 *     permissions: { … },                permissions.options
 *     branches: [{ when: (i) => i.       edge.options       · predicate.subjects, predicate.<kind>
 * ```
 *
 * ### What it knows, and why that much
 *
 * It knows the *shape* the grammar fixes (`docs/WORKFLOW_CODE_DSL.md` §3–§7): that `defineLoop`'s
 * second argument is the loop's options, that a call inside `stages` is a stage whose second
 * argument is its options, that `trigger`, `permissions`, `branches` and `onFail` open the objects
 * they open, and that `route.`, `effort.` and an arrow's parameter start member chains. That is
 * the structure a scope name is made of, not vocabulary.
 *
 * ### How it reads
 *
 * A small scanner, not a TypeScript parser: strings, template literals and comments are skipped
 * as units, brackets push and pop frames, and each frame remembers what it is — the object a key
 * opened, the array `stages` opened, the call `route.task` opened. An editor has to answer while
 * the author is mid-word in a file that does not parse, so the scanner never fails: at worst it
 * names no scope, and the editor offers nothing.
 */

/** The one call a workflow file makes — its second argument is the loop's options. */
const DEFINE_LOOP = "defineLoop";

/** The loop option whose array holds the stage calls. */
const STAGES_SCOPE = "loop.stages";

/** The loop option whose object is the trigger. */
const TRIGGER_SCOPE = "loop.trigger";

/** The trigger's `when`, whose arrow spells conditions rather than predicates. */
const TRIGGER_WHEN_SCOPE = "trigger.when";

/** The stage option whose object holds the permission flags. */
const PERMISSIONS_KEY = "permissions";

/** The stage options whose arrays hold edge entries. */
const EDGE_LIST_KEYS = new Set(["branches", "onFail"]);

/** The namespace `route.task` and `route.model` are members of. */
const ROUTE_NAMESPACE = "route";

/** The call whose string argument names a task route. */
const ROUTE_TASK = "route.task";

/** The namespace `effort.M` is a member of. */
const EFFORT_NAMESPACE = "effort";

/** The predicate subject whose methods take tracker kinds. */
const SOURCE_SUBJECT = "source";

/** Whether a character may start an identifier. */
const IDENTIFIER_START = /[A-Za-z_$]/;

/** Whether a character may continue one. */
const IDENTIFIER_PART = /[\w$]/;

/** What an arrow's member chains are spelled against: a flow predicate, or a trigger condition. */
export type ArrowKind = "predicate" | "condition";

/** An arrow function the cursor may be in the body of. */
interface Arrow {
  /** Its one parameter's name — `i` — or `null` for `() => true`. */
  readonly param: string | null;
  /** Which methods its member chains name. */
  readonly kind: ArrowKind;
}

/** An object literal: `{ … }`. */
interface ObjectFrame {
  readonly type: "object";
  /** The scope base its keys belong to — `loop`, `stage.llm`, `edge` — or `null` for none. */
  readonly base: string | null;
  /** The key most recently read in it. */
  key: string | null;
  /** Whether that key's `:` has been read, so what follows is its value. */
  afterColon: boolean;
  /** The arrow the current value is the body of. */
  arrow: Arrow | null;
}

/** An array literal: `[ … ]`. */
interface ArrayFrame {
  readonly type: "array";
  /** The scope its elements are values of — `loop.stages`, `source.values` — or `null`. */
  readonly meaning: string | null;
  /** The arrow the current element is the body of. */
  arrow: Arrow | null;
}

/** A call's argument list: `callee( … )`. */
interface CallFrame {
  readonly type: "call";
  /** The callee as written, dots and all — `llm`, `route.task`, `i.source.in`. */
  readonly callee: string;
  /** The scope the call itself is a value of — `loop.stages` for a stage call. */
  readonly within: string | null;
  /** Which argument is being read, from 0. */
  arg: number;
  /** The arrow the current argument is the body of. */
  arrow: Arrow | null;
}

/** Parentheses that are not a call: an arrow's parameter list, or grouping. */
interface GroupFrame {
  readonly type: "group";
  /** The identifiers read inside, so `(i)` can name an arrow's parameter. */
  readonly identifiers: string[];
  /** The arrow the current expression is the body of. */
  arrow: Arrow | null;
}

/** One open bracket. */
type Frame = ObjectFrame | ArrayFrame | CallFrame | GroupFrame;

/** What a completion replaces, and which scope's completions it offers. */
export interface CompletionPlace {
  /** The scope — see this file's header. */
  readonly scope: string;
  /** Where the replaced text starts: the word being typed, or the string's content. */
  readonly from: number;
  /** Whether the cursor is inside quotes, so a string value is inserted without them. */
  readonly quoted: boolean;
}

/** The symbol under the pointer, and the text it spans. */
export interface HoverTarget {
  /** The symbol — see this file's header. */
  readonly symbol: string;
  /** Where the spanned text starts — the start of `route` for `route.task`. */
  readonly from: number;
  /** Where it ends. */
  readonly to: number;
}

/** The scanner's state, mutated token by token. */
class Scanner {
  /** The open brackets, outermost first. */
  readonly frames: Frame[] = [];
  /** The member chain the last tokens spelled — `route`, `i.effort` — or `null`. */
  chain: string[] | null = null;
  /** Where that chain's first identifier starts. */
  chainStart = 0;
  /** Whether the chain ends in a `.`, so the next word is one of its members. */
  expectMember = false;
  /** Where the content of the string the scan stopped inside starts, or `null`. */
  stringContent: number | null = null;
  /** Whether the scan stopped inside a comment. */
  inComment = false;
  /** Whether the previous token was an identifier — what makes `(` a call and `.` a member. */
  private afterIdentifier = false;
  /** The identifiers of the group that just closed, for `(i) =>`. */
  private closedGroup: string[] | null = null;

  /**
   * The innermost frame.
   *
   * @returns It, or `undefined` at the top level.
   */
  top(): Frame | undefined {
    return this.frames.at(-1);
  }

  /**
   * An identifier: a key, a member, a callee-to-be or an arrow parameter.
   *
   * @param name - The identifier.
   * @param start - Where it starts.
   */
  identifier(name: string, start: number): void {
    const top = this.top();
    if (top?.type === "object" && !top.afterColon) top.key = name;
    if (top?.type === "group") top.identifiers.push(name);

    const chain = this.expectMember && this.chain !== null ? [...this.chain, name] : [name];
    const chainStart = chain.length === 1 ? start : this.chainStart;
    this.reset();
    this.chain = chain;
    this.chainStart = chainStart;
    this.afterIdentifier = true;
  }

  /**
   * A complete string literal. In a key position it is the key.
   *
   * @param content - The text between its quotes.
   */
  string(content: string): void {
    const top = this.top();
    if (top?.type === "object" && !top.afterColon) top.key = content;
    this.reset();
  }

  /** `.` — after an identifier, the next identifier is a member of the chain. */
  dot(): void {
    const chain = this.afterIdentifier ? this.chain : null;
    this.reset();
    if (chain !== null) {
      this.chain = chain;
      this.expectMember = true;
    }
  }

  /** `:` — a key's value starts. */
  colon(): void {
    const top = this.top();
    if (top?.type === "object") top.afterColon = true;
    this.reset();
  }

  /** `,` — the next key, element or argument starts, and any arrow body ends. */
  comma(): void {
    const top = this.top();
    if (top !== undefined) top.arrow = null;
    if (top?.type === "object") {
      top.key = null;
      top.afterColon = false;
    }
    if (top?.type === "call") top.arg += 1;
    this.reset();
  }

  /** `=>` — the current value is an arrow's body. */
  arrow(): void {
    const top = this.top();
    const bare = this.afterIdentifier && this.chain?.length === 1 ? this.chain : [];
    const parameters = this.closedGroup ?? bare;

    if (top !== undefined) {
      top.arrow = {
        param: parameters.length === 1 ? parameters[0] : null,
        kind: valueScope(top) === TRIGGER_WHEN_SCOPE ? "condition" : "predicate",
      };
    }
    this.reset();
  }

  /**
   * `(`, `[` or `{` — a frame opens, and remembers what it is from where it opened.
   *
   * @param bracket - The bracket.
   */
  open(bracket: "(" | "[" | "{"): void {
    const parent = this.top();

    if (bracket === "(") {
      this.frames.push(
        this.afterIdentifier && this.chain !== null
          ? {
              type: "call",
              callee: this.chain.join("."),
              within: valueScope(parent),
              arg: 0,
              arrow: null,
            }
          : { type: "group", identifiers: [], arrow: null },
      );
    } else if (bracket === "[") {
      const meaning =
        parent?.type === "call" ? callScope(parent, nearestArrow(this.frames)) : valueScope(parent);
      this.frames.push({ type: "array", meaning, arrow: null });
    } else {
      this.frames.push({
        type: "object",
        base: objectBase(parent),
        key: null,
        afterColon: false,
        arrow: null,
      });
    }
    this.reset();
  }

  /**
   * `)`, `]` or `}` — the innermost frame of that kind closes, with any left open inside it.
   *
   * @param bracket - The bracket.
   */
  close(bracket: ")" | "]" | "}"): void {
    const index = this.frames.findLastIndex((frame) =>
      bracket === "}"
        ? frame.type === "object"
        : bracket === "]"
          ? frame.type === "array"
          : frame.type === "call" || frame.type === "group",
    );

    const closed = index === -1 ? undefined : this.frames.splice(index)[0];
    this.reset();
    if (closed?.type === "group") this.closedGroup = closed.identifiers;
  }

  /** Any other token: a chain, and what an identifier would have made of `(`, end here. */
  reset(): void {
    this.chain = null;
    this.expectMember = false;
    this.afterIdentifier = false;
    this.closedGroup = null;
  }
}

/**
 * The scope a frame's current value belongs to.
 *
 * @param frame - A frame, or `undefined` at the top level.
 * @returns `<base>.<key>` inside an object's value, an array's meaning, or `null`.
 */
function valueScope(frame: Frame | undefined): string | null {
  if (frame?.type === "object") {
    return frame.base !== null && frame.afterColon && frame.key !== null
      ? `${frame.base}.${frame.key}`
      : null;
  }
  return frame?.type === "array" ? frame.meaning : null;
}

/**
 * The scope base of an object opened inside `parent`.
 *
 * @param parent - The frame the `{` was read in.
 * @returns `loop`, `trigger`, `stage.<callee>`, `permissions`, `edge`, or `null`.
 */
function objectBase(parent: Frame | undefined): string | null {
  if (parent?.type === "call") {
    if (parent.arg !== 1) return null;
    if (parent.callee === DEFINE_LOOP) return "loop";
    return parent.within === STAGES_SCOPE ? `stage.${parent.callee}` : null;
  }

  if (parent?.type === "object") {
    if (valueScope(parent) === TRIGGER_SCOPE) return "trigger";
    const inStage = parent.base?.startsWith("stage.") === true && parent.afterColon;
    return inStage && parent.key === PERMISSIONS_KEY ? "permissions" : null;
  }

  if (parent?.type === "array" && parent.meaning?.startsWith("stage.") === true) {
    const key = parent.meaning.slice(parent.meaning.lastIndexOf(".") + 1);
    return EDGE_LIST_KEYS.has(key) ? "edge" : null;
  }

  return null;
}

/**
 * The scope a call's arguments offer.
 *
 * @param call - The call frame.
 * @param arrow - The arrow the call is inside, if any.
 * @returns `route.task` inside `route.task(…)`, `source.values` inside a source method's
 *   argument, or `null`.
 */
function callScope(call: CallFrame, arrow: Arrow | null): string | null {
  if (call.callee === ROUTE_TASK) return ROUTE_TASK;

  const [subject, namespace, method, ...rest] = call.callee.split(".");
  const isParameter = arrow !== null && arrow.param !== null && subject === arrow.param;
  return isParameter && namespace === SOURCE_SUBJECT && method !== undefined && rest.length === 0
    ? "source.values"
    : null;
}

/**
 * The arrow whose body the innermost frames are in.
 *
 * @param frames - The open frames.
 * @returns The nearest arrow, innermost first, or `null`.
 */
function nearestArrow(frames: readonly Frame[]): Arrow | null {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const { arrow } = frames[index];
    if (arrow !== null) return arrow;
  }
  return null;
}

/**
 * Where a string that opens at `start` ends.
 *
 * @param text - The file.
 * @param start - The opening quote.
 * @returns The closing quote's offset. A `"` or `'` string also ends at a line break, so one
 *   missing quote does not swallow the file; a template literal may span lines. `text.length`
 *   when nothing ends it.
 */
function stringEnd(text: string, start: number): number {
  const quote = text[start];

  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") index += 1;
    else if (char === quote || (char === "\n" && quote !== "`")) return index;
  }
  return text.length;
}

/**
 * Where a comment that opens at `start` stops holding the cursor.
 *
 * @param text - The file.
 * @param start - The first `/`.
 * @returns The first offset outside it: just past the line break for `//` (the break's own
 *   offset is still the comment's line), just past `*\/` for a block, and `Infinity` for a block
 *   nothing closes — the rest of the file is the comment.
 */
function commentEnd(text: string, start: number): number {
  if (text[start + 1] === "/") {
    const lineBreak = text.indexOf("\n", start);
    return lineBreak === -1 ? Infinity : lineBreak + 1;
  }

  const close = text.indexOf("*/", start + 2);
  return close === -1 ? Infinity : close + 2;
}

/**
 * Scan the text up to an offset.
 *
 * @param text - The file.
 * @param limit - Where to stop — the cursor, or the start of the word under it.
 * @returns The scanner, holding what was open at `limit`.
 */
function scan(text: string, limit: number): Scanner {
  const scanner = new Scanner();
  let index = 0;

  while (index < limit) {
    const char = text[index];
    const next = text[index + 1];

    if (/\s/.test(char)) {
      index += 1;
    } else if (char === "/" && (next === "/" || next === "*")) {
      const end = commentEnd(text, index);
      if (end > limit) {
        scanner.inComment = true;
        break;
      }
      index = end;
    } else if (char === '"' || char === "'" || char === "`") {
      const end = stringEnd(text, index);
      if (end >= limit) {
        scanner.stringContent = index + 1;
        break;
      }
      if (text[end] === char) scanner.string(text.slice(index + 1, end));
      else scanner.reset();
      index = end + 1;
    } else if (IDENTIFIER_START.test(char)) {
      let end = index + 1;
      while (end < limit && IDENTIFIER_PART.test(text[end])) end += 1;
      scanner.identifier(text.slice(index, end), index);
      index = end;
    } else if (char === "=" && next === ">") {
      scanner.arrow();
      index += 2;
    } else if (char === "(" || char === "[" || char === "{") {
      scanner.open(char);
      index += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      scanner.close(char);
      index += 1;
    } else if (char === ",") {
      scanner.comma();
      index += 1;
    } else if (char === ":") {
      scanner.colon();
      index += 1;
    } else if (char === ".") {
      scanner.dot();
      index += 1;
    } else if (/\d/.test(char)) {
      while (index < limit && /[\w.]/.test(text[index])) index += 1;
      scanner.reset();
    } else {
      scanner.reset();
      index += 1;
    }
  }

  return scanner;
}

/**
 * The scope a member chain's next word belongs to.
 *
 * @param chain - The chain before the `.` — `route`, `i`, `i.effort`.
 * @param arrow - The arrow the chain is inside, if any.
 * @returns `route.methods`, `effort.constants`, `<kind>.subjects`, `<kind>.<subject>`, or `null`.
 */
function memberScope(chain: readonly string[], arrow: Arrow | null): string | null {
  if (chain.length === 1 && chain[0] === ROUTE_NAMESPACE) return "route.methods";
  if (chain.length === 1 && chain[0] === EFFORT_NAMESPACE) return "effort.constants";
  if (arrow === null || arrow.param === null || chain[0] !== arrow.param) return null;
  if (chain.length === 1) return `${arrow.kind}.subjects`;
  return chain.length === 2 ? `${arrow.kind}.${chain[1]}` : null;
}

/**
 * The scope the innermost frame offers, outside a member chain.
 *
 * @param scanner - The scan up to the cursor's word or string.
 * @returns The scope, or `null`.
 */
function frameScope(scanner: Scanner): string | null {
  const top = scanner.top();

  if (top?.type === "object") {
    if (top.base === null) return null;
    return top.afterColon ? valueScope(top) : `${top.base}.options`;
  }
  if (top?.type === "array") return top.meaning;
  if (top?.type === "call") return callScope(top, nearestArrow(scanner.frames));
  return null;
}

/**
 * Where the identifier characters before an offset start.
 *
 * @param text - The file.
 * @param offset - The cursor.
 * @returns The start of the word the cursor ends, or the cursor itself.
 */
function wordStart(text: string, offset: number): number {
  let start = offset;
  while (start > 0 && IDENTIFIER_PART.test(text[start - 1])) start -= 1;
  return start;
}

/**
 * What to complete at the cursor.
 *
 * @param text - The whole file.
 * @param pos - The cursor offset.
 * @returns The scope and the range a completion replaces, or `null` inside a comment and
 *   wherever no scope applies.
 */
export function completionPlace(text: string, pos: number): CompletionPlace | null {
  const atCursor = scan(text, pos);
  if (atCursor.inComment) return null;

  if (atCursor.stringContent !== null) {
    const scope = frameScope(atCursor);
    return scope === null ? null : { scope, from: atCursor.stringContent, quoted: true };
  }

  const from = wordStart(text, pos);
  const scanner = scan(text, from);
  const scope =
    scanner.expectMember && scanner.chain !== null
      ? memberScope(scanner.chain, nearestArrow(scanner.frames))
      : frameScope(scanner);

  return scope === null ? null : { scope, from, quoted: false };
}

/**
 * The symbol a whole member chain names.
 *
 * @param chain - The chain, the hovered word last — `route.task`, `i.effort.lte`.
 * @param arrow - The arrow the chain is inside, if any.
 * @returns `route.<method>`, `effort.<constant>`, `<kind>.<subject>.<method>`, or `null`.
 */
function memberSymbol(chain: readonly string[], arrow: Arrow | null): string | null {
  if (chain.length === 2 && (chain[0] === ROUTE_NAMESPACE || chain[0] === EFFORT_NAMESPACE)) {
    return chain.join(".");
  }
  if (chain.length === 3 && arrow !== null && arrow.param !== null && chain[0] === arrow.param) {
    return `${arrow.kind}.${chain[1]}.${chain[2]}`;
  }
  return null;
}

/**
 * The symbol under the pointer.
 *
 * @param text - The whole file.
 * @param pos - The offset the pointer is over.
 * @returns The symbol and the text it spans, or `null` over anything that is not one of the
 *   grammar's words where the grammar puts it — a string, a comment, a node id, a key of an
 *   object the grammar does not open. Whether the table *describes* the symbol is the caller's
 *   question.
 */
export function hoverTarget(text: string, pos: number): HoverTarget | null {
  const from = wordStart(text, pos);
  let to = pos;
  while (to < text.length && IDENTIFIER_PART.test(text[to])) to += 1;
  if (from === to || !IDENTIFIER_START.test(text[from])) return null;

  const scanner = scan(text, from);
  if (scanner.inComment || scanner.stringContent !== null) return null;

  const word = text.slice(from, to);
  const following = /\S/.exec(text.slice(to))?.[0];
  const top = scanner.top();

  if (scanner.expectMember && scanner.chain !== null) {
    const symbol = memberSymbol([...scanner.chain, word], nearestArrow(scanner.frames));
    return symbol === null ? null : { symbol, from: scanner.chainStart, to };
  }

  if (following === "(") {
    if (word === DEFINE_LOOP) return { symbol: word, from, to };
    return top?.type === "array" && top.meaning === STAGES_SCOPE
      ? { symbol: `stage.${word}`, from, to }
      : null;
  }

  if (following === ":" && top?.type === "object" && !top.afterColon && top.base !== null) {
    return { symbol: `${top.base}.${word}`, from, to };
  }

  return null;
}
