<script lang="ts">
  import { onMount } from 'svelte';
  import { navigate } from 'astro:transitions/client';
  import ActionButton from '../ui/ActionButton.svelte';
  import PdfDownloadButton from '../ui/PdfDownloadButton.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import ReloadAction from '../ui/ReloadAction.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import AbstimmungAuswahl from './AbstimmungAuswahl.svelte';
  import AbstimmungDialog from './AbstimmungDialog.svelte';
  import AbstimmungEinladen from './AbstimmungEinladen.svelte';
  import AbstimmungErgebnisListe from './AbstimmungErgebnisListe.svelte';
  import AbstimmungLinkKopieren from './AbstimmungLinkKopieren.svelte';
  import { ApiError, errorMessage, sendApi } from '../../lib/api';
  import { confirmAction } from '../../lib/confirm';
  import { formatDateTime } from '../../lib/format';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import {
    findRescue,
    forgetRescue,
    rescueValues,
    setRescueContext,
  } from '../../lib/geretteteEingaben';
  import type {
    AbstimmungDetail,
    AbstimmungTeilnahme,
    AbstimmungWahl,
  } from '../../lib/abstimmungen';
  import {
    abstimmungStore,
    abstimmungenStore,
    wahlAusText,
    wahlOhne,
    wahlVon,
  } from '../../lib/abstimmungen';

  /** One Abstimmung: the own answer, the result and, for the organizer, invitations and settings. */

  const store = abstimmungStore.state;
  let id = $state<number | null>(null);
  let wahl = $state<AbstimmungWahl>({ gewaehlt: [], vielleicht: [] });
  /** The own answer as loaded, to notice unsaved changes. */
  let gespeichert = $state<AbstimmungWahl | null>(null);
  let saving = $state(false);
  let busy = $state(false);
  let message = $state<string | null>(null);
  let messageKind = $state<'success' | 'warning' | 'error'>('success');
  let bearbeiten = $state(false);

  const data = $derived(store.data && store.data.id === id ? store.data : null);
  const dirty = $derived(
    gespeichert !== null && JSON.stringify(gespeichert) !== JSON.stringify(wahl)
  );

  /** Takes the saved answer; an unsaved choice stays, without options that are gone. */
  function take(detail: AbstimmungDetail | null, keep: boolean): void {
    if (!detail) return;
    const optionen = new Set(detail.optionen.map((option) => option.id));
    gespeichert = wahlVon(detail.ich);
    wahl = keep ? wahlOhne(wahl, optionen) : wahlVon(gespeichert);
  }

  async function load(): Promise<void> {
    if (id === null) return;
    const vorher = JSON.stringify(wahl);
    const keep = dirty;
    await abstimmungStore.load({ force: true, param: id });
    // A failed load keeps the data shown before; the choice stays as it is
    // A choice changed while loading is kept too
    if (!store.error) take(data, keep || JSON.stringify(wahl) !== vorher);
  }

  /** Record of the kept answer: one per Abstimmung, in this tab only. */
  const rescueRecord = (): string => `abstimmung-antwort:${id}`;
  const RESCUE_FIELD = 'Deine Antwort#custom';

  // A new login in the iPhone app reloads the page: the unsaved answer is kept and comes back
  setRescueContext({
    warning: () => null,
    enabled: () => id !== null && dirty,
    rescue: () =>
      rescueValues(rescueRecord(), 'Deine Antwort', '', [
        {
          key: RESCUE_FIELD,
          kind: 'custom',
          value: JSON.stringify(wahl),
          display: `${wahl.gewaehlt.length + wahl.vielleicht.length} gewählt`,
        },
      ]),
    register: () => () => undefined,
  });

  /** Puts back a kept answer, without options that are gone; it stays unsaved. */
  function restoreAnswer(): void {
    if (!data) return;
    const kept = findRescue(rescueRecord(), '', Date.now())?.find((v) => v.key === RESCUE_FIELD);
    if (!kept) return;
    forgetRescue(rescueRecord());
    const gerettet = wahlAusText(kept.value, new Set(data.optionen.map((option) => option.id)));
    if (gerettet) wahl = gerettet;
  }

  onMount(() => {
    const value = Number(new URLSearchParams(window.location.search).get('id'));
    id = Number.isInteger(value) && value > 0 ? value : null;
    void load().then(restoreAnswer);
    return guardUnsavedChanges(() => dirty);
  });

  async function vote(): Promise<void> {
    if (!data || saving) return;
    saving = true;
    message = null;
    try {
      await sendApi('PUT', `/intern/pflege/abstimmungen/${data.id}/stimme`, wahl);
      gespeichert = wahlVon(wahl);
      messageKind = 'success';
      message =
        wahl.gewaehlt.length + wahl.vielleicht.length
          ? 'Antwort gespeichert.'
          : 'Antwort gespeichert: Keine Option passt.';
      abstimmungenStore.invalidate();
      await abstimmungStore.load({ force: true, param: data.id });
    } catch (failure: unknown) {
      messageKind = 'error';
      // The reason the answer was refused, e.g. an option that is gone, with what to do next;
      // a reason for the whole answer (e.g. the Abstimmung is full) says that it was not saved
      const fields = failure instanceof ApiError ? failure.fields : undefined;
      message = fields?.gewaehlt
        ? `Deine Antwort wurde nicht gespeichert. ${fields.gewaehlt}`
        : fields?.form ||
          errorMessage(
            failure,
            'Deine Antwort wurde nicht gespeichert. Deine Auswahl ist noch da. Tippe noch einmal auf „Antwort speichern“.'
          );
    } finally {
      saving = false;
    }
  }

  async function setGeschlossen(geschlossen: boolean): Promise<void> {
    if (!data) return;
    if (geschlossen) {
      const confirmed = await confirmAction({
        title: `„${data.titel}“ beenden?`,
        message:
          'Danach kann niemand mehr abstimmen. Das Ergebnis bleibt sichtbar, und du kannst die Abstimmung wieder öffnen.',
        confirmLabel: 'Abstimmung beenden',
        tone: 'neutral',
      });
      if (!confirmed) return;
    }
    busy = true;
    message = null;
    try {
      await sendApi('PATCH', `/intern/pflege/abstimmungen/${data.id}`, {
        etag: data.etag,
        geschlossen,
      });
      abstimmungenStore.invalidate();
      await abstimmungStore.load({ force: true, param: data.id });
      messageKind = 'success';
      message = geschlossen ? 'Abstimmung beendet.' : 'Abstimmung wieder geöffnet.';
    } catch (failure: unknown) {
      messageKind = 'error';
      message = errorMessage(
        failure,
        geschlossen
          ? 'Die Abstimmung wurde nicht beendet. Lade die Seite neu und versuche es noch einmal.'
          : 'Die Abstimmung wurde nicht wieder geöffnet. Lade die Seite neu und versuche es noch einmal.'
      );
    } finally {
      busy = false;
    }
  }

  async function remove(): Promise<void> {
    if (!data) return;
    await sendApi('DELETE', `/intern/pflege/abstimmungen/${data.id}`, undefined, {
      etag: data.etag,
    });
    bearbeiten = false;
    gespeichert = null;
    abstimmungenStore.invalidate();
    await navigate('/leitendenbereich/abstimmungen');
  }

  function teilnahmeStatus(t: AbstimmungTeilnahme): {
    label: string;
    tone: 'success' | 'warning' | 'neutral' | 'danger';
  } {
    if (t.geantwortet) return { label: 'Abgestimmt', tone: 'success' };
    if (t.mailStatus === 'offen') return { label: 'Mail wartet auf Versand', tone: 'neutral' };
    if (t.mailStatus === 'versucht') return { label: 'Unklar, ob die Mail ankam', tone: 'danger' };
    return { label: 'Noch nicht abgestimmt', tone: 'warning' };
  }
