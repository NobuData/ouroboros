import { Card, Chip, cx } from "@/app/ui";

import { AddressRow } from "./address-row";
import { CapField, CapMeter, CapScope } from "./cap-field";
import { CardMenu } from "./card-menu";
import {
  type CardModel,
  MODELS_LABEL,
  type ModelsRegion as Region,
  type MonogramTint,
} from "./cards";
import { KeyRow } from "./key-row";
import { ModelsRegion } from "./models-region";
import { ProviderSwitch } from "./provider-switch";
import { TestConnection } from "./test-connection";

import "./providers.css";

/**
 * Mockup 07's provider card ([#228](https://github.com/NobuData/ouroboros/issues/228)) —
 * **one component**, drawn from a model `app/providers/cards.ts` composed from the adapter's
 * schema and capabilities, the connection, its health, its month and its models.
 *
 * There is no provider kind in this file and no branch on one. What differs between the
 * Anthropic card and the Ollama card is *data*: whether the model carries an address row,
 * whether it carries a secret row, whether the models region is chips or a pull-list, whether
 * the meter has a cap to fill against. Each of those is a field of {@link CardModel}, and the
 * card draws whichever are present. `__tests__/providers/provider-card.test.tsx` feeds it a
 * sixth kind no file here names and asserts the card is correct.
 *
 * ### What is live, and what is honestly not
 *
 * The **switch** persists (`provider-switch.tsx`); since AE.3
 * ([#229](https://github.com/NobuData/ouroboros/issues/229)) the **key row** reveals,
 * rotates and saves (`key-row.tsx`), the **address** validates on save (`address-row.tsx`),
 * and the head's **overflow menu** deletes behind the dependency guard (`card-menu.tsx`);
 * and since AE.4 ([#230](https://github.com/NobuData/ouroboros/issues/230)) the foot's
 * **Test connection** answers with what the provider said (`test-connection.tsx`), the
 * **models region** refreshes and flags a stranded alias (`models-region.tsx`), and the
 * pull-list's **Pull latest** streams a transfer the service tracks (`pull-list.tsx`); and
 * since AE.6 ([#232](https://github.com/NobuData/ouroboros/issues/232)) the foot's
 * **Monthly cap** saves and the meter above it moves with it (`cap-field.tsx`), warning-only
 * and labelled so until AF.4 ([#237](https://github.com/NobuData/ouroboros/issues/237)).
 * Nothing on the card is drawn inert with an issue named any more.
 *
 * A Server Component. The controls that write are its Client Component islands, each handed
 * the decided model and a `mayAdminister` boolean; a member is handed the same card with
 * those islands drawn read-only or absent, never a different card. Every figure arrives
 * already decided, so this file is a description of a card.
 *
 * ### Switched off, and degraded, are two treatments
 *
 * A switched-off connection is dimmed and its frame goes dashed — the sheet's treatment for
 * *not in play*, the same one the dashed add card and a promised catalog tile wear — and
 * the switch says in words that routing skips it. A degraded one keeps its full ink and
 * solid frame and carries the warn or error pill: it is in play and struggling, which is
 * the opposite fact.
 */

/**
 * The modifier each tint adds. Every tint has one — a monogram never falls back to another's
 * — and the names are written out so the sheet's own suite can find each of them rendered.
 */
const TINT_CLASS: Record<MonogramTint, string> = {
  model: "providers-card__monogram--model",
  accent: "providers-card__monogram--accent",
  warn: "providers-card__monogram--warn",
  ok: "providers-card__monogram--ok",
  neutral: "providers-card__monogram--neutral",
};

/** What the card takes. */
export interface ProviderCardProps {
  /** The decided card. */
  readonly model: CardModel;
  /** Whether this reader may press the switch. */
  readonly mayAdminister: boolean;
}

/**
 * The card.
 *
 * @param props See {@link ProviderCardProps}.
 * @returns A `section` named by its heading, dimmed and dashed when the connection is
 *   switched off.
 */
export function ProviderCard({ model, mayAdminister }: ProviderCardProps) {
  const headingId = `provider-${model.id}-name`;

  return (
    <Card
      aria-labelledby={headingId}
      as="section"
      className={cx("providers-card", !model.enabled && "providers-card--off")}
      fill
    >
      <header className="providers-card__head">
        <span
          aria-hidden="true"
          className={cx("providers-card__monogram", TINT_CLASS[model.monogram.tint])}
        >
          {model.monogram.letters}
        </span>
        <div className="providers-card__identity">
          <h2 className="providers-card__name" id={headingId}>
            {model.name}
          </h2>
          {model.capabilityNote !== null && (
            <p className="providers-card__note">{model.capabilityNote}</p>
          )}
        </div>
        <Chip dot={model.pill.dot} title={model.pillDetail ?? undefined} tone={model.pill.tone}>
          {model.pill.label}
        </Chip>
        <ProviderSwitch
          dependents={model.dependents}
          displayName={model.name}
          enabled={model.enabled}
          id={model.id}
          mayAdminister={mayAdminister}
        />
        {/* The overflow menu is an administrator's affordance: a member sees none of these. */}
        {mayAdminister && <CardMenu connectionId={model.id} displayName={model.name} />}
      </header>

      {model.address !== null && (
        <AddressRow address={model.address} connectionId={model.id} mayAdminister={mayAdminister} />
      )}

      {model.secret !== null && (
        <KeyRow
          connectionId={model.id}
          displayName={model.name}
          mayAdminister={mayAdminister}
          secret={model.secret}
        />
      )}

      <p className="providers-card__meta">
        Added by {model.meta.addedBy} · {model.meta.addedOn} · last used {model.meta.lastUsed}
      </p>

      <ModelsRegionView id={model.id} mayAdminister={mayAdminister} region={model.models} />

      {/*
        The meter and the foot's cap field share the cap through the scope, so a saved cap
        moves the meter before the route has re-read. The scope adds no element, so the foot
        is still the card's last flex child and `margin-top: auto` still lands it.
      */}
      <CapScope connectionId={model.id} spend={model.spend}>
        <CapMeter />

        <footer className="providers-card__foot">
          <TestConnection connectionId={model.id} mayAdminister={mayAdminister} />
          <CapField connectionId={model.id} mayAdminister={mayAdminister} />
        </footer>
      </CapScope>
    </Card>
  );
}

/**
 * The models region: the line that says why it could not be read, or the live island.
 *
 * The unavailable state is drawn here, on the server, because it is a sentence and nothing
 * else; the two regions with something to refresh, animate or pull are `models-region.tsx`'s.
 *
 * @param props.id The connection, for the region's heading id.
 * @param props.mayAdminister Whether this reader may refresh or pull.
 * @param props.region The decided region.
 * @returns The label and what follows it.
 */
function ModelsRegionView({
  id,
  mayAdminister,
  region,
}: Readonly<{ id: string; mayAdminister: boolean; region: Region }>) {
  if (region.kind === "unavailable") {
    return (
      <div className="providers-card__models">
        <p className="providers-card__models-label" id={`provider-${id}-models`}>
          {MODELS_LABEL}
        </p>
        <p className="providers-card__models-state" role="status">
          {region.reason}
        </p>
      </div>
    );
  }

  return <ModelsRegion connectionId={id} mayAdminister={mayAdminister} region={region} />;
}
