<script lang="ts">
  import ReloadButton from './ReloadButton.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import { untrack } from 'svelte';
  import { sendApi } from '../../lib/api';
  import { createDialogForm } from '../../lib/dialogForm.svelte';
  import { gruppenstundenPflege } from '../../lib/pflegeStore.svelte';
  import { GROUP_CONFIG, STUFE_ORDER, STUFE_TO_KEY } from '../../lib/types';
  import type { StaffGruppenstunde } from '../../lib/types';
  import EditDialog from './EditDialog.svelte';
  import FormField from './FormField.svelte';
  import RichTextEditor from './RichTextEditor.svelte';
  import StatusNotice from './StatusNotice.svelte';
  import LeaderAvatar from '../LeaderAvatar.svelte';

  interface Form {
    id: string | null;
    etag: string;
    stufe: string;
    weekday: string;
    start: string;
    end: string;
    ageRange: string;
    location: string;
    description: string;
    /** Original time text if it could not be split into start and end. */
    legacyTime: string;
  }

  const store = gruppenstundenPflege.state;

  let form = $state<Form | null>(null);
  const dialog = createDialogForm();
  const errors = $derived(dialog.state.fields);
  const busy = $derived(dialog.state.busy);
  let message = $state<string | null>(null);

  const items = $derived(
    [...(store.data?.items ?? [])].sort(
      (a, b) => (STUFE_ORDER[a.stufe] ?? 99) - (STUFE_ORDER[b.stufe] ?? 99)
    )
  );
  const freeStufen = $derived(
    (store.data?.stufen ?? []).filter((s) => !items.some((i) => i.stufe === s))
  );
  const weekdayOptions = $derived.by(() => {
    const options = store.data?.weekdays ?? [];
    return form?.weekday && !options.includes(form.weekday) ? [form.weekday, ...options] : options;
  });

  $effect(() => {
    untrack(() => gruppenstundenPflege.load());
  });

  function config(stufe: string) {
    const key = STUFE_TO_KEY[stufe];
    return key ? GROUP_CONFIG[key] : null;
  }

  /** Maps free-text weekdays like "Montag" onto the options ("Montags"). */
  function normalizeWeekday(weekday: string): string {
    const options = store.data?.weekdays ?? [];
    return options.find((o) => o.toLowerCase().startsWith(weekday.trim().toLowerCase())) ?? weekday;
  }

  function splitTime(time: string): { start: string; end: string } | null {
    const match = /(\d{1,2}):(\d{2}).*?(\d{1,2}):(\d{2})/.exec(time);
    if (!match) return null;
    const pad = (h: string) => h.padStart(2, '0');
    return { start: `${pad(match[1])}:${match[2]}`, end: `${pad(match[3])}:${match[4]}` };
  }

  function edit(item: StaffGruppenstunde): void {
    const time = splitTime(item.time);
    form = {
      id: item.id,
      etag: item.etag,
      stufe: item.stufe,
      weekday: normalizeWeekday(item.weekday),
      start: time?.start ?? '',
      end: time?.end ?? '',
      ageRange: item.ageRange,
      location: item.location,
      description: item.description,
      legacyTime: time ? '' : item.time,
    };
    openDialog();
  }

  function create(): void {
    form = {
      id: null,
      etag: '',
      stufe: freeStufen[0] ?? '',
      weekday: '',
      start: '',
      end: '',
      ageRange: '',
      location: '',
      description: '',
      legacyTime: '',
    };
    openDialog();
  }

  function openDialog(): void {
    dialog.reset();
  }

  /** After a conflict: replaces the input with the current version of the entry. */
  async function reloadCurrent(): Promise<boolean> {
    const id = form?.id;
    await gruppenstundenPflege.load({ force: true });
    const fresh = store.data?.items.find((item) => item.id === id);
    if (!fresh) {
      form = null;
      message = 'Die Gruppenstunde wurde inzwischen gelöscht.';
      return false;
    }
    edit(fresh);
    return true;
  }

  function close(): void {
    if (!busy) form = null;
  }

  function validate(f: Form): Record<string, string> {
    const result: Record<string, string> = {};
    if (!f.stufe) result.stufe = 'Bitte eine Stufe wählen.';
    if (!f.weekday) result.weekday = 'Bitte einen Wochentag wählen.';
    if (!f.start || !f.end) result.time = 'Bitte Beginn und Ende angeben.';
    else if (f.end <= f.start) result.time = 'Das Ende muss nach dem Beginn liegen.';
    if (!f.location.trim()) result.location = 'Bitte einen Ort angeben.';
    return result;
  }

  async function save(): Promise<void> {
    if (!form) return;
    if (dialog.invalid(validate(form))) return;

    const current = form;
    const body = {
      etag: form.etag,
      stufe: form.stufe,
      weekday: form.weekday,
      time: `${form.start} Uhr - ${form.end} Uhr`,
      ageRange: form.ageRange,
      location: form.location,
      description: form.description,
    };
    await dialog.run(async () => {
      if (current.id) await sendApi('PATCH', `/intern/pflege/gruppenstunden/${current.id}`, body);
      else await sendApi('POST', '/intern/pflege/gruppenstunden', body);
      message = `Gruppenstunde ${current.stufe} gespeichert.`;
      form = null;
      await gruppenstundenPflege.load({ force: true });
    }, 'Speichern fehlgeschlagen. Bitte prüfe deine Verbindung.');
  }

  async function remove(): Promise<void> {
    const current = form;
    if (!current?.id) return;
    await dialog.run(async () => {
      await sendApi('DELETE', `/intern/pflege/gruppenstunden/${current.id}`, undefined, {
        etag: current.etag,
      });
      message = `Gruppenstunde ${current.stufe} gelöscht.`;
      form = null;
      await gruppenstundenPflege.load({ force: true });
    }, 'Löschen fehlgeschlagen. Bitte prüfe deine Verbindung.');
  }
