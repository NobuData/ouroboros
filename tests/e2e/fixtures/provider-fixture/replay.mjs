/**
 * The replay — every decision the provider fixture makes about one request, as pure
 * functions over the recording and the request body. `server.mjs` owns the socket; nothing
 * here reads one, which is what lets each rule be exercised by hand with a JSON document.
 *
 * ---------------------------------------------------------------------------
 * **Content, never counts.** The turn to play is the number of `tool_use` blocks already in
 * the request's assistant history (`turnOf`). A harness that resumes a session replays its
 * history with one message per content block, and a stub that counted messages would answer
 * the wrong turn to a resumed session — `docs/DECISION_EXECUTION_ENGINE.md` § *must key on
 * content*. The same rule the engine's own scripted facade applies
 * (`ouroboros-engine/tests/harness_stub_facade.py`).
 *
 * **Loud, never obscure.** Three things can make a recording the wrong answer: it was made
 * with a different harness (`harnessMismatch`), the harness asked for a turn the recording
 * does not hold (`turnOf` past the script), or the harness arrived at a turn with tool results
 * that are not the ones the recording expects there (`expectationMismatch` — the deliberate
 * failure-then-correction is exactly such an expectation: the third turn's `Edit` *must* have
 * failed). Each is answered as a `400` whose message names the recording's harness version and
 * what differed, and is logged with a `mismatch` key, so a session that cannot complete says
 * why in the first line a person reads.
 *
 * **Verbatim.** The recorded blocks are answered as recorded. Every path in them is relative
 * to the working tree — the harness's `Glob` answers `bin/greet`, and its `Read` and `Edit`
 * take that back — so a turn does not depend on where the engine put the tree, and nothing in
 * the recording is rewritten on the way out.
 */

/** The error shape the Anthropic Messages API answers with, which the facade relays unread. */
export function anthropicError(type, message) {
  return { type: "error", error: { type, message } };
}

/**
 * Load and check a recording.
 *
 * @param {unknown} document The parsed JSON.
 * @returns {Record<string, any>} The recording.
 * @throws {Error} When the document is not a format-1 recording with at least one session.
 */
export function checkRecording(document) {
  const recording = /** @type {Record<string, any>} */ (document);
  const problems = [];

  if (typeof recording !== "object" || recording === null) problems.push("not an object");
  else {
    if (recording.format !== 1) problems.push(`format ${String(recording.format)} is not 1`);
    if (typeof recording.recording !== "string") problems.push("no `recording` name");
    const harness = recording.harness;
    if (typeof harness !== "object" || harness === null) problems.push("no `harness`");
    else {
      for (const field of ["sdk", "cli", "anthropic_version"]) {
        if (typeof harness[field] !== "string") problems.push(`harness.${field} is not a string`);
      }
      if (!Array.isArray(harness.anthropic_beta))
        problems.push("harness.anthropic_beta is not a list");
      if (!Array.isArray(harness.tools)) problems.push("harness.tools is not a list");
    }
    const sessions = recording.sessions;
    if (typeof sessions !== "object" || sessions === null || Object.keys(sessions).length === 0) {
      problems.push("no `sessions`");
    } else {
      for (const [name, session] of Object.entries(sessions)) {
        if (typeof session.model !== "string") problems.push(`session ${name} has no model`);
        if (!Array.isArray(session.turns) || session.turns.length === 0) {
          problems.push(`session ${name} has no turns`);
        }
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`not a provider-fixture recording: ${problems.join("; ")}`);
  }

  return recording;
}

/** The sentence every refusal ends with — where a stale recording is made fresh. */
export function reRecordHint() {
  return "Re-record it (ouroboros-engine/tests/test_live_slice_recording.py, OURO_RECORD_LIVE_SLICE=1).";
}

/** `Claude Agent SDK 0.2.167 (CLI 2.1.300)` — the harness a recording was made with. */
export function harnessLabel(recording) {
  return `Claude Agent SDK ${recording.harness.sdk} (CLI ${recording.harness.cli})`;
}

/**
 * Whether a request carries a key the fixture accepts: `x-api-key` or a bearer token
 * beginning with the accepted prefix. One rule rather than a list, for `provider-stub`'s
 * reason: a leg asserts a refusal with a key the rule rejects, not with a switch.
 *
 * @param {Record<string, string | string[] | undefined>} headers The request headers, lower-cased.
 * @param {string} prefix What an accepted key begins with — `ouro-e2e-` behind the facade
 *   (the key the leg stores on the seeded connection); `ouro_hrn_` when the harness is driven
 *   at this socket directly, as the engine's recording test does, because then the run-scoped
 *   credential arrives here unswapped.
 * @returns {boolean}
 */
export function authorized(headers, prefix) {
  const key = headers["x-api-key"];
  if (typeof key === "string") return key.startsWith(prefix);

  const authorization = headers.authorization;
  if (typeof authorization !== "string") return false;

  const [scheme, ...rest] = authorization.split(" ");
  return scheme.toLowerCase() === "bearer" && rest.join(" ").startsWith(prefix);
}

/**
 * Which provider route a path names, by its suffix: the facade puts its own prefix
 * (`/internal/harness/anthropic`) in front of the Messages API's paths, and the harness driven
 * directly posts to whatever base it was given plus `/v1/messages`.
 *
 * @param {string} pathname The request path.
 * @returns {"messages" | "count_tokens" | "models" | null}
 */
export function providerRoute(pathname) {
  if (pathname.endsWith("/v1/messages/count_tokens")) return "count_tokens";
  if (pathname.endsWith("/v1/messages")) return "messages";
  if (pathname.endsWith("/v1/models")) return "models";
  return null;
}

/**
 * The beta names a request carries, sorted — `anthropic-beta` is a comma-separated list.
 *
 * @param {string | string[] | undefined} header The header's value.
 * @returns {string[]}
 */
export function betaSet(header) {
  const value = Array.isArray(header) ? header.join(",") : (header ?? "");
  return value
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "")
    .sort();
}

