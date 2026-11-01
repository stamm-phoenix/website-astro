<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { confirmAction } from '../../lib/confirm';
  import { kochMenge } from '../../lib/essensplanungRechnung';
  import type { PostenArt } from '../../../../api/lib/essen-einkauf-model';
  import type { ZusatzPosten } from '../../lib/types';
  import { KNOPF } from './einkaufHerkunft.svelte';
  import type { PlanKontext } from './planKontext';

  /** The extra needs or the stock before the Aktion, as a dense list to change and remove. */

  interface Props {
    kontext: PlanKontext;
    art: PostenArt;
    titel: string;
    eintraege: ZusatzPosten[];
    leer: string;
    /** Opens the dialog of an entry; null adds one. */
    onbearbeiten: (id: number | null) => void;
  }
  let { kontext, art, titel, eintraege, leer, onbearbeiten }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const bearbeiten = $derived(ansicht.zugang !== 'lesen' && !ansicht.wartung);
  const zutaten = $derived(new Map(ansicht.zutaten.map((z) => [z.id, z])));

  function menge(posten: ZusatzPosten): string {
    const zutat = zutaten.get(posten.planungZutatId);
    return posten.menge === null || posten.einheit === null
      ? ''
      : kochMenge(posten.menge, posten.einheit, zutat?.abtropfgewicht);
  }

  /** „2 kg Salz“; extra needs without an amount by name only, „Kochhandschuhe“. */
  function postenText(posten: ZusatzPosten): string {
    const name = zutaten.get(posten.planungZutatId)?.name ?? 'Zutat';
    return [menge(posten), name].filter(Boolean).join(' ');
  }

  async function loeschen(posten: ZusatzPosten): Promise<void> {
    const text = postenText(posten);
    if (
      !(await confirmAction({
        title: `${text} entfernen?`,
        message:
          art === 'bestand'
            ? 'Der Bestand wird nicht mehr von der Einkaufsliste abgezogen.'
            : 'Die Einkaufsliste enthält es dann nicht mehr.',
        confirmLabel: 'Entfernen',
      }))
    )
      return;
    await kontext.aendern(
      () =>
        kontext.api.senden(
          'DELETE',
          `/${art === 'bestand' ? 'bestand' : 'zusatzbedarf'}/${posten.id}`,
          undefined,
          posten.etag
        ),
      `${text} entfernt.`
    );
  }
</script>

<section aria-labelledby="{art}-heading" class="space-y-1 print:hidden">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h3 id="{art}-heading" class="font-serif text-lg font-bold text-brand-900">{titel}</h3>
    {#if bearbeiten}
      <ActionButton type="button" class={KNOPF} onclick={() => onbearbeiten(null)}
        >{titel} eintragen</ActionButton
      >
    {/if}
  </div>
  {#if eintraege.length}
    <ul class="divide-y divide-neutral-200 border-y border-neutral-300 text-sm" aria-label={titel}>
      {#each eintraege as posten (posten.id)}
        <li class="flex items-center gap-2 py-0.5">
          <span class="w-20 shrink-0 text-right font-semibold whitespace-nowrap tabular-nums"
            >{menge(posten)}</span
          >
          <span class="min-w-0 flex-1 hyphens-auto [overflow-wrap:break-word]">
            {zutaten.get(posten.planungZutatId)?.name ?? 'Zutat'}
            {#if posten.hinweis}<span class="text-xs text-neutral-700">· {posten.hinweis}</span
              >{/if}
          </span>
          {#if bearbeiten}
            <span class="flex shrink-0 gap-1">
              <ActionButton
                type="button"
                class={KNOPF}
                aria-label="{postenText(posten)} ändern"
                onclick={() => onbearbeiten(posten.id)}>Ändern</ActionButton
              >
              <ActionButton
                type="button"
                variant="danger"
                class={KNOPF}
                disabled={kontext.busy}
                aria-label="{postenText(posten)} entfernen"
                onclick={() => void loeschen(posten)}>Entfernen</ActionButton
              >
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="text-sm text-neutral-700">{leer}</p>
  {/if}
</section>
