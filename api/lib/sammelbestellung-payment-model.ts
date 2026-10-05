import type { SammelBestellung } from './sammelbestellung-model';

/** Serializable staff-only payment records. No provider credentials or full person objects. */
export interface SammelBillingPerson {
  id: string;
  name: string;
  emails: string[];
  matchesEmail: boolean;
}

export interface SammelPaymentActor {
  id: string;
  name: string;
}

export interface SammelBillingAssignment {
  person: SammelBillingPerson;
  reason: string;
  confirmedBy: SammelPaymentActor;
  confirmedAt: string;
}

export interface SammelBillingSnapshot {
  personId: string;
  amount: number;
  description: string;
  orderId: string;
  campaignId: string;
  revision: string;
  /** Absent in payment operations prepared before accounting assignments were introduced. */
  attachedExpense?: { costunitName: string; categoryName: string };
}

export interface SammelContribution {
  id: string;
  reference: string;
}

export interface SammelPaymentOperation {
  key: string;
  hash: string;
  snapshot: SammelBillingSnapshot;
  state: 'prepared' | 'attempted' | 'uncertain' | 'created';
  startedAt: string;
  attemptedAt: string | null;
  contribution: SammelContribution | null;
  errorCategory: string | null;
}

export interface SammelPaymentRecord {
  version: 1;
  assignment: SammelBillingAssignment;
  operation: SammelPaymentOperation | null;
  dispatch: { method: 'campflow_dashboard'; confirmedAt: string; actor: SammelPaymentActor } | null;
  settlement: {
    source: 'manual';
    paid: boolean;
    markedAt: string;
    actor: SammelPaymentActor;
  } | null;
}

export interface SammelPaymentEvent {
  at: string;
  actor: SammelPaymentActor;
  action:
    | 'assigned'
    | 'prepared'
    | 'attempted'
    | 'created'
    | 'uncertain'
    | 'adopted'
    | 'dispatched'
    | 'settled';
  operationKey: string | null;
  evidence: string;
}

export interface SammelPaymentView {
  campaignArchived: boolean;
  order: SammelBestellung;
  record: SammelPaymentRecord | null;
  events: SammelPaymentEvent[];
  creationEnabled: boolean;
}

export interface SammelPaymentPreview {
  etag: string;
  snapshot: SammelBillingSnapshot;
  hash: string;
  personName: string;
}
