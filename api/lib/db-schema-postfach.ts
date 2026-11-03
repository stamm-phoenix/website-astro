import type { Generated } from 'kysely';

/** Who is responsible for a conversation of a mailbox (`postfach.zustaendigkeit`, migration 0080). */
export interface PostfachZustaendigkeitTable {
  postfach: string;
  konversation_id: string;
  login: string;
  name: string;
  von_login: string;
  von_name: string;
  betreff: Generated<string>;
  am: Generated<Date>;
}

/** Whether a conversation is done or needs nothing (`postfach.erledigung`, migration 0081). */
export interface PostfachErledigungTable {
  postfach: string;
  konversation_id: string;
  status: 'erledigt' | 'kein_handlungsbedarf';
  login: string;
  name: string;
  betreff: Generated<string>;
  am: Generated<Date>;
}

/** A message a person has marked as read or unread in the Leitendenbereich (`postfach.gelesen`). */
export interface PostfachGelesenTable {
  postfach: string;
  user_id: string;
  nachricht_id: string;
  /** false: marked as unread on purpose, also before `gelesen_bis`. */
  gelesen: Generated<boolean>;
  am: Generated<Date>;
}

/** Everything received up to `gelesen_bis` counts as read for the person (`postfach.leser`). */
export interface PostfachLeserTable {
  postfach: string;
  user_id: string;
  login: string;
  gelesen_bis: Date;
}
