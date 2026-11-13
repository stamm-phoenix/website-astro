import { MIN_BELEG_PHOTO_EDGE } from './belege';
import type { BelegCheck } from '../../../api/lib/beleg-check-model';

/**
 * What the check of a receipt's photo warns about, one sentence each: what the photo itself
 * showed (`warnings`, e.g. too dark), its size once cropped (`groesse`) and what the automatic
 * check found. Empty when all is well.
 */
export function pruefHinweise(
  check: BelegCheck | null,
  warnings: string[],
  groesse?: { width: number; height: number } | null
): string[] {
  const hinweise = [...warnings];
  const kante = groesse ? Math.max(groesse.width, groesse.height) : null;
  if (kante !== null && kante < MIN_BELEG_PHOTO_EDGE) {
    hinweise.push(
      `Das Foto ist klein (${kante} Pixel an der längeren Seite). Prüfe, ob Betrag, Datum und Geschäft gut lesbar sind.`
    );
  }
  if (check && !check.isReceipt) hinweise.push('Das Foto zeigt möglicherweise keinen Beleg.');
  if (check && !check.ok) {
    if (check.issues.length) hinweise.push(...check.issues);
    else {
      if (!check.complete) hinweise.push('Der Beleg ist nicht vollständig zu sehen.');
      if (!check.readable) hinweise.push('Der Beleg ist nicht gut lesbar.');
    }
  }
  if (check?.unsignedEigenbeleg) {
    hinweise.push(
      'Der Eigenbeleg ist nicht unterschrieben. Ohne Unterschrift lehnt die Kasse ihn ab.'
    );
  }
  if (check?.restrictedItems.length) {
    hinweise.push(`Diese Positionen prüft die Kasse: ${check.restrictedItems.join(', ')}.`);
  }
  return [...new Set(hinweise.map((hinweis) => hinweis.trim()).filter(Boolean))];
}
