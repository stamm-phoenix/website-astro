import type { SammelShop } from './sammelbestellung-shops';

/** Shared serializable shapes; this module has no browser or Node dependencies. */
export interface SammelArtikel {
  shop?: SammelShop;
  name: string;
  reference: string;
  variant: string;
  quantity: number;
}

export interface SammelKatalogArtikel {
  shop?: SammelShop;
  name: string;
  reference: string;
  variants: string[];
}

export interface SammelAktion {
  id: string;
  etag: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  catalog: SammelKatalogArtikel[];
  archived: boolean;
}

export const SAMMEL_STATUS = ['Eingereicht', 'Bestellt', 'Eingetroffen', 'Storniert'] as const;
export type SammelStatus = (typeof SAMMEL_STATUS)[number];

export interface SammelBestellung {
  id: string;
  etag: string;
  campaignId: string;
  name: string;
  email: string;
  items: SammelArtikel[];
  notes: string;
  status: SammelStatus;
  submitted: boolean;
  paid: boolean;
  delivered: boolean;
  totalCents: number | null;
}

export interface SammelMemberView {
  campaign: SammelAktion;
  order: SammelBestellung;
  canEdit: boolean;
}

export interface SammelSaveResult {
  confirmationMailSent: boolean;
}

export interface SammelProductInfo {
  name: string;
  imageUrl: string | null;
  unitPriceCents: number | null;
  sourceUrl: string;
}

export interface SammelStaffView {
  campaign: SammelAktion;
  invitationUrl: string;
  orders: SammelBestellung[];
}

/** Checks the inclusive start, exclusive end and archive lock of a campaign. */
export function isSammelOpen(campaign: SammelAktion, now = new Date()): boolean {
  return (
    !campaign.archived &&
    new Date(campaign.startsAt).getTime() <= now.getTime() &&
    now.getTime() < new Date(campaign.endsAt).getTime()
  );
}

/** Allows member edits only during an open campaign while the status remains Eingereicht. */
export function canEditSammelOrder(
  campaign: SammelAktion,
  order: SammelBestellung,
  now = new Date()
): boolean {
  return isSammelOpen(campaign, now) && order.status === 'Eingereicht';
}
