<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import FormField from '../pflege/FormField.svelte';
  import FotoAktionWahl from './FotoAktionWahl.svelte';
  import FotoFortschritt from './FotoFortschritt.svelte';
  import FotoOrdnerWahl from './FotoOrdnerWahl.svelte';
  import FotoPfad from './FotoPfad.svelte';
  import { authStore, fetchPrincipal, getFirstName } from '../../lib/authStore.svelte';
  import { formatFileSize } from '../../lib/downloadsStore.svelte';
  import type { FotoAktion } from '../../lib/fotoAktionen';
  import { MEDIA_ACCEPT, aktionFotoPath, cleanName, fotoKind } from '../../lib/fotoPfade';
  import {
    fotoUpload,
    selectFotoFiles,
    startFotoUpload,
    type FotoTargetRequest,
  } from '../../lib/fotoUpload.svelte';
  import { untrack } from 'svelte';

  type Mode = 'aktion' | 'ordner';

  interface Props {
    /** Folder preset for the free choice, e.g. from „In diesen Ordner hochladen“. */
    preset: string | null;
    /** Shows a folder in the photo view. */
    onshow: (path: string) => void;
  }
  let { preset, onshow }: Props = $props();

  const MODES: { value: Mode; label: string }[] = [
    { value: 'aktion', label: 'Für eine Aktion' },
    { value: 'ordner', label: 'Ordner selbst wählen' },
  ];

  let mode = $state<Mode>(untrack(() => (preset !== null ? 'ordner' : 'aktion')));
  let aktion = $state<FotoAktion | null>(null);
  let folder = $state(untrack(() => preset ?? ''));
  let subfolder = $state('');
  let picked = $state<File[]>([]);
  let notice = $state<string | null>(null);
  let errors = $state<{ aktion?: string; ordner?: string; files?: string }>({});

  const person = $derived(authStore.principal ? cleanName(getFirstName(authStore.principal)) : '');
  const aktionPath = $derived(
    aktion && person ? aktionFotoPath(aktion.year, aktion.title, person) : null
  );
  const cleanSub = $derived(cleanName(subfolder));
  const photos = $derived(
    picked.filter((file) => fotoKind(file.name) !== 'video' && !file.type.startsWith('video/'))
      .length
  );
  const videos = $derived(picked.length - photos);
  const pickedBytes = $derived(picked.reduce((sum, file) => sum + file.size, 0));
  const active = $derived(fotoUpload.phase !== 'idle');

  $effect(() => {
    untrack(() => void fetchPrincipal());
  });

  function onpick(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const selection = selectFotoFiles(input.files ?? [], picked);
    picked = [...picked, ...selection.files];
    input.value = '';
    errors.files = undefined;
    const parts: string[] = [];
    if (selection.rejected.length) {
      const names = selection.rejected.slice(0, 3).join(', ');
      const more =
        selection.rejected.length > 3 ? ` und ${selection.rejected.length - 3} weitere` : '';
      parts.push(
        `${selection.rejected.length === 1 ? 'Eine Datei ist' : `${selection.rejected.length} Dateien sind`} kein Foto oder Video (oder leer) und ${selection.rejected.length === 1 ? 'wird' : 'werden'} nicht hochgeladen: ${names}${more}.`
      );
    }
    if (selection.duplicates) {
      parts.push(
        `${selection.duplicates === 1 ? 'Eine Datei war' : `${selection.duplicates} Dateien waren`} schon ausgewählt.`
      );
    }
    notice = parts.join(' ') || null;
  }

  function start(): void {
    const next: typeof errors = {};
    let request: FotoTargetRequest | null = null;
    let label = '';
    if (mode === 'aktion') {
      if (!aktion) next.aktion = 'Wähle zuerst die Aktion aus, zu der die Fotos gehören.';
      else {
        request = { jahr: aktion.year, aktion: aktion.title };
        label = aktion.title;
      }
    } else if (!folder && !cleanSub) {
      next.ordner =
        'Wähle einen Ordner aus oder gib einen neuen Ordnernamen ein. Ganz oben in „Fotos“ wird nichts abgelegt.';
    } else if (subfolder.trim() && !cleanSub) {
      next.ordner = 'Der neue Ordnername enthält nur Zeichen, die SharePoint nicht erlaubt.';
    } else {
      request = { pfad: folder, ...(cleanSub ? { unterordner: cleanSub } : {}) };
      label = cleanSub || folder.split('/').pop() || 'Fotos';
    }
    if (picked.length === 0) next.files = 'Wähle zuerst die Fotos und Videos aus.';
    errors = next;
    if (!request || picked.length === 0) return;
    startFotoUpload(picked, request, label);
    picked = [];
    notice = null;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
</script>

{#if active}
  <FotoFortschritt {onshow} />
{:else}
  <div class="max-w-2xl space-y-6">
    <section aria-labelledby="foto-auswahl-heading" class="space-y-2">
      <h2 id="foto-auswahl-heading" class="font-sans text-base font-semibold text-brand-900">
        1. Fotos und Videos auswählen
      </h2>
      <label
        class="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-4 py-5 text-center hover:border-[var(--color-brand-500)] {errors.files
          ? 'border-danger'
          : 'border-neutral-300'}"
      >
        <svg
          aria-hidden="true"
          class="size-8 text-brand-700"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><path
            d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"
          /></svg
        >
        <span class="font-semibold text-brand-900">
          {picked.length ? 'Weitere Fotos hinzufügen' : 'Fotos und Videos auswählen'}
        </span>
        <span class="text-xs text-neutral-700">
          Aus der Galerie, vom Computer oder von der Speicherkarte. Originale in voller Qualität.
        </span>
        <input
          type="file"
          multiple
          accept={MEDIA_ACCEPT}
          class="sr-only"
          aria-describedby={errors.files ? 'foto-files-error' : undefined}
          onchange={onpick}
        />
      </label>
      {#if errors.files}
        <p id="foto-files-error" class="text-sm font-semibold text-danger">{errors.files}</p>
      {/if}
      {#if picked.length}
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p class="font-semibold text-brand-900" aria-live="polite">
            {[
              photos ? `${photos} ${photos === 1 ? 'Foto' : 'Fotos'}` : '',
              videos ? `${videos} ${videos === 1 ? 'Video' : 'Videos'}` : '',
            ]
              .filter(Boolean)
              .join(' und ')} ausgewählt · {formatFileSize(pickedBytes)}
          </p>
          <ActionButton onclick={() => (picked = [])}>Auswahl leeren</ActionButton>
        </div>
      {/if}
      {#if notice}
        <p class="text-sm text-warning" role="status">{notice}</p>
      {/if}
    </section>

    <section aria-labelledby="foto-ziel-heading" class="space-y-3">
      <h2 id="foto-ziel-heading" class="font-sans text-base font-semibold text-brand-900">
        2. Wohin gehören die Fotos?
      </h2>
      <FilterTabs
        label="Ziel"
        variant="segmented"
        options={MODES}
        value={mode}
        onselect={(value) => (mode = value)}
      />
      {#if mode === 'aktion'}
        <FotoAktionWahl bind:selected={aktion} error={errors.aktion} />
        {#if aktion}
          <div class="surface-muted px-3 py-2">
            <p class="text-xs font-semibold text-neutral-700">Deine Fotos landen in</p>
            {#if aktionPath}
              <FotoPfad path={aktionPath} />
              <p class="mt-1 text-xs text-neutral-700">
                Fehlende Ordner werden automatisch angelegt. Der letzte Ordner ist dein Vorname.
              </p>
            {:else}
              <p class="text-sm text-neutral-700">Dein Name wird geladen …</p>
            {/if}
          </div>
        {/if}
      {:else}
        <FotoOrdnerWahl bind:path={folder} />
        <FormField
          id="foto-unterordner"
          label="Neuer Ordner darin"
          optional
          hint="Zum Beispiel der Vorname, wenn du Fotos von jemand anderem hochlädst."
          error={errors.ordner}
        >
          {#snippet children(attrs)}
            <input {...attrs} class="form-input" autocomplete="off" bind:value={subfolder} />
          {/snippet}
        </FormField>
        <div class="surface-muted px-3 py-2">
          <p class="text-xs font-semibold text-neutral-700">Deine Fotos landen in</p>
          <FotoPfad path={folder} pending={cleanSub ? [cleanSub] : []} />
        </div>
      {/if}
    </section>

    <section aria-labelledby="foto-start-heading" class="space-y-2">
      <h2 id="foto-start-heading" class="font-sans text-base font-semibold text-brand-900">
        3. Hochladen
      </h2>
      <p class="text-sm text-neutral-700">
        Lass die Seite offen, bis alles hochgeladen ist. Bricht die Verbindung ab, geht es von
        selbst weiter, sobald du wieder online bist.
      </p>
      <ActionButton variant="primary" onclick={start}>
        {picked.length > 0
          ? `${picked.length} ${picked.length === 1 ? 'Datei' : 'Dateien'} hochladen`
          : 'Hochladen'}
      </ActionButton>
    </section>
  </div>
{/if}
