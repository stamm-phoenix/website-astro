import type { SammelPaymentView } from './types';
export type PaymentMode = 'inspect' | 'assign' | 'review' | 'adopt' | 'dispatch';
interface PaymentStep {
  currentArchived: boolean;
  needsPreparation: boolean;
  adoptOnly: boolean;
  unavailable: boolean;
  assignmentUnavailable: boolean;
  label: string;
  busyLabel: string;
  next: 'prepare' | 'close' | 'review' | 'adopt';
}
/** Decide the payment step from durable state, without making a request or creating a fee. */
export function paymentStep(
  view: SammelPaymentView | null,
  mode: PaymentMode,
  archived: boolean
): PaymentStep {
  const currentArchived = view?.campaignArchived ?? archived;
  const operation = view?.record?.operation;
  const needsPreparation =
    !operation &&
    !!view &&
    (!['Bestellt', 'Eingetroffen'].includes(view.order.status) || view.order.totalCents === null);
  // Paid orders never get a new contribution, but staff may still adopt an existing one.
  const adoptOnly = !operation && !!view?.record && view.order.paid;
  const unavailable =
    !operation &&
    !!view &&
    (currentArchived ||
      (view.order.paid && !view.record) ||
      !view.order.submitted ||
      view.order.totalCents === 0);
  // Assignment has its own eligibility rules: paid orders may adopt an existing contribution.
  const assignmentUnavailable =
    !!view &&
    (currentArchived || !view.order.submitted || view.order.status === 'Storniert' || !!operation);
  let label: string;
  switch (mode) {
    case 'assign':
      label = 'Person bestätigen';
      break;
    case 'adopt':
      label = 'Beitrag zuordnen';
      break;
    case 'dispatch':
      label = 'Versand bestätigen';
      break;
    case 'review':
      label = view?.creationEnabled ? 'Beitrag anlegen' : 'Beitrag zuordnen';
      break;
    case 'inspect':
      if (operation?.state === 'created') label = 'Fertig';
      else if (operation && operation.state !== 'prepared') label = 'Beitrag zuordnen';
      else if (needsPreparation) label = 'Bestellung vorbereiten';
      else if (adoptOnly) label = 'Beitrag zuordnen';
      else label = 'Beitrag vorbereiten';
  }

  return {
    currentArchived,
    needsPreparation,
    adoptOnly,
    unavailable,
    assignmentUnavailable,
    label,
    busyLabel:
      mode === 'review' && view?.creationEnabled
        ? 'Beitrag wird angelegt …'
        : mode === 'adopt'
          ? 'Zuordnung wird gespeichert …'
          : mode === 'dispatch'
            ? 'Bestätigung wird gespeichert …'
            : mode === 'assign'
              ? 'Person wird gespeichert …'
              : 'Zahlungsstand wird geladen …',
    next: needsPreparation
      ? 'prepare'
      : operation?.state === 'created'
        ? 'close'
        : adoptOnly || (operation && operation.state !== 'prepared')
          ? 'adopt'
          : 'review',
  };
}
