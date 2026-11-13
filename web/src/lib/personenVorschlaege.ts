import type { CampflowMitglied, LeitendenKonto, Person } from '../../../api/lib/personen-model';

/** A suggested link of a leader's account to their CampFlow person; `row` is the saved person. */
export interface VorschlagAngebot {
  konto: LeitendenKonto;
  mitglied: CampflowMitglied;
  row: Person | undefined;
}

export interface VorschlaegeErgebnis {
  saved: number;
  failed: number;
}

export type SendPerson = (
  method: 'PATCH' | 'POST',
  url: string,
  body: Record<string, unknown>
) => Promise<unknown>;

/** The accounts that have a suggestion, with the person saved for them. */
export function vorschlagAngebote(
  konten: LeitendenKonto[],
  vorschlaege: Map<string, CampflowMitglied>,
  byLogin: Map<string, Person>
): VorschlagAngebot[] {
  return konten.flatMap((konto) => {
    const mitglied = vorschlaege.get(konto.login);
    return mitglied ? [{ konto, mitglied, row: byLogin.get(konto.login) }] : [];
  });
}

/** Saves every suggestion one by one; one that fails leaves the others saved. */
export async function speichereVorschlaege(
  angebote: VorschlagAngebot[],
  send: SendPerson
): Promise<VorschlaegeErgebnis> {
  let saved = 0;
  let failed = 0;
  for (const { konto, mitglied, row } of angebote) {
    const input = {
      name: konto.name,
      login: konto.login,
      gruppe: 'leitende',
      campflowPersonId: mitglied.id,
      aktiv: true,
    };
    try {
      if (row)
        await send('PATCH', `/intern/pflege/personen/${row.id}`, { ...input, etag: row.etag });
      else await send('POST', '/intern/pflege/personen', input);
      saved++;
    } catch {
      failed++;
    }
  }
  return { saved, failed };
}

export function vorschlaegeMeldung({ saved, failed }: VorschlaegeErgebnis): string {
  return failed === 0
    ? `${saved} ${saved === 1 ? 'Vorschlag' : 'Vorschläge'} übernommen.`
    : `${saved} übernommen, ${failed} nicht gespeichert. Bitte die übrigen einzeln verknüpfen.`;
}
