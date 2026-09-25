<script lang="ts">
  import { untrack } from 'svelte';
  import { ApiError, getLeaderImageUrl, sendApi } from '../../lib/api';
  import { leitendePflege } from '../../lib/pflegeStore.svelte';
  import type { StaffLeitende } from '../../lib/types';
  import EditDialog from './EditDialog.svelte';
  import FormField from './FormField.svelte';

  interface Form {
    id: string | null;
    etag: string;
    name: string;
    teams: string[];
    phone: string;
    street: string;
    postalCode: string;
    city: string;
    hasImage: boolean;
  }

  const ALL = 'alle';
  const PHOTO_SIZE = 600;
  const store = leitendePflege.state;

  let filter = $state(ALL);
  let search = $state('');
  let form = $state<Form | null>(null);
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  let photoBusy = $state(false);
  let dialogError = $state<string | null>(null);
  let confirmDelete = $state(false);
  let message = $state<string | null>(null);
  /** Changes after a photo upload so the browser loads the new image. */
  let photoVersion = $state(Date.now());

  const teams = $derived(store.data?.teams ?? []);
  const visible = $derived.by(() => {
    const query = search.trim().toLowerCase();
    return [...(store.data?.items ?? [])]
      .filter((p) => filter === ALL || p.teams.includes(filter))
      .filter((p) => !query || p.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  });

  $effect(() => {
    untrack(() => leitendePflege.load());
  });

  function initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('');
  }

  function edit(person: StaffLeitende): void {
    form = { ...person, teams: [...person.teams] };
    errors = {};
    dialogError = null;
    confirmDelete = false;
  }

  function create(): void {
    form = {
      id: null,
      etag: '',
      name: '',
      teams: filter === ALL ? [] : [filter],
      phone: '',
      street: '',
      postalCode: '',
      city: '',
      hasImage: false,
    };
    errors = {};
    dialogError = null;
    confirmDelete = false;
  }

  function close(): void {
    if (!busy && !photoBusy) form = null;
  }

  function toggleTeam(team: string): void {
    if (!form) return;
    form.teams = form.teams.includes(team)
      ? form.teams.filter((t) => t !== team)
      : [...form.teams, team];
  }

  function validate(f: Form): Record<string, string> {
    const result: Record<string, string> = {};
    if (!f.name.trim()) result.name = 'Bitte einen Namen angeben.';
    if (f.postalCode && !/^\d{5}$/.test(f.postalCode.trim())) {
      result.postalCode = 'Bitte eine fünfstellige PLZ angeben.';
    }
    const parts = [f.street, f.postalCode, f.city].filter((v) => v.trim()).length;
    if (parts > 0 && parts < 3)
      result.street = 'Bitte die Adresse vollständig oder gar nicht angeben.';
    return result;
  }

  async function save(): Promise<void> {
    if (!form) return;
    errors = validate(form);
    if (Object.keys(errors).length > 0) return;

    busy = true;
    dialogError = null;
    const { id, etag, name, teams, phone, street, postalCode, city } = form;
    const body = { etag, name, teams, phone, street, postalCode, city };
    try {
      if (id) {
        await sendApi('PATCH', `/intern/pflege/leitende/${id}`, body);
        message = `${form.name} gespeichert.`;
        form = null;
        await leitendePflege.load({ force: true });
      } else {
        const created = await sendApi<{ id: string }>('POST', '/intern/pflege/leitende', body);
        message = `${form.name} angelegt. Du kannst jetzt ein Foto hinzufügen.`;
        await leitendePflege.load({ force: true });
        const person = store.data?.items.find((p) => p.id === created.id);
        if (person) edit(person);
        else form = null;
      }
    } catch (error: unknown) {
      handleError(error);
    } finally {
      busy = false;
    }
  }

  async function remove(): Promise<void> {
    if (!form?.id) return;
    busy = true;
    try {
      await sendApi('DELETE', `/intern/pflege/leitende/${form.id}`);
      message = `${form.name} gelöscht.`;
      form = null;
      await leitendePflege.load({ force: true });
    } catch (error: unknown) {
      handleError(error);
    } finally {
      busy = false;
    }
  }

  /** Crops the image to a centered square and scales it to a JPEG of PHOTO_SIZE px. */
  async function toSquareJpeg(file: File): Promise<Blob> {
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const size = Math.min(PHOTO_SIZE, side);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas not available');
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size
    );
    bitmap.close();
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
        'image/jpeg',
        0.85
      )
    );
  }

  async function uploadPhoto(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !form?.id) return;

    photoBusy = true;
    dialogError = null;
    try {
      const jpeg = await toSquareJpeg(file);
      await sendApi('PUT', `/intern/pflege/leitende/${form.id}/foto`, jpeg);
      form.hasImage = true;
      photoVersion = Date.now();
      await refreshEtag();
    } catch (error: unknown) {
      dialogError =
        error instanceof ApiError ? error.message : 'Das Foto konnte nicht verarbeitet werden.';
    } finally {
      photoBusy = false;
    }
  }

  async function removePhoto(): Promise<void> {
    if (!form?.id) return;
    photoBusy = true;
    dialogError = null;
    try {
      await sendApi('DELETE', `/intern/pflege/leitende/${form.id}/foto`);
      form.hasImage = false;
      await refreshEtag();
    } catch (error: unknown) {
      handleError(error);
    } finally {
      photoBusy = false;
    }
  }

  /** A photo change creates a new version of the item; take over its etag for the next save. */
  async function refreshEtag(): Promise<void> {
    await leitendePflege.load({ force: true });
    const current = store.data?.items.find((p) => p.id === form?.id);
    if (form && current) form.etag = current.etag;
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

{#snippet avatar(person: { id: string | null; name: string; hasImage: boolean }, size: string)}
  {#if person.hasImage && person.id}
    <img
      src="{getLeaderImageUrl(person.id)}?v={photoVersion}"
      alt=""
      aria-hidden="true"
      width="96"
      height="96"
      class="{size} shrink-0 rounded-full object-cover"
    />
  {:else}
    <span
      aria-hidden="true"
      class="{size} flex shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-100)] font-semibold text-brand-900"
    >
      {initials(person.name) || '?'}
    </span>
  {/if}
{/snippet}

<div class="space-y-6">
  <form
    class="surface grid gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-end"
    role="search"
    aria-label="Leitende filtern"
    onsubmit={(event) => event.preventDefault()}
  >
    <label class="block text-sm">
      <span class="font-semibold text-neutral-700">Suche</span>
      <input type="search" class="form-input" placeholder="Name …" bind:value={search} />
    </label>
    <div class="flex gap-2">
      <button
        type="button"
        class="btn-secondary"
        disabled={store.loading}
        onclick={() => leitendePflege.load({ force: true })}
      >
        Neu laden
      </button>
      <button type="button" class="btn-primary" disabled={!store.data} onclick={create}
        >Neue Person</button
      >
    </div>
    <div class="flex flex-wrap gap-1.5 sm:col-span-2" role="group" aria-label="Nach Team filtern">
      {#each [ALL, ...teams] as team (team)}
        <button
          type="button"
          aria-pressed={filter === team}
          onclick={() => (filter = team)}
          class="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 aria-pressed:border-[var(--color-brand-800)] aria-pressed:bg-[var(--color-brand-800)] aria-pressed:text-white"
        >
          {team === ALL ? 'Alle' : team}
        </button>
      {/each}
    </div>
  </form>

  <p role="status" aria-live="polite" class="text-sm text-[var(--color-dpsg-pfadfinder)]">
    {message ?? ''}
  </p>

  {#if !store.data && store.loading}
    <div role="status" aria-live="polite" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <span class="sr-only">Leitende werden geladen …</span>
      {#each [1, 2, 3, 4, 5, 6] as n (n)}
        <div class="skeleton-element h-20 rounded-[var(--radius-lg)]"></div>
      {/each}
    </div>
  {:else if !store.data}
    <div role="alert" class="surface p-6 border-l-4! border-l-[var(--color-dpsg-red)]!">
      <p class="text-sm text-neutral-700">{store.error}</p>
      <button
        type="button"
        class="btn-primary mt-4"
        onclick={() => leitendePflege.load({ force: true })}
      >
        Erneut versuchen
      </button>
    </div>
  {:else if visible.length === 0}
    <p class="surface p-6 text-sm text-neutral-700">Keine Personen für diese Auswahl.</p>
  {:else}
    <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each visible as person (person.id)}
        <li>
          <button
            type="button"
            class="card flex w-full items-center gap-3 text-left hover:border-[var(--color-brand-300)]"
            onclick={() => edit(person)}
          >
            {@render avatar(person, 'size-12')}
            <span class="min-w-0">
              <span class="block truncate font-semibold text-brand-900">{person.name}</span>
              <span class="mt-1 flex flex-wrap gap-1">
                {#each person.teams as team (team)}
                  <span class="tag">{team}</span>
                {:else}
                  <span class="text-xs text-neutral-700">Kein Team</span>
                {/each}
              </span>
            </span>
            <span class="sr-only">bearbeiten</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<EditDialog
  open={form !== null}
  title={form?.id ? `${form.name || 'Person'} bearbeiten` : 'Neue Person'}
  busy={busy || photoBusy}
  error={dialogError}
  submitLabel={form?.id ? 'Speichern' : 'Anlegen'}
  onsubmit={save}
  onclose={close}
>
  {#if form}
    {#if form.id}
      <section aria-labelledby="ld-photo-label" class="flex flex-wrap items-center gap-4">
        {@render avatar(form, 'size-24 text-2xl')}
        <div class="space-y-2">
          <p id="ld-photo-label" class="form-label">Foto</p>
          <div class="flex flex-wrap gap-2">
            <label class="btn-secondary cursor-pointer" class:opacity-60={photoBusy}>
              {photoBusy
                ? 'Wird verarbeitet …'
                : form.hasImage
                  ? 'Foto ersetzen'
                  : 'Foto hochladen'}
              <input
                type="file"
                accept="image/*"
                class="sr-only"
                disabled={photoBusy}
                onchange={uploadPhoto}
              />
            </label>
            {#if form.hasImage}
              <button type="button" class="btn-danger" disabled={photoBusy} onclick={removePhoto}
                >Foto entfernen</button
              >
            {/if}
          </div>
          <p class="text-xs text-neutral-700">
            Wird quadratisch zugeschnitten und direkt gespeichert.
          </p>
        </div>
      </section>
    {/if}

    <FormField id="ld-name" label="Name" error={errors.name}>
      {#snippet children(attrs)}
        <input
          {...attrs}
          class="form-input"
          maxlength="100"
          autocomplete="off"
          bind:value={form!.name}
        />
      {/snippet}
    </FormField>

    <fieldset>
      <legend class="form-label">Teams</legend>
      <div class="mt-1 flex flex-wrap gap-x-4 gap-y-2">
        {#each teams as team (team)}
          <label class="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.teams.includes(team)}
              onchange={() => toggleTeam(team)}
            />
            {team}
          </label>
        {/each}
      </div>
      <p class="mt-1 text-xs text-neutral-700">
        Stufen-Teams erscheinen bei den Gruppenstunden, „Vorstand“ auf der Vorstandsseite.
      </p>
    </fieldset>

    <div class="rounded-md bg-[var(--color-neutral-50)] p-3 text-xs text-neutral-700">
      Telefon und Adresse werden nur für den Vorstand öffentlich angezeigt (Vorstandsseite,
      Impressum).
    </div>

    <FormField id="ld-phone" label="Telefon" optional error={errors.phone}>
      {#snippet children(attrs)}
        <input
          {...attrs}
          type="tel"
          class="form-input"
          maxlength="40"
          autocomplete="off"
          bind:value={form!.phone}
        />
      {/snippet}
    </FormField>

    <div class="grid gap-4 sm:grid-cols-[2fr_1fr_2fr]">
      <FormField id="ld-street" label="Straße" optional error={errors.street}>
        {#snippet children(attrs)}
          <input
            {...attrs}
            class="form-input"
            maxlength="120"
            autocomplete="off"
            bind:value={form!.street}
          />
        {/snippet}
      </FormField>
      <FormField id="ld-postal" label="PLZ" error={errors.postalCode}>
        {#snippet children(attrs)}
          <input
            {...attrs}
            class="form-input"
            inputmode="numeric"
            maxlength="5"
            autocomplete="off"
            bind:value={form!.postalCode}
          />
        {/snippet}
      </FormField>
      <FormField id="ld-city" label="Ort" error={errors.city}>
        {#snippet children(attrs)}
          <input
            {...attrs}
            class="form-input"
            maxlength="80"
            autocomplete="off"
            bind:value={form!.city}
          />
        {/snippet}
      </FormField>
    </div>
  {/if}

  {#snippet actions()}
    {#if form?.id}
      {#if confirmDelete}
        <span class="flex items-center gap-2 text-sm">
          Wirklich löschen?
          <button type="button" class="btn-danger" disabled={busy} onclick={remove}
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
