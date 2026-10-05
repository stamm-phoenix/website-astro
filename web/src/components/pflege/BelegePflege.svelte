<script lang="ts">
  import FilterTabs from '../ui/FilterTabs.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { untrack } from 'svelte';
  import { ApiError, fetchApi, sendApi } from '../../lib/api';
  import { authStore, fetchPrincipal, getFullName } from '../../lib/authStore.svelte';
  import { campflowEventsStore, fetchCampflowEvents } from '../../lib/campflowStore.svelte';
  import { belegePflege } from '../../lib/pflegeStore.svelte';
  import {
    blobToBase64,
    centToInput,
    formatEuro,
    formatIsoDate,
    BELEG_PHOTO_EDGE,
    canvasToJpeg,
    loadPhoto,
    parseEuroToCent,
    photoWarnings as measurePhotoWarnings,
    todayIso,
  } from '../../lib/belege';
  import {
    findReceipt,
    fullFrame,
    isFullFrame,
    readPixels,
    scanReceipt,
    toCanvas,
  } from '../../lib/belegScan';
  import type { Pixels, Quad, ScanMode } from '../../lib/belegScan';
  import type { BelegCheck, BelegStatus, StaffBeleg } from '../../lib/types';
  import BelegScanEditor from './BelegScanEditor.svelte';
  import EditDialog from './EditDialog.svelte';
  import FormField from './FormField.svelte';
  import StatusNotice from './StatusNotice.svelte';

  interface Form {
    id: string | null;
    etag: string;
    shop: string;
    date: string;
    amount: string;
    paidBy: string;
    payout: boolean;
    aktion: string;
    note: string;
    status: BelegStatus;
    reviewNote: string;
    hasImage: boolean;
    hasOriginal: boolean;
    submittedBy: string;
    submittedAt: string;
    aiCheck: BelegCheck | null;
  }

  /** `aus`: the photo is used as it is, e.g. because it already is a scan of the phone. */
  type Mode = ScanMode | 'aus';

  /** A chosen photo while it is being scanned. */
  interface Draft {
    original: Pixels;
    originalBlob: Blob;
    originalUrl: string;
    quad: Quad;
    mode: Mode;
    /** Result of the scan (or the original with mode `aus`). */
    result: { blob: Blob; url: string; width: number; height: number } | null;
  }

  type View = 'offen' | 'angenommen' | 'abgelehnt' | 'alle';

  const MODES: { id: Mode; label: string }[] = [
    { id: 'farbe', label: 'Farbe' },
    { id: 'graustufen', label: 'Graustufen' },
    { id: 'aus', label: 'Unverändert (ist schon ein Scan)' },
  ];
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
  const PHOTO_BASE = '/api/intern/pflege/belege';
  const store = belegePflege.state;

  let view = $state<View>('offen');
  /** Member of the Kasse: sees all receipts and accepts or rejects them. */
  let reviewer = $state(false);
  let onlyMine = $state(false);
  let search = $state('');
  let form = $state<Form | null>(null);
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  let photoBusy = $state(false);
  let dialogError = $state<string | null>(null);
  let confirmDelete = $state(false);
  let message = $state<string | null>(null);
  /** Photo being scanned; raw because the pixel arrays are large. */
  let draft = $state.raw<Draft | null>(null);
  /** Hint about the found edges of the receipt. */
  let scanHint = $state<string | null>(null);
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  /** Quality hints for the photo chosen last. */
  let photoWarnings = $state<string[]>([]);
  /** KI-Vorprüfung of the photo chosen for a new receipt. */
  let aiChecking = $state(false);
  let aiNotice = $state<string | null>(null);
  /** Increments per chosen photo, so a late check result of an older photo is ignored. */
  let photoGeneration = 0;

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
  /** CampFlow events of the last and the coming year as suggestions for the Aktion. */
  const aktionSuggestions = $derived.by(() => {
    const now = Date.now();
    const year = 365 * 24 * 60 * 60 * 1000;
    const titles = (campflowEventsStore.data ?? [])
      .filter((event) => {
        const start = event.start_date ? Date.parse(event.start_date) : NaN;
        return Number.isNaN(start) || Math.abs(start - now) < year;
      })
      .map((event) => event.title.trim())
      .filter(Boolean);
    return [...new Set(titles)].sort((a, b) => a.localeCompare(b, 'de'));
  });

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

  function photoUrl(beleg: { id: string | null; etag: string }, variant = ''): string {
    return `${PHOTO_BASE}/${beleg.id}/foto?v=${encodeURIComponent(beleg.etag)}${variant}`;
  }

  function formatTimestamp(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? ''
      : date.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function clearDraft(): void {
    if (draft) {
      URL.revokeObjectURL(draft.originalUrl);
      if (draft.result) URL.revokeObjectURL(draft.result.url);
    }
    clearTimeout(checkTimer);
    draft = null;
    scanHint = null;
  }

  function resetDialog(): void {
    clearDraft();
    photoWarnings = [];
    photoGeneration++;
    aiChecking = false;
    aiNotice = null;
    errors = {};
    dialogError = null;
    confirmDelete = false;
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
      payout: true,
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
  }

  function close(): void {
    if (busy || photoBusy) return;
    form = null;
    clearDraft();
  }

  function validate(f: Form): Record<string, string> {
    const result: Record<string, string> = {};
    if (!f.id && !draft?.result) result.photo = 'Bitte ein Foto des Belegs hinzufügen.';
    if (!f.shop.trim()) result.shop = 'Bitte das Geschäft angeben.';
    if (!f.date) result.date = 'Bitte das Datum angeben.';
    else if (f.date > todayIso()) result.date = 'Das Datum liegt in der Zukunft.';
    if (parseEuroToCent(f.amount) === null)
      result.amountCent = 'Bitte einen Betrag wie 12,34 angeben.';
    if (!f.paidBy.trim()) result.paidBy = 'Bitte angeben, wer bezahlt hat.';
    if (!f.aktion.trim()) result.aktion = 'Bitte die Aktion angeben.';
    if (f.status === 'Abgelehnt' && !f.reviewNote.trim()) {
      result.reviewNote = 'Bitte begründen, warum der Beleg abgelehnt wird.';
    }
    return result;
  }

  /** Lets the browser paint the busy state before the heavy pixel work starts. */
  function nextFrame(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 20));
  }

  async function choosePhoto(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !form) return;

    photoBusy = true;
    dialogError = null;
    try {
      await nextFrame();
      const canvas = await loadPhoto(file);
      photoWarnings = measurePhotoWarnings(canvas);
      const original = readPixels(canvas, canvas.width, canvas.height);
      const originalBlob = await canvasToJpeg(canvas);
      clearDraft();
      const found = findReceipt(original);
      let quad = found ?? fullFrame(original.width, original.height);
      let mode: Mode = 'farbe';
      if (!found) {
        scanHint =
          'Die Ränder des Belegs wurden nicht erkannt. Zieh die Ecken bitte selbst auf den Beleg.';
      } else if (isFullFrame(found, original.width, original.height)) {
        // The photo shows only the receipt, e.g. a scan of the phone camera
        quad = fullFrame(original.width, original.height);
        mode = 'aus';
        scanHint = 'Das Foto sieht schon wie ein Scan aus und wird unverändert verwendet.';
      } else {
        scanHint = 'Ränder erkannt. Passt der Rahmen nicht, zieh die Ecken mit dem Finger zurecht.';
      }
      draft = {
        original,
        originalBlob,
        originalUrl: URL.createObjectURL(originalBlob),
        quad,
        mode,
        result: null,
      };
      errors = Object.fromEntries(Object.entries(errors).filter(([field]) => field !== 'photo'));
      await render();
    } catch {
      dialogError = 'Das Foto konnte nicht gelesen werden. Bitte ein JPEG- oder PNG-Foto wählen.';
    } finally {
      photoBusy = false;
    }
  }

  /** Computes the scan for the current corners and mode. */
  async function render(): Promise<void> {
    const current = draft;
    if (!current) return;
    photoBusy = true;
    try {
      await nextFrame();
      let result: Draft['result'];
      if (current.mode === 'aus') {
        result = {
          blob: current.originalBlob,
          url: URL.createObjectURL(current.originalBlob),
          width: current.original.width,
          height: current.original.height,
        };
      } else {
        const scan = toCanvas(
          scanReceipt(current.original, current.quad, current.mode, BELEG_PHOTO_EDGE)
        );
        const blob = await canvasToJpeg(scan);
        result = { blob, url: URL.createObjectURL(blob), width: scan.width, height: scan.height };
      }
      if (draft !== current) {
        URL.revokeObjectURL(result.url);
        return;
      }
      if (current.result) URL.revokeObjectURL(current.result.url);
      draft = { ...current, result };
      if (form && !form.id) {
        // Only check once the corners have settled
        clearTimeout(checkTimer);
        checkTimer = setTimeout(() => void checkNewPhoto(result.blob), 600);
      }
    } catch {
      // E.g. two corners dragged onto the same point; never keep the scan of the old corners
      if (draft === current) {
        if (current.result) URL.revokeObjectURL(current.result.url);
        draft = { ...current, result: null };
        scanHint = 'Die Ecken bilden kein Viereck. Bitte die Ecken weiter auseinanderziehen.';
      }
    } finally {
      photoBusy = false;
    }
  }

  function setQuad(quad: Quad): void {
    if (!draft) return;
    draft = { ...draft, quad };
    void render();
  }

  function setMode(mode: Mode): void {
    if (!draft || draft.mode === mode) return;
    draft = { ...draft, mode };
    void render();
  }

  /** The photos for the API: the scan, plus the original if the scan differs from it. */
  async function photoPayload(current: Draft): Promise<{ photo: string; original?: string }> {
    const photo = await blobToBase64(current.result!.blob);
    return current.mode === 'aus'
      ? { photo }
      : { photo, original: await blobToBase64(current.originalBlob) };
  }

  /** Replaces the photo of an existing receipt with the current scan. */
  async function savePhoto(): Promise<void> {
    if (!form?.id || !draft?.result) return;
    const id = form.id;
    photoBusy = true;
    dialogError = null;
    try {
      await sendApi('PUT', `/intern/pflege/belege/${id}/foto`, await photoPayload(draft), {
        etag: form.etag,
      });
      clearDraft();
      photoWarnings = [];
      await refreshEtag(id);
      message = 'Foto ersetzt.';
    } catch (error: unknown) {
      handleError(error);
    } finally {
      photoBusy = false;
    }
  }

  /** Asks the image model about a new photo and prefills empty fields with what it read. */
  async function checkNewPhoto(blob: Blob): Promise<void> {
    if (!form) return;
    const generation = ++photoGeneration;
    form.aiCheck = null;
    aiNotice = null;
    aiChecking = true;
    try {
      const result = await sendApi<{ available: boolean; check: BelegCheck | null }>(
        'POST',
        '/intern/pflege/belege/pruefung',
        blob
      );
      if (generation !== photoGeneration || !form || form.id) return;
      const check = result.check;
      if (!result.available || !check) return;
      form.aiCheck = check;
      if (!form.shop.trim() && check.shop) form.shop = check.shop;
      if (check.date && form.date === todayIso() && check.date <= todayIso())
        form.date = check.date;
      if (!form.amount.trim() && check.amountCent) form.amount = centToInput(check.amountCent);
    } catch (error: unknown) {
      if (generation !== photoGeneration) return;
      aiNotice =
        error instanceof ApiError ? error.message : 'Die KI-Prüfung ist gerade nicht erreichbar.';
    } finally {
      if (generation === photoGeneration) aiChecking = false;
    }
  }

  /** A photo change creates a new version of the item; take over its etag for the next save. */
  async function refreshEtag(id: string): Promise<void> {
    await belegePflege.load({ force: true });
    const current = store.data?.find((b) => b.id === id);
    if (form?.id === id && current) {
      form.etag = current.etag;
      form.aiCheck = current.aiCheck;
      form.hasImage = current.hasImage;
      form.hasOriginal = current.hasOriginal;
    }
  }

  /** Saves the receipt; `decision` accepts, rejects or resubmits it at the same time. */
  async function save(decision?: BelegStatus): Promise<void> {
    if (!form) return;
    const previousStatus = form.status;
    if (decision) form.status = decision;
    errors = validate(form);
    if (Object.keys(errors).length > 0) {
      form.status = previousStatus;
      return;
    }

    busy = true;
    dialogError = null;
    const { id, etag, shop, date, paidBy, payout, aktion, note, status, reviewNote } = form;
    const details = {
      shop,
      date,
      amountCent: parseEuroToCent(form.amount),
      paidBy,
      payout,
      aktion,
      note,
    };
    try {
      if (id) {
        // A new photo chosen for this receipt is saved first, so a decision never discards it
        if (draft?.result) {
          await sendApi('PUT', `/intern/pflege/belege/${id}/foto`, await photoPayload(draft), {
            etag,
          });
          clearDraft();
          await refreshEtag(id);
        }
        const result = await sendApi<{ mailed: boolean }>('PATCH', `/intern/pflege/belege/${id}`, {
          ...details,
          etag: form?.etag ?? etag,
          status,
          reviewNote,
        });
        message = decisionMessage(shop, decision, result?.mailed === true, form.submittedBy);
      } else {
        await sendApi('POST', '/intern/pflege/belege', {
          ...details,
          ...(await photoPayload(draft!)),
        });
        message = `Beleg von ${shop} über ${formatEuro(details.amountCent!)} eingereicht. Danke!`;
        view = 'offen';
      }
      form = null;
      clearDraft();
      await belegePflege.load({ force: true });
    } catch (error: unknown) {
      if (form) form.status = previousStatus;
      handleError(error);
    } finally {
      busy = false;
    }
  }

  function decisionMessage(
    shop: string,
    decision: BelegStatus | undefined,
    mailed: boolean,
    submittedBy: string
  ): string {
    switch (decision) {
      case 'Angenommen':
        return `Beleg von ${shop} angenommen. Jetzt das Foto herunterladen, in CampFlow hochladen und den Beleg hier löschen.`;
      case 'Abgelehnt':
        return mailed
          ? `Beleg von ${shop} abgelehnt. ${submittedBy} hat die Begründung per Mail bekommen.`
          : `Beleg von ${shop} abgelehnt. Es wurde keine Mail verschickt, bitte gib ${submittedBy || 'der Person'} selbst Bescheid.`;
      case 'Eingereicht':
        return `Beleg von ${shop} erneut eingereicht.`;
      default:
        return `Beleg von ${shop} gespeichert.`;
    }
  }

  async function remove(): Promise<void> {
    if (!form?.id || photoBusy) return;
    busy = true;
    try {
      await sendApi('DELETE', `/intern/pflege/belege/${form.id}`, undefined, { etag: form.etag });
      message = `Beleg von ${form.shop} gelöscht.`;
      form = null;
      await belegePflege.load({ force: true });
    } catch (error: unknown) {
      handleError(error);
    } finally {
      busy = false;
    }
  }

  function handleError(error: unknown): void {
    if (error instanceof ApiError) {
      if (error.fields) errors = { ...errors, ...error.fields };
      dialogError = error.message;
    } else {
      dialogError = 'Speichern fehlgeschlagen. Bitte prüfe deine Verbindung.';
    }
  }
