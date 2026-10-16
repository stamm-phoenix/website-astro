<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import MessageText from '../ui/MessageText.svelte';
  import FotoPfad from './FotoPfad.svelte';
  import { RELOGIN_URL } from '../../lib/api';
  import { confirmAction } from '../../lib/confirm';
  import { formatFileSize } from '../../lib/downloadsStore.svelte';
  import { forgetFotoFolder } from '../../lib/fotoOrdnerStore.svelte';
  import {
    cancelFotoUpload,
    continueFotoUpload,
    fotoUpload,
    resetFotoUpload,
    retryFotoUpload,
    uploadTotals,
  } from '../../lib/fotoUpload.svelte';

  interface Props {
    onshow: (path: string) => void;
  }
  let { onshow }: Props = $props();

  let showAll = $state(false);

  const items = $derived(fotoUpload.items);
  const phase = $derived(fotoUpload.phase);
  const running = $derived(phase === 'preparing' || phase === 'running');
  const count = $derived({
    done: items.filter((item) => item.status === 'done').length,
    skipped: items.filter((item) => item.status === 'skipped').length,
    failed: items.filter((item) => item.status === 'failed').length,
    waiting: items.filter((item) => item.status === 'waiting').length,
  });
  const finishedFiles = $derived(count.done + count.skipped);
  const totalBytes = $derived(uploadTotals.bytes);
  const sentBytes = $derived(uploadTotals.sent);
  const percent = $derived(totalBytes ? Math.floor((sentBytes / totalBytes) * 100) : 0);
  const current = $derived(items.filter((item) => item.status === 'uploading'));
  const failed = $derived(items.filter((item) => item.status === 'failed'));
  const remaining = $derived.by(() => {
    const speed = fotoUpload.bytesPerSecond;
    const waiting = fotoUpload.waits.offline + fotoUpload.waits.login + fotoUpload.waits.retry;
    if (!running || waiting > 0 || !speed || speed < 1) return null;
    const seconds = (totalBytes - sentBytes) / speed;
    if (seconds < 60) return 'noch weniger als eine Minute';
    const minutes = Math.round(seconds / 60);
    if (minutes < 90) return `noch etwa ${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'}`;
    return `noch etwa ${Math.round(minutes / 60)} Stunden`;
  });
  const heading = $derived(
    {
      idle: '',
      preparing: 'Ordner wird vorbereitet …',
      running: 'Fotos werden hochgeladen',
      finished: count.failed ? 'Hochladen mit Fehlern beendet' : 'Alles ist hochgeladen',
      cancelled: 'Hochladen abgebrochen',
      error: 'Hochladen nicht gestartet',
    }[phase]
  );

  const cancelledText = $derived.by(() => {
    const missing = items.length - finishedFiles;
    return `Abgebrochen. ${finishedFiles} von ${items.length} ${items.length === 1 ? 'Datei ist' : 'Dateien sind'} in der Ablage, ${missing} ${missing === 1 ? 'fehlt' : 'fehlen'} noch.`;
  });
  const finishedText = $derived(
    count.done === 0 && count.skipped > 0 && count.failed === 0
      ? `${count.skipped === 1 ? 'Die Datei war' : `Alle ${count.skipped} Dateien waren`} schon in der Ablage. Es wurde nichts doppelt hochgeladen.`
      : [
          `${count.done} ${count.done === 1 ? 'Datei' : 'Dateien'} hochgeladen.`,
          count.skipped
            ? `${count.skipped} ${count.skipped === 1 ? 'war schon in der Ablage und wurde' : 'waren schon in der Ablage und wurden'} übersprungen.`
            : '',
          count.failed ? `${count.failed} nicht hochgeladen, siehe unten.` : '',
        ]
          .filter(Boolean)
          .join(' ')
  );

  $effect(() => {
    // The folder shows the new photos when it is opened next
    if (phase === 'finished' && fotoUpload.target) forgetFotoFolder(fotoUpload.target.path);
  });

  async function cancel(): Promise<void> {
    const confirmed = await confirmAction({
      title: 'Hochladen abbrechen?',
      message: `${finishedFiles} von ${items.length} Dateien sind schon in der Ablage und bleiben dort. Die übrigen werden nicht hochgeladen.`,
      confirmLabel: 'Hochladen abbrechen',
      cancelLabel: 'Weiter hochladen',
    });
    if (confirmed) cancelFotoUpload();
  }

  function statusText(status: string): string {
    return (
      {
        waiting: 'Wartet',
        uploading: 'Wird hochgeladen',
        done: 'Hochgeladen',
        skipped: 'War schon da',
        failed: 'Fehlgeschlagen',
      }[status] ?? status
    );
  }
