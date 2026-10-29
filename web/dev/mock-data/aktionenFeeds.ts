import { aktionInStufeFeed, isStufeKey, STUFE_KEYS } from '../../../api/lib/aktion-stufen';
import { buildIcs, publicAktionen } from './content';

/** The calendar feed of a Stufe for `/api/aktionen/<stufe>.ics`, or `null` for an unknown Stufe. */
export function stufeFeed(stufe: string): { body: string; fileName: string } | null {
  if (!isStufeKey(stufe)) return null;
  return {
    body: buildIcs(
      publicAktionen().filter((aktion) => aktionInStufeFeed(aktion, stufe)),
      `DPSG Stamm Phoenix - ${STUFE_KEYS[stufe]}`
    ),
    fileName: `aktionen-${stufe}.ics`,
  };
}