</script>

{#snippet aiCheckBox(check: BelegCheck)}
  {#if check.ok}
    <p
      role="note"
      class="rounded-md bg-[var(--color-dpsg-pfadfinder)]/5 p-3 text-xs text-[var(--color-dpsg-pfadfinder)]"
    >
      KI-Vorprüfung: Der Beleg ist vollständig und gut lesbar.
    </p>
  {:else}
    <div role="note" class="space-y-1 rounded-md bg-warning-soft p-3 text-xs text-warning">
      <p class="font-semibold">
        KI-Vorprüfung: {!check.isReceipt
          ? 'Das Foto zeigt anscheinend keinen Beleg.'
          : 'Das Foto ist so wohl nicht archivtauglich.'}
      </p>
      <ul class="list-disc space-y-0.5 pl-4">
        {#each check.issues as issue (issue)}
          <li>{issue}</li>
        {:else}
          {#if !check.complete}<li>Der Beleg ist nicht vollständig zu sehen.</li>{/if}
          {#if !check.readable}<li>Der Beleg ist nicht gut lesbar.</li>{/if}
        {/each}
      </ul>
      {#if !form?.id}
        <p>
          Am besten neu fotografieren. Einreichen geht trotzdem, das Kassenteam prüft jeden Beleg.
        </p>
      {/if}
    </div>
  {/if}
  {#if check.restrictedItems.length > 0}
    <div
      role="note"
      class="space-y-1 rounded-md bg-[var(--color-dpsg-red)]/5 p-3 text-xs text-[var(--color-dpsg-red)]"
    >
      <p class="font-semibold">
        KI-Vorprüfung: Auf dem Beleg stehen anscheinend Dinge, die in der Jugendarbeit nicht
        abgerechnet werden dürfen:
      </p>
      <ul class="list-disc space-y-0.5 pl-4">
        {#each check.restrictedItems as item, index (index)}
          <li>{item}</li>
        {/each}
      </ul>
      {#if !form?.id}
        <p>
          Bitte nur die erlaubten Positionen abrechnen und das in der Bemerkung erklären. Die Kasse
          prüft das.
        </p>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet statusBadge(status: BelegStatus)}
  <StatusLabel
    label={status}
    tone={status === 'Angenommen' ? 'success' : status === 'Abgelehnt' ? 'danger' : 'neutral'}
  />
{/snippet}

<div class="space-y-6">
  <section aria-labelledby="belege-intro" class="surface space-y-3 p-4 sm:p-6">
    <h2 id="belege-intro" class="font-serif text-xl text-brand-900">So geht's</h2>
    <ol class="list-decimal space-y-1 pl-5 text-sm text-neutral-700">
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
    <ActionButton variant="primary" type="button" disabled={!store.data} onclick={create}>
      Beleg einreichen
    </ActionButton>
  </section>

  <form
    class="surface grid gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-end"
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
    <ActionButton
      variant="secondary"
      type="button"
      disabled={store.loading}
      onclick={() => belegePflege.load({ force: true })}
    >
      Neu laden
    </ActionButton>
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

  <StatusNotice {message} />

  {#if !store.data && store.loading}
    <div role="status" aria-live="polite" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <span class="sr-only">Belege werden geladen …</span>
      {#each [1, 2, 3] as n (n)}
        <div class="skeleton-element h-28 rounded-[var(--radius-lg)]"></div>
      {/each}
    </div>
  {:else if !store.data}
    <div role="alert" class="surface p-6 border-l-4! border-l-[var(--color-dpsg-red)]!">
      <p class="text-sm text-neutral-700">{store.error}</p>
      <ActionButton
        variant="primary"
        type="button"
        class="mt-4"
        onclick={() => belegePflege.load({ force: true })}
      >
        Erneut versuchen
      </ActionButton>
    </div>
  {:else if visible.length === 0}
    <p class="surface p-6 text-sm text-neutral-700">
      {view === 'offen' && !search && !onlyMine
        ? 'Keine offenen Belege. Alles vorgeprüft!'
        : 'Keine Belege für diese Auswahl.'}
    </p>
  {:else}
    <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each visible as beleg (beleg.id)}
        <li>
          <button
            type="button"
            class="card flex w-full items-start gap-3 text-left hover:border-[var(--color-brand-300)]"
            onclick={() => edit(beleg)}
          >
            {#if beleg.hasImage}
              <img
                src={photoUrl(beleg, '&thumb=1')}
                alt=""
                aria-hidden="true"
                width="64"
                height="80"
                loading="lazy"
                class="h-20 w-16 shrink-0 rounded-md bg-neutral-100 object-cover"
              />
            {/if}
            <span class="min-w-0 flex-1">
              <span class="flex items-start justify-between gap-2">
                <span class="truncate font-semibold text-brand-900">{beleg.shop}</span>
                <span class="shrink-0 font-semibold text-brand-900"
                  >{formatEuro(beleg.amountCent)}</span
                >
              </span>
              <span class="block truncate text-sm text-neutral-700">
                {formatIsoDate(beleg.date)} · {beleg.aktion}
              </span>
              <span class="block truncate text-xs text-neutral-700">Bezahlt von {beleg.paidBy}</span
              >
              {#if beleg.status === 'Abgelehnt' && beleg.reviewNote}
                <span class="mt-1 line-clamp-2 block text-xs text-[var(--color-dpsg-red)]"
                  >Abgelehnt: {beleg.reviewNote}</span
                >
              {/if}
              <span class="mt-1.5 flex flex-wrap gap-1">
                {@render statusBadge(beleg.status)}
                {#if beleg.payout}
                  <span class="tag">Auszahlung</span>
                {/if}
                {#if beleg.aiCheck && !beleg.aiCheck.ok}
                  <span
                    class="rounded-sm bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning"
                    >KI: Mängel</span
                  >
                {/if}
                {#if beleg.aiCheck?.restrictedItems.length}
                  <span
                    class="rounded-sm bg-[var(--color-dpsg-red)]/10 px-2 py-0.5 text-xs font-semibold text-[var(--color-dpsg-red)]"
                    >KI: Alkohol/Tabak?</span
                  >
                {/if}
              </span>
            </span>
            <span class="sr-only">öffnen</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<EditDialog
  open={form !== null}
  title={form?.id ? `Beleg von ${form.shop || 'unbekannt'}` : 'Beleg einreichen'}
  busy={busy || photoBusy}
  error={dialogError}
  submitLabel={form?.id ? 'Speichern' : 'Einreichen'}
  busyLabel={form?.id ? 'Wird gespeichert …' : 'Wird hochgeladen …'}
  onsubmit={() => save()}
  onclose={close}
>
  {#if form}
    <section aria-labelledby="bl-photo-label" class="space-y-2">
      <p id="bl-photo-label" class="form-label">Foto des Belegs</p>
      {#if form.id && form.hasImage && !draft}
        <a href={photoUrl(form)} target="_blank" rel="noopener" class="block">
          <img
            src={photoUrl(form)}
            alt="Foto des Belegs von {form.shop}"
            width="600"
            height="800"
            class="max-h-96 w-auto rounded-md border border-neutral-200 bg-neutral-100 object-contain"
          />
          <span class="mt-1 block text-xs text-brand-800 underline">In voller Größe öffnen</span>
        </a>
      {/if}
      {#if draft}
        <div class="grid gap-3 sm:grid-cols-2">
          <figure class="space-y-1">
            <figcaption class="text-xs font-semibold text-neutral-700">
              {draft.mode === 'aus' ? 'Foto' : 'Original – Ecken auf den Beleg ziehen'}
            </figcaption>
            {#if draft.mode === 'aus'}
              <img
                src={draft.originalUrl}
                alt="Gewähltes Foto"
                width={draft.original.width}
                height={draft.original.height}
                class="h-auto max-h-96 w-auto max-w-full rounded-md border border-neutral-200 bg-neutral-100"
              />
            {:else}
              <BelegScanEditor
                src={draft.originalUrl}
                width={draft.original.width}
                height={draft.original.height}
                quad={draft.quad}
                disabled={busy}
                onchange={setQuad}
              />
            {/if}
          </figure>
          {#if draft.result && draft.mode !== 'aus'}
            <figure class="space-y-1">
              <figcaption class="text-xs font-semibold text-neutral-700">Scan</figcaption>
              <img
                src={draft.result.url}
                alt="Vorschau des Scans"
                width={draft.result.width}
                height={draft.result.height}
                class="h-auto max-h-96 w-auto max-w-full rounded-md border border-neutral-200 bg-surface"
              />
            </figure>
          {/if}
        </div>
        {#if scanHint}
          <p class="text-xs text-neutral-700">{scanHint}</p>
        {/if}
        <fieldset>
          <legend class="text-xs font-semibold text-neutral-700">Bearbeitung</legend>
          <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {#each MODES as option (option.id)}
              <label class="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="bl-scan-mode"
                  checked={draft.mode === option.id}
                  disabled={photoBusy || busy}
                  onchange={() => setMode(option.id)}
                />
                {option.label}
              </label>
            {/each}
          </div>
          {#if draft.mode !== 'aus'}
            <p class="mt-1 text-xs text-neutral-700">
              Gespeichert werden der Scan und das Originalfoto.
            </p>
          {/if}
        </fieldset>
        {#if form.id}
          <div class="flex flex-wrap gap-2">
            <ActionButton
              variant="primary"
              type="button"
              disabled={photoBusy || busy || !draft.result}
              onclick={savePhoto}>Neues Foto speichern</ActionButton
            >
            <ActionButton
              variant="secondary"
              type="button"
              disabled={photoBusy || busy}
              onclick={clearDraft}>Verwerfen</ActionButton
            >
          </div>
        {/if}
      {/if}
      <div class="flex flex-wrap gap-2">
        <label class="btn-secondary cursor-pointer" class:opacity-60={photoBusy}>
          {photoBusy
            ? 'Wird verarbeitet …'
            : form.hasImage || draft
              ? 'Anderes Foto wählen'
              : 'Foto aufnehmen oder wählen'}
          <input
            type="file"
            accept="image/*"
            class="sr-only"
            aria-describedby={errors.photo ? 'bl-photo-error' : undefined}
            disabled={photoBusy || busy}
            onchange={choosePhoto}
          />
        </label>
        {#if form.id && form.hasImage && !draft}
          <a class="btn-secondary" href="{photoUrl(form)}&download=1" download>
            Foto herunterladen
          </a>
          {#if form.hasOriginal}
            <a
              class="btn-secondary"
              href="{photoUrl(form)}&original=1"
              target="_blank"
              rel="noopener"
            >
              Original ansehen
            </a>
          {/if}
        {/if}
      </div>
      {#if photoWarnings.length > 0}
        <ul role="note" class="space-y-1 rounded-md bg-warning-soft p-3 text-xs text-warning">
          {#each photoWarnings as warning (warning)}
            <li>{warning}</li>
          {/each}
          <li>Du kannst trotzdem einreichen, wenn alles gut lesbar ist.</li>
        </ul>
      {/if}
      {#if aiChecking}
        <p role="status" class="text-xs text-neutral-700">KI-Vorprüfung läuft …</p>
      {:else if form.aiCheck}
        {@render aiCheckBox(form.aiCheck)}
      {:else if aiNotice}
        <p role="note" class="text-xs text-neutral-700">{aiNotice}</p>
      {/if}
      {#if errors.photo}
        <p id="bl-photo-error" class="text-sm text-[var(--color-dpsg-red)]">{errors.photo}</p>
      {/if}
      {#if form.id}
        <p class="text-xs text-neutral-700">
          Eingereicht{form.submittedBy ? ` von ${form.submittedBy}` : ''}{form.submittedAt
            ? ` am ${formatTimestamp(form.submittedAt)}`
            : ''}.
        </p>
      {/if}
    </section>

    <div class="grid gap-4 sm:grid-cols-2">
      <FormField id="bl-shop" label="Geschäft" error={errors.shop}>
        {#snippet children(attrs)}
          <input {...attrs} class="form-input" maxlength="100" bind:value={form!.shop} />
        {/snippet}
      </FormField>
      <FormField id="bl-date" label="Datum des Belegs" error={errors.date}>
        {#snippet children(attrs)}
          <input
            {...attrs}
            type="date"
            class="form-input"
            max={todayIso()}
            bind:value={form!.date}
          />
        {/snippet}
      </FormField>
      <FormField
        id="bl-amount"
        label="Betrag in €"
        hint="Gesamtbetrag laut Beleg"
        error={errors.amountCent}
      >
        {#snippet children(attrs)}
          <input
            {...attrs}
            class="form-input"
            inputmode="decimal"
            placeholder="12,34"
            maxlength="12"
            autocomplete="off"
            bind:value={form!.amount}
          />
        {/snippet}
      </FormField>
      <FormField id="bl-paid-by" label="Bezahlt von" error={errors.paidBy}>
        {#snippet children(attrs)}
          <input {...attrs} class="form-input" maxlength="100" bind:value={form!.paidBy} />
        {/snippet}
      </FormField>
      <FormField
        id="bl-aktion"
        label="Aktion"
        hint="Aktion aus CampFlow oder z. B. „Gruppenstunde Wölflinge“"
        error={errors.aktion}
        class="sm:col-span-2"
      >
        {#snippet children(attrs)}
          <input
            {...attrs}
            class="form-input"
            maxlength="120"
            list="bl-aktion-suggestions"
            autocomplete="off"
            bind:value={form!.aktion}
          />
          <datalist id="bl-aktion-suggestions">
            {#each aktionSuggestions as title (title)}
              <option value={title}></option>
            {/each}
          </datalist>
        {/snippet}
      </FormField>
    </div>

    <label class="flex items-start gap-2 text-sm">
      <input type="checkbox" class="mt-1" bind:checked={form.payout} />
      <span>
        Mit eigenem Geld bezahlt – der Betrag soll ausgezahlt werden
        <span class="block text-xs text-neutral-700">
          Nicht ankreuzen, wenn mit der Stammeskarte oder aus der Kasse bezahlt wurde.
        </span>
      </span>
    </label>

    <FormField id="bl-note" label="Bemerkung" optional error={errors.note}>
      {#snippet children(attrs)}
        <textarea {...attrs} class="form-input" rows="2" maxlength="1000" bind:value={form!.note}
        ></textarea>
      {/snippet}
    </FormField>

    {#if form.id}
      <fieldset class="space-y-4 rounded-md border border-neutral-200 p-4">
        <legend class="form-label px-1">Vorprüfung durch die Kasse</legend>
        <p class="flex flex-wrap items-center gap-2 text-sm text-neutral-700">
          Status: {@render statusBadge(form.status)}
        </p>
        {#if !reviewer}
          {#if form.reviewNote}
            <p class="text-sm text-neutral-800">
              <span class="font-semibold">Bemerkung der Kasse:</span>
              {form.reviewNote}
            </p>
          {/if}
          {#if form.status === 'Abgelehnt'}
            <ActionButton
              variant="secondary"
              type="button"
              disabled={busy || photoBusy}
              onclick={() => save('Eingereicht')}>Erneut einreichen</ActionButton
            >
          {/if}
        {:else}
          <FormField
            id="bl-review-note"
            label="Bemerkung der Kasse"
            optional
            hint={`Pflicht beim Ablehnen. Die Begründung geht per Mail an ${form.submittedBy || 'die Person, die den Beleg eingereicht hat'}.`}
            error={errors.reviewNote}
          >
            {#snippet children(attrs)}
              <textarea
                {...attrs}
                class="form-input"
                rows="2"
                maxlength="1000"
                bind:value={form!.reviewNote}></textarea>
            {/snippet}
          </FormField>
          <div class="flex flex-wrap gap-2">
            {#if form.status !== 'Angenommen'}
              <ActionButton
                variant="primary"
                type="button"
                disabled={busy || photoBusy}
                onclick={() => save('Angenommen')}>Annehmen</ActionButton
              >
            {/if}
            {#if form.status !== 'Abgelehnt'}
              <ActionButton
                variant="danger"
                type="button"
                disabled={busy || photoBusy}
                onclick={() => save('Abgelehnt')}>Ablehnen</ActionButton
              >
            {:else}
              <ActionButton
                variant="secondary"
                type="button"
                disabled={busy || photoBusy}
                onclick={() => save('Eingereicht')}>Erneut einreichen</ActionButton
              >
            {/if}
          </div>
        {/if}
        <p class="text-xs text-neutral-700">
          {form.status === 'Abgelehnt'
            ? 'Nach dem Korrigieren der Angaben oder einem neuen Foto den Beleg erneut einreichen.'
            : reviewer
              ? 'Angenommene Belege: Foto herunterladen, in CampFlow als Beleg hochladen und den Beleg hier löschen.'
              : 'Die Kasse prüft den Beleg und überträgt ihn nach der Annahme nach CampFlow.'}
        </p>
      </fieldset>
    {/if}
  {/if}

  {#snippet actions()}
    {#if form?.id && (reviewer || form.status !== 'Angenommen')}
      {#if confirmDelete}
        <span class="flex flex-wrap items-center gap-2 text-sm">
          Wirklich löschen?
          <ActionButton variant="danger" type="button" disabled={busy || photoBusy} onclick={remove}
            >Ja, löschen</ActionButton
          >
          <ActionButton
            variant="secondary"
            type="button"
            disabled={busy}
            onclick={() => (confirmDelete = false)}>Nein</ActionButton
          >
        </span>
      {:else}
        <ActionButton
          variant="danger"
          type="button"
          disabled={busy || photoBusy}
          onclick={() => (confirmDelete = true)}
        >
          Löschen
        </ActionButton>
      {/if}
    {/if}
  {/snippet}
</EditDialog>
