import type { ColumnType, Generated } from 'kysely';
import type { ReadOnly } from './db-schema-types';

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

export interface GruppenstundeTable {
  exception_json: Generated<string | null>;
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
  meeting_point: Generated<string>;
  packing_list: Generated<string>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  updated_by: Generated<string>;
}

export interface AktionStufeTable {
  aktion_id: number;
  stufe: string;
}

export interface AktionDownloadTable {
  aktion_id: number;
  download_id: string;
  sort_order: number;
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
  /** Topic the public page filters by; `Allgemein` without an own one. */
  category: Generated<string>;
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
