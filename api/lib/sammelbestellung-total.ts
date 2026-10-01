import type { SammelArtikel } from './sammelbestellung-model';
import { sammelReceipt } from './sammelbestellung-export';
import { getShopProduct, shopProductUrl } from './sammelbestellung-product';
import { ValidationError } from './pflege-validation';

/** Resolve the complete active article total; missing prices must never become a partial charge. */
export async function getSammelAutomaticTotal(items: SammelArtikel[]): Promise<number> {
  const prices: Record<string, number | null> = {};
  for (const reference of new Set(
    items.filter((item) => !item.excluded).map((item) => item.reference.trim())
  )) {
    try {
      prices[reference] = (await getShopProduct(shopProductUrl(reference))).unitPriceCents;
    } catch {
      prices[reference] = null;
    }
  }
  const total = sammelReceipt(items, prices).totalCents;
  if (total === null || !Number.isSafeInteger(total) || total > 10_000_000)
    throw new ValidationError({
      totalCents:
        'Die Artikelpreise sind nicht vollständig verfügbar. Bitte den Gesamtbetrag einschließlich Versand selbst eintragen.',
    });
  return total;
}
