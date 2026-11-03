<script lang="ts">
  import { keineAktionHinweis } from '../../lib/aktionArt';
  import { saveKeineAktion } from '../../lib/aktionZuschuss';
  import { confirmAction } from '../../lib/confirm';
  import { errorMessage } from '../../lib/api';
  import type { CampflowEvent } from '../../lib/types';
  import type { Notice } from '../../lib/status';
  import ActionButton from '../ui/ActionButton.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';

  interface Props {
    events: CampflowEvent[];
  }
  let { events }: Props = $props();
  const candidates = $derived(
    events.filter((event) => !event.archived && keineAktionHinweis(event))
  );
  let busy = $state(false);
  let notice = $state<Notice | null>(null);

  async function classify(event: CampflowEvent): Promise<void> {
    if (busy) return;
    const confirmed = await confirmAction({
      title: `„${event.title}“ aus Aktionen ausblenden?`,
      message:
        'Der Eintrag wird nicht mehr im Kalender oder für Fahrten, Aufgaben und Fotos als Aktion angeboten. In der Abrechnung steht er unter „Bestellungen und Sonstiges“.',
      confirmLabel: 'Aus Aktionen ausblenden',
    });
    if (!confirmed) return;
    busy = true;
    notice = null;
    try {
      await saveKeineAktion(event.id, true);
      notice = { kind: 'success', text: `„${event.title}“ wird nicht mehr als Aktion angezeigt.` };
    } catch (error) {
      notice = {
        kind: 'error',
        text: errorMessage(
          error,
          'Die Einordnung wurde nicht gespeichert. Prüfe deine Internetverbindung und versuche es noch einmal.'
        ),
      };
    } finally {
      busy = false;
    }
  }
</script>

{#if candidates.length > 0}
  <details class="surface p-3">
    <summary class="min-h-11 cursor-pointer py-2 font-semibold text-brand-900">
      Bestellungen und Vorlagen prüfen ({candidates.length})
    </summary>
    <ul class="divide-y divide-neutral-200">
      {#each candidates as event (event.id)}
        <li class="flex flex-wrap items-center justify-between gap-3 py-3">
          <div class="min-w-0">
            <a
              class="text-link inline-flex min-h-11 items-center break-words font-semibold"
              href="/leitendenbereich/aktionen/aktion?id={encodeURIComponent(event.id)}"
              >{event.title}</a
            >
            <p class="text-sm text-neutral-700">{keineAktionHinweis(event)}</p>
          </div>
          <ActionButton disabled={busy} onclick={() => void classify(event)}
            >Aus Aktionen ausblenden</ActionButton
          >
        </li>
      {/each}
    </ul>
  </details>
{/if}
<StatusNotice message={notice?.text ?? null} kind={notice?.kind} popup />
