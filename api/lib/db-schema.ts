import type { ColumnType, Generated } from 'kysely';
import type { AnwesenheitStufeName } from './anwesenheit-model';
import type { SammelShop } from './sammelbestellung-shops';
import type { SammelStatus } from './sammelbestellung-model';
import type { SammelPaymentEvent, SammelPaymentOperation } from './sammelbestellung-payment-model';
import type { ProtokollEditorStatus, ProtokollRevisionReason } from './protokoll-editor-model';

/** Set by the database (rowversion, computed columns); never written by the code. */
type ReadOnly<T> = ColumnType<T, never, never>;

/**
 * A `date` column: read as a Date at UTC midnight, written and compared as `YYYY-MM-DD`.
 * (The driver would send a Date as legacy `datetime`.)
 */
type SqlDate = ColumnType<Date | string, string, string>;

/** A `datetime2(3)` column, written as an ISO string so the milliseconds stay exact. */
type SqlTime = ColumnType<Date, string, string>;
type SqlTimeOrNull = ColumnType<Date | null, string | null, string | null>;

/** The tables as Kysely sees them; mirrors `api/migrations/*.sql`. */
export interface Database {
  'nikolaus.booking': BookingTable;
  'nikolaus.helper': HelperTable;
  'nikolaus.helper_availability': HelperAvailabilityTable;
  'nikolaus.assignment': AssignmentTable;
  'nikolaus.dispo_visit': DispoVisitTable;
  'nikolaus.state': StateTable;
  'nikolaus.settings': SettingsTable;
  'nikolaus.day': DayTable;
  'nikolaus.audit_log': AuditLogTable;
  'content.faq': FaqTable;
  'content.blog_post': BlogPostTable;
  'content.blog_image': BlogImageTable;
  'gruppenstunde.meeting': MeetingTable;
  'gruppenstunde.attendance': AttendanceTable;
  'organisation.protokoll_cutover': ProtokollCutoverTable;
  'organisation.protokoll': ProtokollTable;
  'organisation.protokoll_import': ProtokollImportTable;
  'organisation.project': TaskProjectTable;
  'organisation.template': TaskTemplateTable;
  'organisation.task': TaskTable;
  'organisation.task_recognition': TaskRecognitionTable;
  'organisation.checklist': ChecklistTable;
  'organisation.task_reminder_delivery': TaskReminderDeliveryTable;
  'protokoll.protokoll': EditorProtokollTable;
  'protokoll.sperre': EditorSperreTable;
  'protokoll.revision': EditorRevisionTable;
  'organisation.person': WeiterePersonTable;
  'organisation.aktion_ohne_zuschuss': AktionOhneZuschussTable;
  'sammel.campaign': SammelCampaignTable;
  'sammel.catalog_item': SammelCatalogItemTable;
  'sammel.catalog_variant': SammelCatalogVariantTable;
  'sammel.invitation': SammelInvitationTable;
  'sammel.link_quota': SammelLinkQuotaTable;
  'sammel.member_order': SammelOrderTable;
  'sammel.order_item': SammelOrderItemTable;
  'sammel.payment': SammelPaymentTable;
  'sammel.payment_email': SammelPaymentEmailTable;
  'sammel.payment_event': SammelPaymentEventTable;
  'dbo.schema_migrations': SchemaMigrationTable;
}

export type GeoResult = 'address' | 'street' | 'area' | 'not_found' | 'unavailable';

export interface BookingTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  slot_key: string;
  visit_date: SqlDate;
  season: ReadOnly<number>;
  status: string;
  family_name: string;
  email: string;
  email_normalized: ReadOnly<string>;
  phone: string;
  street: string;
  postal_code: string;
  city: string;
  address_notes: Generated<string>;
  children_count: number;
  with_krampus: boolean;
  hiding_place: string;
  notes: Generated<string>;
  geo_result: GeoResult;
  latitude: ColumnType<number | null, number | null, number | null>;
  longitude: ColumnType<number | null, number | null, number | null>;
  /** JSON array of strings. */
  internal_tags: Generated<string>;
  /** JSON array of strings. */
  rejected_stufen: Generated<string>;
  token_hash: string;
  reserved_until: Date | null;
  confirmed_at: Date | null;
  changed_at: Date | null;
  link_sent_at: Date | null;
  created_at: Generated<Date>;
}

export interface HelperTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  name: string;
  notes: string;
  /** JSON array of strings. */
  positive_tags: string;
  /** JSON array of strings. */
  negative_tags: string;
  /** JSON array of strings. */
  rejected_stufen: Generated<string>;
}

export interface HelperAvailabilityTable {
  helper_id: number;
  date: SqlDate;
  role: string;
}

export interface AssignmentTable {
  helper_id: number;
  date: SqlDate;
  team: string;
  role: string;
  fixed: boolean;
}

export interface DispoVisitTable {
  booking_id: number;
  date: SqlDate;
  team: string;
  route_order: number;
  slot_key: string;
  planned_arrival: string;
  fixed: boolean;
  visited_at: Date | null;
  visit_operation_id: string | null;
}

export interface StateTable {
  state_key: string;
  /** JSON document. */
  value: string;
  version: ReadOnly<Buffer>;
  updated_at: Generated<Date>;
}

