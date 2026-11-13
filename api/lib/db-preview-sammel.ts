import { createHash } from 'node:crypto';
import { getDb } from './db';
import { createSammelCampaign, ensureSammelOrder, getSammelCampaign, getSammelOrder, setSammelCampaignArchived, updateSammelOrder } from './sammelbestellung-list';
import type { SammelOrderChanges } from './sammelbestellung-list-basis';
import { validateSammelCampaign } from './sammelbestellung-validation';
import type { SammelPaymentEvent, SammelPaymentRecord } from './sammelbestellung-payment-model';

/** Fixed retry keys, so a repeated seed finds the campaigns it already created. */
const PREVIEW_SAMMEL_OPEN = '00000000-0000-4000-8000-000000000156';
const PREVIEW_SAMMEL_ARCHIVED = '00000000-0000-4000-8000-000000000157';

function previewDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Invented Sammelbestellungen: an open one with orders in every status (a draft, an order with
 * an excluded article, one with an assigned CampFlow person and a created contribution) and an
 * archived one whose invitations were sent. Only fills what is missing.
 */
export async function seedPreviewSammel(now: Date = new Date()): Promise<void> {
  const day = 86_400_000;
  const at = (offset: number): string =>
    new Date(Math.floor(now.getTime() / day) * day + offset * day).toISOString();
  const kluft = 'https://www.ruesthaus.de/kluft/2891/klufthemd-fairtrade';
  const openId = await createSammelCampaign(
    validateSammelCampaign({
      title: 'Sammelbestellung Herbst (Test)',
      description: 'Erfundene Testdaten der Preview.',
      startsAt: at(-7),
      endsAt: at(21),
      catalog: [
        { name: 'Klufthemd', reference: kluft, variants: ['152', '164', 'S', 'M'] },
        { shop: 'eschwege', name: 'Juja', reference: '3020', variants: ['M', 'L'] },
        { name: 'Halstuch', reference: 'stamm-halstuch', variants: [] },
      ],
    }),
    PREVIEW_SAMMEL_OPEN
  );
  const archivedId = await createSammelCampaign(
    validateSammelCampaign({
      title: 'Sammelbestellung Frühjahr (Test)',
      description: '',
      startsAt: at(-200),
      endsAt: at(-170),
      catalog: [{ name: 'Klufthemd', reference: kluft, variants: ['152', '164'] }],
    }),
    PREVIEW_SAMMEL_ARCHIVED
  );
  const archived = await getSammelCampaign(archivedId);
  if (archived && !archived.archived)
    await setSammelCampaignArchived(archivedId, true, archived.etag);

  const shirt = { name: 'Klufthemd', reference: kluft, variant: '164', quantity: 1 };
  const scarf = { name: 'Halstuch', reference: 'stamm-halstuch', variant: '', quantity: 2 };
  const juja = {
    shop: 'eschwege' as const,
    name: 'Juja',
    reference: '3020',
    variant: 'M',
    quantity: 1,
  };
  const actor = { id: 'preview', name: 'leitung@example.test' };
  const orders: {
    campaign: string;
    email: string;
    changes?: SammelOrderChanges;
    payment?: boolean;
  }[] = [
    // Requested a link but has not ordered yet
    { campaign: openId, email: 'familie.entwurf@example.test' },
    {
      campaign: openId,
      email: 'familie.mueller@example.test',
      changes: { name: 'Familie Müller', items: [shirt, scarf], notes: 'Bitte zusammen abholen.' },
    },
    {
      campaign: openId,
      email: 'familie.schmidt@example.test',
      changes: {
        name: 'Familie Schmidt',
        items: [{ ...juja, excluded: { reason: 'Größe M ist ausverkauft.' } }, shirt],
        status: 'Bestellt',
        totalCents: 4590,
      },
    },
    {
      campaign: openId,
      email: 'familie.weber@example.test',
      changes: { name: 'Familie Weber', items: [shirt], status: 'Bestellt', totalCents: 3490 },
      payment: true,
    },
    {
      campaign: openId,
      email: 'familie.storniert@example.test',
      changes: { name: 'Familie Storniert', items: [scarf], status: 'Storniert' },
    },
    {
      campaign: archivedId,
      email: 'familie.mueller@example.test',
      changes: {
        name: 'Familie Müller',
        items: [{ ...shirt, variant: '152' }],
        status: 'Eingetroffen',
        totalCents: 3490,
        paid: true,
        delivered: true,
      },
    },
  ];
  for (const entry of orders) {
    let order = await ensureSammelOrder(entry.campaign, entry.email);
    if (!entry.changes) continue;
    if (!order.submitted) {
      await updateSammelOrder(
        order.id,
        { submitted: true, linkSentAt: at(-3), ...entry.changes },
        order.etag
      );
      order = (await getSammelOrder(order.id))!;
    }
    // A run that stopped between the order and its payment steps adds the missing steps;
    // a contribution or another person assigned in the preview stays as it is
    if (
      !entry.payment ||
      order.paymentRecord?.operation ||
      (order.paymentRecord && order.paymentRecord.assignment.person.id !== 'per_PreviewWeber')
    )
      continue;
    const snapshot = {
      personId: 'per_PreviewWeber',
      amount: order.totalCents!,
      description: `Sammelbestellung Herbst (Test) · Bestellung ${order.id}`,
      orderId: order.id,
      campaignId: entry.campaign,
      revision: previewDigest({ items: order.items, name: order.name, email: order.email }),
      attachedExpense: {
        costunitName: 'Sammelbestellung Herbst (Test)',
        categoryName: 'Bestellungen',
      },
    };
    const record: SammelPaymentRecord = {
      version: 1,
      assignment: {
        person: {
          id: 'per_PreviewWeber',
          name: 'Wiebke Weber',
          emails: [entry.email],
          matchesEmail: true,
        },
        reason: '',
        confirmedBy: actor,
        confirmedAt: at(-2),
      },
      operation: {
        key: '00000000-0000-4000-8000-0000000001aa',
        hash: previewDigest(snapshot),
        snapshot,
        state: 'created',
        startedAt: at(-1),
        attemptedAt: at(-1),
        contribution: { id: 'fee_PreviewWeber', reference: 'GC-TEST-0001' },
        errorCategory: null,
      },
      dispatch: null,
      settlement: null,
    };
    const steps: [SammelPaymentEvent['action'], string][] = [
      ['assigned', ''],
      ['adopted', 'Erfundener Testbeitrag der Preview, nicht in CampFlow.'],
    ];
    for (const [action, evidence] of steps) {
      if (action === 'assigned' && order.paymentRecord) continue;
      await updateSammelOrder(
        order.id,
        {
          payment: {
            record: action === 'assigned' ? { ...record, operation: null } : record,
            event: {
              at: at(-1),
              actor,
              action,
              operationKey: action === 'assigned' ? null : record.operation!.key,
              evidence,
            },
          },
        },
        order.etag
      );
      order = (await getSammelOrder(order.id))!;
    }
  }

  const db = getDb();
  const archivedNumber = Number(archivedId);
  const invited = await db
    .selectFrom('sammel.invitation')
    .select('address')
    .where('campaign_id', '=', archivedNumber)
    .executeTakeFirst();
  if (!invited)
    await db
      .insertInto('sammel.invitation')
      .values(
        [
          'familie.mueller@example.test',
          'familie.weber@example.test',
          'eltern.test@example.test',
        ].map((address) => ({ campaign_id: archivedNumber, address, status: 'sent' as const }))
      )
      .execute();
  const quota = await db
    .selectFrom('sammel.link_quota')
    .select('campaign_id')
    .where('campaign_id', '=', Number(openId))
    .executeTakeFirst();
  if (!quota)
    await db
      .insertInto('sammel.link_quota')
      .values({
        campaign_id: Number(openId),
        hour_window: Math.floor(now.getTime() / 3_600_000),
        hour_count: 1,
        day_window: Math.floor(now.getTime() / day),
        day_count: 5,
      })
      .execute();
}
