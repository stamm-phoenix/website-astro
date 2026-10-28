import { formatIsoDate } from './belege';
import { matchingKostenstelle, SPARBUCH } from './belegForm';
import { findKostenstelle, sameName } from './belegZuordnung';
import type { StatusTone } from './status';
import type { CampflowBeleg, CampflowBelegeData, StaffBeleg } from './types';

/** Where a receipt lives: submitted here and not yet transferred, or in CampFlow. */
export type BelegQuelle = 'website' | 'campflow';

/** Where a receipt stands, from submitting it here to being paid in CampFlow. */
export type BelegStand =
  'eingereicht' | 'angenommen' | 'abgelehnt' | 'ungebucht' | 'gebucht' | 'bezahlt';

export const BELEG_QUELLEN: { value: BelegQuelle; label: string }[] = [
  { value: 'website', label: 'Website' },
  { value: 'campflow', label: 'CampFlow' },
];

export const BELEG_STAENDE: { value: BelegStand; label: string }[] = [
  { value: 'eingereicht', label: 'Eingereicht' },
  { value: 'angenommen', label: 'Angenommen' },
  { value: 'abgelehnt', label: 'Abgelehnt' },
  { value: 'ungebucht', label: 'Noch nicht gebucht' },
  { value: 'gebucht', label: 'Gebucht' },
  { value: 'bezahlt', label: 'Bezahlt' },
];

/** One receipt of the list, whichever source it comes from. */
export interface BelegEintrag {
  key: string;
  quelle: BelegQuelle;
  stand: BelegStand;
  title: string;
  /** Belegdatum `YYYY-MM-DD`, or the day of upload; `''` if unknown. */
  date: string;
  /** The amount, positive; `income` tells whether money came in. */
  amountCent: number;
  income: boolean;
  /** Without an amount yet: a receipt in CampFlow nobody booked. */
  hasAmount: boolean;
  label: string;
  tone: StatusTone;
  /** „Bezahlt von“ here, „Auslage durch“ in CampFlow. */
  paidBy: string | null;
  /** Aktion, or Kostenstelle and Kategorie. */
  where: string;
  costUnitIds: string[];
  categoryIds: string[];
  /** Small image for the list and the gallery; null without a photo. */
  previewUrl: string | null;
  /** Submitted here by the user, or paid out of pocket by them. */
  own: boolean;
  /** When a receipt in CampFlow was paid or paid back, `YYYY-MM-DD`; null if not or unknown. */
  settledAt: string | null;
  /** Extra tags, e.g. „Auszahlung“ or „Foto prüfen“. */
  tags: { label: string; tone: StatusTone }[];
  /** Why the Kasse rejected it, for a rejected receipt. */
  hinweis: string | null;
  beleg?: StaffBeleg;
  campflow?: CampflowBeleg;
}

/** How a receipt in CampFlow stands, in the words of the module. */
export function campflowStand(beleg: CampflowBeleg): {
  stand: BelegStand;
  label: string;
  tone: StatusTone;
} {
  switch (beleg.status) {
    case 'unbooked':
      return { stand: 'ungebucht', label: 'Noch nicht gebucht', tone: 'neutral' };
    case 'open':
      return beleg.paidBy
        ? { stand: 'gebucht', label: 'Gebucht, Erstattung offen', tone: 'warning' }
        : { stand: 'gebucht', label: 'Gebucht', tone: 'neutral' };
    default: {
      const on = beleg.settledAt ? ` am ${formatIsoDate(beleg.settledAt)}` : '';
      return {
        stand: 'bezahlt',
        label: `${beleg.paidBy ? 'Erstattet' : 'Bezahlt'}${on}`,
        tone: 'success',
      };
    }
  }
}

const WEBSITE_STAND: Record<StaffBeleg['status'], { stand: BelegStand; tone: StatusTone }> = {
  Eingereicht: { stand: 'eingereicht', tone: 'neutral' },
  Angenommen: { stand: 'angenommen', tone: 'success' },
  Abgelehnt: { stand: 'abgelehnt', tone: 'danger' },
};

