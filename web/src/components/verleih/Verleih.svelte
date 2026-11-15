<script lang="ts">
  import { onMount, tick } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import ReloadButton from '../pflege/ReloadButton.svelte';
  import VerleihAntragDialog from './VerleihAntragDialog.svelte';
  import VerleihAktionDialog from './VerleihAktionDialog.svelte';
  import VerleihEinstellung from './VerleihEinstellung.svelte';
  import { verleihResource } from '../../lib/verleihStore.svelte';
  import { inventurPflege } from '../../lib/inventurStore.svelte';
  import { sendApi, errorMessage } from '../../lib/api';
  import type { VerleihVorgang, VerleihStatus } from '../../../../api/lib/verleih-model';
  type Aktion =
    'genehmigen' | 'ablehnen' | 'ausgeben' | 'zurueckziehen' | 'rueckgabe' | 'stornieren';
  const store = verleihResource.state;
  const namen: Record<VerleihStatus, string> = {
    antrag: 'Wartet auf Freigabe',
    genehmigt: 'Genehmigt',
    ausgegeben: 'Ausgegeben',
    abgeschlossen: 'Abgeschlossen',
    abgelehnt: 'Abgelehnt',
    zurueckgezogen: 'Zurückgezogen',
  };
  let suche = $state('');
  let filter = $state('offen');
  let message = $state<string | null>(null);
  let error = $state('');
  let antrag = $state<{ vorgang: VerleihVorgang | null } | null>(null);
  let aktion = $state<{ vorgang: VerleihVorgang; aktion: Aktion } | null>(null);
  let einrichten = $state(false);
  let sending = $state<number | null>(null);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  const alle = $derived(store.data?.vorgaenge ?? []);
  function ueberfaellig(v: VerleihVorgang): boolean {
    return ['genehmigt', 'ausgegeben'].includes(v.status) && v.bis < today;
  }
  const gefiltert = $derived(
    alle.filter((v) => {
      const passt =
        filter === 'alle' ||
        (filter === 'offen'
          ? ['antrag', 'genehmigt', 'ausgegeben'].includes(v.status)
          : filter === 'ueberfaellig'
            ? ueberfaellig(v)
            : filter === 'verlauf'
              ? ['abgeschlossen', 'abgelehnt', 'zurueckgezogen'].includes(v.status)
              : v.status === filter);
      return (
        passt &&
        [v.entleiher, v.verantwortlich, ...v.positionen.map((p) => p.bezeichnung)]
          .join(' ')
          .toLocaleLowerCase('de')
          .includes(suche.trim().toLocaleLowerCase('de'))
      );
    })
  );
  onMount(() => {
    void Promise.all([verleihResource.load(), inventurPflege.load()]).then(async () => {
      const id = Number(new URLSearchParams(window.location.search).get('ausleihe'));
      if (id) {
        filter = 'alle';
        await tick();
        const vorgang = document.getElementById(`ausleihe-${id}`);
        vorgang?.scrollIntoView();
        vorgang?.focus({ preventScroll: true });
      }
    });
  });
  async function done(text: string): Promise<void> {
    antrag = null;
    aktion = null;
    einrichten = false;
    message = text;
    await Promise.all([
      verleihResource.load({ force: true }),
      inventurPflege.load({ force: true }),
    ]);
  }
  async function versand(id: number): Promise<void> {
    sending = id;
    error = '';
    try {
      const result = await sendApi<{ mailGesendet: boolean }>(
        'POST',
        `/intern/pflege/verleih/${id}/versand`,
        {}
      );
      await done(
        result.mailGesendet
          ? 'E-Mails versandt.'
          : 'Die Ausleihe ist gespeichert. Eine E-Mail konnte weiterhin nicht versandt werden. Versuche den Versand später erneut oder wende dich an admin@stamm-phoenix.de.'
      );
    } catch (e) {
      error = errorMessage(
        e,
        'Der Versand konnte nicht gestartet werden. Die Ausleihe bleibt gespeichert. Versuche es später erneut.'
      );
    } finally {
      sending = null;
    }
  }
</script>