</script>

<section aria-labelledby="foto-fortschritt-heading" class="max-w-2xl space-y-4">
  <div>
    <h2 id="foto-fortschritt-heading" class="font-serif text-xl text-brand-900">{heading}</h2>
    {#if fotoUpload.target}
      <div class="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-neutral-700">
        <span>Ziel:</span>
        <FotoPfad path={fotoUpload.target.path} />
      </div>
    {:else if fotoUpload.label}
      <p class="mt-1 text-sm text-neutral-700">Ziel: {fotoUpload.label}</p>
    {/if}
  </div>

  {#if phase === 'error'}
    <div role="alert" class="border-l-2 border-danger py-1 pl-4 text-sm">
      <p><MessageText text={fotoUpload.error ?? ''} /></p>
    </div>
    <div class="flex flex-wrap gap-2">
      <ActionButton variant="primary" onclick={retryFotoUpload}>Erneut versuchen</ActionButton>
      <ActionButton onclick={resetFotoUpload}>Zurück zur Auswahl</ActionButton>
    </div>
  {:else}
    <div class="space-y-2">
      <div class="flex flex-wrap items-baseline justify-between gap-x-4">
        <p class="text-2xl font-semibold tabular-nums text-brand-900">{percent} %</p>
        <p class="text-sm tabular-nums text-neutral-700">
          {finishedFiles} von {items.length}
          {items.length === 1 ? 'Datei' : 'Dateien'} · {formatFileSize(sentBytes)} von {formatFileSize(
            totalBytes
          )}
        </p>
      </div>
      <progress
        class="foto-progress h-3 w-full"
        max={totalBytes || 1}
        value={sentBytes}
        aria-label="Fortschritt des Hochladens"
        aria-valuetext={`${percent} Prozent, ${finishedFiles} von ${items.length} Dateien`}
      ></progress>
      {#if remaining}<p class="text-sm text-neutral-700">{remaining}</p>{/if}
    </div>

    <div role="status" aria-live="polite" class="space-y-2">
      {#if running && fotoUpload.waits.login > 0}
        <div class="border-l-2 border-warning py-1 pl-3 text-sm">
          <p class="font-semibold text-warning">
            Deine Anmeldung ist abgelaufen. Das Hochladen ist angehalten, nichts geht verloren.
          </p>
          <p class="mt-1">
            Melde dich im neuen Tab wieder an, komm hierher zurück und tippe auf „Weiter hochladen“.
          </p>
          <div class="mt-2 flex flex-wrap gap-2">
            <a class="btn-secondary" href={RELOGIN_URL} target="_blank" rel="noopener"
              >Neu anmelden<span class="sr-only"> (öffnet neuen Tab)</span></a
            >
            <ActionButton variant="primary" onclick={continueFotoUpload}
              >Weiter hochladen</ActionButton
            >
          </div>
        </div>
      {:else if running && fotoUpload.waits.offline > 0}
        <p class="border-l-2 border-warning py-1 pl-3 text-sm font-semibold text-warning">
          Keine Internetverbindung. Das Hochladen geht von selbst weiter, sobald du wieder online
          bist.
        </p>
      {:else if running && fotoUpload.waits.retry > 0}
        <p class="border-l-2 border-warning py-1 pl-3 text-sm font-semibold text-warning">
          Die Verbindung zu SharePoint hakt. Es wird gleich von selbst noch einmal versucht.
        </p>
      {:else if phase === 'finished'}
        <p
          class="border-l-2 py-1 pl-3 text-sm font-semibold {count.failed
            ? 'border-danger text-danger'
            : 'border-success text-success'}"
        >
          {finishedText}
        </p>
      {:else if phase === 'cancelled'}
        <p class="border-l-2 border-warning py-1 pl-3 text-sm font-semibold text-warning">
          {cancelledText}
        </p>
      {/if}
    </div>

    {#if running}
      <p class="text-sm text-neutral-700">
        Lass diese Seite offen und das Handy entsperrt, bis alles hochgeladen ist. Fertige Dateien
        sind sofort in der Ablage.
      </p>
      <ActionButton onclick={() => void cancel()}>Hochladen abbrechen</ActionButton>
    {/if}

    {#if current.length}
      <ul class="space-y-2" aria-label="Wird gerade hochgeladen">
        {#each current as item (item.id)}
          <li class="text-sm">
            <div class="flex justify-between gap-3">
              <span class="truncate">{item.name}</span>
              <span class="shrink-0 tabular-nums text-neutral-700"
                >{Math.floor((item.sent / item.size) * 100)} %</span
              >
            </div>
            <progress
              class="foto-progress mt-1 h-1.5 w-full"
              max={item.size}
              value={item.sent}
              aria-label={`Fortschritt ${item.name}`}
            ></progress>
          </li>
        {/each}
      </ul>
    {/if}

    {#if failed.length && !running}
      <div class="space-y-2">
        <h3 class="font-semibold text-danger">Nicht hochgeladen</h3>
        <ul class="divide-y divide-neutral-200 border-y border-neutral-200 text-sm">
          {#each failed as item (item.id)}
            <li class="py-2">
              <p class="font-semibold">{item.name}</p>
              <p class="text-neutral-700"><MessageText text={item.error ?? ''} /></p>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if !running}
      <div class="flex flex-wrap gap-2">
        {#if count.failed || count.waiting}
          <ActionButton variant="primary" onclick={retryFotoUpload}>
            {phase === 'cancelled' ? 'Weiter hochladen' : 'Fehlgeschlagene erneut versuchen'}
          </ActionButton>
        {/if}
        {#if fotoUpload.target}
          <ActionButton
            variant={count.failed || count.waiting ? 'secondary' : 'primary'}
            onclick={() => fotoUpload.target && onshow(fotoUpload.target.path)}
          >
            Fotos ansehen
          </ActionButton>
        {/if}
        <ActionButton onclick={resetFotoUpload}>Weitere Fotos hochladen</ActionButton>
        {#if fotoUpload.target?.webUrl}
          <a class="btn-secondary" href={fotoUpload.target.webUrl} target="_blank" rel="noopener"
            >In SharePoint öffnen<span class="sr-only"> (öffnet neuen Tab)</span></a
          >
        {/if}
      </div>
    {/if}

    <details bind:open={showAll}>
      <summary class="min-h-11 cursor-pointer py-2 text-sm font-semibold text-brand-900">
        Alle Dateien ({items.length})
      </summary>
      {#if showAll}
        <ul class="divide-y divide-neutral-200 border-y border-neutral-200 text-sm">
          {#each items as item (item.id)}
            <li class="flex justify-between gap-3 py-1.5">
              <span class="truncate">{item.name}</span>
              <span
                class="shrink-0 {item.status === 'failed'
                  ? 'text-danger'
                  : item.status === 'done'
                    ? 'text-success'
                    : 'text-neutral-700'}">{statusText(item.status)}</span
              >
            </li>
          {/each}
        </ul>
      {/if}
    </details>
  {/if}
</section>

<style>
  .foto-progress {
    appearance: none;
    overflow: hidden;
    border-radius: 9999px;
    background: var(--color-neutral-200);
  }
  .foto-progress::-webkit-progress-bar {
    background: var(--color-neutral-200);
  }
  .foto-progress::-webkit-progress-value {
    background: var(--color-success);
    transition: width 0.3s ease;
  }
  .foto-progress::-moz-progress-bar {
    background: var(--color-success);
  }
</style>
