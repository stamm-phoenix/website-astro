<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';
  import LazyTextEditor from '../ui/LazyTextEditor.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import ReloadAction from '../ui/ReloadAction.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import { untrack } from 'svelte';
  import { ApiError, sendApi } from '../../lib/api';
  import { createDialogForm } from '../../lib/dialogForm.svelte';
  import { formatDateTime } from '../../lib/format';
  import { problemmeldungenPflege } from '../../lib/pflegeStore.svelte';
  import {
    buildIssueBody,
    isProblemOpen,
    PROBLEM_LABELS,
    PROBLEM_MAX_LENGTH,
  } from '../../lib/problemMelden';
  import type { ProblemLabel, StaffProblemMeldung } from '../../lib/problemMelden';
  import type { StatusTone } from '../../lib/status';
  import EditDialog from './EditDialog.svelte';
  import FormField from './FormField.svelte';
  import StatusNotice from './StatusNotice.svelte';

  type View = 'offen' | 'verworfen' | 'uebermittelt' | 'alle';

  interface Draft {
    title: string;
    body: string;
    label: ProblemLabel;
  }

  const TECHNIK = 'admin@stamm-phoenix.de';
  const store = problemmeldungenPflege.state;
  const dialog = createDialogForm();
  const busy = $derived(dialog.state.busy);

  let view = $state<View>('offen');
  let selectedId = $state<string | null>(null);
  let draft = $state<Draft>({ title: '', body: '', label: 'bug' });
  /** The draft as it was loaded into the fields: what the leader started from. */
  let baseDraft = $state<Draft | null>(null);
  let message = $state<string | null>(null);
  let discarding = $state(false);
  let discardReason = $state('');
  let sending = $state(false);

  const items = $derived(store.data?.items ?? []);
  const selected = $derived(items.find((item) => item.id === selectedId) ?? null);
  const github = $derived(store.data?.github);
  const visible = $derived(
    items.filter((item) =>
      view === 'alle' ? true : view === 'offen' ? isProblemOpen(item.status) : item.status === view
    )
  );
  const count = (match: (item: StaffProblemMeldung) => boolean): number =>
    items.filter(match).length;
  const open = $derived(selected ? isProblemOpen(selected.status) : false);
  const sameDraft = (a: Draft, b: Draft): boolean =>
    a.title === b.title && a.body === b.body && a.label === b.label;
  /** The leader changed the fields since they were loaded. */
  const draftChanged = $derived(baseDraft !== null && !sameDraft(draft, baseDraft));
  /** Someone else saved another draft since the fields were loaded. */
  const draftMoved = $derived(
    selected !== null && baseDraft !== null && !sameDraft(selected.draft, baseDraft)
  );

  $effect(() => {
    untrack(() => void problemmeldungenPflege.load({ force: true }));
  });

  const STATUS: Record<StaffProblemMeldung['status'], { label: string; tone: StatusTone }> = {
    neu: { label: 'Neu', tone: 'warning' },
    in_pruefung: { label: 'In Prüfung', tone: 'neutral' },
    verworfen: { label: 'Verworfen', tone: 'neutral' },
    uebermittelt: { label: 'An GitHub gesendet', tone: 'success' },
  };

  /** The automatic assessment as a short label, or `null` while there is none. */
  function assessment(item: StaffProblemMeldung): { label: string; tone: StatusTone } | null {
    const { status, verdict } = item.ai;
    if (status === 'fertig' && verdict === 'plausibel')
      return { label: 'Einschätzung: plausibel', tone: 'success' };
    if (status === 'fertig' && verdict === 'unklar')
      return { label: 'Einschätzung: unklar', tone: 'warning' };
    if (status === 'fertig' && verdict === 'spam')
      return { label: 'Einschätzung: Spam', tone: 'danger' };
    if (status === 'fehler') return { label: 'Einschätzung fehlgeschlagen', tone: 'danger' };
    if (status === 'nicht_eingerichtet')
      return { label: 'Keine Einschätzung eingerichtet', tone: 'neutral' };
    return { label: 'Einschätzung ausstehend', tone: 'neutral' };
  }

  function title(item: StaffProblemMeldung): string {
    const text = item.draft.title || item.description;
    return text.length > 90 ? `${text.slice(0, 90)} …` : text;
  }

  function fillDraft(item: StaffProblemMeldung): void {
    draft = { ...item.draft };
    baseDraft = { ...item.draft };
  }

  async function reload(): Promise<void> {
    await problemmeldungenPflege.load({ force: true });
  }

  function openItem(item: StaffProblemMeldung): void {
    selectedId = item.id;
    discardReason = '';
    fillDraft(item);
    dialog.reset();
  }

  function close(): void {
    if (!busy) selectedId = null;
  }

  /** After a conflict: replaces the input with the current version of the report. */
  async function reloadCurrent(): Promise<boolean> {
    const id = selectedId;
    await reload();
    const fresh = store.data?.items.find((item) => item.id === id);
    if (!fresh) {
      selectedId = null;
      message = 'Die Meldung gibt es nicht mehr.';
      return false;
    }
    fillDraft(fresh);
    dialog.reset();
    return true;
  }

  function validate(): Record<string, string> {
    return draft.title.trim() ? {} : { title: 'Bitte gib einen Titel an.' };
  }

  /** Saves the draft; returns whether it worked. */
  async function save(announce = true): Promise<boolean> {
    if (!selected || busy) return false;
    if (dialog.invalid(validate())) return false;
    // The fresh version of the report must not carry fields that were loaded before another
    // leader saved: this would overwrite that draft without asking
    if (draftMoved) {
      dialog.fail(new ApiError(409, 'Entwurf geändert'), '');
      return false;
    }
    const { id, etag } = selected;
    const saved = await dialog.run(async () => {
      await sendApi('PATCH', `/intern/pflege/problemmeldungen/${id}`, { ...draft, etag });
      if (announce) message = 'Entwurf gespeichert.';
      await reload();
      const fresh = store.data?.items.find((item) => item.id === id);
      // A failed reload leaves the old data: it must not replace what was just saved
      if (fresh && !store.error) fillDraft(fresh);
      else baseDraft = { ...draft };
      // Like the other forms: a saved dialog closes (and forgets its unsaved state)
      if (announce) selectedId = null;
    }, 'Der Entwurf wurde nicht gespeichert. Deine Eingaben sind noch da. Tippe noch einmal auf „Entwurf speichern“.');
    return saved;
  }

  /** Reads the meldung back after a request, so the dialog shows its new state. */
  async function refresh(id: string): Promise<StaffProblemMeldung | undefined> {
    await reload();
    return store.data?.items.find((item) => item.id === id);
  }

  async function assess(): Promise<void> {
    if (!selected || busy) return;
    const { id } = selected;
    // Taken before the answer arrives: the new draft itself would count as a change
    const typed = draftChanged;
    await dialog.run(async () => {
      await sendApi('POST', `/intern/pflege/problemmeldungen/${id}/bewerten`, {});
      const fresh = await refresh(id);
      // The assessment only fills a draft nobody started
      if (fresh && !typed) fillDraft(fresh);
      if (fresh?.ai.status === 'fertig') message = 'Einschätzung erstellt.';
      else
        dialog.fail(
          new Error('Einschätzung fehlgeschlagen'),
          'Die Einschätzung ist wieder fehlgeschlagen. Die Meldung ist gespeichert. Versuch es später noch einmal.'
        );
    }, 'Die Einschätzung konnte nicht erstellt werden. Deine Meldung ist gespeichert. Tippe später noch einmal auf „Noch einmal einschätzen“.');
  }

  async function discard(): Promise<void> {
    if (!selected || busy) return;
    const { id, etag } = selected;
    const ok = await dialog.run(async () => {
      await sendApi('POST', `/intern/pflege/problemmeldungen/${id}/verwerfen`, {
        reason: discardReason,
        etag,
      });
      message = 'Meldung verworfen.';
      discardReason = '';
      discarding = false;
      selectedId = null;
      await reload();
    }, 'Die Meldung wurde nicht verworfen. Tippe noch einmal auf „Verwerfen“.');
    if (!ok) {
      discarding = false;
      // The request may have changed the version; the retry needs the current one
      await reload();
    }
  }

  /** Saves a changed draft first, so the preview shows exactly what is sent. */
  async function startSend(): Promise<void> {
    if (!selected || busy) return;
    if (!draft.title.trim() || !draft.body.trim()) {
      dialog.invalid({ title: draft.title.trim() ? '' : 'Bitte gib einen Titel an.' });
      dialog.fail(
        new Error('leer'),
        'Schreib erst Titel und Beschreibung für GitHub, dann kannst du die Meldung senden.'
      );
      return;
    }
    if (draftChanged && !(await save(false))) return;
    sending = true;
  }

  async function sendToGithub(): Promise<void> {
    if (!selected || busy) return;
    const { id, etag } = selected;
    const ok = await dialog.run(async () => {
      const result = await sendApi<{ found: boolean }>(
        'POST',
        `/intern/pflege/problemmeldungen/${id}/github`,
        { etag }
      );
      message = result.found
        ? 'Der Eintrag war schon auf GitHub. Die Meldung ist jetzt als gesendet markiert.'
        : 'An GitHub gesendet.';
      sending = false;
      selectedId = null;
      await reload();
    }, 'Die Meldung wurde nicht an GitHub gesendet. Meldung und Entwurf sind unverändert. Tippe später noch einmal auf „An GitHub senden“.');
    if (!ok) {
      sending = false;
      // Reserving the hand-over changes the version; the retry needs the current one
      const fresh = await refresh(id);
      // Fields nobody touched follow the current draft; typed ones stay and meet a conflict on saving
      if (fresh && !draftChanged) fillDraft(fresh);
    }
  }

  const issueBody = $derived(
    selected
      ? buildIssueBody(selected.draft.body, {
          id: Number(selected.id),
          createdAt: selected.createdAt,
          entry: selected.entry,
          environment: selected.environment,
          context: selected.context,
          contact: selected.contact,
        })
      : ''
  );
  const labelName = (id: ProblemLabel): string =>
    PROBLEM_LABELS.find((label) => label.id === id)?.label ?? id;

  const details = $derived(
    selected
      ? [
          ['Meldung', `PM-${selected.id}`],
          ['Eingang', formatDateTime(selected.createdAt)],
          ['Einstieg', selected.entry === 'fehler' ? 'Fehleranzeige' : 'Footer'],
          ['Seite', selected.context.page],
          ['Bereich', selected.context.module],
          ['Fehlercode', selected.context.errorCode],
          [
            'Status',
            selected.context.httpStatus === null ? '' : String(selected.context.httpStatus),
          ],
          ['Aktion', selected.context.action],
          ['Nummer der Anfrage', selected.context.correlationId],
          ['Version', selected.context.appVersion],
          ['Umgebung', selected.environment === 'vorschau' ? 'PR-Vorschau' : 'Produktion'],
          ['Browser', selected.context.browser],
          ['Fenstergröße', selected.context.viewport],
        ].filter(([, value]) => value !== '')
      : []
  );
