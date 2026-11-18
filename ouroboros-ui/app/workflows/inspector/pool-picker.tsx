"use client";

import { SelectField } from "@/app/ui";
import {
  DEFAULT_POOL_REFERENCE,
  NO_POOL_LABEL,
  type PoolChoice,
  defaultOptionLabel,
  isKnownPool,
  poolOptionLabel,
  unknownOptionLabel,
} from "@/app/workflows/pools";

/** What the picker takes. */
export interface PoolPickerProps {
  /** The select's id. */
  readonly id: string;
  /** What the label says — the schema's title for `runner_pool`. */
  readonly label: string;
  /** The stage's `runner_pool`, whatever it holds. */
  readonly value: unknown;
  /** The workspace's pools. */
  readonly pools: readonly PoolChoice[];
  /** Whether the schema requires a pool. When it does not, the stage may name none. */
  readonly required: boolean;
  /** Told the new value, or `undefined` to remove the key. */
  readonly onChange: (value: string | undefined) => void;
  /** What is wrong, or `undefined`. */
  readonly error: string | undefined;
}

/**
 * A build or test stage's **Runner pool** — FE.2 ([#1835](https://github.com/NobuData/ouroboros/issues/1835)).
 *
 * A select in place of the free-text field the generated form would draw: *Workspace default*
 * (`$default`, naming the pool it resolves to today), then each pool of the workspace with its
 * online runner count. A name the stage already holds that the workspace does not have is kept as
 * its own option, marked *unknown*, so the select never silently shows something else — the
 * error under it says what to do.
 *
 * @param props See {@link PoolPickerProps}.
 * @returns The select.
 */
export function PoolPicker({ id, label, value, pools, required, onChange, error }: PoolPickerProps) {
  const current = typeof value === "string" ? value : "";
  const unknown = current !== "" && !isKnownPool(current, pools);

  return (
    <SelectField
      error={error}
      id={id}
      label={label}
      onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
      value={current}
    >
      {(!required || current === "") && <option value="">{NO_POOL_LABEL}</option>}
      <option value={DEFAULT_POOL_REFERENCE}>{defaultOptionLabel(pools)}</option>
      {pools.map((pool) => (
        <option key={pool.name} value={pool.name}>
          {poolOptionLabel(pool)}
        </option>
      ))}
      {unknown && <option value={current}>{unknownOptionLabel(current)}</option>}
    </SelectField>
  );
}
