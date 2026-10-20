<script lang="ts">
  import { aktionTitles } from '../../lib/campflowFields';
  import StaffPageHead from '../StaffPageHead.svelte';
  import {
    validateBeleg,
    decisionMessage,
    knownBelegAktion,
    type BelegForm,
  } from '../../lib/belegForm';
  import { createBelegPhotoDraft } from '../../lib/belegPhotoDraft.svelte';
  import BelegFields from './BelegFields.svelte';
  import BelegList from './BelegList.svelte';
  import BelegPhotoSection from './BelegPhotoSection.svelte';
  import BelegReview from './BelegReview.svelte';

  import ReloadButton from './ReloadButton.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';

  import ActionButton from '../ui/ActionButton.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import { untrack } from 'svelte';
  import { fetchApi, sendApi } from '../../lib/api';
  import { authStore, fetchPrincipal, getFullName } from '../../lib/authStore.svelte';
  import { confirmAction } from '../../lib/confirm';
  import { createDialogForm } from '../../lib/dialogForm.svelte';
  import { campflowEventsStore, fetchCampflowEvents } from '../../lib/campflowStore.svelte';
  import { belegePflege } from '../../lib/pflegeStore.svelte';
  import { centToInput, parseEuroToCent } from '../../lib/belege';
  import { formatEuro, todayIso } from '../../lib/format';
  import type { BelegStatus, StaffBeleg } from '../../lib/types';

  import EditDialog from './EditDialog.svelte';

  import StatusNotice from './StatusNotice.svelte';

  type View = 'offen' | 'angenommen' | 'abgelehnt' | 'alle';

  const VIEWS: { id: View; label: string }[] = [
    { id: 'offen', label: 'Offen' },
    { id: 'angenommen', label: 'Angenommen' },
    { id: 'abgelehnt', label: 'Abgelehnt' },
    { id: 'alle', label: 'Alle' },
  ];
  const VIEW_STATUS: Record<Exclude<View, 'alle'>, BelegStatus> = {
    offen: 'Eingereicht',
    angenommen: 'Angenommen',
    abgelehnt: 'Abgelehnt',
  };
  const store = belegePflege.state;

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
  });
  const visible = $derived.by(() => {
    const query = search.trim().toLowerCase();
    return items
      .filter((b) => view === 'alle' || b.status === VIEW_STATUS[view])
      .filter((b) => !onlyMine || b.submittedBy === login)
      .filter(
        (b) =>
          !query ||
          [b.shop, b.aktion, b.paidBy, b.note].some((text) => text.toLowerCase().includes(query))
      );
  });
  const aktionSuggestions = $derived(aktionTitles(campflowEventsStore.data ?? []));

  $effect(() => {
    untrack(() => {
      belegePflege.load();
      fetchPrincipal();
      fetchApi<{ reviewer: boolean }>('/intern/pflege/belege/rolle')
        .then((role) => (reviewer = role.reviewer))
        .catch(() => undefined);
      // Only suggestions; the form works without CampFlow
      fetchCampflowEvents();
    });
  });

  function resetDialog(): void {
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
    <ReloadButton resource={belegePflege} />
  {/snippet}
</StaffPageHead>
<div class="space-y-6">
  <details class="surface ui-quickinfo space-y-3 p-4 sm:p-6" open={items.length === 0}>
    <summary class="min-h-11 cursor-pointer"
      ><h2 class="inline font-serif text-xl text-brand-900">So geht's</h2></summary
    >
    <ol class="max-w-prose list-decimal space-y-1 pl-5 text-sm text-neutral-700">
      <li>
        Beleg am besten mit der <strong>Scan-Funktion deines Handys</strong> aufnehmen und den Scan hochladen:
        auf dem iPhone in der Notizen- oder Dateien-App „Dokumente scannen“, auf Android in Google Drive
        „Scannen“. Ein normales Foto geht auch – flach hingelegt, gut beleuchtet, alle Ränder sichtbar,
        am besten auf dunklem Untergrund. Die Seite schneidet es dann selbst zu.
      </li>
      <li>Geschäft, Datum, Betrag und Aktion eintragen und einreichen.</li>
      <li>
        Die Kasse prüft den Beleg vor. Angenommene Belege überträgt sie nach CampFlow, dort passiert
        die eigentliche Buchhaltung. Lehnt sie einen Beleg ab, bekommst du die Begründung per Mail
        und kannst ihn korrigiert erneut einreichen.
      </li>
    </ol>
    <p class="max-w-prose text-sm text-neutral-700">
      Kein Beleg bekommen oder verloren? Erstelle einen
      <a href="/leitendenbereich/eigenbeleg" class="font-semibold text-link underline">Eigenbeleg</a
      >, unterschreibe ihn und reiche ihn hier ein.
    </p>
  </details>

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
          count: store.data ? counts[option.id] : undefined,
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

  <LoadState
    data={store.data}
    loading={store.loading}
    error={store.error}
    loadingText="Belege werden geladen …"
    onretry={() => void belegePflege.load({ force: true })}
    isEmpty={() => visible.length === 0}
  >
    {#snippet skeleton()}
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
  deleteQuestion="Diesen Beleg endgültig löschen?"
>
  {#if form}
    <BelegPhotoSection {form} {photo} {busy} {errors} />

    <BelegFields
      bind:form
      {errors}
      {aktionSuggestions}
      onpayment={() => dialog.clearField('payout')}
    />

    <BelegReview bind:form {reviewer} busy={busy || photo.photoBusy} {errors} onsave={save} />
  {/if}
</EditDialog>
