<script lang="ts">
  import LeaderAvatar from '../LeaderAvatar.svelte';
  import { canvasToJpeg } from '../../lib/image';
  import ReloadButton from './ReloadButton.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import { onMount, untrack } from 'svelte';
  import { sendApi } from '../../lib/api';
  import { createDialogForm } from '../../lib/dialogForm.svelte';
  import { leitendePflege } from '../../lib/pflegeStore.svelte';
  import type { StaffLeitende } from '../../lib/types';
  import EditDialog from './EditDialog.svelte';
  import FormField from './FormField.svelte';
  import StatusNotice from './StatusNotice.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import { confirmAction } from '../../lib/confirm';

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
  /** Phone and address are only used (and kept) for members of this team. */
  const VORSTAND = 'Vorstand';
  const PHOTO_SIZE = 600;
  const store = leitendePflege.state;

  let filter = $state(ALL);
  onMount(() => {
    filter = new URLSearchParams(location.search).get('team') || ALL;
  });
  let search = $state('');
  let form = $state<Form | null>(null);
  const dialog = createDialogForm();
  const errors = $derived(dialog.state.fields);
  const busy = $derived(dialog.state.busy);
  let photoBusy = $state(false);
  let dialogNotice = $state<string | null>(null);
  let photoInput = $state<HTMLInputElement | null>(null);
  let editDialog = $state<EditDialog | null>(null);
  let message = $state<string | null>(null);
  /** Changes after a photo upload so the browser loads the new image. */
  let photoVersion = $state(Date.now());
  /** Whether the person had contact details when the dialog was opened. */
  let hadContactDetails = $state(false);

  const isVorstand = $derived(form?.teams.includes(VORSTAND) ?? false);

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

  function edit(person: StaffLeitende): void {
    form = { ...person, teams: [...person.teams] };
    hadContactDetails = Boolean(person.phone || person.street || person.postalCode || person.city);
    dialog.reset();
    dialogNotice = null;
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
    hadContactDetails = false;
    dialog.reset();
    dialogNotice = null;
  }

  /** After a conflict: replaces the input with the current version of the person. */
  async function reloadCurrent(): Promise<boolean> {
    const id = form?.id;
    await leitendePflege.load({ force: true });
    const fresh = store.data?.items.find((p) => p.id === id);
    if (!fresh) {
      form = null;
      message = 'Die Person wurde inzwischen gelöscht.';
      return false;
    }
    edit(fresh);
    return true;
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
    if (!f.teams.includes(VORSTAND)) return result;
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
    if (dialog.invalid(validate(form))) return;

    const { id, etag, name, teams, phone, street, postalCode, city } = form;
    // Contact details are only kept for the Vorstand (the API enforces this as well)
    const contact = teams.includes(VORSTAND)
      ? { phone, street, postalCode, city }
      : { phone: '', street: '', postalCode: '', city: '' };
    const body = { etag, name, teams, ...contact };
    await dialog.run(async () => {
      if (id) {
        await sendApi('PATCH', `/intern/pflege/leitende/${id}`, body);
        message = `${name} gespeichert.`;
        form = null;
        await leitendePflege.load({ force: true });
      } else {
        const created = await sendApi<{ id: string }>('POST', '/intern/pflege/leitende', body);
        const text = `${name} angelegt. Du kannst jetzt ein Foto hinzufügen.`;
        await leitendePflege.load({ force: true });
        const person = store.data?.items.find((p) => p.id === created.id);
        // The dialog reopens for the photo, so the confirmation is shown inside it.
        if (person) {
          edit(person);
          dialogNotice = text;
        } else {
          message = text;
          form = null;
        }
      }
    }, 'Die Person wurde nicht gespeichert. Deine Eingaben sind noch da. Prüfe deine Internetverbindung und tippe noch einmal auf „Speichern“.');
  }

  async function remove(): Promise<void> {
    // Never delete while a photo is being uploaded or removed
    const current = form;
    if (!current?.id || photoBusy) return;
    await dialog.run(async () => {
      await sendApi('DELETE', `/intern/pflege/leitende/${current.id}`, undefined, {
        etag: current.etag,
      });
      message = `${current.name} gelöscht.`;
      form = null;
      await leitendePflege.load({ force: true });
    }, 'Die Person wurde nicht gelöscht. Tippe noch einmal auf „Löschen“.');
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
    return canvasToJpeg(canvas);
  }

  async function uploadPhoto(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !form?.id) return;
    const id = form.id;

    photoBusy = true;
    dialog.state.error = null;
    dialog.state.conflict = false;
    dialogNotice = null;
    try {
      const jpeg = await toSquareJpeg(file);
      const saved = await sendApi<{ etag: string; hasImage: boolean }>(
        'PUT',
        `/intern/pflege/leitende/${id}/foto`,
        jpeg,
        { etag: form.etag }
      );
      if (form?.id !== id) return;
      applyPhoto(id, saved);
      photoVersion = Date.now();
      dialogNotice = 'Foto gespeichert.';
    } catch (error: unknown) {
      dialog.fail(
        error,
        'Das Foto wurde nicht gespeichert. Prüfe deine Internetverbindung und wähle es noch einmal aus.'
      );
    } finally {
      photoBusy = false;
    }
  }

  async function removePhoto(): Promise<void> {
    const target = form;
    if (!target?.id) return;
    const id = target.id;
    const confirmed = await confirmAction({
      title: 'Foto entfernen?',
      message: `Foto von ${target.name} entfernen?`,
      confirmLabel: 'Entfernen',
    });
    // The dialog may have been saved or closed meanwhile
    if (!confirmed || !form || form.id !== id) return;
    photoBusy = true;
    dialog.state.error = null;
    dialog.state.conflict = false;
    dialogNotice = null;
    try {
      const saved = await sendApi<{ etag: string; hasImage: boolean }>(
        'DELETE',
        `/intern/pflege/leitende/${id}/foto`,
        undefined,
        {
          etag: form.etag,
        }
      );
      if (form?.id !== id) return;
      applyPhoto(id, saved);
      dialogNotice = 'Foto entfernt.';
      // The button is gone; keep the focus on the photo controls.
      photoInput?.focus();
    } catch (error: unknown) {
      dialog.fail(error, 'Das Foto wurde nicht entfernt. Tippe noch einmal auf „Foto entfernen“.');
    } finally {
      photoBusy = false;
    }
  }

  /** Only the exact photo-write version belongs to this draft, never a later list version. */
  function applyPhoto(id: string, saved: { etag: string; hasImage: boolean }): void {
    if (form?.id === id) {
      editDialog?.acceptRescueVersion(form.etag, saved.etag);
      form.etag = saved.etag;
      form.hasImage = saved.hasImage;
    }
    if (store.data)
      store.data.items = store.data.items.map((person) =>
        person.id === id ? { ...person, ...saved } : person
      );
  }
