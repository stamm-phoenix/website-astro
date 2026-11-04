import { getDb } from './db';
import { usageMonth } from './staff-usage-model';
/** Invented totals; retries preserve existing rows and live preview visits. */
export async function seedPreviewStaffUsage(): Promise<void> {
  const month = usageMonth();
  for (const [module, visits] of Object.entries({
    '/leitendenbereich/fotos': 60,
    '/leitendenbereich/aufgaben': 45,
    '/leitendenbereich/belege': 30,
    '/leitendenbereich/protokolle': 25,
  })) {
    const row = await getDb()
      .selectFrom('organisation.staff_usage')
      .select('module')
      .where('month', '=', month)
      .where('module', '=', module)
      .executeTakeFirst();
    if (!row)
      await getDb()
        .insertInto('organisation.staff_usage')
        .values({ month, module, visits })
        .execute();
  }
}
