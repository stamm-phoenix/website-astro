import { createHash, randomUUID } from 'node:crypto';
import { campflowGetAll } from './campflow';
import type { CampflowPerson } from './campflow';
import { createCampflowFee, CampflowFeeUncertainError } from './campflow-fees';
import { EnvironmentVariable, getEnvironment } from './environment';
import { getSharePointListColumns, getGraphStatus } from './sharepoint-data-access';
import { getSammelOrder, updateSammelOrder, publicSammelOrder } from './sammelbestellung-list';
import type { OrderRow } from './sammelbestellung-list';
import type { SammelAktion, SammelStatus } from './sammelbestellung-model';
import type { ClientPrincipal } from './staff-auth';
import { ValidationError } from './pflege-validation';
import { email } from './sammelbestellung-validation';
import type {
  SammelBillingPerson,
  SammelBillingSnapshot,
  SammelContribution,
  SammelPaymentActor,
  SammelPaymentEvent,
  SammelPaymentRecord,
  SammelPaymentView,
  SammelPaymentPreview,
} from './sammelbestellung-payment-model';

export class SammelPaymentError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409
  ) {
    super(message);
    this.name = 'SammelPaymentError';
  }
}

export function sammelFeeCreationEnabled(): boolean {
  try {
    return getEnvironment(EnvironmentVariable.SAMMELBESTELLUNG_CAMPFLOW_CREATE_ENABLED) === 'true';
  } catch {
    return false;
  }
}

function actor(principal: ClientPrincipal): SammelPaymentActor {
  return { id: principal.userId, name: principal.userDetails };
}

/** Check storage settings before reserving anything or sending a financial request. */
export async function requireSammelPaymentStorage(): Promise<void> {
  const columns = await getSharePointListColumns(
    getEnvironment(EnvironmentVariable.SHAREPOINT_SAMMELBESTELLUNGEN_ORDERS_LIST_ID)
  );
  const find = (name: string): Record<string, unknown> | undefined =>
    columns.find(
      (value): value is Record<string, unknown> =>
        !!value && typeof value === 'object' && (value as Record<string, unknown>).name === name
    ) as Record<string, unknown> | undefined;
  for (const name of ['CampflowZahlung', 'CampflowZahlungsprotokoll']) {
    const column = find(name);
    const text = column?.text as Record<string, unknown> | undefined;
    if (
      !text ||
      text.allowMultipleLines !== true ||
      text.textType !== 'plain' ||
      text.appendChangesToExistingText !== false ||
      column?.readOnly === true
    )
      throw new SammelPaymentError(
        'PAYMENT_STORAGE_REQUIRED',
        `Die SharePoint-Spalte ${name} muss als mehrzeiliger Klartext ohne Anfügen eingerichtet sein.`,
        503
      );
  }
  const unique = find('CampflowBeitragId');
  const uniqueText = unique?.text as Record<string, unknown> | undefined;
  if (
    !uniqueText ||
    uniqueText.allowMultipleLines === true ||
    unique?.enforceUniqueValues !== true ||
    unique?.readOnly === true ||
    unique?.required === true
  )
    throw new SammelPaymentError(
      'PAYMENT_STORAGE_REQUIRED',
      'Die optionale SharePoint-Textspalte CampflowBeitragId muss eindeutige Werte erzwingen.',
      503
    );
}

