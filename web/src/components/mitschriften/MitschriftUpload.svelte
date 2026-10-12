<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { ApiError } from '../../lib/api';
  import {
    AUDIO_EXTENSIONS,
    MAX_AUDIO_BYTES,
    audioContentType,
    transcribeAudio,
  } from '../../lib/mitschriften';
  import type { MitschriftDetail } from '../../lib/types';

  /**
   * Upload of a recording: the file goes straight to Blob Storage with a short-lived,
   * write-only link; only Azure Speech can read it, and it is deleted after the transcription.
   */
  interface Props {
    mitschrift: MitschriftDetail;
    onstarted: (detail: MitschriftDetail) => void;
  }
  let { mitschrift, onstarted }: Props = $props();

  let file = $state<File | null>(null);
  let progress = $state<number | null>(null);
  let error = $state<string | null>(null);

  const accept = AUDIO_EXTENSIONS.map((extension) => `.${extension}`).join(',') + ',audio/*';

  function choose(event: Event & { currentTarget: HTMLInputElement }): void {
    error = null;
    const chosen = event.currentTarget.files?.[0] ?? null;
    if (chosen && chosen.size > MAX_AUDIO_BYTES) {
      error = `Die Datei darf höchstens ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)} MB groß sein.`;
      file = null;
      return;
    }
    file = chosen;
  }

  async function upload(): Promise<void> {
    if (!file) return;
    error = null;
    progress = 0;
    try {
      const audio = new Blob([file], { type: audioContentType(file.name, file.type) });
      const { mitschrift: started } = await transcribeAudio(
        mitschrift.id,
        audio,
        { source: 'datei', offsetMs: 0, untilMs: null },
        (share) => (progress = share)
      );
      onstarted(started);
    } catch (caught: unknown) {
      error = caught instanceof ApiError ? caught.message : 'Das Hochladen ist fehlgeschlagen.';
    } finally {
      progress = null;
    }
  }
</script>

<section aria-labelledby="upload-heading" class="space-y-4">
  <h2 id="upload-heading" class="font-serif text-2xl text-brand-900">Aufnahme hochladen</h2>
  <p class="max-w-prose text-sm text-neutral-700">
    MP3, M4A, WAV, OGG oder WebM, auch Teams-Aufzeichnungen, bis
    {Math.round(MAX_AUDIO_BYTES / 1024 / 1024)} MB. Die Datei liegt nur während der Transkription in Azure
    und wird danach sofort gelöscht; abspielen oder herunterladen lässt sie sich nicht.
  </p>
  <FormField id="mitschrift-datei" label="Audiodatei" error={error ?? undefined}>
    {#snippet children(attrs)}
      <input
        {...attrs}
        type="file"
        class="form-input"
        {accept}
        disabled={progress !== null}
        onchange={choose}
      />
    {/snippet}
  </FormField>
  <div class="flex flex-wrap items-center gap-3">
    <ActionButton
      variant="primary"
      disabled={!file || progress !== null}
      aria-busy={progress !== null}
      onclick={upload}
    >
      {progress === null ? 'Hochladen und transkribieren' : 'Wird hochgeladen …'}
    </ActionButton>
    {#if progress !== null}
      <progress class="w-48" max="1" value={progress} aria-label="Fortschritt des Uploads"
      ></progress>
      <span class="text-sm text-neutral-700" aria-live="polite">{Math.round(progress * 100)} %</span
      >
    {/if}
  </div>
</section>
