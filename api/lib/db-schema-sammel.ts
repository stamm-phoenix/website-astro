import type { Generated } from 'kysely';
import type { ReadOnly, SqlTime, SqlTimeOrNull } from './db-schema-types';
import type { SammelShop } from './sammelbestellung-shops';
import type { SammelStatus } from './sammelbestellung-model';
import type { SammelPaymentEvent, SammelPaymentOperation } from './sammelbestellung-payment-model';

export interface SammelCampaignTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  creation_key: string;
  title: string;
  description: Generated<string>;
  starts_at: SqlTime;
  ends_at: SqlTime;
  archived: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface SammelCatalogItemTable {
  campaign_id: number;
  position: number;
  shop: SammelShop;
  name: string;
  reference: string;
}

export interface SammelCatalogVariantTable {
  campaign_id: number;
  item_position: number;
  position: number;
  variant: string;
}

export interface SammelInvitationTable {
  campaign_id: number;
  address: string;
  status: 'pending' | 'attempted' | 'sent';
}

export interface SammelLinkQuotaTable {
  campaign_id: number;
  hour_window: number;
  hour_count: number;
  day_window: number;
  day_count: number;
}

export interface SammelOrderTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  campaign_id: number;
  email: string;
  name: Generated<string>;
  notes: Generated<string>;
  status: Generated<SammelStatus>;
  submitted: Generated<boolean>;
  paid: Generated<boolean>;
  delivered: Generated<boolean>;
  total_cents: number | null;
  link_sent_at: SqlTimeOrNull;
  created_at: Generated<Date>;
}

export interface SammelOrderItemTable {
  order_id: number;
  position: number;
  shop: SammelShop;
  name: string;
  reference: string;
  variant: string;
  quantity: number;
  excluded: boolean;
  excluded_reason: string;
}

export interface SammelPaymentTable {
  order_id: number;
  person_id: string;
  person_name: string;
  person_matches_email: boolean;
  assignment_reason: string;
  assigned_by_id: string;
  assigned_by_name: string;
  assigned_at: SqlTime;
  operation_key: string | null;
  operation_hash: string | null;
  operation_state: SammelPaymentOperation['state'] | null;
  operation_started_at: SqlTimeOrNull;
  operation_attempted_at: SqlTimeOrNull;
  snapshot_person_id: string | null;
  snapshot_amount: number | null;
  snapshot_description: string | null;
  snapshot_order_id: number | null;
  snapshot_campaign_id: number | null;
  snapshot_revision: string | null;
  snapshot_costunit_name: string | null;
  snapshot_category_name: string | null;
  contribution_id: string | null;
  contribution_reference: string | null;
  error_category: string | null;
  dispatch_confirmed_at: SqlTimeOrNull;
  dispatch_actor_id: string | null;
  dispatch_actor_name: string | null;
  settlement_paid: boolean | null;
  settlement_marked_at: SqlTimeOrNull;
  settlement_actor_id: string | null;
  settlement_actor_name: string | null;
}

export interface SammelPaymentEmailTable {
  order_id: number;
  position: number;
  email: string;
}

export interface SammelPaymentEventTable {
  id: Generated<number>;
  order_id: number;
  at: SqlTime;
  actor_id: string;
  actor_name: string;
  action: SammelPaymentEvent['action'];
  operation_key: string | null;
  evidence: string;
}
