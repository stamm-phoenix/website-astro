<script lang="ts">
  import { aktionTitles } from '../../lib/campflowFields';
  import StaffPageHead from '../StaffPageHead.svelte';
  import {
    validateBeleg,
    decisionMessage,
    knownBelegAktion,
    type BelegForm,
    type CampflowChoice,
  } from '../../lib/belegForm';
  import { createBelegPhotoDraft } from '../../lib/belegPhotoDraft.svelte';
  import BelegFields from './BelegFields.svelte';
  import BelegList from './BelegList.svelte';
  import BelegPhotoSection from './BelegPhotoSection.svelte';
  import BelegReview from './BelegReview.svelte';
  import BelegCampflowDialog from './BelegCampflowDialog.svelte';
  import BelegCampflowListe from './BelegCampflowListe.svelte';

  import ReloadButton from './ReloadButton.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import ReloadAction from '../ui/ReloadAction.svelte';

  import ActionButton from '../ui/ActionButton.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import { untrack } from 'svelte';
  import { fetchApi, sendApi } from '../../lib/api';
  import { authStore, fetchPrincipal, getFullName } from '../../lib/authStore.svelte';
  import { confirmAction } from '../../lib/confirm';
  import { createDialogForm } from '../../lib/dialogForm.svelte';
  import { campflowEventsStore, fetchCampflowEvents } from '../../lib/campflowStore.svelte';
  import { belegePflege, campflowBelegeStore } from '../../lib/pflegeStore.svelte';
  import { centToInput, parseEuroToCent } from '../../lib/belege';
  import { formatDateTime, formatEuro, todayIso } from '../../lib/format';
  import type { BelegStatus, CampflowBeleg, StaffBeleg } from '../../lib/types';

  import EditDialog from './EditDialog.svelte';

  import StatusNotice from './StatusNotice.svelte';

  type View = 'offen' | 'angenommen' | 'abgelehnt' | 'alle' | 'campflow';

  const VIEWS: { id: View; label: string }[] = [
    { id: 'offen', label: 'Offen' },
    { id: 'angenommen', label: 'Angenommen' },
    { id: 'abgelehnt', label: 'Abgelehnt' },
    { id: 'alle', label: 'Alle' },
    { id: 'campflow', label: 'In CampFlow' },
  ];
  const VIEW_STATUS: Record<Exclude<View, 'alle' | 'campflow'>, BelegStatus> = {
    offen: 'Eingereicht',
    angenommen: 'Angenommen',
    abgelehnt: 'Abgelehnt',
  };
  const store = belegePflege.state;
  /** Every receipt in CampFlow, read-only, also those uploaded there directly. */
  const campflowStore = campflowBelegeStore.state;
  let openCampflow = $state<CampflowBeleg | null>(null);
  let campflowNotice = $state('');

  let view = $state<View>('offen');
  /** Member of the Kasse: sees all receipts and accepts or rejects them. */
  let reviewer = $state(false);
  let onlyMine = $state(false);
  let search = $state('');
  let form = $state<BelegForm | null>(null);
  let editDialog = $state<EditDialog | null>(null);
  let confirmedAktion = $state<string | null>(null);
  const dialog = createDialogForm();
  const photo = createBelegPhotoDraft({
    form: () => form,
    dialog,
    notice: (value) => (dialogNotice = value),
    applyPhoto,
  });
  const errors = $derived(dialog.state.fields);
  const busy = $derived(dialog.state.busy);
  let dialogNotice = $state<string | null>(null);
  let message = $state<string | null>(null);
  /** Photo being scanned; raw because the pixel arrays are large. */
  const login = $derived(authStore.principal?.userDetails ?? '');
  const items = $derived(store.data ?? []);
  const counts = $derived({
    offen: items.filter((b) => b.status === 'Eingereicht').length,
    angenommen: items.filter((b) => b.status === 'Angenommen').length,
    abgelehnt: items.filter((b) => b.status === 'Abgelehnt').length,
    alle: items.length,
    campflow: campflowStore.data?.belege.length ?? 0,
  });
  const matches = (b: { shop: string; aktion: string; paidBy: string; note: string }): boolean => {
    const query = search.trim().toLowerCase();
    return (
      !query ||
      [b.shop, b.aktion, b.paidBy, b.note].some((text) => text.toLowerCase().includes(query))
    );
  };
  const visible = $derived.by(() => {
    if (view === 'campflow') return [];
    const currentView = view;
    return items
      .filter((b) => currentView === 'alle' || b.status === VIEW_STATUS[currentView])
      .filter((b) => !onlyMine || b.submittedBy === login)
      .filter(matches);
  });
  const aktionSuggestions = $derived(aktionTitles(campflowEventsStore.data ?? []));

  $effect(() => {
    untrack(() => {
      // Only suggestions; the form works without CampFlow. They follow the list, so it comes
      // first, and are there by the time a receipt is opened (which also asks for them)
      void belegePflege.load().finally(() => fetchCampflowEvents());
      void campflowBelegeStore.load({ param: false });
      fetchPrincipal();
      fetchApi<{ reviewer: boolean }>('/intern/pflege/belege/rolle')
        .then((role) => (reviewer = role.reviewer))
        .catch(() => undefined);
    });
  });

  function resetDialog(): void {
    // The suggestions of the form, in case the list is still loading
    void fetchCampflowEvents();
    photo.reset();
    dialog.reset();
    dialogNotice = null;
    confirmedAktion = null;
  }

  function create(): void {
    resetDialog();
    const principal = authStore.principal;
    form = {
      id: null,
      etag: '',
      shop: '',
      date: todayIso(),
      amount: '',
      paidBy: principal ? (getFullName(principal) ?? '') : '',
      payout: null,
      aktion: '',
      note: '',
      status: 'Eingereicht',
      reviewNote: '',
      hasImage: false,
      hasOriginal: false,
      submittedBy: '',
      submittedAt: '',
      aiCheck: null,
      campflow: null,
    };
  }

  function edit(beleg: StaffBeleg): void {
    resetDialog();
    form = { ...beleg, amount: centToInput(beleg.amountCent) };
    confirmedAktion = beleg.aktion.trim();
  }

  /** After a conflict: replaces the input with the current version of the receipt. */
  async function reloadCurrent(): Promise<boolean> {
    const id = form?.id;
    await belegePflege.load({ force: true });
    const fresh = store.data?.find((b) => b.id === id);
    if (!fresh) {
      form = null;
      photo.clearDraft();
      message = 'Der Beleg wurde inzwischen gelöscht.';
      return false;
    }
    edit(fresh);
    return true;
  }

  function close(): void {
    if (busy || photo.photoBusy) return;
    form = null;
    photo.clearDraft();
  }

  /** Keep the exact write version and derived photo metadata without replacing draft fields. */
  function applyPhoto(saved: StaffBeleg): void {
    if (form?.id === saved.id) {
      editDialog?.acceptRescueVersion(form.etag, saved.etag);
      form.etag = saved.etag;
      form.aiCheck = saved.aiCheck;
      form.hasImage = saved.hasImage;
      form.hasOriginal = saved.hasOriginal;
    }
    if (store.data) store.data = store.data.map((beleg) => (beleg.id === saved.id ? saved : beleg));
  }

  /** Saves the receipt; `decision` accepts, rejects or resubmits it at the same time. */
  async function save(decision?: BelegStatus): Promise<void> {
    if (!form) return;
    const previousStatus = form.status;
    if (decision) form.status = decision;
    if (dialog.invalid(validateBeleg(form, !!photo.draft?.result))) {
      form.status = previousStatus;
      return;
    }

    const actionName = form.aktion.trim();
    if (!knownBelegAktion(actionName, aktionSuggestions) && confirmedAktion !== actionName) {
      const accepted = await confirmAction({
        title: 'Aktion prüfen',
        message: `„${actionName}“ steht nicht in der Aktionsliste. Ist damit klar, wofür der Beleg ist? Sonst beschreibe den Zweck genauer, z. B. „Gruppenstunde Wölflinge“.`,
        confirmLabel:
          decision === 'Angenommen'
            ? 'Annehmen'
            : decision === 'Abgelehnt'
              ? 'Ablehnen'
              : decision === 'Eingereicht'
                ? 'Erneut einreichen'
                : form.id
                  ? 'So speichern'
                  : 'So einreichen',
        cancelLabel: 'Weiter bearbeiten',
        tone: 'neutral',
      });
      if (!accepted || !form) {
        if (form) form.status = previousStatus;
        return;
      }
      confirmedAktion = actionName;
    }

    const { id, etag, shop, date, paidBy, payout, aktion, note, status, reviewNote, submittedBy } =
      form;
    const details = {
      shop,
      date,
      amountCent: parseEuroToCent(form.amount),
      paidBy,
      payout,
      aktion,
      note,
    };
    const saved = await dialog.run(async () => {
      if (id) {
        // A new photo chosen for this receipt is saved first, so a decision never discards it
        if (photo.draft?.result) {
          const savedPhoto = await sendApi<StaffBeleg>(
            'PUT',
            `/intern/pflege/belege/${id}/foto`,
            await photo.photoPayload(photo.draft),
            {
              etag,
            }
          );
          photo.clearDraft();
          applyPhoto(savedPhoto);
        }
        const result = await sendApi<{ mailed: boolean }>('PATCH', `/intern/pflege/belege/${id}`, {
          ...details,
          etag: form?.etag ?? etag,
          status,
          reviewNote,
        });
        message = decisionMessage(shop, decision, result?.mailed === true, submittedBy);
      } else {
        await sendApi('POST', '/intern/pflege/belege', {
          ...details,
          ...(await photo.photoPayload(photo.draft!)),
        });
        message = `Beleg von ${shop} über ${formatEuro(details.amountCent!)} eingereicht. Danke!`;
        view = 'offen';
      }
      form = null;
      photo.clearDraft();
      await belegePflege.load({ force: true });
    }, 'Der Beleg wurde nicht gespeichert. Deine Eingaben und das Foto sind noch da. Prüfe deine Internetverbindung und versuche es noch einmal.');
    if (!saved && form) form.status = previousStatus;
  }

  /**
   * Saves pending changes of the accepted receipt, then has the API upload it to CampFlow and
   * delete it here. The API checks the version, so CampFlow gets exactly what was saved.
   */
  async function transfer(choice: CampflowChoice): Promise<void> {
    const current = form;
    if (!current?.id || photo.photoBusy) return;
    if (photo.draft) {
      dialogNotice = 'Bitte zuerst das neue Foto speichern.';
      return;
    }
    if (dialog.invalid(validateBeleg(current, false))) return;
    const { id, shop } = current;
    /** Version after saving the form's changes, which the form then holds as well. */
    let saved: string | null = null;
    await dialog.run(async () => {
      const unchanged = store.data?.find((b) => b.id === id);
      let etag = current.etag;
      if (!unchanged || belegChanged(current, unchanged)) {
        const patched = await sendApi<{ etag?: string }>('PATCH', `/intern/pflege/belege/${id}`, {
          shop: current.shop,
          date: current.date,
          amountCent: parseEuroToCent(current.amount),
          paidBy: current.paidBy,
          payout: current.payout,
          aktion: current.aktion,
          note: current.note,
          etag,
          status: current.status,
          reviewNote: current.reviewNote,
        });
        // Only the version this save wrote: a reloaded list could carry someone else's change
        if (!patched?.etag) throw new Error('Keine Version nach dem Speichern');
        etag = patched.etag;
        saved = etag;
      }
      const result = await sendApi<{
        campflow: { state: string; number: string | null };
        created: boolean;
        deleted: boolean;
      }>('POST', `/intern/pflege/belege/${id}/campflow`, { etag, ...choice });
      const number = result?.campflow.number ?? '';
      message =
        result?.campflow.state !== 'Hochgeladen'
          ? `Beleg von ${shop}: Gerade läuft ein weiterer Versuch, ihn zu übertragen. Lade die Seite gleich neu, um das Ergebnis zu sehen.`
          : result?.deleted
            ? `Beleg von ${shop} ist in CampFlow als ${number} gebucht und wurde hier gelöscht.`
            : `Beleg von ${shop} ist in CampFlow als ${number} gebucht, aber mit einem früheren Stand. Er wurde danach geändert und bleibt deshalb hier, bis du CampFlow geprüft hast.`;
      form = null;
      // The Playwright API reads CampFlow again after an upload
      await Promise.all([
        belegePflege.load({ force: true }),
        campflowBelegeStore.load({ force: true, param: false }),
      ]);
    }, 'Der Beleg wurde nicht übertragen. Prüfe deine Internetverbindung und versuche es noch einmal.');
    // The attempt is stored either way; show its state
    if (form?.id === id) {
      await belegePflege.load({ force: true });
      const fresh = store.data?.find((b) => b.id === id);
      if (fresh && form) {
        form.campflow = fresh.campflow;
        if (saved) {
          editDialog?.acceptRescueVersion(form.etag, saved);
          form.etag = saved;
        }
      } else if (!fresh && store.data && !store.error) {
        // The answer was lost, but the transfer went through and deleted the receipt here
        form = null;
        message = `Beleg von ${shop} ist hier nicht mehr vorhanden: Er wurde nach CampFlow übertragen und danach gelöscht. Du findest ihn unter „In CampFlow“.`;
        void campflowBelegeStore.load({ force: true, param: false });
      }
    }
  }

  /** Whether the form differs from the stored receipt in a field the API saves. */
  function belegChanged(current: BelegForm, stored: StaffBeleg): boolean {
    return (
      current.shop !== stored.shop ||
      current.date !== stored.date ||
      parseEuroToCent(current.amount) !== stored.amountCent ||
      current.paidBy !== stored.paidBy ||
      current.payout !== stored.payout ||
      current.aktion !== stored.aktion ||
      current.note !== stored.note ||
      current.reviewNote !== stored.reviewNote ||
      current.etag !== stored.etag
    );
  }

  /** Reads CampFlow again instead of the Playwright API's last read. */
  async function refreshCampflow(): Promise<void> {
    campflowNotice = '';
    await campflowBelegeStore.load({ force: true, param: true });
    if (!campflowStore.error) campflowNotice = 'Belege neu aus CampFlow geladen.';
  }

  async function remove(): Promise<void> {
    const current = form;
    if (!current?.id || photo.photoBusy) return;
    await dialog.run(async () => {
      await sendApi('DELETE', `/intern/pflege/belege/${current.id}`, undefined, {
        etag: current.etag,
      });
      message = `Beleg von ${current.shop} gelöscht.`;
      form = null;
      await belegePflege.load({ force: true });
    }, 'Der Beleg wurde nicht gelöscht. Tippe noch einmal auf „Löschen“.');
  }