/**
 * Whether a request is the session's own traffic: it offers the file tools, `Write` among
 * them. Anything else the harness sends — a title, a summary — is side traffic and gets the
 * recording's one-word answer.
 *
 * @param {Record<string, any>} body The request body.
 * @returns {boolean}
 */
export function isMain(body) {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return tools.some((tool) => tool !== null && typeof tool === "object" && tool.name === "Write");
}

/**
 * The first text the user turn carries — what a session is recognised by when the model id
 * does not name it.
 *
 * @param {Record<string, any>} body The request body.
 * @returns {string}
 */
export function firstUserText(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];

  for (const message of messages) {
    if (message?.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block?.type === "text" && typeof block.text === "string") return block.text;
    }
  }

  return "";
}

/**
 * Which recorded session a request belongs to: the one whose model (the hop's id, which the
 * facade writes into `body.model`) or alias (what the harness itself asks for) matches, else
 * the one whose prompt prefix opens the first user text.
 *
 * @param {Record<string, any>} recording The recording.
 * @param {Record<string, any>} body The request body.
 * @returns {{ name: string, session: Record<string, any> } | null}
 */
export function sessionOf(recording, body) {
  const entries = Object.entries(recording.sessions);
  const model = typeof body.model === "string" ? body.model : "";

  const byModel = entries.find(([, s]) => s.model === model || s.alias === model);
  if (byModel !== undefined) return { name: byModel[0], session: byModel[1] };

  const text = firstUserText(body);
  const byPrompt = entries.find(
    ([, s]) => typeof s.prompt_prefix === "string" && text.startsWith(s.prompt_prefix),
  );
  if (byPrompt !== undefined) return { name: byPrompt[0], session: byPrompt[1] };

  return null;
}

/**
 * The refusal for a harness that is not the recording's, or null when the beta sets agree.
 *
 * @param {Record<string, any>} recording The recording.
 * @param {string[]} observed The request's beta set, sorted.
 * @returns {string | null} The message.
 */
export function harnessMismatch(recording, observed) {
  const recorded = [...recording.harness.anthropic_beta].sort();
  const missing = recorded.filter((name) => !observed.includes(name));
  const extra = observed.filter((name) => !recorded.includes(name));

  if (missing.length === 0 && extra.length === 0) return null;

  return (
    `recording ${recording.recording} was made with ${harnessLabel(recording)}; ` +
    `this harness's beta set differs — missing: ${missing.join(",") || "none"}; ` +
    `extra: ${extra.join(",") || "none"}. ${reRecordHint()}`
  );
}