export interface SettingsTable {
  id: number;
  version: ReadOnly<Buffer>;
  public_active: boolean;
  staff_active: boolean;
  maintenance: boolean;
  pending_hold_minutes: number;
  change_deadline_hours: number;
  base_name: string;
  /** decimal; the driver reads it as a number. */
  base_latitude: number;
  base_longitude: number;
  /** JSON array of strings. */
  service_postal_codes: string;
  far_distance_km: number;
  updated_at: Generated<Date>;
  updated_by: Generated<string>;
}

export interface DayTable {
  date: SqlDate;
  /** `HH:MM`, local time. */
  start_time: string;
  end_time: string;
  teams: number;
}

export interface AuditLogTable {
  id: Generated<number>;
  at: Generated<Date>;
  actor: string;
  action: string;
  /** JSON object. */
  details: string;
}

export interface FaqTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  question: string;
  /** Sanitized HTML. */
  answer: string;
  category: string;
  published: boolean;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  updated_by: Generated<string>;
}

export interface BlogPostTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  title: string;
  post_date: SqlDate;
  published: boolean;
  /** Canonical HTML with `<img data-bild>` placeholders. */
  content: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  updated_by: Generated<string>;
}

export interface BlogImageTable {
  post_id: number;
  file: string;
  /** 0 is the cover image. */
  position: number;
  alt: Generated<string>;
  width: number;
  height: number;
}

export interface MeetingTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  /** Limited by `ck_meeting_stufe`. */
  stufe: AnwesenheitStufeName;
  date: SqlDate;
  notes: Generated<string>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  updated_by: Generated<string>;
}

export interface AttendanceTable {
  id: Generated<number>;
  meeting_id: number;
  guest: boolean;
  /** CampFlow person; `null` for guests and after the retention period. */
  person_id: string | null;
  /** `null` for members and after the retention period. */
  guest_name: string | null;
}

export interface SchemaMigrationTable {
  name: string;
  checksum: string;
  applied_at: Generated<Date>;
}

export interface TaskProjectTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  title: string;
  campflow_id: string;
  updated_by: string;
}
export interface TaskTemplateTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  title: string;
  items: string;
  updated_by: string;
}
export interface TaskTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  project_id: number | null;
  suggested_assignee_name: Generated<string>;
  assignment_resolution: Generated<'legacy' | 'matched' | 'declined'>;
  suggested_project_title: Generated<string>;
  title: string;
  description: string;
  assignee: string;
  assignees: Generated<string>;
  due_date: SqlDate | null;
  state: 'offen' | 'erledigt' | 'vorschlag' | 'abgelehnt';
  source_id: Generated<string>;
  source_version: Generated<string>;
  quote: Generated<string>;
  source_key: Generated<string | null>;
  updated_by: string;
  created_at: Generated<Date>;
}
export interface ChecklistTable {
  project_id: number;
  template_id: number;
}

export interface TaskReminderDeliveryTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  reminder_day: SqlDate;
  recipient: string;
  status: 'attempted' | 'sent' | 'uncertain' | 'failed' | 'retryable';
  retry_after: Generated<Date | null>;
  attempted_at: Generated<Date>;
  sent_at: Date | null;
}

export interface TaskRecognitionTable {
  source_id: string;
  source_version: string;
  processed_at: Generated<Date>;
}

export interface ProtokollTable {
  imported_fields: Generated<string | null>;
  source_cleared: Generated<boolean>;
  drive_id: string;
  item_id: string;
  fields: string;
  legacy_fields: string | null;
  legacy_etag: string | null;
  version: ReadOnly<Buffer>;
}
export interface ProtokollImportTable {
  drive_id: string;
  completed_at: Generated<Date>;
  version: ReadOnly<Buffer>;
}

export interface EditorProtokollTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  title: string;
  meeting_date: SqlDate;
  status: Generated<ProtokollEditorStatus>;
  /** JSON (`ProtokollInhalt`). */
  content: string;
  created_at: Generated<Date>;
  created_by: string;
  updated_at: Generated<Date>;
  updated_by: string;
  submitted_at: Date | null;
  submitted_by: string | null;
  review_note: string | null;
  approved_at: Date | null;
  approved_by: string | null;
  /** The PDF filed in the folder of the minutes on approval. */
  pdf_drive_id: string | null;
  pdf_item_id: string | null;
  pdf_name: string | null;
  pdf_url: string | null;
  delivery_state: 'attempted' | 'sent' | null;
  delivery_attempt: string | null;
  delivery_recipients: number | null;
  delivery_at: Date | null;
  delivery_by: string | null;
}

export interface EditorSperreTable {
  protokoll_id: number;
  login: string;
  name: string;
  token: string;
  since: Date;
  until: Date;
  aktiver_punkt: string | null;
}

export interface EditorRevisionTable {
  id: Generated<number>;
  protokoll_id: number;
  title: string;
  meeting_date: SqlDate;
  /** JSON (`ProtokollInhalt`). */
  content: string;
  reason: ProtokollRevisionReason;
  saved_at: Generated<Date>;
  saved_by: string;
}

export interface WeiterePersonTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  name: string;
  /** Lowercase login in the tenant, or empty. */
  login: Generated<string>;
  gruppe: 'altleitende' | 'weitere';
  aktiv: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  updated_by: string;
}

/** A CampFlow Aktion without KJR grant; every Aktion not listed here gets one. */
export interface AktionOhneZuschussTable {
  campflow_id: string;
  created_at: Generated<Date>;
  created_by: string;
}

export interface ProtokollCutoverTable {
  id: number;
  mode: 'frozen' | 'sql';
  sql_started: Generated<boolean>;
}

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
