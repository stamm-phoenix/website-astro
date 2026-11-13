/**
 * People mentioned with `@` in the minutes of the editor (#547, `docs/protokoll-editor.md`).
 * Writing a mention tells nobody; the approval sends each mentioned person one note through
 * `sendLeitendenMail` (login and linked CampFlow address) with the agenda items naming them.
 */
import type { MdToken } from './protokoll-markdown';
import {
  MARKED_OPTIONS,
  erwaehnungenIn,
  markdownTree,
  normalizeBullets,
} from './protokoll-markdown';
import type { ProtokollInhalt, ProtokollPunkt } from './protokoll-editor-model';
import { punktNummer } from './protokoll-editor-inhalt';
import { loadEditorPersonen } from './protokoll-editor-personen';
import { sendProtokollErwaehnungMail } from './protokoll-mails';
import { CONFIG } from './config';

/** Notes sent by one approval at most; more people are not notified. */
export const MAX_ERWAEHNUNG_MAILS = 40;

export interface ProtokollErwaehnung {
  login: string;
  name: string;
  /** The agenda items naming the person, e.g. „2a. Sommerlager“, in their order. */
  punkte: string[];
}

type Lex = (text: string) => MdToken[];

/** The text of an agenda item as tokens; `marked` is loaded on first use. */
async function loadLexer(): Promise<Lex> {
  const { Lexer } = await import('marked');
  return (text) => new Lexer(MARKED_OPTIONS).lex(normalizeBullets(text)) as unknown as MdToken[];
}

/** Everyone mentioned in the texts of the items, once per login, in the order of the minutes. */
export async function protokollErwaehnungen(
  inhalt: ProtokollInhalt
): Promise<ProtokollErwaehnung[]> {
  const lex = await loadLexer();
  const result = new Map<string, ProtokollErwaehnung>();
  const add = (punkt: ProtokollPunkt, nummer: string): void => {
    if (!punkt.text.includes('](')) return;
    const label = `${nummer} ${punkt.titel.trim() || 'Ohne Titel'}`;
    for (const { login, name } of erwaehnungenIn(markdownTree(lex(punkt.text)))) {
      const key = login.toLowerCase();
      const known = result.get(key);
      if (!known) result.set(key, { login, name, punkte: [label] });
      else if (!known.punkte.includes(label)) known.punkte.push(label);
    }
  };
  inhalt.punkte.forEach((punkt, index) => {
    add(punkt, punktNummer(index));
    punkt.unterpunkte.forEach((sub, subIndex) => add(sub, punktNummer(index, subIndex)));
  });
  return [...result.values()];
}

/** Looking up who may be notified, as an object so tests can replace it. */
export const erwaehnungPersonen = {
  /** Logins (lower case) of the people one can pick in the minutes. */
  logins: async (): Promise<Set<string>> => {
    const { personen } = await loadEditorPersonen();
    return new Set(personen.filter((p) => p.login).map((p) => p.login.trim().toLowerCase()));
  },
};

export interface ErwaehnungBenachrichtigung {
  inhalt: ProtokollInhalt;
  title: string;
  date: string;
  /** Login of the approver, who is not told about their own mentions. */
  approvedBy: string;
  url: string;
}

/**
 * Notes to everyone mentioned in approved minutes. Only people one can pick in the minutes are
 * notified, so a hand-written `person:` link sends no mail to someone outside the Stamm; the
 * approver is left out. Best effort: failures are reported through `warn` and never undo the
 * approval.
 * @returns How many notes were sent.
 */
export async function benachrichtigeErwaehnte(
  input: ErwaehnungBenachrichtigung,
  warn: (message: string, error?: unknown) => void
): Promise<number> {
  if (!CONFIG.protokolle.sender) return 0;
  const approver = input.approvedBy.trim().toLowerCase();
  const erwaehnt = (await protokollErwaehnungen(input.inhalt)).filter(
    (person) => person.login.toLowerCase() !== approver
  );
  if (erwaehnt.length === 0) return 0;
  let logins: Set<string>;
  try {
    logins = await erwaehnungPersonen.logins();
  } catch (error: unknown) {
    warn('[protokoll-editor] Erwähnte Personen konnten nicht geprüft werden', error);
    return 0;
  }
  const empfaenger = erwaehnt.filter((person) => logins.has(person.login.toLowerCase()));
  const unbekannt = erwaehnt.length - empfaenger.length;
  if (unbekannt > 0) warn(`[protokoll-editor] ${unbekannt} Erwähnte ohne bekannten Login`);
  if (empfaenger.length > MAX_ERWAEHNUNG_MAILS) {
    warn(
      `[protokoll-editor] Nur ${MAX_ERWAEHNUNG_MAILS} von ${empfaenger.length} Erwähnten benachrichtigt`
    );
  }
  const results = await Promise.allSettled(
    empfaenger.slice(0, MAX_ERWAEHNUNG_MAILS).map((person) =>
      sendProtokollErwaehnungMail({
        to: person.login,
        title: input.title,
        date: input.date,
        punkte: person.punkte,
        approvedBy: input.approvedBy,
        url: input.url,
      })
    )
  );
  for (const result of results) {
    if (result.status === 'rejected') {
      warn('[protokoll-editor] Mail an eine erwähnte Person fehlgeschlagen', result.reason);
    }
  }
  return results.filter((result) => result.status === 'fulfilled').length;
}
