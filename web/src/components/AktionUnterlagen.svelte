<script lang="ts">
  import type { Aktion } from '../lib/types';
  import PdfDownloadButton from './ui/PdfDownloadButton.svelte';
  import { getDownloadFileUrl } from '../lib/downloadsStore.svelte';
  interface Props {
    aktion: Aktion;
  }
  let { aktion }: Props = $props();
</script>

{#if aktion.meetingPoint}
  <section aria-labelledby="treffpunkt-{aktion.id}" class="mt-4">
    <h4 id="treffpunkt-{aktion.id}" class="font-semibold text-brand-900">Treffpunkt</h4>
    <p class="whitespace-pre-wrap break-words text-sm text-neutral-700">{aktion.meetingPoint}</p>
  </section>
{/if}
{#if aktion.packingList?.length}
  <section aria-labelledby="packliste-{aktion.id}" class="mt-4">
    <h4 id="packliste-{aktion.id}" class="font-semibold text-brand-900">Packliste</h4>
    <ul class="my-2 list-disc pl-5 text-sm text-neutral-700">
      {#each aktion.packingList as item, i (i)}<li class="break-words">{item}</li>{/each}
    </ul>
    <PdfDownloadButton
      text="Packliste als PDF"
      download={async () => {
        const { downloadPackliste } = await import('../lib/packlistePdf');
        await downloadPackliste(aktion);
      }}
    />
  </section>
{/if}
{#if aktion.downloads?.length}
  <section aria-labelledby="unterlagen-{aktion.id}" class="mt-4">
    <h4 id="unterlagen-{aktion.id}" class="font-semibold text-brand-900">Unterlagen</h4>
    <ul>
      {#each aktion.downloads as file (file.id)}
        <li>
          <a
            class="inline-flex min-h-11 items-center break-all text-sm underline underline-offset-2"
            href={getDownloadFileUrl(file.id)}>{file.fileName}</a
          >
        </li>
      {/each}
    </ul>
  </section>
{/if}