/** The preview of a receipt in CampFlow, by its number or, not booked yet, its ID. */
export function campflowPreviewUrl(beleg: CampflowBeleg): string {
  return `/api/intern/abrechnung/belege/${encodeURIComponent(beleg.number ?? beleg.id)}/vorschau`;
}

/** What identifies a receipt in CampFlow for its images: the number, or the ID before it. */
export function campflowBildKey(beleg: CampflowBeleg): string {
  return beleg.number ?? beleg.id;
}

/**
 * A receipt is someone's only if they paid it out of pocket: whoever submitted it, and never one
 * the Stamm paid or a transfer to the savings book.
 */
function isOwnAuslage(
  paidBy: string | null,
  isIch: (person: { name: string }) => boolean
): boolean {
  return !!paidBy?.trim() && paidBy.trim() !== SPARBUCH && isIch({ name: paidBy });
}

/**
 * All receipts in one list: the ones submitted here and the ones in CampFlow. A receipt kept here
 * after its upload is listed once, as the one here, which still needs the Kasse.
 */
export function belegEintraege(
  belege: readonly StaffBeleg[],
  campflow: CampflowBelegeData | null,
  { isIch }: { isIch: (person: { name: string }) => boolean }
): BelegEintrag[] {
  const kostenstellen = campflow?.costUnits ?? [];
  const keptHere = new Set(belege.flatMap((b) => (b.campflow?.number ? [b.campflow.number] : [])));

  const website = belege.map((beleg): BelegEintrag => {
    // Also an archived Kostenstelle, so its filter finds the receipts still here; older receipts
    // only name an Aktion
    const unit = beleg.kostenstelle.trim()
      ? findKostenstelle(kostenstellen, beleg.kostenstelle)
      : matchingKostenstelle(beleg.aktion, kostenstellen, { archived: true });
    const category = unit?.categories.find((c) => sameName(c.name, beleg.kategorie));
    const uploaded = beleg.campflow?.state === 'Hochgeladen' ? beleg.campflow : null;
    const tags: BelegEintrag['tags'] = [];
    if (uploaded?.number)
      tags.push({ label: `In CampFlow als ${uploaded.number}`, tone: 'warning' });
    if (beleg.payout) {
      tags.push({
        label: beleg.paidBy === SPARBUCH ? 'Umbuchung Sparbuch' : 'Auszahlung',
        tone: 'neutral',
      });
    }
    if (beleg.aiCheck && !beleg.aiCheck.ok) tags.push({ label: 'Foto prüfen', tone: 'warning' });
    if (beleg.aiCheck?.restrictedItems.length) {
      tags.push({ label: 'Evtl. Alkohol/Tabak', tone: 'danger' });
    }
    return {
      key: `website-${beleg.id}`,
      quelle: 'website',
      ...WEBSITE_STAND[beleg.status],
      label: beleg.status,
      title: beleg.shop || 'Ohne Geschäft',
      date: beleg.date,
      amountCent: beleg.amountCent,
      income: beleg.art === 'Einnahme',
      hasAmount: true,
      paidBy: beleg.paidBy || null,
      where: beleg.kostenstelle.trim()
        ? [beleg.kostenstelle, beleg.kategorie].filter((part) => part.trim()).join(' · ')
        : beleg.aktion,
      costUnitIds: [uploaded?.costUnitId ?? unit?.id].filter((id): id is string => !!id),
      categoryIds: [uploaded?.categoryId ?? category?.id].filter((id): id is string => !!id),
      previewUrl: beleg.hasImage
        ? `/api/intern/pflege/belege/${beleg.id}/foto?v=${encodeURIComponent(beleg.etag)}&thumb=1`
        : null,
      own: beleg.mine === true || (beleg.payout && isOwnAuslage(beleg.paidBy, isIch)),
      settledAt: null,
      tags,
      hinweis: beleg.status === 'Abgelehnt' && beleg.reviewNote ? beleg.reviewNote : null,
      beleg,
    };
  });

  const inCampflow = (campflow?.belege ?? [])
    .filter((beleg) => !(beleg.number && keptHere.has(beleg.number)))
    .map((beleg): BelegEintrag => {
      const where = [
        beleg.costUnits.map((unit) => unit.name).join(', '),
        beleg.categories.map((category) => category.name).join(', '),
      ];
      return {
        key: `campflow-${beleg.id}`,
        quelle: 'campflow',
        ...campflowStand(beleg),
        title: beleg.description || beleg.fileName || 'Ohne Beschreibung',
        date: beleg.date ?? beleg.uploadedAt?.slice(0, 10) ?? '',
        amountCent: Math.abs(beleg.amountCent),
        income: beleg.amountCent > 0,
        hasAmount: beleg.status !== 'unbooked',
        paidBy: beleg.paidBy,
        where: where.filter(Boolean).join(' · '),
        costUnitIds: beleg.costUnits.map((unit) => unit.id),
        categoryIds: beleg.categories.map((category) => category.id),
        previewUrl: campflowPreviewUrl(beleg),
        own: beleg.mine || isOwnAuslage(beleg.paidBy, isIch),
        settledAt: beleg.status === 'settled' ? beleg.settledAt : null,
        tags: beleg.number ? [{ label: `Nr. ${beleg.number}`, tone: 'neutral' }] : [],
        hinweis: null,
        campflow: beleg,
      };
    });

  return sortEintraege([...website, ...inCampflow]);
}