</script>

<div class="space-y-6">
  <form
    class="grid gap-4 border-b border-neutral-200 pb-5 sm:grid-cols-[1fr_auto] sm:items-end"
    role="search"
    aria-label="Leitende filtern"
    onsubmit={(event) => event.preventDefault()}
  >
    <label class="block text-sm">
      <span class="form-label">Nach Name suchen</span>
      <input type="search" class="form-input" bind:value={search} />
    </label>
    <div class="flex gap-2">
      <ReloadButton resource={leitendePflege} />
      <ActionButton variant="primary" type="button" disabled={!store.data} onclick={create}
        >Neue Person</ActionButton
      >
    </div>
    <FilterTabs
      class="sm:col-span-2"
      label="Nach Team filtern"
      options={[ALL, ...teams].map((team) => ({
        value: team,
        label: team === ALL ? 'Alle' : team,
      }))}
      value={filter}
      onselect={(team) => (filter = team)}
    />
  </form>

  <StatusNotice {message} popup />

  <LoadState
    data={store.data}
    loading={store.loading}
    error={store.error}
    loadingText="Leitende werden geladen …"
    onretry={() => void leitendePflege.load({ force: true })}
    isEmpty={() => visible.length === 0}
  >
    {#snippet skeleton()}
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each [1, 2, 3, 4, 5, 6] as n (n)}
          <div class="skeleton-element h-20 rounded-[var(--radius-lg)]"></div>
        {/each}
      </div>
    {/snippet}
    {#snippet empty()}
      <p class="py-4 text-sm text-neutral-700">Keine Personen für diese Auswahl.</p>
    {/snippet}
    <ul class="grid border-b border-neutral-200 sm:grid-cols-2 sm:gap-x-8 lg:grid-cols-3">
      {#each visible as person (person.id)}
        <li class="border-t border-neutral-200">
          <button
            type="button"
            class="group flex w-full items-center gap-3 py-3 text-left"
            onclick={() => edit(person)}
          >
            <LeaderAvatar
              id={person.id}
              name={person.name}
              hasImage={person.hasImage}
              version={photoVersion}
              decorative
            />
            <span class="min-w-0">
              <span class="block truncate font-semibold text-brand-900 group-hover:underline"
                >{person.name}</span
              >
              <span class="mt-0.5 block text-sm text-neutral-700">
                {person.teams.length > 0 ? person.teams.join(' · ') : 'Kein Team'}
              </span>
            </span>
            <span class="sr-only">bearbeiten</span>
          </button>
        </li>
      {/each}
    </ul>
  </LoadState>
</div>

<EditDialog
  bind:this={editDialog}
  open={form !== null}
  title={form?.id ? `${form.name || 'Person'} bearbeiten` : 'Neue Person'}
  rescueKey={form ? `leitende:${form.id ?? 'neu'}` : undefined}
  rescueVersion={form?.etag}
  busy={busy || photoBusy}
  error={dialog.state.error}
  notice={dialogNotice}
  onreload={dialog.state.conflict ? reloadCurrent : undefined}
  submitLabel={form?.id ? 'Speichern' : 'Anlegen'}
  onsubmit={save}
  onclose={close}
  ondelete={form?.id ? remove : undefined}
  deleteTitle={`${form?.name || 'Person'} löschen?`}
  deleteQuestion="Diese Person mit Foto endgültig löschen?"
>
  {#if form}
    {#if form.id}
      <section aria-labelledby="ld-photo-label" class="flex flex-wrap items-center gap-4">
        <LeaderAvatar
          id={form.id ?? ''}
          name={form.name}
          hasImage={form.hasImage}
          version={photoVersion}
          size="xl"
          decorative
        />
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
                bind:this={photoInput}
                type="file"
                accept="image/*"
                class="sr-only"
                disabled={photoBusy}
                onchange={uploadPhoto}
              />
            </label>
            {#if form.hasImage}
              <ActionButton
                variant="danger"
                type="button"
                disabled={busy || photoBusy}
                onclick={removePhoto}>Foto entfernen</ActionButton
              >
            {/if}
          </div>
          <p class="text-xs text-neutral-700">Wird sofort gespeichert.</p>
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
      <legend class="form-label float-left">Teams</legend>
      <InfoHint
        label="Teams"
        text="Stufen-Teams erscheinen bei den Gruppenstunden auf der Website, „Vorstand“ auf der Vorstandsseite."
        class="ml-1"
      />
      <div class="mt-1 flex flex-wrap gap-x-4 gap-y-2 clear-left">
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
    </fieldset>

    {#if !isVorstand && hadContactDetails}
      <p role="note" class="border-l-2 border-warning py-1 pl-3 text-sm text-warning">
        Telefon und Adresse werden beim Speichern entfernt (nur für den Vorstand).
      </p>
    {/if}

    {#if isVorstand}
      <fieldset class="space-y-4 border-t border-neutral-200 pt-4 *:clear-left">
        <legend class="form-label float-left mb-1 w-full"
          >Kontakt (Vorstand, öffentlich auf der Website)</legend
        >

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
          <FormField id="ld-postal" label="PLZ" optional error={errors.postalCode}>
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
          <FormField id="ld-city" label="Ort" optional error={errors.city}>
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
      </fieldset>
    {/if}
  {/if}
</EditDialog>
