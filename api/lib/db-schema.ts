import type { ColumnType, Generated } from 'kysely';
import type { AnwesenheitStufeName } from './anwesenheit-model';
import type { MitschriftQuelle, MitschriftStatus } from './mitschriften-model';

/** Set by the database (rowversion, computed columns); never written by the code. */
type ReadOnly<T> = ColumnType<T, never, never>;

/**
 * A `date` column: read as a Date at UTC midnight, written and compared as `YYYY-MM-DD`.
 * (The driver would send a Date as legacy `datetime`.)
 */
type SqlDate = ColumnType<Date | string, string, string>;

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
  'organisation.protokoll': ProtokollTable;
  'organisation.protokoll_import': ProtokollImportTable;
  'organisation.project': TaskProjectTable;
  'organisation.template': TaskTemplateTable;
  'organisation.task': TaskTable;
  'organisation.task_recognition': TaskRecognitionTable;
  'organisation.checklist': ChecklistTable;
  'organisation.task_reminder_delivery': TaskReminderDeliveryTable;
  'mitschrift.mitschrift': MitschriftTable;
  'mitschrift.sprecher': SprecherTable;
  'mitschrift.abschnitt': AbschnittTable;
  'mitschrift.auftrag': AuftragTable;
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

export interface MitschriftTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  title: string;
  meeting_date: SqlDate;
  status: MitschriftStatus;
  /** JSON (`MitschriftNotizen`), `null` until notes were generated. */
  notes: string | null;
  notes_edited: Generated<boolean>;
  notes_stale: Generated<boolean>;
  notes_at: Date | null;
  created_at: Generated<Date>;
  created_by: string;
  updated_at: Generated<Date>;
  updated_by: Generated<string>;
}

export interface SprecherTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  mitschrift_id: number;
  source: MitschriftQuelle;
  key: string;
  number: number;
  name: Generated<string>;
}

export interface AbschnittTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  mitschrift_id: number;
  sprecher_id: number | null;
  source: MitschriftQuelle;
  start_ms: number;
  end_ms: number;
  text: string;
  client_id: string | null;
}

/** `erledigt`: the result is stored, blob and job at Azure Speech are still being deleted. */
export type AuftragStatus = 'hochladen' | 'laeuft' | 'erledigt' | 'fehler';

export interface AuftragTable {
  id: Generated<number>;
  mitschrift_id: number;
  source: MitschriftQuelle;
  blob_name: string;
  status: AuftragStatus;
  transcription: string | null;
  offset_ms: Generated<number>;
  until_ms: number | null;
  error: string | null;
  created_at: Generated<Date>;
  created_by: string;
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
