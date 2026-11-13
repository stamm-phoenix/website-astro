/** Lists of the Leitendenbereich: Gruppenstunden, Leitende, downloads and the photo library. */
import type { GruppenstundenException } from '../../../../api/lib/gruppenstunden-exception-model';
import type { StaffLeitende } from '../../../../api/lib/leitende-list';
import type { GruppenstundeLeitende } from './oeffentlich';

/** A Gruppenstunde as edited in the Leitendenbereich. */
export interface StaffGruppenstunde {
  id: string;
  /** Version of the item as loaded; sent back on save to detect concurrent changes. */
  etag: string;
  stufe: string;
  weekday: string;
  time: string;
  ageRange: string;
  location: string;
  /** Formatted description (a small subset of HTML). */
  description: string;
  leitende: GruppenstundeLeitende[];
  exception?: GruppenstundenException | null;
}

export interface StaffGruppenstundenData {
  items: StaffGruppenstunde[];
  /** Stufen a Gruppenstunde can belong to (Team values of the Leitende list). */
  stufen: string[];
  weekdays: string[];
}

export interface StaffLeitendeData {
  items: StaffLeitende[];
  teams: string[];
}

export interface StaffDownload {
  id: string;
  fileName: string;
  size: number;
  mimeType: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
  hasPreview: boolean;
  category: string;
  /** Version for renaming and deleting. */
  etag: string;
}

/** Folder an upload goes to, created by the API if missing. */
export interface FotoTarget {
  path: string;
  webUrl: string;
}
