import type { ColumnType, Generated } from 'kysely';
import type { ReadOnly, SqlDate } from './db-schema-types';
import type {
  FaqTable,
  GruppenstundeTable,
  TeamTable,
  LeitendeTable,
  LeitendeTeamTable,
  ContentIdCounterTable,
  AktionStufeOptionTable,
  AktionTable,
  AktionStufeTable,
  AktionDownloadTable,
  InstagramTokenTable,
  DownloadTable,
  SharePointImportTable,
} from './db-schema-content';
import type { BelegTable, BelegCampflowTable } from './db-schema-beleg';
import type { MeetingTable, AttendanceTable } from './db-schema-anwesenheit';
import type {
  TaskProjectTable,
  TaskTemplateTable,
  TaskTable,
  ChecklistTable,
  TaskReminderDeliveryTable,
  TaskRecognitionTable,
} from './db-schema-aufgaben';
import type {
  ProtokollTable,
  ProtokollImportTable,
  ProtokollContentVersionTable,
  EditorProtokollTable,
  LeitendenrundeErinnerungTable,
  EditorSperreTable,
  EditorRevisionTable,
  ProtokollCutoverTable,
} from './db-schema-protokoll';
import type {
  PersonTable,
  AktionOhneZuschussTable,
  AktionKeineAktionTable,
  StaffFavoritesTable,
  StaffChangelogSeenTable,
  StaffRecentTable,
  StaffSettingsTable,
  AbrechnungEingabeTable,
} from './db-schema-staff';
import type {
  SammelCampaignTable,
  SammelCatalogItemTable,
  SammelCatalogVariantTable,
  SammelInvitationTable,
  SammelLinkQuotaTable,
  SammelOrderTable,
  SammelOrderItemTable,
  SammelPaymentTable,
  SammelPaymentEmailTable,
  SammelPaymentEventTable,
} from './db-schema-sammel';
import type {
  AbstimmungTable,
  AbstimmungOptionTable,
  AbstimmungTeilnahmeTable,
  AbstimmungStimmeTable,
} from './db-schema-abstimmung';
import type {
  EssenEinstellungenTable,
  EssenKatalogStandTable,
  EssenKategorieTable,
  EssenUnvertraeglichkeitTable,
  EssenZutatTable,
  EssenZutatUnvertraeglichkeitTable,
  EssenGerichtTable,
  EssenGerichtZutatTable,
  EssenGerichtZutatUnvertraeglichkeitTable,
} from './db-schema-essen-katalog';
import type {
  EssenAnlageAnfrageTable,
  EssenPlanungTable,
  EssenMitgliedTable,
  EssenLeitungLinkTable,
  EssenMitgliedGeoeffnetTable,
  EssenTagTable,
  EssenMahlzeitTable,
  EssenPlanungZutatTable,
  EssenPlanungZutatUnvertraeglichkeitTable,
  EssenEinplanungTable,
  EssenEinplanungVerbrauchTable,
  EssenPlanungGruppeTable,
  EssenTeilnehmendeTable,
  EssenTeilnehmendeUnvertraeglichkeitTable,
  EssenMahlzeitOhneGruppeTable,
} from './db-schema-essen-planung';
import type {
  EssenGeschaeftTable,
  EssenPostenTable,
  EssenPacklisteEintragTable,
  EssenPacklisteZuteilungTable,
  EssenBelegOrdnerLoeschenTable,
  EssenBelegOrdnerTable,
  EssenBelegTable,
  EssenZusatzbedarfTable,
  EssenEinkaufTable,
  EssenEinkaufPostenTable,
  EssenEinkaufRegelTable,
  EssenAenderungTable,
} from './db-schema-essen-einkauf';
import type { ProblemMeldungTable } from './db-schema-problem';
import type { BlogPostTable, BlogImageTable } from './db-schema-blog';
import type { ContentReviewTable } from './db-schema-content-review';
import type { StaffUsageTable } from './db-schema-staff-usage';
import type { InventarArtikelTable, InventarVarianteTable } from './db-schema-inventur';
import type { SchnupperAnfrageTable } from './db-schema-schnupper';
import type {
  PostfachErledigungTable,
  PostfachGelesenTable,
  PostfachLeserTable,
  PostfachZustaendigkeitTable,
} from './db-schema-postfach';

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
  'content.review': ContentReviewTable;
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
  'content.aktion_download': AktionDownloadTable;
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
  'organisation.inventar_artikel': InventarArtikelTable;
  'organisation.inventar_variante': InventarVarianteTable;
  'organisation.schnupper_anfrage': SchnupperAnfrageTable;
  'postfach.zustaendigkeit': PostfachZustaendigkeitTable;
  'postfach.erledigung': PostfachErledigungTable;
  'postfach.gelesen': PostfachGelesenTable;
  'postfach.leser': PostfachLeserTable;
  'organisation.aktion_ohne_zuschuss': AktionOhneZuschussTable;
  'organisation.aktion_keine_aktion': AktionKeineAktionTable;
  'organisation.staff_changelog_seen': StaffChangelogSeenTable;
  'organisation.staff_favorites': StaffFavoritesTable;
  'organisation.staff_usage': StaffUsageTable;
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
  'essen.katalog_stand': EssenKatalogStandTable;
  'essen.unvertraeglichkeit': EssenUnvertraeglichkeitTable;
  'essen.zutat': EssenZutatTable;
  'essen.zutat_unvertraeglichkeit': EssenZutatUnvertraeglichkeitTable;
  'problem.meldung': ProblemMeldungTable;
  'essen.anlage_anfrage': EssenAnlageAnfrageTable;
  'essen.planung': EssenPlanungTable;
  'essen.mitglied': EssenMitgliedTable;
  'essen.leitung_link': EssenLeitungLinkTable;
  'essen.mitglied_geoeffnet': EssenMitgliedGeoeffnetTable;
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
  'essen.einkauf': EssenEinkaufTable;
  'essen.einkauf_posten': EssenEinkaufPostenTable;
  'essen.einkauf_regel': EssenEinkaufRegelTable;
  'essen.packliste_eintrag': EssenPacklisteEintragTable;
  'essen.packliste_zuteilung': EssenPacklisteZuteilungTable;
  'essen.beleg': EssenBelegTable;
  'essen.beleg_ordner_loeschen': EssenBelegOrdnerLoeschenTable;
  'essen.beleg_ordner': EssenBelegOrdnerTable;
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

export interface SchemaMigrationTable {
  name: string;
  checksum: string;
  applied_at: Generated<Date>;
}
