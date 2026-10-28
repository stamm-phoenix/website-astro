<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import { errorMessage, sendApi } from '../../lib/api';
  import { confirmAction } from '../../lib/confirm';
  import { datumKurz } from '../../lib/essensplanung';
  import { formatDateTime } from '../../lib/format';
  import { essensplanungSteuerung } from '../../lib/pflegeStore.svelte';
  import type { EssenPlanungUebersicht, StaffEssenSteuerung } from '../../lib/types';

  /** All Planungen of the Essensplanung with their owners; the Steuerung can delete them. */

  interface Props {
    data: StaffEssenSteuerung;
    onnotice: (message: string | null, kind?: 'success' | 'error') => void;
  }
  let { data, onnotice }: Props = $props();
  let busy = $state(false);

  function zeitraum(planung: EssenPlanungUebersicht): string {
    if (!planung.ersterTag || !planung.letzterTag) return 'ohne Tage';
    return planung.ersterTag === planung.letzterTag
      ? datumKurz(planung.ersterTag)
      : `${datumKurz(planung.ersterTag)} – ${datumKurz(planung.letzterTag)}`;
  }

  async function loeschen(planung: EssenPlanungUebersicht): Promise<void> {
    if (
      busy ||
      !(await confirmAction({
        title: `Planung „${planung.name}“ löschen?`,
        message: `Die Planung wird mit allen Daten endgültig gelöscht, die Links von ${planung.mitglieder} Mitgliedern funktionieren nicht mehr. Die Mitglieder bekommen keine Nachricht.`,
        confirmLabel: 'Endgültig löschen',
      }))
    )
      return;
    busy = true;
    try {
      essensplanungSteuerung.set(
        await sendApi<StaffEssenSteuerung>(
          'DELETE',
          `/intern/pflege/essensplanung/planungen/${planung.id}`,
          undefined,
          { etag: planung.etag }
        )
      );
      onnotice(`Planung „${planung.name}“ gelöscht.`);
    } catch (error: unknown) {
      await essensplanungSteuerung.load({ force: true });
      onnotice(
        errorMessage(
          error,
          'Die Planung wurde nicht gelöscht. Lade die Seite neu und versuche es noch einmal.'
        ),
        'error'
      );
    } finally {
      busy = false;
    }
  }
</script>

<section aria-labelledby="planungen-heading" class="space-y-3">
  <div class="flex items-center gap-1">
    <h2 id="planungen-heading" class="font-serif text-xl font-bold text-brand-900">
      Alle Planungen
    </h2>
    <InfoHint
      label="Alle Planungen"
      text="Die Planungen selbst siehst du hier nicht, nur wer sie angelegt hat. Nach Ablauf der Aufbewahrung werden sie automatisch gelöscht."
    />
  </div>
  <a class="text-link underline" href="/essensplanung">Zur Essensplanung</a>
  {#if data.planungen.length}
    <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
      {#each data.planungen as planung (planung.id)}
        <li class="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0 text-sm">
            <p class="text-base font-semibold text-brand-900 [overflow-wrap:anywhere]">
              {planung.name}
            </p>
            <p class="text-neutral-700">
              {zeitraum(planung)} · {planung.mitglieder}
              {planung.mitglieder === 1 ? 'Mitglied' : 'Mitglieder'} · angelegt {formatDateTime(
                planung.erstelltAm
              )}
              · zuletzt geändert {formatDateTime(planung.geaendertAm)}
            </p>
            <p class="text-neutral-700 [overflow-wrap:anywhere]">
              Besitzer:in: {planung.besitzer
                .map((person) => (person.email ? `${person.name} (${person.email})` : person.name))
                .join(', ') || '–'}
            </p>
            {#if planung.loeschtAm}
              <p class="text-neutral-700">Wird am {datumKurz(planung.loeschtAm)} gelöscht.</p>
            {/if}
          </div>
          <ActionButton
            type="button"
            variant="danger"
            class="shrink-0 print:hidden"
            disabled={busy}
            aria-label="Planung {planung.name} löschen"
            onclick={() => void loeschen(planung)}>Löschen</ActionButton
          >
        </li>
      {/each}
    </ul>
  {:else}
    <p class="text-sm text-neutral-700">Noch keine Planungen.</p>
  {/if}
</section>