/**
 * The turn a request asks for: how many `tool_use` blocks its assistant history holds.
 *
 * @param {Record<string, any>} body The request body.
 * @returns {number}
 */
export function turnOf(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  let count = 0;

  for (const message of messages) {
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block?.type === "tool_use") count += 1;
    }
  }

  return count;
}

/**
 * The tool results the request's last user message carries — id and whether the tool failed.
 *
 * @param {Record<string, any>} body The request body.
 * @returns {{ tool_use_id: string, is_error: boolean }[]}
 */
export function observedToolResults(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const last = [...messages].reverse().find((message) => message?.role === "user");

  if (last === undefined || !Array.isArray(last.content)) return [];

  return last.content
    .filter((block) => block?.type === "tool_result")
    .map((block) => ({
      tool_use_id: String(block.tool_use_id),
      is_error: block.is_error === true,
    }));
}

/**
 * The refusal for a turn reached with other tool results than the recording expects there,
 * or null when they agree.
 *
 * @param {Record<string, any>} recording The recording.
 * @param {number} turn The turn asked for.
 * @param {Record<string, any>} expected The turn's `expect`.
 * @param {{ tool_use_id: string, is_error: boolean }[]} observed What the request carries.
 * @returns {string | null}
 */
export function expectationMismatch(recording, turn, expected, observed) {
  const wanted = (Array.isArray(expected?.tool_results) ? expected.tool_results : []).map(
    (result) => ({ tool_use_id: String(result.tool_use_id), is_error: result.is_error === true }),
  );
  const print = (results) =>
    results.length === 0
      ? "none"
      : results.map((r) => `${r.tool_use_id}${r.is_error ? " (error)" : ""}`).join(", ");

  if (JSON.stringify(wanted) === JSON.stringify(observed)) return null;

  return (
    `recording ${recording.recording} (${harnessLabel(recording)}) expects turn ${String(turn)} ` +
    `to follow tool results ${print(wanted)}; this harness sent ${print(observed)}. ${reRecordHint()}`
  );
}

/**
 * Decide one `POST /v1/messages`.
 *
 * @param {Record<string, any>} recording The recording.
 * @param {Record<string, any>} body The request body.
 * @param {Record<string, string | string[] | undefined>} headers The request headers.
 * @returns {{ status: 200, content: unknown[], session: string | null, turn: number | null, main: boolean }
 *   | { status: 400, message: string, mismatch: "harness" | "turn" | "session", session: string | null, turn: number | null, main: true }}
 */
export function decide(recording, body, headers) {
  if (!isMain(body)) {
    return { status: 200, content: recording.side_traffic, session: null, turn: null, main: false };
  }

  const found = sessionOf(recording, body);
  if (found === null) {
    return {
      status: 400,
      mismatch: "session",
      session: null,
      turn: null,
      main: true,
      message:
        `recording ${recording.recording} holds no session for model ${JSON.stringify(body.model)} ` +
        `(recorded: ${Object.entries(recording.sessions)
          .map(([name, s]) => `${name} as ${String(s.model)}`)
          .join(", ")}).`,
    };
  }
  const { name, session } = found;

  const harness = harnessMismatch(recording, betaSet(headers["anthropic-beta"]));
  if (harness !== null) {
    return {
      status: 400,
      mismatch: "harness",
      session: name,
      turn: null,
      main: true,
      message: harness,
    };
  }

  const turn = turnOf(body);
  if (turn >= session.turns.length) {
    return {
      status: 400,
      mismatch: "turn",
      session: name,
      turn,
      main: true,
      message:
        `the harness asked session ${name} for turn ${String(turn)}, and recording ` +
        `${recording.recording} (${harnessLabel(recording)}) holds ${String(session.turns.length)} ` +
        `turns (0–${String(session.turns.length - 1)}). ${reRecordHint()}`,
    };
  }

  const scripted = session.turns[turn];
  const expectation = expectationMismatch(
    recording,
    turn,
    scripted.expect,
    observedToolResults(body),
  );
  if (expectation !== null) {
    return { status: 400, mismatch: "turn", session: name, turn, main: true, message: expectation };
  }

  // The recorded blocks, verbatim: the harness answers `Glob` with paths relative to its
  // working tree and takes relative paths back in `Read` and `Edit`, so nothing in a turn
  // depends on where the engine put the tree.
  return { status: 200, content: scripted.content, session: name, turn, main: true };
}

