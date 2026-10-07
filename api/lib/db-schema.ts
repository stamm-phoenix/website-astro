import type { ColumnType, Generated } from 'kysely';

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

export interface SchemaMigrationTable {
  name: string;
  checksum: string;
  applied_at: Generated<Date>;
}
