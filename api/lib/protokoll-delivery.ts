/** The stored mailing state of minutes. */
import { z } from 'zod';
import type { ProtokollDelivery } from './protokolle';

const unknownDelivery = (): ProtokollDelivery => ({
  state: 'attempted',
  recipients: 0,
  at: '',
  by: '',
});

const deliverySchema = z
  .object({
    state: z.enum(['attempted', 'sent']).catch('attempted'),
    recipients: z.number().catch(0),
    at: z.string().catch(''),
    by: z.string().catch(''),
  })
  .catch(unknownDelivery);

/** Reads the stored mailing state; unreadable values count as an unknown attempt. */
export function parseDelivery(value: string | undefined): ProtokollDelivery | null {
  if (!value) return null;
  try {
    return deliverySchema.parse(JSON.parse(value));
  } catch {
    return unknownDelivery();
  }
}
