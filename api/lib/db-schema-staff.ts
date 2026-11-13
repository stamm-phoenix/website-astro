import type { Generated } from 'kysely';
import type { ReadOnly } from './db-schema-types';

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

export interface AbrechnungEingabeTable {
  user_id: string;
  event_id: string;
  login: string;
  session: string;
  delete_after: Date;
  updated_at: Generated<Date>;
  version: ReadOnly<Buffer>;
}