/** Returns only current member identities and relevant contacts, never complete person records. */
export async function sammelBillingPersons(order: OrderRow): Promise<SammelBillingPerson[]> {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
  const persons = await campflowGetAll<CampflowPerson>('/lists/member/persons');
  const candidates = new Map<string, SammelBillingPerson>();
  for (const person of persons) {
    if (!/^per_[A-Za-z0-9]{1,240}$/.test(person.id)) continue;
    if (typeof person.leave_date === 'string' && person.leave_date && person.leave_date <= today)
      continue;
    if (typeof person.join_date === 'string' && person.join_date > today) continue;
    const name =
      person.name && typeof person.name === 'object'
        ? (person.name as Record<string, unknown>)
        : {};
    const displayName =
      [name.first_name, name.last_name]
        .filter((part) => typeof part === 'string')
        .join(' ')
        .trim()
        .slice(0, 200) || person.id;
    const emails = new Set<string>();
    for (const value of [
      person.primary_email,
      ...(Array.isArray(person.cc_emails) ? person.cc_emails : []),
    ]) {
      try {
        emails.add(email(value));
      } catch {
        /* Missing/invalid contact fields are not identity evidence. */
      }
    }
    candidates.set(person.id, {
      id: person.id,
      name: displayName,
      emails: [...emails].slice(0, 20),
      matchesEmail: emails.has(order.email),
    });
  }
  if (candidates.size > 500)
    throw new ValidationError({
      form: 'Mehr als 500 Mitglieder. Bitte die Personenzuordnung mit dem Team abstimmen.',
    });
  return [...candidates.values()].sort(
    (a, b) => Number(b.matchesEmail) - Number(a.matchesEmail) || a.name.localeCompare(b.name, 'de')
  );
}

export function sammelPaymentView(order: OrderRow): SammelPaymentView {
  return {
    order: publicSammelOrder(order),
    record: order.paymentRecord,
    events: order.paymentEvents,
    creationEnabled: sammelFeeCreationEnabled(),
  };
}

/** Appends audit history atomically with state. Full history blocks new changes instead of losing evidence. */
export function sammelPaymentValues(
  order: OrderRow,
  record: SammelPaymentRecord,
  action: SammelPaymentEvent['action'],
  principal: ClientPrincipal,
  evidence = ''
): Record<string, unknown> {
  const events: SammelPaymentEvent[] = [
    ...order.paymentEvents,
    {
      at: new Date().toISOString(),
      actor: actor(principal),
      action,
      operationKey: record.operation?.key ?? null,
      evidence,
    },
  ];
  if (events.length > 100)
    throw new SammelPaymentError(
      'PAYMENT_AUDIT_FULL',
      'Das Zahlungsprotokoll ist voll. Bitte vor weiteren Änderungen gesichert archivieren.',
      503
    );
  const state = JSON.stringify(record);
  const history = JSON.stringify(events);
  if (state.length > 60_000 || history.length > 60_000)
    throw new SammelPaymentError(
      'PAYMENT_AUDIT_FULL',
      'Die Zahlungsdaten sind zu groß. Bitte das Protokoll gesichert archivieren.',
      503
    );
  return {
    CampflowZahlung: state,
    CampflowZahlungsprotokoll: history,
    ...(record.operation?.contribution
      ? { CampflowBeitragId: record.operation.contribution.id }
      : {}),
  };
}

