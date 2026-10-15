<script lang="ts">
  import {
    PERSON_STATUS_LABEL,
    ageAt,
    formatName,
    getPersonFields,
    personStatus,
  } from '../lib/campflowFields';
  import type { PersonStatus } from '../lib/campflowFields';
  import ModalDialog from './ui/ModalDialog.svelte';
  import type { CampflowColumn, CampflowEvent, CampflowPerson } from '../lib/types';

  /** Status as coloured text with a small dot instead of a pill. */
  const STATUS_TONE: Record<PersonStatus, { text: string; dot: string }> = {
    confirmed: {
      text: 'text-success',
      dot: 'bg-success',
    },
    registered: { text: 'text-brand-800', dot: 'bg-action' },
    cancelled: { text: 'text-danger', dot: 'bg-danger' },
  };

  interface Props {
    person: CampflowPerson | null;
    event: CampflowEvent;
    columns: CampflowColumn[];
    onclose: () => void;
  }

  let { person, event, columns, onclose }: Props = $props();

  const fields = $derived(
    person
      ? getPersonFields(person, columns).filter((f) => f.key !== 'name' && f.key !== 'age')
      : []
  );
  const age = $derived(person ? ageAt(person, event.start_date) : null);
</script>

<ModalDialog
  open={person !== null}
  title={person ? formatName(person) : ''}
  closeLabel="Details schließen"
  size="wide"
  dismissOnBackdrop
  {onclose}
>
  {#if person}
    {@const status = personStatus(person)}
    <div class="overflow-y-auto px-5 py-4 md:px-6">
      <p class="flex flex-wrap items-center gap-2 text-sm text-neutral-700">
        <span class="inline-flex items-center gap-1.5 font-semibold {STATUS_TONE[status].text}">
          <span aria-hidden="true" class="size-2 rounded-full {STATUS_TONE[status].dot}"></span>
          {PERSON_STATUS_LABEL[status]}
        </span>
        {#if age !== null}
          <span aria-hidden="true">·</span>
          <span>{age} Jahre zur Aktion</span>
        {/if}
      </p>

      <dl class="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]">
        {#each fields as field (field.key)}
          <dt class="font-semibold text-neutral-700">{field.label}</dt>
          <dd class="whitespace-pre-line break-words">
            {#if field.links}
              {#each field.links as link, index (index)}
                {#if index > 0},
                {/if}
                <a
                  class="text-link underline"
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
</ModalDialog>
