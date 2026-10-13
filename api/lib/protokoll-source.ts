import { withProtokollMetadata } from './protokoll-metadata';
import { CONFIG } from './config';
import type { ProtokollDriveItem, StaffProtokoll } from './protokolle';
import { isProtokollFile, toStaffProtokoll } from './protokolle';
import { getSharePointDriveIdByName, getSharePointDriveItem } from './sharepoint-data-access';
import { withProtokollContentVersion } from './protokoll-content-version';

/** The library of the minutes, or undefined if the site has no such library. */
export async function findDrive(): Promise<string | undefined> {
  return CONFIG.protokolle.library
    ? getSharePointDriveIdByName(CONFIG.protokolle.library)
    : undefined;
}

export async function loadProtokoll(
  driveId: string,
  id: string,
  content: 'metadata' | 'stored-version' | 'current-version' = 'metadata'
): Promise<{ item: ProtokollDriveItem; protokoll: StaffProtokoll } | undefined> {
  const raw = (await getSharePointDriveItem(driveId, id)) as ProtokollDriveItem | undefined;
  // Other files of the library are not touched, even with a valid ID
  if (!raw || !isProtokollFile(raw, CONFIG.protokolle.folderPath)) return undefined;
  const stored = await withProtokollMetadata(driveId, raw);
  const item =
    content === 'metadata'
      ? stored
      : await withProtokollContentVersion(driveId, stored, content === 'current-version');
  return { item, protokoll: toStaffProtokoll(item) };
}