/** Receipts that wait for someone come first, the rest by date, newest first. */
const WAITING: Partial<Record<BelegStand, number>> = {
  eingereicht: 0,
  angenommen: 1,
  ungebucht: 2,
};

export function sortEintraege(eintraege: BelegEintrag[]): BelegEintrag[] {
  return [...eintraege].sort(
    (a, b) =>
      (WAITING[a.stand] ?? 3) - (WAITING[b.stand] ?? 3) ||
      b.date.localeCompare(a.date) ||
      a.key.localeCompare(b.key)
  );
}

export interface BelegFilter {
  quelle: BelegQuelle | '';
  stand: BelegStand | '';
  costUnitId: string;
  categoryId: string;
  search: string;
  onlyMine: boolean;
}

/** Whether an entry passes all filters except the source, which the tabs count. */
export function matchesBelegFilter(
  eintrag: BelegEintrag,
  filter: Omit<BelegFilter, 'quelle'>
): boolean {
  if (filter.stand && eintrag.stand !== filter.stand) return false;
  if (filter.costUnitId && !eintrag.costUnitIds.includes(filter.costUnitId)) return false;
  if (filter.categoryId && !eintrag.categoryIds.includes(filter.categoryId)) return false;
  if (filter.onlyMine && !eintrag.own) return false;
  const words = filter.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [
    eintrag.title,
    eintrag.where,
    eintrag.paidBy ?? '',
    eintrag.beleg?.note ?? '',
    eintrag.campflow?.number ?? eintrag.beleg?.campflow?.number ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** The Kostenstellen that have receipts, archived ones last, with the Kategorien they use. */
export function eintragKostenstellen(
  eintraege: readonly BelegEintrag[],
  campflow: CampflowBelegeData | null
): { id: string; name: string; archived: boolean; categories: { id: string; name: string }[] }[] {
  const units = new Set(eintraege.flatMap((e) => e.costUnitIds));
  const categories = new Set(eintraege.flatMap((e) => e.categoryIds));
  return (campflow?.costUnits ?? [])
    .filter((unit) => units.has(unit.id))
    .map((unit) => ({ ...unit, categories: unit.categories.filter((c) => categories.has(c.id)) }))
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, 'de'));
}
