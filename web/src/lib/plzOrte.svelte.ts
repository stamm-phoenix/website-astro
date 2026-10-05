// The Orte of every German Postleitzahl (`public/abrechnung/plz-orte.json`, built by
// `scripts/plz-orte.ts` from OpenPLZ/OpenStreetMap data). Loaded only when a Postleitzahl is
// entered on the page, as the file has about 70 KB.

export const plzOrteStore = $state<{ data: Record<string, string[]> | null; error: boolean }>({
  data: null,
  error: false,
});

let loading: Promise<void> | null = null;

/** Loads the table once; later calls return the same promise. */
export function loadPlzOrte(): Promise<void> {
  if (plzOrteStore.data) return Promise.resolve();
  loading ??= (async () => {
    try {
      const response = await fetch('/abrechnung/plz-orte.json');
      if (!response.ok) throw new Error(`plz-orte.json: ${response.status}`);
      plzOrteStore.data = (await response.json()) as Record<string, string[]>;
      plzOrteStore.error = false;
    } catch {
      plzOrteStore.error = true;
      loading = null;
    }
  })();
  return loading;
}

/**
 * The Ort of a Postleitzahl, empty if unknown or not loaded yet. With several Gemeinden the one
 * the person gave (`hint`) wins if it is among them, otherwise all are named.
 */
export function ortFuerPlz(plz: string, hint = ''): string {
  const orte = plzOrteStore.data?.[plz];
  if (!orte?.length) return '';
  const match = orte.find(
    (ort) => ort.toLocaleLowerCase('de') === hint.trim().toLocaleLowerCase('de')
  );
  return match ?? orte.join(' / ');
}
