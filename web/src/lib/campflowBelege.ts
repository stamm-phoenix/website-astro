import type { StatusTone } from './status';
import type { CampflowBeleg, CampflowBelegeData, StaffBeleg } from './types';

/** Status filters of the list „In CampFlow“. */
export type CampflowBelegFilter = 'alle' | CampflowBeleg['status'];

/** How a receipt in CampFlow stands, in the words of the module. */
export function campflowStatusLabel(beleg: CampflowBeleg): { label: string; tone: StatusTone } {
  switch (beleg.status) {
    case 'unbooked':
      return { label: 'In CampFlow, noch nicht gebucht', tone: 'neutral' };
    case 'open':
      return beleg.paidBy
        ? { label: 'Gebucht, Erstattung offen', tone: 'warning' }
        : { label: 'Gebucht', tone: 'neutral' };
    default:
      return beleg.paidBy
        ? { label: 'Erstattet', tone: 'success' }
        : { label: 'Bezahlt', tone: 'success' };
  }
}

/** A receipt the logged-in user submitted here or paid out of pocket („Auslage durch“). */
export function isOwnCampflowBeleg(
  beleg: CampflowBeleg,
  isIch: (person: { name: string }) => boolean
): boolean {
  return beleg.submittedByMe || (!!beleg.paidBy && isIch({ name: beleg.paidBy }));
}

/** Searches number, description, who paid, Kostenstelle, Kategorie and file name, ignoring case. */
export function matchesCampflowSearch(beleg: CampflowBeleg, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [
    beleg.number ?? '',
    beleg.description,
    beleg.paidBy ?? '',
    beleg.fileName ?? '',
    ...beleg.costUnits.map((unit) => unit.name),
    ...beleg.categories.map((category) => category.name),
  ]
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** Whether a receipt is booked on the Kostenstelle and Kategorie; empty IDs match all. */
export function inCampflowSelection(
  beleg: CampflowBeleg,
  { costUnitId, categoryId }: { costUnitId: string; categoryId: string }
): boolean {
  if (costUnitId && !beleg.costUnits.some((unit) => unit.id === costUnitId)) return false;
  if (categoryId && !beleg.categories.some((category) => category.id === categoryId)) return false;
  return true;
}

/** The Kostenstellen with receipts, archived ones last, each with the Kategorien it uses. */
export function campflowKostenstellen(
  data: CampflowBelegeData
): { id: string; name: string; archived: boolean; categories: { id: string; name: string }[] }[] {
  const used = new Set(data.belege.flatMap((beleg) => beleg.costUnits.map((unit) => unit.id)));
  const usedCategories = new Set(
    data.belege.flatMap((beleg) => beleg.categories.map((category) => category.id))
  );
  return data.costUnits
    .filter((unit) => used.has(unit.id))
    .map((unit) => ({
      ...unit,
      categories: unit.categories.filter((category) => usedCategories.has(category.id)),
    }))
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, 'de'));
}

/** Unbooked receipts first (they wait for the Kasse), then the newest Belegdatum. */
export function sortCampflowBelege(belege: readonly CampflowBeleg[]): CampflowBeleg[] {
  const key = (beleg: CampflowBeleg) =>
    beleg.status === 'unbooked' ? `1${beleg.uploadedAt ?? ''}` : `0${beleg.date ?? ''}`;
  return [...belege].sort(
    (a, b) =>
      key(b).localeCompare(key(a)) ||
      (b.number ?? '').localeCompare(a.number ?? '', 'de', { numeric: true })
  );
}

/** One line of the box „Meine Belege“ on the start page. */
export interface MeinBeleg {
  key: string;
  title: string;
  /** Belegdatum `YYYY-MM-DD`, or the day of upload; `''` if unknown. */
  date: string;
  /** Amount spent, positive. */
  amountCent: number;
  label: string;
  tone: StatusTone;
}

const BELEG_STATUS_TONE: Record<StaffBeleg['status'], StatusTone> = {
  Eingereicht: 'neutral',
  Angenommen: 'success',
  Abgelehnt: 'danger',
};

/**
 * The receipts of the logged-in user, newest first: the ones submitted in the module and not yet
 * in CampFlow, with their review state, and those in CampFlow they submitted here or paid out of
 * pocket, with their booking and payment state. `campflow` may still be loading (`null`).
 */
export function meineBelege(
  belege: readonly StaffBeleg[],
  campflow: CampflowBelegeData | null,
  login: string,
  isIch: (person: { name: string }) => boolean
): MeinBeleg[] {
  const me = login.toLowerCase();
  const inCampflow = new Set(
    (campflow?.belege ?? []).flatMap((beleg) => (beleg.number ? [beleg.number] : []))
  );
  const submitted: MeinBeleg[] = belege
    .filter((beleg) => !!me && beleg.submittedBy.toLowerCase() === me)
    // A receipt kept here after its upload is listed once, with its state in CampFlow
    .filter((beleg) => !(beleg.campflow?.number && inCampflow.has(beleg.campflow.number)))
    .map((beleg) => ({
      key: `beleg-${beleg.id}`,
      title: beleg.shop || 'Beleg',
      date: beleg.date,
      amountCent: beleg.amountCent,
      label: beleg.status,
      tone: BELEG_STATUS_TONE[beleg.status],
    }));
  const booked: MeinBeleg[] = (campflow?.belege ?? [])
    .filter((beleg) => isOwnCampflowBeleg(beleg, isIch))
    .map((beleg) => ({
      key: `campflow-${beleg.id}`,
      title: beleg.description || beleg.fileName || 'Beleg',
      date: beleg.date ?? beleg.uploadedAt?.slice(0, 10) ?? '',
      amountCent: Math.abs(beleg.amountCent),
      ...campflowStatusLabel(beleg),
    }));
  return [...submitted, ...booked].sort((a, b) => b.date.localeCompare(a.date));
}