</script>

<div class="space-y-6">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <FilterTabs
      label="Meldungen filtern"
      countNouns={['Meldung', 'Meldungen']}
      options={[
        {
          value: 'offen',
          label: 'Offen',
          count: store.data ? count((item) => isProblemOpen(item.status)) : undefined,
        },
        {
          value: 'verworfen',
          label: 'Verworfen',
          count: store.data ? count((item) => item.status === 'verworfen') : undefined,
        },
        {
          value: 'uebermittelt',
          label: 'An GitHub gesendet',
          count: store.data ? count((item) => item.status === 'uebermittelt') : undefined,
        },
        { value: 'alle', label: 'Alle', count: store.data ? items.length : undefined },
      ]}
      value={view}
      onselect={(value) => (view = value)}
    />
    <ReloadAction type="button" disabled={store.loading || busy} onclick={() => void reload()}
      >Neu laden</ReloadAction
    >
  </div>

  <StatusNotice {message} popup />

  <LoadState
    data={store.data}
    loading={store.loading}
    error={store.error}
    loadingText="Meldungen werden geladen …"
    onretry={() => void reload()}
    isEmpty={() => visible.length === 0}
  >
    {#snippet empty()}
      <div class="border-t border-neutral-200 pt-5" role="status">
        <h2 class="font-serif text-xl text-brand-900">
          {view === 'offen' ? 'Keine offenen Meldungen' : 'Keine Meldungen in dieser Ansicht'}
        </h2>
      </div>
    {/snippet}
    <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
      {#each visible as item (item.id)}
        {@const ai = assessment(item)}
        <li
          class="flex flex-col items-start gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div class="min-w-0">
            <p class="font-semibold text-brand-900 [overflow-wrap:anywhere]">{title(item)}</p>
            <p class="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
              <StatusLabel label={STATUS[item.status].label} tone={STATUS[item.status].tone} dot />
              {#if ai && isProblemOpen(item.status)}
                <StatusLabel label={ai.label} tone={ai.tone} />
              {/if}
              <span class="text-sm text-neutral-700">
                PM-{item.id} · {formatDateTime(item.createdAt)}
              </span>
            </p>
          </div>
          <ActionButton
            variant="secondary"
            type="button"
            class="shrink-0"
            aria-label={`Ansehen: Meldung PM-${item.id}`}
            onclick={() => openItem(item)}>Ansehen</ActionButton
          >
        </li>
      {/each}
    </ul>
  </LoadState>
</div>

<EditDialog
  open={selected !== null && !sending && !discarding}
  title={selected ? `Meldung PM-${selected.id}` : 'Meldung'}
  rescueKey={selected ? `problemmeldung:${selected.id}` : undefined}
  rescueVersion={selected?.etag}
  {busy}
  error={dialog.state.error}
  submitLabel="Entwurf speichern"
  cancelLabel="Schließen"
  submitDisabled={!open}
  dirty={draftChanged}
  onreload={dialog.state.conflict ? reloadCurrent : undefined}
  onsubmit={() => void save()}
  onclose={close}
>
  {#snippet actions()}
    {#if open}
      <ActionButton
        variant="danger"
        type="button"
        disabled={busy}
        onclick={() => (discarding = true)}>Verwerfen</ActionButton
      >
      <ActionButton
        variant="secondary"
        type="button"
        disabled={busy || github?.unavailable === 'preview'}
        onclick={() => void startSend()}>An GitHub senden</ActionButton
      >
    {/if}
  {/snippet}
  {#if selected}
    <div class="min-w-0 space-y-5">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
        <StatusLabel
          label={STATUS[selected.status].label}
          tone={STATUS[selected.status].tone}
          dot
        />
        {#if selected.github.url}
          <a
            class="text-link inline-flex min-h-11 items-center font-semibold"
            href={selected.github.url}
            target="_blank"
            rel="noopener noreferrer">Eintrag #{selected.github.number} auf GitHub öffnen</a
          >
        {/if}
      </div>

      {#if selected.status === 'verworfen'}
        <p class="text-sm">
          Verworfen von {selected.reviewedBy}{selected.discardReason
            ? `: ${selected.discardReason}`
            : '.'}
        </p>
      {/if}

      {#if open && github?.unavailable === 'preview'}
        <p class="text-sm text-neutral-700">In der Vorschau wird nichts an GitHub gesendet.</p>
      {:else if open && github?.unavailable === 'not-configured'}
        <p class="text-sm text-danger">
          Das Senden an GitHub ist noch nicht eingerichtet. Schreib an {TECHNIK}.
        </p>
      {/if}
      {#if open && selected.github.pending}
        <p class="text-sm text-warning">
          Das Senden an GitHub wurde begonnen, aber nicht abgeschlossen. Tippe noch einmal auf „An
          GitHub senden“: Vorher wird nachgesehen, ob der Eintrag schon da ist.
        </p>
      {/if}

      <section aria-labelledby="pm-original" class="space-y-2">
        <h3 id="pm-original" class="font-serif text-lg text-brand-900">Meldung</h3>
        <p class="whitespace-pre-wrap [overflow-wrap:anywhere]">{selected.description}</p>
        {#if selected.steps}
          <p class="text-sm font-semibold">Vorher gemacht</p>
          <p class="whitespace-pre-wrap [overflow-wrap:anywhere]">{selected.steps}</p>
        {/if}
        {#if selected.expected}
          <p class="text-sm font-semibold">Erwartet</p>
          <p class="whitespace-pre-wrap [overflow-wrap:anywhere]">{selected.expected}</p>
        {/if}
        {#if selected.contact}
          <p class="text-sm font-semibold">Rückfragen an</p>
          <p>
            <a class="text-link [overflow-wrap:anywhere]" href={`mailto:${selected.contact}`}
              >{selected.contact}</a
            >
          </p>
        {/if}
      </section>

      <section aria-labelledby="pm-details" class="space-y-2">
        <h3 id="pm-details" class="font-serif text-lg text-brand-900">Technische Angaben</h3>
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {#each details as [name, value] (name)}
            <dt class="text-neutral-700">{name}</dt>
            <dd class="min-w-0 [overflow-wrap:anywhere]">{value}</dd>
          {/each}
        </dl>
      </section>

      <section aria-labelledby="pm-ai" class="space-y-2">
        <h3 id="pm-ai" class="font-serif text-lg text-brand-900">Automatische Einschätzung</h3>
        {#if selected.ai.status === 'fertig'}
          {@const ai = assessment(selected)}
          {#if ai}<StatusLabel label={ai.label} tone={ai.tone} dot />{/if}
          <p class="text-sm">{selected.ai.reason}</p>
        {:else if selected.ai.status === 'fehler'}
          <p class="text-sm text-danger">
            Die Einschätzung ist fehlgeschlagen ({selected.ai.error || 'unbekannter Fehler'}). Die
            Meldung ist gespeichert.
          </p>
        {:else if selected.ai.status === 'nicht_eingerichtet'}
          <p class="text-sm">Es ist keine automatische Einschätzung eingerichtet.</p>
        {:else}
          <p class="text-sm">Die Einschätzung steht noch aus.</p>
        {/if}
        {#if open && selected.ai.status !== 'fertig'}
          <ActionButton
            variant="secondary"
            type="button"
            disabled={busy}
            onclick={() => void assess()}>Noch einmal einschätzen</ActionButton
          >
        {/if}
      </section>

      <section aria-labelledby="pm-draft" class="space-y-4">
        <h3 id="pm-draft" class="font-serif text-lg text-brand-900">Entwurf für GitHub</h3>
        <FormField id="pm-title" label="Titel" error={dialog.state.fields.title}>
          {#snippet children(attrs)}
            <input
              {...attrs}
              class="form-input"
              maxlength={store.data?.maxLength.title ?? PROBLEM_MAX_LENGTH.title}
              readonly={!open}
              bind:value={draft.title}
            />
          {/snippet}
        </FormField>
        <FormField id="pm-label" label="Label">
          {#snippet children(attrs)}
            <select {...attrs} class="form-input" disabled={!open} bind:value={draft.label}>
              {#each store.data?.labels ?? PROBLEM_LABELS as label (label.id)}
                <option value={label.id}>{label.label}</option>
              {/each}
            </select>
          {/snippet}
        </FormField>
        {#if open}
          <div inert={busy}>
            <FormField id="pm-body" label="Beschreibung" labelAs="span">
              {#snippet children(attrs)}
                <LazyTextEditor
                  features={{ headings: [2, 3], links: true }}
                  id={attrs.id}
                  labelledBy="pm-body-label"
                  describedBy={attrs['aria-describedby']}
                  maxLength={store.data?.maxLength.body ?? PROBLEM_MAX_LENGTH.body}
                  bind:value={draft.body}
                />
              {/snippet}
            </FormField>
          </div>
        {:else}
          <FormField id="pm-body" label="Beschreibung">
            {#snippet children(attrs)}
              <textarea {...attrs} class="form-input min-h-48" readonly bind:value={draft.body}
              ></textarea>
            {/snippet}
          </FormField>
        {/if}
      </section>
    </div>
  {/if}
</EditDialog>

<ConfirmDialog
  open={discarding && selected !== null}
  title={selected ? `Meldung PM-${selected.id} verwerfen?` : 'Meldung verwerfen?'}
  submitLabel="Verwerfen"
  busyLabel="Wird verworfen …"
  {busy}
  error={dialog.state.error}
  onclose={() => {
    if (!busy) discarding = false;
  }}
  onconfirm={() => void discard()}
>
  <div class="form-field">
    <label class="form-label" for="pm-discard-reason"
      >Grund <span class="font-normal">(optional)</span></label
    >
    <textarea
      id="pm-discard-reason"
      class="form-input"
      rows="3"
      maxlength={PROBLEM_MAX_LENGTH.discardReason}
      bind:value={discardReason}></textarea>
  </div>
</ConfirmDialog>

<ConfirmDialog
  open={sending && selected !== null}
  title="Auf GitHub anlegen?"
  tone="neutral"
  submitLabel="An GitHub senden"
  busyLabel="Wird gesendet …"
  {busy}
  error={dialog.state.error}
  onclose={() => {
    if (!busy) sending = false;
  }}
  onconfirm={() => void sendToGithub()}
>
  {#if selected}
    <div class="space-y-3">
      <p class="text-sm">
        Auf GitHub ({github?.repository}) ist das öffentlich sichtbar. Die Mail-Adresse und die
        Meldung im Original gehen nicht mit.
      </p>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt class="text-neutral-700">Label</dt>
        <dd>{labelName(selected.draft.label)}</dd>
        <dt class="text-neutral-700">Titel</dt>
        <dd class="[overflow-wrap:anywhere]">{selected.draft.title}</dd>
      </dl>
      <pre
        class="surface-muted max-h-64 overflow-auto whitespace-pre-wrap p-3 text-sm [overflow-wrap:anywhere]">{issueBody}</pre>
    </div>
  {/if}
</ConfirmDialog>
