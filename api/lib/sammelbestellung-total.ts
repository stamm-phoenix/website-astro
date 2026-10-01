import type { SammelArtikel } from './sammelbestellung-model';
import { sammelReceipt } from './sammelbestellung-export';
import { getShopProduct, shopProductUrl } from './sammelbestellung-product';
import { ValidationError } from './pflege-validation';

/** Resolve the complete active article total; missing prices must never become a partial charge. */
export async function getSammelAutomaticTotal(items: SammelArtikel[]): Promise<number> {
  const prices: Record<string, number | null> = {};
  const references = [
    ...new Set(items.filter((item) => !item.excluded).map((item) => item.reference.trim())),
  ];
  let index = 0;
  let incomplete = false;
  await Promise.all(
    Array.from({ length: Math.min(4, references.length) }, async () => {
      while (!incomplete && index < references.length) {
        const reference = references[index++];
        try {
          prices[reference] = (await getShopProduct(shopProductUrl(reference))).unitPriceCents;
        } catch {
          prices[reference] = null;
        }
        const price = prices[reference];
        if (price === null || !Number.isSafeInteger(price) || price < 0) incomplete = true;
      }
    })
  );
  const total = sammelReceipt(items, prices).totalCents;
  if (total === null || !Number.isSafeInteger(total) || total > 10_000_000)
    throw new ValidationError({
      totalCents:
        'Die Artikelpreise sind nicht vollständig verfügbar. Bitte den Gesamtbetrag einschließlich Versand selbst eintragen.',
    });
  return total;
}