export async function assignSammelBillingPerson(
  order: OrderRow,
  campaign: SammelAktion,
  personId: string,
  reason: string,
  principal: ClientPrincipal
): Promise<void> {
  if (!order.submitted || order.status === 'Storniert' || campaign.archived)
    throw new SammelPaymentError(
      'ORDER_NOT_ELIGIBLE',
      'Nur eingereichte, aktuelle Bestellungen können zugeordnet werden.'
    );
  if (order.paymentRecord?.operation)
    throw new SammelPaymentError(
      'CONTRIBUTION_LOCKED',
      'Die Person kann nach Beginn der Beitragserstellung nicht geändert werden.'
    );
  const person = (await sammelBillingPersons(order)).find((person) => person.id === personId);
  if (!person)
    throw new ValidationError({
      personId: 'Diese Person ist kein aktuelles Mitglied. Bitte neu auswählen.',
    });
  if (!person.matchesEmail && !reason)
    throw new ValidationError({ reason: 'Bitte die abweichende Kontaktadresse begründen.' });
  const record: SammelPaymentRecord = {
    version: 1,
    assignment: {
      person,
      reason,
      confirmedBy: actor(principal),
      confirmedAt: new Date().toISOString(),
    },
    operation: null,
    dispatch: null,
    settlement: null,
  };
  await updateSammelOrder(
    order.id,
    sammelPaymentValues(order, record, 'assigned', principal, reason),
    order.etag
  );
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function sammelBillingPreview(
  order: OrderRow,
  campaign: SammelAktion,
  allowPaid = false
): SammelPaymentPreview {
  const assignment = order.paymentRecord?.assignment;
  if (!assignment)
    throw new SammelPaymentError(
      'PERSON_SELECTION_REQUIRED',
      'Bitte zuerst die CampFlow-Person bestätigen.'
    );
  if (
    !order.submitted ||
    !['Bestellt', 'Eingetroffen'].includes(order.status) ||
    campaign.archived ||
    (!allowPaid && order.paid)
  )
    throw new SammelPaymentError(
      'ORDER_NOT_ELIGIBLE',
      'Für einen neuen Beitrag muss die Bestellung bestellt oder eingetroffen, unbezahlt und nicht archiviert sein.'
    );
  if (
    !Number.isSafeInteger(order.totalCents) ||
    !order.totalCents ||
    order.totalCents < 0 ||
    order.totalCents > 10_000_000
  )
    throw new ValidationError({
      totalCents: 'Bitte zuerst einen positiven endgültigen Gesamtbetrag festlegen.',
    });
  const title = campaign.title.trim().slice(0, 130);
  const description = `${/^Sammelbestellung\b/i.test(title) ? title : `Sammelbestellung ${title}`} · Bestellung ${order.id}`;
  if (description.length > 200)
    throw new ValidationError({ form: 'Die Beitragsbeschreibung ist zu lang.' });
  const snapshot: SammelBillingSnapshot = {
    personId: assignment.person.id,
    amount: order.totalCents,
    description,
    orderId: order.id,
    campaignId: campaign.id,
    revision: digest({ items: order.items, name: order.name, email: order.email }),
  };
  return { etag: order.etag, snapshot, hash: digest(snapshot), personName: assignment.person.name };
}

/** Writes a provider result against the latest order ETag; retries only local persistence. */
async function recordContribution(
  orderId: string,
  key: string,
  contribution: SammelContribution,
  principal: ClientPrincipal
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await getSammelOrder(orderId);
    const record = current?.paymentRecord;
    if (!current || !record?.operation || record.operation.key !== key)
      throw new Error('Payment operation changed');
    if (record.operation.state === 'created') {
      if (
        record.operation.contribution?.id === contribution.id &&
        record.operation.contribution.reference === contribution.reference
      )
        return;
      throw new Error('A different contribution was adopted');
    }
    record.operation.state = 'created';
    record.operation.contribution = contribution;
    record.operation.errorCategory = null;
    try {
      await updateSammelOrder(
        current.id,
        sammelPaymentValues(current, record, 'created', principal),
        current.etag
      );
      return;
    } catch (error: unknown) {
      if (getGraphStatus(error) !== 412 || attempt === 2) throw error;
    }
  }
}

