<script lang="ts">
  import { tick, untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import ReloadButton from '../pflege/ReloadButton.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import { errorMessage, sendApi } from '../../lib/api';
  import { confirmAction } from '../../lib/confirm';
  import { schnupperPflege } from '../../lib/schnupperStore.svelte';
  import {
    SCHNUPPER_STATUS_LABELS,
    SCHNUPPER_STATUS_TONES,
    SCHNUPPER_STUFE_LABELS,
    eingangText,
    filterSchnupper,
    terminText,
  } from '../../lib/schnupper';
  import type {
    SchnupperAntwortErgebnis,
    SchnupperFilter,
    StaffSchnupperAnfrage,
  } from '../../lib/schnupper';
  import SchnupperAntwortDialog from './SchnupperAntwortDialog.svelte';

  /**
   * Schnupperstunden-Anfragen (#139): families ask on /mitmachen, Leitende confirm a date or
   * cancel; the family gets each answer by mail.
   */
  const store = schnupperPflege.state;
  let filter = $state<SchnupperFilter>('offen');
  let message = $state<string | null>(null);
  let messageKind = $state<'success' | 'warning'>('success');
  let antworten = $state<{ anfrage: StaffSchnupperAnfrage; art: 'bestaetigen' | 'absagen' } | null>(
    null
  );

  const alle = $derived(store.data ?? []);
  const treffer = $derived(filterSchnupper(alle, filter));
  const anzahl = (status: SchnupperFilter): number => filterSchnupper(alle, status).length;
  const OPTIONEN = $derived([
    { value: 'offen' as const, label: 'Offen', count: anzahl('offen') },
    { value: 'bestaetigt' as const, label: 'Bestätigt', count: anzahl('bestaetigt') },
    { value: 'abgesagt' as const, label: 'Abgesagt', count: anzahl('abgesagt') },
    { value: 'alle' as const, label: 'Alle', count: alle.length },
  ]);

  $effect(() => {
    untrack(() => void schnupperPflege.load());
  });

  async function show(text: string, kind: 'success' | 'warning' = 'success'): Promise<void> {
    // The same text again must show again, so the notice is cleared first
    message = null;
    await tick();
    messageKind = kind;
    message = text;
  }

  /** The current version of a request, `null` when it was deleted, `undefined` when loading failed. */
  async function reloadAnfrage(id: number): Promise<StaffSchnupperAnfrage | null | undefined> {
    await schnupperPflege.load({ force: true });
    // A failed load keeps the old data, which must not pass for the current version
    if (store.error) return undefined;
    return store.data?.find((a) => a.id === id) ?? null;
  }

  async function done(ergebnis: SchnupperAntwortErgebnis | null, text: string): Promise<void> {
    antworten = null;
    await show(text, ergebnis && !ergebnis.mailSent ? 'warning' : 'success');
    await schnupperPflege.load({ force: true });
  }

  function wer(anfrage: StaffSchnupperAnfrage): string {
    return `${anfrage.kindVorname ? `${anfrage.kindVorname}, ` : ''}${anfrage.alter} Jahre`;
  }

  async function loeschen(anfrage: StaffSchnupperAnfrage): Promise<void> {
    const ok = await confirmAction({
      title: `Anfrage von ${anfrage.name} löschen?`,
      message: 'Die Familie bekommt keine E-Mail. Das lässt sich nicht rückgängig machen.',
    });
    if (!ok) return;
    try {
      await sendApi('DELETE', `/intern/pflege/schnupperanfragen/${anfrage.id}`, undefined, {
        etag: anfrage.etag,
      });
      await show(`Anfrage von ${anfrage.name} gelöscht.`);
    } catch (error: unknown) {
      await show(
        errorMessage(
          error,
          'Die Anfrage wurde nicht gelöscht. Lade die Seite neu und versuch es noch einmal.'
        ),
        'warning'
      );
    }
    await schnupperPflege.load({ force: true });
  }
</script>

<div class="space-y-6">
  <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <FilterTabs
      label="Anfragen"
      options={OPTIONEN}
      value={filter}
      onselect={(value) => (filter = value)}
      countNouns={['Anfrage', 'Anfragen']}
    />
    <ReloadButton resource={schnupperPflege} />
  </div>

  <StatusNotice {message} kind={messageKind} popup />

  <LoadState
    data={store.data}
    loading={store.loading}
    error={store.error}
    loadingText="Anfragen werden geladen …"
    onretry={() => void schnupperPflege.load({ force: true })}
    isEmpty={() => treffer.length === 0}
  >
    {#snippet empty()}
      <div class="border-t border-neutral-200 pt-5" role="status">
        <p>
          {filter === 'offen'
            ? 'Keine offenen Anfragen.'
            : filter === 'alle'
              ? 'Noch keine Anfragen.'
              : `Keine Anfragen mit dem Stand „${SCHNUPPER_STATUS_LABELS[filter]}“.`}
        </p>
      </div>
    {/snippet}
    <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
      {#each treffer as anfrage (anfrage.id)}
        <li class="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0 space-y-1">
            <p class="font-semibold text-brand-900 [overflow-wrap:anywhere]">
              {wer(anfrage)}{anfrage.status === 'bestaetigt'
                ? ` · ${SCHNUPPER_STUFE_LABELS[anfrage.stufe]}`
                : ''}
            </p>
            <StatusLabel
              label={SCHNUPPER_STATUS_LABELS[anfrage.status]}
              tone={SCHNUPPER_STATUS_TONES[anfrage.status]}
              dot
            />
            {#if anfrage.termin}
              <p class="text-neutral-900">
                <span class="font-semibold">{terminText(anfrage.termin)}</span>{anfrage.termin.ort
                  ? ` · ${anfrage.termin.ort}`
                  : ''}
              </p>
            {/if}
            <p class="text-neutral-900 [overflow-wrap:anywhere]">
              <span class="text-neutral-700">Wunschzeit:</span>
              {anfrage.wunschzeit}
            </p>
            <p class="[overflow-wrap:anywhere]">{anfrage.name}</p>
            <p class="flex flex-wrap gap-x-4 [overflow-wrap:anywhere]">
              <a
                class="text-link inline-flex min-h-11 items-center"
                href={`mailto:${anfrage.email}`}>{anfrage.email}</a
              >
              {#if anfrage.telefon}
                <a
                  class="text-link inline-flex min-h-11 items-center"
                  href={`tel:${anfrage.telefon.replace(/[^\d+]/g, '')}`}>{anfrage.telefon}</a
                >
              {/if}
            </p>
            {#if anfrage.nachricht}
              <p class="whitespace-pre-line text-sm text-neutral-900 [overflow-wrap:anywhere]">
                {anfrage.nachricht}
              </p>
            {/if}
            {#if anfrage.antwort}
              <p class="whitespace-pre-line text-sm text-neutral-900 [overflow-wrap:anywhere]">
                <span class="text-neutral-700">Nachricht an die Familie:</span>
                {anfrage.antwort}
              </p>
            {/if}
            {#if anfrage.antwortMail === false}
              <p class="text-sm text-danger" role="status">
                Die letzte E-Mail an {anfrage.name} wurde nicht gesendet. Schreib bitte selbst an {anfrage.email}.
              </p>
            {:else if anfrage.antwortMail === null && anfrage.status !== 'offen'}
              <p class="text-sm text-danger" role="status">
                Ob die letzte E-Mail an {anfrage.name} angekommen ist, ist unklar. Schreib bitte selbst
                an {anfrage.email}.
              </p>
            {/if}
            <p class="text-sm text-neutral-700">Eingegangen am {eingangText(anfrage.createdAt)}</p>
          </div>
          <div class="flex shrink-0 flex-wrap gap-2">
            <ActionButton
              variant={anfrage.status === 'offen' ? 'primary' : 'secondary'}
              type="button"
              aria-label={`${anfrage.termin ? 'Neuen Termin schicken' : 'Termin bestätigen'}: ${anfrage.name}`}
              onclick={() => (antworten = { anfrage, art: 'bestaetigen' })}
              >{anfrage.termin ? 'Neuer Termin' : 'Termin bestätigen'}</ActionButton
            >
            {#if anfrage.status !== 'abgesagt'}
              <ActionButton
                variant="secondary"
                type="button"
                aria-label={`Absagen: ${anfrage.name}`}
                onclick={() => (antworten = { anfrage, art: 'absagen' })}>Absagen</ActionButton
              >
            {/if}
            <ActionButton
              variant="secondary"
              type="button"
              aria-label={`Löschen: Anfrage von ${anfrage.name}`}
              onclick={() => void loeschen(anfrage)}>Löschen</ActionButton
            >
          </div>
        </li>
      {/each}
    </ul>
  </LoadState>
</div>

{#if antworten}
  {#key `${antworten.anfrage.id}:${antworten.art}`}
    <SchnupperAntwortDialog
      anfrage={antworten.anfrage}
      art={antworten.art}
      onreload={reloadAnfrage}
      ondone={done}
      onclose={() => (antworten = null)}
    />
  {/key}
{/if}
