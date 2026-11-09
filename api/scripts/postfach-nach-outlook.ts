/**
 * One-time move of the module „E-Mail“ to Outlook (`docs/postfaecher.md`): writes the
 * responsibilities and the done marks the website kept in Azure SQL (`postfach.zustaendigkeit`,
 * `postfach.erledigung`) as categories and flags into the mailboxes.
 *
 * - A person becomes the category `👤 <Name>`; the conversation gets the flag
 *   („Handlungsbedarf“), unless it is done.
 * - „Erledigt“ and „Kein Handlungsbedarf“ become a completed flag, unless a newer message arrived
 *   after the mark.
 * - What Outlook already has wins: a conversation with a flag or a person category stays as it is.
 *
 * Reads the database with the Azure CLI login and changes the mailboxes with the app registration
 * (certificate in `AZURE_CLIENT_CERT`, which needs `Mail.ReadWrite` on the mailboxes). Without
 * `--schreiben` it only lists what it would change.
 *
 *   bun scripts/postfach-nach-outlook.ts
 *   bun scripts/postfach-nach-outlook.ts --schreiben
 */
import { AzureCliCredential } from '@azure/identity';
import { CONFIG } from '../lib/config';
import { getDb, useDatabase } from '../lib/db';
import { aenderungen } from '../lib/postfach-aenderung';
import { readKonversationStand } from '../lib/postfach-graph';
import { POSTFAECHER } from '../lib/postfach-liste';
import { kategorieFuer, sekunde, standAus, type PostfachStatus } from '../lib/postfach-model';
import { kategorieAnlegen, schreibeAenderungen } from '../lib/postfach-schreiben';

interface Alt {
  name: string | null;
  erledigtBis: Date | null;
}

async function altStand(postfach: string): Promise<Map<string, Alt>> {
  const db = getDb();
  const [zustaendig, erledigt] = await Promise.all([
    db
      .selectFrom('postfach.zustaendigkeit')
      .select(['konversation_id', 'name'])
      .where('postfach', '=', postfach)
      .execute(),
    db
      .selectFrom('postfach.erledigung')
      .select(['konversation_id', 'am', 'bis'])
      .where('postfach', '=', postfach)
      .execute(),
  ]);
  const alt = new Map<string, Alt>();
  for (const row of zustaendig) alt.set(row.konversation_id, { name: row.name, erledigtBis: null });
  for (const row of erledigt) {
    const eintrag = alt.get(row.konversation_id) ?? { name: null, erledigtBis: null };
    alt.set(row.konversation_id, { ...eintrag, erledigtBis: row.bis ?? row.am });
  }
  return alt;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--schreiben'))
    throw new Error('Usage: bun scripts/postfach-nach-outlook.ts [--schreiben]');
  const schreiben = args.includes('--schreiben');
  if (CONFIG.database.server === CONFIG.database.previewServer)
    throw new Error('Only for the production database');
  const close = useDatabase({
    server: CONFIG.database.server,
    database: CONFIG.database.name,
    authentication: { type: 'token-credential', options: { credential: new AzureCliCredential() } },
  });
  try {
    for (const postfach of POSTFAECHER) {
      const alt = await altStand(postfach.id);
      let geaendert = 0;
      for (const [konversation, { name, erledigtBis }] of alt) {
        const { nachrichten, vollstaendig } = await readKonversationStand(
          postfach.address,
          konversation
        );
        if (!nachrichten.length) continue;
        if (!vollstaendig) {
          console.log(`${postfach.id} ${konversation}: zu lang, bitte in Outlook setzen`);
          continue;
        }
        const jetzt = standAus(nachrichten, []);
        const neueste = nachrichten.reduce((a, b) => (b.am > a.am ? b : a));
        const erledigt =
          erledigtBis !== null && sekunde(erledigtBis.toISOString()) >= sekunde(neueste.am);
        const status: PostfachStatus | undefined =
          jetzt.status !== 'neu'
            ? undefined
            : erledigt
              ? 'erledigt'
              : name
                ? 'handlungsbedarf'
                : undefined;
        const kategorie =
          name && !jetzt.zustaendig ? kategorieFuer({ login: '', name }) : undefined;
        const plan = aenderungen(nachrichten, { status, kategorie });
        if (!plan.length) continue;
        geaendert++;
        console.log(
          `${postfach.id} „${neueste.betreff}“: ${status ?? 'Stand bleibt'}, ${kategorie ?? 'Person bleibt'} (${plan.length} Nachrichten)`
        );
        if (!schreiben) continue;
        if (kategorie) await kategorieAnlegen(postfach.address, kategorie);
        await schreibeAenderungen(postfach.address, plan);
      }
      console.log(
        `${postfach.id}: ${geaendert} von ${alt.size} Konversationen ${schreiben ? 'geändert' : 'würden geändert'}`
      );
    }
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
