import type { ColumnType, Generated } from 'kysely';
import type { EssenEinheitenart } from './essen-validation';
import type { GerichtEinheit } from './essen-gerichte-model';
import type { AnwesenheitStufeName } from './anwesenheit-model';
import type { SammelShop } from './sammelbestellung-shops';
import type { SammelStatus } from './sammelbestellung-model';
import type { SammelPaymentEvent, SammelPaymentOperation } from './sammelbestellung-payment-model';
import type {
  AbstimmungMailArt,
  AbstimmungMailStatus,
  AbstimmungSichtbarkeit,
} from './abstimmung-model';
import type { ProtokollEditorStatus, ProtokollRevisionReason } from './protokoll-editor-model';
import type {
  ProblemAiStatus,
  ProblemEntry,
  ProblemEnvironment,
  ProblemLabel,
  ProblemStatus,
  ProblemVerdict,
} from './problemmeldung-model';

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
  'content.gruppenstunde': GruppenstundeTable;
  'content.team': TeamTable;
  'content.leitende': LeitendeTable;
  'content.leitende_team': LeitendeTeamTable;
  'content.sharepoint_import': SharePointImportTable;
  'content.id_counter': ContentIdCounterTable;
  'content.aktion_stufe_option': AktionStufeOptionTable;
  'content.aktion': AktionTable;
  'content.aktion_stufe': AktionStufeTable;
  'organisation.beleg': BelegTable;
  'organisation.beleg_campflow': BelegCampflowTable;
  'content.instagram_token': InstagramTokenTable;
  'content.download': DownloadTable;
  'gruppenstunde.meeting': MeetingTable;
  'gruppenstunde.attendance': AttendanceTable;
  'organisation.protokoll_cutover': ProtokollCutoverTable;
  'organisation.protokoll': ProtokollTable;
  'organisation.protokoll_import': ProtokollImportTable;
  'organisation.protokoll_content_version': ProtokollContentVersionTable;
  'organisation.project': TaskProjectTable;
  'organisation.template': TaskTemplateTable;
  'organisation.task': TaskTable;
  'organisation.task_recognition': TaskRecognitionTable;
  'organisation.checklist': ChecklistTable;
  'organisation.task_reminder_delivery': TaskReminderDeliveryTable;
  'protokoll.protokoll': EditorProtokollTable;
  'protokoll.sperre': EditorSperreTable;
  'protokoll.revision': EditorRevisionTable;
  'protokoll.erinnerung': LeitendenrundeErinnerungTable;
  'organisation.person': PersonTable;
  'organisation.aktion_ohne_zuschuss': AktionOhneZuschussTable;
  'organisation.aktion_keine_aktion': AktionKeineAktionTable;
  'organisation.staff_changelog_seen': StaffChangelogSeenTable;
  'organisation.staff_favorites': StaffFavoritesTable;
  'organisation.staff_recent': StaffRecentTable;
  'organisation.staff_settings': StaffSettingsTable;
  'organisation.abrechnung_eingabe': AbrechnungEingabeTable;
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
  'abstimmung.abstimmung': AbstimmungTable;
  'abstimmung.optionen': AbstimmungOptionTable;
  'abstimmung.teilnahme': AbstimmungTeilnahmeTable;
  'abstimmung.stimme': AbstimmungStimmeTable;
  'essen.einstellungen': EssenEinstellungenTable;
  'essen.audit_log': AuditLogTable;
  'essen.kategorie': EssenKategorieTable;
  'essen.unvertraeglichkeit': EssenUnvertraeglichkeitTable;
  'essen.zutat': EssenZutatTable;
  'essen.zutat_unvertraeglichkeit': EssenZutatUnvertraeglichkeitTable;
  'problem.meldung': ProblemMeldungTable;
  'essen.anlage_anfrage': EssenAnlageAnfrageTable;
  'essen.planung': EssenPlanungTable;
  'essen.mitglied': EssenMitgliedTable;
  'essen.tag': EssenTagTable;
  'essen.mahlzeit': EssenMahlzeitTable;
  'essen.aenderung': EssenAenderungTable;
  'essen.planung_zutat': EssenPlanungZutatTable;
  'essen.planung_zutat_unvertraeglichkeit': EssenPlanungZutatUnvertraeglichkeitTable;
  'essen.gericht': EssenGerichtTable;
  'essen.gericht_zutat': EssenGerichtZutatTable;
  'essen.gericht_zutat_unvertraeglichkeit': EssenGerichtZutatUnvertraeglichkeitTable;
  'essen.einplanung': EssenEinplanungTable;
  'essen.einplanung_verbrauch': EssenEinplanungVerbrauchTable;
  'essen.planung_gruppe': EssenPlanungGruppeTable;
  'essen.teilnehmende': EssenTeilnehmendeTable;
  'essen.teilnehmende_unvertraeglichkeit': EssenTeilnehmendeUnvertraeglichkeitTable;
  'essen.mahlzeit_ohne_gruppe': EssenMahlzeitOhneGruppeTable;
  'essen.geschaeft': EssenGeschaeftTable;
  'essen.bestand': EssenPostenTable;
  'essen.zusatzbedarf': EssenZusatzbedarfTable;
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
  /** Contact for families on their visit day; both set or both `null`. */
  day_contact_name: string | null;
  day_contact_phone: string | null;
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

