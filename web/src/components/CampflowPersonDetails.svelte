<script lang="ts">
  import {
    PERSON_STATUS_CLASS,
    PERSON_STATUS_LABEL,
    ageAt,
    formatName,
    getPersonFields,
    personStatus,
  } from '../lib/campflowFields';
  import type { CampflowColumn, CampflowEvent, CampflowPerson } from '../lib/types';

  interface Props {
    person: CampflowPerson | null;
    event: CampflowEvent;
    columns: CampflowColumn[];
    onclose: () => void;
  }

  let { person, event, columns, onclose }: Props = $props();

  let dialog = $state<HTMLDialogElement | null>(null);

  const fields = $derived(
    person
      ? getPersonFields(person, columns).filter((f) => f.key !== 'name' && f.key !== 'age')
      : []
  );
  const age = $derived(person ? ageAt(person, event.start_date) : null);

  $effect(() => {
    if (!dialog) return;
    if (person && !dialog.open) dialog.showModal();
    if (!person && dialog.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="person-details-heading"
  class="details-dialog m-auto max-h-[calc(100dvh-2rem)] w-[min(44rem,calc(100%-2rem))] rounded-[var(--radius-lg)] border border-neutral-200 bg-white p-0 shadow-lift"
  {onclose}
  onclick={(e) => {
    if (e.target === dialog) dialog?.close();
  }}
>
  {#if person}
    {@const status = personStatus(person)}
    <div class="p-5 md:p-6">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 id="person-details-heading" class="font-serif text-2xl font-semibold text-brand-900">
            {formatName(person)}
          </h2>
          <p class="mt-2 flex flex-wrap items-center gap-2 text-sm text-neutral-700">
            <span class="pill border text-xs {PERSON_STATUS_CLASS[status]}">
              {PERSON_STATUS_LABEL[status]}
            </span>
            {#if age !== null}
              <span>{age} Jahre zur Aktion</span>
            {/if}
          </p>
        </div>
        <button
          type="button"
          class="rounded-full p-2 text-neutral-700 hover:bg-[var(--color-brand-50)]"
          aria-label="Details schließen"
          onclick={() => dialog?.close()}
        >
          <svg
            aria-hidden="true"
            class="size-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <dl class="mt-5 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]">
        {#each fields as field (field.key)}
          <dt class="font-semibold text-neutral-700">{field.label}</dt>
          <dd class="whitespace-pre-line break-words">
            {#if field.links}
              {#each field.links as link, index (index)}
                {#if index > 0},
                {/if}
                <a
                  class="text-brand-800 underline"
                  href={link.href}
                  target={link.href.startsWith('http') ? '_blank' : undefined}
                  rel="noopener noreferrer">{link.text}</a
                >
              {/each}
            {:else}
              {field.text}
            {/if}
          </dd>
        {/each}
      </dl>
    </div>
  {/if}
</dialog>

<style>
  .details-dialog::backdrop {
    background: rgb(0 48 86 / 0.35);
    backdrop-filter: blur(2px);
  }
</style>
