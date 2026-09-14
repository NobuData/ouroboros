"use client";

import { useLayoutEffect, useRef } from "react";

import {
  PALETTE_LABEL,
  PALETTE_NOTE,
  type PaletteVariables,
  UPSTREAM_LABEL,
  insertLabel,
  templateSegments,
  variableToken,
} from "./inspector";

/**
 * The prompt-template editor: a textarea with its `{{variable}}` placeholders highlighted, and
 * the variable palette under it (S.4, [#150](https://github.com/NobuData/ouroboros/issues/150)).
 *
 * **A native textarea over a highlight layer**, not an embedded code editor. The textarea is
 * what the reader types into, so the keyboard, selection, undo, spell-check off, and a screen
 * reader's reading of it are the platform's; behind it, a `<pre>` of the same text in the same
 * font and wrapping draws each placeholder in the model hue (the mockup's `.c-fn`). The textarea's
 * own text is transparent and its caret is not, so the reader sees one text, highlighted.
 *
 * The palette's buttons insert at the caret and put the caret after what they inserted, so a
 * reader can pick three variables in a row without reaching for the mouse between them.
 *
 * @param props.id The textarea's id.
 * @param props.label What the section is called.
 * @param props.value The template.
 * @param props.onChange Told the new template.
 * @param props.variables What the palette offers.
 * @param props.error What is wrong with the template, or `undefined`.
 * @param props.disabled Whether the reader may edit.
 * @returns The editor.
 */
export function PromptEditor({
  id,
  label,
  value,
  onChange,
  variables,
  error,
  disabled,
}: Readonly<{
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  variables: PaletteVariables;
  error: string | undefined;
  disabled: boolean;
}>) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const highlight = useRef<HTMLPreElement>(null);
  // Where the caret goes once an insertion has rendered. Held in a ref because it is an
  // instruction for the next layout, not state anything draws from.
  const caret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const element = textarea.current;
    if (caret.current === null || element === null) return;
    element.focus();
    element.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [value]);

  const insert = (name: string) => {
    const element = textarea.current;
    const token = variableToken(name);
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;

    caret.current = start + token.length;
    onChange(`${value.slice(0, start)}${token}${value.slice(end)}`);
  };

  const errorId = `${id}-error`;
  const noteId = `${id}-note`;

  return (
    <div className="studio-inspector__prompt">
      <label className="studio-inspector__section" htmlFor={id}>
        {label}
      </label>
      <div className="studio-inspector__editor">
        <pre aria-hidden="true" className="studio-inspector__highlight" ref={highlight}>
          {templateSegments(value).map((segment, index) =>
            segment.variable ? (
              <span className="studio-inspector__variable" key={index}>
                {segment.text}
              </span>
            ) : (
              segment.text
            ),
          )}
          {/* A trailing newline in a textarea is a line; in a <pre> it is not, without this. */}
          {"\n"}
        </pre>
        <textarea
          aria-describedby={error === undefined ? noteId : `${errorId} ${noteId}`}
          aria-invalid={error === undefined ? undefined : true}
          className="studio-inspector__template"
          disabled={disabled}
          id={id}
          onChange={(event) => onChange(event.target.value)}
          onScroll={(event) => {
            if (highlight.current !== null) highlight.current.scrollTop = event.currentTarget.scrollTop;
          }}
          ref={textarea}
          rows={7}
          spellCheck={false}
          value={value}
        />
      </div>
      {error !== undefined && (
        <p className="studio-inspector__error" id={errorId} role="alert">
          {error}
        </p>
      )}
      <div aria-label={PALETTE_LABEL} className="studio-inspector__palette" role="group">
        {variables.context.map((name) => (
          <PaletteButton disabled={disabled} key={name} name={name} onInsert={insert} />
        ))}
        {variables.stages.length > 0 && (
          <span className="studio-inspector__palette-group">{UPSTREAM_LABEL}</span>
        )}
        {variables.stages.map((name) => (
          <PaletteButton disabled={disabled} key={name} name={name} onInsert={insert} />
        ))}
      </div>
      <p className="studio-inspector__note" id={noteId}>
        {PALETTE_NOTE}
      </p>
    </div>
  );
}

/**
 * One variable in the palette.
 *
 * @param props.name The variable.
 * @param props.onInsert Told which variable to insert.
 * @param props.disabled Whether the reader may edit.
 * @returns The button.
 */
function PaletteButton({
  name,
  onInsert,
  disabled,
}: Readonly<{ name: string; onInsert: (name: string) => void; disabled: boolean }>) {
  return (
    <button
      aria-label={insertLabel(name)}
      className="studio-inspector__token"
      disabled={disabled}
      // Keep the textarea's selection: a mouse press would otherwise move focus before the click.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onInsert(name)}
      type="button"
    >
      {variableToken(name)}
    </button>
  );
}