export interface GruppenstundeTable {
  /** Taken over from SharePoint or assigned by `nextContentId`. */
  id: number;
  version: ReadOnly<Buffer>;
  stufe: string;
  weekday: string;
  meeting_time: string;
  age_range: string;
  location: string;
  /** Sanitized HTML. */
  description: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  updated_by: Generated<string>;
}

export interface TeamTable {
  name: string;
}

export interface LeitendeTable {
  /** Taken over from SharePoint or assigned by `nextContentId`. */
  id: number;
  version: ReadOnly<Buffer>;
  name: string;
  phone: Generated<string>;
  street: Generated<string>;
  postal_code: Generated<string>;
  city: Generated<string>;
  /** File name of the photo (`foto-<digits>.webp`, or `.jpg` for photos stored earlier), or null without a photo. */
  photo: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  updated_by: Generated<string>;
}

export interface LeitendeTeamTable {
  leitende_id: number;
  team: string;
}

export interface ContentIdCounterTable {
  table_name:
    'content.gruppenstunde' | 'content.leitende' | 'content.aktion' | 'organisation.beleg';
  last_id: number;
}

export interface AktionStufeOptionTable {
  name: string;
}

export interface AktionTable {
  /** Taken over from SharePoint or assigned by `nextContentId`. */
  id: number;
  version: ReadOnly<Buffer>;
  title: string;
  start_date: ColumnType<Date | string | null, string | null, string | null>;
  end_date: ColumnType<Date | string | null, string | null, string | null>;
  link: Generated<string>;
  /** Sanitized HTML. */
  description: Generated<string>;
  campflow_id: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  updated_by: Generated<string>;
}

export interface AktionStufeTable {
  aktion_id: number;
  stufe: string;
}

export interface BelegTable {
  /** Taken over from SharePoint or assigned by `nextContentId`. */
  id: number;
  version: ReadOnly<Buffer>;
  shop: string;
  beleg_date: ColumnType<Date | string | null, string | null, string | null>;
  amount_cent: number;
  paid_by: string;
  payout: boolean;
  /** Older receipts only; newer ones name Kostenstelle and Kategorie. */
  aktion: Generated<string>;
  /** Name of the Kostenstelle in CampFlow, or a new one typed in. */
  kostenstelle: Generated<string>;
  /** Name of the Kategorie of that Kostenstelle, or a new one typed in. */
  kategorie: Generated<string>;
  note: string;
  status: 'Eingereicht' | 'Angenommen' | 'Abgelehnt';
  review_note: string;
  submitted_by: string;
  /** Written as ISO text, so `datetime2(3)` keeps the milliseconds. */
  submitted_at: ColumnType<Date, string, string>;
  /**
   * `beleg-<digits>.jpg`, `beleg-<digits>-scan.jpg` or a PDF `beleg-<digits>.pdf`, or null without
   * a photo.
   */
  photo: ColumnType<string | null, string | null | undefined, string | null>;
  /** An expense or income; income has no Auslage. */
  art: Generated<BelegArt>;
  /** `BelegCheck` as JSON. */
  ai_check: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  updated_by: Generated<string>;
}

