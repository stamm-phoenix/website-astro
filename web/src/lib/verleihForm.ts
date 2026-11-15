import type { VerleihInput } from '../../../api/lib/verleih-model';
export interface VerleihFormPosition {
  varianteId: number;
  menge: number | undefined;
}
export interface VerleihForm extends Omit<VerleihInput, 'positionen'> {
  positionen: VerleihFormPosition[];
}
export interface VerleihEntwurf {
  anfrageId: string;
  positionen: VerleihFormPosition[];
}
/** Restore the list before native field values, including empty or not-yet-valid quantities. */
export function leseVerleihEntwurf(text: string): VerleihEntwurf | null {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object') return null;
    const { anfrageId, positionen } = value as Record<string, unknown>;
    if (
      typeof anfrageId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(anfrageId) ||
      !Array.isArray(positionen) ||
      !positionen.length ||
      positionen.length > 60
    )
      return null;
    const restored: VerleihFormPosition[] = [];
    for (const p of positionen) {
      if (!p || typeof p !== 'object') return null;
      const { varianteId, menge } = p as Record<string, unknown>;
      if (
        typeof varianteId !== 'number' ||
        !Number.isSafeInteger(varianteId) ||
        varianteId < 0 ||
        (menge !== undefined && (typeof menge !== 'number' || !Number.isFinite(menge)))
      )
        return null;
      restored.push({ varianteId, menge });
    }
    return { anfrageId, positionen: restored };
  } catch {
    return null;
  }
}
