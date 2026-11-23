<script lang="ts">
  import { tick } from 'svelte';
  import {
    abrechnungSessionChanged,
    clearAbrechnungSession,
    loadAbrechnungSession,
    saveAbrechnungSession,
  } from '../../lib/abrechnungStore.svelte';
  import type { AbrechnungAblage, AbrechnungSession } from '../../lib/abrechnungStore.svelte';
  import { formatDate } from '../../lib/campflowFields';
  import { confirmAction } from '../../lib/confirm';
  import { formatDateTime } from '../../lib/format';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import Aktionsraster from '../ui/Aktionsraster.svelte';
  import InfoHint from '../ui/InfoHint.svelte';

  /**
   * The buttons for the entries of the Abrechnung („Eingaben speichern“, „zurücksetzen“, on a
   * conflict „Gespeicherte Fassung laden“) in the grid of the action blocks, with the state of
   * the saved entries and the results directly under them.
   */
  interface Props {
    eventId: string;
    session: AbrechnungSession;
    /** Title of the Aktion, named in the confirmation of the reset. */
    title: string;
    ablage: AbrechnungAblage;
    /** The Aktion has no date in CampFlow yet: nothing can be saved. */
    datumFehlt: boolean;
    /** The retention period is over: saving is blocked. */
    aufbewahrungVorbei: boolean;
    /** The entries were restored after logging in again. */
    restored: boolean;
  }
  let { eventId, session, title, ablage, datumFehlt, aufbewahrungVorbei, restored }: Props =
    $props();

  /** Result of the last „Eingaben zurücksetzen“, shown under the buttons. */
  let resetResult = $state<'done' | 'failed' | null>(null);
  let ablageText = $state<HTMLElement | null>(null);

  async function resetEntries(): Promise<void> {
    const confirmed = await confirmAction({
      title: 'Eingaben zurücksetzen?',
      message: `Alle Eingaben zur Abrechnung „${title}“ für deinen Account auf allen Geräten zurücksetzen? Die Daten aus CampFlow bleiben erhalten.`,
      confirmLabel: 'Eingaben zurücksetzen',
    });
    if (!confirmed) return;
    resetResult = (await clearAbrechnungSession(eventId)) ? 'done' : 'failed';
    // The button disappears with the entries: keep the focus next to it
    await tick();
    ablageText?.focus();
  }

  async function loadSaved(): Promise<void> {
    if (
      await confirmAction({
        title: 'Gespeicherte Eingaben laden?',
        message:
          'Deine ungespeicherten Änderungen werden verworfen. Kopiere sie vorher, wenn du sie behalten möchtest.',
        confirmLabel: 'Gespeicherte Fassung laden',
      })
    )
      await loadAbrechnungSession(eventId);
  }
</script>

<div class="mt-4 space-y-2 text-sm text-neutral-700" data-testid="eingaben-ablage">
  <Aktionsraster>
    <ActionButton
      class="col-span-2"
      variant="primary"
      disabled={ablage.saving ||
        !ablage.dirty ||
        ablage.conflict ||
        aufbewahrungVorbei ||
        datumFehlt}
      onclick={() => saveAbrechnungSession(eventId)}
    >
      Eingaben speichern
    </ActionButton>
    {#if ablage.conflict}
      <ActionButton class="col-span-2" onclick={loadSaved}>Gespeicherte Fassung laden</ActionButton>
    {/if}
    {#if ablage.savedAt && abrechnungSessionChanged(session)}
      <ActionButton class="col-span-2" disabled={ablage.saving} onclick={resetEntries}>
        Eingaben zurücksetzen
      </ActionButton>
    {/if}
  </Aktionsraster>
  <div class="flex items-start gap-2">
    <p bind:this={ablageText} tabindex="-1" role="status">
      {datumFehlt
        ? 'Diese Aktion hat noch kein Datum in CampFlow. Du kannst die Abrechnung ansehen und bearbeiten. Zum Speichern deiner Eingaben trage zuerst das Aktionsdatum in CampFlow ein und lade die Seite neu. Bis dahin bleiben Eingaben nur auf dieser geöffneten Seite erhalten.'
        : aufbewahrungVorbei
          ? 'Die Aufbewahrungsfrist ist abgelaufen. Speichern ist deshalb gesperrt. Neue Eingaben bleiben nur auf dieser geöffneten Seite erhalten; lade benötigte Unterlagen vor dem Verlassen herunter.'
          : ablage.saving
            ? 'Eingaben werden gespeichert …'
            : ablage.dirty
              ? 'Ungespeicherte Änderungen. Tippe auf „Eingaben speichern“.'
              : ablage.savedAt
                ? `Gespeichert am ${formatDateTime(ablage.savedAt)} Uhr. Auf allen deinen Geräten verfügbar.`
                : 'Deine Eingaben werden mit „Eingaben speichern“ für deinen Account auf allen Geräten gespeichert.'}
    </p>
    <InfoHint label="Deine Eingaben">
      Teilnehmende, Rollen, Zusatztag, geänderte Beträge, Leihgebühren, Deckblatt und
      Kurzbeschreibung gehören zu dir und stehen auf all deinen Geräten bereit. {ablage.deleteAfter
        ? `Nach dem ${formatDate(ablage.deleteAfter)} werden sie gelöscht.`
        : ''} Beim Neu laden bleiben sie erhalten. Ältere Eingaben von diesem Gerät übernimmst du mit
      „Eingaben speichern“.
    </InfoHint>
  </div>
  {#if restored}
    <StatusNotice
      message="Deine Eingaben wurden nach der Anmeldung wiederhergestellt. Prüfe sie und speichere sie anschließend."
    />
  {/if}
  <StatusNotice message={ablage.error} kind="error" />
  {#if resetResult === 'done'}<StatusNotice message="Eingaben zurückgesetzt." />{/if}
</div>