export type BelegArt = 'Ausgabe' | 'Einnahme';

export type BelegCampflowState = 'Gestartet' | 'Fehlgeschlagen' | 'Hochgeladen';

/** Transfer of a receipt to CampFlow; outlives the receipt, so it has no foreign key. */
export interface BelegCampflowTable {
  beleg_id: number;
  version: ReadOnly<Buffer>;
  state: BelegCampflowState;
  /** File name in CampFlow, the key against duplicates; the same for every attempt. */
  file_name: string;
  costunit_id: string;
  costunit_name: string;
  category_id: string;
  category_name: string;
  shop: string;
  beleg_date: ColumnType<Date | string | null, string | null, string | null>;
  amount_cent: number;
  art: Generated<BelegArt>;
  paid_by: Generated<string>;
  payout: Generated<boolean>;
  aktion: Generated<string>;
  note: Generated<string>;
  submitted_by: Generated<string>;
  /** `rowversion` of the receipt whose details were sent; the snapshot above. */
  beleg_version: Buffer;
  error: Generated<string>;
  campflow_number: ColumnType<string | null, string | null | undefined, string | null>;
  campflow_receipt_id: ColumnType<string | null, string | null | undefined, string | null>;
  campflow_expense_id: ColumnType<string | null, string | null | undefined, string | null>;
  started_by: string;
  /** Written as ISO text, so `datetime2(3)` keeps the milliseconds. */
  started_at: ColumnType<Date, string, string>;
  uploaded_at: ColumnType<Date | null, string | null | undefined, string | null>;
  beleg_deleted_at: ColumnType<Date | null, string | null | undefined, string | null>;
}

export interface InstagramTokenTable {
  id: number;
  token: string;
  refreshed_at: ColumnType<Date | null, string | null, string | null>;
}

export interface DownloadTable {
  /** The SharePoint document ID (taken over) or a random ID (`newDownloadId`). */
  id: string;
  version: ReadOnly<Buffer>;
  /** Unique regardless of case. */
  file_name: string;
  /** Folder of the current version in Blob Storage (`downloads/<file_key>/…`). */
  file_key: string;
  /** Bytes; mssql returns a bigint as a string. */
  size: ColumnType<string | number, number, number>;
  mime_type: string;
  has_preview: Generated<boolean>;
  created_at: ColumnType<Date, string | undefined, string>;
  created_by: Generated<string>;
  updated_at: ColumnType<Date, string | undefined, string>;
  updated_by: Generated<string>;
}

export interface SharePointImportTable {
  list: 'gruppenstunden' | 'leitende' | 'aktionen' | 'belege' | 'instagram' | 'downloads';
  imported_at: Generated<Date>;
  /** JSON with the counts of the import. */
  summary: string;
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
  /** The Gruppenstunde did not take place; it then has no attendance. */
  cancelled: Generated<boolean>;
}

