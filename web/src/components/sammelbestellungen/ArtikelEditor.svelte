<script lang="ts">
  import FormField from '../pflege/FormField.svelte';
  import type { SammelArtikel, SammelKatalogArtikel } from '../../lib/types';

  interface Props {
    items: SammelArtikel[];
    catalog: SammelKatalogArtikel[];
    disabled?: boolean;
  }
  let { items = $bindable(), catalog, disabled = false }: Props = $props();
  function add(article?: SammelKatalogArtikel): void {
    items = [
      ...items,
      {
        name: article?.name ?? '',
        reference: article?.reference ?? '',
        variant: '',
        quantity: 1,
      },
    ];
  }
</script>

{#if catalog.length && !disabled}
  <section aria-labelledby="popular-heading" class="mb-8">
    <h2 id="popular-heading" class="font-serif text-xl text-brand-900">Häufig bestellt</h2>
    <p class="mt-1 text-sm text-neutral-700">
      Artikel auswählen und die passende Größe oder Variante unten eintragen.
    </p>
    <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each catalog as article (article)}
        <div class="rounded-lg border border-neutral-200 bg-white p-4">
          <h3 class="font-semibold text-brand-900">{article.name}</h3>
          {#if article.variants.length}<p class="mt-1 text-sm text-neutral-700">
              {article.variants.join(' · ')}
            </p>{/if}
          {#if article.reference.startsWith('https://')}
            <a
              class="mt-2 block text-sm font-semibold text-brand-800"
              href={article.reference}
              target="_blank"
              rel="noopener noreferrer">Details im Rüsthaus ↗</a
            >
          {/if}
          <button
            type="button"
            class="btn-secondary mt-3"
            disabled={items.length >= 40}
            onclick={() => add(article)}>Hinzufügen</button
          >
        </div>
      {/each}
    </div>
  </section>
{/if}

<section aria-labelledby="items-heading">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h2 id="items-heading" class="font-serif text-xl text-brand-900">Deine Artikel</h2>
    <a
      href="https://www.ruesthaus.de"
      target="_blank"
      rel="noopener noreferrer"
      class="font-semibold text-brand-800">Im Rüsthaus stöbern ↗</a
    >
  </div>
  <p class="mt-2 text-sm text-neutral-700">
    Du kannst das gesamte Rüsthaus-Sortiment angeben. Preise und Verfügbarkeit prüft das Team vor
    der Sammelbestellung.
  </p>
  {#if !items.length}<p
      class="mt-4 rounded-lg border border-dashed border-neutral-300 p-5 text-neutral-700"
    >
      Wähle einen häufigen Artikel oder füge einen anderen Rüsthaus-Artikel hinzu.
    </p>{/if}
  <div class="mt-4 space-y-4">
    {#each items as item, index (item)}
      <fieldset {disabled} class="rounded-lg border border-neutral-200 bg-white p-4">
        <legend class="px-2 text-sm font-semibold text-brand-800">Artikel {index + 1}</legend>
        <div class="grid gap-3 sm:grid-cols-2">
          <FormField id="article-name-{index}" label="Artikelname">
            {#snippet children(attrs)}<input
                {...attrs}
                class="form-input"
                maxlength="200"
                required
                bind:value={item.name}
              />{/snippet}
          </FormField>
          <FormField id="article-reference-{index}" label="Artikelnummer oder Rüsthaus-Link">
            {#snippet children(attrs)}<input
                {...attrs}
                class="form-input"
                maxlength="500"
                required
                bind:value={item.reference}
              />{/snippet}
          </FormField>
          <FormField id="article-variant-{index}" label="Größe / Farbe / Variante" optional>
            {#snippet children(attrs)}<input
                {...attrs}
                class="form-input"
                maxlength="120"
                bind:value={item.variant}
                list="variants-{index}"
              />
              <datalist id="variants-{index}"
                >{#each catalog.find((entry) => entry.reference === item.reference)?.variants ?? [] as variant, variantIndex (variantIndex)}<option
                    value={variant}
                  ></option>{/each}</datalist
              >{/snippet}
          </FormField>
          <FormField id="article-quantity-{index}" label="Anzahl">
            {#snippet children(attrs)}<input
                {...attrs}
                class="form-input"
                type="number"
                min="1"
                max="99"
                step="1"
                required
                bind:value={item.quantity}
              />{/snippet}
          </FormField>
        </div>
        {#if !disabled}<button
            type="button"
            class="mt-3 text-sm font-semibold text-[var(--color-dpsg-red)]"
            onclick={() => (items = items.filter((_, i) => i !== index))}
            aria-label="Artikel {index + 1} entfernen">Artikel entfernen</button
          >{/if}
      </fieldset>
    {/each}
  </div>
  {#if !disabled}<button
      type="button"
      class="btn-secondary mt-4"
      disabled={items.length >= 40}
      onclick={() => add()}>Anderen Artikel hinzufügen</button
    >{/if}
</section>
