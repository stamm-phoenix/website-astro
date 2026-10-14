import { protokollMigrationFailure } from '../lib/protokoll-migration-errors';
import { assertProtokollDeployment, waitForProtokollDeployment } from '../lib/protokoll-deployment';
import { activateProtokolle, freezeProtokolle } from '../lib/protokoll-cutover';
import { writeProtokollSource } from '../lib/protokoll-restore';
import { assertProtokollSize } from '../lib/protokoll-text';
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
import { workflowFields } from '../lib/protokoll-metadata';
import { isProtokollFile } from '../lib/protokolle';
import type { ProtokollDriveItem } from '../lib/protokolle';

async function main(): Promise<void> {
  const [mode, confirmation, ...extra] = process.argv.slice(2);
  if (
    ![
      '--check',
      '--plan',
      '--freeze',
      '--import',
      '--verify',
      '--activate',
      '--restore',
      '--cleanup',
    ].includes(mode) ||
    extra.length ||
    (confirmation && confirmation !== '--sql-live') ||
    (['--cleanup', '--restore'].includes(mode) && confirmation !== '--sql-live')
  )
    throw new Error(
      'Usage: bun scripts/protokoll-migrate.ts --check|--plan|--freeze|--import|--verify|--activate|--restore|--cleanup [--sql-live]'
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
    if (mode === '--freeze') {
      await freezeProtokolle();
      console.log(JSON.stringify({ scope: 'protocol-migration', frozen: true }));
      return;
    }
    const state = await getDb()
      .selectFrom('organisation.protokoll_cutover')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    // Initial deployment retires the SharePoint writers with the SQL gate still closed.
    if (mode === '--check' && state.mode === 'frozen') {
      console.log(
        JSON.stringify({ scope: 'protocol-migration', frozen: true, activationRequired: true })
      );
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
    // A completion marker alone says nothing about later SharePoint edits.
    if (mode === '--check') {
      await verifyProtokollImport(drive.id, items);
      console.log(JSON.stringify({ scope: 'protocol-migration', verified: true }));
      return;
    }
    if (mode === '--import') {
      for (const item of items) {
        if (!Object.keys(workflowFields(item.listItem?.fields)).length) continue;
        assertProtokollSize(item.size);
        const bytes = (await client
          .api(`${drivePath}/items/${encodeURIComponent(item.id)}/content`)
          .responseType(ResponseType.ARRAYBUFFER)
          .get()) as ArrayBuffer;
        const fresh = (await client
          .api(`${drivePath}/items/${encodeURIComponent(item.id)}?$expand=listItem($expand=fields)`)
          .get()) as ProtokollDriveItem;
        if (fresh.cTag !== item.cTag || fresh.listItem?.eTag !== item.listItem?.eTag)
          throw new Error('Source changed while importing');
        assertProtokollSize(bytes.byteLength);
        item.contentVersion = fileContentVersion(new Uint8Array(bytes), item.name);
      }
      await importProtokollMetadata(drive.id, items);
    }
    if (mode === '--activate') {
      await waitForProtokollDeployment();
      await activateProtokolle(async () => {
        await verifyProtokollImport(drive.id, await read());
        await assertProtokollDeployment();
      });
    } else if (mode === '--cleanup' || mode === '--restore') {
      await writeProtokollSource(
        drive.id,
        items,
        {
          read: async (id) =>
            client
              .api(`${drivePath}/items/${encodeURIComponent(id)}?$expand=listItem($expand=fields)`)
              .get() as Promise<ProtokollDriveItem>,
          write: async (id, fields, etag) => {
            await client
              .api(`${drivePath}/items/${encodeURIComponent(id)}/listItem/fields`)
              .header('If-Match', etag)
              .patch(fields);
          },
        },
        mode === '--cleanup'
      );
    }
    await verifyProtokollImport(drive.id, await read());
    console.log(
      JSON.stringify({ scope: 'protocol-migration', verified: true, cleaned: mode === '--cleanup' })
    );
  } finally {
    await close();
  }
}
main().catch((error) => {
  console.error(JSON.stringify(protokollMigrationFailure(error)));
  process.exitCode = 1;
});