export interface AttendanceTable {
  id: Generated<number>;
  meeting_id: number;
  guest: boolean;
  /** CampFlow person; `null` for guests and after the retention period. */
  person_id: string | null;
  /** `null` for members and after the retention period. */
  guest_name: string | null;
  /** The member was excused instead of there; never set for guests. */
  excused: Generated<boolean>;
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
  /** Minutes of the editor whose approval created the task (`0031`). */
  protokoll_id: Generated<number | null>;
  protokoll_aufgabe: Generated<string | null>;
  protokoll_punkt: Generated<string>;
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

/** Content fingerprint of a file, valid while its cTag is unchanged (migration 0038). */
export interface ProtokollContentVersionTable {
  drive_id: string;
  item_id: string;
  ctag: string;
  /** `docx-word-sha256:…` or `file-sha256:…`, see `protokoll-content-version.ts`. */
  content_version: string;
  updated_at: Generated<Date>;
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

/** One reminder mail per meeting, stage and recipient (migration 0047). */
export interface LeitendenrundeErinnerungTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  meeting_key: string;
  meeting_date: SqlDate;
  meeting_at: Date;
  protokoll_ref: string;
  days_before: number;
  /** SHA-256 of the lowercase address; the address itself is not stored. */
  recipient_hash: string;
  status: 'attempted' | 'sent' | 'uncertain' | 'failed' | 'retryable';
  attempted_at: Generated<Date>;
  sent_at: Date | null;
  retry_after: Generated<Date | null>;
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

export interface PersonTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  name: string;
  /** Lowercase login in the tenant, or empty; unique if set. Required for `leitende`. */
  login: Generated<string>;
  gruppe: 'leitende' | 'altleitende' | 'weitere';
  /** ID in the CampFlow member list (`per_…`), or empty; unique if set. */
  campflow_person_id: Generated<string>;
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

/** A CampFlow event that is no real Aktion, e.g. an order of jumpers (migration 0033). */
export interface AktionKeineAktionTable {
  campflow_id: string;
  created_at: Generated<Date>;
  created_by: string;
}

export interface StaffFavoritesTable {
  /** `userId` of the Static Web Apps principal. */
  user_id: string;
  login: string;
  /** JSON array of module paths. */
  modules: string;
  updated_at: Generated<Date>;
}

export interface StaffChangelogSeenTable {
  /** `userId` of the Static Web Apps principal. */
  user_id: string;
  login: string;
  /** ID of the newest changelog entry the person has seen, see `changelog-id.ts`. */
  last_seen_id: string;
  updated_at: Generated<Date>;
}

export interface StaffRecentTable {
  /** `userId` of the Static Web Apps principal. */
  user_id: string;
  login: string;
  /** JSON array of module paths, the latest first. */
  modules: string;
  updated_at: Generated<Date>;
}

export interface StaffSettingsTable {
  /** `userId` of the Static Web Apps principal. */
  user_id: string;
  login: string;
  /** JSON object, see `StaffSettings` in `staff-settings-model.ts`. */
  settings: string;
  updated_at: Generated<Date>;
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

export interface AbrechnungEingabeTable {
  user_id: string;
  event_id: string;
  login: string;
  session: string;
  delete_after: Date;
  updated_at: Generated<Date>;
  version: ReadOnly<Buffer>;
}

export interface AbstimmungTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  titel: string;
  beschreibung: Generated<string>;
  /** At most this many options with „Ja“; `null`: any number. */
  max_auswahl: number | null;
  /** Options may also be chosen with „Vielleicht“. */
  vielleicht: Generated<boolean>;
  sichtbarkeit: Generated<AbstimmungSichtbarkeit>;
  link_token: string;
  erstellt_von: string;
  erstellt_von_name: string;
  erstellt_am: Generated<Date>;
  geschlossen_am: SqlTimeOrNull;
}

export interface AbstimmungOptionTable {
  id: Generated<number>;
  abstimmung_id: number;
  position: number;
  text: string;
}

export interface AbstimmungTeilnahmeTable {
  id: Generated<number>;
  abstimmung_id: number;
  token: string;
  name: Generated<string>;
  login: string | null;
  email: string | null;
  geantwortet_am: SqlTimeOrNull;
  mail_art: AbstimmungMailArt | null;
  mail_status: AbstimmungMailStatus | null;
  eingeladen_am: SqlTimeOrNull;
  erinnert_am: SqlTimeOrNull;
  erstellt_am: Generated<Date>;
  /** Key of the first answer over the shared link, so a repeated request finds this row. */
  versuch: string | null;
  /** Invitation to an address several CampFlow persons share; holds no answer itself. */
  familie: Generated<boolean>;
  /** Another invitation of the same leader: its link opens and changes that participation. */
  alias_von: number | null;
}

export interface AbstimmungStimmeTable {
  teilnahme_id: number;
  option_id: number;
  /** Chosen with „Vielleicht“ instead of „Ja“. */
  vielleicht: Generated<boolean>;
}

/** The one row with the switches and templates of the Essensplanung (`docs/essensplanung.md`). */
export interface EssenEinstellungenTable {
  id: number;
  version: ReadOnly<Buffer>;
  anlegen_extern: boolean;
  /** JSON array of addresses and domains. */
  whitelist: string;
  aufbewahrung_monate: number;
  wartung: boolean;
  /** JSON array of `{ name, faktor }`. */
  vorlage_gruppen: string;
  /** JSON array of names. */
  vorlage_mahlzeiten: string;
  updated_at: Generated<Date>;
  updated_by: string;
}

export interface EssenKategorieTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  name: string;
}

export interface EssenUnvertraeglichkeitTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  /** Fixed key of the 14 EU allergens; null for the ones added in the Steuerung. */
  schluessel: string | null;
  name: string;
}

