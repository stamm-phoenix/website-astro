import { ApiError, fetchApi } from './api';
import type { Abrechnung, Kostenstelle } from './types';

interface StoreError {
  message: string;
  code?: string;
}

interface AbrechnungState {
  /** Per `<event id>|<Kostenstelle>`; an empty Kostenstelle means the one derived from the event. */
  data: Record<string, Abrechnung>;
  /** Keys currently loading. */
  loading: Record<string, boolean>;
  errors: Record<string, StoreError>;
}

interface KostenstellenState {
  data: Kostenstelle[] | null;
  loading: boolean;
  error: string | null;
}

export const abrechnungStore = $state<AbrechnungState>({ data: {}, loading: {}, errors: {} });

export const kostenstellenStore = $state<KostenstellenState>({
  data: null,
  loading: false,
  error: null,
});

function toStoreError(error: unknown): StoreError {
  return error instanceof ApiError
    ? { message: error.message, code: error.code }
    : { message: 'Die Daten konnten nicht geladen werden.' };
}

export function abrechnungKey(id: string, kostenstelle = ''): string {
  return `${id}|${kostenstelle}`;
}

const pending: Record<string, Promise<void>> = {};

/** Loads the overview of an Aktion; cached per Aktion and Kostenstelle unless `force` is set. */
export function fetchAbrechnung(
  id: string,
  kostenstelle = '',
  { force = false }: { force?: boolean } = {}
): Promise<void> {
  const key = abrechnungKey(id, kostenstelle);
  if (abrechnungStore.data[key] && !force) return Promise.resolve();
  const running = pending[key];
  if (running) return running;

  abrechnungStore.loading[key] = true;
  delete abrechnungStore.errors[key];

  const query = kostenstelle ? `?kostenstelle=${encodeURIComponent(kostenstelle)}` : '';
  const promise = (async () => {
    try {
      abrechnungStore.data[key] = await fetchApi<Abrechnung>(
        `/intern/abrechnung/${encodeURIComponent(id)}${query}`
      );
    } catch (error: unknown) {
      abrechnungStore.errors[key] = toStoreError(error);
    } finally {
      delete pending[key];
      delete abrechnungStore.loading[key];
    }
  })();
  pending[key] = promise;
  return promise;
}

let kostenstellenPromise: Promise<void> | null = null;

/** Loads all Kostenstellen from CampFlow, to pick one when the Aktion's title matches none. */
export function fetchKostenstellen({ force = false }: { force?: boolean } = {}): Promise<void> {
  if (kostenstellenStore.data && !force) return Promise.resolve();
  if (kostenstellenPromise) return kostenstellenPromise;

  kostenstellenStore.loading = true;
  kostenstellenStore.error = null;

  kostenstellenPromise = (async () => {
    try {
      kostenstellenStore.data = await fetchApi<Kostenstelle[]>('/intern/abrechnung/kostenstellen');
    } catch (error: unknown) {
      kostenstellenStore.error = toStoreError(error).message;
    } finally {
      kostenstellenPromise = null;
      kostenstellenStore.loading = false;
    }
  })();
  return kostenstellenPromise;
}
