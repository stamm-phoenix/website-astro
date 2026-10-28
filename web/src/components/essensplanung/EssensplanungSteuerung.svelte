<script lang="ts">
  import { untrack } from 'svelte';
  import LoadState from '../ui/LoadState.svelte';
  import ReloadButton from '../pflege/ReloadButton.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import { essensplanungSteuerung } from '../../lib/pflegeStore.svelte';
  import { setRescueContext } from '../../lib/geretteteEingaben';
  import EssenEinstellungenForm from './EssenEinstellungenForm.svelte';
  import EssenZutaten from './EssenZutaten.svelte';
  import EssenListe from './EssenListe.svelte';
  import EssenProtokoll from './EssenProtokoll.svelte';
  import EssenPlanungen from './EssenPlanungen.svelte';

  const store = essensplanungSteuerung.state;
  let message = $state<string | null>(null);
  let messageKind = $state<'success' | 'error'>('success');

  function onnotice(text: string | null, kind: 'success' | 'error' = 'success'): void {
    message = text;
    messageKind = kind;
  }

  $effect(() => {
    untrack(() => essensplanungSteuerung.load());
  });

  /** Set by the settings form, the only input of this page outside a dialog. */
  let einstellungenRettung: { enabled: () => boolean; rescue: () => boolean } | null = null;

  // A new login in the iPhone app reloads the page: unsaved settings are kept and come back
  setRescueContext({
    warning: () => null,
    enabled: () => einstellungenRettung?.enabled() ?? false,
    rescue: () => einstellungenRettung?.rescue() ?? false,
    register: () => () => undefined,
  });
</script>

<div class="space-y-8">
  <div class="flex flex-wrap items-center justify-between gap-3 print:hidden">
    <StatusNotice {message} kind={messageKind} class="min-w-0 flex-1" popup />
    <ReloadButton resource={essensplanungSteuerung} />
  </div>

  <LoadState
    data={store.data}
    loading={store.loading}
    error={store.error}
    loadingText="Steuerung wird geladen …"
    onretry={() => void essensplanungSteuerung.load({ force: true })}
  >
    {#snippet skeleton()}
      <div class="space-y-4">
        <div class="skeleton-element h-40 rounded-[var(--radius-lg)]"></div>
        <div class="skeleton-element h-96 rounded-[var(--radius-lg)]"></div>
      </div>
    {/snippet}
    {#snippet children(data)}
      <EssenEinstellungenForm
        {data}
        {onnotice}
        onrescue={(rettung) => (einstellungenRettung = rettung)}
      />
      <EssenPlanungen {data} {onnotice} />
      <EssenZutaten {data} {onnotice} />
      <div class="grid gap-8 lg:grid-cols-2">
        <EssenListe
          {onnotice}
          liste="kategorien"
          title="Kategorien"
          intro="Wie im Supermarkt; die Einkaufsliste ist danach sortiert. Eine Kategorie lässt sich erst löschen, wenn keine Zutat mehr dazugehört."
          items={data.kategorien}
        />
        <EssenListe
          {onnotice}
          liste="unvertraeglichkeiten"
          title="Allergene und Unverträglichkeiten"
          intro="Die 14 Hauptallergene der EU sind fest dabei und lassen sich nur umbenennen. Weitere, z. B. Fructose, kannst du ergänzen."
          items={data.unvertraeglichkeiten}
        />
      </div>
      <EssenProtokoll entries={data.log} />
    {/snippet}
  </LoadState>
</div>
