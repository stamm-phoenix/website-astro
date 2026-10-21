<script lang="ts">
  import {
    PERSON_STATUS_LABEL,
    ageAt,
    formatName,
    getPersonFields,
    personStatus,
  } from '../lib/campflowFields';
  import type { PersonStatus } from '../lib/campflowFields';
  import { isIchCampflow } from '../lib/ichStore.svelte';
  import ModalDialog from './ui/ModalDialog.svelte';
  import StatusLabel from './ui/StatusLabel.svelte';
  import CopyCode from './ui/CopyCode.svelte';
  import { beitragBetrag } from '../lib/aktionBeitraege';
  import { statusLabel } from '../lib/beitraege';
  import { formatEuro } from '../lib/format';
  import type { AktionBeitrag, CampflowColumn, CampflowEvent, CampflowPerson } from '../lib/types';

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
    /** The person's Beiträge from CampFlow; `undefined` while they load or could not be read. */
    beitraege?: AktionBeitrag[];
    /** IDs of the own registrations, matched by the server (`ich` of the Aktion). */
    eigene?: readonly string[] | null;
    onclose: () => void;
  }

  let { person, event, columns, beitraege, eigene = null, onclose }: Props = $props();

  const fields = $derived(
    person
      ? getPersonFields(person, columns).filter((f) => f.key !== 'name' && f.key !== 'age')
      : []
  );
  const age = $derived(person ? ageAt(person, event.start_date) : null);
</script>

<ModalDialog
  open={person !== null}
  title={person ? `${formatName(person)}${isIchCampflow(person, eigene) ? ' (ich)' : ''}` : ''}
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

      {#if beitraege}
        <section aria-labelledby="person-beitraege" class="mt-4 border-b border-neutral-200 pb-4">
          <h3 id="person-beitraege" class="text-sm font-semibold text-neutral-700">Beitrag</h3>
          {#if beitraege.length === 0}
            <p class="mt-1 text-sm text-neutral-700">Kein Beitrag in CampFlow.</p>
          {:else}
            <ul class="mt-1 space-y-2 text-sm">
              {#each beitraege as fee (fee.id)}
                {@const state = statusLabel(fee)}
                <li>
                  <p class="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span class="font-semibold tabular-nums text-brand-900"
                      >{#if fee.status === 'cancelled'}<s>{beitragBetrag(fee)}</s
                        >{:else}{beitragBetrag(fee)}{/if}</span
                    >
                    <StatusLabel label={state.label} tone={state.tone} dot />
                  </p>
                  <p class="text-neutral-700">
                    {[
                      fee.description,
                      fee.paidCent > 0 &&
                        fee.status !== 'paid' &&
                        `bezahlt ${formatEuro(fee.paidCent)}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {#if fee.reference}
                    <p class="mt-2 flex flex-wrap items-center gap-x-2 text-neutral-700">
                      Verwendungszweck <CopyCode code={fee.reference} />
                    </p>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/if}

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
