export {
  SAMMEL_SHOPS,
  getSammelShop,
  isSammelProductUrl,
} from '../../../api/lib/sammelbestellung-shops';
export type { SammelShop } from '../../../api/lib/sammelbestellung-shops';

/** Describes indicative shop availability without promising a particular variant. */
export function sammelAvailabilityLabel(value?: string): string {
  switch (value) {
    case 'available': return 'Laut Shop verfügbar';
    case 'unavailable': return 'Laut Shop nicht verfügbar';
    case 'preorder': return 'Vorbestellung / Nachlieferung';
    default: return 'Verfügbarkeit unbekannt';
  }
}
