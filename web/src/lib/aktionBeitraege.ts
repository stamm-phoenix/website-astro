import { statusLabel } from './beitraege';
import type { PersonColumn } from './campflowFields';
import { formatEuro } from './format';
import type { AktionBeitrag, AktionBeitraegeData, CampflowPerson } from './types';

/** Sorting the column „Beitrag“ ascending puts what still needs attention first. */
const STATUS_RANK: Record<AktionBeitrag['status'], number> = {
  unpaid: 0,
  partial: 1,
  refund: 2,
  paid: 3,
  cancelled: 4,
};

/** The Beiträge of a person; `undefined` while they load or when CampFlow has none yet. */
export function beitraegeOf(
  data: AktionBeitraegeData | null,
  person: CampflowPerson
): AktionBeitrag[] | undefined {
  return data && Object.hasOwn(data.persons, person.id) ? data.persons[person.id] : undefined;
}

/** What is due, or the cancelled amount for a cancelled Beitrag. */
export function beitragBetrag(fee: AktionBeitrag): string {
  return formatEuro(fee.status === 'cancelled' ? fee.amountCent : fee.dueCent);
}

/** One line per Beitrag, e.g. `90,00 € · Bezahlt`. */
export function beitragText(fees: AktionBeitrag[] | undefined): string {
  if (!fees) return '';
  if (fees.length === 0) return 'Kein Beitrag';
  return fees.map((fee) => `${beitragBetrag(fee)} · ${statusLabel(fee).label}`).join('; ');
}

/** The columns „Beitrag“ and „Verwendungszweck“ of the participant table. */
export function beitragColumns(data: AktionBeitraegeData | null): PersonColumn[] {
  return [
    {
      key: 'beitrag',
      label: 'Beitrag',
      text: (p) => beitragText(beitraegeOf(data, p)),
      sortValue: (p) => {
        const fees = beitraegeOf(data, p);
        if (!fees) return 99;
        // People without a Beitrag after those who paid, those not loaded at the very end
        return Math.min(5, ...fees.map((fee) => STATUS_RANK[fee.status]));
      },
    },
    {
      key: 'verwendungszweck',
      label: 'Verwendungszweck',
      text: (p) => (beitraegeOf(data, p) ?? []).map((fee) => fee.reference).join(', '),
      sortValue: (p) => (beitraegeOf(data, p) ?? []).map((fee) => fee.reference).join(', '),
    },
  ];
}

export interface BeitragZahlen {
  /** People with a Beitrag that is not paid in full. */
  offen: number;
  offenCent: number;
  /** People who paid too much. */
  erstatten: number;
}

/** Open Beiträge of the given people, cancelled registrations included: they can still owe one. */
export function beitragZahlen(
  data: AktionBeitraegeData,
  persons: readonly CampflowPerson[]
): BeitragZahlen {
  const zahlen: BeitragZahlen = { offen: 0, offenCent: 0, erstatten: 0 };
  for (const person of persons) {
    const fees = beitraegeOf(data, person) ?? [];
    const open = fees.filter((fee) => fee.status === 'unpaid' || fee.status === 'partial');
    if (open.length > 0) zahlen.offen++;
    zahlen.offenCent += open.reduce((sum, fee) => sum + fee.openCent, 0);
    if (fees.some((fee) => fee.status === 'refund')) zahlen.erstatten++;
  }
  return zahlen;
}

/** Whether CampFlow knew all these people when the Beiträge were read. */
export function kenntAlle(data: AktionBeitraegeData, persons: readonly CampflowPerson[]): boolean {
  return persons.every((person) => Object.hasOwn(data.persons, person.id));
}
