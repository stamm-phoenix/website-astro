<script lang="ts">
  import ModalDialog from '../ui/ModalDialog.svelte';
  import { ageAt, formatName, getPersonFields } from '../../lib/campflowFields';
  import { formatEuro } from '../../lib/format';
  import { isIch } from '../../lib/ichStore.svelte';
  import { mitgliedSeit } from '../../lib/mitglieder';
  import type { CampflowColumn, CampflowPerson } from '../../lib/types';

  interface Props {
    person: CampflowPerson | null;
    columns: CampflowColumn[];
    /** `YYYY-MM-DD` in Berlin, for the membership and the age. */
    today: string;
    onclose: () => void;
  }

  let { person, columns, today, onclose }: Props = $props();

  // Name and age are in the title and the line below it, the dates in „Mitglied seit …“; the
  // CampFlow IDs and when the entry was created tell Leitende nothing
  const HIDDEN = new Set([
    'name',
    'age',
    'join_date',
    'leave_date',
    'id',
    'external_id',
    'creation_date',
  ]);

  const fields = $derived(
    person
      ? getPersonFields(person, columns)
          // A field without a readable name (e.g. `col_…` when its name could not be loaded)
          // would only confuse; its key is no label for Leitende
          .filter((field) => !HIDDEN.has(field.key) && field.label !== field.key)
          .map((field) =>
            field.key === 'custom_annuity_amount' &&
            typeof person.custom_annuity_amount === 'number'
              ? { ...field, text: formatEuro(person.custom_annuity_amount) }
              : field
          )
      : []
  );
  const age = $derived(person ? ageAt(person, today) : null);
  const ich = $derived(
    person ? isIch({ id: person.id, name: formatName(person), mitglied: true }) : false
  );
</script>

<ModalDialog
  open={person !== null}
  title={person ? `${formatName(person)}${ich ? ' (ich)' : ''}` : ''}
  closeLabel="Details schließen"
  size="medium"
  dismissOnBackdrop
  {onclose}
>
  {#if person}
    <div class="overflow-y-auto px-5 py-4 md:px-6">
      <p class="text-sm text-neutral-700" data-testid="mitglied-seit">
        {mitgliedSeit(person, today)}{#if age !== null}&nbsp;· {age} Jahre{/if}
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
                  class="inline-flex min-h-11 max-w-full items-center break-all text-link underline"
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
