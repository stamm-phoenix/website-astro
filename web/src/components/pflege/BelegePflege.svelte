<script lang="ts">
  import StaffPageHead from '../StaffPageHead.svelte';
  import {
    belegChanged,
    validateBeleg,
    decisionMessage,
    zahlungOf,
    type BelegForm,
  } from '../../lib/belegForm';
  import { zuordnungStand } from '../../lib/belegZuordnung';
  import { rettungsWarnung, ungespeichert, zuSpeichern } from '../../lib/belegEntwurf';
  import { createBelegPhotoDraft } from '../../lib/belegPhotoDraft.svelte';
  import BelegFields from './BelegFields.svelte';
  import BelegPhotoSection from './BelegPhotoSection.svelte';
  import BelegReview from './BelegReview.svelte';
  import BelegLesen from './BelegLesen.svelte';
  import BelegOeffnet from './BelegOeffnet.svelte';
  import { ladeVorschau } from '../../lib/belegVorschau';
  import { pruefHinweise } from '../../lib/belegPruefHinweise';
  import { confirmAction } from '../../lib/confirm';
  import { findRescue } from '../../lib/geretteteEingaben';
  import BelegAnsicht from './BelegAnsicht.svelte';
  import BelegCampflowDialog from './BelegCampflowDialog.svelte';
  import BelegUebersicht from './BelegUebersicht.svelte';
  import BelegePdfButton from './BelegePdfButton.svelte';

  import FilterTabs from '../ui/FilterTabs.svelte';
  import ReloadAction from '../ui/ReloadAction.svelte';

  import ActionButton from '../ui/ActionButton.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import { tick, untrack } from 'svelte';
  import { fetchApi, sendApi } from '../../lib/api';
  import { authStore, fetchPrincipal, getFullName } from '../../lib/authStore.svelte';
  import { createDialogForm } from '../../lib/dialogForm.svelte';
  import { belegePflege, campflowBelegeStore } from '../../lib/pflegeStore.svelte';
  import { fetchKostenstellen, kostenstellenStore } from '../../lib/abrechnungStore.svelte';
  import { centToInput, parseEuroToCent } from '../../lib/belege';
  import { formatEuro, todayIso } from '../../lib/format';
  import {
    BELEG_STAENDE,
    belegEintraege,
    eintragKostenstellen,
    matchesBelegFilter,
    type BelegEintrag,
    type BelegQuelle,
    type BelegStand,
  } from '../../lib/belegEintraege';
  import { ichStore, isIch } from '../../lib/ichStore.svelte';
  import BelegLadehinweise from './BelegLadehinweise.svelte';
  import BelegQuellenFilter from './BelegQuellenFilter.svelte';
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

  /** A new receipt's Auslage starts with the own name; who submitted an older one is unknown. */
  const vorschlag = $derived(form && !form.id ? myName : '');
  // The name may arrive after the Auslage was chosen; a name typed or cleared meanwhile stays
  $effect(() => {
    const name = vorschlag;
    untrack(() => {
      if (name && form?.zahlung === 'auslage' && !form.paidBy.trim()) form.paidBy = name;
    });
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

  /** The photo of the open receipt, loaded before its dialog opened, so the dialog keeps its size. */
  let vorschau = $state<{ id: string; url: string } | null>(null);
  let oeffnen: AbortController | null = null;
  let oeffnet = $state(false);

  function vorschauWeg(): void {
    if (vorschau) URL.revokeObjectURL(vorschau.url);
    vorschau = null;
  }
  // However the dialog closed (saved, deleted, transferred), the loaded photo is let go
  $effect(() => {
    if (!form) untrack(vorschauWeg);
  });

  /** Opens a receipt once its photo is there; another click meanwhile opens that one instead. */
  async function zeigen(beleg: StaffBeleg): Promise<void> {
    oeffnen?.abort();
    vorschauWeg();
    if (!beleg.hasImage) return edit(beleg);
    const controller = new AbortController();
    oeffnen = controller;
    oeffnet = true;
    const url = await ladeVorschau(
      `/api/intern/pflege/belege/${beleg.id}/foto?v=${encodeURIComponent(beleg.etag)}`,
      controller.signal
    );
    if (oeffnen !== controller) {
      if (url) URL.revokeObjectURL(url);
      return;
    }
    oeffnen = null;
    oeffnet = false;
    if (url) vorschau = { id: beleg.id, url };
    edit(beleg);
  }

  function open(eintrag: BelegEintrag): void {
    if (eintrag.beleg?.readOnly) openAnsicht = eintrag.beleg;
    else if (eintrag.beleg) void zeigen(eintrag.beleg);
    else if (eintrag.campflow) openCampflow = eintrag.campflow;
  }

  /** Reloads the receipts here and reads CampFlow again, its Kostenstellen too once loaded. */
  async function reload(): Promise<void> {
    reloadNotice = null;
    await Promise.all([
      belegePflege.load({ force: true }),
      campflowBelegeStore.refresh(),
      kostenstellenStore.data ? fetchKostenstellen({ refresh: true }) : undefined,
    ]);
    if (!store.error && !campflowStore.error && !kostenstellenStore.error) {
      reloadNotice = 'Belege neu geladen.';
    }
  }

  $effect(() => {
    untrack(() => {
      // Only suggestions; the form works without CampFlow. They follow the list, so it comes
      // first, and are there by the time a receipt is opened (which also asks for them)
      void belegePflege.load().finally(() => fetchKostenstellen());
      void campflowBelegeStore.load();
      readAnsicht();
      filtersOpen = window.matchMedia('(min-width: 640px)').matches;
      fetchPrincipal();
      fetchApi<{ reviewer: boolean }>('/intern/pflege/belege/rolle')
        .then((role) => (reviewer = role.reviewer))
        .catch(() => undefined);
    });
  });

  /** Editing the open receipt; a stored one opens to look at, with „Bearbeiten“. */
  let bearbeiten = $state(false);
  const lesen = $derived(!!form?.id && !bearbeiten);

  function startBearbeiten(): void {
    bearbeiten = true;
    void editDialog?.neuerStand();
  }

  /** Leaves editing without saving: the stored receipt is shown again. */
  function zurueckZumLesen(): void {
    const stored = store.data?.find((beleg) => beleg.id === form?.id);
    if (!stored) return close();
    edit(stored);
    void editDialog?.neuerStand();
  }

  function resetDialog(): void {
    // The suggestions of the form, in case the list is still loading
    void fetchKostenstellen();
    photo.reset();
    dialog.reset();
    dialogNotice = null;
  }

  function create(): void {
    resetDialog();
    bearbeiten = true;
    form = {
      id: null,
      etag: '',
      art: 'Ausgabe',
      shop: '',
      date: todayIso(),
      amount: '',
      paidBy: '',
      payout: null,
      zahlung: null,
      aktion: '',
      kostenstelle: '',
      kategorie: '',
      note: '',
      status: 'Eingereicht',
      reviewNote: '',
      hasImage: false,
      hasOriginal: false,
      isPdf: false,
      submittedBy: '',
      submittedAt: '',
      aiCheck: null,
      campflow: null,
      editable: true,
    };
  }

  function edit(beleg: StaffBeleg): void {
    resetDialog();
    // Input kept over a new login in the iPhone app goes back into the fields: open them
    bearbeiten = !!beleg.editable && !!findRescue(`beleg:${beleg.id}`, null, Date.now());
    form = {
      ...beleg,
      amount: centToInput(beleg.amountCent),
      // Income has no Auslage to choose
      zahlung: beleg.art === 'Einnahme' ? null : zahlungOf(beleg),
    };
  }

  /**
   * The errors of the form. CampFlow refuses to book on an archived Kostenstelle, so it blocks a
   * new receipt and a transfer; one archived after submitting may still be saved or rejected.
   */
  function formErrors(current: BelegForm, hasPhoto: boolean, forTransfer = false) {
    const result = validateBeleg(current, hasPhoto, forTransfer);
    const stand = zuordnungStand(kostenstellenStore.data, current.kostenstelle, current.kategorie);
    if (stand?.archiviert && (!current.id || forTransfer) && !result.kostenstelle) {
      result.kostenstelle = 'Diese Kostenstelle ist in CampFlow archiviert.';
    }
    return result;
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
    vorschauWeg();
    form = null;
    photo.clearDraft();
  }

  /** Keep the exact write version and derived photo metadata without replacing draft fields. */
  function applyPhoto(saved: StaffBeleg): void {
    // The photo loaded before opening is no longer the stored one
    if (vorschau?.id === saved.id) vorschauWeg();
    if (form?.id === saved.id) {
      editDialog?.acceptRescueVersion(form.etag, saved.etag);
      form.etag = saved.etag;
      form.aiCheck = saved.aiCheck;
      form.hasImage = saved.hasImage;
      form.hasOriginal = saved.hasOriginal;
      form.isPdf = saved.isPdf;
    }
    if (store.data) store.data = store.data.map((beleg) => (beleg.id === saved.id ? saved : beleg));
  }

  /**
   * Shows the form's errors; returns whether there are any. Looking at a receipt shows only the
   * remark of the Kasse as a field: other errors open the fields of a receipt that may still be
   * changed, or say what is missing on an accepted one.
   */
  async function ungueltig(errors: Record<string, string>): Promise<boolean> {
    const verdeckt = lesen && Object.keys(errors).some((key) => key !== 'reviewNote');
    if (verdeckt && form?.editable) {
      startBearbeiten();
      await tick();
      editDialog?.beginValidation();
    }
    const invalid = dialog.invalid(errors);
    if (verdeckt && !form?.editable) {
      const fehlt = Object.entries(errors)
        .filter(([key]) => key !== 'reviewNote')
        .map(([, text]) => text)
        .join(' ');
      dialog.state.error = `${fehlt} Nimm dafür die Annahme zurück und ergänze die Angaben.`;
    }
    return invalid;
  }

  const PHOTO_FEHLER =
    'Der Beleg wurde nicht gespeichert. Deine Eingaben und das Foto oder PDF sind noch da. Prüfe deine Internetverbindung und versuche es noch einmal.';

  /** Saves the receipt; `decision` accepts, rejects or resubmits it at the same time. */
  async function save(decision?: BelegStatus): Promise<void> {
    if (!form) return;
    if (photo.zuschnitt) {
      dialogNotice = 'Bitte zuerst das Zuschneiden abschließen.';
      return;
    }
    const previousStatus = form.status;
    if (decision) form.status = decision;
    editDialog?.beginValidation();
    if (await ungueltig(formErrors(form, !!photo.draft?.result))) {
      form.status = previousStatus;
      return;
    }

    const { id, etag, art, shop, date, paidBy, payout, kostenstelle, kategorie, note } = form;
    const { status, reviewNote, submittedBy } = form;
    const details = {
      art,
      shop,
      date,
      amountCent: parseEuroToCent(form.amount),
      paidBy,
      payout,
      kostenstelle,
      kategorie,
      note,
    };
    // A new receipt waits for the check of its photo; its warnings are taken note of first
    if (!id) {
      const geprueft = await dialog.run(() => photo.fertig(), PHOTO_FEHLER);
      const hinweise = form
        ? pruefHinweise(form.aiCheck, photo.photoWarnings, photo.draft?.result)
        : [];
      const bestaetigt =
        geprueft &&
        (hinweise.length === 0 ||
          (await confirmAction({
            title: 'Hinweise der Prüfung',
            message:
              'Die automatische Prüfung hat etwas gefunden. Sieh dir den Beleg noch einmal an.',
            items: hinweise,
            confirmLabel: 'Gelesen, trotzdem einreichen',
            cancelLabel: 'Zurück zum Beleg',
            tone: 'neutral',
          })));
      if (!bestaetigt || !form) {
        if (form) form.status = previousStatus;
        return;
      }
    }
    let newId: string | null = null;
    const saved = await dialog.run(async () => {
      if (id) {
        // A new photo chosen for this receipt is saved first, so a decision never discards it
        if (zuSpeichern(photo.draft)) {
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
        message = decisionMessage(
          shop,
          decision,
          result?.mailed === true,
          submittedBy,
          previousStatus
        );
      } else {
        // The photo as the check may still turn it upright, and what the check read meanwhile
        await photo.fertig();
        const final = form
          ? {
              ...details,
              shop: form.shop,
              date: form.date,
              amountCent: parseEuroToCent(form.amount),
            }
          : details;
        const created = await sendApi<{ id: string }>('POST', '/intern/pflege/belege', {
          ...final,
          ...(await photo.photoPayload(photo.draft!)),
        });
        message = `${art === 'Einnahme' ? 'Einnahme' : 'Beleg'} von ${final.shop} über ${formatEuro(final.amountCent!)} eingereicht. Danke!`;
        newId = created?.id ?? null;
      }
      // Saved changes are shown again; a decision or a new receipt closes the dialog
      const bleibt = id && !decision ? id : null;
      if (!bleibt) {
        form = null;
        photo.clearDraft();
      }
      await belegePflege.load({ force: true });
      if (bleibt) {
        const fresh = store.data?.find((beleg) => beleg.id === bleibt);
        if (fresh) {
          edit(fresh);
          dialogNotice = `Beleg von ${fresh.shop || 'unbekannt'} gespeichert.`;
          void editDialog?.neuerStand();
        } else form = null;
      }
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
    }, PHOTO_FEHLER);
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

  async function transfer(): Promise<void> {
    const current = form;
    if (!current?.id || photo.photoBusy) return;
    if (photo.zuschnitt || ungespeichert(photo.draft)) {
      dialogNotice = 'Bitte zuerst das neue Foto oder PDF speichern.';
      return;
    }
    // A stored photo opened without changes has nothing to save
    photo.clearDraft();
    const locked = current.campflow?.state === 'Gestartet';
    editDialog?.beginValidation();
    if (await ungueltig(formErrors(current, false, !locked))) return;
    const { id, shop } = current;
    await dialog.run(async () => {
      const listed = store.data?.find((b) => b.id === id);
      const stored =
        confirmedSave?.id === id && confirmedSave.etag === current.etag ? confirmedSave : listed;
      let etag = current.etag;
      if (!stored || belegChanged(current, stored)) {
        const patched = await sendApi<{ etag?: string }>('PATCH', `/intern/pflege/belege/${id}`, {
          art: current.art,
          shop: current.shop,
          date: current.date,
          amountCent: parseEuroToCent(current.amount),
          paidBy: current.paidBy,
          payout: current.payout,
          kostenstelle: current.kostenstelle,
          kategorie: current.kategorie,
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
            art: current.art,
            shop: current.shop,
            date: current.date,
            amountCent: parseEuroToCent(current.amount) ?? listed.amountCent,
            paidBy: current.paidBy,
            payout: current.payout === true,
            kostenstelle: current.kostenstelle,
            kategorie: current.kategorie,
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
      }>('POST', `/intern/pflege/belege/${id}/campflow`, { etag });
      const number = result?.campflow.number ?? '';
      message =
        result?.campflow.state !== 'Hochgeladen'
          ? `Beleg von ${shop}: Gerade läuft ein weiterer Versuch, ihn zu übertragen. Lade die Seite gleich neu, um das Ergebnis zu sehen.`
          : result?.deleted
            ? `Beleg von ${shop} ist in CampFlow als ${number} gebucht und wurde hier gelöscht.`
            : `Beleg von ${shop} ist in CampFlow als ${number} gebucht, aber mit einem früheren Stand. Er wurde danach geändert und bleibt deshalb hier, bis du CampFlow geprüft hast.`;
      form = null;
      // The Playwright API reads CampFlow again after an upload; the transfer may have added a
      // Kostenstelle or Kategorie
      await Promise.all([
        belegePflege.load({ force: true }),
        campflowBelegeStore.load({ force: true }),
        fetchKostenstellen({ force: true }),
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
        void campflowBelegeStore.load({ force: true });
      }
    }
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
    <BelegePdfButton
      eintraege={visible}
      filter={{ quelle, stand, costUnitId, categoryId, search, onlyMine }}
      {kostenstellen}
      disabled={!store.data && !campflowStore.data}
    />
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
        placeholder="Geschäft, Kostenstelle, Person, Belegnummer …"
        bind:value={search}
      />
    </label>
    <div class="sm:col-span-3">
      <BelegQuellenFilter
        entries={gefiltert}
        websiteLoaded={store.data !== null}
        campflowLoaded={campflowStore.data !== null}
        value={quelle}
        onselect={(value) => (quelle = value)}
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

  <BelegLadehinweise
    campflowLoading={campflowStore.loading && !campflowStore.data}
    campflowError={campflowStore.error}
    campflowStale={campflowStore.data !== null}
    websiteError={store.error && !store.data && campflowStore.data ? store.error : null}
    onreloadCampflow={() => void campflowBelegeStore.load({ force: true })}
    onreloadWebsite={() => void belegePflege.load({ force: true })}
  />

  <!-- Two sources: what one of them delivered shows even if the other fails -->
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
  size="split"
  title={form?.id ? `Beleg von ${form.shop || 'unbekannt'}` : 'Beleg einreichen'}
  rescueKey={form ? `beleg:${form.id ?? 'neu'}` : undefined}
  rescueVersion={form?.etag}
  rescueWarning={rettungsWarnung(photo.draft)}
  busy={busy || photo.photoBusy}
  error={dialog.state.error}
  notice={dialogNotice}
  onreload={dialog.state.conflict ? reloadCurrent : undefined}
  submitLabel={lesen ? 'Bearbeiten' : form?.id ? 'Speichern' : 'Einreichen'}
  cancelLabel={lesen ? 'Schließen' : 'Abbrechen'}
  hideSubmit={lesen && !form?.editable}
  oncancel={form?.id && bearbeiten ? zurueckZumLesen : undefined}
  busyLabel={form?.id
    ? 'Wird gespeichert …'
    : photo.aiChecking
      ? 'Beleg wird geprüft …'
      : 'Wird hochgeladen …'}
  dirty={!!photo.zuschnitt || ungespeichert(photo.draft)}
  onsubmit={() => (lesen ? startBearbeiten() : save())}
  onclose={close}
  ondelete={form?.id && (reviewer || form.editable) ? remove : undefined}
  deleteTitle={`Beleg von ${form?.shop || 'unbekannt'} löschen?`}
  deleteQuestion={form?.campflow?.state === 'Hochgeladen'
    ? `In CampFlow steht Beleg ${form.campflow.number} mit dem Stand der Übertragung. Prüfe dort, ob spätere Änderungen übernommen sind, bevor du ihn hier löschst. Diesen Beleg endgültig löschen?`
    : 'Diesen Beleg endgültig löschen?'}
>
  {#snippet aside()}
    {#if form}
      <BelegPhotoSection
        {form}
        {photo}
        {busy}
        {errors}
        {lesen}
        bild={vorschau?.id === form.id ? vorschau.url : undefined}
      />
    {/if}
  {/snippet}
  {#if form && lesen}
    <BelegLesen {form} />
    <!-- The Kasse decides on the receipt as it is stored, not while it is being changed -->
    <BelegReview
      bind:form
      {reviewer}
      busy={busy || photo.photoBusy}
      {errors}
      onsave={save}
      ontransfer={transfer}
    />
  {:else if form}
    <BelegFields
      bind:form
      {errors}
      {vorschlag}
      onfield={(field) => dialog.clearField(field)}
      onpayment={() => {
        dialog.clearField('payout');
        dialog.clearField('paidBy');
      }}
    />
  {/if}
</EditDialog>

<BelegOeffnet sichtbar={oeffnet} />
<BelegCampflowDialog beleg={openCampflow} onclose={() => (openCampflow = null)} />
<BelegAnsicht beleg={openAnsicht} onclose={() => (openAnsicht = null)} />
