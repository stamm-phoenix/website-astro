/** Beiträge of the mock API (Leitendenbereich → Beiträge); all names are invented. */
import type { Beitrag, BeitraegeData, BeitragSammlung, BeitragStatus } from '../../src/lib/types';

const NAMEN = [
  'Anna Berger',
  'Ben Huber',
  'Clara Maier',
  'David Schmid',
  'Emma Wagner',
  'Finn Bauer',
  'Greta Fischer',
  'Hannes Gruber',
  'Ida Wimmer',
  'Jonas Lechner',
  'Kira Moser',
  'Leon Hofer',
  'Mia Brandl',
  'Noah Steiner',
  'Paula Winkler',
  'Quirin Lang',
  'Romy Eder',
  'Simon Pichler',
  'Tara Kern',
  'Ulli Reiter',
  'Vroni Auer',
  'Willi Seidl',
];

interface SammlungPlan {
  id: string;
  name: string;
  type: string;
  costUnit: { id: string; name: string };
  description: string;
  cent: number;
  /** Status per Beitrag, in order of the names. */
  status: BeitragStatus[];
  date: string;
}

const PLAN: SammlungPlan[] = [
  {
    id: 'bat_Sola26',
    name: 'Sommerlager 2026 Oberjoch',
    type: 'event',
    costUnit: { id: 'cun_Sola26', name: 'Sommerlager 2026 Oberjoch' },
    description: 'Teilnehmendenbeitrag',
    cent: 18000,
    status: [
      'paid',
      'paid',
      'unpaid',
      'paid',
      'partial',
      'paid',
      'refund',
      'paid',
      'cancelled',
      'paid',
      'unpaid',
      'paid',
    ],
    date: '2026-05-04',
  },
  {
    id: 'bat_WoeHerbst',
    name: 'Wölflings-Herbstwochenende',
    type: 'event',
    costUnit: { id: 'cun_WoeHerbst', name: 'Wölflings-Herbstwochenende' },
    description: 'Teilnehmendenbeitrag',
    cent: 3500,
    status: ['paid', 'unpaid', 'unpaid', 'paid', 'paid', 'unpaid'],
    date: '2026-09-20',
  },
  {
    id: 'bat_Hike',
    name: 'Hike 2026',
    type: 'event',
    costUnit: { id: 'cun_Hike', name: 'Hike 2026' },
    description: 'Teilnehmendenbeitrag',
    cent: 2500,
    status: ['paid', 'paid', 'paid', 'paid'],
    date: '2026-04-11',
  },
  {
    id: 'bat_Mitglied26',
    name: 'Mitgliedsbeitrag 2026',
    type: 'annuity',
    costUnit: { id: 'cun_Allgemein', name: 'Allgemein' },
    description: 'Mitgliedsbeitrag 2026',
    cent: 6000,
    status: ['paid', 'paid', 'paid', 'refund', 'paid', 'paid', 'paid', 'paid', 'unpaid', 'paid'],
    date: '2026-01-15',
  },
];

function beitrag(plan: SammlungPlan, status: BeitragStatus, index: number): Beitrag {
  const due = status === 'cancelled' ? 0 : plan.cent;
  const paid =
    status === 'paid'
      ? due
      : status === 'partial'
        ? Math.round(due / 2)
        : status === 'refund'
          ? due + 2000
          : 0;
  // Paid within a few days after the Beitrag was created.
  const paidDay = String(Math.min(28, Number(plan.date.slice(8)) + 1 + (index % 9))).padStart(
    2,
    '0'
  );
  return {
    id: `fee_${plan.id}_${index}`,
    reference: `${plan.id.slice(4, 6).toUpperCase()}${String(10000 + index * 7919).slice(-5)}`,
    description: plan.description,
    batchId: plan.id,
    costUnit: plan.costUnit,
    category: plan.type === 'annuity' ? 'Mitgliedsbeiträge' : 'Teilnehmerbeiträge',
    payer: NAMEN[(index * 5 + plan.cent) % NAMEN.length],
    paymentMethod: 'bank_transfer',
    date: plan.date,
    amountCent: plan.cent,
    dueCent: due,
    paidCent: paid,
    openCent: due - paid,
    status,
    paidAt: paid > 0 ? `${plan.date.slice(0, 8)}${paidDay}` : null,
  };
}

const fees = PLAN.flatMap((plan) => plan.status.map((status, i) => beitrag(plan, status, i)));

const batches: BeitragSammlung[] = PLAN.map((plan) => {
  const own = fees.filter((fee) => fee.batchId === plan.id);
  return {
    id: plan.id,
    name: plan.name,
    type: plan.type,
    feeCount: own.length,
    settledCount: own.filter((fee) => fee.status === 'paid' || fee.status === 'cancelled').length,
    totalCent: own.reduce((sum, fee) => sum + fee.amountCent, 0),
    openCent: own.reduce((sum, fee) => sum + Math.max(0, fee.openCent), 0),
    refundCent: own.reduce((sum, fee) => sum + Math.max(0, -fee.openCent), 0),
  };
});

let loadedAt = '';

/** `loadedAt` moves forward when the page has CampFlow read again. */
export function beitraegeFor(refresh: boolean): BeitraegeData {
  if (refresh || !loadedAt) loadedAt = new Date().toISOString();
  return { loadedAt, batches, fees };
}