export interface EssenZutatTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  name: string;
  kategorie_id: number;
  einheitenart: EssenEinheitenart;
  abtropfgewicht: Generated<boolean>;
  lebensmittel: Generated<boolean>;
  vegetarisch: boolean | null;
  vegan: boolean | null;
  merkmale_geprueft: Generated<boolean>;
  hinweis: Generated<string>;
  /** decimal; the driver reads it as a number. */
  gramm_pro_tl: number | null;
  gramm_pro_el: number | null;
  gramm_pro_stueck: number | null;
  geaendert_am: Generated<Date>;
  geaendert_von: string;
}

export interface EssenZutatUnvertraeglichkeitTable {
  zutat_id: number;
  unvertraeglichkeit_id: number;
}

/** A report of „Problem melden“ (`problem.meldung`, migration `0051_problemmeldung.sql`). */
export interface ProblemMeldungTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  created_at: Generated<Date>;
  entry: ProblemEntry;
  description: string;
  steps: Generated<string>;
  expected: Generated<string>;
  contact: Generated<string>;
  page: Generated<string>;
  module: Generated<string>;
  error_code: Generated<string>;
  http_status: number | null;
  action: Generated<string>;
  correlation_id: Generated<string>;
  app_version: Generated<string>;
  environment: ProblemEnvironment;
  browser: Generated<string>;
  viewport: Generated<string>;
  status: Generated<ProblemStatus>;
  ai_status: Generated<ProblemAiStatus>;
  ai_verdict: ProblemVerdict | null;
  ai_reason: Generated<string>;
  ai_error: Generated<string>;
  ai_started_at: SqlTimeOrNull;
  ai_at: SqlTimeOrNull;
  draft_title: Generated<string>;
  draft_body: Generated<string>;
  github_label: Generated<ProblemLabel>;
  reviewed_by: Generated<string>;
  reviewed_at: SqlTimeOrNull;
  discard_reason: Generated<string>;
  github_started_at: SqlTimeOrNull;
  /** Start of the first hand-over that ended unclear; the search for its issue begins here. */
  github_first_at: SqlTimeOrNull;
  github_number: number | null;
  github_url: Generated<string>;
  github_at: SqlTimeOrNull;
}

/** A request to create a Planung, confirmed by the link in a mail. */
export interface EssenAnlageAnfrageTable {
  id: Generated<number>;
  token_hash: string;
  email: string;
  name: string;
  planung_name: string;
  erster_tag: SqlDate;
  letzter_tag: SqlDate;
  erstellt_am: Generated<Date>;
  laeuft_ab: Date;
  planung_id: number | null;
}

export interface EssenPlanungTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  name: string;
  mitglieder_verwalten: Generated<boolean>;
  beitritt_token: string | null;
  lese_token: string | null;
  /** bigint; the driver reads it as a string. */
  aenderung_seq: ColumnType<string, never, string>;
  erstellt_am: Generated<Date>;
  geaendert_am: Generated<Date>;
}

export interface EssenMitgliedTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  planung_id: number;
  name: string;
  email: string | null;
  rolle: 'besitzer' | 'bearbeiten';
  token_hash: string | null;
  erstellt_am: Generated<Date>;
  link_gesendet_am: Date | null;
  entzogen_am: Date | null;
  /** The deletion date the owner was warned about (retention). */
  loeschwarnung_fuer: SqlDate | null;
}

export interface EssenTagTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  planung_id: number;
  datum: SqlDate;
}

export interface EssenMahlzeitTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  tag_id: number;
  position: number;
  name: string;
  /** `HH:MM`. */
  uhrzeit: string | null;
}

