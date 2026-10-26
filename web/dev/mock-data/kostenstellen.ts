/** Sums per Kostenstelle of the mock API (Leitendenbereich → Kostenstellen); invented figures. */
import type {
  KategorieStatistik,
  KostenstelleStatistik,
  KostenstellenData,
  KostenstellenSphaere,
} from '../../src/lib/types';

const kategorie = (
  id: string | null,
  name: string,
  sphere: KostenstellenSphaere | null,
  incomeCent: number,
  expensesCent: number,
  bookings: number,
  open: { income?: number; expenses?: number } = {}
): KategorieStatistik => ({
  id,
  name,
  sphere,
  incomeCent,
  expensesCent,
  balanceCent: incomeCent + expensesCent,
  openIncomeCent: open.income ?? 0,
  openExpensesCent: open.expenses ?? 0,
  bookings,
});

function kostenstelle(
  id: string | null,
  name: string,
  color: string | null,
  archived: boolean,
  categories: KategorieStatistik[]
): KostenstelleStatistik {
  const sum = (key: 'incomeCent' | 'expensesCent' | 'openIncomeCent' | 'openExpensesCent') =>
    categories.reduce((total, category) => total + category[key], 0);
  return {
    id,
    name,
    color,
    archived,
    incomeCent: sum('incomeCent'),
    expensesCent: sum('expensesCent'),
    balanceCent: sum('incomeCent') + sum('expensesCent'),
    openIncomeCent: sum('openIncomeCent'),
    openExpensesCent: sum('openExpensesCent'),
    bookings: categories.reduce((total, category) => total + category.bookings, 0),
    categories,
  };
}

const COST_UNITS: KostenstelleStatistik[] = [
  kostenstelle('cun_mock_allgemein', 'Allgemein', '#64748b', false, [
    kategorie('cat_mock_spenden', 'Spenden', 'ideal', 125000, 0, 14),
    kategorie('cat_mock_mitglied', 'Mitgliedsbeiträge', 'ideal', 384000, -211200, 96, {
      income: 12000,
    }),
    kategorie('cat_mock_verwaltung', 'Verwaltung', 'ideal', 0, -48390, 23),
    kategorie('cat_mock_zinsen', 'Zinsen', 'assets', 1834, 0, 4),
  ]),
  kostenstelle('cun_mock_lager', 'Stammeslager 2026', '#854d0e', false, [
    kategorie('cat_mock_tn', 'Teilnehmerbeiträge', 'purpose', 742000, 0, 53, { income: 28000 }),
    kategorie('cat_mock_zuschuss', 'Zuschüsse', 'ideal', 96000, 0, 2),
    kategorie('cat_mock_verpflegung', 'Verpflegung', 'purpose', 0, -231877, 41, {
      expenses: -4312,
    }),
    kategorie('cat_mock_unterkunft', 'Unterkunft', 'purpose', 0, -310000, 3),
    kategorie('cat_mock_fahrt', 'Fahrtkosten', 'purpose', 0, -187450, 17, { expenses: -9860 }),
    kategorie('cat_mock_programm', 'Programm', 'purpose', 0, -64520, 12),
  ]),
  kostenstelle('cun_mock_pullover', 'Pullover', '#eab308', false, [
    kategorie('cat_mock_pullipreis', 'Pulloverpreis', 'business', 98000, -91350, 31, {
      income: 5600,
    }),
  ]),
  kostenstelle('cun_mock_nikolaus', 'Nikolausaktion 2026', '#b91c1c', false, [
    kategorie('cat_mock_nikolausspenden', 'Spenden', 'ideal', 0, 0, 0),
    kategorie('cat_mock_kostueme', 'Kostüme', 'ideal', 0, 0, 0),
  ]),
  kostenstelle('cun_mock_material', 'Material', '#0d9488', false, [
    kategorie('cat_mock_zelte', 'Zelte', 'ideal', 0, -145990, 6),
    kategorie('cat_mock_leihe', 'Leihgebühren', 'assets', 42000, 0, 9),
    kategorie(null, '', null, 0, -2399, 1),
  ]),
  kostenstelle('cun_mock_lager2019', 'Sommerlager 2019', '#7c3aed', true, [
    kategorie('cat_mock_tn2019', 'Teilnehmerbeiträge', 'purpose', 512000, 0, 44),
    kategorie('cat_mock_verpflegung2019', 'Verpflegung', 'purpose', 0, -198765, 37),
    kategorie('cat_mock_unterkunft2019', 'Unterkunft', 'purpose', 0, -290000, 2),
  ]),
  kostenstelle(null, 'Altpapiersammlung', null, false, [
    kategorie(null, 'Erlöse', null, 31250, 0, 5),
  ]),
];

let loadedAt: string | null = null;

/** Like `GET /api/intern/kostenstellen`: open Kostenstellen first, each group by name. */
export function kostenstellenFor(refresh: boolean): KostenstellenData {
  if (refresh || !loadedAt) loadedAt = new Date().toISOString();
  return {
    loadedAt,
    costUnits: [...COST_UNITS].sort(
      (a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, 'de')
    ),
  };
}