<div class="space-y-5">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div class="w-full sm:max-w-sm">
      <label for="verleih-suche" class="form-label">Ausleihe suchen</label><input
        id="verleih-suche"
        type="search"
        class="form-input"
        placeholder="Person, Gruppe oder Material"
        bind:value={suche}
      />
    </div>
    <div class="flex flex-wrap gap-2">
      <ReloadButton resource={verleihResource} />
      {#if store.data?.darfEinrichten}<ActionButton
          type="button"
          variant="secondary"
          onclick={() => (einrichten = true)}>Materialwart festlegen</ActionButton
        >{/if}
      <ActionButton
        type="button"
        variant="primary"
        disabled={!store.data?.materialwart || !inventurPflege.state.data}
        onclick={() => (antrag = { vorgang: null })}>Ausleihe beantragen</ActionButton
      >
    </div>
  </div>
  <FilterTabs
    label="Ausleihen"
    options={[
      { value: 'offen', label: 'Offen' },
      { value: 'antrag', label: 'Anträge' },
      { value: 'ueberfaellig', label: 'Überfällig' },
      { value: 'verlauf', label: 'Verlauf' },
      { value: 'alle', label: 'Alle' },
    ]}
    value={filter}
    onselect={(value) => (filter = value)}
  />
  <StatusNotice {message} popup />
  {#if error}<p role="alert" class="text-danger">{error}</p>{/if}
  {#if store.data && !store.data.materialwart}<p role="status" class="text-warning">
      Noch kein Materialwart eingerichtet. Bitte wende dich an den Vorstand.
    </p>{/if}
  {#if inventurPflege.state.error}<p role="alert" class="text-danger">
      {inventurPflege.state.error}
    </p>
    <ActionButton
      type="button"
      variant="secondary"
      onclick={() => inventurPflege.load({ force: true })}>Material erneut laden</ActionButton
    >{/if}
  <LoadState
    data={store.data}
    loading={store.loading}
    error={store.error}
    loadingText="Ausleihen werden geladen …"
    onretry={() => verleihResource.load({ force: true })}
    isEmpty={() => !gefiltert.length}
  >
    {#snippet empty()}<p role="status">Keine Ausleihe passt zu deiner Auswahl.</p>{/snippet}
    <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
      {#each gefiltert as v (v.id)}
        <li id={`ausleihe-${v.id}`} tabindex="-1" class="space-y-3 py-5">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 class="font-serif text-xl text-brand-900 [overflow-wrap:anywhere]">
                {v.entleiher}
              </h2>
              <p class="text-sm text-neutral-700">{v.von} bis {v.bis}</p>
            </div>
            <StatusLabel
              label={ueberfaellig(v) ? 'Überfällig' : namen[v.status]}
              tone={ueberfaellig(v)
                ? 'danger'
                : v.status === 'antrag'
                  ? 'warning'
                  : v.status === 'abgelehnt'
                    ? 'danger'
                    : 'neutral'}
            />
          </div>
          <ul class="space-y-1">
            {#each v.positionen as p (p.id)}<li>
                {p.menge} × {p.bezeichnung}{#if p.zurueck}
                  · {p.zurueck} zurück, {p.menge - p.zurueck} offen{/if}
              </li>{/each}
          </ul>
          <details>
            <summary class="cursor-pointer py-3 text-brand-900">Kontakt und Verlauf</summary>
            <div class="space-y-2 py-2 [overflow-wrap:anywhere]">
              {#if v.verantwortlich}<p>Verantwortlich: {v.verantwortlich}</p>{/if}
              {#if v.kontakt}<p>Kontakt: {v.kontakt}</p>{/if}
              <p>Beantragt von: {v.antragsteller}</p>
              {#if v.notizen}<p>{v.notizen}</p>{/if}
              {#if v.entscheidung}<p>Entscheidung: {v.entscheidung}</p>{/if}
              <ol class="space-y-2 text-sm text-neutral-700">
                {#each v.verlauf as e, i (i)}<li>
                    {new Date(e.am).toLocaleString('de-DE')} · {e.von}<br />{e.text}
                  </li>{/each}
              </ol>
            </div>
          </details>
          <div class="flex flex-wrap gap-2">
            {#if v.status === 'antrag' && v.antragsteller === store.data?.login}
              <ActionButton
                type="button"
                variant="secondary"
                onclick={() => (antrag = { vorgang: v })}>Antrag bearbeiten</ActionButton
              >
              <ActionButton
                type="button"
                variant="secondary"
                onclick={() => (aktion = { vorgang: v, aktion: 'zurueckziehen' })}
                >Antrag zurückziehen</ActionButton
              >
            {/if}
            {#if store.data?.darfVerwalten}
              {#if v.status === 'antrag'}
                <ActionButton
                  type="button"
                  variant="primary"
                  onclick={() => (aktion = { vorgang: v, aktion: 'genehmigen' })}
                  >Genehmigen</ActionButton
                >
                <ActionButton
                  type="button"
                  variant="secondary"
                  onclick={() => (aktion = { vorgang: v, aktion: 'ablehnen' })}
                  >Ablehnen</ActionButton
                >
              {:else if v.status === 'genehmigt'}
                <ActionButton
                  type="button"
                  variant="secondary"
                  onclick={() => (aktion = { vorgang: v, aktion: 'stornieren' })}
                  >Ausleihe absagen</ActionButton
                ><ActionButton
                  type="button"
                  variant="primary"
                  onclick={() => (aktion = { vorgang: v, aktion: 'ausgeben' })}
                  >Material ausgeben</ActionButton
                >
              {:else if v.status === 'ausgegeben'}<ActionButton
                  type="button"
                  variant="primary"
                  onclick={() => (aktion = { vorgang: v, aktion: 'rueckgabe' })}
                  >Rückgabe erfassen</ActionButton
                >{/if}
            {/if}
          </div>
          {#if v.mailOffen}
            <p role="status" class="text-warning">
              {v.mailOffen} E-Mail{v.mailOffen === 1 ? '' : 's'} noch nicht versandt
            </p>
            {#if store.data?.darfVerwalten || store.data?.login === v.antragsteller}<ActionButton
                type="button"
                variant="secondary"
                disabled={sending !== null}
                onclick={() => versand(v.id)}
                >{sending === v.id ? 'Wird versandt …' : 'E-Mails erneut versenden'}</ActionButton
              >{/if}
          {/if}
        </li>
      {/each}
    </ul>
  </LoadState>
</div>
{#if antrag && store.data && inventurPflege.state.data}<VerleihAntragDialog
    artikel={inventurPflege.state.data}
    vorgaenge={alle}
    login={store.data.login}
    vorgang={antrag.vorgang}
    onclose={() => {
      antrag = null;
      void verleihResource.load({ force: true });
    }}
    ondone={done}
  />{/if}
{#if aktion}<VerleihAktionDialog {...aktion} onclose={() => (aktion = null)} ondone={done} />{/if}
{#if einrichten}<VerleihEinstellung onclose={() => (einrichten = false)} ondone={done} />{/if}