</script>

<StaffPageHead href="/leitendenbereich/belege">
  {#snippet actions()}
    <ActionButton variant="primary" type="button" disabled={!store.data} onclick={create}
      >Beleg einreichen</ActionButton
    >
    <a href="/leitendenbereich/eigenbeleg" class="btn-secondary">Eigenbeleg erstellen</a>
    {#if view !== 'campflow'}
      <ReloadButton resource={belegePflege} />
    {/if}
  {/snippet}
</StaffPageHead>
<div class="space-y-6">
  <form
    class="surface grid gap-4 p-4"
    role="search"
    aria-label="Belege filtern"
    onsubmit={(event) => event.preventDefault()}
  >
    <label class="block text-sm">
      <span class="font-semibold text-neutral-700">Suche</span>
      <input
        type="search"
        class="form-input"
        placeholder="Geschäft, Aktion, Person …"
        bind:value={search}
      />
    </label>
    <div class="flex flex-wrap items-center gap-1.5 sm:col-span-2">
      <FilterTabs
        label="Nach Status filtern"
        options={VIEWS.map((option) => ({
          value: option.id,
          label: option.label,
          count: (option.id === 'campflow' ? campflowStore.data : store.data)
            ? counts[option.id]
            : undefined,
        }))}
        value={view}
        onselect={(value) => (view = value)}
      />
      <label class="ml-auto inline-flex items-center gap-2 text-sm">
        <input type="checkbox" bind:checked={onlyMine} disabled={!login} />
        Nur meine Belege
      </label>
    </div>
  </form>

  <StatusNotice {message} popup />

  {#if view === 'campflow'}
    <div
      class="flex flex-col gap-2 border-b border-neutral-200 pb-4 text-sm text-neutral-700 sm:flex-row sm:items-center sm:justify-between"
    >
      <p>
        Nur zum Nachschauen. Buchen und Auslagen erstatten geht weiterhin in
        <a
          href="https://my.campflow.de/dpsg-stamm-phoenix-5629/finance/receipts"
          class="text-link underline underline-offset-4"
          target="_blank"
          rel="noopener">CampFlow</a
        >.
      </p>
      {#if campflowStore.data}
        <span class="flex flex-wrap items-center gap-x-2">
          <span data-testid="campflow-belege-stand"
            >Stand aus CampFlow: {formatDateTime(campflowStore.data.loadedAt)} Uhr</span
          >
          <ReloadAction disabled={campflowStore.loading} onclick={refreshCampflow}>
            {campflowStore.loading ? 'Lädt … (bis zu 30 Sekunden)' : 'Neu aus CampFlow laden'}
          </ReloadAction>
        </span>
      {/if}
    </div>
    <p role="status" aria-live="polite" class="text-sm font-semibold text-success empty:hidden">
      {campflowNotice}
    </p>
    <LoadState
      data={campflowStore.data}
      loading={campflowStore.loading}
      error={campflowStore.error}
      loadingText="Belege werden aus CampFlow geladen …"
      onretry={() => void campflowBelegeStore.load({ force: true, param: false })}
    >
      {#snippet skeleton()}
        <div class="space-y-2">
          {#each [1, 2, 3, 4] as n (n)}
            <div class="skeleton-element h-16 rounded-[var(--radius-lg)]"></div>
          {/each}
        </div>
      {/snippet}
      {#if campflowStore.data}
        <BelegCampflowListe
          data={campflowStore.data}
          {search}
          {onlyMine}
          onopen={(beleg) => (openCampflow = beleg)}
        />
      {/if}
    </LoadState>
  {:else}
    <LoadState
      data={store.data}
      loading={store.loading}
      error={store.error}
      loadingText="Belege werden geladen …"
      onretry={() => void belegePflege.load({ force: true })}
      isEmpty={() => visible.length === 0}
    >
      {#snippet skeleton()}
        <div class="grid min-h-[60dvh] gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {#each [1, 2, 3] as n (n)}
            <div class="skeleton-element h-28 rounded-[var(--radius-lg)]"></div>
          {/each}
        </div>
      {/snippet}
      {#snippet empty()}
        <p class="surface p-6 text-sm text-neutral-700">
          {view === 'offen' && !search && !onlyMine
            ? 'Keine offenen Belege. Alles vorgeprüft!'
            : 'Keine Belege für diese Auswahl.'}
        </p>
      {/snippet}
      <BelegList items={visible} onedit={edit} />
    </LoadState>
  {/if}
</div>

<EditDialog
  bind:this={editDialog}
  open={form !== null}
  title={form?.id ? `Beleg von ${form.shop || 'unbekannt'}` : 'Beleg einreichen'}
  rescueKey={form ? `beleg:${form.id ?? 'neu'}` : undefined}
  rescueVersion={form?.etag}
  rescueWarning={photo.draft
    ? 'Das ausgewählte Foto und sein Zuschnitt werden nicht gesichert. Wähle das Foto nach der neuen Anmeldung erneut aus und schneide es wieder zu.'
    : null}
  busy={busy || photo.photoBusy}
  error={dialog.state.error}
  notice={dialogNotice}
  onreload={dialog.state.conflict ? reloadCurrent : undefined}
  submitLabel={form?.id ? 'Speichern' : 'Einreichen'}
  busyLabel={form?.id ? 'Wird gespeichert …' : 'Wird hochgeladen …'}
  dirty={photo.draft !== null}
  onsubmit={() => save()}
  onclose={close}
  ondelete={form?.id && (reviewer || form.status !== 'Angenommen') ? remove : undefined}
  deleteTitle={`Beleg von ${form?.shop || 'unbekannt'} löschen?`}
  deleteQuestion={form?.campflow?.state === 'Hochgeladen'
    ? `In CampFlow steht Beleg ${form.campflow.number} mit dem Stand der Übertragung. Prüfe dort, ob spätere Änderungen übernommen sind, bevor du ihn hier löschst. Diesen Beleg endgültig löschen?`
    : 'Diesen Beleg endgültig löschen?'}
>
  {#if form}
    <BelegPhotoSection {form} {photo} {busy} {errors} />

    <BelegFields
      bind:form
      {errors}
      {aktionSuggestions}
      onfield={(field) => dialog.clearField(field)}
      onpayment={() => dialog.clearField('payout')}
    />

    <BelegReview
      bind:form
      {reviewer}
      busy={busy || photo.photoBusy}
      {errors}
      onsave={save}
      ontransfer={transfer}
    />
  {/if}
</EditDialog>

<BelegCampflowDialog beleg={openCampflow} onclose={() => (openCampflow = null)} />