/** Reserve before POST. Any ambiguous reservation/result blocks a second external attempt. */
export async function createSammelContribution(
  order: OrderRow,
  campaign: SammelAktion,
  hash: string,
  principal: ClientPrincipal
): Promise<void> {
  if (order.paymentRecord?.operation?.state === 'created') return;
  if (order.paymentRecord?.operation && order.paymentRecord.operation.state !== 'prepared')
    throw new SammelPaymentError(
      'CONTRIBUTION_UNCERTAIN',
      'Der Beitrag wurde bereits versucht. Bitte das Ergebnis in CampFlow prüfen und den vorhandenen Beitrag zuordnen.'
    );
  if (!sammelFeeCreationEnabled())
    throw new SammelPaymentError(
      'CONTRIBUTION_DISABLED',
      'Die Beitragserstellung ist noch nicht freigeschaltet. Vorhandene Beiträge können manuell zugeordnet werden.',
      503
    );
  // Read credentials before reserving so a missing token cannot create an ambiguous operation.
  try {
    getEnvironment(EnvironmentVariable.CAMPFLOW_API_TOKEN);
  } catch {
    throw new SammelPaymentError(
      'CAMPFLOW_TOKEN_REQUIRED',
      'Das CampFlow-API-Token fehlt. Bitte die Einrichtung prüfen.',
      503
    );
  }
  const preview = sammelBillingPreview(order, campaign);
  if (hash !== preview.hash)
    throw new SammelPaymentError(
      'BILLING_CHANGED',
      'Der Betrag oder die Bestellung wurde geändert. Bitte erneut prüfen.'
    );
  const currentPerson = (await sammelBillingPersons(order)).find(
    (person) => person.id === preview.snapshot.personId
  );
  if (!currentPerson)
    throw new ValidationError({
      personId: 'Die ausgewählte Person ist kein aktuelles Mitglied mehr.',
    });
  if (!currentPerson.matchesEmail && !order.paymentRecord?.assignment.reason)
    throw new ValidationError({
      reason: 'Die Kontaktadresse hat sich geändert. Bitte die Person erneut bestätigen.',
    });
  const record = structuredClone(order.paymentRecord!);
  if (
    order.paymentEvents.length > (record.operation ? 98 : 96) ||
    JSON.stringify(order.paymentEvents).length > 55_000
  )
    throw new SammelPaymentError(
      'PAYMENT_AUDIT_FULL',
      'Bitte das Zahlungsprotokoll vor der Beitragserstellung gesichert archivieren.',
      503
    );
  if (!record.operation) {
    // Leave room for preparation, attempt and outcome records before any financial write.
    record.operation = {
      key: randomUUID(),
      hash,
      snapshot: preview.snapshot,
      state: 'prepared',
      startedAt: new Date().toISOString(),
      attemptedAt: null,
      contribution: null,
      errorCategory: null,
    };
    await updateSammelOrder(
      order.id,
      sammelPaymentValues(order, record, 'prepared', principal),
      order.etag
    );
    const prepared = await getSammelOrder(order.id);
    if (
      !prepared ||
      prepared.paymentRecord?.operation?.key !== record.operation.key ||
      prepared.paymentRecord.operation.state !== 'prepared'
    )
      throw new Error('Prepared operation could not be loaded');
    order = prepared;
  } else if (record.operation.hash !== hash)
    throw new SammelPaymentError(
      'BILLING_CHANGED',
      'Die reservierten Beitragsdaten stimmen nicht mehr überein. Bitte manuell prüfen.'
    );
  record.operation.state = 'attempted';
  record.operation.attemptedAt = new Date().toISOString();
  // A lost response to this write must never lead to dispatch or automatic recovery.
  try {
    await updateSammelOrder(
      order.id,
      sammelPaymentValues(order, record, 'attempted', principal),
      order.etag
    );
  } catch (error: unknown) {
    if (getGraphStatus(error) === 412) throw error;
    throw new SammelPaymentError(
      'CONTRIBUTION_UNCERTAIN',
      'Die Reservierung konnte nicht bestätigt werden. Bitte den Zahlungsstand neu laden. Es wurde kein CampFlow-Aufruf gestartet.',
      502
    );
  }
  try {
    const contribution = await createCampflowFee(record.operation.snapshot);
    await recordContribution(order.id, record.operation.key, contribution, principal);
  } catch (error: unknown) {
    const category =
      error instanceof CampflowFeeUncertainError ? error.category : 'result_persistence';
    try {
      const current = await getSammelOrder(order.id);
      const latest = current?.paymentRecord;
      if (
        current &&
        latest?.operation?.key === record.operation.key &&
        latest.operation.state !== 'created'
      ) {
        latest.operation.state = 'uncertain';
        latest.operation.errorCategory = category;
        await updateSammelOrder(
          current.id,
          sammelPaymentValues(current, latest, 'uncertain', principal, category),
          current.etag
        );
      }
    } catch {
      /* The durable attempted state remains locked if local recording is unavailable. */
    }
    throw new SammelPaymentError(
      'CONTRIBUTION_UNCERTAIN',
      'Das Ergebnis ist unklar. Bitte in CampFlow prüfen. Keinen weiteren Beitrag anlegen.',
      502
    );
  }
}

