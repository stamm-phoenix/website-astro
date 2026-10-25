<script lang="ts">
  import ReloadAction from '../ui/ReloadAction.svelte';
  import { tick, untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import { ApiError, sendApi } from '../../lib/api';
  import { createDialogForm, dialogMessage } from '../../lib/dialogForm.svelte';
  import { offeneBeitraegeStore, personenPflege } from '../../lib/pflegeStore.svelte';
  import { forgetAbrechnungen } from '../../lib/abrechnungStore.svelte';
  import { forgetCampflowEvents } from '../../lib/campflowStore.svelte';
  import { reloadIch } from '../../lib/ichStore.svelte';
  import { PERSON_GRUPPE_LABELS } from '../../lib/protokollEditor';
  import { campflowVorschlaege, mitgliedName } from '../../lib/personen';
  import type { CampflowMitglied, LeitendenKonto, Person } from '../../lib/types';
  import EditDialog from './EditDialog.svelte';
  import FormField from './FormField.svelte';
  import StatusNotice from './StatusNotice.svelte';
  import InfoHint from '../ui/InfoHint.svelte';

  /**
   * Personen (`docs/personen.md`): links the Microsoft account of every leader to their person
   * in the CampFlow member list, so modules recognize the logged-in person in CampFlow. Also
   * keeps Altleitende and others who take part regularly but are not in the Entra group of the
   * leaders; the Protokoll-Editor offers the active ones for every name.
   */

  interface Form {
    id: number | null;
    etag: string;
    name: string;
    login: string;
    gruppe: Person['gruppe'];
    campflowPersonId: string;
    aktiv: boolean;
    /** A leader of the Entra group: name and login come from there. */
    konto: boolean;
  }

  const store = personenPflege.state;
  let form = $state<Form | null>(null);
  /** The CampFlow person when the dialog opened, to notice a changed or removed link. */
  let campflowBeimOeffnen = $state('');
  let message = $state<string | null>(null);
  let suche = $state('');
  let applying = $state(false);
  const dialog = createDialogForm(
    (error, fallback) =>
      (error instanceof ApiError && error.fields?.etag) || dialogMessage(error, fallback)
  );
  const errors = $derived(dialog.state.fields);
  const busy = $derived(dialog.state.busy || applying);

  const personen = $derived(store.data?.personen ?? []);
  const mitglieder = $derived(store.data?.campflow ?? null);
  const konten = $derived(store.data?.leitende ?? null);
  const byLogin = $derived(new Map(personen.filter((p) => p.login).map((p) => [p.login, p])));
  const byId = $derived(new Map((mitglieder ?? []).map((m) => [m.id, m])));
  const kontoLogins = $derived(new Set((konten ?? []).map((k) => k.login)));
  const vorschlaege = $derived(
    konten && mitglieder ? campflowVorschlaege(konten, personen, mitglieder) : new Map()
  );
  const verknuepft = $derived(
    (konten ?? []).filter((k) => byLogin.get(k.login)?.campflowPersonId).length
  );
  /** Rows of leaders whose account is no longer in the Entra group. */
  const ehemalige = $derived(
    konten
      ? personen.filter((p) => p.gruppe === 'leitende' && !kontoLogins.has(p.login))
      : // Without the Entra group nobody can be said to have left it
        []
  );
  /** Someone in the Entra group is listed as a leader, whatever group their row has. */
  const gruppen = $derived(
    (['altleitende', 'weitere'] as const).map((gruppe) => ({
      gruppe,
      personen: personen.filter((p) => p.gruppe === gruppe && !kontoLogins.has(p.login)),
    }))
  );
  const TREFFER_GRUPPEN = ['Leiter*in', 'Weitere Mitglieder', 'Ausgetreten'];
  /** Most matches shown; the search narrows them down. */
  const MAX_TREFFER = 8;
  function trefferGruppe(m: CampflowMitglied): string {
    if (m.ausgetreten) return 'Ausgetreten';
    return m.groups.some((g) => /leiter/i.test(g)) ? 'Leiter*in' : 'Weitere Mitglieder';
  }
  /** Members whose name contains the search, leaders first; shown in the dialog itself. */
  const treffer = $derived.by(() => {
    const search = suche.trim().toLocaleLowerCase('de');
    if (!search) return [];
    return (mitglieder ?? [])
      .filter((m) => mitgliedName(m).toLocaleLowerCase('de').includes(search))
      .sort(
        (a, b) =>
          TREFFER_GRUPPEN.indexOf(trefferGruppe(a)) - TREFFER_GRUPPEN.indexOf(trefferGruppe(b))
      );
  });

  $effect(() => {
    untrack(() => void personenPflege.load());
  });

  /** How a CampFlow link is shown in the lists. */
  function campflowText(id: string): { text: string; tone: 'success' | 'warning' | 'neutral' } {
    if (!id) return { text: 'Nicht mit CampFlow verknüpft', tone: 'neutral' };
    if (!mitglieder) return { text: 'Mit CampFlow verknüpft', tone: 'success' };
    const mitglied = byId.get(id);
    if (!mitglied) return { text: 'CampFlow-Person nicht mehr gefunden', tone: 'warning' };
    if (mitglied.ausgetreten)
      return { text: `CampFlow: ${mitgliedName(mitglied)}, ausgetreten`, tone: 'warning' };
    return { text: `CampFlow: ${mitgliedName(mitglied)}`, tone: 'success' };
  }

  function open(person?: Person, konto?: LeitendenKonto): void {
    suche = '';
    if (person) {
      form = {
        id: person.id,
        etag: person.etag,
        name: konto?.name ?? person.name,
        login: person.login,
        gruppe: konto ? 'leitende' : person.gruppe,
        campflowPersonId: person.campflowPersonId,
        aktiv: konto ? true : person.aktiv,
        konto: !!konto,
      };
    } else if (konto) {
      form = {
        id: null,
        etag: '',
        name: konto.name,
        login: konto.login,
        gruppe: 'leitende',
        campflowPersonId: vorschlaege.get(konto.login)?.id ?? '',
        aktiv: true,
        konto: true,
      };
    } else {
      form = {
        id: null,
        etag: '',
        name: '',
        login: '',
        gruppe: 'altleitende',
        campflowPersonId: '',
        aktiv: true,
        konto: false,
      };
    }
    campflowBeimOeffnen = form.campflowPersonId;
    dialog.reset();
  }

  function close(): void {
    if (!busy) form = null;
  }

  /**
   * A saved link changes who the logged-in person is in CampFlow: load it again and forget the
   * loaded Aktionen and Abrechnungen, whose own registrations (`ich`) came with the former link.
   */
  function linkChanged(): void {
    reloadIch();
    forgetCampflowEvents();
    forgetAbrechnungen();
    // The start page asks again which Beiträge are the own ones
    offeneBeitraegeStore.invalidate();
  }

  /** After a conflict: replaces the input with the current version of the person. */
  async function reloadCurrent(): Promise<boolean> {
    const id = form?.id;
    const login = form?.konto ? form.login : undefined;
    await personenPflege.load({ force: true });
    const fresh = personen.find((p) => p.id === id);
    if (!fresh) {
      form = null;
      message = 'Die Person wurde inzwischen gelöscht.';
      return false;
    }
    open(
      fresh,
      konten?.find((k) => k.login === login)
    );
    return true;
  }

  function body(input: Form): Record<string, unknown> {
    const { name, login, gruppe, campflowPersonId, aktiv, etag } = input;
    return { name, login, gruppe, campflowPersonId, aktiv, etag };
  }

  async function save(): Promise<void> {
    if (!form || busy) return;
    if (dialog.invalid(form.name.trim() ? {} : { name: 'Bitte einen Namen angeben.' })) {
      await tick();
      document.getElementById('person-name')?.focus();
      return;
    }
    const current = form;
    await dialog.run(async () => {
      if (current.id)
        await sendApi('PATCH', `/intern/pflege/personen/${current.id}`, body(current));
      else await sendApi('POST', '/intern/pflege/personen', body(current));
      message = `${current.name.trim()} gespeichert.`;
      form = null;
      await personenPflege.load({ force: true });
      linkChanged();
    }, 'Die Person wurde nicht gespeichert. Deine Eingaben sind noch da. Tippe noch einmal auf „Speichern“.');
  }

  async function remove(): Promise<void> {
    const current = form;
    if (!current?.id || busy) return;
    await dialog.run(async () => {
      await sendApi('DELETE', `/intern/pflege/personen/${current.id}`, undefined, {
        etag: current.etag,
      });
      message = current.konto
        ? `Die Verknüpfung von ${current.name.trim()} ist gelöscht.`
        : `${current.name.trim()} gelöscht. In alten Protokollen bleibt der Name stehen.`;
      form = null;
      await personenPflege.load({ force: true });
      linkChanged();
    }, 'Die Person wurde nicht gelöscht. Tippe noch einmal auf „Löschen“.');
  }

  /** Saves every suggestion one by one; one that fails leaves the others saved. */
  async function applyVorschlaege(): Promise<void> {
    if (busy || !konten) return;
    applying = true;
    let saved = 0;
    let failed = 0;
    try {
      for (const konto of konten) {
        const mitglied: CampflowMitglied | undefined = vorschlaege.get(konto.login);
        if (!mitglied) continue;
        const row = byLogin.get(konto.login);
        const input = {
          name: konto.name,
          login: konto.login,
          gruppe: 'leitende',
          campflowPersonId: mitglied.id,
          aktiv: true,
        };
        try {
          if (row)
            await sendApi('PATCH', `/intern/pflege/personen/${row.id}`, {
              ...input,
              etag: row.etag,
            });
          else await sendApi('POST', '/intern/pflege/personen', input);
          saved++;
        } catch {
          failed++;
        }
      }
      message =
        failed === 0
          ? `${saved} ${saved === 1 ? 'Vorschlag' : 'Vorschläge'} übernommen.`
          : `${saved} übernommen, ${failed} nicht gespeichert. Bitte die übrigen einzeln verknüpfen.`;
    } finally {
      applying = false;
      await personenPflege.load({ force: true });
      linkChanged();
    }
  }

  function pickCampflow(mitglied: CampflowMitglied): void {
    if (!form) return;
    form.campflowPersonId = mitglied.id;
    suche = '';
    // The search field goes away; keep the focus in the dialog
    void tick().then(() => document.getElementById('person-campflow-andere')?.focus());
  }

  const gewaehlt = $derived(form?.campflowPersonId ? byId.get(form.campflowPersonId) : undefined);
</script>

<div class="space-y-6">
  <div class="flex flex-wrap justify-end gap-2">
    <ReloadAction
      disabled={store.loading || busy}
      onclick={() => void personenPflege.load({ force: true })}>Neu laden</ReloadAction
    >
    <ActionButton variant="primary" disabled={!store.data || busy} onclick={() => open()}
      >Person hinzufügen</ActionButton
    >
  </div>

  <StatusNotice {message} popup />

  <LoadState
    data={store.data}
    loading={store.loading}
    error={store.error}
    loadingText="Personen werden geladen …"
    onretry={() => void personenPflege.load({ force: true })}
  >
    {#if mitglieder === null}
      <p class="border-l-4 border-l-warning py-1 pl-3 text-sm text-neutral-800">
        CampFlow ist gerade nicht erreichbar. Neue Verknüpfungen erst nach „Neu laden“.
      </p>
    {/if}

    <section class="pt-2" aria-labelledby="personen-leitende">
      <h2
        id="personen-leitende"
        class="border-b border-neutral-300 pb-2 font-serif text-xl font-semibold text-brand-900"
      >
        {PERSON_GRUPPE_LABELS.leitende}
      </h2>
      {#if konten === null}
        <p class="py-4 text-sm text-neutral-700">
          Die Gruppe der Leitenden ließ sich nicht laden. Bitte später „Neu laden“.
        </p>
      {:else}
        <p class="pt-3 text-sm text-neutral-700">
          {verknuepft} von {konten.length} Leitenden verknüpft.
        </p>
        {#if vorschlaege.size > 0}
          <div
            class="mt-3 flex flex-col items-start gap-3 border-l-4 border-l-warning py-1 pl-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <p class="text-sm text-neutral-800">
              Für {vorschlaege.size}
              {vorschlaege.size === 1 ? 'Konto gibt' : 'Konten gibt'} es in CampFlow genau eine Person
              mit demselben Namen.
            </p>
            <ActionButton
              variant="secondary"
              class="shrink-0"
              disabled={busy}
              onclick={() => void applyVorschlaege()}
              >{applying ? 'Wird übernommen …' : 'Alle Vorschläge übernehmen'}</ActionButton
            >
          </div>
        {/if}
        <ul class="mt-2 divide-y divide-neutral-200 border-b border-neutral-200">
          {#each konten as konto (konto.login)}
            {@const row = byLogin.get(konto.login)}
            {@const link = campflowText(row?.campflowPersonId ?? '')}
            {@const vorschlag = vorschlaege.get(konto.login)}
            <li
              class="flex flex-col items-start gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="min-w-0">
                <p class="font-semibold text-brand-900 [overflow-wrap:anywhere]">{konto.name}</p>
                <p class="flex flex-wrap gap-x-3 text-sm text-neutral-700">
                  <span class="[overflow-wrap:anywhere]">{konto.login}</span>
                  {#if vorschlag}
                    <StatusLabel
                      label="Vorschlag: {mitgliedName(vorschlag)} ({vorschlag.groups.join(', ') ||
                        'ohne Gruppe'})"
                      tone="warning"
                    />
                  {:else}
                    <StatusLabel label={link.text} tone={link.tone} />
                  {/if}
                </p>
              </div>
              <ActionButton
                variant="secondary"
                class="shrink-0"
                aria-label="{row?.campflowPersonId ? 'Bearbeiten' : 'Verknüpfen'}: {konto.name}"
                disabled={busy}
                onclick={() => open(row, konto)}
                >{row?.campflowPersonId ? 'Bearbeiten' : 'Verknüpfen'}</ActionButton
              >
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if ehemalige.length > 0}
      <section class="pt-2" aria-labelledby="personen-ehemalige">
        <div class="flex items-center gap-1 border-b border-neutral-300 pb-2">
          <h2 id="personen-ehemalige" class="font-serif text-xl font-semibold text-brand-900">
            Nicht mehr in der Gruppe der Leitenden
          </h2>
          <InfoHint
            label="Nicht mehr in der Gruppe der Leitenden"
            text="Über „Bearbeiten“ als Altleitende weiterführen oder löschen."
          />
        </div>
        <ul class="mt-2 divide-y divide-neutral-200 border-b border-neutral-200">
          {#each ehemalige as person (person.id)}
            {@const link = campflowText(person.campflowPersonId)}
            <li
              class="flex flex-col items-start gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="min-w-0">
                <p class="font-semibold text-brand-900 [overflow-wrap:anywhere]">{person.name}</p>
                <p class="flex flex-wrap gap-x-3 text-sm text-neutral-700">
                  <span class="[overflow-wrap:anywhere]">{person.login}</span>
                  <StatusLabel label={link.text} tone={link.tone} />
                </p>
              </div>
              <ActionButton
                variant="secondary"
                class="shrink-0"
                aria-label="Bearbeiten: {person.name}"
                disabled={busy}
                onclick={() => open(person)}>Bearbeiten</ActionButton
              >
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#each gruppen as { gruppe, personen: liste } (gruppe)}
      <section class="pt-2" aria-labelledby="personen-{gruppe}">
        <h2
          id="personen-{gruppe}"
          class="border-b border-neutral-300 pb-2 font-serif text-xl font-semibold text-brand-900"
        >
          {PERSON_GRUPPE_LABELS[gruppe]}
        </h2>
        {#if liste.length === 0}
          <p class="py-4 text-sm text-neutral-700">Niemand eingetragen.</p>
        {:else}
          <ul class="divide-y divide-neutral-200 border-b border-neutral-200">
            {#each liste as person (person.id)}
              {@const link = campflowText(person.campflowPersonId)}
              <li
                class="flex flex-col items-start gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div class="min-w-0">
                  <p class="font-semibold text-brand-900 [overflow-wrap:anywhere]">
                    {person.name}
                  </p>
                  <p class="flex flex-wrap gap-x-3 text-sm text-neutral-700">
                    {#if person.login}<span class="[overflow-wrap:anywhere]">{person.login}</span
                      >{/if}
                    <StatusLabel
                      label={person.aktiv ? 'Wird angeboten' : 'Inaktiv'}
                      tone={person.aktiv ? 'success' : 'neutral'}
                    />
                    {#if person.campflowPersonId}
                      <StatusLabel label={link.text} tone={link.tone} />
                    {/if}
                  </p>
                </div>
                <ActionButton
                  variant="secondary"
                  class="shrink-0"
                  aria-label="Bearbeiten: {person.name}"
                  disabled={busy}
                  onclick={() => open(person)}>Bearbeiten</ActionButton
                >
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/each}
  </LoadState>
</div>

<EditDialog
  open={form !== null}
  title={form?.konto
    ? `CampFlow-Person von ${form.name}`
    : form?.id
      ? 'Person bearbeiten'
      : 'Person hinzufügen'}
  rescueKey={form ? `person:${form.id ?? (form.konto ? `konto:${form.login}` : 'neu')}` : undefined}
  rescueVersion={form?.etag}
  dirty={form !== null && form.campflowPersonId !== campflowBeimOeffnen}
  rescueFields={[
    {
      key: 'campflowPersonId',
      get: () => form?.campflowPersonId ?? '',
      describe: (value) => {
        const mitglied = value ? byId.get(value) : undefined;
        return `Person in CampFlow: ${mitglied ? mitgliedName(mitglied) : value ? 'gewählt' : 'keine'}`;
      },
      set: (value) => {
        if (!form || (value && !/^per_[A-Za-z0-9]+$/.test(value))) return false;
        form.campflowPersonId = value;
        return true;
      },
    },
  ]}
  {busy}
  error={dialog.state.error}
  onreload={dialog.state.conflict ? reloadCurrent : undefined}
  onsubmit={save}
  onclose={close}
  ondelete={form?.id ? remove : undefined}
  deleteTitle={`„${form?.name.trim() ?? ''}“ löschen?`}
  deleteQuestion={form?.konto
    ? 'Die Verknüpfung mit CampFlow löschen? Das Konto bleibt in der Gruppe der Leitenden.'
    : 'Die Person aus der Liste löschen? In alten Protokollen bleibt der Name stehen.'}
>
  {#if form}
    <fieldset disabled={busy} class="min-w-0 space-y-4">
      <legend class="sr-only">Person</legend>
      {#if form.konto}
        <p class="text-sm text-neutral-700">
          Konto <span class="font-semibold [overflow-wrap:anywhere]">{form.login}</span>
        </p>
        {#if errors.login}
          <!-- The account cannot be edited here, so its error is told in words, e.g. when someone
               else linked it in the meantime -->
          <p class="text-sm font-semibold text-danger" role="alert">
            {errors.login} Es wurde nichts gespeichert. Schließe das Fenster und tippe auf „Neu laden“,
            um die aktuelle Zuordnung zu sehen.
          </p>
        {/if}
      {:else}
        <FormField id="person-name" label="Name" error={errors.name}>
          {#snippet children(attrs)}
            <input
              {...attrs}
              type="text"
              class="form-input"
              maxlength="200"
              bind:value={form!.name}
            />
          {/snippet}
        </FormField>
        <FormField id="person-gruppe" label="Gruppe" error={errors.gruppe}>
          {#snippet children(attrs)}
            <select {...attrs} class="form-input" bind:value={form!.gruppe}>
              {#if form!.gruppe === 'leitende'}
                <option value="leitende">{PERSON_GRUPPE_LABELS.leitende}</option>
              {/if}
              <option value="altleitende">{PERSON_GRUPPE_LABELS.altleitende}</option>
              <option value="weitere">{PERSON_GRUPPE_LABELS.weitere}</option>
            </select>
          {/snippet}
        </FormField>
        <FormField
          id="person-login"
          label="Konto-Adresse"
          optional={form.gruppe !== 'leitende'}
          info="Nur wenn die Person ein Konto bei uns hat."
          error={errors.login}
        >
          {#snippet children(attrs)}
            <input
              {...attrs}
              type="email"
              class="form-input"
              maxlength="254"
              autocomplete="off"
              placeholder="vorname.nachname@stamm-phoenix.de"
              bind:value={form!.login}
            />
          {/snippet}
        </FormField>
      {/if}
      <FormField
        id="person-campflow"
        label="Person in CampFlow"
        optional
        error={errors.campflowPersonId}
      >
        {#snippet children(attrs)}
          {#if form!.campflowPersonId}
            <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span class="font-semibold text-brand-900 [overflow-wrap:anywhere]">
                {gewaehlt
                  ? `${mitgliedName(gewaehlt)}${gewaehlt.groups.length ? ` · ${gewaehlt.groups.join(', ')}` : ''}${gewaehlt.ausgetreten ? ' · ausgetreten' : ''}`
                  : mitglieder
                    ? 'Nicht mehr in der Mitgliederliste'
                    : 'Verknüpft (CampFlow gerade nicht erreichbar)'}
              </span>
              <ActionButton
                id="person-campflow-andere"
                variant="secondary"
                aria-describedby={attrs['aria-describedby']}
                onclick={() => {
                  form!.campflowPersonId = '';
                  void tick().then(() => document.getElementById('person-campflow')?.focus());
                }}>Andere Person wählen</ActionButton
              >
            </div>
          {:else if mitglieder}
            <input
              {...attrs}
              type="search"
              class="form-input"
              autocomplete="off"
              placeholder="Name suchen"
              bind:value={suche}
              onkeydown={(event) => {
                // Enter searches; it never saves the dialog, which would drop the link
                if (event.key !== 'Enter') return;
                event.preventDefault();
                if (treffer.length === 1) pickCampflow(treffer[0]);
              }}
            />
            {#if suche.trim()}
              <div aria-live="polite" class="mt-2">
                {#if treffer.length === 0}
                  <p class="text-sm text-neutral-700">
                    Niemand in der Mitgliederliste heißt so. Bitte anders schreiben, z. B. nur den
                    Nachnamen.
                  </p>
                {:else}
                  <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
                    {#each treffer.slice(0, MAX_TREFFER) as mitglied (mitglied.id)}
                      <li>
                        <button
                          type="button"
                          class="flex min-h-11 w-full flex-col items-start py-2 text-left hover:bg-neutral-100"
                          onclick={() => pickCampflow(mitglied)}
                        >
                          <span class="font-semibold text-brand-900">{mitgliedName(mitglied)}</span>
                          <span class="text-sm text-neutral-700"
                            >{[
                              trefferGruppe(mitglied) === 'Ausgetreten' ? 'ausgetreten' : '',
                              ...mitglied.groups,
                            ]
                              .filter(Boolean)
                              .join(' · ') || 'ohne Gruppe'}</span
                          >
                        </button>
                      </li>
                    {/each}
                  </ul>
                  {#if treffer.length > MAX_TREFFER}
                    <p class="mt-1 text-sm text-neutral-700">
                      {treffer.length - MAX_TREFFER} weitere Treffer. Bitte genauer suchen.
                    </p>
                  {/if}
                {/if}
              </div>
            {/if}
          {:else}
            <p class="text-sm text-neutral-700">
              CampFlow ist gerade nicht erreichbar. Bitte später verknüpfen.
            </p>
          {/if}
        {/snippet}
      </FormField>
      {#if !form.konto}
        <div class="form-field">
          <div class="flex items-center gap-2">
            <label class="flex items-center gap-2 text-sm font-semibold text-neutral-800">
              <input
                id="person-aktiv"
                type="checkbox"
                aria-invalid={errors.aktiv ? 'true' : undefined}
                aria-describedby={errors.aktiv ? 'person-aktiv-error' : undefined}
                bind:checked={form!.aktiv}
              />
              Im Protokoll zur Auswahl anbieten
            </label>
            <InfoHint
              label="Im Protokoll zur Auswahl anbieten"
              text="Inaktive Personen bleiben in alten Protokollen stehen, werden aber nicht mehr angeboten."
            />
          </div>
          {#if errors.aktiv}
            <p id="person-aktiv-error" class="mt-1 text-sm text-danger">{errors.aktiv}</p>
          {/if}
        </div>
      {/if}
    </fieldset>
  {/if}
</EditDialog>
