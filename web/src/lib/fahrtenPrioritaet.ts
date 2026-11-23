/**
 * How willing someone who offered seats is to drive: `zuerst` drives before the others,
 * `notfalls` only if the seats of the others are not enough. Without an entry, `normal`.
 */
export type FahrerPrioritaet = 'zuerst' | 'normal' | 'notfalls';

/** Priority per person id; people with `normal` are left out. */
export type FahrerPrioritaeten = Readonly<Record<string, FahrerPrioritaet>>;

export const FAHRER_PRIORITAETEN: readonly FahrerPrioritaet[] = ['zuerst', 'normal', 'notfalls'];

export const PRIORITAET_LABEL: Record<FahrerPrioritaet, string> = {
  zuerst: 'Fährt gern',
  normal: 'Normal',
  notfalls: 'Nur wenn nötig',
};

/** Shown next to the name in the plan; `normal` shows nothing. */
export const PRIORITAET_MARKE: Record<FahrerPrioritaet, string> = {
  zuerst: 'fährt gern',
  normal: '',
  notfalls: 'nur wenn nötig',
};

/** Lower drives first. */
export function prioritaetRang(prioritaet: FahrerPrioritaet | undefined): number {
  return prioritaet === 'zuerst' ? 0 : prioritaet === 'notfalls' ? 2 : 1;
}

/** Sets the priority of one person; `normal` removes the entry. */
export function withPrioritaet(
  prioritaeten: FahrerPrioritaeten,
  personId: string,
  prioritaet: FahrerPrioritaet
): FahrerPrioritaeten {
  const next = Object.fromEntries(Object.entries(prioritaeten).filter(([id]) => id !== personId));
  if (prioritaet !== 'normal') next[personId] = prioritaet;
  return next;
}
