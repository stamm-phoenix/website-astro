<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { ApiError, sendApi } from '../../lib/api';
  import { formatDate, formatEventRange } from '../../lib/campflowFields';
  import { dateDistance, isLikelyMatch } from '../../lib/aktionMatch';
  import { eventGroupNames, stufenFromGroups } from '../../lib/campflowGroups';
  import { campflowDetailStore, fetchCampflowEvent } from '../../lib/campflowStore.svelte';
  import { createDialogForm, dialogMessage } from '../../lib/dialogForm.svelte';
  import { aktionenPflege } from '../../lib/pflegeStore.svelte';
  import type { AktionTarget, CampflowEvent, StaffAktion } from '../../lib/types';
  import EditDialog from './EditDialog.svelte';
  import FormField from './FormField.svelte';
  import RichTextEditor from './RichTextEditor.svelte';

  interface Props {
    target: AktionTarget | null;
    stufen: string[];
    /** CampFlow events without calendar entry; an entry without CampFlow can be linked to one. */
    linkable: CampflowEvent[];
    /** Calendar entries without CampFlow event; publishing an event can take one over. */
    adoptable: StaffAktion[];
    onsaved: (message: string) => void;
    onclose: () => void;
  }

  interface Form {
    title: string;
    start: string;
    end: string;
    link: string;
    stufen: string[];
    description: string;
  }

  let { target, stufen, linkable, adoptable, onsaved, onclose }: Props = $props();

  let form = $state<Form | null>(null);
  // The CampFlow select is not always shown, so its message goes above the buttons
  const dialog = createDialogForm(
    (error, fallback) =>
      (error instanceof ApiError && (error.fields?.campflowId ?? error.fields?.etag)) ||
      dialogMessage(error, fallback)
  );
  const errors = $derived(dialog.state.fields);
  const busy = $derived(dialog.state.busy);
  /** CampFlow event chosen to link an entry without (existing) CampFlow event to. */
  let linkId = $state('');
  /** Existing entry without CampFlow that publishing a CampFlow event takes over. */
  let adoptId = $state('');

  /** Replaced by the current version when the entry is reloaded after a conflict. */
  let targetEntry = $derived(target?.entry ?? null);
  const targetEvent = $derived(target?.event ?? null);
  /** Publishing a CampFlow event can take over an entry created before the event existed. */
  const canAdopt = $derived(!!targetEvent && !targetEntry);
  const adoptedEntry = $derived(
    canAdopt ? (adoptable.find((e) => e.id === adoptId) ?? null) : null
  );
  /** The calendar entry that is saved: the opened one or the one taken over. */
  const entry = $derived(targetEntry ?? adoptedEntry);
  /** Entries without CampFlow event can be linked to one; then CampFlow owns its fields. */
  const canLink = $derived(!!targetEntry && !targetEvent);
  const linkedEvent = $derived(canLink ? (linkable.find((e) => e.id === linkId) ?? null) : null);
  const event = $derived(targetEvent ?? linkedEvent);
  /** Whether the Stufen were chosen by hand (or taken over); then they are never prefilled. */
  let stufenTouched = $state(false);
  /**
   * Stufen of the CampFlow event, from the groups the event carries (if CampFlow sends them) and
   * the groups its participants registered in; only Stufen of the calendar list count.
   */
  const suggestedStufen = $derived.by(() => {
    if (!event) return [];
    const persons = campflowDetailStore.data[event.id]?.persons ?? [];
    const names = [
      ...eventGroupNames(event as unknown as Record<string, unknown>),
      ...persons.flatMap((p) => (Array.isArray(p.group_names) ? p.group_names : [])),
    ];
    return stufenFromGroups(names).filter((s) => stufen.includes(s));
  });
  const suggestionApplied = $derived(
    !!form &&
      suggestedStufen.length === form.stufen.length &&
      suggestedStufen.every((s) => form!.stufen.includes(s))
  );

  $effect(() => {
    // The participants of the event tell its groups; loaded once per event and then cached
    const id = event?.id;
    if (id && target) untrack(() => fetchCampflowEvent(id));
  });

  $effect(() => {
    // Publishing a CampFlow event starts with the Stufen of its groups
    const suggestion = suggestedStufen;
    if (!form || stufenTouched || targetEntry || adoptedEntry || suggestion.length === 0) return;
    if (untrack(() => form!.stufen.length) === 0) form.stufen = [...suggestion];
  });
  /** A calendar entry whose CampFlow event no longer exists; saving unlinks it. */
  const orphaned = $derived(!targetEvent && !!entry?.campflowId);
  /** Likely matches first, as they most likely belong together; then newest first. */
  const linkOptions = $derived(
    linkable
      .map((option) => ({
        option,
        match: !!targetEntry && isLikelyMatch(option, targetEntry),
        distance: dateDistance(option.start_date, targetEntry?.start),
      }))
      .sort(
        (a, b) =>
          Number(b.match) - Number(a.match) ||
          (a.distance === b.distance ? 0 : a.distance - b.distance)
      )
  );
  const adoptOptions = $derived(
    adoptable
      .map((option) => ({
        option,
        match: !!targetEvent && isLikelyMatch(targetEvent, option),
        distance: dateDistance(targetEvent?.start_date, option.start),
      }))
      .sort(
        (a, b) =>
          Number(b.match) - Number(a.match) ||
          (a.distance === b.distance ? 0 : a.distance - b.distance)
      )
  );
  const title = $derived(
    event
      ? targetEntry
        ? 'Kalendereintrag bearbeiten'
        : 'Im öffentlichen Kalender veröffentlichen'
      : entry
        ? 'Aktion bearbeiten'
        : 'Neue Aktion ohne CampFlow'
  );

  $effect(() => {
    // Reset the form whenever another target is opened
    const current = target;
    fill(current ? current.entry : undefined);
  });

  /** Fills the form from a calendar entry (`null`: none yet, `undefined`: dialog closed). */
  function fill(source: StaffAktion | null | undefined): void {
    form =
      source === undefined
        ? null
        : {
            title: source?.title ?? '',
            start: source?.start ?? '',
            end: source?.end ?? '',
            link: source?.link ?? '',
            stufen: [...(source?.stufen ?? [])],
            description: source?.description ?? '',
          };
    dialog.reset();
    linkId = '';
    adoptId = '';
    stufenTouched = false;
  }

  /**
   * After a conflict: replaces the input with the current version of the calendar entry, or with
   * the entry that was published for the CampFlow event meanwhile.
   */
  async function reloadCurrent(): Promise<boolean> {
    const id = targetEntry?.id;
    const eventId = targetEvent?.id;
    const adopted = adoptId;
    await aktionenPflege.load({ force: true });
    const items = aktionenPflege.state.data?.items ?? [];
    const fresh = id
      ? items.find((item) => item.id === id)
      : eventId
        ? items.find((item) => item.campflowId === eventId)
        : undefined;
    if (fresh) {
      targetEntry = fresh;
      fill(fresh);
      return true;
    }
    if (id) {
      onsaved('Die Aktion wurde inzwischen gelöscht.');
      return false;
    }
    // Not published yet: start again, taking over the chosen entry if it is still available
    fill(null);
    if (adopted && adoptable.some((e) => e.id === adopted)) adopt(adopted);
    return true;
  }

  /** Taking over an entry keeps its Stufen and description; CampFlow replaces the rest. */
  function adopt(id: string): void {
    adoptId = id;
    stufenTouched = id !== '';
    const chosen = adoptable.find((e) => e.id === id);
    if (!form) return;
    form.stufen = [...(chosen?.stufen ?? [])];
    form.description = chosen?.description ?? '';
  }

  function toggleStufe(stufe: string): void {
    if (!form) return;
    stufenTouched = true;
    form.stufen = form.stufen.includes(stufe)
      ? form.stufen.filter((s) => s !== stufe)
      : [...form.stufen, stufe];
  }

  function close(): void {
    if (!busy) onclose();
  }

  async function save(): Promise<void> {
    if (!form || busy) return;
    const invalid: Record<string, string> = {};
    if (!event) {
      if (!form.title.trim()) invalid.title = 'Bitte einen Titel angeben.';
      if (!form.start) invalid.start = 'Bitte ein Startdatum angeben.';
      if (form.end && form.start && form.end < form.start)
        invalid.end = 'Das Enddatum darf nicht vor dem Startdatum liegen.';
      if (form.link.trim() && !/^https:\/\//i.test(form.link.trim()))
        invalid.link = 'Der Anmeldelink muss mit https:// beginnen.';
    }
    if (form.stufen.length === 0) invalid.stufen = 'Bitte mindestens eine Stufe auswählen.';
    if (dialog.invalid(invalid)) {
      const first = ['title', 'start', 'end', 'link', 'stufen'].find((field) => invalid[field]);
      await tick();
      document.getElementById(`aktion-${first}`)?.focus();
      return;
    }

    const body = {
      ...form,
      stufen: stufen.filter((s) => form!.stufen.includes(s)),
      campflowId: event?.id ?? null,
      etag: entry?.etag,
    };
    const current = entry;
    const message = linkedEvent
      ? `Mit „${linkedEvent.title}“ aus CampFlow verknüpft. Titel, Datum und Anmeldelink kommen ab jetzt aus CampFlow.`
      : adoptedEntry
        ? `„${adoptedEntry.title}“ ist jetzt mit der CampFlow-Aktion verknüpft. Titel, Datum und Anmeldelink kommen ab jetzt aus CampFlow.`
        : current
          ? 'Kalendereintrag gespeichert. Die Website wird in wenigen Minuten aktualisiert.'
          : 'Aktion veröffentlicht. Sie erscheint in wenigen Minuten im öffentlichen Kalender.';
    await dialog.run(async () => {
      if (current) await sendApi('PATCH', `/intern/pflege/aktionen/${current.id}`, body);
      else await sendApi('POST', '/intern/pflege/aktionen', body);
      onsaved(message);
    }, 'Die Aktion wurde nicht gespeichert. Deine Eingaben sind noch da. Tippe noch einmal auf „Speichern“ oder „Veröffentlichen“.');
  }

  async function remove(): Promise<void> {
    const current = targetEntry;
    if (!current || busy) return;
    const message = targetEvent
      ? 'Die Aktion ist nicht mehr öffentlich. In CampFlow bleibt sie unverändert.'
      : 'Aktion gelöscht. Sie erscheint nicht mehr im öffentlichen Kalender.';
    await dialog.run(async () => {
      await sendApi('DELETE', `/intern/pflege/aktionen/${current.id}`, undefined, {
        etag: current.etag,
      });
      onsaved(message);
    }, 'Die Aktion wurde nicht gelöscht. Prüfe deine Internetverbindung und tippe noch einmal auf „Löschen“ oder „Nicht mehr veröffentlichen“.');
  }
</script>

<EditDialog
  open={target !== null}
  {title}
  {busy}
  error={dialog.state.error}
  onreload={dialog.state.conflict ? reloadCurrent : undefined}
  submitLabel={targetEntry || !event ? 'Speichern' : 'Veröffentlichen'}
  onsubmit={save}
  onclose={close}
  ondelete={targetEntry ? remove : undefined}
  deleteLabel={targetEvent ? 'Nicht mehr veröffentlichen' : 'Löschen'}
  deleteQuestion={targetEvent
    ? 'Aus dem öffentlichen Kalender entfernen? In CampFlow bleibt die Aktion erhalten.'
    : 'Die Aktion endgültig löschen?'}
>
  {#if form && target}
    {#if canLink && linkable.length > 0}
      <FormField
        id="aktion-campflow"
        label="Mit CampFlow-Aktion verknüpfen"
        optional
        hint="Sobald die Aktion in CampFlow angelegt ist: verknüpfen, dann kommen Titel, Datum und Anmeldelink aus CampFlow. Vermutlich passende Aktionen stehen oben, danach die mit dem nächstgelegenen Datum."
        error={errors.campflowId}
      >
        {#snippet children(attrs)}
          <select {...attrs} class="form-input" disabled={busy} bind:value={linkId}>
            <option value="">Nicht verknüpfen</option>
            {#each linkOptions as { option, match } (option.id)}
              <option value={option.id}
                >{option.title} ({formatEventRange(option)}){match
                  ? ' – passt vermutlich'
                  : ''}</option
              >
            {/each}
          </select>
        {/snippet}
      </FormField>
    {/if}
    {#if event}
      <div class="rounded-md bg-[var(--color-brand-50)] px-3 py-2 text-sm text-brand-900">
        <p class="font-semibold">{event.title}</p>
        <p class="mt-0.5">{formatEventRange(event)}</p>
        {#if event.url}
          <p class="mt-0.5 break-all">
            Anmeldung: <a href={event.url} target="_blank" rel="noopener noreferrer">{event.url}</a>
          </p>
        {:else}
          <p class="mt-0.5">Kein Anmeldelink in CampFlow.</p>
        {/if}
        <p class="mt-2 text-xs text-neutral-700">
          Titel, Datum und Anmeldelink kommen aus CampFlow und werden dort geändert.
        </p>
      </div>
    {:else if orphaned}
      <p role="note" class="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
        Die verknüpfte CampFlow-Aktion gibt es nicht mehr. Beim Speichern wird der Eintrag zu einer
        Aktion ohne CampFlow, außer du verknüpfst ihn mit einer anderen CampFlow-Aktion.
      </p>
    {/if}

    {#if canAdopt && adoptable.length > 0}
      <FormField
        id="aktion-adopt"
        label="Vorhandenen Kalendereintrag übernehmen"
        optional
        hint="Wurde die Aktion schon vorab ohne CampFlow angelegt, wähle sie hier aus. Sie wird dann verknüpft statt doppelt angelegt; Stufen und Beschreibung bleiben erhalten."
      >
        {#snippet children(attrs)}
          <select
            {...attrs}
            class="form-input"
            disabled={busy}
            value={adoptId}
            onchange={(e) => adopt(e.currentTarget.value)}
          >
            <option value="">Neuen Eintrag anlegen</option>
            {#each adoptOptions as { option, match } (option.id)}
              <option value={option.id}
                >{option.title || 'Ohne Titel'} ({formatDate(option.start) || 'ohne Datum'}){match
                  ? ' – passt vermutlich'
                  : ''}</option
              >
            {/each}
          </select>
        {/snippet}
      </FormField>
    {/if}

    <fieldset disabled={busy} class="min-w-0 space-y-4">
      <legend class="sr-only">Angaben für den öffentlichen Kalender</legend>

      {#if !event}
        <FormField id="aktion-title" label="Titel" error={errors.title}>
          {#snippet children(attrs)}<input
              {...attrs}
              class="form-input"
              maxlength="255"
              bind:value={form!.title}
            />{/snippet}
        </FormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <FormField id="aktion-start" label="Beginn" error={errors.start}>
            {#snippet children(attrs)}<input
                {...attrs}
                type="date"
                class="form-input"
                bind:value={form!.start}
              />{/snippet}
          </FormField>
          <FormField
            id="aktion-end"
            label="Ende"
            optional
            hint="Leer lassen für eintägige Aktionen."
            error={errors.end}
          >
            {#snippet children(attrs)}<input
                {...attrs}
                type="date"
                class="form-input"
                min={form!.start || undefined}
                bind:value={form!.end}
              />{/snippet}
          </FormField>
        </div>
        <FormField
          id="aktion-link"
          label="Anmeldelink"
          optional
          hint="Muss mit https:// beginnen."
          error={errors.link}
        >
          {#snippet children(attrs)}<input
              {...attrs}
              type="url"
              class="form-input"
              maxlength="255"
              placeholder="https://"
              bind:value={form!.link}
            />{/snippet}
        </FormField>
      {/if}

      <fieldset aria-describedby="aktion-stufen-hint{errors.stufen ? ' aktion-stufen-error' : ''}">
        <legend class="form-label">Stufen</legend>
        <div class="mt-1 flex flex-wrap gap-x-4 gap-y-2">
          {#each stufen as stufe, index (stufe)}
            <label class="inline-flex items-center gap-2 text-sm">
              <input
                id={index === 0 ? 'aktion-stufen' : undefined}
                type="checkbox"
                aria-invalid={errors.stufen ? 'true' : undefined}
                checked={form.stufen.includes(stufe)}
                onchange={() => toggleStufe(stufe)}
              />
              {stufe}
            </label>
          {/each}
        </div>
        <p id="aktion-stufen-hint" class="mt-1 text-xs text-neutral-700">
          Aktionen nur für „Leitende“ erscheinen nur im Leitenden-Kalender, nicht auf der Website.
        </p>
        {#if suggestedStufen.length > 0}
          <p class="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-neutral-700">
            {#if suggestionApplied}
              Passt zu den Gruppen der Aktion in CampFlow.
            {:else}
              <span>In CampFlow: {suggestedStufen.join(', ')}</span>
              <button
                type="button"
                class="font-semibold text-brand-800 underline underline-offset-2"
                onclick={() => {
                  form!.stufen = [...suggestedStufen];
                  stufenTouched = true;
                }}>Übernehmen</button
              >
            {/if}
          </p>
        {/if}
        {#if errors.stufen}<p id="aktion-stufen-error" class="mt-1 text-sm text-danger">
            {errors.stufen}
          </p>{/if}
      </fieldset>

      <div inert={busy}>
        <span id="aktion-description-label" class="form-label">
          Beschreibung <span class="font-normal text-neutral-700">(optional)</span>
        </span>
        <RichTextEditor
          id="aktion-description"
          labelledBy="aktion-description-label"
          describedBy={errors.description
            ? 'aktion-description-hint aktion-description-error'
            : 'aktion-description-hint'}
          invalid={!!errors.description}
          bind:value={form.description}
        />
        <p id="aktion-description-hint" class="mt-1 text-xs text-neutral-700">
          Bis zu 5000 Zeichen. Fett, kursiv und Listen sind möglich.
        </p>
        {#if errors.description}<p id="aktion-description-error" class="mt-1 text-sm text-danger">
            {errors.description}
          </p>{/if}
      </div>
    </fieldset>
  {/if}
</EditDialog>
