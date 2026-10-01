import { getSammelStammProdukt } from './sammelbestellung-stamm';
import { getShopProduct, shopProductUrl } from './sammelbestellung-product';
import type { SammelProductInfo } from './sammelbestellung-model';

/** Validates stock IDs or shop URLs before reserving external lookup quota. */
export function sammelProductReference(value: unknown): string {
  if (typeof value === 'string' && getSammelStammProdukt(value)) return value.trim();
  return shopProductUrl(value);
}

/** Stock prices never depend on external requests or submitted price fields. */
export async function getSammelProduct(reference: string): Promise<SammelProductInfo> {
  const stock = getSammelStammProdukt(reference);
  if (stock)
    return {
      name: stock.name,
      imageUrl: stock.imageUrl,
      unitPriceCents: stock.unitPriceCents,
      sourceUrl: stock.reference,
      availability: 'unknown',
    };
  return getShopProduct(shopProductUrl(reference));
}
