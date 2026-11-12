<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import { ApiError, errorMessage, postApi } from '../../lib/api';
  import { textGeaendert, vorschlagBezug, vorschlagOrt } from '../../lib/protokollKorrektur';
  import type {
    KorrekturPruefung,
    KorrekturUebernahmeResponse,
    KorrekturVorschlag,
  } from '../../lib/protokollKorrektur';
  import type { ProtokollEditorDetail } from '../../lib/types';

  /**
   * Correction proposals on request (#553): the check of the saved minutes and the proposals,
   * each taken over or dropped one by one. Nothing changes without „Übernehmen“.
   */
  interface Props {
    detail: ProtokollEditorDetail;
    /** Reloads the minutes after a proposal was taken over. */
    onchanged: () => Promise<unknown>;
  }
  let { detail, onchanged }: Props = $props();

  type Zustand = 'offen' | 'uebernommen' | 'verworfen';

  let vorschlaege = $state.raw<KorrekturVorschlag[] | null>(null);
  let zustand = $state<Record<string, Zustand>>({});
  let pruefend = $state(false);
  let uebernehmend = $state(false);
  let ergebnis = $state<string | null>(null);
  let fehler = $state<string | null>(null);

  const sichtbar = $derived(
    (vorschlaege ?? []).filter((v) => (zustand[v.id] ?? 'offen') !== 'verworfen')
  );
  const offenUndPassend = (v: KorrekturVorschlag): boolean =>
    v.art !== 'rueckfrage' &&
    (zustand[v.id] ?? 'offen') === 'offen' &&
    !textGeaendert(detail.inhalt, v);
  const rechtschreibung = $derived(
    sichtbar.filter((v) => v.art === 'rechtschreibung' && offenUndPassend(v))
  );

  async function pruefen(): Promise<void> {
    pruefend = true;
    fehler = null;
    ergebnis = null;
    try {
      const result = await postApi<KorrekturPruefung>(
        `/intern/protokoll-editor/${detail.id}/ki/korrekturen`,
        {},
        { saves: false }
      );
      vorschlaege = result.vorschlaege;
      zustand = {};
      const anzahl = result.vorschlaege.length;
      ergebnis =
        (anzahl === 0
          ? 'Geprüft: keine Korrekturen gefunden.'
          : `Geprüft: ${anzahl === 1 ? 'ein Vorschlag' : `${anzahl} Vorschläge`}.`) +
        (result.nichtGeprueft.length > 0
          ? ` Nicht geprüft: ${result.nichtGeprueft.join(', ')}. Tippe noch einmal auf „Auf Korrekturen prüfen“.`
          : '');
    } catch (error: unknown) {
      fehler = errorMessage(
        error,
        'Die Prüfung hat nicht geklappt. Am Protokoll wurde nichts geändert. Tippe noch einmal auf „Auf Korrekturen prüfen“.'
      );
    } finally {
      pruefend = false;
    }
  }

  async function uebernehmen(auswahl: KorrekturVorschlag[]): Promise<void> {
    uebernehmend = true;
    fehler = null;
    ergebnis = null;
    try {
      const result = await postApi<KorrekturUebernahmeResponse>(
        `/intern/pflege/protokoll-editor/${detail.id}/korrekturen`,
        {
          etag: detail.etag,
          vorschlaege: auswahl.map(({ id, punktId, feld, elementId, vorher, nachher }) => ({
            id,
            punktId,
            feld,
            elementId,
            vorher,
            nachher,
          })),
        }
      );
      for (const id of result.uebernommen) zustand[id] = 'uebernommen';
      const n = result.uebernommen.length;
      ergebnis =
        n === 0
          ? 'Nichts übernommen: Der Text hat sich inzwischen geändert.'
          : `${n === 1 ? 'Korrektur' : `${n} Korrekturen`} übernommen.${result.geaendert.length > 0 ? ` ${result.geaendert.length} nicht übernommen, weil sich der Text geändert hat.` : ''}`;
      await onchanged();
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 409) {
        fehler =
          'Das Protokoll wurde inzwischen geändert. Es wurde nichts übernommen. Prüf die Vorschläge und tippe noch einmal auf „Übernehmen“.';
        await onchanged();
      } else {
        fehler = errorMessage(
          error,
          'Die Korrektur wurde nicht übernommen. Am Protokoll wurde nichts geändert. Tippe noch einmal auf „Übernehmen“.'
        );
      }
    } finally {
      uebernehmend = false;
    }
  }
</script>

<div class="space-y-3">
  <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
    <ActionButton disabled={pruefend || uebernehmend} aria-busy={pruefend} onclick={pruefen}>
      {pruefend ? 'Wird geprüft …' : 'Auf Korrekturen prüfen'}
    </ActionButton>
    <p class="text-sm" role="status" aria-live="polite">
      {#if fehler}
        <span class="text-danger">{fehler}</span>
      {:else if ergebnis}
        <span class="text-neutral-800">{ergebnis}</span>
      {/if}
    </p>
  </div>

  {#if sichtbar.length > 0}
    {#if rechtschreibung.length > 1}
      <ActionButton disabled={uebernehmend} onclick={() => void uebernehmen(rechtschreibung)}>
        Alle {rechtschreibung.length} Rechtschreibkorrekturen übernehmen
      </ActionButton>
    {/if}
    <ul class="space-y-3" aria-label="Korrekturvorschläge">
      {#each sichtbar as vorschlag (vorschlag.id)}
        {@const status = zustand[vorschlag.id] ?? 'offen'}
        {@const geaendert = status === 'offen' && textGeaendert(detail.inhalt, vorschlag)}
        {@const bezug = vorschlagBezug(detail.inhalt, vorschlag)}
        <li class="surface space-y-2 p-3 text-sm">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p class="font-semibold text-brand-900">{vorschlagOrt(detail.inhalt, vorschlag)}</p>
            {#if status === 'uebernommen'}
              <StatusLabel label="Übernommen" tone="success" />
            {:else if geaendert}
              <StatusLabel label="Text hat sich geändert" tone="warning" />
            {/if}
          </div>
          {#if vorschlag.art === 'rueckfrage'}
            {#if vorschlag.vorher || bezug}
              <p class="whitespace-pre-line text-neutral-800">„{vorschlag.vorher || bezug}“</p>
            {/if}
          {:else}
            <p class="whitespace-pre-line break-words">
              <span class="sr-only">Vorher: </span><del class="text-danger">{vorschlag.vorher}</del>
              <span aria-hidden="true" class="px-1">→</span><span class="sr-only"
                >Nachher:
              </span><ins class="font-semibold text-success no-underline"
                >{vorschlag.nachher || '(entfernen)'}</ins
              >
            </p>
          {/if}
          <p class="text-neutral-800">{vorschlag.begruendung}</p>
          {#if status === 'offen'}
            <div class="flex flex-wrap gap-2">
              {#if vorschlag.art !== 'rueckfrage' && !geaendert}
                <ActionButton
                  variant="primary"
                  disabled={uebernehmend}
                  onclick={() => void uebernehmen([vorschlag])}
                >
                  Übernehmen
                </ActionButton>
              {/if}
              <ActionButton
                disabled={uebernehmend}
                onclick={() => (zustand[vorschlag.id] = 'verworfen')}
              >
                {vorschlag.art === 'rueckfrage' ? 'Ausblenden' : 'Verwerfen'}
              </ActionButton>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
