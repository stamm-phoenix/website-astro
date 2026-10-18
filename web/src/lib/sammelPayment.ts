import type { SammelPaymentSummary, SammelStatus } from './types';
import type { StatusTone } from './status';

interface PaymentLabel {
  label: string;
  tone: StatusTone;
}

/** The same payment state always gets the same text and warning, even if a reference exists. */
export function paymentSummary(
  payment: Pick<SammelPaymentSummary, 'state' | 'requestSentAt'> | null | undefined
): PaymentLabel {
  if (!payment) return { label: 'Noch kein CampFlow-Beitrag angelegt', tone: 'neutral' };
  switch (payment.state) {
    case 'attempted':
    case 'uncertain':
      return { label: 'Ergebnis unklar. Bitte in CampFlow prüfen.', tone: 'warning' };
    case 'prepared':
      return { label: 'CampFlow-Beitrag vorbereitet', tone: 'neutral' };
    case 'created':
      return payment.requestSentAt
        ? { label: 'CampFlow-Beitrag angelegt. Versand manuell bestätigt.', tone: 'success' }
        : { label: 'CampFlow-Beitrag angelegt. Versand noch nicht bestätigt.', tone: 'warning' };
  }
}

/** An order's status is independent of its payment and delivery markers. */
export function orderStatusTone(status: SammelStatus): StatusTone {
  const tones: Record<SammelStatus, StatusTone> = {
    Eingereicht: 'neutral',
    Bestellt: 'neutral',
    Eingetroffen: 'success',
    Storniert: 'neutral',
  };
  return tones[status];
}
