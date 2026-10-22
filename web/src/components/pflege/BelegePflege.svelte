<script lang="ts">
  import { aktionTitles } from '../../lib/campflowFields';
  import StaffPageHead from '../StaffPageHead.svelte';
  import {
    validateBeleg,
    decisionMessage,
    knownBelegAktion,
    zahlungOf,
    type BelegForm,
    type CampflowChoice,
  } from '../../lib/belegForm';
  import { createBelegPhotoDraft } from '../../lib/belegPhotoDraft.svelte';
  import BelegFields from './BelegFields.svelte';
  import BelegPhotoSection from './BelegPhotoSection.svelte';
  import BelegReview from './BelegReview.svelte';
  import BelegAnsicht from './BelegAnsicht.svelte';
  import BelegCampflowDialog from './BelegCampflowDialog.svelte';
  import BelegUebersicht from './BelegUebersicht.svelte';

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
  import { fetchKostenstellen, kostenstellenStore } from '../../lib/abrechnungStore.svelte';
  import { centToInput, parseEuroToCent } from '../../lib/belege';
  import { formatEuro, todayIso } from '../../lib/format';
  import {
    BELEG_QUELLEN,
    BELEG_STAENDE,
    belegEintraege,
    eintragKostenstellen,
    matchesBelegFilter,
    type BelegEintrag,
    type BelegQuelle,
    type BelegStand,
  } from '../../lib/belegEintraege';
  import { ichStore, isIch } from '../../lib/ichStore.svelte';
  import MessageText from '../ui/MessageText.svelte';
  import Toast from '../ui/Toast.svelte';
  import type { BelegStatus, CampflowBeleg, StaffBeleg } from '../../lib/types';

  import EditDialog from './EditDialog.svelte';

  import StatusNotice from './StatusNotice.svelte';

  type Ansicht = 'liste' | 'galerie';

  const store = belegePflege.state;
  /** Every receipt in CampFlow, read-only, also those uploaded there directly. */
  const campflowStore = campflowBelegeStore.state;
  let openCampflow = $state<CampflowBeleg | null>(null);
  /** A receipt someone else submitted for the user's Auslage, shown read only. */
  let openAnsicht = $state<StaffBeleg | null>(null);
  let reloadNotice = $state<string | null>(null);
  /** The receipt submitted last, kept among the shown entries of the list. */
  let neuerBeleg = $state<string | null>(null);

  let quelle = $state<BelegQuelle | ''>('');
  let stand = $state<BelegStand | ''>('');
  let costUnitId = $state('');
  let categoryId = $state('');
  /** The filters fold away on a phone, so the receipts come first. */
  let filtersOpen = $state(false);
  const activeFilters = $derived([stand, costUnitId, categoryId].filter(Boolean).length);
  /** List or gallery, kept in the address so a reload or a shared link keeps it. */
  let ansicht = $state<Ansicht>('liste');
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
  /** The own name for an Auslage: from the login, else from the linked CampFlow person. */
  const myName = $derived.by(() => {
    const fromLogin = authStore.principal ? getFullName(authStore.principal) : null;
    if (fromLogin) return fromLogin;
    const linked = ichStore.ich?.campflow;
    return linked ? `${linked.firstName} ${linked.lastName}`.trim() : '';
  });

  // The name may arrive after „Mit meinem Geld“ was chosen
  $effect(() => {
    if (form?.zahlung === 'ich' && !form.paidBy.trim() && myName) form.paidBy = myName;
  });
  const eintraege = $derived(belegEintraege(store.data ?? [], campflowStore.data, { isIch }));
  const kostenstellen = $derived(eintragKostenstellen(eintraege, campflowStore.data));
  const kategorien = $derived(kostenstellen.find((k) => k.id === costUnitId)?.categories ?? []);
  /** All filters but the source, whose tabs count what the others leave. */
  const gefiltert = $derived(
    eintraege.filter((e) =>
      matchesBelegFilter(e, { stand, costUnitId, categoryId, search, onlyMine })
    )
  );
  const visible = $derived(quelle ? gefiltert.filter((e) => e.quelle === quelle) : gefiltert);
  const reloading = $derived(store.loading || campflowStore.loading);
  /** Changes with every load, so previews that failed are tried again after „Neu laden“. */
  const geladen = $derived(`${store.loadedAt ?? ''}|${campflowStore.loadedAt ?? ''}`);

  $effect(() => {
    // A Kostenstelle or Kategorie gone after reloading would hide receipts without a visible filter
    if (costUnitId && campflowStore.data && !kostenstellen.some((k) => k.id === costUnitId)) {
      costUnitId = '';
    }
    if (categoryId && !kategorien.some((c) => c.id === categoryId)) categoryId = '';
  });

  function readAnsicht(): void {
    ansicht =
      new URLSearchParams(window.location.search).get('ansicht') === 'galerie'
        ? 'galerie'
        : 'liste';
  }

  function selectAnsicht(next: Ansicht): void {
    ansicht = next;
    const url = new URL(window.location.href);
    if (next === 'galerie') url.searchParams.set('ansicht', 'galerie');
    else url.searchParams.delete('ansicht');
    history.replaceState(history.state, '', url);
  }

  function open(eintrag: BelegEintrag): void {
    if (eintrag.beleg?.readOnly) openAnsicht = eintrag.beleg;
    else if (eintrag.beleg) edit(eintrag.beleg);
    else if (eintrag.campflow) openCampflow = eintrag.campflow;
  }

  /** Reloads the receipts here and reads CampFlow again, its Kostenstellen too once loaded. */
  async function reload(): Promise<void> {
    reloadNotice = null;
    await Promise.all([
      belegePflege.load({ force: true }),
      campflowBelegeStore.load({ force: true, param: true }),
      kostenstellenStore.data ? fetchKostenstellen({ refresh: true }) : undefined,
    ]);
    if (!store.error && !campflowStore.error && !kostenstellenStore.error) {
      reloadNotice = 'Belege neu geladen.';
    }
  }

  const aktionSuggestions = $derived(aktionTitles(campflowEventsStore.data ?? []));

  $effect(() => {
    untrack(() => {
      // Only suggestions; the form works without CampFlow. They follow the list, so it comes
      // first, and are there by the time a receipt is opened (which also asks for them)
      void belegePflege.load().finally(() => fetchCampflowEvents());
      void campflowBelegeStore.load({ param: false });
      readAnsicht();
      filtersOpen = window.matchMedia('(min-width: 640px)').matches;
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
    form = {
      id: null,
      etag: '',
      shop: '',
      date: todayIso(),
      amount: '',
      paidBy: '',
      payout: null,
      zahlung: null,
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
    form = { ...beleg, amount: centToInput(beleg.amountCent), zahlung: zahlungOf(beleg, isIch) };
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
    if (photo.zuschnitt) {
      dialogNotice = 'Bitte zuerst das Zuschneiden abschließen.';
      return;
    }
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
    let newId: string | null = null;
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
        // The photo as the check may still turn it upright
        await photo.fertig();
        const created = await sendApi<{ id: string }>('POST', '/intern/pflege/belege', {
          ...details,
          ...(await photo.photoPayload(photo.draft!)),
        });
        message = `Beleg von ${shop} über ${formatEuro(details.amountCent!)} eingereicht. Danke!`;
        newId = created?.id ?? null;
      }
      form = null;
      photo.clearDraft();
      await belegePflege.load({ force: true });
      // The new receipt is to be seen in the list, whatever the filters said
      if (newId) neuerBeleg = `website-${newId}`;
      if (newId && !visible.some((e) => e.key === `website-${newId}`)) {
        quelle = '';
        stand = '';
        costUnitId = '';
        categoryId = '';
        search = '';
        onlyMine = false;
      }
    }, 'Der Beleg wurde nicht gespeichert. Deine Eingaben und das Foto sind noch da. Prüfe deine Internetverbindung und versuche es noch einmal.');
    if (!saved && form) form.status = previousStatus;
  }

  /**
   * Saves pending changes of the accepted receipt, then has the API upload it to CampFlow and
   * delete it here. The API checks the version, so CampFlow gets exactly what was saved.
   */
  /**
   * What the last save before a transfer wrote, with its version. A retry compares with it, as
   * the list may still hold the state before that save.
   */
  let confirmedSave: StaffBeleg | null = null;

  async function transfer(choice: CampflowChoice): Promise<void> {
    const current = form;
    if (!current?.id || photo.photoBusy) return;
    if (photo.draft) {
      dialogNotice = 'Bitte zuerst das neue Foto speichern.';
      return;
    }
    if (dialog.invalid(validateBeleg(current, false))) return;
    const { id, shop } = current;
    await dialog.run(async () => {
      const listed = store.data?.find((b) => b.id === id);
      const stored =
        confirmedSave?.id === id && confirmedSave.etag === current.etag ? confirmedSave : listed;
      let etag = current.etag;
      if (!stored || belegChanged(current, stored)) {
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
        if (listed) {
          confirmedSave = {
            ...listed,
            shop: current.shop,
            date: current.date,
            amountCent: parseEuroToCent(current.amount) ?? listed.amountCent,
            paidBy: current.paidBy,
            payout: current.payout === true,
            aktion: current.aktion,
            note: current.note,
            reviewNote: current.reviewNote,
            etag,
          };
        }
        // Taken over at once, so a retry after a failed transfer saves on top of it
        if (form === current) {
          editDialog?.acceptRescueVersion(current.etag, etag);
          current.etag = etag;
        }
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
      // Closed or replaced by another receipt meanwhile: leave that one alone
      if (form !== current) return;
      const fresh = store.data?.find((b) => b.id === id);
      if (fresh && form) {
        form.campflow = fresh.campflow;
      } else if (!fresh && store.data && !store.error) {
        // Gone: transferred with a lost answer, or deleted by someone else meanwhile
        form = null;
        message = `Beleg von ${shop} ist hier nicht mehr vorhanden. Ob er nach CampFlow übertragen oder nur gelöscht wurde, siehst du unter „In CampFlow“.`;
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
    <ReloadAction
      disabled={reloading}
      aria-busy={reloading}
      loadedAt={campflowStore.data ? Date.parse(campflowStore.data.loadedAt) : store.loadedAt}
      onclick={() => void reload()}
    >
      {reloading && store.data ? 'Lädt …' : 'Neu laden'}
    </ReloadAction>
  {/snippet}
</StaffPageHead>
<Toast message={reloadNotice} onclose={() => (reloadNotice = null)} />
<div class="space-y-6">
  <form
    class="surface grid gap-4 p-4 sm:grid-cols-3"
    role="search"
    aria-label="Belege filtern"
    onsubmit={(event) => event.preventDefault()}
  >
    <label class="block text-sm sm:col-span-3">
      <span class="font-semibold text-neutral-700">Suche</span>
      <input
        type="search"
        class="form-input"
        placeholder="Geschäft, Aktion, Person, Belegnummer …"
        bind:value={search}
      />
    </label>
    <div class="sm:col-span-3">
      <FilterTabs
        label="Nach Quelle filtern"
        options={[
          { value: '', label: 'Alle', count: store.data ? gefiltert.length : undefined },
          ...BELEG_QUELLEN.map((option) => ({
            value: option.value,
            label: option.label,
            count: (option.value === 'campflow' ? campflowStore.data : store.data)
              ? gefiltert.filter((e) => e.quelle === option.value).length
              : undefined,
          })),
        ]}
        value={quelle}
        onselect={(value) => (quelle = value)}
        countNouns={['Beleg', 'Belege']}
      />
    </div>
    <details class="group sm:col-span-3" bind:open={filtersOpen}>
      <summary
        class="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold text-neutral-700"
      >
        Filter{activeFilters ? ` (${activeFilters})` : ''}
      </summary>
      <div class="mt-2 grid gap-4 sm:grid-cols-3">
        <label class="block text-sm">
          <span class="font-semibold text-neutral-700">Stand</span>
          <select class="form-input mt-1 w-full" bind:value={stand}>
            <option value="">Alle</option>
            {#each BELEG_STAENDE as option (option.value)}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </label>
        <label class="block text-sm">
          <span class="font-semibold text-neutral-700">Kostenstelle</span>
          <select
            class="form-input mt-1 w-full"
            value={costUnitId}
            onchange={(event) => {
              costUnitId = event.currentTarget.value;
              categoryId = '';
            }}
          >
            <option value="">Alle</option>
            {#each kostenstellen as unit (unit.id)}
              <option value={unit.id}>{unit.name}{unit.archived ? ' (archiviert)' : ''}</option>
            {/each}
          </select>
        </label>
        <label class="block text-sm">
          <span class="font-semibold text-neutral-700">Kategorie</span>
          <select class="form-input mt-1 w-full" bind:value={categoryId} disabled={!costUnitId}>
            <option value="">Alle</option>
            {#each kategorien as category (category.id)}
              <option value={category.id}>{category.name}</option>
            {/each}
          </select>
        </label>
      </div>
    </details>
    <div class="flex flex-wrap items-center justify-between gap-3 sm:col-span-3">
      <label class="inline-flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" bind:checked={onlyMine} disabled={!login} />
        Nur meine Belege
      </label>
      <FilterTabs
        label="Ansicht"
        variant="segmented"
        options={[
          { value: 'liste', label: 'Liste' },
          { value: 'galerie', label: 'Galerie' },
        ]}
        value={ansicht}
        onselect={selectAnsicht}
      />
    </div>
  </form>

  <StatusNotice {message} popup />

  {#if campflowStore.loading && !campflowStore.data}
    <p role="status" class="text-sm text-neutral-700">Belege aus CampFlow werden geladen …</p>
  {:else if campflowStore.error}
    <p class="text-sm text-neutral-700">
      <MessageText text={campflowStore.error} />
      <button
        type="button"
        class="text-link min-h-11 underline underline-offset-4"
        onclick={() => void campflowBelegeStore.load({ force: true, param: false })}
        >Erneut versuchen</button
      >
    </p>
  {/if}

  <!-- Two sources: what one of them delivered shows even if the other fails -->
  {#if store.error && !store.data && campflowStore.data}
    <p class="text-sm text-neutral-700">
      <MessageText text={store.error} />
      <button
        type="button"
        class="text-link min-h-11 underline underline-offset-4"
        onclick={() => void belegePflege.load({ force: true })}>Erneut versuchen</button
      >
    </p>
  {/if}

  <LoadState
    data={store.data ?? (campflowStore.data ? [] : null)}
    loading={store.loading && !campflowStore.data}
    error={store.data || !campflowStore.data ? store.error : null}
    loadingText="Belege werden geladen …"
    onretry={() => void belegePflege.load({ force: true })}
    isEmpty={() => visible.length === 0}
  >
    {#snippet skeleton()}
      <div class="min-h-[60dvh] space-y-2">
        {#each [1, 2, 3, 4] as n (n)}
          <div class="skeleton-element h-20 rounded-[var(--radius-lg)]"></div>
        {/each}
      </div>
    {/snippet}
    {#snippet empty()}
      <p class="surface p-6 text-sm text-neutral-700">Keine Belege für diese Auswahl.</p>
    {/snippet}
    <BelegUebersicht eintraege={visible} {ansicht} {geladen} onopen={open} zeigen={neuerBeleg} />
  </LoadState>
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
  busyLabel={form?.id
    ? 'Wird gespeichert …'
    : photo.aiChecking
      ? 'Beleg wird geprüft …'
      : 'Wird hochgeladen …'}
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
      {myName}
      onfield={(field) => dialog.clearField(field)}
      onpayment={() => {
        dialog.clearField('payout');
        dialog.clearField('paidBy');
      }}
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
<BelegAnsicht beleg={openAnsicht} onclose={() => (openAnsicht = null)} />