export interface EssenPlanungZutatTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  planung_id: number;
  /** null: an ingredient of the Planung's own. */
  zutat_id: number | null;
  name: string | null;
  kategorie_id: number | null;
  einheitenart: EssenEinheitenart | null;
  vegetarisch: boolean | null;
  vegan: boolean | null;
  /** Where it is bought; null: no shop yet. */
  geschaeft_id: Generated<number | null>;
  /** Only for ingredients of the Planung's own; central ones take the value of the list. */
  lebensmittel: Generated<boolean>;
}

export interface EssenPlanungZutatUnvertraeglichkeitTable {
  planung_zutat_id: number;
  unvertraeglichkeit_id: number;
}

export interface EssenGerichtTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  planung_id: number;
  name: string;
  personen: number;
  anleitung: Generated<string>;
  notiz: Generated<string>;
  /** JSON array of `{ titel, url }`. */
  links: Generated<string>;
  /** JSON array of names. */
  werkzeuge: Generated<string>;
}

export interface EssenGerichtZutatTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  gericht_id: number;
  position: number;
  planung_zutat_id: number;
  /** decimal(12, 3); null without an amount. */
  menge: number | null;
  einheit: GerichtEinheit | null;
  fest: Generated<boolean>;
  fuer_alles: boolean;
  fuer_vegetarisch: boolean;
  fuer_vegan: boolean;
  hinweis: Generated<string>;
}

export interface EssenGerichtZutatUnvertraeglichkeitTable {
  gericht_zutat_id: number;
  unvertraeglichkeit_id: number;
  /** false: „nicht für …“, true: „nur für …“. */
  nur: boolean;
}

export interface EssenEinplanungTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  mahlzeit_id: number;
  gericht_id: number;
  position: number;
  /** decimal(6, 3). */
  faktor: number;
  zustaendig_mitglied_id: number | null;
  zustaendig_text: Generated<string>;
  status: Generated<EinplanungStatus>;
}

export type EinplanungStatus = 'offen' | 'gekocht' | 'ausgelassen';

/** What a cooked dish used, per ingredient and unit. */
export interface EssenEinplanungVerbrauchTable {
  id: Generated<number>;
  einplanung_id: number;
  planung_zutat_id: number;
  /** decimal(12, 3), at least 0. */
  menge: number;
  einheit: GerichtEinheit;
}

export interface EssenPlanungGruppeTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  planung_id: number;
  position: number;
  name: string;
  /** decimal(4, 2). */
  faktor: number;
}

export interface EssenTeilnehmendeTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  planung_id: number;
  gruppe_id: number;
  ernaehrung: 'alles' | 'vegetarisch' | 'vegan';
  anzahl: number;
  von_mahlzeit_id: number | null;
  bis_mahlzeit_id: number | null;
  hinweis: Generated<string>;
}

export interface EssenTeilnehmendeUnvertraeglichkeitTable {
  teilnehmende_id: number;
  unvertraeglichkeit_id: number;
}

export interface EssenMahlzeitOhneGruppeTable {
  mahlzeit_id: number;
  gruppe_id: number;
}

export interface EssenGeschaeftTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  planung_id: number;
  position: number;
  name: string;
}

/** `essen.bestand` and `essen.zusatzbedarf`: an amount of an ingredient of the Planung. */
export interface EssenPostenTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  planung_id: number;
  planung_zutat_id: number;
  /** decimal(12, 3). */
  menge: number;
  einheit: GerichtEinheit;
  hinweis: Generated<string>;
}

/** `essen.zusatzbedarf`: like the stock, but an amount is optional („Kochhandschuhe“). */
export interface EssenZusatzbedarfTable extends Omit<EssenPostenTable, 'menge' | 'einheit'> {
  /** decimal(12, 3); null with `einheit` null. */
  menge: number | null;
  einheit: GerichtEinheit | null;
}

export interface EssenAenderungTable {
  /** bigint; the driver reads it as a string. */
  id: Generated<string>;
  planung_id: number;
  seq: ColumnType<string, string | number, never>;
  at: Generated<Date>;
  mitglied_id: number | null;
  aktion: string;
  /** JSON object. */
  details: string;
}
