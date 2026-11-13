import { CONFIG } from './config';
import { testPicture } from './db-preview-blog';
import { createBeleg, getBelege } from './beleg-list';
import { nextContentId } from './content-ids';
import { getDb, inTransaction } from './db';
import { validateBeleg } from './validation/beleg';
import { dateToLocalParts } from './nikolaus-config';
const PREVIEW_ACTOR = 'preview';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Invented receipts in every state, one of them a scan with its original (matched by shop). */
const PREVIEW_BELEGE: {
  shop: string;
  days: number;
  amountCent: number;
  status: 'Eingereicht' | 'Angenommen' | 'Abgelehnt';
  reviewNote: string;
  scan: boolean;
}[] = [
  {
    shop: 'Testmarkt (Testdaten)',
    days: 3,
    amountCent: 2350,
    status: 'Eingereicht',
    reviewNote: '',
    scan: true,
  },
  {
    shop: 'Baumarkt (Testdaten)',
    days: 12,
    amountCent: 8990,
    status: 'Angenommen',
    reviewNote: '',
    scan: false,
  },
  {
    shop: 'Bäckerei (Testdaten)',
    days: 20,
    amountCent: 1240,
    status: 'Abgelehnt',
    reviewNote: 'Der Betrag ist auf dem Foto nicht lesbar.',
    scan: false,
  },
];

export async function seedPreviewBelege(now: Date = new Date()): Promise<void> {
  const existing = new Set((await getBelege()).map((beleg) => beleg.shop));
  for (const beleg of PREVIEW_BELEGE) {
    if (existing.has(beleg.shop)) continue;
    const date = dateToLocalParts(new Date(now.getTime() - beleg.days * DAY_MS)).date;
    const input = validateBeleg(
      {
        shop: beleg.shop,
        date,
        amountCent: beleg.amountCent,
        paidBy: 'Lea Leiterin',
        payout: true,
        // Both exist in CampFlow, so a test transfer from a preview creates nothing there
        kostenstelle: 'Allgemein',
        kategorie: 'Material',
        note: '',
        status: beleg.status,
        reviewNote: beleg.reviewNote,
      },
      dateToLocalParts(now).date
    );
    const photo = await testPicture(1200, 1600, '#f4f1e8', '#d8d2c0');
    const original = beleg.scan ? await testPicture(1600, 1200, '#8a8070', '#d8d2c0') : undefined;
    await createBeleg(input, PREVIEW_ACTOR, { photo, original }, undefined);
  }
}

/**
 * Invented receipts already transferred to CampFlow, for the list „In CampFlow“ (matched by
 * shop). Only rows: CampFlow is never called, and the image of such a receipt comes from
 * CampFlow, so in a preview it shows that CampFlow does not know the number.
 */
const PREVIEW_UEBERTRAGEN: { shop: string; days: number; amountCent: number; number: string }[] = [
  { shop: 'Getränkemarkt (Testdaten)', days: 30, amountCent: 4580, number: 'TEST-1' },
  { shop: 'Schreibwaren (Testdaten)', days: 45, amountCent: 1299, number: 'TEST-2' },
];

export async function seedPreviewBelegeCampflow(now: Date = new Date()): Promise<void> {
  const existing = new Set(
    (await getDb().selectFrom('organisation.beleg_campflow').select('shop').execute()).map(
      (row) => row.shop
    )
  );
  for (const beleg of PREVIEW_UEBERTRAGEN) {
    if (existing.has(beleg.shop)) continue;
    const at = new Date(now.getTime() - beleg.days * DAY_MS);
    const date = dateToLocalParts(at).date;
    await inTransaction(async (trx) => {
      // An ID of its own, so no receipt of the preview ever gets it
      const id = await nextContentId(trx, 'organisation.beleg');
      await trx
        .insertInto('organisation.beleg_campflow')
        .values({
          beleg_id: id,
          state: 'Hochgeladen',
          file_name: `${date} ${beleg.shop} (Website-Beleg ${id}).jpg`,
          costunit_id: 'cun_Testdaten',
          costunit_name: 'Stammeswochenende (Testdaten)',
          category_id: 'cat_Testdaten',
          category_name: 'Verpflegung',
          shop: beleg.shop,
          beleg_date: date,
          amount_cent: beleg.amountCent,
          paid_by: 'Lea Leiterin',
          payout: true,
          aktion: 'Stammeswochenende (Testdaten)',
          note: '',
          // The preview's test account sees them also without being part of the Kasse
          submitted_by: CONFIG.staff.previewOnlyLogins[0] ?? PREVIEW_ACTOR,
          beleg_version: Buffer.alloc(8),
          campflow_number: beleg.number,
          started_by: PREVIEW_ACTOR,
          started_at: at.toISOString(),
          uploaded_at: at.toISOString(),
          beleg_deleted_at: at.toISOString(),
        })
        .execute();
    });
  }
}
