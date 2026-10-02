<script lang="ts">
  import { untrack } from 'svelte';
  import { ApiError, sendApi } from '../../lib/api';
  import { authStore, fetchPrincipal, getFullName } from '../../lib/authStore.svelte';
  import { campflowEventsStore, fetchCampflowEvents } from '../../lib/campflowStore.svelte';
  import { belegePflege } from '../../lib/pflegeStore.svelte';
  import {
    BELEG_STATUSES,
    blobToBase64,
    centToInput,
    formatEuro,
    formatIsoDate,
    parseEuroToCent,
    prepareBelegPhoto,
    todayIso,
  } from '../../lib/belege';
  import type { PreparedPhoto } from '../../lib/belege';
  import type { BelegCheck, BelegStatus, StaffBeleg } from '../../lib/types';
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
    paidOut: boolean;
    hasImage: boolean;
    submittedBy: string;
    submittedAt: string;
    aiCheck: BelegCheck | null;
  }

  type View = 'offen' | 'geprueft' | 'alle';

  const VIEWS: { id: View; label: string }[] = [
    { id: 'offen', label: 'Offen' },
    { id: 'geprueft', label: 'Geprüft' },
    { id: 'alle', label: 'Alle' },
  ];
  const STATUS_CLASS: Record<BelegStatus, string> = {
    Eingereicht: 'bg-[var(--color-brand-100)] text-brand-900',
    Rückfrage: 'bg-[#fff1e0] text-[#8a4a00]',
    Geprüft: 'bg-[var(--color-dpsg-pfadfinder)]/10 text-[var(--color-dpsg-pfadfinder)]',
  };
  const PHOTO_BASE = '/api/intern/pflege/belege';
  const store = belegePflege.state;

  let view = $state<View>('offen');
  let onlyMine = $state(false);
  let search = $state('');
  let form = $state<Form | null>(null);
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  let photoBusy = $state(false);
  let dialogError = $state<string | null>(null);
  let confirmDelete = $state(false);
  let message = $state<string | null>(null);
  /** Photo chosen for a new receipt, with its preview URL. */
  let newPhoto = $state<PreparedPhoto | null>(null);
  let newPhotoUrl = $state<string | null>(null);
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
    offen: items.filter((b) => b.status !== 'Geprüft').length,
    geprueft: items.filter((b) => b.status === 'Geprüft').length,
    alle: items.length,
  });
  /** Checked receipts whose amount still has to be paid back. */
  const openPayouts = $derived(
    items.filter((b) => b.status === 'Geprüft' && b.payout && !b.paidOut)
  );
  const visible = $derived.by(() => {
    const query = search.trim().toLowerCase();
    return items
      .filter((b) =>
        view === 'offen'
          ? b.status !== 'Geprüft'
          : view === 'geprueft'
            ? b.status === 'Geprüft'
            : true
      )
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

  function clearNewPhoto(): void {
    if (newPhotoUrl) URL.revokeObjectURL(newPhotoUrl);
    newPhoto = null;
    newPhotoUrl = null;
  }

  function resetDialog(): void {
    clearNewPhoto();
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
      paidOut: false,
      hasImage: false,
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
    clearNewPhoto();
  }

  function validate(f: Form): Record<string, string> {
    const result: Record<string, string> = {};
    if (!f.id && !newPhoto) result.photo = 'Bitte ein Foto des Belegs hinzufügen.';
    if (!f.shop.trim()) result.shop = 'Bitte das Geschäft angeben.';
    if (!f.date) result.date = 'Bitte das Datum angeben.';
    else if (f.date > todayIso()) result.date = 'Das Datum liegt in der Zukunft.';
    if (parseEuroToCent(f.amount) === null)
      result.amountCent = 'Bitte einen Betrag wie 12,34 angeben.';
    if (!f.paidBy.trim()) result.paidBy = 'Bitte angeben, wer bezahlt hat.';
    if (!f.aktion.trim()) result.aktion = 'Bitte die Aktion angeben.';
    if (f.status === 'Rückfrage' && !f.reviewNote.trim()) {
      result.reviewNote = 'Bitte die Rückfrage beschreiben.';
    }
    return result;
  }

  async function choosePhoto(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !form) return;

    photoBusy = true;
    dialogError = null;
    try {
      const prepared = await prepareBelegPhoto(file);
      photoWarnings = prepared.warnings;
      if (!form.id) {
        clearNewPhoto();
        newPhoto = prepared;
        newPhotoUrl = URL.createObjectURL(prepared.blob);
        errors = Object.fromEntries(Object.entries(errors).filter(([field]) => field !== 'photo'));
        void checkNewPhoto(prepared.blob);
        return;
      }
      // Existing receipts get the new photo right away
      const id = form.id;
      await sendApi('PUT', `/intern/pflege/belege/${id}/foto`, prepared.blob, { etag: form.etag });
      await refreshEtag(id);
      message = 'Foto ersetzt.';
    } catch (error: unknown) {
      dialogError =
        error instanceof ApiError
          ? error.message
          : 'Das Foto konnte nicht gelesen werden. Bitte ein JPEG- oder PNG-Foto wählen.';
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
    }
  }

  async function save(): Promise<void> {
    if (!form) return;
    errors = validate(form);
    if (Object.keys(errors).length > 0) return;

    busy = true;
    dialogError = null;
    const { id, etag, shop, date, paidBy, payout, aktion, note, status, reviewNote, paidOut } =
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
    try {
      if (id) {
        await sendApi('PATCH', `/intern/pflege/belege/${id}`, {
          ...details,
          etag,
          status,
          reviewNote,
          paidOut: payout && paidOut,
        });
        message = `Beleg von ${shop} gespeichert.`;
      } else {
        const photo = await blobToBase64(newPhoto!.blob);
        await sendApi('POST', '/intern/pflege/belege', { ...details, photo });
        message = `Beleg von ${shop} über ${formatEuro(details.amountCent!)} eingereicht. Danke!`;
        view = 'offen';
      }
      form = null;
      clearNewPhoto();
      await belegePflege.load({ force: true });
    } catch (error: unknown) {
      handleError(error);
    } finally {
      busy = false;
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
    <div role="note" class="space-y-1 rounded-md bg-[#fff1e0] p-3 text-xs text-[#8a4a00]">
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
{/snippet}

{#snippet statusBadge(status: BelegStatus)}
  <span class="rounded-full px-2 py-0.5 text-xs font-semibold {STATUS_CLASS[status]}">{status}</span
  >
{/snippet}

<div class="space-y-6">
  <section aria-labelledby="belege-intro" class="surface space-y-3 p-4 sm:p-6">
    <h2 id="belege-intro" class="font-serif text-xl text-brand-900">So geht's</h2>
    <ol class="list-decimal space-y-1 pl-5 text-sm text-neutral-700">
      <li>Beleg flach und gut beleuchtet fotografieren, sodass alle Ränder zu sehen sind.</li>
      <li>Geschäft, Datum, Betrag und Aktion eintragen und einreichen.</li>
      <li>
        Das Kassenteam prüft den Beleg, stellt bei Bedarf eine Rückfrage und überträgt ihn danach
        nach CampFlow.
      </li>
    </ol>
    <button type="button" class="btn-primary" disabled={!store.data} onclick={create}>
      Beleg einreichen
    </button>
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
    <button
      type="button"
      class="btn-secondary"
      disabled={store.loading}
      onclick={() => belegePflege.load({ force: true })}
    >
      Neu laden
    </button>
    <div class="flex flex-wrap items-center gap-1.5 sm:col-span-2">
      <div class="flex flex-wrap gap-1.5" role="group" aria-label="Nach Status filtern">
        {#each VIEWS as option (option.id)}
          <button
            type="button"
            aria-pressed={view === option.id}
            onclick={() => (view = option.id)}
            class="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 aria-pressed:border-[var(--color-brand-800)] aria-pressed:bg-[var(--color-brand-800)] aria-pressed:text-white"
          >
            {option.label}
            {#if store.data}({counts[option.id]}){/if}
          </button>
        {/each}
      </div>
      <label class="ml-auto inline-flex items-center gap-2 text-sm">
        <input type="checkbox" bind:checked={onlyMine} disabled={!login} />
        Nur meine Belege
      </label>
    </div>
  </form>

  <StatusNotice {message} />

  {#if openPayouts.length > 0}
    <p class="surface p-4 text-sm text-neutral-800">
      Noch auszuzahlen: <strong
        >{formatEuro(openPayouts.reduce((sum, b) => sum + b.amountCent, 0))}</strong
      >
      für {openPayouts.length}
      {openPayouts.length === 1 ? 'geprüften Beleg' : 'geprüfte Belege'}.
    </p>
  {/if}

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
      <button
        type="button"
        class="btn-primary mt-4"
        onclick={() => belegePflege.load({ force: true })}
      >
        Erneut versuchen
      </button>
    </div>
  {:else if visible.length === 0}
    <p class="surface p-6 text-sm text-neutral-700">
      {view === 'offen' && !search && !onlyMine
        ? 'Keine offenen Belege. Alles geprüft!'
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
              {#if beleg.status === 'Rückfrage' && beleg.reviewNote}
                <span class="mt-1 line-clamp-2 block text-xs text-[#8a4a00]"
                  >Rückfrage: {beleg.reviewNote}</span
                >
              {/if}
              <span class="mt-1.5 flex flex-wrap gap-1">
                {@render statusBadge(beleg.status)}
                {#if beleg.payout}
                  <span class="tag">{beleg.paidOut ? 'Ausgezahlt' : 'Auszahlung'}</span>
                {/if}
                {#if beleg.aiCheck && !beleg.aiCheck.ok}
                  <span
                    class="rounded-full bg-[#fff1e0] px-2 py-0.5 text-xs font-semibold text-[#8a4a00]"
                    >KI: Mängel</span
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
  onsubmit={save}
  onclose={close}
>
  {#if form}
    <section aria-labelledby="bl-photo-label" class="space-y-2">
      <p id="bl-photo-label" class="form-label">Foto des Belegs</p>
      {#if form.id && form.hasImage}
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
      {:else if newPhotoUrl && newPhoto}
        <img
          src={newPhotoUrl}
          alt="Vorschau des gewählten Fotos"
          width={newPhoto.width}
          height={newPhoto.height}
          class="max-h-96 w-auto rounded-md border border-neutral-200 bg-neutral-100 object-contain"
        />
      {/if}
      <div class="flex flex-wrap gap-2">
        <label class="btn-secondary cursor-pointer" class:opacity-60={photoBusy}>
          {photoBusy
            ? 'Wird verarbeitet …'
            : form.hasImage || newPhoto
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
        {#if form.id && form.hasImage}
          <a class="btn-secondary" href="{photoUrl(form)}&download=1" download>
            Foto herunterladen
          </a>
        {/if}
      </div>
      {#if photoWarnings.length > 0}
        <ul role="note" class="space-y-1 rounded-md bg-[#fff1e0] p-3 text-xs text-[#8a4a00]">
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
        <legend class="form-label px-1">Prüfung durch das Kassenteam</legend>
        <div class="flex flex-wrap gap-x-4 gap-y-2" role="radiogroup" aria-label="Status">
          {#each BELEG_STATUSES as status (status)}
            <label class="inline-flex items-center gap-2 text-sm">
              <input type="radio" name="bl-status" value={status} bind:group={form.status} />
              {status}
            </label>
          {/each}
        </div>
        <FormField
          id="bl-review-note"
          label={form.status === 'Rückfrage' ? 'Rückfrage' : 'Notiz des Kassenteams'}
          optional={form.status !== 'Rückfrage'}
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
        {#if form.payout}
          <label class="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" bind:checked={form.paidOut} />
            Betrag wurde an {form.paidBy || 'die Person'} ausgezahlt
          </label>
        {/if}
        <p class="text-xs text-neutral-700">
          Nach der Prüfung das Foto herunterladen, in CampFlow als Beleg hochladen und den Beleg
          hier löschen.
        </p>
      </fieldset>
    {/if}
  {/if}

  {#snippet actions()}
    {#if form?.id}
      {#if confirmDelete}
        <span class="flex flex-wrap items-center gap-2 text-sm">
          Wirklich löschen?
          <button type="button" class="btn-danger" disabled={busy || photoBusy} onclick={remove}
            >Ja, löschen</button
          >
          <button
            type="button"
            class="btn-secondary"
            disabled={busy}
            onclick={() => (confirmDelete = false)}>Nein</button
          >
        </span>
      {:else}
        <button
          type="button"
          class="btn-danger"
          disabled={busy || photoBusy}
          onclick={() => (confirmDelete = true)}
        >
          Löschen
        </button>
      {/if}
    {/if}
  {/snippet}
</EditDialog>
