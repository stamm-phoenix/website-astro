import { fileContentVersion } from '../lib/protokoll-content-version';
/**
 * Run during the protocol cutover (old writers stopped). Requires Azure CLI Graph and SQL access.
 * --plan is read-only; --import copies; --verify checks; --cleanup --sql-live clears only verified
 * legacy values after deploying the SQL version. Never deletes files or library columns.
 */
import { AzureCliCredential } from '@azure/identity';
import { Client, ResponseType } from '@microsoft/microsoft-graph-client';
import { CONFIG } from '../lib/config';
import { getDb, useDatabase } from '../lib/db';
import { importProtokollMetadata, verifyProtokollImport } from '../lib/protokoll-import';
import { PROTOKOLL_FIELD_NAMES, workflowFields } from '../lib/protokoll-metadata';
import { isProtokollFile } from '../lib/protokolle';
import type { ProtokollDriveItem } from '../lib/protokolle';

async function main(): Promise<void> {
  const [mode, confirmation, ...extra] = process.argv.slice(2);
  if (
    !['--check', '--plan', '--import', '--verify', '--cleanup'].includes(mode) ||
    extra.length ||
    (confirmation && confirmation !== '--sql-live') ||
    (mode === '--cleanup' && confirmation !== '--sql-live')
  )
    throw new Error(
      'Usage: bun scripts/protokoll-migrate.ts --plan|--import|--verify|--cleanup [--sql-live]'
    );
  if (CONFIG.database.server === CONFIG.database.previewServer)
    throw new Error('Never copy live metadata to a preview');
  const credential = new AzureCliCredential();
  const client = Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () =>
        (await credential.getToken('https://graph.microsoft.com/.default')).token,
    },
  });
  const close = useDatabase({
    server: CONFIG.database.server,
    database: CONFIG.database.name,
    authentication: { type: 'token-credential', options: { credential } },
  });
  try {
    if (mode === '--check') {
      const marker = await getDb()
        .selectFrom('organisation.protokoll_import')
        .select('drive_id')
        .where('drive_id', '!=', '*preview*')
        .executeTakeFirst();
      if (!marker) throw new Error('Import required before production deployment');
      console.log(JSON.stringify({ scope: 'protocol-migration', ready: true }));
      return;
    }
    const site = `https://graph.microsoft.com/v1.0/sites/${CONFIG.sharepoint.site.hostName},${CONFIG.sharepoint.site.id}`;
    const drives = (await client.api(`${site}/drives`).get()) as {
      value: { id: string; name: string }[];
    };
    const drive = drives.value.find((item) => item.name === CONFIG.protokolle.library);
    if (!drive) throw new Error('Protocol library missing');
    const drivePath = `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(drive.id)}`;
    const read = async (): Promise<ProtokollDriveItem[]> => {
      let next: string | undefined =
        `${drivePath}/root:/${CONFIG.protokolle.folderPath.split('/').map(encodeURIComponent).join('/')}:/children?$expand=listItem($expand=fields)`;
      const items: ProtokollDriveItem[] = [];
      const seen = new Set<string>();
      while (next) {
        if (!next.startsWith(drivePath + '/') || seen.has(next))
          throw new Error('Invalid Graph pagination');
        seen.add(next);
        const page = (await client.api(next).get()) as {
          value: ProtokollDriveItem[];
          '@odata.nextLink'?: string;
        };
        items.push(...page.value);
        next = page['@odata.nextLink'];
      }
      return items.filter((item) => isProtokollFile(item, CONFIG.protokolle.folderPath));
    };
    const items = await read();
    const count = items.filter(
      (item) => Object.keys(workflowFields(item.listItem?.fields)).length
    ).length;
    console.log(
      JSON.stringify({
        scope: 'protocol-migration',
        mode,
        files: items.length,
        withMetadata: count,
      })
    );
    if (mode === '--plan') return;
    if (mode === '--import') {
      for (const item of items) {
        if (!Object.keys(workflowFields(item.listItem?.fields)).length) continue;
        const bytes = (await client
          .api(`${drivePath}/items/${encodeURIComponent(item.id)}/content`)
          .responseType(ResponseType.ARRAYBUFFER)
          .get()) as ArrayBuffer;
        const fresh = (await client
          .api(`${drivePath}/items/${encodeURIComponent(item.id)}?$expand=listItem($expand=fields)`)
          .get()) as ProtokollDriveItem;
        if (fresh.cTag !== item.cTag || fresh.listItem?.eTag !== item.listItem?.eTag)
          throw new Error('Source changed while importing');
        item.contentVersion = fileContentVersion(new Uint8Array(bytes), item.name);
      }
      await importProtokollMetadata(drive.id, items);
    }
    await verifyProtokollImport(drive.id, await read());
    if (mode === '--cleanup') {
      for (const item of items) {
        const fields = workflowFields(item.listItem?.fields);
        if (!Object.keys(fields).length) continue;
        // Re-read immediately before deletion. Any concurrent source edit blocks the whole item.
        const fresh = (await client
          .api(`${drivePath}/items/${encodeURIComponent(item.id)}?$expand=listItem($expand=fields)`)
          .get()) as ProtokollDriveItem;
        await verifyProtokollImport(drive.id, [fresh]);
        const snapshot = await getDb()
          .selectFrom('organisation.protokoll')
          .select('legacy_fields')
          .where('drive_id', '=', drive.id)
          .where('item_id', '=', item.id)
          .executeTakeFirstOrThrow();
        if (!snapshot.legacy_fields || !fresh.listItem?.eTag)
          throw new Error('Missing verified source version');
        const clear = Object.fromEntries(
          PROTOKOLL_FIELD_NAMES.filter((key) => Object.hasOwn(fields, key)).map((key) => [
            key,
            null,
          ])
        );
        await client
          .api(`${drivePath}/items/${encodeURIComponent(item.id)}/listItem/fields`)
          .header('If-Match', fresh.listItem.eTag)
          .patch(clear);
      }
      const remaining = await read();
      if (remaining.some((item) => Object.keys(workflowFields(item.listItem?.fields)).length))
        throw new Error('Cleanup incomplete');
    }
    console.log(
      JSON.stringify({ scope: 'protocol-migration', verified: true, cleaned: mode === '--cleanup' })
    );
  } finally {
    await close();
  }
}
main().catch((error) => {
  console.error(
    JSON.stringify({
      scope: 'protocol-migration',
      failed: true,
      error: error instanceof Error ? error.name : 'unknown',
    })
  );
  process.exitCode = 1;
});
