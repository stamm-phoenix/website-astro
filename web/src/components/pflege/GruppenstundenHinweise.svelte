<script lang="ts">
  import { tick, untrack } from 'svelte';
  import StaffPageHead from '../StaffPageHead.svelte';
  import ReloadButton from './ReloadButton.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import StatusNotice from './StatusNotice.svelte';
  import EditDialog from './EditDialog.svelte';
  import GruppenstundenAusnahme from './GruppenstundenAusnahme.svelte';
  import { sendApi } from '../../lib/api';
  import { createDialogForm } from '../../lib/dialogForm.svelte';
  import { gruppenstundenPflege } from '../../lib/pflegeStore.svelte';
  import { GROUP_CONFIG, STUFE_ORDER, STUFE_TO_KEY } from '../../lib/types';
  import type { StaffGruppenstunde } from '../../lib/types';
  import type { GruppenstundenException } from '../../../../api/lib/gruppenstunden-exception-model';

  interface Form {
    item: StaffGruppenstunde;
    exception: GruppenstundenException;
  }

  const store = gruppenstundenPflege.state;
  const dialog = createDialogForm();
  const errors = $derived(dialog.state.fields);
  const busy = $derived(dialog.state.busy);
  let form = $state<Form | null>(null);
  let baseline = $state('');
  const dirty = $derived(form !== null && JSON.stringify(form.exception) !== baseline);
  let message = $state<string | null>(null);
  let today = $state(berlinDate());

  function berlinDate(): string {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
  }

  $effect(() => {
    const timer = setInterval(() => (today = berlinDate()), 60_000);
    return () => clearInterval(timer);
  });

  const items = $derived(
    [...(store.data?.items ?? [])].sort(
      (a, b) => (STUFE_ORDER[a.stufe] ?? 99) - (STUFE_ORDER[b.stufe] ?? 99)
    )
  );

  $effect(() => {
    untrack(() => gruppenstundenPflege.load());
  });

  function config(stufe: string) {
    const key = STUFE_TO_KEY[stufe];
    return key ? GROUP_CONFIG[key] : null;
  }

  function emptyException(): GruppenstundenException {
    return { startDate: '', endDate: '', message: '', location: '', time: '' };
  }

  function edit(item: StaffGruppenstunde): void {
    form = { item, exception: item.exception ? { ...item.exception } : emptyException() };
    baseline = JSON.stringify(form.exception);
    dialog.reset();
  }

  async function reloadCurrent(): Promise<boolean> {
    const id = form?.item.id;
    await gruppenstundenPflege.load({ force: true });
    if (store.error) {
      dialog.state.error =
        'Der aktuelle Hinweis konnte nicht geladen werden. Deine Eingaben sind noch da. Prüfe deine Internetverbindung und tippe noch einmal auf „Aktuelle Fassung laden“.';
      return false;
    }
    const fresh = store.data?.items.find((item) => item.id === id);
    if (!fresh) {
      form = null;
      message = 'Die Gruppenstunde wurde inzwischen gelöscht.';
      return false;
    }
    form = null;
    await tick();
    edit(fresh);
    return true;
  }

  function close(): void {
    if (!busy) form = null;
  }

  function validate(exception: GruppenstundenException): Record<string, string> {
    const result: Record<string, string> = {};
    if (!exception.startDate) result.exceptionStartDate = 'Bitte ein Anfangsdatum angeben.';
    if (!exception.endDate) result.exceptionEndDate = 'Bitte ein Enddatum angeben.';
    if (exception.startDate && exception.endDate && exception.endDate < exception.startDate) {
      result.exceptionEndDate = 'Das Enddatum muss am Anfangsdatum oder danach liegen.';
    }
    if (!exception.message.trim()) result.exceptionMessage = 'Bitte einen Hinweis angeben.';
    return result;
  }

  async function save(): Promise<void> {
    if (!form) return;
    if (dialog.invalid(validate(form.exception))) return;
    const current = form;
    await dialog.run(async () => {
      await sendApi('PATCH', `/intern/pflege/gruppenstunden/${current.item.id}/hinweis`, {
        etag: current.item.etag,
        exception: current.exception,
      });
      message = `Hinweis für ${current.item.stufe} veröffentlicht.`;
      form = null;
      await gruppenstundenPflege.load({ force: true });
    }, 'Der Hinweis wurde nicht gespeichert. Deine Eingaben sind noch da. Prüfe deine Internetverbindung und tippe noch einmal auf „Hinweis veröffentlichen“.');
  }

  async function remove(): Promise<void> {
    const current = form;
    if (!current) return;
    await dialog.run(async () => {
      await sendApi('PATCH', `/intern/pflege/gruppenstunden/${current.item.id}/hinweis`, {
        etag: current.item.etag,
        exception: null,
      });
      message = `Hinweis für ${current.item.stufe} entfernt.`;
      form = null;
      await gruppenstundenPflege.load({ force: true });
    }, 'Der Hinweis wurde nicht entfernt. Tippe noch einmal auf „Hinweis entfernen“.');
  }

  function status(exception: GruppenstundenException | null): {
    label: string;
    tone: 'success' | 'warning' | 'danger' | 'neutral';
  } {
    if (!exception) return { label: 'Kein Hinweis', tone: 'neutral' };
    if (exception.endDate < today) return { label: 'Abgelaufen', tone: 'neutral' };
    if (exception.startDate > today) return { label: 'Geplant', tone: 'warning' };
    return { label: 'Aktuell', tone: 'success' };
  }

  const dateFormatter = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });

  function formatDate(value: string): string {
    return value ? dateFormatter.format(new Date(`${value}T00:00:00Z`)) : '–';
  }