</script>

<div class="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <StatusNotice {message} class="min-w-0 flex-1" popup />
    <div class="flex gap-2">
      <ReloadButton resource={gruppenstundenPflege} />
      {#if store.data && freeStufen.length > 0}
        <ActionButton variant="primary" type="button" onclick={create}
          >Neue Gruppenstunde</ActionButton
        >
      {/if}
    </div>
  </div>

  <LoadState
    data={store.data}
    loading={store.loading}
    error={store.error}
    loadingText="Gruppenstunden werden geladen …"
    onretry={() => void gruppenstundenPflege.load({ force: true })}
    isEmpty={() => items.length === 0}
  >
    {#snippet skeleton()}
      <div class="grid gap-4 md:grid-cols-2">
        {#each [1, 2, 3, 4] as n (n)}
          <div class="skeleton-element h-40 rounded-[var(--radius-lg)]"></div>
        {/each}
      </div>
    {/snippet}
    {#snippet empty()}
      <p class="border-t border-neutral-200 py-4 text-sm text-neutral-700">
        Noch keine Gruppenstunden angelegt.
      </p>
    {/snippet}
    <ul class="grid border-b border-neutral-200 md:grid-cols-2 md:gap-x-10">
      {#each items as item (item.id)}
        {@const cfg = config(item.stufe)}
        <li
          class="flex flex-col border-t border-l-[3px] border-t-neutral-200 py-5 pl-4"
          style="border-left-color: {cfg?.color ?? 'var(--color-brand-300)'}"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-3">
              {#if cfg}
                <img
                  src={cfg.logo}
                  alt=""
                  aria-hidden="true"
                  width="40"
                  height="40"
                  class="size-10 object-contain"
                />
              {/if}
              <h2 class="font-serif text-xl font-semibold text-brand-900">{item.stufe}</h2>
            </div>
            <ActionButton variant="secondary" type="button" onclick={() => edit(item)}>
              Bearbeiten<span class="sr-only"> ({item.stufe})</span>
            </ActionButton>
          </div>
          <dl class="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt class="font-semibold text-neutral-700">Wann</dt>
            <dd>{item.weekday}, {item.time}</dd>
            <dt class="font-semibold text-neutral-700">Alter</dt>
            <dd>{item.ageRange || '–'}</dd>
            <dt class="font-semibold text-neutral-700">Ort</dt>
            <dd>{item.location || '–'}</dd>
          </dl>
          <div class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            {#each item.leitende as leader (leader.id)}
              <span class="inline-flex items-center gap-1.5 text-sm">
                <LeaderAvatar
                  id={leader.id}
                  name={leader.name}
                  hasImage={leader.hasImage}
                  size="sm"
                />
                {leader.name}
              </span>
            {:else}
              <span class="text-sm text-neutral-700">Keine Leitenden im Team „{item.stufe}“.</span>
            {/each}
            <a
              href="/leitendenbereich/leitende"
              class="ml-auto text-sm font-semibold text-link underline"
            >
              Team bearbeiten
            </a>
          </div>
        </li>
      {/each}
    </ul>
  </LoadState>
</div>

<EditDialog
  open={form !== null}
  title={form?.id ? `Gruppenstunde ${form.stufe} bearbeiten` : 'Neue Gruppenstunde'}
  {busy}
  error={dialog.state.error}
  onreload={dialog.state.conflict ? reloadCurrent : undefined}
  onsubmit={save}
  onclose={close}
  ondelete={form?.id ? remove : undefined}
  deleteQuestion="Diese Gruppenstunde endgültig löschen?"
>
  {#if form}
    <div class="grid gap-4 sm:grid-cols-2">
      <FormField id="gs-stufe" label="Stufe" error={errors.stufe}>
        {#snippet children(attrs)}
          <select
            {...attrs}
            class="form-input"
            bind:value={form!.stufe}
            disabled={form!.id !== null}
          >
            {#each form!.id ? [form!.stufe] : freeStufen as stufe (stufe)}
              <option value={stufe}>{stufe}</option>
            {/each}
          </select>
        {/snippet}
      </FormField>

      <FormField id="gs-weekday" label="Wochentag" error={errors.weekday}>
        {#snippet children(attrs)}
          <select {...attrs} class="form-input" bind:value={form!.weekday}>
            <option value="" disabled>Bitte wählen</option>
            {#each weekdayOptions as day (day)}
              <option value={day}>{day}</option>
            {/each}
          </select>
        {/snippet}
      </FormField>

      <fieldset class="sm:col-span-2">
        <legend class="form-label">Uhrzeit</legend>
        <div class="flex flex-wrap items-center gap-2">
          <label class="sr-only" for="gs-start">Beginn</label>
          <input
            id="gs-start"
            type="time"
            class="form-input w-auto!"
            bind:value={form.start}
            aria-invalid={errors.time ? 'true' : undefined}
            aria-describedby={errors.time ? 'gs-time-error' : undefined}
          />
          <span aria-hidden="true">bis</span>
          <label class="sr-only" for="gs-end">Ende</label>
          <input
            id="gs-end"
            type="time"
            class="form-input w-auto!"
            bind:value={form.end}
            aria-invalid={errors.time ? 'true' : undefined}
            aria-describedby={errors.time ? 'gs-time-error' : undefined}
          />
          <span class="text-sm text-neutral-700">Uhr</span>
        </div>
        {#if form.legacyTime}
          <p class="mt-1 text-xs text-neutral-700">Bisher eingetragen: „{form.legacyTime}“</p>
        {/if}
        {#if errors.time}
          <p id="gs-time-error" class="mt-1 text-sm text-danger">{errors.time}</p>
        {/if}
      </fieldset>

      <FormField
        id="gs-age"
        label="Alter"
        hint="z. B. „7 - 9 Jahre“"
        optional
        error={errors.ageRange}
      >
        {#snippet children(attrs)}
          <input {...attrs} class="form-input" maxlength="60" bind:value={form!.ageRange} />
        {/snippet}
      </FormField>

      <FormField id="gs-location" label="Ort" error={errors.location}>
        {#snippet children(attrs)}
          <input {...attrs} class="form-input" maxlength="120" bind:value={form!.location} />
        {/snippet}
      </FormField>
    </div>

    <div>
      <span id="gs-description-label" class="form-label">Beschreibung</span>
      <RichTextEditor
        id="gs-description"
        labelledBy="gs-description-label"
        describedBy={errors.description ? 'gs-description-error' : undefined}
        invalid={!!errors.description}
        bind:value={form.description}
      />
      {#if errors.description}
        <p id="gs-description-error" class="mt-1 text-sm text-danger">
          {errors.description}
        </p>
      {/if}
    </div>
  {/if}
</EditDialog>
