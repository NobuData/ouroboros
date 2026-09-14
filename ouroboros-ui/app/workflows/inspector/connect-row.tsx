"use client";

import { useId, useState } from "react";

import type { WorkflowDefinition } from "@/app/api/workflows";
import { Button, SelectField } from "@/app/ui";
import { readStages } from "@/app/workflows/canvas/graph";
import { edgeProblem } from "@/app/workflows/canvas/rules";
import { RULE_REASONS } from "@/app/workflows/canvas/view";

import {
  CONNECTED_NOTE,
  CONNECTIONS_LABEL,
  CONNECT_CHOOSE_REASON,
  CONNECT_HINT,
  CONNECT_LABEL,
  CONNECT_TARGET_LABEL,
} from "./inspector";

/** What the row takes. */
export interface ConnectRowProps {
  /** The draft — the stages to connect to, and the rules a connection is judged by. */
  readonly definition: WorkflowDefinition;
  /** The stage the connection leaves. */
  readonly from: string;
  /** Told the stage chosen, once **Connect** is pressed. */
  readonly onConnect: (to: string) => void;
  /** Why the reader may not edit, or `undefined` when they may. */
  readonly readOnlyReason: string | undefined;
}

/**
 * **Connect to** — the keyboard's way to draw a connection (S.5,
 * [#151](https://github.com/NobuData/ouroboros/issues/151)).
 *
 * On the canvas a connection is a drag from one stage's side to another's, which no keyboard can make.
 * The ticket asks that every operation be reachable by keyboard, so the selected stage's panel offers
 * the same edit as a choice: pick a stage, press **Connect**, and a default edge is drawn — judged by
 * the same rules a drag is (`canvas/rules.ts`), with the reason under the field and on the button when
 * the choice would break one.
 *
 * @param props See {@link ConnectRowProps}.
 * @returns The section.
 */
export function ConnectRow({ definition, from, onConnect, readOnlyReason }: ConnectRowProps) {
  const id = useId();
  const [to, setTo] = useState("");
  const [connected, setConnected] = useState(false);

  const targets = readStages(definition).filter((stage) => stage.id !== from);
  const problem = to === "" ? null : edgeProblem(definition, { from, to, kind: "default" });
  const reason = readOnlyReason ?? (to === "" ? CONNECT_CHOOSE_REASON : problem === null ? undefined : RULE_REASONS[problem]);

  const connect = () => {
    onConnect(to);
    setTo("");
    setConnected(true);
  };

  return (
    <div className="studio-inspector__block">
      <p className="studio-inspector__section">{CONNECTIONS_LABEL}</p>
      <SelectField
        error={problem === null ? undefined : RULE_REASONS[problem]}
        hint={CONNECT_HINT}
        id={`${id}-target`}
        label={CONNECT_TARGET_LABEL}
        onChange={(event) => {
          setTo(event.target.value);
          setConnected(false);
        }}
        value={to}
      >
        <option value="">—</option>
        {targets.map((stage) => (
          <option key={stage.id} value={stage.id}>
            {`${stage.title} (${stage.id})`}
          </option>
        ))}
      </SelectField>
      <div className="studio-inspector__connect">
        <Button onClick={connect} reason={reason} size="sm">
          {CONNECT_LABEL}
        </Button>
        {/* Polite, not a second status: the footer's status line is the panel's. */}
        <p aria-live="polite" className="studio-inspector__note">
          {connected ? CONNECTED_NOTE : ""}
        </p>
      </div>
    </div>
  );
}
