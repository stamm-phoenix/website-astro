<script lang="ts">
  import { onMount } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import Panel from '../ui/Panel.svelte';
  import FormField from '../pflege/FormField.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import { saveFile } from '../../lib/api';
  import {
    QR_ECKEN,
    QR_FARBEN,
    QR_FORMEN,
    QR_GROESSEN,
    QrZuLangError,
    drawQrCode,
    farbHinweis,
    fehltProtokoll,
    qrDateiname,
    qrMatrix,
    qrMindestPixel,
  } from '../../lib/qrCode';
  import type { QrMatrix, QrOptionen } from '../../lib/qrCode';

  const HEADING_CLASS = 'font-serif text-lg font-semibold text-brand-900';
  /** Resolution of the preview; the download is drawn again in the chosen size. */
  const PREVIEW_PIXELS = 640;

  let optionen = $state<QrOptionen>({
    text: '',
    vordergrund: '#003056',
    hintergrund: '#ffffff',
    transparent: false,
    form: 'quadrate',
    ecken: 'eckig',
    lilie: false,
  });
  let groesse = $state<(typeof QR_GROESSEN)[number]>(1024);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let logo = $state<HTMLImageElement | null>(null);
  let logoError = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  const text = $derived(optionen.text.trim());
  const result = $derived.by((): { matrix: QrMatrix | null; error: string | null } => {
    if (!text) return { matrix: null, error: null };
    try {
      return { matrix: qrMatrix(text, optionen.lilie), error: null };
    } catch (e: unknown) {
      return {
        matrix: null,
        error: e instanceof QrZuLangError ? e.message : 'Der QR-Code konnte nicht erstellt werden.',
      };
    }
  });
  const hinweis = $derived(farbHinweis(optionen));
  const ohneProtokoll = $derived(fehltProtokoll(text));
  /** Smaller PNGs would make a module less than 4 pixels, too small to scan reliably. */
  const minPixels = $derived(result.matrix ? qrMindestPixel(result.matrix.size) : 0);

  $effect(() => {
    if (groesse < minPixels) groesse = QR_GROESSEN.find((p) => p >= minPixels) ?? 2048;
  });

  onMount(() => {
    const image = new Image();
    image.onload = () => (logo = image);
    image.onerror = () => (logoError = true);
    image.src = '/stammeslilie.png';
  });

  // Redraw the preview whenever the text or an option changes
  $effect(() => {
    if (!canvas || !result.matrix) return;
    drawQrCode(canvas, result.matrix, { ...optionen }, PREVIEW_PIXELS, logo);
  });

  function addProtokoll(): void {
    optionen.text = `https://${text}`;
  }

  async function download(): Promise<void> {
    if (!result.matrix) return;
    busy = true;
    error = null;
    try {
      const target = document.createElement('canvas');
      drawQrCode(target, result.matrix, optionen, groesse, logo);
      const blob = await new Promise<Blob | null>((resolve) => target.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('PNG not created');
      saveFile(blob, qrDateiname(text));
    } catch {
      error = 'Das PNG konnte nicht erstellt werden. Bitte versuche es noch einmal.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
  <div class="space-y-6">
    <Panel aria-labelledby="qr-inhalt-titel">
      <h2 id="qr-inhalt-titel" class={HEADING_CLASS}>Inhalt</h2>
      <FormField
        id="qr-text"
        label="Link oder Text"
        hint="Der Link steht direkt im Code, ohne Weiterleitung über einen fremden Dienst."
        error={result.error ?? undefined}
        class="mt-4"
      >
        {#snippet children(attrs)}
          <textarea
            {...attrs}
            class="form-input"
            rows="2"
            maxlength="2000"
            spellcheck="false"
            autocomplete="off"
            placeholder="https://www.stamm-phoenix.de/"
            bind:value={optionen.text}></textarea>
        {/snippet}
      </FormField>
      {#if ohneProtokoll}
        <p class="mt-2 text-sm text-neutral-700">
          Ohne „https://“ öffnen manche Handys den Link nicht, sondern zeigen nur den Text.
          <button
            type="button"
            class="font-semibold text-brand-900 underline"
            onclick={addProtokoll}
          >
            https:// ergänzen
          </button>
        </p>
      {/if}
    </Panel>

    <Panel aria-labelledby="qr-farbe-titel">
      <h2 id="qr-farbe-titel" class={HEADING_CLASS}>Farbe</h2>
      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label for="qr-vordergrund" class="form-label">Farbe des Codes</label>
          <div class="mt-1 flex items-center gap-3">
            <input
              id="qr-vordergrund"
              type="color"
              class="h-11 w-16 cursor-pointer rounded-md border border-neutral-300 bg-surface p-1"
              bind:value={optionen.vordergrund}
            />
            <span class="font-mono text-sm text-neutral-700">{optionen.vordergrund}</span>
          </div>
        </div>
        <div>
          <label for="qr-hintergrund" class="form-label">Hintergrund</label>
          <div class="mt-1 flex items-center gap-3">
            <input
              id="qr-hintergrund"
              type="color"
              class="h-11 w-16 cursor-pointer rounded-md border border-neutral-300 bg-surface p-1 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={optionen.transparent}
              bind:value={optionen.hintergrund}
            />
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" bind:checked={optionen.transparent} />
              Transparent
            </label>
          </div>
        </div>
      </div>
      <div class="mt-4">
        <p id="qr-vorlagen" class="form-label">Vorlagen</p>
        <div role="group" aria-labelledby="qr-vorlagen" class="mt-1 flex flex-wrap gap-2">
          {#each QR_FARBEN as farbe (farbe.value)}
            <button
              type="button"
              class="size-9 rounded-full border-2 {optionen.vordergrund === farbe.value
                ? 'border-brand-900 ring-2 ring-brand-900 ring-offset-2 ring-offset-[var(--color-surface)]'
                : 'border-neutral-300'}"
              style:background-color={farbe.value}
              aria-label={farbe.label}
              aria-pressed={optionen.vordergrund === farbe.value}
              title={farbe.label}
              onclick={() => (optionen.vordergrund = farbe.value)}
            ></button>
          {/each}
        </div>
      </div>
      <StatusNotice class="mt-4" kind="warning" message={hinweis} />
    </Panel>

    <Panel aria-labelledby="qr-form-titel">
      <h2 id="qr-form-titel" class={HEADING_CLASS}>Form</h2>
      <div class="mt-3 space-y-3">
        <div>
          <p class="form-label">Punkte</p>
          <FilterTabs
            label="Form der Punkte"
            options={QR_FORMEN}
            value={optionen.form}
            onselect={(value) => (optionen.form = value)}
          />
        </div>
        <div>
          <p class="form-label">Ecken</p>
          <FilterTabs
            label="Form der Ecken"
            options={QR_ECKEN}
            value={optionen.ecken}
            onselect={(value) => (optionen.ecken = value)}
          />
        </div>
        <label class="flex items-start gap-2 text-sm">
          <input type="checkbox" class="mt-1" bind:checked={optionen.lilie} disabled={logoError} />
          <span>
            Lilie des Stammes in der Mitte
            <span class="block text-xs text-neutral-700">
              Der Code wird dafür mit der höchsten Fehlerkorrektur erstellt und dadurch etwas
              dichter.
            </span>
          </span>
        </label>
      </div>
    </Panel>
  </div>

  <Panel aria-labelledby="qr-vorschau-titel" class="lg:sticky lg:top-24">
    <h2 id="qr-vorschau-titel" class={HEADING_CLASS}>Vorschau</h2>
    <div
      class="mt-4 aspect-square w-full overflow-hidden rounded-md border border-neutral-200 {optionen.transparent
        ? 'checkerboard'
        : ''}"
    >
      {#if result.matrix}
        <div role="img" aria-label="QR-Code für {text}" class="size-full" data-testid="qr-vorschau">
          <canvas bind:this={canvas} class="block size-full" aria-hidden="true"></canvas>
        </div>
      {:else}
        <p
          class="flex size-full items-center justify-center p-6 text-center text-sm text-neutral-700"
        >
          {result.error ? 'Kein QR-Code möglich.' : 'Gib einen Link oder Text ein.'}
        </p>
      {/if}
    </div>

    <FormField id="qr-groesse" label="Größe" class="mt-4">
      {#snippet children(attrs)}
        <select {...attrs} class="form-input" bind:value={groesse}>
          {#each QR_GROESSEN as pixels (pixels)}
            <option value={pixels} disabled={pixels < minPixels}>{pixels} × {pixels} Pixel</option>
          {/each}
        </select>
      {/snippet}
    </FormField>
    <StatusNotice class="mt-4" kind="error" message={error} />
    <ActionButton
      variant="primary"
      type="button"
      class="mt-4 w-full justify-center"
      disabled={!result.matrix || busy}
      aria-busy={busy}
      onclick={download}
    >
      {busy ? 'PNG wird erstellt …' : 'Als PNG herunterladen'}
    </ActionButton>
    <p class="mt-3 text-xs text-neutral-700">
      Teste den Code vor dem Drucken mit dem Handy. Gespeichert wird nichts.
    </p>
  </Panel>
</div>

<style>
  .checkerboard {
    background-color: #ffffff;
    background-image: conic-gradient(#d4d4d4 25%, transparent 0 50%, #d4d4d4 0 75%, transparent 0);
    background-size: 16px 16px;
  }
</style>