</script>

{#if id === null}
  <p class="py-4 text-neutral-800">
    Diese Abstimmung gibt es nicht. <a
      class="text-link underline"
      href="/leitendenbereich/abstimmungen">Zu allen Abstimmungen</a
    >
  </p>
{:else}
  <LoadState
    {data}
    loading={store.loading}
    error={store.error}
    loadingText="Abstimmung wird geladen …"
    onretry={() => void load()}
  >
    {#snippet children(abstimmung)}
      <div class="space-y-8">
        <section
          class="flex flex-wrap items-end justify-between gap-4 border-b border-neutral-200 pb-6"
          aria-labelledby="abstimmung-heading"
        >
          <div class="min-w-0 max-w-3xl">
            <h1
              id="abstimmung-heading"
              class="font-serif text-3xl font-semibold text-brand-900 [overflow-wrap:anywhere] md:text-4xl"
            >
              {abstimmung.titel}
            </h1>
            <p class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-700">
              <StatusLabel
                label={abstimmung.geschlossen ? 'Beendet' : 'Läuft'}
                tone={abstimmung.geschlossen ? 'neutral' : 'success'}
                dot
              />
              <span aria-hidden="true">·</span>
              <span>
                {abstimmung.eigene ? 'Von dir' : `Von ${abstimmung.erstelltVonName}`} · {formatDateTime(
                  abstimmung.erstelltAm
                )}
              </span>
            </p>
            {#if abstimmung.beschreibung}
              <p class="mt-3 whitespace-pre-line text-neutral-800 [overflow-wrap:anywhere]">
                {abstimmung.beschreibung}
              </p>
            {/if}
          </div>
          <div class="flex flex-wrap items-center gap-2">
            {#if abstimmung.eigene}
              <ActionButton variant="secondary" disabled={busy} onclick={() => (bearbeiten = true)}
                >Bearbeiten</ActionButton
              >
              <ActionButton
                variant="secondary"
                disabled={busy}
                onclick={() => void setGeschlossen(!abstimmung.geschlossen)}
                >{abstimmung.geschlossen ? 'Wieder öffnen' : 'Abstimmung beenden'}</ActionButton
              >
            {/if}
            <PdfDownloadButton
              download={async () =>
                (await import('../../lib/abstimmungPdf')).downloadAbstimmungPdf(abstimmung)}
              errorText="Das PDF des Ergebnisses konnte nicht erstellt werden. Lade die Seite neu und versuche es noch einmal."
              onresult={(kind, text) => {
                messageKind = kind;
                message = text;
              }}
            />
            <ReloadAction
              disabled={store.loading}
              aria-busy={store.loading}
              loadedAt={store.loadedAt}
              onclick={() => void load()}>Neu laden</ReloadAction
            >
          </div>
        </section>

        <StatusNotice {message} kind={messageKind} popup />

        <section aria-labelledby="abstimmung-ich" class="max-w-2xl">
          <h2
            id="abstimmung-ich"
            class="border-b border-neutral-300 pb-2 font-serif text-xl font-semibold text-brand-900"
          >
            Deine Antwort
          </h2>
          <div class="mt-3">
            <AbstimmungAuswahl
              id="abstimmung-staff"
              optionen={abstimmung.optionen}
              maxAuswahl={abstimmung.maxAuswahl}
              vielleichtErlaubt={abstimmung.vielleichtErlaubt}
              zahlenVerborgen={abstimmung.zahlenVerborgen}
              bind:gewaehlt={wahl.gewaehlt}
              bind:vielleicht={wahl.vielleicht}
              disabled={abstimmung.geschlossen || saving}
            />
          </div>
          {#if !abstimmung.geschlossen}
            <div class="mt-4 flex flex-wrap items-center gap-3">
              <ActionButton
                variant="primary"
                disabled={saving || (!dirty && !!abstimmung.ich?.geantwortet)}
                aria-busy={saving}
                onclick={() => void vote()}
                >{saving ? 'Wird gespeichert …' : 'Antwort speichern'}</ActionButton
              >
              {#if abstimmung.ich?.geantwortet && !dirty}
                <StatusLabel label="Du hast abgestimmt" tone="success" />
              {:else if dirty}
                <StatusLabel label="Noch nicht gespeichert" tone="warning" />
              {/if}
            </div>
          {/if}
        </section>

        <AbstimmungErgebnisListe
          id="abstimmung-ergebnis"
          ergebnis={abstimmung}
          eigene={abstimmung.eigene}
        />

        {#if abstimmung.eigene}
          <section aria-labelledby="abstimmung-einladen" class="space-y-4">
            <h2
              id="abstimmung-einladen"
              class="border-b border-neutral-300 pb-2 font-serif text-xl font-semibold text-brand-900"
            >
              Einladen
            </h2>
            <AbstimmungEinladen
              {abstimmung}
              onchange={() => void abstimmungStore.load({ force: true, param: abstimmung.id })}
            />
            {#if abstimmung.link}
              <AbstimmungLinkKopieren url={abstimmung.link} label="Link für alle" />
            {/if}
            {#if abstimmung.teilnahmen && abstimmung.teilnahmen.some((t) => t.mailStatus !== null)}
              {@const eingeladene = abstimmung.teilnahmen.filter((t) => t.mailStatus !== null)}
              <details class="border-t border-neutral-200">
                <summary class="min-h-11 cursor-pointer py-2.5 font-semibold text-brand-900">
                  Eingeladen: {eingeladene.length}, davon {eingeladene.filter((t) => t.geantwortet)
                    .length} abgestimmt
                </summary>
                <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
                  {#each eingeladene as teilnahme (teilnahme.id)}
                    {@const status = teilnahmeStatus(teilnahme)}
                    <li
                      class="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span class="min-w-0">
                        <span class="block font-semibold text-brand-900 [overflow-wrap:anywhere]"
                          >{teilnahme.name || teilnahme.email}</span
                        >
                        {#if teilnahme.name}
                          <span class="block text-sm text-neutral-700 [overflow-wrap:anywhere]"
                            >{teilnahme.email}</span
                          >
                        {/if}
                      </span>
                      <span
                        class="flex shrink-0 flex-wrap items-center gap-x-3 text-sm text-neutral-700"
                      >
                        <StatusLabel label={status.label} tone={status.tone} />
                        {#if teilnahme.erinnertAm}
                          <span>Erinnert {formatDateTime(teilnahme.erinnertAm)}</span>
                        {:else if teilnahme.eingeladenAm}
                          <span>Eingeladen {formatDateTime(teilnahme.eingeladenAm)}</span>
                        {/if}
                      </span>
                    </li>
                  {/each}
                </ul>
              </details>
            {/if}
          </section>
        {/if}
      </div>

      <AbstimmungDialog
        open={bearbeiten}
        {abstimmung}
        onsaved={(_, saved) => {
          bearbeiten = false;
          messageKind = 'success';
          message = saved;
          abstimmungenStore.invalidate();
          void load();
        }}
        onclose={() => (bearbeiten = false)}
        ondelete={remove}
        onreload={async () => {
          await load();
          return data !== null && !store.error;
        }}
      />
    {/snippet}
  </LoadState>
{/if}