/** `tool_use` when the answer calls a tool, else `end_turn` — what the stream's delta says. */
export function stopReasonOf(content) {
  return content.some((block) => block?.type === "tool_use") ? "tool_use" : "end_turn";
}

/**
 * The answer's usage: a rough token count, so the facade's metering has numbers to write.
 *
 * @param {number} inputBytes The request body's length.
 * @param {unknown[]} content The answer.
 * @returns {{ input_tokens: number, output_tokens: number }}
 */
export function usageOf(inputBytes, content) {
  return {
    input_tokens: Math.max(1, Math.floor(inputBytes / 4)),
    output_tokens: Math.max(1, Math.floor(JSON.stringify(content).length / 4)),
  };
}

/**
 * The Messages API's event stream for one answer — the frames `message_start` through
 * `message_stop`, each `event: <name>\ndata: <json>\n\n`.
 *
 * @param {string} id The message id.
 * @param {string} model What the request asked for, echoed.
 * @param {unknown[]} content The answer's blocks.
 * @param {{ input_tokens: number, output_tokens: number }} usage The usage to report.
 * @returns {string[]} The frames, in order.
 */
export function sseFrames(id, model, content, usage) {
  const frame = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  const frames = [
    frame("message_start", {
      type: "message_start",
      message: {
        id,
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: usage.input_tokens, output_tokens: 1 },
      },
    }),
    frame("ping", { type: "ping" }),
  ];

  content.forEach((block, index) => {
    const isText = block.type === "text";
    frames.push(
      frame("content_block_start", {
        type: "content_block_start",
        index,
        content_block: isText
          ? { type: "text", text: "" }
          : { type: "tool_use", id: block.id, name: block.name, input: {} },
      }),
      frame("content_block_delta", {
        type: "content_block_delta",
        index,
        delta: isText
          ? { type: "text_delta", text: block.text }
          : { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
      }),
      frame("content_block_stop", { type: "content_block_stop", index }),
    );
  });

  frames.push(
    frame("message_delta", {
      type: "message_delta",
      delta: { stop_reason: stopReasonOf(content), stop_sequence: null },
      usage: { output_tokens: usage.output_tokens },
    }),
    frame("message_stop", { type: "message_stop" }),
  );

  return frames;
}

/**
 * The non-streaming answer — one `message` document.
 *
 * @param {string} id The message id.
 * @param {string} model What the request asked for, echoed.
 * @param {unknown[]} content The answer's blocks.
 * @param {{ input_tokens: number, output_tokens: number }} usage The usage to report.
 * @returns {Record<string, unknown>}
 */
export function messageDocument(id, model, content, usage) {
  return {
    id,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: stopReasonOf(content),
    stop_sequence: null,
    usage,
  };
}

/**
 * The recording's models, in the listing shape `GET /v1/models` documents.
 *
 * @param {Record<string, any>} recording The recording.
 * @returns {Record<string, unknown>}
 */
export function modelsListing(recording) {
  const ids = [
    ...new Set(Object.values(recording.sessions).map((session) => String(session.model))),
  ];
  const data = ids.map((id) => ({
    type: "model",
    id,
    display_name: `${id} (recorded fixture)`,
    created_at: recording.recorded_at ?? "2026-01-01T00:00:00Z",
  }));

  return {
    data,
    has_more: false,
    first_id: data[0]?.id ?? null,
    last_id: data[data.length - 1]?.id ?? null,
  };
}

/**
 * The recording's metadata, without its turns — what `/__fixture/recording` answers.
 *
 * @param {Record<string, any>} recording The recording.
 * @returns {Record<string, unknown>}
 */
export function recordingSummary(recording) {
  return {
    recording: recording.recording,
    format: recording.format,
    source: recording.source ?? null,
    recorded_at: recording.recorded_at ?? null,
    harness: recording.harness,
    sessions: Object.fromEntries(
      Object.entries(recording.sessions).map(([name, session]) => [
        name,
        {
          alias: session.alias ?? null,
          model: session.model,
          prompt_prefix: session.prompt_prefix ?? null,
          turns: session.turns.length,
          files_after: session.files_after ?? null,
        },
      ]),
    ),
  };
}
