<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import FormField from '../pflege/FormField.svelte';
  import FotoAktionWahl from './FotoAktionWahl.svelte';
  import FotoAuswahlVorschau from './FotoAuswahlVorschau.svelte';
  import FotoFortschritt from './FotoFortschritt.svelte';
  import FotoOrdnerWahl from './FotoOrdnerWahl.svelte';
  import FotoPfad from './FotoPfad.svelte';
  import { authStore, fetchPrincipal, getFirstName } from '../../lib/authStore.svelte';
  import { formatFileSize } from '../../lib/downloadsStore.svelte';
  import { MEDIA_ACCEPT, aktionFotoPath, cleanName, fotoKind } from '../../lib/fotoPfade';
  import {
    fotoUpload,
    fotoUploadDraft as draft,
    selectFotoFiles,
    startFotoUpload,
    type FotoTargetRequest,
  } from '../../lib/fotoUpload.svelte';
  import { untrack } from 'svelte';

  type Mode = 'aktion' | 'ordner';

  interface Props {
    /** Shows a folder in the photo view. */
    onshow: (path: string) => void;
  }
  let { onshow }: Props = $props();

  const MODES: { value: Mode; label: string }[] = [
    { value: 'aktion', label: 'Für eine Aktion' },
    { value: 'ordner', label: 'Ordner selbst wählen' },
  ];

  let notice = $state<string | null>(null);
  let errors = $state<{ aktion?: string; ordner?: string; files?: string }>({});

  const person = $derived(authStore.principal ? cleanName(getFirstName(authStore.principal)) : '');
  const aktionPath = $derived(
    draft.aktion && person ? aktionFotoPath(draft.aktion.year, draft.aktion.title, person) : null
  );
  const cleanSub = $derived(cleanName(draft.subfolder));
  const photos = $derived(
    draft.files.filter((file) => fotoKind(file.name) !== 'video' && !file.type.startsWith('video/'))
      .length
  );
  const videos = $derived(draft.files.length - photos);
  const pickedBytes = $derived(draft.files.reduce((sum, file) => sum + file.size, 0));
  const active = $derived(fotoUpload.phase !== 'idle');
  /** What is still missing, or where the files go. */
  const barText = $derived.by(() => {
    if (draft.files.length === 0) return 'Wähle oben deine Fotos und Videos aus.';
    if (draft.mode === 'aktion') {
      return draft.aktion ? `Ziel: ${draft.aktion.title}` : 'Wähle noch die Aktion aus.';
    }
    const target = cleanSub || draft.folder.split('/').pop();
    return target ? `Ziel: ${target}` : 'Wähle noch einen Ordner aus.';
  });

  $effect(() => {
    untrack(() => void fetchPrincipal());
  });

  function onpick(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const selection = selectFotoFiles(input.files ?? [], draft.files);
    draft.files = [...draft.files, ...selection.files];
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
    const { aktion, folder } = draft;
    if (draft.mode === 'aktion') {
      if (!aktion) next.aktion = 'Wähle zuerst die Aktion aus, zu der die Fotos gehören.';
      else {
        request = { jahr: aktion.year, aktion: aktion.title };
        label = aktion.title;
      }
    } else if (!folder && !cleanSub) {
      next.ordner =
        'Wähle einen Ordner aus oder gib einen neuen Ordnernamen ein. Ganz oben in „Fotos“ wird nichts abgelegt.';
    } else if (draft.subfolder.trim() && !cleanSub) {
      next.ordner = 'Der neue Ordnername enthält nur Zeichen, die SharePoint nicht erlaubt.';
    } else {
      request = { pfad: folder, ...(cleanSub ? { unterordner: cleanSub } : {}) };
      label = cleanSub || folder.split('/').pop() || 'Fotos';
    }
    if (draft.files.length === 0) next.files = 'Wähle zuerst die Fotos und Videos aus.';
    errors = next;
    if (!request || draft.files.length === 0) return;
    // The files stay chosen until the next selection, e.g. to pick another target after an error
    startFotoUpload(draft.files, request, label);
    notice = null;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
</script>

{#if active}
  <FotoFortschritt {onshow} />
{:else}
  <div class="max-w-2xl space-y-5">
    <section aria-labelledby="foto-auswahl-heading" class="space-y-2">
      <h2 id="foto-auswahl-heading" class="font-sans text-base font-semibold text-brand-900">
        1. Fotos und Videos auswählen
      </h2>
      <label
        class="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-4 py-5 text-center hover:border-[var(--color-brand-500)] focus-within:outline focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-[var(--color-focus)] {errors.files
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
          {draft.files.length ? 'Weitere Fotos hinzufügen' : 'Fotos und Videos auswählen'}
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

      {#if draft.files.length}
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p class="font-semibold text-brand-900" aria-live="polite">
            {[
              photos ? `${photos} ${photos === 1 ? 'Foto' : 'Fotos'}` : '',
              videos ? `${videos} ${videos === 1 ? 'Video' : 'Videos'}` : '',
            ]
              .filter(Boolean)
              .join(' und ')} ausgewählt · {formatFileSize(pickedBytes)}
          </p>
          <ActionButton onclick={() => (draft.files = [])}>Auswahl leeren</ActionButton>
        </div>
        <FotoAuswahlVorschau
          files={draft.files}
          onremove={(file) => (draft.files = draft.files.filter((other) => other !== file))}
        />
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
        value={draft.mode}
        onselect={(value) => (draft.mode = value)}
      />
      {#if draft.mode === 'aktion'}
        <FotoAktionWahl bind:selected={draft.aktion} error={errors.aktion} />
        {#if draft.aktion}
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
        <FotoOrdnerWahl bind:path={draft.folder} />
        <FormField
          id="foto-unterordner"
          label="Neuer Ordner darin"
          optional
          hint="Zum Beispiel der Vorname, wenn du Fotos von jemand anderem hochlädst."
          error={errors.ordner}
        >
          {#snippet children(attrs)}
            <input {...attrs} class="form-input" autocomplete="off" bind:value={draft.subfolder} />
          {/snippet}
        </FormField>
        <div class="surface-muted px-3 py-2">
          <p class="text-xs font-semibold text-neutral-700">Deine Fotos landen in</p>
          <FotoPfad path={draft.folder} pending={cleanSub ? [cleanSub] : []} />
        </div>
      {/if}
    </section>

    <p class="text-sm text-neutral-700">
      Lass die Seite offen, bis alles hochgeladen ist. Bricht die Verbindung ab, geht es von selbst
      weiter, sobald du wieder online bist.
    </p>

    <!-- Stays at the bottom of the screen, so the main action is in reach on a phone -->
    <section
      aria-labelledby="foto-start-heading"
      class="upload-bar surface sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 sm:mx-0"
    >
      <h2 id="foto-start-heading" class="sr-only">Hochladen</h2>
      <p class="min-w-0 flex-1 text-sm text-neutral-700">{barText}</p>
      <ActionButton variant="primary" onclick={start}>
        {draft.files.length > 0
          ? `${draft.files.length} ${draft.files.length === 1 ? 'Datei' : 'Dateien'} hochladen`
          : 'Hochladen'}
      </ActionButton>
    </section>
  </div>
{/if}

<style>
  .upload-bar {
    box-shadow: 0 -4px 12px rgb(0 0 0 / 0.08);
  }
</style>