/** Manual adoption records verified dashboard evidence and relies on the unique fee-ID column. */
export async function adoptSammelContribution(
  order: OrderRow,
  campaign: SammelAktion,
  hash: string,
  contribution: SammelContribution,
  evidence: string,
  principal: ClientPrincipal
): Promise<void> {
  const record = structuredClone(order.paymentRecord);
  if (!record)
    throw new SammelPaymentError('PERSON_SELECTION_REQUIRED', 'Bitte zuerst die Person zuordnen.');
  if (record.operation?.state === 'created')
    throw new SammelPaymentError(
      'CONTRIBUTION_LOCKED',
      'Der vorhandene Beitrag ist bereits zugeordnet.'
    );
  const preview = record.operation
    ? { hash: record.operation.hash, snapshot: record.operation.snapshot }
    : sammelBillingPreview(order, campaign, true);
  if (hash !== preview.hash)
    throw new SammelPaymentError(
      'BILLING_CHANGED',
      'Bitte den Betrag und die Person erneut prüfen.'
    );
  record.operation ??= {
    key: randomUUID(),
    hash,
    snapshot: preview.snapshot,
    state: 'prepared',
    startedAt: new Date().toISOString(),
    attemptedAt: null,
    contribution: null,
    errorCategory: null,
  };
  record.operation.state = 'created';
  record.operation.contribution = contribution;
  record.operation.errorCategory = null;
  record.settlement = {
    source: 'manual',
    paid: order.paid,
    markedAt: new Date().toISOString(),
    actor: actor(principal),
  };
  try {
    await updateSammelOrder(
      order.id,
      sammelPaymentValues(order, record, 'adopted', principal, evidence),
      order.etag
    );
  } catch (error: unknown) {
    if ([400, 409].includes(getGraphStatus(error) ?? 0))
      throw new SammelPaymentError(
        'CONTRIBUTION_ASSIGNMENT_CONFLICT',
        'Der Beitrag konnte nicht zugeordnet werden. Bitte prüfen, ob seine ID schon an einer anderen Bestellung hinterlegt ist.'
      );
    throw error;
  }
}

export async function confirmSammelPaymentDispatch(
  order: OrderRow,
  evidence: string,
  principal: ClientPrincipal
): Promise<void> {
  const record = structuredClone(order.paymentRecord);
  if (record?.operation?.state !== 'created')
    throw new SammelPaymentError(
      'CONTRIBUTION_REQUIRED',
      'Bitte zuerst einen Beitrag anlegen oder zuordnen.'
    );
  if (record.dispatch)
    throw new SammelPaymentError(
      'REQUEST_ALREADY_CONFIRMED',
      'Der Versand wurde bereits bestätigt.'
    );
  record.dispatch = {
    method: 'campflow_dashboard',
    confirmedAt: new Date().toISOString(),
    actor: actor(principal),
  };
  await updateSammelOrder(
    order.id,
    sammelPaymentValues(order, record, 'dispatched', principal, evidence),
    order.etag
  );
}

/** Amount and processing changes cannot invalidate an existing or uncertain contribution. */
export function guardSammelPaymentStatus(
  order: OrderRow,
  status: SammelStatus,
  totalCents: number | null,
  paid: boolean
): void {
  const operation = order.paymentRecord?.operation;
  if (!operation) return;
  if (totalCents !== operation.snapshot.amount || !['Bestellt', 'Eingetroffen'].includes(status))
    throw new ValidationError({
      form: 'Betrag und Person sind durch den CampFlow-Beitrag gesperrt. Korrekturen oder Stornierungen bitte zuerst in CampFlow klären.',
    });
  if (paid !== order.paid && operation.state !== 'created')
    throw new ValidationError({ paid: 'Bitte zuerst den unklaren CampFlow-Beitrag prüfen.' });
}

export function sammelManualSettlementValues(
  order: OrderRow,
  paid: boolean,
  principal: ClientPrincipal
): Record<string, unknown> {
  if (!order.paymentRecord?.operation || order.paid === paid) return {};
  const record = structuredClone(order.paymentRecord);
  record.settlement = {
    source: 'manual',
    paid,
    markedAt: new Date().toISOString(),
    actor: actor(principal),
  };
  return sammelPaymentValues(
    order,
    record,
    'settled',
    principal,
    paid ? 'Zahlung manuell bestätigt' : 'Zahlungsmarkierung manuell aufgehoben'
  );
}
