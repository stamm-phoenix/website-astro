import type { Generated } from 'kysely';
import type { ReadOnly, SqlDate } from './db-schema-types';
import type { ProtokollEditorStatus, ProtokollRevisionReason } from './protokoll-editor-model';

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

export interface ProtokollCutoverTable {
  id: number;
  mode: 'frozen' | 'sql';
  sql_started: Generated<boolean>;
}
