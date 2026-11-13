import type { Generated } from 'kysely';
import type { ReadOnly, SqlDate } from './db-schema-types';

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
