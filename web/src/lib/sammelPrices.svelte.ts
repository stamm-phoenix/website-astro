import { getSammelStammProdukt } from './sammelKatalog';
import type { SammelProductInfo } from './types';
interface PriceState {
  prices: Record<string, number | null>;
  availability: Record<string, string | undefined>;
  loading: boolean;
  errors: Record<string, boolean>;
}
interface PricePool {
  state: PriceState;
  reset: () => void;
  cancel: () => void;
  load: (
    references: string[],
    lookup: (reference: string) => Promise<SammelProductInfo | null>,
    missingOnly?: boolean
  ) => Promise<void>;
}
/** Four lookups at a time. A newer load/reset invalidates all results of the previous run. */
export function createSammelPrices(): PricePool {
  const state = $state<PriceState>({ prices: {}, availability: {}, loading: false, errors: {} });
  let revision = 0;
  function cancel(): void {
    revision++;
  }
  function reset(): void {
    cancel();
    state.prices = {};
    state.availability = {};
    state.errors = {};
    state.loading = false;
  }
  async function load(
    references: string[],
    lookup: (reference: string) => Promise<SammelProductInfo | null>,
    missingOnly = false
  ): Promise<void> {
    const current = ++revision;
    // A conflict reload can replace the references without resetting the price pool.
    // Drop removed entries as well as their errors, so re-added articles are looked up again.
    for (const cache of [state.prices, state.availability, state.errors]) {
      for (const reference of Object.keys(cache)) {
        if (!references.includes(reference)) delete cache[reference];
      }
    }
    // Temporary deduplication, never read by a reactive consumer.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const pending = [...new Set(references)].filter(
      (reference) =>
        !missingOnly ||
        (!getSammelStammProdukt(reference) && !Object.hasOwn(state.prices, reference))
    );
    state.loading = true;
    let index = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, pending.length) }, async () => {
        while (index < pending.length && current === revision) {
          const reference = pending[index++];
          let price: number | null = getSammelStammProdukt(reference)?.unitPriceCents ?? null;
          if (current === revision) delete state.errors[reference];
          try {
            const product = await lookup(reference);
            if (product) {
              price = product.unitPriceCents;
              if (current === revision) state.availability[reference] = product.availability;
            }
          } catch {
            if (current === revision) state.errors[reference] = true;
          }
          if (current === revision) state.prices = { ...state.prices, [reference]: price };
        }
      })
    );
    if (current === revision) state.loading = false;
  }
  return { state, reset, cancel, load };
}
