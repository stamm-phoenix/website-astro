import type { Generated } from 'kysely';
import type { ReadOnly, SqlDate } from './db-schema-types';
import type { AnwesenheitStufeName } from './anwesenheit-model';

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
