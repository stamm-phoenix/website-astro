import { aufgabenAnzahl } from '../../../api/lib/protokoll-editor-inhalt';
import { erwaehnungenIn } from '../../../api/lib/protokoll-markdown';
import { parseProtokollMarkdown } from './protokollMarkdown';
import type {
  ProtokollFreigabeResponse,
  ProtokollInhalt,
} from '../../../api/lib/protokoll-editor-model';

/**
 * The names of the people mentioned in the minutes, once each and without the approving person,
 * for the approval dialog (#547). The server also leaves out logins it does not know.
 */
export function freigabeErwaehnte(inhalt: ProtokollInhalt, login: string): string[] {
  const self = login.trim().toLowerCase();
  const names = new Map<string, string>();
  for (const punkt of inhalt.punkte) {
    for (const item of [punkt, ...punkt.unterpunkte]) {
      if (!item.text.includes('](')) continue;
      for (const person of erwaehnungenIn(parseProtokollMarkdown(item.text))) {
        const key = person.login.toLowerCase();
        if (key !== self && !names.has(key)) names.set(key, person.name);
      }
    }
  }
  return [...names.values()];
}

/** What the page says after an approval: the filed PDF, the tasks and the notified people. */
export function freigabeMeldung(
  result: Partial<ProtokollFreigabeResponse>,
  fallbackName: string
): string {
  const teile = [
    `Freigegeben. „${result.fileName ?? fallbackName}“ liegt jetzt im Protokoll-Ordner.`,
  ];
  if (result.aufgaben) {
    teile.push(`${aufgabenAnzahl(result.aufgaben).replace(/^e/, 'E')} im Modul Aufgaben angelegt.`);
  }
  if (result.benachrichtigt) {
    teile.push(
      result.benachrichtigt === 1
        ? 'Eine erwähnte Person wurde benachrichtigt.'
        : `${result.benachrichtigt} erwähnte Personen wurden benachrichtigt.`
    );
  }
  return teile.join(' ');
}