</script>

<StaffPageHead href="/leitendenbereich/gruppenstunden-hinweise">
  {#snippet actions()}
    <ReloadButton resource={gruppenstundenPflege} />
  {/snippet}
</StaffPageHead>

<div class="space-y-6">
  <StatusNotice {message} popup />
  <LoadState
    data={store.data}
    loading={store.loading}
    error={store.error}
    loadingText="Hinweise werden geladen …"
    onretry={() => void gruppenstundenPflege.load({ force: true })}
    isEmpty={() => items.length === 0}
  >
    {#snippet skeleton()}
      <div class="grid gap-4 md:grid-cols-2">
        {#each [1, 2, 3, 4] as n (n)}
          <div class="skeleton-element h-48 rounded-[var(--radius-lg)]"></div>
        {/each}
      </div>
    {/snippet}
    {#snippet empty()}
      <p class="border-t border-neutral-200 py-4 text-sm text-neutral-700">
        Noch keine Gruppenstunden angelegt.
      </p>
    {/snippet}
    <ul class="grid gap-4 md:grid-cols-2">
      {#each items as item (item.id)}
        {@const cfg = config(item.stufe)}
        {@const state = status(item.exception ?? null)}
        <li
          class="surface flex flex-col gap-4 border-l-[3px] p-4"
          style="border-left-color: {cfg?.color ?? 'var(--color-brand-300)'}"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
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
            <StatusLabel label={state.label} tone={state.tone} dot />
          </div>
          {#if item.exception}
            <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
              <dt class="font-semibold text-neutral-700">Zeitraum</dt>
              <dd class="break-words">
                {formatDate(item.exception.startDate)} – {formatDate(item.exception.endDate)}
              </dd>
              <dt class="font-semibold text-neutral-700">Hinweis</dt>
              <dd class="break-words">{item.exception.message}</dd>
              {#if item.exception.location}
                <dt class="font-semibold text-neutral-700">Ort</dt>
                <dd class="break-words">{item.exception.location}</dd>
              {/if}
              {#if item.exception.time}
                <dt class="font-semibold text-neutral-700">Uhrzeit</dt>
                <dd class="break-words">{item.exception.time}</dd>
              {/if}
            </dl>
          {/if}
          <ActionButton variant="secondary" type="button" onclick={() => edit(item)}>
            {item.exception ? 'Hinweis bearbeiten' : 'Hinweis veröffentlichen'}
          </ActionButton>
        </li>
      {/each}
    </ul>
  </LoadState>
</div>

<EditDialog
  open={form !== null}
  title={form?.item.exception
    ? `Hinweis für ${form.item.stufe} bearbeiten`
    : `Hinweis für ${form?.item.stufe ?? ''} veröffentlichen`}
  rescueKey={form ? `gruppenstunden-hinweis:${form.item.id}` : undefined}
  rescueVersion={form?.item.etag}
  {busy}
  {dirty}
  submitLabel="Hinweis veröffentlichen"
  error={dialog.state.error}
  onreload={dialog.state.conflict ? reloadCurrent : undefined}
  onsubmit={save}
  onclose={close}
  ondelete={form?.item.exception ? remove : undefined}
  deleteDisclosure
  deleteLabel="Hinweis entfernen"
  deleteTitle={`Hinweis für ${form?.item.stufe ?? ''} entfernen?`}
  deleteQuestion="Diesen Hinweis endgültig entfernen?"
>
  {#if form}
    <GruppenstundenAusnahme
      exception={form.exception}
      resetKey={`${form.item.id}:${form.item.etag}`}
      {errors}
      onchange={(exception) => {
        if (exception) form!.exception = exception;
      }}
    />
  {/if}
</EditDialog>
