/**
 * What is typed into „+ Gericht“ of a meal, kept outside the fields: list and calendar show the
 * same draft, it survives switching between them, a read-only phase (maintenance) and a failed
 * save. `PlanTage.svelte` asks before leaving with a draft and names it when its meal goes.
 */

export interface SlotEntwurf {
  offen: boolean;
  name: string;
  zustaendig: string;
  /** The meal as shown when typed, „1_2 Mittagessen“, to name it once the meal is gone. */
  mahlzeit: string;
}

/** Drafts by meal id. */
export const slotEntwuerfe = $state<Record<number, SlotEntwurf>>({});

/** Changes the draft of a meal; one that is closed and empty is forgotten. */
export function setzeEntwurf(
  mahlzeitId: number,
  mahlzeit: string,
  teil: Partial<Omit<SlotEntwurf, 'mahlzeit'>>
): void {
  const bisher = slotEntwuerfe[mahlzeitId];
  const neu: SlotEntwurf = {
    offen: teil.offen ?? bisher?.offen ?? false,
    name: teil.name ?? bisher?.name ?? '',
    zustaendig: teil.zustaendig ?? bisher?.zustaendig ?? '',
    mahlzeit,
  };
  if (!neu.offen && !neu.name && !neu.zustaendig) delete slotEntwuerfe[mahlzeitId];
  else slotEntwuerfe[mahlzeitId] = neu;
}

/** Whether a draft holds typed text. */
export function getippt(entwurf: SlotEntwurf | undefined): boolean {
  return Boolean(entwurf && (entwurf.name.trim() || entwurf.zustaendig.trim()));
}
